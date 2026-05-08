'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Instagram,
  Clock,
  AlertTriangle,
  TrendingUp,
  RefreshCw,
  Sparkles,
  Users,
  Trophy,
  ThumbsDown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';

type Branch = { id: number; name: string };

type Thread = {
  id: string;
  branch_id: number;
  customer_id: number | null;
  order_id: number | null;
  ig_username: string | null;
  status: string;
  first_customer_message_at: string | null;
  first_seller_response_at: string | null;
  last_message_at: string | null;
  sla_breached: boolean;
};

type SellerScore = {
  employee_id: number;
  full_name: string;
  branch_id: number;
  branch_name: string;
  threads: number;
  responded: number;
  avg_min: number;
  sla_pct: number;
  score: number;
};

type BadReply = {
  id: number;
  thread_id: string;
  branch_id: number | null;
  employee_id: number | null;
  score: number;
  verdict: string;
  issues: string[];
  summary: string | null;
  worst_reply: string | null;
  created_at: string;
  employee_name?: string;
  branch_name?: string;
};

type Period = 'today' | 'week' | 'month';

function periodRange(p: Period): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  if (p === 'today') from.setHours(0, 0, 0, 0);
  if (p === 'week') from.setDate(from.getDate() - 7);
  if (p === 'month') from.setMonth(from.getMonth() - 1);
  return { from, to };
}

function responseMinutes(t: Thread): number | null {
  if (!t.first_customer_message_at || !t.first_seller_response_at) return null;
  return (
    (new Date(t.first_seller_response_at).getTime() -
      new Date(t.first_customer_message_at).getTime()) /
    60000
  );
}

function scoreColor(score: number): string {
  if (score >= 8) return 'text-emerald-700';
  if (score >= 6) return 'text-amber-700';
  return 'text-rose-700';
}

export default function InstagramControlPage() {
  const [period, setPeriod] = useState<Period>('week');
  const [branchFilter, setBranchFilter] = useState<number | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [sellers, setSellers] = useState<SellerScore[]>([]);
  const [badReplies, setBadReplies] = useState<BadReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [lastReport, setLastReport] = useState<{
    markdown: string | null;
    created_at: string;
  } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const sb = getBrowserSupabase();
      const { from, to } = periodRange(period);
      const fromIso = from.toISOString();
      const toIso = to.toISOString();

      let threadsQ = sb
        .from('instagram_threads')
        .select(
          'id, branch_id, customer_id, order_id, ig_username, status, first_customer_message_at, first_seller_response_at, last_message_at, sla_breached',
        )
        .gte('first_customer_message_at', fromIso)
        .lte('first_customer_message_at', toIso);
      if (branchFilter) threadsQ = threadsQ.eq('branch_id', branchFilter);

      let reportQ = sb
        .from('instagram_quality_reports')
        .select('id, report_markdown, created_at')
        .order('created_at', { ascending: false })
        .limit(1);
      if (branchFilter) reportQ = reportQ.eq('branch_id', branchFilter);

      const [brQ, thR, reportR, scoresR] = await Promise.all([
        sb.from('branches').select('id, name').order('name'),
        threadsQ,
        reportQ,
        sb.rpc('rpc_operator_instagram_scores', {
          p_from: fromIso,
          p_to: toIso,
          p_branch_id: branchFilter,
        }),
      ]);

      setBranches(((brQ.data ?? []) as unknown) as Branch[]);
      setThreads(((thR.data ?? []) as unknown) as Thread[]);
      setSellers(((scoresR.data ?? []) as unknown) as SellerScore[]);

      const latest = reportR.data?.[0] as any;
      setLastReport(
        latest?.report_markdown
          ? { markdown: latest.report_markdown, created_at: latest.created_at }
          : null,
      );

      const latestReportId = latest?.id as string | undefined;
      if (latestReportId) {
        const { data: badData } = await sb
          .from('instagram_thread_quality')
          .select(
            'id, thread_id, branch_id, employee_id, score, verdict, issues, summary, worst_reply, created_at',
          )
          .eq('report_id', latestReportId)
          .eq('verdict', 'bad')
          .order('score', { ascending: true })
          .limit(15);
        const rows = ((badData ?? []) as unknown) as BadReply[];

        const empIds = Array.from(new Set(rows.map((r) => r.employee_id).filter(Boolean))) as number[];
        const brIds = Array.from(new Set(rows.map((r) => r.branch_id).filter(Boolean))) as number[];
        const [empsR, brsR] = await Promise.all([
          empIds.length
            ? sb.from('employees').select('id, full_name').in('id', empIds)
            : Promise.resolve({ data: [] as any[] }),
          brIds.length
            ? sb.from('branches').select('id, name').in('id', brIds)
            : Promise.resolve({ data: [] as any[] }),
        ]);
        const empMap = new Map((empsR.data ?? []).map((e: any) => [e.id, e.full_name]));
        const brMap = new Map((brsR.data ?? []).map((b: any) => [b.id, b.name]));
        setBadReplies(
          rows.map((r) => ({
            ...r,
            employee_name: r.employee_id ? empMap.get(r.employee_id) : undefined,
            branch_name: r.branch_id ? brMap.get(r.branch_id) : undefined,
          })),
        );
      } else {
        setBadReplies([]);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, branchFilter]);

  const summary = useMemo(() => {
    const total = threads.length;
    const responded = threads.filter((t) => t.first_seller_response_at).length;
    const times = threads.map(responseMinutes).filter((x): x is number => x != null);
    const avgMin = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : null;
    const slaOk = times.filter((m) => m <= 10).length;
    const slaPct = responded > 0 ? (slaOk / responded) * 100 : null;
    const breached = threads.filter((t) => t.sla_breached).length;
    return { total, responded, avgMin, slaPct, breached };
  }, [threads]);

  const byBranch = useMemo(() => {
    const src = branchFilter ? branches.filter((b) => b.id === branchFilter) : branches;
    return src.map((b) => {
      const bt = threads.filter((t) => t.branch_id === b.id);
      const bResp = bt.filter((t) => t.first_seller_response_at);
      const times = bt.map(responseMinutes).filter((x): x is number => x != null);
      const avg = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : null;
      const ok = times.filter((m) => m <= 10).length;
      const slaPct = bResp.length > 0 ? (ok / bResp.length) * 100 : null;
      const breached = bt.filter((t) => t.sla_breached).length;
      return { branch: b, threads: bt.length, responded: bResp.length, avgMin: avg, slaPct, breached };
    });
  }, [branches, threads, branchFilter]);

  const breachedThreads = useMemo(
    () => threads.filter((t) => t.sla_breached).slice(0, 25),
    [threads],
  );

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const { from, to } = periodRange(period);
      const r = await fetch('/api/admin/instagram/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period_from: from.toISOString().slice(0, 10),
          period_to: to.toISOString().slice(0, 10),
          branch_id: branchFilter,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      toast.success('Анализ запущен, обновляю…');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка запуска');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="text-slate-50">
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-pink-500 via-fuchsia-500 to-amber-500 shadow-[0_4px_20px_rgba(236,72,153,0.35)]">
              <Instagram className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold tracking-tight text-slate-50">Instagram — контроль</div>
              <div className="mt-0.5 text-[12px] text-cyan-300/50">
                Скорость ответов, SLA, рейтинг продавцов и AI-анализ качества
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <BranchPicker branches={branches} value={branchFilter} onChange={setBranchFilter} />
            <PeriodPicker value={period} onChange={setPeriod} />
            <button
              onClick={load}
              title="Обновить"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white ring-1 ring-slate-200 text-slate-600 transition hover:bg-slate-50"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Summary */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Диалогов" value={summary.total} hint={`${summary.responded} с ответом`} />
          <Stat
            label="Средний ответ"
            value={summary.avgMin != null ? `${summary.avgMin.toFixed(1)} мин` : '—'}
            icon={<Clock size={14} />}
            hint={`SLA (≤10 мин): ${summary.slaPct != null ? summary.slaPct.toFixed(0) + '%' : '—'}`}
          />
          <Stat
            label="Просрочено SLA"
            value={summary.breached}
            icon={<AlertTriangle size={14} />}
            danger={summary.breached > 0}
          />
          <Stat label="Ответили" value={summary.responded} />
        </section>

        {/* Sellers ranking */}
        <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Trophy className="text-cyan-600" size={18} />
              Рейтинг продавцов Instagram
            </h2>
            <span className="text-[11px] text-slate-400">
              формула 10 − штраф за SLA − штраф за время
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left px-4 py-3">Продавец</th>
                  <th className="text-left px-4 py-3">Филиал</th>
                  <th className="text-right px-4 py-3">Диалогов</th>
                  <th className="text-right px-4 py-3">Ответили</th>
                  <th className="text-right px-4 py-3">Средний</th>
                  <th className="text-right px-4 py-3">SLA</th>
                  <th className="text-right px-4 py-3">Оценка</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-900">
                {sellers.map((s) => (
                  <tr key={s.employee_id} className="transition hover:bg-sky-50/40">
                    <td className="px-4 py-3 font-medium">{s.full_name}</td>
                    <td className="px-4 py-3 text-slate-600">{s.branch_name}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{s.threads}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{s.responded}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {Number(s.avg_min).toFixed(1)} мин
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span
                        className={
                          Number(s.sla_pct) >= 80
                            ? 'text-emerald-700 font-semibold'
                            : Number(s.sla_pct) >= 50
                              ? 'text-amber-700 font-semibold'
                              : 'text-rose-700 font-semibold'
                        }
                      >
                        {Number(s.sla_pct).toFixed(0)}%
                      </span>
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums text-lg font-bold ${scoreColor(Number(s.score))}`}
                    >
                      {Number(s.score).toFixed(1)}
                    </td>
                  </tr>
                ))}
                {sellers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                      {loading ? 'Загрузка…' : 'Нет диалогов с назначенным продавцом'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Per branch */}
        <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Users className="text-cyan-600" size={18} />
              По филиалам
            </h2>
            <TrendingUp className="text-cyan-600" size={18} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left px-4 py-3">Филиал</th>
                  <th className="text-right px-4 py-3">Диалогов</th>
                  <th className="text-right px-4 py-3">Ответили</th>
                  <th className="text-right px-4 py-3">Средний ответ</th>
                  <th className="text-right px-4 py-3">SLA</th>
                  <th className="text-right px-4 py-3">Нарушений</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-900">
                {byBranch.map((r) => (
                  <tr key={r.branch.id} className="transition hover:bg-sky-50/40">
                    <td className="px-4 py-3 font-medium">{r.branch.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.threads}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.responded}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.avgMin != null ? `${r.avgMin.toFixed(1)} мин` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.slaPct != null ? (
                        <span
                          className={
                            r.slaPct >= 80
                              ? 'text-emerald-700 font-semibold'
                              : r.slaPct >= 50
                                ? 'text-amber-700 font-semibold'
                                : 'text-rose-700 font-semibold'
                          }
                        >
                          {r.slaPct.toFixed(0)}%
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.breached > 0 ? (
                        <span className="text-rose-700 font-semibold">{r.breached}</span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                  </tr>
                ))}
                {byBranch.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                      {loading ? 'Загрузка…' : 'Нет данных за период'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Bad replies */}
        {badReplies.length > 0 && (
          <section className="rounded-2xl bg-white ring-1 ring-rose-200 p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
            <h2 className="text-base font-semibold text-rose-700 mb-3 flex items-center gap-2">
              <ThumbsDown size={18} /> Плохие ответы (по оценке AI)
            </h2>
            <div className="space-y-2">
              {badReplies.map((r) => (
                <div
                  key={r.id}
                  className="text-sm rounded-xl bg-rose-50 ring-1 ring-rose-200 px-3 py-2.5 space-y-1"
                >
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-900">
                        {r.employee_name ?? '— продавец —'}
                      </span>{' '}
                      <span className="text-slate-400">·</span>{' '}
                      <span className="text-slate-600">{r.branch_name ?? '—'}</span>
                    </div>
                    <div className={`shrink-0 font-bold tabular-nums ${scoreColor(r.score)}`}>
                      {Number(r.score).toFixed(1)} / 10
                    </div>
                  </div>
                  {r.summary && <div className="text-slate-700 text-[13px]">{r.summary}</div>}
                  {r.worst_reply && (
                    <div className="rounded bg-white/60 px-2 py-1 text-[12px] text-slate-600 italic border border-rose-100">
                      «{r.worst_reply}»
                    </div>
                  )}
                  {r.issues.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {r.issues.map((i, k) => (
                        <span
                          key={k}
                          className="inline-flex items-center rounded bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-800"
                        >
                          {i}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Breached list */}
        {breachedThreads.length > 0 && (
          <section className="rounded-2xl bg-white ring-1 ring-rose-200 p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
            <h2 className="text-base font-semibold text-rose-700 mb-3 flex items-center gap-2">
              <AlertTriangle size={18} /> Диалоги с нарушением SLA
            </h2>
            <div className="space-y-2">
              {breachedThreads.map((t) => {
                const mins = responseMinutes(t);
                const b = branches.find((x) => x.id === t.branch_id);
                return (
                  <div
                    key={t.id}
                    className="text-sm rounded-xl bg-rose-50 ring-1 ring-rose-200 px-3 py-2 flex justify-between gap-3"
                  >
                    <div className="truncate">
                      <span className="font-medium text-slate-900">{b?.name ?? '—'}</span>{' '}
                      <span className="text-slate-400">·</span>{' '}
                      <span className="text-slate-600">@{t.ig_username ?? '—'}</span>
                    </div>
                    <div className="text-rose-700 font-semibold shrink-0">
                      {mins != null ? `${mins.toFixed(0)} мин` : 'нет ответа'}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* AI */}
        <section className="rounded-2xl bg-white ring-1 ring-sky-100 p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold flex items-center gap-2 text-slate-900">
              <Sparkles className="text-cyan-600" size={18} />
              Анализ качества через AI
            </h2>
            <button
              onClick={analyze}
              disabled={analyzing}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 disabled:opacity-50"
            >
              {analyzing ? <Loader2Spinner /> : <Sparkles className="h-4 w-4" />}
              {analyzing ? 'Анализируем…' : 'Проанализировать за период'}
            </button>
          </div>
          <p className="text-sm text-slate-600">
            AI прочитает диалоги Instagram Direct за период и выдаст отчёт: скорость, эмпатия,
            решение вопроса, оценка каждого диалога 0–10 и список плохих ответов.
          </p>
          {lastReport?.markdown && (
            <div className="mt-4 rounded-xl bg-slate-50/60 ring-1 ring-slate-100 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
                Последний отчёт · {new Date(lastReport.created_at).toLocaleString('ru-RU')}
              </div>
              <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800">
{lastReport.markdown}
              </pre>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Loader2Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" />
  );
}

function Stat({
  label,
  value,
  hint,
  icon,
  danger,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-4 bg-white ring-1 shadow-[0_8px_30px_rgba(15,23,42,0.45)] ${
        danger ? 'ring-rose-200' : 'ring-sky-100'
      }`}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
        {icon}
        {label}
      </div>
      <div
        className={`text-2xl font-bold mt-1 tabular-nums ${
          danger ? 'text-rose-700' : 'text-slate-900'
        }`}
      >
        {value}
      </div>
      {hint && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="inline-flex rounded-xl bg-white p-1 ring-1 ring-sky-100 shadow-[0_4px_16px_rgba(15,23,42,0.08)]">
      {(['today', 'week', 'month'] as Period[]).map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
            value === p
              ? 'bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
          }`}
        >
          {p === 'today' ? 'Сегодня' : p === 'week' ? 'Неделя' : 'Месяц'}
        </button>
      ))}
    </div>
  );
}

function BranchPicker({
  branches,
  value,
  onChange,
}: {
  branches: Branch[];
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className="h-10 rounded-xl bg-white ring-1 ring-sky-100 px-3 text-sm text-slate-700 shadow-[0_4px_16px_rgba(15,23,42,0.08)] focus:outline-none focus:ring-2 focus:ring-cyan-400"
    >
      <option value="">Все филиалы</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}
