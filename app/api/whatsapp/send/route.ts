import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * WhatsApp immediate send endpoint for seller free-text replies.
 *
 * POS inserts a pending outbound message (client-side, for instant UI), then
 * POSTs { message_id } here. Server calls Meta Cloud API and updates
 * wa_message_id + status synchronously. Scheduler remains a safety net.
 *
 * NOT for template sends — aftercare templates go through the daily cron.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

export async function OPTIONS() {
  const res = new NextResponse(null, { status: 204 });
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

type WaConfig = {
  phone_number_id: string | null;
  access_token: string | null;
  is_active: boolean | null;
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const messageId = typeof body?.message_id === 'string' ? body.message_id : '';
  if (!messageId) return json({ ok: false, error: 'BAD_INPUT' }, 400);

  const admin = getSupabaseAdmin();

  const { data: msg, error: eMsg } = await admin
    .from('whatsapp_messages')
    .select('id, thread_id, direction, message_type, body, status, wa_message_id')
    .eq('id', messageId)
    .maybeSingle();

  if (eMsg) return json({ ok: false, error: 'DB_ERROR', details: eMsg.message }, 500);
  if (!msg) return json({ ok: false, error: 'NOT_FOUND' }, 404);
  if (msg.direction !== 'outbound') return json({ ok: false, error: 'NOT_OUTBOUND' }, 400);
  if (msg.wa_message_id) return json({ ok: true, already_sent: true, wa_message_id: msg.wa_message_id });
  if (msg.status !== 'pending') return json({ ok: false, error: `BAD_STATUS:${msg.status}` }, 400);
  if (msg.message_type !== 'text' || !msg.body) return json({ ok: false, error: 'UNSUPPORTED_MESSAGE_TYPE' }, 400);
  // WhatsApp Cloud API hard limit
  if (msg.body.length > 4096) return json({ ok: false, error: 'BODY_TOO_LONG', details: `Max 4096 chars, got ${msg.body.length}` }, 400);

  // ✅ Атомарный «захват» сообщения: меняем pending → sending по WHERE status='pending'.
  // Если затронуто 0 строк — уже кто-то взял (cron-safety-net или параллельный POST).
  const { data: claimed, error: eClaim } = await admin
    .from('whatsapp_messages')
    .update({ status: 'sending' })
    .eq('id', msg.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (eClaim) return json({ ok: false, error: 'CLAIM_ERROR', details: eClaim.message }, 500);
  if (!claimed) return json({ ok: true, already_being_sent: true });

  const { data: thread, error: eThread } = await admin
    .from('whatsapp_threads')
    .select('id, phone_number, first_seller_response_at')
    .eq('id', msg.thread_id)
    .maybeSingle();
  if (eThread || !thread) return json({ ok: false, error: 'THREAD_NOT_FOUND' }, 404);

  const { data: cfgRow } = await admin
    .from('whatsapp_api_config')
    .select('phone_number_id, access_token, is_active')
    .eq('id', 1)
    .maybeSingle();
  const cfg = (cfgRow as WaConfig | null) ?? null;

  if (!cfg?.phone_number_id || !cfg?.access_token) return json({ ok: false, error: 'CONFIG_MISSING' }, 500);
  if (!cfg.is_active) return json({ ok: false, error: 'INTEGRATION_INACTIVE' }, 400);

  try {
    // ✅ Timeout, чтобы worker не висел вечно при сбое Meta
    const r = await fetch(`https://graph.facebook.com/v21.0/${cfg.phone_number_id}/messages`, {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
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
      const err = data?.error ?? {};
      await admin
        .from('whatsapp_messages')
        .update({
          status: 'failed',
          error_code: String(err?.code ?? r.status),
          error_message: err?.message ?? JSON.stringify(data),
        })
        .eq('id', msg.id);
      return json(
        {
          ok: false,
          error: 'WA_SEND_FAILED',
          provider_code: err?.code ?? null,
          details: err?.message ?? JSON.stringify(data),
        },
        502,
      );
    }

    const waMessageId: string | null = data?.messages?.[0]?.id ?? null;

    await admin
      .from('whatsapp_messages')
      .update({
        status: 'sent',
        wa_message_id: waMessageId,
      })
      .eq('id', msg.id);

    const threadPatch: Record<string, unknown> = {
      last_customer_message_at: null, // seller replied → clear unanswered marker
    };
    if (!thread.first_seller_response_at) {
      threadPatch.first_seller_response_at = new Date().toISOString();
    }
    await admin.from('whatsapp_threads').update(threadPatch).eq('id', msg.thread_id);

    return json({ ok: true, wa_message_id: waMessageId });
  } catch (e: any) {
    await admin
      .from('whatsapp_messages')
      .update({ status: 'failed', error_message: `fetch: ${e?.message ?? e}` })
      .eq('id', msg.id);
    return json({ ok: false, error: 'FETCH_ERROR', details: String(e?.message ?? e) }, 502);
  }
}
