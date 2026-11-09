import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { runWeatherSync } from '@/lib/weatherSync';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Ежедневная синхронизация погоды (Vercel cron, 02:00 UTC = 08:00 Бишкек).
// ?mode=backfill[&from=YYYY-MM-DD] — разовый бэкафилл всей истории + норм.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  const isVercelCron = req.headers.get('x-vercel-cron');
  if (secret) {
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  } else if (!isVercelCron) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') === 'backfill' ? 'backfill' : 'ongoing';
  const historyStart = url.searchParams.get('from') || undefined;
  try {
    const r = await runWeatherSync(getSupabaseAdmin(), { mode, historyStart });
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
