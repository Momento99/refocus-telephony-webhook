import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { generateBranchRecap } from '@/lib/weeklyRecap';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Субботний автозапуск (Vercel cron, сб 12:00 UTC = 18:00 Бишкек): заранее готовит
// позитивный разбор и сохраняет снапшот, чтобы владельцу осталось проверить и запостить.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  const isVercelCron = req.headers.get('x-vercel-cron');
  if (secret) {
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  } else if (!isVercelCron) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const data = await generateBranchRecap(getSupabaseAdmin(), { persist: true });
    return NextResponse.json({ ok: true, week: data.week, branches: data.items.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
