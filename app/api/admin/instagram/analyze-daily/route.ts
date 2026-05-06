import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Ежедневный AI-анализ Instagram диалогов за вчерашний день (Asia/Bishkek).
 * Модель: Claude Haiku 4.5 (~$0.005 за 1 диалог).
 *
 * Vercel Cron: см. vercel.json
 * Security: header `Authorization: Bearer <CRON_SECRET>`
 */

const MODEL = 'claude-haiku-4-5';
const TZ = 'Asia/Bishkek';

function authOk(req: Request): boolean {
  const auth = req.headers.get('authorization') ?? '';
  const cron = process.env.CRON_SECRET;
  if (!cron) return false;
  return auth === `Bearer ${cron}`;
}

function yesterdayInBishkek(): string {
  const now = new Date();
  const todayBishkek = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const [y, m, d] = todayBishkek.split('-').map(Number);
  const yesterday = new Date(Date.UTC(y, m - 1, d));
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  if (!authOk(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const day = yesterdayInBishkek();

  const origin =
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  const r = await fetch(`${origin}/api/admin/instagram/analyze`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-cron-secret': process.env.CRON_SECRET ?? '',
    },
    body: JSON.stringify({
      period_from: day,
      period_to: day,
      branch_id: null,
      model: MODEL,
    }),
  });

  const data = await r.json().catch(() => ({}));
  return NextResponse.json({ ok: r.ok, status: r.status, day, model: MODEL, data });
}
