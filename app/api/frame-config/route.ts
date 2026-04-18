import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

/** GET /api/frame-config?branch_id=5 — вернуть frame_total_slots из БД */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const branchId = Number(url.searchParams.get('branch_id'));
    if (!branchId) {
      return NextResponse.json({ ok: false, error: 'branch_id required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('branches')
      .select('id, name, frame_total_slots')
      .eq('id', branchId)
      .maybeSingle();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ ok: false, error: 'branch not found' }, { status: 404 });

    return NextResponse.json({
      ok: true,
      branch_id: data.id,
      branch_name: data.name,
      frame_total_slots: data.frame_total_slots ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'server error' }, { status: 500 });
  }
}

/** POST /api/frame-config  { branch_id, frame_total_slots } */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const branchId = Number(body?.branch_id);
    const slots = Number(body?.frame_total_slots);

    if (!branchId) {
      return NextResponse.json({ ok: false, error: 'branch_id required' }, { status: 400 });
    }
    if (!Number.isFinite(slots) || slots <= 0 || slots > 10000) {
      return NextResponse.json({ ok: false, error: 'frame_total_slots must be 1..10000' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('branches')
      .update({ frame_total_slots: Math.round(slots) })
      .eq('id', branchId);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, frame_total_slots: Math.round(slots) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'server error' }, { status: 500 });
  }
}
