import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getCurrentUser } from '@/lib/getUserRole';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

const MODEL = 'claude-opus-4-7';
const PROMPT_VERSION = 'v1-2026-04';

async function assertOwner() {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, status: 401, msg: 'Не авторизован' };
  const role = (user.app_metadata?.role as string) || 'seller';
  if (role !== 'owner') return { ok: false as const, status: 403, msg: 'Только для владельца' };
  return { ok: true as const, user };
}

type ThreadData = {
  id: string;
  branch_id: number;
  branch_name: string;
  customer_name: string;
  phone: string;
  order_id: number | null;
  order_no: string | null;
  seller_employee_id: number | null;
  first_customer_message_at: string | null;
  first_seller_response_at: string | null;
  response_minutes: number | null;
  sla_breached: boolean;
  messages: Array<{ t: string; dir: 'in' | 'out'; text: string; type: string }>;
};

function formatPromptData(threads: ThreadData[]): string {
  return threads
    .map((t, idx) => {
      const meta = [
        `№${idx + 1}`,
        `Филиал: ${t.branch_name}`,
        `Клиент: ${t.customer_name}`,
        t.order_no ? `Заказ: ${t.order_no}` : '',
        t.response_minutes != null ? `Время ответа: ${t.response_minutes.toFixed(1)} мин` : '',
        t.sla_breached ? 'SLA НАРУШЕН' : '',
        t.seller_employee_id != null ? `Продавец ID: ${t.seller_employee_id}` : '',
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

const SYSTEM_PROMPT = `Ты аналитик качества клиентской поддержки сети оптик Refocus (4 страны: KG/KZ/UZ/RU). Твоя задача — прочитать реальные переписки продавцов с клиентами в WhatsApp после выдачи очков и дать директору честный анализ.

Критерии оценки каждого диалога (шкала 1–10):
- Скорость ответа (важнее всего, SLA 20 минут)
- Эмпатия и тон (тёплый, без холода)
- Решение проблемы (довели ли до результата)
- Грамотность и профессионализм

Пиши на русском. Выдавай факты, не вату. Называй конкретные проблемы и продавцов по их ID (persona-сравнение). Если продавец игнорирует клиента или отвечает формально — пиши прямо.

Формат ответа (строго этот порядок):
1. **Краткая сводка** (3-5 предложений) — общая картина по сети за период.
2. **Рейтинг филиалов** — от лучшего к худшему, с кратким обоснованием.
3. **Топ-3 проблемы клиентов** — что чаще всего их беспокоит после покупки.
4. **Что работает хорошо** — конкретные практики, которые стоит тиражировать.
5. **Что работает плохо** — конкретные паттерны, которые надо устранить.
6. **Рекомендации** — 3-5 действенных шагов для директора на следующий период.

Без воды, без общих фраз, без "важно заметить" и "следует помнить". Говори как консультант, которому доверяют.`;

export async function POST(req: Request) {
  const guard = await assertOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.msg }, { status: guard.status });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY env не задан' }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const periodFrom: string | undefined = body?.period_from;
  const periodTo: string | undefined = body?.period_to;
  const branchIdFilter: number | null = body?.branch_id ?? null;

  if (!periodFrom || !periodTo) {
    return NextResponse.json({ error: 'period_from и period_to обязательны (YYYY-MM-DD)' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Создаём запись отчёта в статусе running
  const { data: report, error: eReport } = await admin
    .from('whatsapp_quality_reports')
    .insert({
      period_from: periodFrom,
      period_to: periodTo,
      branch_id: branchIdFilter,
      requested_by: guard.user.id,
      llm_model: MODEL,
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
    // Загружаем треды за период
    let threadsQ = admin
      .from('whatsapp_threads')
      .select(`
        id, branch_id, customer_id, order_id, phone_number,
        first_customer_message_at, first_seller_response_at, sla_breached,
        customer:customers(first_name, last_name, full_name)
      `)
      .gte('first_customer_message_at', `${periodFrom}T00:00:00Z`)
      .lte('first_customer_message_at', `${periodTo}T23:59:59Z`);
    if (branchIdFilter) threadsQ = threadsQ.eq('branch_id', branchIdFilter);

    const { data: rawThreads, error: eThreads } = await threadsQ;
    if (eThreads) throw eThreads;

    if (!rawThreads || rawThreads.length === 0) {
      await admin
        .from('whatsapp_quality_reports')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          threads_analyzed: 0,
          report_markdown: 'Нет данных за выбранный период.',
        })
        .eq('id', reportId);
      return NextResponse.json({ ok: true, report_id: reportId, threads: 0 });
    }

    // Филиалы (для имён)
    const branchIds = Array.from(new Set(rawThreads.map((t: any) => t.branch_id)));
    const { data: brs } = await admin.from('branches').select('id, name').in('id', branchIds);
    const branchMap = new Map((brs ?? []).map((b: any) => [b.id, b.name]));

    // Заказы (для order_no + продавца)
    const orderIds = rawThreads.map((t: any) => t.order_id).filter(Boolean);
    const { data: orders } = orderIds.length
      ? await admin.from('orders').select('id, order_no, seller_employee_id').in('id', orderIds)
      : { data: [] as any[] };
    const orderMap = new Map((orders ?? []).map((o: any) => [o.id, o]));

    // Сообщения
    const threadIds = rawThreads.map((t: any) => t.id);
    const { data: msgs } = await admin
      .from('whatsapp_messages')
      .select('thread_id, direction, body, message_type, template_name, created_at')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: true });

    const msgByThread = new Map<string, any[]>();
    for (const m of msgs ?? []) {
      const arr = msgByThread.get(m.thread_id) ?? [];
      arr.push(m);
      msgByThread.set(m.thread_id, arr);
    }

    const threads: ThreadData[] = rawThreads.map((t: any) => {
      const cust = t.customer;
      const nameParts = [cust?.first_name, cust?.last_name].filter(Boolean);
      const customer_name = nameParts.length ? nameParts.join(' ') : cust?.full_name ?? 'Без имени';
      const ord = t.order_id ? orderMap.get(t.order_id) : null;
      const respMin =
        t.first_customer_message_at && t.first_seller_response_at
          ? (new Date(t.first_seller_response_at).getTime() -
              new Date(t.first_customer_message_at).getTime()) /
            60000
          : null;
      const threadMsgs = msgByThread.get(t.id) ?? [];
      return {
        id: t.id,
        branch_id: t.branch_id,
        branch_name: branchMap.get(t.branch_id) ?? `#${t.branch_id}`,
        customer_name,
        phone: t.phone_number,
        order_id: t.order_id,
        order_no: ord?.order_no ?? null,
        seller_employee_id: ord?.seller_employee_id ?? null,
        first_customer_message_at: t.first_customer_message_at,
        first_seller_response_at: t.first_seller_response_at,
        response_minutes: respMin,
        sla_breached: !!t.sla_breached,
        messages: threadMsgs.map((m: any) => ({
          t: m.created_at,
          dir: (m.direction === 'inbound' ? 'in' : 'out') as 'in' | 'out',
          text: m.body ?? (m.template_name ? `[шаблон: ${m.template_name}]` : `[${m.message_type}]`),
          type: m.message_type,
        })),
      };
    });

    const userPrompt = `Период: ${periodFrom} — ${periodTo}${
      branchIdFilter ? ` (филиал ID: ${branchIdFilter})` : ' (все филиалы)'
    }
Диалогов: ${threads.length}

Данные:

${formatPromptData(threads)}`;

    // Claude API call
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    const data: any = await r.json();
    if (!r.ok) {
      throw new Error(`Anthropic API: ${r.status} — ${data?.error?.message ?? JSON.stringify(data)}`);
    }

    const markdown: string = data?.content?.[0]?.text ?? '(пустой ответ)';

    await admin
      .from('whatsapp_quality_reports')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        threads_analyzed: threads.length,
        report_markdown: markdown,
        report_json: { usage: data.usage ?? null, model: data.model ?? MODEL },
      })
      .eq('id', reportId);

    return NextResponse.json({ ok: true, report_id: reportId, threads: threads.length });
  } catch (e: any) {
    await admin
      .from('whatsapp_quality_reports')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: e?.message ?? String(e),
      })
      .eq('id', reportId);
    return NextResponse.json({ error: e?.message ?? 'analyze failed' }, { status: 500 });
  }
}
