'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import { toast } from 'react-hot-toast';
import { Undo2, RefreshCw } from 'lucide-react';

type Totals = {
  refund_sum: number;
  refund_cnt: number;
  pending_sum: number;
  pending_cnt: number;
  cancel_cnt: number;
  cash_cnt: number;
  adaptation_cnt: number;
  prescription_cnt: number;
  prescription_cost: number;
};
type BranchRow = {
  branch: string;
  refund_sum: number;
  refund_cnt: number;
  pending_sum: number;
  adaptation_cnt: number;
  prescription_cnt: number;
  prescription_cost: number;
  orders_cnt: number;
};
type ReasonRow = { reason: string; cnt: number; sum: number };
type RecentRow = {
  created_at: string;
  branch: string;
  order_id: number | null;
  refund_type: string;
  reason: string;
  amount: number;
  method: string;
  status: string;
};
type Overview = {
  totals: Totals;
  by_branch: BranchRow[];
  by_reason: ReasonRow[];
  recent: RecentRow[];
};

const REASONS: Record<string, string> = {
  changed_mind: 'Передумал',
  too_expensive: 'Дорого / дешевле в др. месте',
  too_slow: 'Долго ждать',
  cant_pay: 'Не смог оплатить',
  our_error: 'Наша ошибка при оформлении',
  quality_issue: 'Брак / дефект',
  wrong_recipe: 'Ошибка в рецепте (наша)',
  did_not_fit: 'Не подошло (посадка/комфорт)',
  customer_unhappy: 'Не понравилось / передумал',
  other: 'Другое',
};
const TYPE_RU: Record<string, string> = {
  cancel_before_delivery: 'Отмена до выдачи',
  cash_refund: 'Возврат денег',
  replacement_difference: 'Доплата замены',
};
const METHOD_RU: Record<string, string> = { cash: 'Наличные', pos: 'Карта', transfer: 'Перевод/QR' };

const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0));

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function StatCard({
  title,
  value,
  hint,
  tone = 'slate',
}: {
  title: string;
  value: string;
  hint?: string;
  tone?: 'slate' | 'rose' | 'amber' | 'cyan' | 'violet';
}) {
  const valueTone =
    tone === 'rose'
      ? 'text-rose-600'
      : tone === 'amber'
      ? 'text-amber-600'
      : tone === 'cyan'
      ? 'text-cyan-600'
      : tone === 'violet'
      ? 'text-violet-600'
      : 'text-slate-900';
  return (
    <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{title}</div>
      <div className={`mt-1 text-2xl font-bold ${valueTone}`}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

export default function ReturnsDashboardPage() {
  const sb = useMemo(() => getBrowserSupabase(), []);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [branch, setBranch] = useState<string>('');
  const [branches, setBranches] = useState<string[]>([]);
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await sb.from('branches').select('name').order('name');
      setBranches(((data as any[]) || []).map((b) => b.name).filter(Boolean));
    })();
  }, [sb]);

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await sb.rpc('admin_returns_overview', {
        from_dt: from,
        to_dt: to,
        branches: branch ? [branch] : null,
      });
      if (error) throw error;
      setData(data as Overview);
    } catch (e: any) {
      toast.error(e?.message ?? 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, branch]);

  const t = data?.totals;
  const moneyOut = (t?.refund_sum || 0) + (t?.prescription_cost || 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
            <Undo2 className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-50">Возвраты и замены</div>
            <div className="mt-0.5 text-[12px] text-cyan-300/50">
              Отмены, возвраты денег, замены по гарантии и переделки по рецепту
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-xl bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
          />
          <span className="text-slate-400">—</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-xl bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
          />
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
          >
            <option value="">Все филиалы</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <button
            onClick={load}
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Возвраты денег"
          value={`${fmt(t?.refund_sum || 0)} с`}
          hint={`${t?.refund_cnt || 0} операц. · отмены ${t?.cancel_cnt || 0} / возвраты ${t?.cash_cnt || 0}`}
          tone="rose"
        />
        <StatCard
          title="К возврату (ожидают)"
          value={`${fmt(t?.pending_sum || 0)} с`}
          hint={`${t?.pending_cnt || 0} клиентов придут за деньгами`}
          tone="amber"
        />
        <StatCard
          title="Замены по гарантии"
          value={`${(t?.adaptation_cnt || 0) + (t?.prescription_cnt || 0)}`}
          hint={`адаптация ${t?.adaptation_cnt || 0} · рецепт ${t?.prescription_cnt || 0}`}
          tone="violet"
        />
        <StatCard
          title="Убыток на переделках"
          value={`${fmt(t?.prescription_cost || 0)} с`}
          hint="себестоимость линз по рецепту (наш счёт)"
          tone="amber"
        />
      </div>

      {/* by branch */}
      <div className="mb-6 overflow-hidden rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
        <div className="border-b border-slate-100 px-5 py-3 text-sm font-bold text-slate-900">
          По филиалам
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3">Филиал</th>
                <th className="px-5 py-3 text-right">Возвраты, с</th>
                <th className="px-5 py-3 text-right">Кол-во</th>
                <th className="px-5 py-3 text-right">К возврату</th>
                <th className="px-5 py-3 text-right">Адаптация</th>
                <th className="px-5 py-3 text-right">Рецепт</th>
                <th className="px-5 py-3 text-right">Убыток рецепт</th>
                <th className="px-5 py-3 text-right">% возвратов</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-900">
              {loading && (
                <tr className="animate-pulse">
                  <td className="px-5 py-5" colSpan={8}>
                    <div className="h-4 w-56 rounded bg-slate-200" />
                  </td>
                </tr>
              )}
              {!loading &&
                (data?.by_branch || []).map((b) => {
                  const rate = b.orders_cnt > 0 ? (b.refund_cnt / b.orders_cnt) * 100 : 0;
                  return (
                    <tr key={b.branch} className="transition hover:bg-sky-50/40">
                      <td className="px-5 py-3 font-semibold">{b.branch}</td>
                      <td className="px-5 py-3 text-right text-rose-600 font-semibold">{fmt(b.refund_sum)}</td>
                      <td className="px-5 py-3 text-right">{b.refund_cnt}</td>
                      <td className="px-5 py-3 text-right text-amber-600">{fmt(b.pending_sum)}</td>
                      <td className="px-5 py-3 text-right">{b.adaptation_cnt}</td>
                      <td className="px-5 py-3 text-right">{b.prescription_cnt}</td>
                      <td className="px-5 py-3 text-right text-amber-600">{fmt(b.prescription_cost)}</td>
                      <td className="px-5 py-3 text-right">{rate.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              {!loading && !(data?.by_branch || []).length && (
                <tr>
                  <td className="px-5 py-8 text-center text-slate-500" colSpan={8}>
                    За период возвратов и замен нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* by reason */}
        <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <div className="mb-3 text-sm font-bold text-slate-900">Причины возвратов</div>
          {!loading && !(data?.by_reason || []).length && (
            <div className="text-sm text-slate-500">Нет данных</div>
          )}
          <div className="space-y-2">
            {(data?.by_reason || []).map((r) => (
              <div key={r.reason} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{REASONS[r.reason] ?? r.reason ?? '—'}</span>
                <span className="font-semibold text-slate-900">
                  {fmt(r.sum)} с <span className="text-slate-400">· {r.cnt}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* recent */}
        <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <div className="mb-3 text-sm font-bold text-slate-900">Последние операции</div>
          {!loading && !(data?.recent || []).length && (
            <div className="text-sm text-slate-500">Нет данных</div>
          )}
          <div className="space-y-2">
            {(data?.recent || []).slice(0, 12).map((r, i) => (
              <div
                key={`${r.created_at}-${r.order_id ?? 'x'}-${i}`}
                className="flex items-center justify-between rounded-xl bg-slate-50/60 ring-1 ring-slate-200 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">
                      {TYPE_RU[r.refund_type] ?? r.refund_type}
                    </span>
                    {r.status === 'pending' && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        к возврату
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-slate-500">
                    {r.branch}
                    {r.order_id ? ` · №${r.order_id}` : ''} · {REASONS[r.reason] ?? r.reason ?? '—'} ·{' '}
                    {METHOD_RU[r.method] ?? r.method}
                  </div>
                </div>
                <div className="shrink-0 font-semibold text-rose-600">−{fmt(r.amount)} с</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
