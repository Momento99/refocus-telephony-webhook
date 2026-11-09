'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, RefreshCw, Target, WalletCards } from 'lucide-react';
import type { ManagerCompensationResponse } from '@/lib/managerCompensation';

const money = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0));
const date = (value: string) => new Date(value + 'T00:00:00+06:00').toLocaleDateString('ru-RU', {
  timeZone: 'Asia/Bishkek', day: 'numeric', month: 'long',
});

export default function ManagerCompensation({ month }: { month?: string }) {
  const [localMonth, setLocalMonth] = useState(() => new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Bishkek', year: 'numeric', month: '2-digit',
  }).format(new Date()));
  const selectedMonth = month || localMonth;
  const [data, setData] = useState<ManagerCompensationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    async function load() {
      try {
        const response = await fetch('/api/manager/compensation?month=' + selectedMonth, {
          signal: controller.signal, cache: 'no-store',
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Не удалось загрузить расчёт');
        if (!controller.signal.aborted) setData(result);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Ошибка загрузки');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [selectedMonth, refresh]);

  return (
    <section className="min-w-0 space-y-5 text-slate-50">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-cyan-500"><Target className="h-5 w-5" /></div>
          <div>
            <h1 className="text-xl font-bold sm:text-2xl">План управляющей</h1>
            <p className="mt-1 text-sm text-slate-400">Доплата за управление сетью и премия за результат</p>
          </div>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {!month && <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-slate-900 px-3 ring-1 ring-slate-700">
            <CalendarDays className="h-4 w-4 shrink-0 text-cyan-400" />
            <input aria-label="Месяц расчёта" type="month" value={localMonth} onChange={event => setLocalMonth(event.target.value)}
              className="min-h-11 min-w-0 w-full bg-transparent text-base text-slate-100 outline-none" />
          </label>}
          <button type="button" aria-label="Обновить расчёт" disabled={loading} onClick={() => setRefresh(value => value + 1)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-900 text-cyan-300 ring-1 ring-slate-700 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      {error && <div role="alert" className="rounded-2xl bg-rose-950/50 p-4 text-sm text-rose-200 ring-1 ring-rose-500/30">{error}</div>}
      {loading ? <p className="py-8 text-sm text-slate-400">Загружаем расчёт…</p> : !error && data?.rows.length === 0 ?
        <p className="rounded-2xl bg-slate-900 p-5 text-sm text-slate-300 ring-1 ring-slate-700">Выберите месяц работы управляющей.</p> : !error && data?.rows.map(row => (
        <div key={row.employee_id} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div><span className="font-semibold">{row.full_name}</span><span className="ml-2 text-slate-400">{date(row.from)} — {date(row.to)}</span></div>
            <span className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs text-cyan-300">{row.closed ? 'Месяц закрыт' : 'Текущий расчёт'}</span>
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="min-w-0 rounded-2xl bg-white p-5 text-slate-900 ring-1 ring-sky-100">
              <div className="text-sm text-slate-500">Доплата за период</div>
              <div className="mt-2 break-words text-2xl font-bold tabular-nums">{money(row.fixed_for_period)} <span className="text-sm font-medium">сом</span></div>
              <div className="mt-2 text-xs leading-relaxed text-slate-500">{row.active_days} из {row.days_in_month} календарных дней · {money(row.monthly_fixed)} сом за полный месяц</div>
            </div>
            <div className="min-w-0 rounded-2xl bg-white p-5 text-slate-900 ring-1 ring-sky-100">
              <div className="text-sm text-slate-500">Начислено за управление</div>
              <div className="mt-2 break-words text-2xl font-bold tabular-nums">{money(row.total_accrued)} <span className="text-sm font-medium">сом</span></div>
              <div className="mt-2 text-xs leading-relaxed text-slate-500">Доплата {money(row.fixed_accrued)} + премия {money(row.bonus_earned)} · {row.accrued_days} дней</div>
            </div>
            <div className="min-w-0 rounded-2xl bg-white p-5 text-slate-900 ring-1 ring-sky-100">
              <div className="text-sm text-slate-500">План поступлений сети</div>
              <div className="mt-2 break-words text-2xl font-bold tabular-nums">{money(row.target_for_period)} <span className="text-sm font-medium">сом</span></div>
              <div className="mt-2 text-xs leading-relaxed text-slate-500">Пять филиалов · оплаченные клиентами деньги за вычетом возвратов</div>
            </div>
            <div className="min-w-0 rounded-2xl bg-cyan-500/10 p-5 ring-1 ring-cyan-400/20">
              <div className="flex items-center gap-2 text-sm text-cyan-200"><WalletCards className="h-4 w-4" />Премия при выполнении</div>
              <div className="mt-2 break-words text-2xl font-bold tabular-nums">{money(row.bonus_for_period)} <span className="text-sm font-medium">сом</span></div>
              <div className="mt-2 text-xs leading-relaxed text-slate-400">Итог премии определяется после завершения месяца</div>
              <div className="mt-2 text-xs text-cyan-200">Доплата вместе с премией {money(row.maximum_total)} сом</div>
            </div>
          </div>
          <div className="rounded-2xl bg-slate-900 p-5 ring-1 ring-slate-700">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div><div className="text-sm text-slate-400">Фактически получено за период</div><div className="mt-1 text-2xl font-bold tabular-nums">{money(row.net_revenue)} сом</div></div>
              <div className="text-lg font-semibold text-cyan-300">{money(row.progress)}%</div>
            </div>
            <div role="progressbar" aria-label="Выполнение плана" aria-valuenow={Math.min(100, Math.max(0, Number(row.progress)))} aria-valuemin={0} aria-valuemax={100}
              className="mt-4 h-3 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: Math.min(100, Math.max(0, Number(row.progress))) + '%' }} />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-400">Поступления {money(row.net_receipts)} сом · возвраты {money(row.refunds)} сом. Данные на {date(data.as_of_date)}.</p>
            {row.provisional_bonus > 0 && !row.closed && <p className="mt-3 text-sm text-cyan-200">По текущим поступлениям предварительная премия составляет {money(row.provisional_bonus)} сом.</p>}
          </div>
        </div>
      ))}
    </section>
  );
}
