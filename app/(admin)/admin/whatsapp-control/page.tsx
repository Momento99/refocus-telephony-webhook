'use client';

import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Clock, AlertTriangle, TrendingUp, RefreshCw, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import getSupabase from '@/lib/supabaseClient';

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
      const sb = getSupabase();
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
    <div className="min-h-screen bg-transparent text-slate-900">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-bold text-white tracking-tight flex items-center gap-2">
              <MessageCircle className="text-emerald-400" size={20} />
              WhatsApp — Контроль
            </h1>
            <p className="text-[12px] text-slate-400 mt-0.5">
              Статистика ответов продавцов, SLA и качество работы по филиалам
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PeriodPicker value={period} onChange={setPeriod} />
            <button
              onClick={load}
              className="inline-flex items-center gap-2 rounded-xl bg-white/10 text-slate-300 text-[13px] font-medium px-3.5 py-2 hover:bg-white/15 transition"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </header>

      {/* Summary */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
      <section className="rounded-2xl border border-slate-200/60 bg-white/90 shadow-sm">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold">По филиалам</h2>
          <TrendingUp className="text-slate-400" size={18} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-2">Филиал</th>
                <th className="text-right px-4 py-2">Диалогов</th>
                <th className="text-right px-4 py-2">Ответили</th>
                <th className="text-right px-4 py-2">Средний ответ</th>
                <th className="text-right px-4 py-2">SLA</th>
                <th className="text-right px-4 py-2">Нарушений</th>
                <th className="text-right px-4 py-2">Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {byBranch.map((r) => (
                <tr key={r.branch.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-900">{r.branch.name}</td>
                  <td className="px-4 py-2 text-right">{r.threads}</td>
                  <td className="px-4 py-2 text-right">{r.responded}</td>
                  <td className="px-4 py-2 text-right">
                    {r.avgMin != null ? `${r.avgMin.toFixed(1)} мин` : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {r.slaPct != null ? (
                      <span
                        className={
                          r.slaPct >= 80
                            ? 'text-emerald-700'
                            : r.slaPct >= 50
                              ? 'text-amber-700'
                              : 'text-red-700'
                        }
                      >
                        {r.slaPct.toFixed(0)}%
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {r.breached > 0 ? (
                      <span className="text-red-700">{r.breached}</span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">{r.fuSent}</td>
                </tr>
              ))}
              {byBranch.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
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
        <section className="rounded-2xl border border-red-200 bg-red-50/50 shadow-sm p-5">
          <h2 className="text-lg font-semibold text-red-900 mb-2 flex items-center gap-2">
            <AlertTriangle size={18} /> Диалоги с нарушением SLA
          </h2>
          <div className="space-y-2">
            {breachedThreads.map((t) => {
              const mins = responseMinutes(t);
              const b = branches.find((x) => x.id === t.branch_id);
              return (
                <div
                  key={t.id}
                  className="text-sm bg-white rounded-lg border border-red-200 px-3 py-2 flex justify-between gap-3"
                >
                  <div className="truncate">
                    <span className="font-medium">{b?.name ?? '—'}</span> ·{' '}
                    <span className="text-slate-600">{t.phone_number}</span>
                  </div>
                  <div className="text-red-700 shrink-0">
                    {mins != null ? `${mins.toFixed(0)} мин` : 'нет ответа'}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

        {/* LLM analysis */}
        <section className="rounded-2xl bg-white ring-1 ring-slate-200 p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold flex items-center gap-2 text-slate-900">
              <Sparkles className="text-purple-600" size={18} />
              Анализ качества через AI
            </h2>
            <button
              onClick={analyze}
              disabled={analyzing}
              className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 text-white px-4 py-2 text-sm hover:bg-purple-700 disabled:opacity-50"
            >
              {analyzing ? 'Анализируем…' : 'Проанализировать за период'}
            </button>
          </div>
          <p className="text-sm text-slate-600">
            AI прочитает все закрытые диалоги за выбранный период и выдаст отчёт:
            скорость, эмпатия, решение проблем, топ/антитоп продавцов, частые жалобы.
          </p>
          {lastReport?.markdown && (
            <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-4">
              <div className="text-xs text-slate-500 mb-2">
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
      className={`rounded-2xl p-4 border shadow-sm ${
        danger
          ? 'bg-red-50 border-red-200'
          : 'bg-white border-slate-200/60'
      }`}
    >
      <div className="text-xs text-slate-500 flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div
        className={`text-2xl font-semibold mt-1 ${
          danger ? 'text-red-700' : 'text-slate-900'
        }`}
      >
        {value}
      </div>
      {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-slate-300 bg-white overflow-hidden">
      {(['today', 'week', 'month'] as Period[]).map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`px-3 py-2 text-sm ${
            value === p ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'
          }`}
        >
          {p === 'today' ? 'Сегодня' : p === 'week' ? 'Неделя' : 'Месяц'}
        </button>
      ))}
    </div>
  );
}
