import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getCurrentUser } from '@/lib/getUserRole';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/messaging/day?date=YYYY-MM-DD&branches=1,2,3
 * Возвращает всё про один день: summary, per-branch, per-seller, critical replies,
 * SLA-нарушения и markdown-отчёты (по всем моделям, если анализировали несколько раз).
 */

type ChannelDay = {
  threads_total: number;
  threads_sla_breached: number;
  analyzed_threads: number;
  avg_score: number | null;
  critical_count: number;
  analyzed: boolean;
  reports: Array<{
    id: string;
    llm_model: string;
    markdown: string | null;
    created_at: string;
    threads_analyzed: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: number | null;
  }>;
  branches: Array<{
    branch_id: number;
    branch_name: string;
    threads: number;
    avg_score: number | null;
    critical_count: number;
    sla_breached_count: number;
  }>;
  sellers: Array<{
    employee_id: number;
    full_name: string;
    branch_id: number;
    branch_name: string;
    threads: number;
    avg_score: number | null;
    critical_count: number;
  }>;
  critical_replies: Array<{
    thread_id: string;
    employee_id: number | null;
    employee_name: string | null;
    branch_id: number | null;
    branch_name: string | null;
    customer_name: string | null;
    score: number;
    verdict: string;
    summary: string | null;
    worst_reply: string | null;
    issues: string[];
  }>;
  sla_threads: Array<{
    thread_id: string;
    branch_id: number | null;
    branch_name: string | null;
    customer_name: string | null;
    response_minutes: number | null;
    first_customer_message_at: string | null;
  }>;
};

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'auth' }, { status: 401 });
  const role = (user.app_metadata?.role as string) || 'seller';
  if (role !== 'owner') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const date = url.searchParams.get('date');
  const branchFilter = (url.searchParams.get('branches') || '').split(',').map((s) => Number(s)).filter(Boolean);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date required (YYYY-MM-DD)' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const dayStart = `${date}T00:00:00Z`;
  const dayEnd = `${date}T23:59:59Z`;

  const [brs, wa, ig] = await Promise.all([
    admin.from('branches').select('id, name, is_workshop'),
    buildChannel('wa', admin, date, dayStart, dayEnd, branchFilter),
    buildChannel('ig', admin, date, dayStart, dayEnd, branchFilter),
  ]);

  const branchMap = new Map<number, string>();
  for (const b of brs.data ?? []) {
    if (!(b as any).is_workshop) branchMap.set((b as any).id, (b as any).name);
  }

  enrichBranchNames(wa, branchMap);
  enrichBranchNames(ig, branchMap);

  return NextResponse.json({ ok: true, date, wa, ig });
}

function enrichBranchNames(ch: ChannelDay, branchMap: Map<number, string>) {
  for (const b of ch.branches) {
    if (!b.branch_name) b.branch_name = branchMap.get(b.branch_id) ?? `#${b.branch_id}`;
  }
  for (const s of ch.sellers) {
    if (!s.branch_name) s.branch_name = branchMap.get(s.branch_id) ?? `#${s.branch_id}`;
  }
  for (const r of ch.critical_replies) {
    if (r.branch_id && !r.branch_name) r.branch_name = branchMap.get(r.branch_id) ?? `#${r.branch_id}`;
  }
  for (const s of ch.sla_threads) {
    if (s.branch_id && !s.branch_name) s.branch_name = branchMap.get(s.branch_id) ?? `#${s.branch_id}`;
  }
}

async function buildChannel(
  channel: 'wa' | 'ig',
  admin: ReturnType<typeof getSupabaseAdmin>,
  date: string,
  dayStart: string,
  dayEnd: string,
  branchFilter: number[],
): Promise<ChannelDay> {
  const isWa = channel === 'wa';
  const tThreads = isWa ? 'whatsapp_threads' : 'instagram_threads';
  const tReports = isWa ? 'whatsapp_quality_reports' : 'instagram_quality_reports';
  const tQuality = isWa ? 'whatsapp_thread_quality' : 'instagram_thread_quality';
  const customerSelect = 'customer:customers(first_name, last_name, full_name)';

  // 1) Треды за день (для SLA + summary)
  let threadsQ = admin
    .from(tThreads)
    .select(`id, branch_id, first_customer_message_at, first_seller_response_at, sla_breached, ${customerSelect}`)
    .gte('first_customer_message_at', dayStart)
    .lte('first_customer_message_at', dayEnd);
  if (branchFilter.length > 0) threadsQ = threadsQ.in('branch_id', branchFilter);
  const { data: threads } = await threadsQ;

  // 2) Отчёты за этот день (несколько моделей возможно)
  const { data: reports } = await admin
    .from(tReports)
    .select('id, llm_model, report_markdown, created_at, threads_analyzed, input_tokens, output_tokens, cost_usd, status')
    .eq('status', 'completed')
    .eq('period_from', date)
    .eq('period_to', date)
    .order('created_at', { ascending: false });

  // 3) Per-thread оценки от последнего отчёта
  const latestReportId = (reports ?? [])[0]?.id as string | undefined;
  let qualities: any[] = [];
  if (latestReportId) {
    const { data: q } = await admin
      .from(tQuality)
      .select('thread_id, branch_id, employee_id, score, verdict, issues, summary, worst_reply')
      .eq('report_id', latestReportId);
    qualities = q ?? [];
  }

  // 4) Сотрудники (имена)
  const empIds = Array.from(new Set(qualities.map((q) => q.employee_id).filter(Boolean)));
  const empNameMap = new Map<number, string>();
  if (empIds.length) {
    const { data: emps } = await admin.from('employees').select('id, full_name').in('id', empIds);
    for (const e of emps ?? []) empNameMap.set(Number((e as any).id), String((e as any).full_name));
  }

  // Собираем структуры
  const threadsList = threads ?? [];
  const threads_total = threadsList.length;
  const threads_sla_breached = threadsList.filter((t: any) => t.sla_breached).length;

  const analyzed_threads = qualities.length;
  const scores = qualities.map((q) => Number(q.score)).filter((n) => !isNaN(n));
  const avg_score = scores.length ? Number((scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(2)) : null;
  const critical_count = qualities.filter((q) => Number(q.score) < 5).length;

  // Per-branch
  const byBranch = new Map<number, { threads: number; scores: number[]; critical: number; sla: number }>();
  for (const t of threadsList) {
    const bid = t.branch_id as number | null;
    if (bid == null) continue;
    const acc = byBranch.get(bid) ?? { threads: 0, scores: [], critical: 0, sla: 0 };
    acc.threads += 1;
    if (t.sla_breached) acc.sla += 1;
    byBranch.set(bid, acc);
  }
  for (const q of qualities) {
    const bid = q.branch_id as number | null;
    if (bid == null) continue;
    const acc = byBranch.get(bid) ?? { threads: 0, scores: [], critical: 0, sla: 0 };
    acc.scores.push(Number(q.score));
    if (Number(q.score) < 5) acc.critical += 1;
    byBranch.set(bid, acc);
  }
  const branches = Array.from(byBranch.entries())
    .map(([branch_id, v]) => ({
      branch_id,
      branch_name: '',
      threads: v.threads,
      avg_score: v.scores.length
        ? Number((v.scores.reduce((s, x) => s + x, 0) / v.scores.length).toFixed(2))
        : null,
      critical_count: v.critical,
      sla_breached_count: v.sla,
    }))
    .sort((a, b) => b.threads - a.threads);

  // Per-seller (только для проанализированных)
  const bySeller = new Map<string, { employee_id: number; branch_id: number; full_name: string; branch_name: string; threads: number; scores: number[]; critical: number }>();
  for (const q of qualities) {
    const empId = Number(q.employee_id);
    if (!empId) continue;
    const bid = Number(q.branch_id ?? 0);
    const key = `${empId}:${bid}`;
    const acc = bySeller.get(key) ?? {
      employee_id: empId,
      branch_id: bid,
      full_name: empNameMap.get(empId) ?? `#${empId}`,
      branch_name: '',
      threads: 0,
      scores: [],
      critical: 0,
    };
    acc.threads += 1;
    acc.scores.push(Number(q.score));
    if (Number(q.score) < 5) acc.critical += 1;
    bySeller.set(key, acc);
  }
  const sellers = Array.from(bySeller.values())
    .map((s) => ({
      employee_id: s.employee_id,
      full_name: s.full_name,
      branch_id: s.branch_id,
      branch_name: s.branch_name,
      threads: s.threads,
      avg_score: s.scores.length
        ? Number((s.scores.reduce((a, x) => a + x, 0) / s.scores.length).toFixed(2))
        : null,
      critical_count: s.critical,
    }))
    .sort((a, b) => (b.avg_score ?? 0) - (a.avg_score ?? 0));

  // Critical replies (score < 5)
  const customerNameFor = (t: any): string => {
    const c = t?.customer;
    if (!c) return '';
    const parts = [c.first_name, c.last_name].filter(Boolean);
    return parts.length ? parts.join(' ') : c.full_name ?? '';
  };
  const threadIdx = new Map<string, any>();
  for (const t of threadsList) threadIdx.set(String(t.id), t);

  const critical_replies = qualities
    .filter((q) => Number(q.score) < 5)
    .sort((a, b) => Number(a.score) - Number(b.score))
    .slice(0, 12)
    .map((q) => {
      const t = threadIdx.get(String(q.thread_id));
      return {
        thread_id: String(q.thread_id),
        employee_id: q.employee_id ? Number(q.employee_id) : null,
        employee_name: q.employee_id ? empNameMap.get(Number(q.employee_id)) ?? null : null,
        branch_id: q.branch_id ? Number(q.branch_id) : null,
        branch_name: '',
        customer_name: t ? customerNameFor(t) : null,
        score: Number(q.score),
        verdict: String(q.verdict ?? 'ok'),
        summary: q.summary ?? null,
        worst_reply: q.worst_reply ?? null,
        issues: Array.isArray(q.issues) ? q.issues : [],
      };
    });

  // SLA-нарушители
  const sla_threads = threadsList
    .filter((t: any) => t.sla_breached)
    .map((t: any) => {
      const respMin =
        t.first_customer_message_at && t.first_seller_response_at
          ? (new Date(t.first_seller_response_at).getTime() - new Date(t.first_customer_message_at).getTime()) / 60000
          : null;
      return {
        thread_id: String(t.id),
        branch_id: t.branch_id ?? null,
        branch_name: '',
        customer_name: customerNameFor(t),
        response_minutes: respMin,
        first_customer_message_at: t.first_customer_message_at,
      };
    })
    .sort((a: any, b: any) => (b.response_minutes ?? 0) - (a.response_minutes ?? 0));

  return {
    threads_total,
    threads_sla_breached,
    analyzed_threads,
    avg_score,
    critical_count,
    analyzed: (reports ?? []).length > 0,
    reports: (reports ?? []).map((r: any) => ({
      id: String(r.id),
      llm_model: String(r.llm_model ?? 'unknown'),
      markdown: (r.report_markdown as string | null) ?? null,
      created_at: r.created_at,
      threads_analyzed: r.threads_analyzed ?? null,
      input_tokens: r.input_tokens ?? null,
      output_tokens: r.output_tokens ?? null,
      cost_usd: r.cost_usd != null ? Number(r.cost_usd) : null,
    })),
    branches,
    sellers,
    critical_replies,
    sla_threads,
  };
}
