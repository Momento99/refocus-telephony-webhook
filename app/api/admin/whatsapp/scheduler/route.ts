import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { orderReadySkipReason, reconcileWhatsappQueue, reconcileWhatsappThread, replayWhatsappDeliveryReceipts, pruneWhatsappDeliveryReceipts } from '@/lib/whatsappDelivery';
import { sendPendingWhatsappText } from '@/lib/whatsappSend';
import { expireStaleWhatsappFollowups, sendPendingWhatsappFollowup, type WhatsappFollowupItem as QueueItem } from '@/lib/whatsappFollowup';

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

const BATCH_SIZE = 25;

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
        // Скрываем тред от инбокса продавца до первого ответа клиента —
        // авто-сообщения (aftercare, order_ready) не должны захламлять список
        // тех тредов где реально нужно отвечать. Когда клиент пришлёт первый
        // inbound, trigger trg_wa_thread_unhide_on_inbound сбросит флаг.
        hidden_until_reply: true,
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
    return null;
  }

  await admin
    .from('whatsapp_threads')
    .update({ last_message_at: now })
    .eq('id', threadId);

  try {
    await replayWhatsappDeliveryReceipts(admin, waMessageId);
    await reconcileWhatsappThread(admin, threadId);
  } catch (error) {
    // The provider already accepted this template. Recording the queue result must
    // still finish so a metadata reconciliation error cannot trigger another send.
    console.error('[wa scheduler] thread state reconciliation failed', { threadId, error: String(error) });
  }
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
    .lte('last_customer_message_at', cutoff)
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
  const workDeadline = Date.now() + 40_000;

  // Bounded cleanup also runs while outbound messaging is disabled.
  try { await pruneWhatsappDeliveryReceipts(admin); }
  catch (error) { console.error('[wa scheduler] receipt cleanup failed', String(error)); }

  // SLA breach detection — работает всегда, независимо от конфига.
  const staleFollowups = await expireStaleWhatsappFollowups(admin);
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
    .select('id, customer_id, order_id, branch_id, phone_number, scenario, template_name, template_language, template_variables, attempts, created_at')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (eSel) return NextResponse.json({ error: eSel.message }, { status: 500 });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const raw of items || []) {
    if (Date.now() >= workDeadline) break;
    const item = raw as QueueItem;

    if (item.scenario === 'order_ready') {
      const { data: order, error: orderError } = await admin.from('orders')
        .select('status,is_deleted,ready_at,delivered_at')
        .eq('id', item.order_id).eq('branch_id', item.branch_id)
        .eq('customer_id', item.customer_id).maybeSingle();
      if (orderError) return NextResponse.json({ error: 'Could not verify order before WhatsApp send' }, { status: 503 });
      const skipReason = orderReadySkipReason(order, item.created_at);
      if (skipReason) {
        const { error: cancelError } = await admin.from('whatsapp_followup_queue')
          .update({ status: 'cancelled', error_message: skipReason })
          .eq('id', item.id).eq('status', 'pending');
        if (cancelError) return NextResponse.json({ error: 'Could not cancel obsolete ready notification' }, { status: 503 });
        skipped++;
        continue;
      }
    }

    // Note (2026-04-25): consent re-check removed per business decision —
    // we send Utility templates to all customers without explicit opt-in.
    // See migration 20260425b_drop_whatsapp_optin_requirement.sql.
    const outcome = await sendPendingWhatsappFollowup(admin, item, cfg, {
      recordAccepted: createOutboundThreadAndMessage,
    });
    if (outcome.messageId) await reconcileWhatsappQueue(admin, outcome.messageId);
    if (outcome.state === 'sent') sent++;
    else if (outcome.state === 'skipped') skipped++;
    else failed++;
  }

  // === 2. Отправка свободного текста (pending outbound, созданные в POS inbox) ===
  const { data: pendingTexts } = await admin
    .from('whatsapp_messages')
    .select('id, thread_id, body')
    .eq('direction', 'outbound')
    .in('status', ['pending', 'sending'])
    .eq('message_type', 'text')
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  let textsSent = 0;
  let textsFailed = 0;

  for (const raw of pendingTexts ?? []) {
    if (Date.now() >= workDeadline) break;
    const outcome = await sendPendingWhatsappText(admin, raw.id as string, { config: cfg });
    if (outcome.body.ok && outcome.body.status !== 'sending') textsSent++;
    else if (!outcome.body.ok) textsFailed++;
  }

  // === 3. Instagram Direct — отправка pending outbound сообщений ===
  const ig = await markInstagramSlaBreaches(admin);

  return NextResponse.json({
    ok: true,
    sla_breaches_marked: breached,
    followups: { processed: sent + failed + skipped, sent, failed, skipped, stale_failed: staleFollowups },
    texts: { sent: textsSent, failed: textsFailed },
    instagram: ig,
  });
}

/** Instagram sending remains owned by the existing one-minute database safety net. */
async function markInstagramSlaBreaches(admin: ReturnType<typeof getSupabaseAdmin>) {
  const cutoff = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const { error } = await admin.from('instagram_threads').update({ sla_breached: true })
    .eq('status', 'waiting_seller').eq('sla_breached', false)
    .lte('first_customer_message_at', cutoff).is('first_seller_response_at', null);
  if (error) console.error('[wa scheduler] Instagram SLA check failed', error.message);
  return { sent: 0, failed: 0, skipped: 'Instagram sending is handled by the database safety net' };
}

export async function POST(req: Request) {
  return runScheduler(req);
}

export async function GET(req: Request) {
  return runScheduler(req);
}
