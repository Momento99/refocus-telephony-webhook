import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/api/admin/_requireOwner';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { runLlmAnalysis, isValidModel, type LlmModelId } from '@/lib/llmAnalyze';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/team/ai-comment
 * Body: { employee_id, from, to, model?: LlmModelId }
 * Генерирует короткий AI-комментарий по метрикам сотрудника за период.
 * Кэш: team_ai_commentary (UNIQUE по employee_id + period + model).
 * При совпадении кэшированной записи возвращает её без нового вызова LLM.
 */

const SYSTEM_PROMPT = `Ты — бизнес-аналитик в сети оптик Refocus.
Твоя задача — дать короткий содержательный комментарий по продавцу за период на основе его метрик.

Формат ответа (строго, без markdown-заголовков, на русском):
**Сильные стороны:** 1–2 конкретные сильные стороны с цифрами (или напиши "нет данных" если метрик мало).
**Зоны роста:** 1–2 конкретные проблемы с цифрами и влиянием на бизнес.
**Действие:** 1 конкретное действие для руководителя на ближайшую неделю.

Будь честным и прямым. Не хвали за низкие показатели. Не выдумывай то, чего нет в метриках.
Если данных очень мало (меньше 3 заказов и 0 диалогов), напиши честно «Недостаточно данных для оценки».`;

function buildUserPrompt(m: any, employeeName: string, branchName: string, from: string, to: string): string {
  const lines: string[] = [];
  lines.push(`Продавец: ${employeeName}`);
  lines.push(`Филиал: ${branchName}`);
  lines.push(`Период: ${from} — ${to}`);
  lines.push('');
  lines.push('МЕТРИКИ ЗА ПЕРИОД:');
  lines.push('');
  lines.push('Продажи:');
  lines.push(`  заказов: ${m.orders_count}, выручка: ${Number(m.revenue_total).toLocaleString('ru-RU')} KGS, средний чек: ${Number(m.avg_check).toLocaleString('ru-RU')} KGS`);
  lines.push(`  оправ продано: ${m.frame_items_count}, линз: ${m.lens_items_count}`);
  lines.push('');
  lines.push('Сервис (качество коммуникации):');
  if (m.audio_chunks_count > 0) {
    lines.push(`  аудио QA: ${m.audio_chunks_count} записей, средний балл: ${m.audio_avg_score ?? 'нет'} / 10`);
    if (m.audio_rude_count > 0) lines.push(`  грубость замечена в ${m.audio_rude_count} записях`);
    if (m.audio_pushy_count > 0) lines.push(`  давление на клиента: ${m.audio_pushy_count} записей`);
  } else {
    lines.push(`  аудио QA: нет записей`);
  }
  lines.push(`  WhatsApp: ${m.wa_threads_count} диалогов, проанализировано ${m.wa_analyzed_count}, средний балл: ${m.wa_avg_score ?? 'нет'} / 10${m.wa_critical_count > 0 ? `, критичных (<5): ${m.wa_critical_count}` : ''}`);
  lines.push(`  Instagram: ${m.ig_threads_count} диалогов, проанализировано ${m.ig_analyzed_count}, средний балл: ${m.ig_avg_score ?? 'нет'} / 10${m.ig_critical_count > 0 ? `, критичных: ${m.ig_critical_count}` : ''}`);
  lines.push('');
  lines.push('Дисциплина:');
  lines.push(`  смен: ${m.sessions_count}, часов отработано: ${m.hours_worked}`);
  if (m.late_minutes_total > 0) lines.push(`  суммарных опозданий: ${m.late_minutes_total} мин`);
  if (m.penalty_count > 0) lines.push(`  штрафов: ${m.penalty_count} (на ${m.penalty_minutes} мин)`);
  if (Number(m.fine_amount) > 0) lines.push(`  денежные штрафы в ведомости: ${Number(m.fine_amount).toLocaleString('ru-RU')} KGS`);
  if (Number(m.bonus_amount) > 0) lines.push(`  премии в ведомости: ${Number(m.bonus_amount).toLocaleString('ru-RU')} KGS`);
  if (m.is_voice_pilot && (m.feedback_daily_count > 0 || m.feedback_weekly_count > 0)) {
    lines.push('');
    lines.push('Самочувствие (voice-пилот Токмок):');
    lines.push(`  дневных ответов: ${m.feedback_daily_count}, недельных: ${m.feedback_weekly_count}, средний mood: ${m.feedback_avg_mood ?? 'нет'} / 5`);
  }
  return lines.join('\n');
}

export async function POST(req: Request) {
  const ok = await requireOwner();
  if (!ok.ok) return NextResponse.json({ error: ok.error }, { status: ok.status });

  const body = await req.json().catch(() => ({}));
  const employeeId = Number(body?.employee_id);
  const from: string | undefined = body?.from;
  const to: string | undefined = body?.to;
  const modelRaw = body?.model ?? 'claude-haiku-4-5';
  const force = Boolean(body?.force);

  if (!Number.isFinite(employeeId) || !from || !to) {
    return NextResponse.json({ error: 'employee_id/from/to required' }, { status: 400 });
  }
  if (!isValidModel(modelRaw)) {
    return NextResponse.json({ error: 'invalid model' }, { status: 400 });
  }
  const model: LlmModelId = modelRaw;

  const admin = getSupabaseAdmin();

  // Check cache
  if (!force) {
    const { data: cached } = await admin
      .from('team_ai_commentary')
      .select('id, summary, llm_model, created_at, input_metrics')
      .eq('employee_id', employeeId)
      .eq('period_from', from)
      .eq('period_to', to)
      .eq('llm_model', model)
      .maybeSingle();
    if (cached) {
      return NextResponse.json({ ok: true, cached: true, ...cached });
    }
  }

  // Load metrics + employee
  const [metricsR, empR] = await Promise.all([
    admin.rpc('rpc_employee_360', { p_from: from, p_to: to }),
    admin.from('employees').select('id, full_name, branch_id, branches(name)').eq('id', employeeId).maybeSingle(),
  ]);

  const m = (metricsR.data ?? []).find((r: any) => Number(r.employee_id) === employeeId);
  if (!m) return NextResponse.json({ error: 'employee not found in period' }, { status: 404 });

  const employeeName = (empR.data as any)?.full_name ?? `#${employeeId}`;
  const branchName = (empR.data as any)?.branches?.name ?? '—';

  const userPrompt = buildUserPrompt(m, employeeName, branchName, from, to);

  let llmResult;
  try {
    llmResult = await runLlmAnalysis(model, SYSTEM_PROMPT, userPrompt);
  } catch (e: any) {
    return NextResponse.json({ error: `LLM error: ${e?.message ?? 'unknown'}` }, { status: 502 });
  }

  const { data: saved, error: saveErr } = await admin
    .from('team_ai_commentary')
    .upsert(
      {
        employee_id: employeeId,
        period_from: from,
        period_to: to,
        llm_model: model,
        summary: llmResult.content,
        input_metrics: m,
      },
      { onConflict: 'employee_id,period_from,period_to,llm_model' },
    )
    .select()
    .single();

  if (saveErr) {
    return NextResponse.json({ error: saveErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    cached: false,
    ...saved,
    tokens: { input: llmResult.input_tokens, output: llmResult.output_tokens },
    cost_usd: llmResult.cost_usd,
    duration_ms: llmResult.duration_ms,
  });
}
