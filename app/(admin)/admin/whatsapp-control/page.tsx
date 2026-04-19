'use client';

import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Clock, AlertTriangle, TrendingUp, RefreshCw, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';

type Branch = { id: number; name: string };

type Thread = {
  id: string;
  branch_id: number;
  customer_id: number;
  order_id: number | null;
  phone_number: string;
  status: string;
  first_customer_message_at: string | null;
  first_seller_response_at: string | null;
  last_message_at: string | null;
  sla_breached: boolean;
};

type FollowupRow = {
  id: string;
  branch_id: number;
  status: string;
  sent_at: string | null;
  scheduled_at: string;
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

export default function WhatsAppControlPage() {
  const [period, setPeriod] = useState<Period>('week');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [followups, setFollowups] = useState<FollowupRow[]>([]);
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

      const [brQ, thQ, fuQ, reportQ] = await Promise.all([
        sb.from('branches').select('id, name').order('name'),
        sb
          .from('whatsapp_threads')
          .select('id, branch_id, customer_id, order_id, phone_number, status, first_customer_message_at, first_seller_response_at, last_message_at, sla_breached')
          .gte('first_customer_message_at', fromIso)
          .lte('first_customer_message_at', toIso),
        sb
          .from('whatsapp_followup_queue')
          .select('id, branch_id, status, sent_at, scheduled_at')
          .gte('scheduled_at', fromIso)
          .lte('scheduled_at', toIso),
        sb
          .from('whatsapp_quality_reports')
          .select('id, period_from, period_to, branch_id, report_markdown, status, created_at')
          .order('created_at', { ascending: false })
          .limit(1),
      ]);

      setBranches(((brQ.data ?? []) as unknown) as Branch[]);
      setThreads(((thQ.data ?? []) as unknown) as Thread[]);
      setFollowups(((fuQ.data ?? []) as unknown) as FollowupRow[]);

      const latest = reportQ.data?.[0] as any;
      if (latest?.report_markdown) {
        setLastReport({ markdown: latest.report_markdown, created_at: latest.created_at });
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
  }, [period]);

  const summary = useMemo(() => {
    const total = threads.length;
    const responded = threads.filter((t) => t.first_seller_response_at).length;
    const responseTimes = threads
      .map(responseMinutes)
      .filter((x): x is number => x != null);
    const avgMin =
      responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : null;
    const slaOk = responseTimes.filter((m) => m <= 20).length;
    const slaPct = responded > 0 ? (slaOk / responded) * 100 : null;
    const breached = threads.filter((t) => t.sla_breached).length;

    const fuSent = followups.filter((f) => f.status === 'sent').length;
    const fuPending = followups.filter((f) => f.status === 'pending').length;
    const fuFailed = followups.filter((f) => f.status === 'failed').length;

    return { total, responded, avgMin, slaPct, breached, fuSent, fuPending, fuFailed };
  }, [threads, followups]);

  const byBranch = useMemo(() => {
    return branches.map((b) => {
      const bt = threads.filter((t) => t.branch_id === b.id);
      const bResp = bt.filter((t) => t.first_seller_response_at);
      const times = bt.map(responseMinutes).filter((x): x is number => x != null);
      const avg =
        times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : null;
      const ok = times.filter((m) => m <= 20).length;
      const slaPct = bResp.length > 0 ? (ok / bResp.length) * 100 : null;
      const breached = bt.filter((t) => t.sla_breached).length;
      const fuSent = followups.filter((f) => f.branch_id === b.id && f.status === 'sent').length;
      return {
        branch: b,
        threads: bt.length,
        responded: bResp.length,
        avgMin: avg,
        slaPct,
        breached,
        fuSent,
      };
    });
  }, [branches, threads, followups]);

  const breachedThreads = useMemo(
    () => threads.filter((t) => t.sla_breached).slice(0, 25),
    [threads],
  );

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const { from, to } = periodRange(period);
      const r = await fetch('/api/admin/whatsapp/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period_from: from.toISOString().slice(0, 10),
          period_to: to.toISOString().slice(0, 10),
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
        {/* Header (бренд-стандарт) */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
              <MessageCircle className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold tracking-tight text-slate-50">WhatsApp — контроль</div>
              <div className="mt-0.5 text-[12px] text-cyan-300/50">
                Скорость ответов продавцов, SLA и качество работы по филиалам
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
            hint={`SLA: ${summary.slaPct != null ? summary.slaPct.toFixed(0) + '%' : '—'}`}
          />
          <Stat
            label="Просрочено SLA"
            value={summary.breached}
            icon={<AlertTriangle size={14} />}
            danger={summary.breached > 0}
          />
          <Stat
            label="Follow-up отправлено"
            value={summary.fuSent}
            hint={`в очереди: ${summary.fuPending}${summary.fuFailed ? `, ошибок: ${summary.fuFailed}` : ''}`}
          />
        </section>

        {/* Per branch */}
        <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">По филиалам</h2>
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
                  <th className="text-right px-4 py-3">Follow-up</th>
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
                    <td className="px-4 py-3 text-right tabular-nums">{r.fuSent}</td>
                  </tr>
                ))}
                {byBranch.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                      {loading ? 'Загрузка…' : 'Нет данных за период'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

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
                      <span className="text-slate-600">{t.phone_number}</span>
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

        {/* LLM analysis */}
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
            AI прочитает все закрытые диалоги за выбранный период и выдаст отчёт:
            скорость, эмпатия, решение проблем, топ/антитоп продавцов, частые жалобы.
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
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" />;
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
