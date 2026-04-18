import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { branch_id, period_start, period_end, force } = body || {};
    if (!branch_id || !period_start || !period_end) {
      return NextResponse.json({ ok: false, error: 'branch_id, period_start, period_end required' }, { status: 400 });
    }

    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/feedback-digest`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // service role — чтобы edge-функция не падала на verify_jwt (даже если включён)
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ branch_id, period_start, period_end, force: !!force }),
    });
    const json = await r.json();
    return NextResponse.json({ ok: r.ok, ...json });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'server error' }, { status: 500 });
  }
}
