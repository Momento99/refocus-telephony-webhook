import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { sendPendingWhatsappText } from '@/lib/whatsappSend';

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
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Pos-Session-Id, X-Pos-Client-Uuid, X-Terminal-Code',
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

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const messageId = typeof body?.message_id === 'string' ? body.message_id : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId)) {
    return json({ ok: false, error: 'BAD_INPUT' }, 400);
  }
  const outcome = await sendPendingWhatsappText(getSupabaseAdmin(), messageId);
  return json(outcome.body, outcome.httpStatus);
}
