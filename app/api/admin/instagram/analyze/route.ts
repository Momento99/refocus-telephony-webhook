import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getCurrentUser } from '@/lib/getUserRole';
import { runLlmAnalysis, isValidModel, type LlmModelId } from '@/lib/llmAnalyze';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const DEFAULT_MODEL: LlmModelId = 'gemma3:12b';
const PROMPT_VERSION = 'ig-v2-2026-04';

type Guard =
  | { ok: true; userId: string | null; cron: boolean }
  | { ok: false; status: number; msg: string };

async function assertCaller(req: Request): Promise<Guard> {
  const auth = req.headers.get('authorization') || req.headers.get('x-cron-secret');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth && (auth === `Bearer ${cronSecret}` || auth === cronSecret)) {
    return { ok: true, userId: null, cron: true };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401, msg: 'Не авторизован' };
  const role = (user.app_metadata?.role as string) || 'seller';
  if (role !== 'owner') return { ok: false, status: 403, msg: 'Только для владельца' };
  return { ok: true, userId: user.id, cron: false };
}

type ThreadData = {
  id: string;
  thread_id: string;
  branch_id: number;
  branch_name: string;
  customer_name: string;
  ig_username: string | null;
  seller_employee_id: number | null;
  first_customer_message_at: string | null;
  first_seller_response_at: string | null;
  response_minutes: number | null;
  sla_breached: boolean;
  farewell_sent_at: string | null;
  segment_label: string | null;
  segment_index: number;
  total_segments: number;
  messages: Array<{ dir: 'in' | 'out'; text: string; type: string; branch_id: number | null; employee_id: number | null }>;
};

type PerThreadScore = {
  idx: number;
  score: number;
  verdict: 'good' | 'ok' | 'bad';
  issues: string[];
  summary: string;
  worst_reply?: string;
};

function formatPromptData(threads: ThreadData[]): string {
  return threads
    .map((t, idx) => {
      const segmentNote =
        t.total_segments > 1
          ? `Сегмент ${t.segment_index}/${t.total_segments}${t.segment_label ? ` (${t.segment_label})` : ''}`
          : '';
      const meta = [
        `№${idx + 1}`,
        segmentNote,
        `Филиал: ${t.branch_name}`,
        `Клиент: ${t.customer_name}`,
        t.ig_username ? `IG: @${t.ig_username}` : '',
        t.response_minutes != null ? `Время ответа: ${t.response_minutes.toFixed(1)} мин` : '',
        t.sla_breached ? 'SLA НАРУШЕН' : '',
        t.seller_employee_id != null ? `Продавец ID: ${t.seller_employee_id}` : '',
        t.farewell_sent_at ? 'ПРОЩАНИЕ ОТПРАВЛЕНО ПРОДАВЦОМ — не требовать ответа на короткие ack после него' : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const dialog = t.messages
        .map((m) => `[${m.dir === 'in' ? 'Клиент' : 'Продавец'}] ${m.text}`)
        .join('\n');
      return `=== ${meta} ===\n${dialog || '(нет сообщений)'}`;
    })
    .join('\n\n');
}

function splitThreadIntoSegments(
  base: Omit<ThreadData, 'segment_index' | 'total_segments' | 'segment_label'>,
  branchMap: Map<number, string>,
): ThreadData[] {
  if (!base.messages || base.messages.length === 0) {
    return [{ ...base, segment_index: 1, total_segments: 1, segment_label: null }];
  }
  type Group = { branch_id: number; messages: ThreadData['messages'] };
  const groups: Group[] = [];
  for (const m of base.messages) {
    const b = m.branch_id ?? base.branch_id;
    const last = groups[groups.length - 1];
    if (!last || last.branch_id !== b) groups.push({ branch_id: b, messages: [m] });
    else last.messages.push(m);
  }
  const total = groups.length;
  return groups.map((g, i) => {
    const firstOut = g.messages.find((m) => m.dir === 'out');
    const sellerEmpId = firstOut?.employee_id ?? base.seller_employee_id;
    const branchName = branchMap.get(g.branch_id) ?? `#${g.branch_id}`;
    const label =
      total === 1
        ? null
        : i === 0
          ? 'Начальный филиал'
          : `После передачи из ${branchMap.get(groups[i - 1].branch_id) ?? `#${groups[i - 1].branch_id}`}`;
    return {
      ...base,
      id: `${base.thread_id}#${i + 1}`,
      branch_id: g.branch_id,
      branch_name: branchName,
      seller_employee_id: sellerEmpId,
      messages: g.messages,
      segment_index: i + 1,
      total_segments: total,
      segment_label: label,
    };
  });
}

const SYSTEM_PROMPT = `Ты аналитик качества клиентской поддержки сети оптик Refocus. Читаешь переписки продавцов с клиентами в Instagram Direct и даёшь директору честный анализ.

Специфика Instagram: клиенты чаще спрашивают про наличие оправ, цены, записываются на примерку — обычно на этапе ДО покупки. Тон может быть более неформальным, но грамотность и скорость всё равно важны.

Критерии оценки диалога (0–10):
- Скорость ответа (SLA 10 минут)
- Эмпатия и тон
- Решение вопроса (помог ли — записал, дал цену, отправил фото)
- Грамотность и профессионализм

Пиши на русском. Факты, не вата.

ВАЖНО — правило прощания: если в метаданных диалога отмечено «ПРОЩАНИЕ ОТПРАВЛЕНО ПРОДАВЦОМ», значит продавец корректно завершил разговор шаблонной вежливой фразой. Короткие ответы клиента после этого («спасибо», «хорошего дня», «до свидания», «ок», эмодзи) — естественное завершение, продавец НЕ обязан на них отвечать. НЕ снижай оценку и НЕ выставляй issues slow_reply/no_reply за такие «пинг-понги вежливости».

ВАЖНО: верни ДВЕ секции в указанном формате:

SECTION 1: JSON (строго валидный JSON)
{
  "per_thread": [
    {
      "idx": 1,
      "score": 7.5,
      "verdict": "good" | "ok" | "bad",
      "issues": ["slow_reply", "cold_tone"],
      "summary": "одно предложение",
      "worst_reply": "плохая фраза продавца, если есть"
    }
  ]
}
Коды issues (фиксированный словарь):
- slow_reply — медленный ответ
- no_reply — продавец не ответил
- cold_tone — сухой тон
- no_empathy — нет эмпатии
- unprofessional — грубость/неграмотность
- unresolved — вопрос не решён
- wrong_info — неверная информация
- template_only — только шаблоны, нет живого общения
- missed_sale — упустил возможность записать на примерку / продать
verdict: good если ≥8, ok если 5–8, bad если <5.

SECTION 2: MARKDOWN (строго в порядке):
1. **Краткая сводка** (3-5 предложений)
2. **Рейтинг филиалов**
3. **Топ-3 вопроса клиентов**
4. **Что работает хорошо**
5. **Что работает плохо**
6. **Рекомендации** (3-5 шагов)

Разделители:
<<<JSON>>>
{ ... json ... }
<<<MARKDOWN>>>
... markdown ...
<<<END>>>

Без воды.`;

function parseStructured(raw: string, threadsLen: number) {
  const jsonMatch = raw.match(/<<<JSON>>>([\s\S]*?)<<<MARKDOWN>>>/);
  const mdMatch = raw.match(/<<<MARKDOWN>>>([\s\S]*?)<<<END>>>/);
  let per_thread: PerThreadScore[] = [];
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      const rows = Array.isArray(parsed?.per_thread) ? parsed.per_thread : [];
      per_thread = rows
        .map((r: any) => ({
          idx: Number(r.idx),
          score: Math.max(0, Math.min(10, Number(r.score) || 0)),
          verdict: (['good', 'ok', 'bad'].includes(r.verdict) ? r.verdict : 'ok') as
            | 'good'
            | 'ok'
            | 'bad',
          issues: Array.isArray(r.issues) ? r.issues.filter((x: any) => typeof x === 'string') : [],
          summary: typeof r.summary === 'string' ? r.summary : '',
          worst_reply: typeof r.worst_reply === 'string' ? r.worst_reply : undefined,
        }))
        .filter((r: PerThreadScore) => r.idx >= 1 && r.idx <= threadsLen);
    } catch {
      per_thread = [];
    }
  }
  const markdown = mdMatch ? mdMatch[1].trim() : raw.trim();
  return { markdown, per_thread };
}

export async function POST(req: Request) {
  const guard = await assertCaller(req);
  if (!guard.ok) return NextResponse.json({ error: guard.msg }, { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const periodFrom: string | undefined = body?.period_from;
  const periodTo: string | undefined = body?.period_to;
  const branchIdFilter: number | null = body?.branch_id ?? null;
  const model: LlmModelId = isValidModel(body?.model) ? body.model : DEFAULT_MODEL;

  if (!periodFrom || !periodTo) {
    return NextResponse.json({ error: 'period_from и period_to обязательны' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const { data: report, error: eReport } = await admin
    .from('instagram_quality_reports')
    .insert({
      period_from: periodFrom,
      period_to: periodTo,
      branch_id: branchIdFilter,
      requested_by: guard.userId,
      llm_model: model,
      prompt_version: PROMPT_VERSION,
      status: 'running',
    })
    .select('id')
    .single();
  if (eReport || !report) {
    return NextResponse.json({ error: eReport?.message ?? 'cannot create report row' }, { status: 500 });
  }
  const reportId = report.id as string;

  try {
    let threadsQ = admin
      .from('instagram_threads')
      .select(`
        id, branch_id, customer_id, order_id, ig_username, display_name,
        assigned_seller_employee_id,
        first_customer_message_at, first_seller_response_at, sla_breached,
        farewell_sent_at,
        customer:customers(first_name, last_name, full_name)
      `)
      .gte('first_customer_message_at', `${periodFrom}T00:00:00Z`)
      .lte('first_customer_message_at', `${periodTo}T23:59:59Z`);
    if (branchIdFilter) threadsQ = threadsQ.eq('branch_id', branchIdFilter);

    const { data: rawThreads, error: eThreads } = await threadsQ;
    if (eThreads) throw eThreads;

    if (!rawThreads || rawThreads.length === 0) {
      await admin
        .from('instagram_quality_reports')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          threads_analyzed: 0,
          report_markdown: 'Нет данных за выбранный период.',
        })
        .eq('id', reportId);
      return NextResponse.json({ ok: true, report_id: reportId, threads: 0 });
    }

    const branchIds = Array.from(new Set(rawThreads.map((t: any) => t.branch_id)));
    const { data: brs } = await admin.from('branches').select('id, name').in('id', branchIds);
    const branchMap = new Map((brs ?? []).map((b: any) => [b.id, b.name]));

    const threadIds = rawThreads.map((t: any) => t.id);
    const { data: msgs } = await admin
      .from('instagram_messages')
      .select('thread_id, direction, body, message_type, created_at, branch_id, employee_id')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: true });

    const msgByThread = new Map<string, any[]>();
    for (const m of msgs ?? []) {
      const arr = msgByThread.get(m.thread_id) ?? [];
      arr.push(m);
      msgByThread.set(m.thread_id, arr);
    }

    const threads: ThreadData[] = rawThreads.flatMap((t: any) => {
      const cust = t.customer;
      const nameParts = [cust?.first_name, cust?.last_name].filter(Boolean);
      const customer_name = nameParts.length
        ? nameParts.join(' ')
        : cust?.full_name ?? t.display_name ?? 'Без имени';
      const respMin =
        t.first_customer_message_at && t.first_seller_response_at
          ? (new Date(t.first_seller_response_at).getTime() -
              new Date(t.first_customer_message_at).getTime()) /
            60000
          : null;
      const threadMsgs = msgByThread.get(t.id) ?? [];
      const base = {
        id: t.id,
        thread_id: t.id,
        branch_id: t.branch_id,
        branch_name: branchMap.get(t.branch_id) ?? `#${t.branch_id}`,
        customer_name,
        ig_username: t.ig_username,
        seller_employee_id: t.assigned_seller_employee_id ?? null,
        first_customer_message_at: t.first_customer_message_at,
        first_seller_response_at: t.first_seller_response_at,
        response_minutes: respMin,
        sla_breached: !!t.sla_breached,
        farewell_sent_at: t.farewell_sent_at ?? null,
        messages: threadMsgs.map((m: any) => ({
          dir: (m.direction === 'inbound' ? 'in' : 'out') as 'in' | 'out',
          text: m.body ?? `[${m.message_type}]`,
          type: m.message_type,
          branch_id: m.branch_id as number | null,
          employee_id: m.employee_id as number | null,
        })),
      };
      return splitThreadIntoSegments(base, branchMap);
    });

    const userPrompt = `Период: ${periodFrom} — ${periodTo}${
      branchIdFilter ? ` (филиал ID: ${branchIdFilter})` : ' (все филиалы)'
    }
Диалогов: ${threads.length}

Данные:

${formatPromptData(threads)}`;

    // Модель-агностик: Ollama (бесплатно) или Anthropic (платно).
    const llm = await runLlmAnalysis(model, SYSTEM_PROMPT, userPrompt);
    const raw = llm.content;
    const parsed = parseStructured(raw, threads.length);

    if (parsed.per_thread.length > 0) {
      const rows = parsed.per_thread.map((p) => {
        const t = threads[p.idx - 1];
        const segSuffix = t.total_segments > 1 ? ` [сегмент ${t.segment_index}/${t.total_segments}]` : '';
        return {
          report_id: reportId,
          thread_id: t.thread_id,
          branch_id: t.branch_id,
          employee_id: t.seller_employee_id,
          score: p.score,
          verdict: p.verdict,
          issues: p.issues,
          summary: p.summary ? p.summary + segSuffix : null,
          worst_reply: p.worst_reply ?? null,
        };
      });
      const { error: eIns } = await admin.from('instagram_thread_quality').insert(rows);
      if (eIns) console.error('instagram_thread_quality insert failed:', eIns.message);
    }

    await admin
      .from('instagram_quality_reports')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        threads_analyzed: threads.length,
        report_markdown: parsed.markdown,
        report_json: {
          usage: {
            input_tokens: llm.input_tokens,
            output_tokens: llm.output_tokens,
            duration_ms: llm.duration_ms,
          },
          model: llm.model,
          provider: llm.provider,
          per_thread_count: parsed.per_thread.length,
        },
        input_tokens: llm.input_tokens || null,
        output_tokens: llm.output_tokens || null,
        cost_usd: llm.cost_usd,
      })
      .eq('id', reportId);

    return NextResponse.json({
      ok: true,
      report_id: reportId,
      threads: threads.length,
      scored: parsed.per_thread.length,
      input_tokens: llm.input_tokens,
      output_tokens: llm.output_tokens,
      cost_usd: llm.cost_usd,
      provider: llm.provider,
      model: llm.model,
      duration_ms: llm.duration_ms,
    });
  } catch (e: any) {
    await admin
      .from('instagram_quality_reports')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: e?.message ?? String(e),
      })
      .eq('id', reportId);
    return NextResponse.json({ error: e?.message ?? 'analyze failed' }, { status: 500 });
  }
}
