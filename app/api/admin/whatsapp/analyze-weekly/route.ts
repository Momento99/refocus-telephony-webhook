import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Еженедельный AI-анализ WhatsApp диалогов.
 * Вызывается Vercel Cron по расписанию — см. vercel.json.
 *
 * Security: Vercel Cron шлёт `authorization: Bearer <CRON_SECRET>`.
 */

function authOk(req: Request): boolean {
  const auth = req.headers.get('authorization') ?? '';
  const cron = process.env.CRON_SECRET;
  if (!cron) return false;
  return auth === `Bearer ${cron}`;
}

function lastWeekRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export async function GET(req: Request) {
  if (!authOk(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { from, to } = lastWeekRange();

  const origin =
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  const r = await fetch(`${origin}/api/admin/whatsapp/analyze`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-cron-secret': process.env.CRON_SECRET ?? '',
    },
    body: JSON.stringify({
      period_from: from,
      period_to: to,
      branch_id: null,
    }),
  });
  const data = await r.json().catch(() => ({}));
  return NextResponse.json({ ok: r.ok, status: r.status, data });
}
