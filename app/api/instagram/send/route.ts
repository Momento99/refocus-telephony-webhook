import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Instagram immediate send endpoint.
 *
 * POS inserts a pending outbound message (client-side, for instant UI), then
 * POSTs { message_id } here. Server calls Graph API and updates ig_message_id
 * + status synchronously, so the later echo webhook updates the SAME row
 * instead of inserting a duplicate. Scheduler remains a safety net.
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

type IgConfig = {
  ig_business_account_id: string | null;
  page_access_token: string | null;
  is_active: boolean | null;
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const messageId = typeof body?.message_id === 'string' ? body.message_id : '';
  if (!messageId) return json({ ok: false, error: 'BAD_INPUT' }, 400);

  const admin = getSupabaseAdmin();

  const { data: msg, error: eMsg } = await admin
    .from('instagram_messages')
    .select('id, thread_id, direction, message_type, body, status, ig_message_id')
    .eq('id', messageId)
    .maybeSingle();

  if (eMsg) return json({ ok: false, error: 'DB_ERROR', details: eMsg.message }, 500);
  if (!msg) return json({ ok: false, error: 'NOT_FOUND' }, 404);
  if (msg.direction !== 'outbound') return json({ ok: false, error: 'NOT_OUTBOUND' }, 400);
  if (msg.ig_message_id) return json({ ok: true, already_sent: true, ig_message_id: msg.ig_message_id });
  if (msg.status !== 'pending') return json({ ok: false, error: `BAD_STATUS:${msg.status}` }, 400);
  if (msg.message_type !== 'text' || !msg.body) return json({ ok: false, error: 'UNSUPPORTED_MESSAGE_TYPE' }, 400);

  const { data: thread, error: eThread } = await admin
    .from('instagram_threads')
    .select('id, ig_user_id, first_seller_response_at')
    .eq('id', msg.thread_id)
    .maybeSingle();
  if (eThread || !thread) return json({ ok: false, error: 'THREAD_NOT_FOUND' }, 404);

  const { data: cfgRow } = await admin
    .from('instagram_api_config')
    .select('ig_business_account_id, page_access_token, is_active')
    .eq('id', 1)
    .maybeSingle();
  const cfg = (cfgRow as IgConfig | null) ?? null;

  if (!cfg?.page_access_token) return json({ ok: false, error: 'CONFIG_MISSING' }, 500);
  if (!cfg.is_active) return json({ ok: false, error: 'INTEGRATION_INACTIVE' }, 400);

  try {
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
      const err = data?.error ?? {};
      await admin
        .from('instagram_messages')
        .update({
          status: 'failed',
          error_code: String(err?.code ?? r.status),
          error_message: err?.message ?? JSON.stringify(data),
        })
        .eq('id', msg.id);
      return json(
        {
          ok: false,
          error: 'IG_SEND_FAILED',
          provider_code: err?.code ?? null,
          details: err?.message ?? JSON.stringify(data),
        },
        502,
      );
    }

    const igMessageId: string | null = data?.message_id ?? null;

    await admin
      .from('instagram_messages')
      .update({
        status: 'sent',
        ig_message_id: igMessageId,
      })
      .eq('id', msg.id);

    const threadPatch: Record<string, unknown> = {
      last_customer_message_at: null, // seller replied → clear unanswered marker
    };
    if (!thread.first_seller_response_at) {
      threadPatch.first_seller_response_at = new Date().toISOString();
    }
    await admin.from('instagram_threads').update(threadPatch).eq('id', msg.thread_id);

    return json({ ok: true, ig_message_id: igMessageId });
  } catch (e: any) {
    await admin
      .from('instagram_messages')
      .update({ status: 'failed', error_message: `fetch: ${e?.message ?? e}` })
      .eq('id', msg.id);
    return json({ ok: false, error: 'FETCH_ERROR', details: String(e?.message ?? e) }, 502);
  }
}
