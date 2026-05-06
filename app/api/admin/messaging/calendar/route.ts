import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getCurrentUser } from '@/lib/getUserRole';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/messaging/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Возвращает по дням: сколько тредов было, какая средняя AI-оценка (WA + IG),
 * per-branch разбивка, и id последнего отчёта (если есть).
 */

type DayBucket = {
  date: string; // YYYY-MM-DD
  wa: ChannelSummary | null;
  ig: ChannelSummary | null;
};

type ChannelSummary = {
  threads: number;
  reports: number;              // сколько раз анализировали
  avg_score: number | null;     // среднее per_thread.score из *_thread_quality
  analyzed_threads: number;     // сколько тредов проанализировано
  last_report_id: string | null;
  model: string | null;         // llm_model последнего отчёта
  cost_usd: number;             // сумма стоимости всех отчётов дня
  branches: Array<{ branch_id: number; branch_code: string | null; branch_name: string; threads: number; avg_score: number | null }>;
};

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'auth' }, { status: 401 });
  const role = (user.app_metadata?.role as string) || 'seller';
  if (role !== 'owner') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to) return NextResponse.json({ error: 'from/to required (YYYY-MM-DD)' }, { status: 400 });

  const admin = getSupabaseAdmin();
  const fromIso = `${from}T00:00:00Z`;
  const toIso = `${to}T23:59:59Z`;

  // 1) Все WA/IG треды за период (для подсчёта «сколько диалогов в день»).
  const [waThreadsR, igThreadsR, waReportsR, igReportsR, waQualityR, igQualityR, branchesR] = await Promise.all([
    admin
      .from('whatsapp_threads')
      .select('id, first_customer_message_at, branch_id')
      .gte('first_customer_message_at', fromIso)
      .lte('first_customer_message_at', toIso),
    admin
      .from('instagram_threads')
      .select('id, first_customer_message_at, branch_id')
      .gte('first_customer_message_at', fromIso)
      .lte('first_customer_message_at', toIso),
    admin
      .from('whatsapp_quality_reports')
      .select('id, period_from, period_to, llm_model, cost_usd, status, created_at')
      .eq('status', 'completed')
      .gte('period_from', from)
      .lte('period_to', to),
    admin
      .from('instagram_quality_reports')
      .select('id, period_from, period_to, llm_model, cost_usd, status, created_at')
      .eq('status', 'completed')
      .gte('period_from', from)
      .lte('period_to', to),
    admin
      .from('whatsapp_thread_quality')
      .select('thread_id, branch_id, score, created_at, thread:whatsapp_threads!inner(first_customer_message_at)')
      .gte('created_at', fromIso)
      .lte('created_at', toIso),
    admin
      .from('instagram_thread_quality')
      .select('thread_id, branch_id, score, created_at, thread:instagram_threads!inner(first_customer_message_at)')
      .gte('created_at', fromIso)
      .lte('created_at', toIso),
    admin.from('branches').select('id, name, code, is_workshop'),
  ]);

  // branchMap: id → { name, code }
  const branchMap = new Map<number, { name: string; code: string | null }>();
  for (const b of branchesR.data ?? []) {
    const row = b as any;
    if (!row.is_workshop) branchMap.set(row.id, { name: row.name, code: row.code ?? null });
  }

  // Группируем треды по дню (по first_customer_message_at)
  const dayMap = new Map<string, DayBucket>();
  const ensure = (date: string): DayBucket => {
    let d = dayMap.get(date);
    if (!d) {
      d = { date, wa: null, ig: null };
      dayMap.set(date, d);
    }
    return d;
  };
  const ensureChannel = (b: DayBucket, ch: 'wa' | 'ig'): ChannelSummary => {
    if (!b[ch]) {
      b[ch] = {
        threads: 0,
        reports: 0,
        avg_score: null,
        analyzed_threads: 0,
        last_report_id: null,
        model: null,
        cost_usd: 0,
        branches: [],
      };
    }
    return b[ch]!;
  };

  const dateOnly = (iso: string) => iso.slice(0, 10);

  // Треды → считаем по дням + по филиалам
  const addThread = (
    row: { first_customer_message_at: string; branch_id: number | null },
    ch: 'wa' | 'ig',
  ) => {
    const date = dateOnly(row.first_customer_message_at);
    const b = ensure(date);
    const c = ensureChannel(b, ch);
    c.threads += 1;
    const branchId = row.branch_id ?? 0;
    let br = c.branches.find((x) => x.branch_id === branchId);
    if (!br) {
      const meta = branchId ? branchMap.get(branchId) : null;
      br = {
        branch_id: branchId,
        branch_code: meta?.code ?? null,
        branch_name: meta?.name || (branchId ? `#${branchId}` : 'Неназначен'),
        threads: 0,
        avg_score: null,
      };
      c.branches.push(br);
    }
    br.threads += 1;
  };
  for (const r of waThreadsR.data ?? []) addThread(r as any, 'wa');
  for (const r of igThreadsR.data ?? []) addThread(r as any, 'ig');

  // Отчёты → считаем кол-во, модель, стоимость (только за те дни, где period_from=period_to, т.е. «день-отчёты»)
  const mergeReports = (rows: any[], ch: 'wa' | 'ig') => {
    for (const r of rows) {
      const from = r.period_from;
      const to = r.period_to;
      if (!from || from !== to) continue;
      const b = ensure(from);
      const c = ensureChannel(b, ch);
      c.reports += 1;
      c.cost_usd += Number(r.cost_usd ?? 0);
      c.last_report_id = r.id;
      c.model = r.llm_model ?? null;
    }
  };
  mergeReports(waReportsR.data ?? [], 'wa');
  mergeReports(igReportsR.data ?? [], 'ig');

  // AI-оценки per-thread → средний score за день для канала + для филиала
  const addQuality = (
    rows: any[],
    ch: 'wa' | 'ig',
  ) => {
    // Собираем per-day sums, чтобы потом посчитать среднее
    const dayPerChannel: Record<string, { sum: number; cnt: number }> = {};
    const dayPerBranch: Record<string, Record<number, { sum: number; cnt: number }>> = {};
    for (const q of rows) {
      const startedAt = (q.thread?.first_customer_message_at as string | null) ?? null;
      if (!startedAt) continue;
      const date = dateOnly(startedAt);
      const score = Number(q.score ?? 0);
      const branchId = (q.branch_id as number | null) ?? 0;
      dayPerChannel[date] = dayPerChannel[date] || { sum: 0, cnt: 0 };
      dayPerChannel[date].sum += score;
      dayPerChannel[date].cnt += 1;
      dayPerBranch[date] = dayPerBranch[date] || {};
      dayPerBranch[date][branchId] = dayPerBranch[date][branchId] || { sum: 0, cnt: 0 };
      dayPerBranch[date][branchId].sum += score;
      dayPerBranch[date][branchId].cnt += 1;
    }
    for (const [date, agg] of Object.entries(dayPerChannel)) {
      const b = ensure(date);
      const c = ensureChannel(b, ch);
      c.analyzed_threads = agg.cnt;
      c.avg_score = agg.cnt ? Number((agg.sum / agg.cnt).toFixed(2)) : null;
      // per-branch avg
      const branchScores = dayPerBranch[date] || {};
      for (const [bid, v] of Object.entries(branchScores)) {
        const branchIdN = Number(bid);
        let br = c.branches.find((x) => x.branch_id === branchIdN);
        if (!br) {
          const meta = branchIdN ? branchMap.get(branchIdN) : null;
          br = {
            branch_id: branchIdN,
            branch_code: meta?.code ?? null,
            branch_name: meta?.name || (branchIdN ? `#${branchIdN}` : 'Неназначен'),
            threads: 0,
            avg_score: null,
          };
          c.branches.push(br);
        }
        br.avg_score = v.cnt ? Number((v.sum / v.cnt).toFixed(2)) : null;
      }
    }
  };
  addQuality(waQualityR.data ?? [], 'wa');
  addQuality(igQualityR.data ?? [], 'ig');

  const days = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  return NextResponse.json({ ok: true, from, to, days });
}
