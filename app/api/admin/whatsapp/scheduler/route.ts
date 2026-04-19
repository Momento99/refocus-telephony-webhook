import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * WhatsApp Follow-up Scheduler Worker
 *
 * Вызывается cron'ом каждые 5 минут. Читает whatsapp_followup_queue,
 * отправляет через Meta Cloud API, записывает исход в whatsapp_messages
 * и создаёт whatsapp_threads (status='waiting_customer').
 *
 * Security: требует заголовок `authorization: bearer <WHATSAPP_CRON_SECRET>`.
 */

const CLOUD_API_BASE = 'https://graph.facebook.com/v21.0';
const BATCH_SIZE = 25;

type QueueItem = {
  id: string;
  customer_id: number;
  order_id: number;
  branch_id: number;
  phone_number: string;
  scenario: string;
  template_name: string;
  template_language: string;
  template_variables: Record<string, string> | null;
  attempts: number;
};

type Config = {
  phone_number_id: string | null;
  access_token: string | null;
  is_active: boolean;
};

async function loadConfig(): Promise<Config | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('whatsapp_api_config')
    .select('phone_number_id, access_token, is_active')
    .eq('id', 1)
    .maybeSingle();
  return (data as Config | null) ?? null;
}

async function sendTemplate(
  cfg: Config,
  item: QueueItem,
): Promise<{ ok: true; waMessageId: string } | { ok: false; error: string }> {
  if (!cfg.phone_number_id || !cfg.access_token) {
    return { ok: false, error: 'Config missing phone_number_id or access_token' };
  }

  const vars = item.template_variables ?? {};
  const params = Object.keys(vars)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => ({ type: 'text', text: String(vars[k] ?? '') }));

  const body = {
    messaging_product: 'whatsapp',
    to: item.phone_number,
    type: 'template',
    template: {
      name: item.template_name,
      language: { code: item.template_language || 'ru' },
      components: params.length ? [{ type: 'body', parameters: params }] : [],
    },
  };

  try {
    const r = await fetch(`${CLOUD_API_BASE}/${cfg.phone_number_id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = data?.error;
      return {
        ok: false,
        error: `${r.status} ${err?.code ?? ''} ${err?.message ?? JSON.stringify(data)}`,
      };
    }
    const waMessageId: string | undefined = data?.messages?.[0]?.id;
    if (!waMessageId) return { ok: false, error: 'No message id in response' };
    return { ok: true, waMessageId };
  } catch (e: any) {
    return { ok: false, error: `Fetch error: ${e?.message ?? e}` };
  }
}

async function createOutboundThreadAndMessage(
  item: QueueItem,
  waMessageId: string,
): Promise<string | null> {
  const admin = getSupabaseAdmin();

  // Уже есть активный тред для этого номера?
  let threadId: string | null = null;
  const { data: existing } = await admin
    .from('whatsapp_threads')
    .select('id')
    .eq('phone_number', item.phone_number)
    .neq('status', 'closed')
    .limit(1)
    .maybeSingle();
  threadId = (existing?.id as string | undefined) ?? null;

  if (!threadId) {
    // Кого по умолчанию назначить на тред: продавец, который оформлял заказ
    const { data: orderRow } = await admin
      .from('orders')
      .select('seller_employee_id')
      .eq('id', item.order_id)
      .maybeSingle();
    const sellerEmployeeId: number | null =
      (orderRow?.seller_employee_id as number | null) ?? null;

    const { data: newThread, error } = await admin
      .from('whatsapp_threads')
      .insert({
        customer_id: item.customer_id,
        phone_number: item.phone_number,
        branch_id: item.branch_id,
        order_id: item.order_id,
        assigned_seller_employee_id: sellerEmployeeId,
        status: 'waiting_customer',
      })
      .select('id')
      .single();
    if (error) {
      console.error('[wa scheduler] thread create failed', error);
      return null;
    }
    threadId = newThread.id as string;
  }

  const now = new Date().toISOString();
  const { data: msg, error: eMsg } = await admin
    .from('whatsapp_messages')
    .insert({
      thread_id: threadId,
      direction: 'outbound',
      wa_message_id: waMessageId,
      message_type: 'template',
      template_name: item.template_name,
      template_language: item.template_language,
      template_variables: item.template_variables,
      status: 'sent',
      created_at: now,
    })
    .select('id')
    .single();
  if (eMsg) {
    console.error('[wa scheduler] msg insert failed', eMsg);
    return threadId;
  }

  await admin
    .from('whatsapp_threads')
    .update({ last_message_at: now, status: 'waiting_customer' })
    .eq('id', threadId);

  return (msg?.id as string) ?? null;
}

function assertAuth(req: Request): string | null {
  const ours = process.env.WHATSAPP_CRON_SECRET;
  const vercel = process.env.CRON_SECRET;
  if (!ours && !vercel) return 'WHATSAPP_CRON_SECRET or CRON_SECRET env not set';
  const hdr = (req.headers.get('authorization') ?? '').toLowerCase();
  if (ours && hdr === `bearer ${ours}`.toLowerCase()) return null;
  if (vercel && hdr === `bearer ${vercel}`.toLowerCase()) return null;
  return 'unauthorized';
}

async function markSlaBreaches(admin: ReturnType<typeof getSupabaseAdmin>): Promise<number> {
  const cutoff = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('whatsapp_threads')
    .update({ sla_breached: true })
    .eq('status', 'waiting_seller')
    .eq('sla_breached', false)
    .lte('first_customer_message_at', cutoff)
    .is('first_seller_response_at', null)
    .select('id');
  if (error) {
    console.error('[wa scheduler] mark sla breach failed', error);
    return 0;
  }
  return (data ?? []).length;
}

async function runScheduler(req: Request) {
  const authErr = assertAuth(req);
  if (authErr) return NextResponse.json({ error: authErr }, { status: 401 });

  const admin = getSupabaseAdmin();

  // SLA breach detection — работает всегда, независимо от конфига.
  const breached = await markSlaBreaches(admin);

  const cfg = await loadConfig();
  if (!cfg || !cfg.is_active) {
    return NextResponse.json({
      ok: true,
      skipped: 'integration not active',
      sla_breaches_marked: breached,
      processed: 0,
    });
  }
  if (!cfg.phone_number_id || !cfg.access_token) {
    return NextResponse.json({
      ok: true,
      skipped: 'credentials missing',
      sla_breaches_marked: breached,
      processed: 0,
    });
  }

  const { data: items, error: eSel } = await admin
    .from('whatsapp_followup_queue')
    .select('id, customer_id, order_id, branch_id, phone_number, scenario, template_name, template_language, template_variables, attempts')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (eSel) return NextResponse.json({ error: eSel.message }, { status: 500 });
  if (!items || items.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  let sent = 0;
  let failed = 0;

  for (const raw of items) {
    const item = raw as QueueItem;

    // Проверяем, что согласие ещё активно (мог отозвать до отправки)
    const { data: consent } = await admin
      .from('whatsapp_consents')
      .select('id')
      .eq('order_id', item.order_id)
      .is('revoked_at', null)
      .limit(1)
      .maybeSingle();
    if (!consent) {
      await admin
        .from('whatsapp_followup_queue')
        .update({ status: 'cancelled', error_message: 'consent revoked or missing' })
        .eq('id', item.id);
      continue;
    }

    const result = await sendTemplate(cfg, item);

    if (result.ok) {
      const msgId = await createOutboundThreadAndMessage(item, result.waMessageId);
      await admin
        .from('whatsapp_followup_queue')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          sent_message_id: msgId,
          attempts: (item.attempts ?? 0) + 1,
        })
        .eq('id', item.id);
      sent++;
    } else {
      const nextAttempts = (item.attempts ?? 0) + 1;
      const tooMany = nextAttempts >= 3;
      await admin
        .from('whatsapp_followup_queue')
        .update({
          status: tooMany ? 'failed' : 'pending',
          error_message: result.error,
          attempts: nextAttempts,
        })
        .eq('id', item.id);
      failed++;
    }
  }

  // === 2. Отправка свободного текста (pending outbound, созданные в POS inbox) ===
  const { data: pendingTexts } = await admin
    .from('whatsapp_messages')
    .select('id, thread_id, body')
    .eq('direction', 'outbound')
    .eq('status', 'pending')
    .is('wa_message_id', null)
    .eq('message_type', 'text')
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  let textsSent = 0;
  let textsFailed = 0;

  for (const raw of pendingTexts ?? []) {
    const msg = raw as { id: string; thread_id: string; body: string | null };
    if (!msg.body) {
      await admin
        .from('whatsapp_messages')
        .update({ status: 'failed', error_message: 'empty body' })
        .eq('id', msg.id);
      textsFailed++;
      continue;
    }
    const { data: thread } = await admin
      .from('whatsapp_threads')
      .select('phone_number, first_seller_response_at')
      .eq('id', msg.thread_id)
      .maybeSingle();
    if (!thread) {
      await admin
        .from('whatsapp_messages')
        .update({ status: 'failed', error_message: 'thread not found' })
        .eq('id', msg.id);
      textsFailed++;
      continue;
    }

    try {
      const r = await fetch(`${CLOUD_API_BASE}/${cfg.phone_number_id}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: thread.phone_number,
          type: 'text',
          text: { body: msg.body, preview_url: false },
        }),
      });
      const data: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        const err = data?.error;
        await admin
          .from('whatsapp_messages')
          .update({
            status: 'failed',
            error_code: String(err?.code ?? r.status),
            error_message: err?.message ?? JSON.stringify(data),
          })
          .eq('id', msg.id);
        textsFailed++;
        continue;
      }
      const waId: string | undefined = data?.messages?.[0]?.id;
      await admin
        .from('whatsapp_messages')
        .update({ status: 'sent', wa_message_id: waId ?? null })
        .eq('id', msg.id);
      if (!thread.first_seller_response_at) {
        await admin
          .from('whatsapp_threads')
          .update({ first_seller_response_at: new Date().toISOString() })
          .eq('id', msg.thread_id);
      }
      textsSent++;
    } catch (e: any) {
      await admin
        .from('whatsapp_messages')
        .update({ status: 'failed', error_message: `fetch: ${e?.message ?? e}` })
        .eq('id', msg.id);
      textsFailed++;
    }
  }

  // === 3. Instagram Direct — отправка pending outbound сообщений ===
  const ig = await runInstagramOutbound(admin);

  return NextResponse.json({
    ok: true,
    sla_breaches_marked: breached,
    followups: { processed: items.length, sent, failed },
    texts: { sent: textsSent, failed: textsFailed },
    instagram: ig,
  });
}

type IgConfig = {
  ig_business_account_id: string | null;
  page_access_token: string | null;
  is_active: boolean | null;
};

async function runInstagramOutbound(
  admin: ReturnType<typeof getSupabaseAdmin>,
): Promise<{ sent: number; failed: number; skipped?: string }> {
  // SLA breach detection for IG — same logic as WhatsApp.
  const cutoff = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  await admin
    .from('instagram_threads')
    .update({ sla_breached: true })
    .eq('status', 'waiting_seller')
    .eq('sla_breached', false)
    .lte('first_customer_message_at', cutoff)
    .is('first_seller_response_at', null);

  const { data: cfgRow } = await admin
    .from('instagram_api_config')
    .select('ig_business_account_id, page_access_token, is_active')
    .eq('id', 1)
    .maybeSingle();
  const cfg = (cfgRow as IgConfig | null) ?? null;

  if (!cfg || !cfg.is_active) return { sent: 0, failed: 0, skipped: 'instagram inactive' };
  if (!cfg.ig_business_account_id || !cfg.page_access_token) {
    return { sent: 0, failed: 0, skipped: 'instagram credentials missing' };
  }

  const { data: pending } = await admin
    .from('instagram_messages')
    .select('id, thread_id, body, message_type')
    .eq('direction', 'outbound')
    .eq('status', 'pending')
    .is('ig_message_id', null)
    .eq('message_type', 'text')
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  let sent = 0;
  let failed = 0;

  for (const raw of pending ?? []) {
    const msg = raw as { id: string; thread_id: string; body: string | null; message_type: string };
    if (!msg.body) {
      await admin
        .from('instagram_messages')
        .update({ status: 'failed', error_message: 'empty body' })
        .eq('id', msg.id);
      failed++;
      continue;
    }
    const { data: thread } = await admin
      .from('instagram_threads')
      .select('ig_user_id, first_seller_response_at')
      .eq('id', msg.thread_id)
      .maybeSingle();
    if (!thread) {
      await admin
        .from('instagram_messages')
        .update({ status: 'failed', error_message: 'thread not found' })
        .eq('id', msg.id);
      failed++;
      continue;
    }

    try {
      // Instagram Login path — endpoint is graph.instagram.com/me/messages,
      // not graph.facebook.com/{ig-id}/messages as in the old FB Login flow.
      const r = await fetch(
        `https://graph.instagram.com/v21.0/me/messages?access_token=${encodeURIComponent(cfg.page_access_token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: thread.ig_user_id },
            message: { text: msg.body },
          }),
        },
      );
      const data: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        const err = data?.error;
        await admin
          .from('instagram_messages')
          .update({
            status: 'failed',
            error_code: String(err?.code ?? r.status),
            error_message: err?.message ?? JSON.stringify(data),
          })
          .eq('id', msg.id);
        failed++;
        continue;
      }
      const mid: string | undefined = data?.message_id;
      await admin
        .from('instagram_messages')
        .update({ status: 'sent', ig_message_id: mid ?? null })
        .eq('id', msg.id);
      if (!thread.first_seller_response_at) {
        await admin
          .from('instagram_threads')
          .update({ first_seller_response_at: new Date().toISOString() })
          .eq('id', msg.thread_id);
      }
      sent++;
    } catch (e: any) {
      await admin
        .from('instagram_messages')
        .update({ status: 'failed', error_message: `fetch: ${e?.message ?? e}` })
        .eq('id', msg.id);
      failed++;
    }
  }

  return { sent, failed };
}

export async function POST(req: Request) {
  return runScheduler(req);
}

export async function GET(req: Request) {
  return runScheduler(req);
}
