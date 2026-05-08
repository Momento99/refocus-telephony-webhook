import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/api/admin/_requireOwner';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/team/[id]?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Детальная информация по сотруднику за период для drawer'а:
 *   - базовая строка из rpc_employee_360
 *   - аудио-чанки (последние 10) с оценками
 *   - худшие/последние WA диалоги
 *   - худшие/последние IG диалоги
 *   - заказы за период
 *   - штрафы/бонусы (payroll_adjustments)
 *   - feedback (если Tokmok)
 *   - кэшированные AI-комментарии
 */

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const ok = await requireOwner();
  if (!ok.ok) return NextResponse.json({ error: ok.error }, { status: ok.status });

  const { id } = await ctx.params;
  const employeeId = Number(id);
  if (!Number.isFinite(employeeId)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to) return NextResponse.json({ error: 'from/to required' }, { status: 400 });

  const fromIso = `${from}T00:00:00Z`;
  const toExclusive = new Date(`${to}T23:59:59Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  const toIso = toExclusive.toISOString();

  const admin = getSupabaseAdmin();

  const [
    metricsR,
    employeeR,
    audioR,
    waQualityR,
    igQualityR,
    ordersR,
    adjustmentsR,
    feedbackDailyR,
    feedbackWeeklyR,
    commentaryR,
    focusR,
  ] = await Promise.all([
    admin.rpc('rpc_employee_360', { p_from: from, p_to: to }),
    admin.from('employees').select('id, full_name, role, branch_id, phone, login').eq('id', employeeId).maybeSingle(),
    admin.rpc('rpc_audio_chunks_by_employee', {
      p_employee_id: employeeId,
      p_from: from,
      p_to: to,
      p_limit: 15,
    }),
    admin
      .from('whatsapp_thread_quality')
      .select('id, thread_id, score, verdict, summary, worst_reply, issues, created_at')
      .eq('employee_id', employeeId)
      .gte('created_at', fromIso)
      .lt('created_at', toIso)
      .order('created_at', { ascending: false })
      .limit(15),
    admin
      .from('instagram_thread_quality')
      .select('id, thread_id, score, verdict, summary, worst_reply, issues, created_at')
      .eq('employee_id', employeeId)
      .gte('created_at', fromIso)
      .lt('created_at', toIso)
      .order('created_at', { ascending: false })
      .limit(15),
    admin
      .from('orders')
      .select('id, order_no, total_amount, created_at, status, customer_first_name, customer_last_name')
      .eq('seller_employee_id', employeeId)
      .eq('is_deleted', false)
      .gte('created_at', fromIso)
      .lt('created_at', toIso)
      .order('created_at', { ascending: false })
      .limit(30),
    admin
      .from('payroll_adjustments')
      .select('id, period, amount, kind, reason, created_at')
      .eq('employee_id', employeeId)
      .gte('period', from)
      .lte('period', to)
      .order('period', { ascending: false }),
    admin
      .from('feedback_daily_responses')
      .select('id, day, mood, answer_text, extra_text, submitted_at')
      .eq('employee_id', employeeId)
      .gte('day', from)
      .lte('day', to)
      .order('day', { ascending: false })
      .limit(20),
    admin
      .from('feedback_weekly_responses')
      .select('id, week_start, mood, week_text, helped_text, submitted_at')
      .eq('employee_id', employeeId)
      .gte('week_start', from)
      .lte('week_start', to)
      .order('week_start', { ascending: false })
      .limit(10),
    admin
      .from('team_ai_commentary')
      .select('id, llm_model, summary, input_metrics, created_at')
      .eq('employee_id', employeeId)
      .eq('period_from', from)
      .eq('period_to', to)
      .order('created_at', { ascending: false }),
    admin
      .from('pos_focus_events')
      .select('id, terminal_code, event_kind, started_at, ended_at, duration_seconds')
      .eq('employee_id', employeeId)
      .gte('started_at', fromIso)
      .lt('started_at', toIso)
      .order('started_at', { ascending: false })
      .limit(50),
  ]);

  const metrics = (metricsR.data ?? []).find((r: any) => Number(r.employee_id) === employeeId) ?? null;

  // focus_events ограничен последними 50 для отображения. Точные агрегаты по
  // всему периоду уже считает /api/admin/team (route.ts) и кладёт в Row;
  // карточка/drawer берут счётчики из row.app_exits_*, поэтому здесь дублировать
  // подсчёт не нужно.
  const focusEvents = (focusR.data as any[]) ?? [];

  return NextResponse.json({
    ok: true,
    employee: employeeR.data ?? null,
    metrics,
    audio: audioR.data ?? [],
    wa_quality: waQualityR.data ?? [],
    ig_quality: igQualityR.data ?? [],
    orders: ordersR.data ?? [],
    adjustments: adjustmentsR.data ?? [],
    feedback_daily: feedbackDailyR.data ?? [],
    feedback_weekly: feedbackWeeklyR.data ?? [],
    commentary: commentaryR.data ?? [],
    focus_events: focusEvents,
  });
}
