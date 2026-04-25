import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Aftercare follow-up enqueue worker.
 *
 * Triggered by Vercel cron once per day (see vercel.json).
 * Calls the SQL function enqueue_whatsapp_aftercare() which:
 *   • finds DELIVERED orders from exactly 3 / 12 days ago (Asia/Bishkek tz);
 *   • dedupes per (customer, delivery_date) — same-day multi-pair purchases
 *     produce a single message of each kind, not one per pair;
 *   • inserts into whatsapp_followup_queue with NOT EXISTS guard against
 *     re-running on the same day.
 *
 * The existing /api/admin/whatsapp/scheduler (every 5 min) picks up new
 * queue entries and dispatches them via Meta Cloud API.
 *
 * Auth: bearer CRON_SECRET or WHATSAPP_CRON_SECRET (matches scheduler).
 */

function assertAuth(req: Request): string | null {
  const ours = process.env.WHATSAPP_CRON_SECRET;
  const vercel = process.env.CRON_SECRET;
  if (!ours && !vercel) return 'WHATSAPP_CRON_SECRET or CRON_SECRET env not set';
  const hdr = (req.headers.get('authorization') ?? '').toLowerCase();
  if (ours && hdr === `bearer ${ours}`.toLowerCase()) return null;
  if (vercel && hdr === `bearer ${vercel}`.toLowerCase()) return null;
  return 'unauthorized';
}

async function run(req: Request) {
  const authErr = assertAuth(req);
  if (authErr) return NextResponse.json({ error: authErr }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc('enqueue_whatsapp_aftercare');
  if (error) {
    console.error('[aftercare enqueue] rpc failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...((data as Record<string, unknown>) ?? {}) });
}

export async function POST(req: Request) {
  return run(req);
}

export async function GET(req: Request) {
  return run(req);
}
