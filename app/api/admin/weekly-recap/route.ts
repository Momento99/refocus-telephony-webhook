import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { generateBranchRecap, generatePeriodRecap, monthEnd } from '@/lib/weeklyRecap';
import { isValidModel } from '@/lib/llmAnalyze';

export const runtime = 'nodejs';
export const maxDuration = 120;

const sameDayLastYear = (d: string) => {
  const dt = new Date(d + 'T00:00:00Z');
  dt.setUTCFullYear(dt.getUTCFullYear() - 1);
  return dt.toISOString().slice(0, 10);
};
const firstOfMonth = (d: string) => d.slice(0, 7) + '-01';
const prevMonthFirst = (firstDay: string) => {
  const dt = new Date(firstDay + 'T00:00:00Z');
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
};

// Разбор по филиалам. period: week (по умолч., полный недельный с сезоном/погодой/планом)
// | month | year | since_open (итоги периода через admin_period_by_branch).
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const model = isValidModel(body.model) ? body.model : undefined;
    const sb = getSupabaseAdmin();
    const period: string = body.period || 'week';
    const anchor = body.anchor ? String(body.anchor).slice(0, 10) : body.week ? String(body.week).slice(0, 10) : undefined;
    const today = new Date().toISOString().slice(0, 10);

    let data: any;
    if (period === 'week') {
      data = await generateBranchRecap(sb, { week: anchor, model });
    } else if (period === 'month') {
      const from = firstOfMonth(anchor || today);
      const to = monthEnd(from);
      const prevFrom = prevMonthFirst(from);
      data = await generatePeriodRecap(sb, { from, to, prevFrom, prevTo: monthEnd(prevFrom), label: `месяц ${from.slice(0, 7)}`, model, planMonth: from });
    } else if (period === 'year') {
      const to = today;
      const from = sameDayLastYear(to);
      data = await generatePeriodRecap(sb, { from, to, prevFrom: sameDayLastYear(from), prevTo: from, label: 'год', model });
    } else if (period === 'since_open') {
      data = await generatePeriodRecap(sb, { from: '2024-01-01', to: today, label: 'с открытия', model });
    } else {
      return NextResponse.json({ error: `Неизвестный период: ${period}` }, { status: 400 });
    }

    // Сохраняем генерацию в историю (чтобы открыть позже без повторной генерации). Сбой не ломает ответ.
    try {
      const { data: run } = await sb
        .from('recap_runs')
        .insert({
          kind: 'group',
          period,
          period_from: data.week ?? null,
          period_to: data.week_end ?? null,
          label: data.period_label ?? (period === 'week' ? 'неделя' : period),
          model: data.llm?.model ?? null,
          cost_usd: data.llm?.cost_usd ?? null,
          payload: data,
        })
        .select('id, created_at')
        .single();
      if (run) data = { ...data, run_id: run.id, run_created_at: run.created_at };
    } catch (e) {
      console.error('recap_runs insert (group) failed:', e);
    }

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
