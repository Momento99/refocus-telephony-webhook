import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireOwner } from '@/app/api/admin/_requireOwner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Вкл/выкл показа разбора на кассе по филиалам (кнопка на странице владельца).
//  GET  → все филиалы + флаг enabled.
//  POST { branch_id, enabled } → upsert.
export async function GET() {
  try {
    const gate = await requireOwner();
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
    const sb = getSupabaseAdmin();
    const [{ data: branches, error: bErr }, { data: act }] = await Promise.all([
      sb.from('branches').select('id, name').neq('id', 18).order('id', { ascending: true }),
      sb.from('recap_pos_activation').select('branch_id, enabled'),
    ]);
    if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
    const enabledBy = new Map((act || []).map((a: any) => [Number(a.branch_id), !!a.enabled]));
    const rows = (branches || []).map((b: any) => ({
      branch_id: Number(b.id),
      name: b.name,
      enabled: enabledBy.get(Number(b.id)) ?? false,
    }));
    // Тест-филиал (18) — отдельной строкой, всегда показывается на кассе (для превью владельца).
    rows.push({ branch_id: 18, name: 'Тестовый филиал', enabled: enabledBy.get(18) ?? true });
    return NextResponse.json({ activation: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireOwner();
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
    const body = await req.json().catch(() => ({} as any));
    const branch_id = Number(body.branch_id);
    if (!branch_id) return NextResponse.json({ error: 'branch_id обязателен' }, { status: 400 });
    const enabled = !!body.enabled;

    const sb = getSupabaseAdmin();
    const { error } = await sb
      .from('recap_pos_activation')
      .upsert({ branch_id, enabled, updated_at: new Date().toISOString() }, { onConflict: 'branch_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ branch_id, enabled });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
