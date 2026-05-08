import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/api/admin/_requireOwner';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/team?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Возвращает 360°-метрики по всем активным продавцам за период.
 * Бэкенд отдаёт сырые числа, скор-формула считается на клиенте (проще итерировать).
 */

export async function GET(req: Request) {
  const ok = await requireOwner();
  if (!ok.ok) return NextResponse.json({ error: ok.error }, { status: ok.status });

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to) {
    return NextResponse.json({ error: 'from/to required (YYYY-MM-DD)' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc('rpc_employee_360', { p_from: from, p_to: to });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Агрегаты по выходам из POS-приложения за тот же период
  const fromIso = `${from}T00:00:00Z`;
  const toExclusive = new Date(`${to}T23:59:59Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  const toIso = toExclusive.toISOString();

  const { data: focusRaw } = await admin
    .from('pos_focus_events')
    .select('employee_id, duration_seconds')
    .gte('started_at', fromIso)
    .lt('started_at', toIso)
    .not('employee_id', 'is', null)
    .limit(50000);

  const focusByEmp = new Map<number, { count: number; total: number; longest: number }>();
  for (const ev of focusRaw ?? []) {
    const eid = Number((ev as any).employee_id);
    const dur = Number((ev as any).duration_seconds) || 0;
    const cur = focusByEmp.get(eid);
    if (cur) {
      cur.count += 1;
      cur.total += dur;
      if (dur > cur.longest) cur.longest = dur;
    } else {
      focusByEmp.set(eid, { count: 1, total: dur, longest: dur });
    }
  }

  const rows = (data ?? []).map((r: any) => {
    const f = focusByEmp.get(Number(r.employee_id));
    return {
      ...r,
      app_exits_count: f?.count ?? 0,
      app_exits_seconds_total: f?.total ?? 0,
      app_exits_longest_seconds: f?.longest ?? 0,
    };
  });

  // Тянем закэшированные AI-комментарии за тот же период
  const { data: cached } = await admin
    .from('team_ai_commentary')
    .select('employee_id, llm_model, summary, created_at')
    .eq('period_from', from)
    .eq('period_to', to)
    .order('created_at', { ascending: false });

  const commentaryByEmp: Record<number, Array<{ model: string; summary: string; created_at: string }>> = {};
  for (const r of cached ?? []) {
    const eid = Number((r as any).employee_id);
    (commentaryByEmp[eid] ??= []).push({
      model: (r as any).llm_model,
      summary: (r as any).summary,
      created_at: (r as any).created_at,
    });
  }

  return NextResponse.json({
    ok: true,
    from,
    to,
    rows,
    commentary: commentaryByEmp,
  });
}
