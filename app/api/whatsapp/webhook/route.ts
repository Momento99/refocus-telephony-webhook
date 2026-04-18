import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

type MetaStatus = {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
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

  // Найти клиента по телефону
  const { data: customer } = await admin
    .from('customers')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  // Последний заказ → branch_id + seller
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

  // Если не нашли филиал — нельзя создавать тред (branch_id NOT NULL).
  // В будущем: bucket "unassigned" с fallback_branch_id. Сейчас — логируем и выходим.
  if (!customer?.id || !branchId) {
    console.warn('[whatsapp webhook] cannot route thread — no customer or no branch for phone', phone);
    return null;
  }

  const { data: newThread, error } = await admin
    .from('whatsapp_threads')
    .insert({
      customer_id: customer.id,
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
    return null;
  }
  return newThread.id as string;
}

async function ingestMessage(m: MetaMessage) {
  const admin = getSupabaseAdmin();
  const phone = m.from;

  const threadId = await findOrCreateThread(phone);
  if (!threadId) return;

  const body = messageBody(m);
  const mType = messageTypeMap(m.type);
  const createdAt = new Date(Number(m.timestamp) * 1000).toISOString();

  const { error: eMsg } = await admin.from('whatsapp_messages').insert({
    thread_id: threadId,
    direction: 'inbound',
    wa_message_id: m.id,
    message_type: mType,
    body,
    status: 'delivered',
    created_at: createdAt,
  });

  if (eMsg) {
    if ((eMsg as any).code !== '23505') {
      console.error('[whatsapp webhook] msg insert error', eMsg);
    }
    return; // duplicate или ошибка
  }

  // Обновить тред: first_customer_message_at если не стоит, last_message_at, unread_count++
  const { data: thread } = await admin
    .from('whatsapp_threads')
    .select('first_customer_message_at, unread_count')
    .eq('id', threadId)
    .maybeSingle();

  const patch: Record<string, unknown> = {
    last_message_at: createdAt,
    unread_count: ((thread?.unread_count as number | null) ?? 0) + 1,
    status: 'waiting_seller',
  };
  if (!thread?.first_customer_message_at) patch.first_customer_message_at = createdAt;

  await admin.from('whatsapp_threads').update(patch).eq('id', threadId);
}

async function ingestStatus(s: MetaStatus) {
  const admin = getSupabaseAdmin();
  const update: Record<string, unknown> = { status: s.status };
  if (s.status === 'failed' && s.errors?.[0]) {
    update.error_code = String(s.errors[0].code ?? '');
    update.error_message = s.errors[0].title ?? s.errors[0].message ?? '';
  }
  await admin.from('whatsapp_messages').update(update).eq('wa_message_id', s.id);
}

export async function POST(req: Request) {
  let payload: MetaPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  // Meta требует 200 быстро. Обрабатываем после.
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
            console.error('[whatsapp webhook] ingestMessage fail', e);
          }
        }
        for (const s of value.statuses ?? []) {
          try {
            await ingestStatus(s);
          } catch (e) {
            console.error('[whatsapp webhook] ingestStatus fail', e);
          }
        }
      }
    }
  } catch (e) {
    console.error('[whatsapp webhook] processing error', e);
  }

  return NextResponse.json({ ok: true });
}
