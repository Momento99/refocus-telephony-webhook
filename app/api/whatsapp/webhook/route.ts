import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { isCustomerAcknowledgementOrPositiveClosure } from '@/lib/farewellDetect';
import { applyWhatsappDeliveryStatus, reconcileWhatsappThread, type WhatsappDeliveryStatus } from '@/lib/whatsappDelivery';
import { archiveWhatsappMediaAfterReceive, incomingWhatsappMedia, WhatsappMediaError } from '@/lib/whatsappMedia';
import { verifyWhatsappWebhookSignature } from '@/lib/whatsappWebhookVerification';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
let warnedAboutMissingAppSecret = false;

/**
 * WhatsApp Cloud API Webhook
 *
 * GET: verification challenge from Meta. Query: hub.mode, hub.verify_token, hub.challenge.
 * POST: incoming messages + status updates.
 *
 * Verify token stored in whatsapp_api_config.webhook_verify_token.
 */

async function getVerifyToken(): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('whatsapp_api_config')
    .select('webhook_verify_token')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) return null;
  return (data.webhook_verify_token as string | null) ?? null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  const configured = await getVerifyToken();
  if (mode === 'subscribe' && configured && token === configured) {
    return new Response(challenge ?? '', { status: 200 });
  }
  return new Response('forbidden', { status: 403 });
}

type MetaMessage = {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
  video?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  sticker?: { id?: string; mime_type?: string };
  reaction?: { message_id: string; emoji?: string };
  context?: { from?: string; id?: string };
};

type MetaStatus = WhatsappDeliveryStatus & {
  timestamp: string;
  recipient_id: string;
};

type MetaValue = {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id: string }>;
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
};

type MetaPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: MetaValue;
    }>;
  }>;
};

function messageTypeMap(t: string): string {
  const allowed = ['text', 'image', 'audio', 'video', 'document', 'location', 'sticker', 'reaction'];
  return allowed.includes(t) ? t : 'text';
}

function messageBody(m: MetaMessage): string | null {
  switch (m.type) {
    case 'text': return m.text?.body ?? null;
    case 'image': return m.image?.caption ?? null;
    case 'video': return m.video?.caption ?? null;
    case 'document': return m.document?.caption ?? m.document?.filename ?? null;
    case 'location':
      return m.location ? `[Локация: ${m.location.latitude},${m.location.longitude}${m.location.name ? ' ' + m.location.name : ''}]` : null;
    case 'reaction': return m.reaction?.emoji ? `[Реакция: ${m.reaction.emoji}]` : null;
    default: return null;
  }
}

async function findOrCreateThread(phone: string): Promise<string | null> {
  const admin = getSupabaseAdmin();

  const { data: existing } = await admin
    .from('whatsapp_threads')
    .select('id')
    .eq('phone_number', phone)
    .neq('status', 'closed')
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing.id as string;

  // Try to match customer by phone. If not found → unassigned thread (no customer, no branch).
  const { data: customer } = await admin
    .from('customers')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  let branchId: number | null = null;
  let sellerEmployeeId: number | null = null;
  let orderId: number | null = null;
  if (customer?.id) {
    const { data: lastOrder } = await admin
      .from('orders')
      .select('id, branch_id, seller_employee_id')
      .eq('customer_id', customer.id)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastOrder) {
      branchId = lastOrder.branch_id as number;
      sellerEmployeeId = lastOrder.seller_employee_id as number | null;
      orderId = lastOrder.id as number;
    }
  }

  const { data: newThread, error } = await admin
    .from('whatsapp_threads')
    .insert({
      customer_id: customer?.id ?? null,
      phone_number: phone,
      branch_id: branchId,
      order_id: orderId,
      assigned_seller_employee_id: sellerEmployeeId,
      status: 'waiting_seller',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[whatsapp webhook] failed to create thread', error);
    throw new Error('WhatsApp thread could not be created');
  }
  return newThread.id as string;
}

function normalizePhoneDigits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

async function getOwnerWhatsappNormalized(): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('franchise_config')
    .select('value')
    .eq('key', 'owner_whatsapp')
    .maybeSingle();
  const raw = (data?.value as string | null) ?? null;
  return raw ? normalizePhoneDigits(raw) : null;
}

async function ingestMessage(m: MetaMessage) {
  const admin = getSupabaseAdmin();
  const phone = m.from;

  // Фильтр: если входящее с номера владельца (он отвечает на franchise-alert
  // в чате с 705), не сохраняем в розничные таблицы. Иначе кассиры увидят
  // тред с владельцем и франшиз-контекст в POS UI.
  const ownerPhone = await getOwnerWhatsappNormalized();
  if (ownerPhone && normalizePhoneDigits(phone) === ownerPhone) {
    return;
  }

  // Meta retries deliveries. Resolve an existing row before creating another thread,
  // especially if a cashier closed the original thread between two webhook attempts.
  const prior = await admin.from('whatsapp_messages')
    .select('id,thread_id,media_url,media_mime_type').eq('wa_message_id', m.id).maybeSingle();
  if (prior.error) throw new Error('WhatsApp duplicate lookup failed');
  if (prior.data) {
    const media = incomingWhatsappMedia(m);
    if (media && !prior.data.media_url) {
      const repaired = await admin.from('whatsapp_messages').update(media).eq('id', prior.data.id).is('media_url', null);
      if (repaired.error) throw new Error('WhatsApp media reference could not be saved');
      prior.data.media_url = media.media_url;
      prior.data.media_mime_type = media.media_mime_type;
    }
    if (media) await archiveIncomingMedia(prior.data);
    await reconcileWhatsappThread(admin, prior.data.thread_id);
    return;
  }

  const threadId = await findOrCreateThread(phone);
  if (!threadId) return;

  const body = messageBody(m);
  const mType = messageTypeMap(m.type);
  const createdAt = new Date(Number(m.timestamp) * 1000).toISOString();
  const media = incomingWhatsappMedia(m);

  const { data: savedMessage, error: eMsg } = await admin.from('whatsapp_messages').insert({
    thread_id: threadId,
    direction: 'inbound',
    wa_message_id: m.id,
    message_type: mType,
    body,
    ...(media || {}),
    status: 'delivered',
    created_at: createdAt,
  }).select('id,thread_id,media_url,media_mime_type').single();

  if (eMsg) {
    if (eMsg.code === '23505') {
      // A concurrent webhook won the insert. Its row is the canonical message;
      // do not increment unread a second time, but still retry media preservation.
      const duplicate = await admin.from('whatsapp_messages')
        .select('id,thread_id,media_url,media_mime_type').eq('wa_message_id', m.id).single();
      if (duplicate.error) throw new Error('WhatsApp duplicate message could not be read');
      if (media) await archiveIncomingMedia(duplicate.data);
      await reconcileWhatsappThread(admin, duplicate.data.thread_id);
      return;
    }
    console.error('[whatsapp webhook] msg insert error', eMsg);
    throw new Error('WhatsApp message could not be saved');
  }

  // Обновить тред: first_customer_message_at если не стоит, last_message_at, unread_count++
  const { data: thread, error: threadError } = await admin
    .from('whatsapp_threads')
    .select('first_customer_message_at, unread_count, farewell_sent_at')
    .eq('id', threadId)
    .maybeSingle();
  if (threadError || !thread) throw new Error('WhatsApp thread could not be read');

  // Если продавец уже попрощался и входящее — просто ack (спасибо/хорошего дня),
  // не поднимаем SLA-маркеры и не вспыхиваем в inbox'е. Тред остаётся «закрытым
  // по смыслу», но сообщение всё равно сохраняется для истории.
  const postFarewellAck =
    !!thread.farewell_sent_at && (mType === 'text' || mType === 'reaction') && isCustomerAcknowledgementOrPositiveClosure(body);

  const patch: Record<string, unknown> = {
    last_message_at: createdAt,
  };
  if (!thread?.first_customer_message_at) patch.first_customer_message_at = createdAt;

  if (postFarewellAck) {
    // Держим статус и unread без изменений. Не обновляем last_customer_message_at,
    // чтобы SLA-часы и «непрочитанный» индикатор не тикали.
  } else {
    patch.last_customer_message_at = createdAt;
    patch.unread_count = ((thread?.unread_count as number | null) ?? 0) + 1;
    patch.status = 'waiting_seller';
    // Настоящий вопрос после прощания — reopen: сбрасываем прощальный флаг.
    if (thread?.farewell_sent_at) patch.farewell_sent_at = null;
  }

  const threadUpdate = await admin.from('whatsapp_threads').update(patch).eq('id', threadId);
  if (threadUpdate.error) throw new Error('WhatsApp thread could not be updated');
  await reconcileWhatsappThread(admin, threadId);
  if (media) await archiveIncomingMedia(savedMessage);
}

async function archiveIncomingMedia(message: { id: string; media_url: string | null; media_mime_type: string | null }) {
  const result = await archiveWhatsappMediaAfterReceive(getSupabaseAdmin(), message);
  if (!result.archived) console.error('[whatsapp webhook] media unavailable', { messageId: message.id, code: result.permanentError });
}

async function ingestStatus(s: MetaStatus) {
  await applyWhatsappDeliveryStatus(getSupabaseAdmin(), s);
}

export async function POST(req: Request) {
  let payload: MetaPayload;
  try {
    const rawBody = new Uint8Array(await req.arrayBuffer());
    const verification = verifyWhatsappWebhookSignature(rawBody, req.headers.get('x-hub-signature-256'), process.env.WHATSAPP_APP_SECRET);
    if (!verification.ok) return NextResponse.json({ ok: false, error: 'BAD_SIGNATURE' }, { status: 403 });
    if (!verification.configured && !warnedAboutMissingAppSecret) {
      warnedAboutMissingAppSecret = true;
      console.warn('[whatsapp webhook] WHATSAPP_APP_SECRET is not configured; signature verification is unavailable');
    }
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return NextResponse.json({ ok: true });
  }

  let saveFailed = false;
  // Acknowledge only after durable persistence. Otherwise Meta must retry rather
  // than silently lose a customer question or a media identifier.
  try {
    const entries = payload.entry ?? [];
    for (const entry of entries) {
      const changes = entry.changes ?? [];
      for (const ch of changes) {
        if (ch.field !== 'messages') continue;
        const value = ch.value ?? {};
        for (const m of value.messages ?? []) {
          try {
            await ingestMessage(m);
          } catch (e) {
            console.error('[whatsapp webhook] ingestMessage fail', e instanceof WhatsappMediaError ? e.code : 'message_save_failed');
            saveFailed = true;
          }
        }
        for (const s of value.statuses ?? []) {
          try {
            await ingestStatus(s);
          } catch (e) {
            console.error('[whatsapp webhook] ingestStatus fail', e);
            saveFailed = true;
          }
        }
      }
    }
  } catch (e) {
    console.error('[whatsapp webhook] processing error', e);
    saveFailed = true;
  }

  if (saveFailed) return NextResponse.json({ ok: false }, { status: 503 });
  return NextResponse.json({ ok: true });
}
