import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { generateEmployeeGrowth } from '@/lib/weeklyRecap';
import { isValidModel } from '@/lib/llmAnalyze';
import { requireOwner } from '@/app/api/admin/_requireOwner';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Личные заметки «что подтянуть» по сотрудникам (владелец шлёт каждому в личку).
export async function POST(req: Request) {
  try {
    const gate = await requireOwner();
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
    const body = await req.json().catch(() => ({} as any));
    const model = isValidModel(body.model) ? body.model : undefined;
    const period = body.period === 'month' || body.period === 'all' ? body.period : 'week';
    const sb = getSupabaseAdmin();
    let data: any = await generateEmployeeGrowth(sb, {
      week: body.week ? String(body.week) : undefined,
      period,
      model,
    });

    // Сохраняем в историю генераций. Сбой не ломает ответ.
    try {
      const empCount = (data.branches || []).reduce((s: number, b: any) => s + (b.employees?.length || 0), 0);
      const { data: run } = await sb
        .from('recap_runs')
        .insert({
          kind: 'employees',
          period: data.period ?? 'week',
          period_from: data.week ?? null,
          period_to: data.week_end ?? null,
          label: `личные отчёты · ${data.period_label ?? ''} · ${empCount} сотр.`,
          model: data.llm?.model ?? null,
          cost_usd: data.llm?.cost_usd ?? null,
          payload: data,
        })
        .select('id, created_at')
        .single();
      if (run) data = { ...data, run_id: run.id, run_created_at: run.created_at };
    } catch (e) {
      console.error('recap_runs insert (employees) failed:', e);
    }

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
