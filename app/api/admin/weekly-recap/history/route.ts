import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireOwner } from '@/app/api/admin/_requireOwner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// История генераций «Субботнего разбора».
//  GET            → список последних генераций (без payload, лёгкий).
//  GET ?id=<uuid> → одна генерация целиком (payload для повторного рендера, без новой генерации).
export async function GET(req: Request) {
  const gate = await requireOwner();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const sb = getSupabaseAdmin();
  const id = new URL(req.url).searchParams.get('id');

  if (id) {
    const { data, error } = await sb
      .from('recap_runs')
      .select('id, kind, period, period_from, period_to, label, model, cost_usd, created_at, payload')
      .eq('id', id)
      .single();
    if (error || !data) return NextResponse.json({ error: error?.message || 'Не найдено' }, { status: 404 });
    return NextResponse.json(data);
  }

  const { data, error } = await sb
    .from('recap_runs')
    .select('id, kind, period, period_from, period_to, label, model, cost_usd, created_at')
    .eq('kind', 'employees')
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Итог за всё время — по тем же «employees»-генерациям, что и список (иначе счётчик не сходится).
  const { data: allCosts } = await sb.from('recap_runs').select('cost_usd').eq('kind', 'employees');
  const total_cost_usd = (allCosts || []).reduce((s: number, r: any) => s + Number(r.cost_usd || 0), 0);
  return NextResponse.json({ runs: data || [], total: { count: (allCosts || []).length, cost_usd: total_cost_usd } });
}
