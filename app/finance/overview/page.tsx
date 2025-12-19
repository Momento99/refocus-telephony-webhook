'use client';

import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { EChartsOption } from 'echarts';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import {
  CircleDollarSign,
  Undo2,
  Cog,
  Package,
  WalletCards,
  TrendingUp,
  TrendingDown,
  Download,
  Settings2,
  Calendar,
  Info,
} from 'lucide-react';

/* локаль dayjs */
dayjs.locale('ru');

/* ---------- ECharts без SSR ---------- */
const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

/* ---------- Типы ---------- */

type SummaryToDate = {
  days_elapsed: number;
  orders_count: number;
  total_income: number;
  total_refunds: number;
  opex_total: number;
  cogs_total: number;
  payroll_total: number;
  net_profit: number;

  // новые поля для средних чеков
  avg_frame_check?: number;
  avg_lens_check?: number;

  // диагностические поля (только на фронте)
  net_profit_db?: number;
  payroll_total_db?: number;
};

type ExpenseItem = {
  id: number;
  branch_id: number | null;
  category: string;
  amount: number;
  expense_date: string;
  comment: string | null;
  created_at: string;
};

type NetRow = {
  day: string; // YYYY-MM-DD
  orders_count: number;
  income: number;
  refunds: number;
  opex_total: number;
  cogs_total: number;
  payroll_total: number;
  net_profit: number;
};

type ExpCat = { category: string; sum: number };

// дневная зарплата из payroll-вьюхи
type PayrollDailyRow = {
  branch_id: number | null;
  day: string;
  net_day: number;
};

/* ---------- Константы ---------- */

const BRANCHES = [
  { id: 0, name: 'Общие' },
  { id: 1, name: 'Сокулук' },
  { id: 2, name: 'Беловодск' },
  { id: 3, name: 'Кара-Балта' },
  { id: 4, name: 'Кант' },
];

function fmt(n: number) {
  try {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(
      Number(n || 0),
    );
  } catch {
    return String(n ?? 0);
  }
}

/** 1 декабря / 2 декабря / ... (по умолчанию без года) */
function formatDayRu(raw: string, withYear = false): string {
  if (!raw) return '';
  const normalized = raw.replace(/\./g, '-').slice(0, 10);
  const d = dayjs(normalized);
  if (!d.isValid()) return raw;
  return d.format(withYear ? 'D MMMM YYYY' : 'D MMMM');
}

/** Перевод категорий ручных расходов в понятный русский */
function humanizeExpenseCategory(raw: string | null | undefined): string {
  if (!raw) return 'Без категории';

  const original = raw.trim();
  const c = original.toLowerCase();

  // Расходники
  if (
    c === 'cons' ||
    c === 'consum' ||
    c === 'consumable' ||
    c === 'consumables' ||
    c.startsWith('consum')
  ) {
    return 'Расходники';
  }

  // Кабели
  if (c === 'cable' || c === 'cables' || c.includes('cable')) {
    return 'Кабели и провода';
  }

  // Дорога / транспорт
  if (c === 'road' || c === 'roads' || c.includes('road')) {
    return 'Дорога';
  }

  // Аренда
  if (c === 'rent' || c === 'аренда') {
    return 'Аренда';
  }

  // Топливо
  if (c.includes('fuel') || c.includes('benzin') || c.includes('bensin')) {
    return 'Топливо';
  }

  // Такси
  if (c.includes('taxi')) {
    return 'Такси';
  }

  // Коммуналка
  if (c.includes('util') || c.includes('svet') || c.includes('electr')) {
    return 'Коммунальные услуги';
  }

  // Реклама
  if (c.includes('ad') || c.includes('promo') || c.includes('market')) {
    return 'Реклама и маркетинг';
  }

  // Ремонт
  if (c.includes('repair') || c.includes('remont')) {
    return 'Ремонт и сервис';
  }

  // Офис
  if (c.includes('office') || c.includes('канц')) {
    return 'Офис и канцтовары';
  }

  // Питание / обеды (Meal)
  if (c === 'meal' || c === 'meals' || c === 'food' || c === 'lunch') {
    return 'Питание';
  }

  // Misc / прочее
  if (c === 'misc' || c === 'miscellaneous' || c === 'other') {
    return 'Прочие расходы';
  }

  // По умолчанию — оригинал, но с заглавной буквы
  return original[0].toUpperCase() + original.slice(1);
}


function normalizeError(e: any): string {
  if (!e) return 'Неизвестная ошибка';
  if (typeof e === 'string') return e;
  if (typeof e.message === 'string' && e.message) return e.message;
  if (typeof e.error_description === 'string' && e.error_description)
    return e.error_description;
  if (typeof e.details === 'string' && e.details) return e.details;
  if (typeof e.hint === 'string' && e.hint) return e.hint;
  try {
    return JSON.stringify(e);
  } catch {
    return 'Неизвестная ошибка';
  }
}

/* ---------- Страница ---------- */

export default function FinanceOverviewPage() {
  const [branchId, setBranchId] = useState<number>(1);
  const [month, setMonth] = useState<string>(dayjs().format('YYYY-MM'));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<SummaryToDate | null>(null);
  const [recentExpenses, setRecentExpenses] = useState<ExpenseItem[]>([]);
  const [netRows, setNetRows] = useState<NetRow[]>([]);
  const [expCats, setExpCats] = useState<ExpCat[]>([]);
  const [showNetDetails, setShowNetDetails] = useState(false);

  const monthStart = useMemo(
    () => dayjs(`${month}-01`).startOf('month'),
    [month],
  );
  const monthEnd = useMemo(() => monthStart.endOf('month'), [monthStart]);
  const todayInMonth = useMemo(() => {
    const now = dayjs();
    if (now.isBefore(monthStart)) return monthStart;
    if (now.isAfter(monthEnd)) return monthEnd;
    return now;
  }, [monthStart, monthEnd]);

  const branchName = useMemo(
    () => BRANCHES.find((b) => b.id === branchId)?.name ?? 'Общие',
    [branchId],
  );

  async function loadData() {
    setLoading(true);
    setError(null);

    try {
      const sb = getBrowserSupabase();
      const fromDate = monthStart.format('YYYY-MM-DD');
      const toDate = todayInMonth.format('YYYY-MM-DD');

      /* 1) сводка ДО СЕГОДНЯ (v2 с новыми полями) */
      const { data: sumRaw, error: sErr } = await sb
        .rpc('fn_finance_summary_todate_v2', {
          p_branch_id: branchId,
          p_month: fromDate,
          p_today: toDate,
        })
        .single<SummaryToDate>();

      if (sErr) {
        console.warn('fn_finance_summary_todate_v2 error', sErr);
        setError(`Ошибка сводки: ${normalizeError(sErr)}`);
        setSummary(null);
        setRecentExpenses([]);
        setNetRows([]);
        setExpCats([]);
        return;
      }

      const sum: SummaryToDate =
        sumRaw ??
        ({
          days_elapsed: 0,
          orders_count: 0,
          total_income: 0,
          total_refunds: 0,
          opex_total: 0,
          cogs_total: 0,
          payroll_total: 0,
          net_profit: 0,
          avg_frame_check: 0,
          avg_lens_check: 0,
        } as SummaryToDate);

      /* 2) детальные показатели по дням (как есть из БД) */
      const { data: netRaw, error: nErr } = await sb
        .rpc('admin_net_profit_by_day', {
          from_dt: fromDate,
          to_dt: toDate,
          branches: branchId > 0 ? [branchName] : null,
        })
        .returns<NetRow[]>();

      if (nErr) {
        console.warn('admin_net_profit_by_day error', nErr);
        setError(`Ошибка детализации по дням: ${normalizeError(nErr)}`);
      }

      let netLocal: NetRow[] = netRaw ?? [];

      /* 3) реальные зарплаты по дням (best-effort) */
      let payrollTotal = 0;

      try {
        async function fetchPayrollView(viewName: string) {
          let q = sb
            .from(viewName)
            .select('branch_id, day, net_day')
            .gte('day', fromDate)
            .lte('day', toDate);

          if (branchId > 0) {
            q = q.eq('branch_id', branchId);
          }

          return q.returns<PayrollDailyRow[]>();
        }

        let payRows: PayrollDailyRow[] = [];
        {
          const { data: d1, error: e1 } = await fetchPayrollView(
            'v_payroll_daily_v2',
          );
          if (!e1) {
            payRows = d1 ?? [];
          } else {
            console.warn('v_payroll_daily_v2 error, try v_payroll_daily', e1);
            const { data: d2, error: e2 } = await fetchPayrollView(
              'v_payroll_daily',
            );
            if (!e2) {
              payRows = d2 ?? [];
            } else {
              console.warn('v_payroll_daily error', e2);
              payRows = [];
            }
          }
        }

        if (payRows.length > 0 && netLocal.length > 0) {
          const payrollMap = new Map<string, number>();
          (payRows ?? []).forEach((r) => {
            const d = r.day.slice(0, 10);
            const val = Number(r.net_day || 0);
            payrollMap.set(d, (payrollMap.get(d) || 0) + val);
          });

          payrollMap.forEach((v) => {
            payrollTotal += v;
          });

          netLocal = netLocal.map((r) => {
            const p = payrollMap.get(r.day) || 0;
            const income = Number(r.income || 0);
            const refunds = Number(r.refunds || 0);
            const opex = Number(r.opex_total || 0);
            const cogs = Number(r.cogs_total || 0);
            const net_profit = income - refunds - opex - cogs - p;

            return {
              ...r,
              payroll_total: p,
              net_profit,
            };
          });
        }
      } catch (e: any) {
        console.warn('payroll patch error (ignored, используем БД-значения)', e);
        payrollTotal = 0;
      }

      /* 3b) Патч сводки: если смогли посчитать реальные зарплаты — подменяем */
      const incomeSum = Number(sum.total_income ?? 0);
      const refundsSum = Number(sum.total_refunds ?? 0);
      const opexSum = Number(sum.opex_total ?? 0);
      const cogsSum = Number(sum.cogs_total ?? 0);

      let patchedSummary: SummaryToDate;

      if (payrollTotal !== 0) {
        const netFront =
          incomeSum - refundsSum - opexSum - cogsSum - payrollTotal;

        patchedSummary = {
          ...sum,
          payroll_total: payrollTotal,
          net_profit: netFront,
          net_profit_db: sum.net_profit ?? 0,
          payroll_total_db: sum.payroll_total ?? 0,
        };
      } else {
        patchedSummary = {
          ...sum,
          net_profit_db: sum.net_profit ?? 0,
          payroll_total_db: sum.payroll_total ?? 0,
        };
      }

      setSummary(patchedSummary);
      setNetRows(netLocal);

      /* 4) ручные расходы за период (последние 50) */
      let q = sb
        .from('expenses')
        .select('*')
        .gte('expense_date', fromDate)
        .lt('expense_date', dayjs(toDate).add(1, 'day').format('YYYY-MM-DD'))
        .order('expense_date', { ascending: false })
        .order('id', { ascending: false })
        .limit(50);

      if (branchId > 0) {
        // общие (null) + конкретный филиал
        q = q.or(`branch_id.eq.${branchId},branch_id.is.null`);
      }

      const { data: exp, error: eErr } = await q.returns<ExpenseItem[]>();
      if (eErr) {
        console.warn('expenses list error', eErr);
        setRecentExpenses([]);
      } else {
        setRecentExpenses(exp ?? []);
      }

      /* 5) структура ручных расходов по категориям */
      let q2 = sb
        .from('expenses')
        .select('category, amount, expense_date, branch_id')
        .gte('expense_date', fromDate)
        .lt('expense_date', dayjs(toDate).add(1, 'day').format('YYYY-MM-DD'));

      if (branchId > 0) {
        q2 = q2.or(`branch_id.eq.${branchId},branch_id.is.null`);
      }

      const { data: expAll, error: e2 } = await q2.returns<
        {
          category: string;
          amount: number;
          expense_date: string;
          branch_id: number | null;
        }[]
      >();

      if (e2) {
        console.warn('expenses agg error', e2);
        setExpCats([]);
      } else {
        const agg = new Map<string, number>();
        (expAll ?? []).forEach((r) => {
          const key = r.category || 'Без категории';
          agg.set(key, (agg.get(key) || 0) + Number(r.amount || 0));
        });
        const sorted = Array.from(agg.entries())
          .map<ExpCat>(([category, sumVal]) => ({ category, sum: sumVal }))
          .sort((a, b) => b.sum - a.sum);
        setExpCats(sorted);
      }
    } catch (e: any) {
      console.warn('loadData fatal error', e);
      setError(`Критическая ошибка загрузки: ${normalizeError(e)}`);
      setSummary(null);
      setRecentExpenses([]);
      setNetRows([]);
      setExpCats([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, month]);

  /* ---------- Доп. KPI ---------- */
  const kpis = useMemo(() => {
    if (!summary) return null;

    // маржа = чистая прибыль / доходы
    const margin =
      summary.total_income > 0
        ? Math.round((summary.net_profit / summary.total_income) * 100)
        : 0;

    const frameAvg = Number(summary.avg_frame_check ?? 0);
    const lensAvg = Number(summary.avg_lens_check ?? 0);

    return { margin, frameAvg, lensAvg };
  }, [summary]);

  /* ---------- Графики ---------- */
  const optionNetProfit: EChartsOption = useMemo(() => {
    const x = netRows.map((r) => r.day);
    return {
      grid: { top: 28, right: 14, bottom: 40, left: 64 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        valueFormatter: (v) => fmt(Number(v as number)),
      },
      xAxis: {
        type: 'category',
        data: x,
        axisLine: { lineStyle: { color: '#e2e8f0' } },
        axisLabel: {
          color: '#0f172a',
          fontSize: 12,
          formatter: (value: unknown) => formatDayRu(String(value)),
        },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: '#0f172a',
          fontSize: 12,
          formatter: (v: number) => fmt(v),
        },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      series: [
        {
          name: 'Чистая прибыль',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.08 },
          data: netRows.map((r) => r.net_profit || 0),
        },
      ],
    };
  }, [netRows]);

  const optionIncomeVsExpenses: EChartsOption = useMemo(() => {
    const x = netRows.map((r) => r.day);
    const income = netRows.map((r) => r.income || 0);
    const expenses = netRows.map(
      (r) =>
        (r.refunds || 0) +
        (r.opex_total || 0) +
        (r.cogs_total || 0) +
        (r.payroll_total || 0),
    );
    return {
      legend: {
        top: 0,
        textStyle: { color: '#0f172a', fontSize: 12, fontWeight: 500 },
      },
      grid: { top: 40, right: 14, bottom: 40, left: 64 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        valueFormatter: (v) => fmt(Number(v as number)),
      },
      xAxis: {
        type: 'category',
        data: x,
        axisLine: { lineStyle: { color: '#e2e8f0' } },
        axisLabel: {
          color: '#0f172a',
          fontSize: 12,
          formatter: (value: unknown) => formatDayRu(String(value)),
        },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: '#0f172a',
          fontSize: 12,
          formatter: (v: number) => fmt(v),
        },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      series: [
        {
          name: 'Доходы',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.06 },
          data: income,
        },
        {
          name: 'Расходы',
          type: 'bar',
          barMaxWidth: 22,
          data: expenses,
        },
      ],
    };
  }, [netRows]);

  const optionExpPie: EChartsOption = useMemo(() => {
    const top = expCats.slice(0, 12);
    const rest = expCats.slice(12);
    const restSum = rest.reduce((a, r) => a + r.sum, 0);

    const data = [
      ...top.map((r) => ({
        name: humanizeExpenseCategory(r.category),
        value: Math.round(r.sum),
      })),
      ...(restSum > 0
        ? [{ name: 'Прочее', value: Math.round(restSum) }]
        : []),
    ];

    return {
      tooltip: {
        trigger: 'item',
        valueFormatter: (v) => fmt(Number(v as number)),
      },
      legend: {
        top: 0,
        textStyle: { color: '#0f172a', fontSize: 12 },
      },
      series: [
        {
          type: 'pie',
          radius: ['35%', '70%'],
          center: ['50%', '58%'],
          label: { formatter: '{b}: {c}' },
          data,
        },
      ],
    };
  }, [expCats]);

  /* ---------- Экспорт ---------- */
  function exportNetCsv() {
    const rows = [
      [
        'day',
        'orders_count',
        'income',
        'refunds',
        'opex_total',
        'cogs_total',
        'payroll_total',
        'net_profit',
      ],
      ...netRows.map((r) => [
        r.day,
        r.orders_count,
        r.income,
        r.refunds,
        r.opex_total,
        r.cogs_total,
        r.payroll_total,
        r.net_profit,
      ]),
    ];
    const csv = rows.map((r) => r.join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `net_profit_${branchName}_${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const netPositive = (summary?.net_profit ?? 0) >= 0;

  return (
    <div className="min-h-[100dvh] text-slate-900">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        {/* Header */}
        <div className="rounded-3xl border border-sky-100/80 bg-white/95 backdrop-blur-2xl px-4 py-5 sm:px-6 lg:px-8 shadow-[0_22px_80px_rgba(15,23,42,0.22)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 via-cyan-400 to-emerald-400 text-slate-950 shadow-[0_18px_55px_rgba(56,189,248,0.7)]">
                <CircleDollarSign className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-[20px] md:text-[24px] font-semibold leading-tight text-slate-900">
                  Финансовый обзор
                </h1>
                <p className="mt-1 text-xs md:text-sm text-slate-500">
                  Доходы, расходы, реальные зарплаты и чистая прибыль по
                  выбранному филиалу и месяцу.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
              <span className="inline-flex items-center rounded-full border border-sky-100 bg-sky-50/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-sky-700">
                {branchName.toUpperCase()}
              </span>
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-700">
                <Calendar className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
                {monthStart.format('MMMM YYYY')}
              </span>
              <Link
                href={`/finance/settings?branch=${branchId}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm hover:border-sky-400 hover:text-sky-700 transition"
              >
                <Settings2 className="h-4 w-4" />
                Настройки ставок
              </Link>
              <button
                onClick={exportNetCsv}
                disabled={netRows.length === 0}
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-sky-500 via-cyan-500 to-indigo-500 px-3.5 py-1.5 text-[11px] font-semibold text-white shadow-[0_16px_40px_rgba(56,189,248,0.65)] hover:opacity-95 disabled:opacity-40 transition"
              >
                <Download className="h-3.5 w-3.5" />
                Экспорт CSV
              </button>
            </div>
          </div>
        </div>

        {/* Фильтры */}
        <div className="rounded-3xl border border-sky-100/80 bg-white/95 backdrop-blur-2xl px-4 py-4 sm:px-6 sm:py-4 shadow-[0_18px_60px_rgba(15,23,42,0.18)]">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col">
              <label className="text-[11px] font-medium text-slate-500">
                Филиал
              </label>
              <select
                className="mt-1 w-[180px] rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:ring-2 focus:ring-sky-300"
                value={branchId}
                onChange={(e) => setBranchId(Number(e.target.value))}
              >
                {BRANCHES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col">
              <label className="text-[11px] font-medium text-slate-500">
                Месяц
              </label>
              <div className="relative mt-1">
                <input
                  type="month"
                  className="w-[190px] rounded-2xl border border-slate-200 bg-white/95 pl-9 pr-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:ring-2 focus:ring-sky-300"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                />
                <Calendar className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              </div>
            </div>

            <button
              onClick={loadData}
              disabled={loading}
              className="mt-1 inline-flex items-center rounded-2xl bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500 px-5 py-2.5 text-sm font-medium text-white shadow-[0_16px_40px_rgba(34,197,235,0.75)] hover:opacity-95 disabled:opacity-60 transition"
            >
              {loading ? 'Обновляю…' : 'Обновить данные'}
            </button>
          </div>

          <div className="mt-2 text-xs text-slate-500">
            Период: {formatDayRu(monthStart.format('YYYY-MM-DD'), true)} —{' '}
            {formatDayRu(todayInMonth.format('YYYY-MM-DD'), true)}
            {summary && (
              <span className="ml-2 text-slate-500">
                · Дней учтено: {summary.days_elapsed} · Заказов:{' '}
                {summary.orders_count}
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50/95 px-4 py-3 text-sm text-rose-700 shadow-[0_14px_40px_rgba(248,113,113,0.35)]">
            {error}
          </div>
        )}

        {/* KPI блоки */}
        {summary && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
              <StatCard
                title="Доходы"
                value={fmt(summary.total_income)}
                icon={CircleDollarSign}
                gradient="from-emerald-400/55 via-teal-400/45 to-cyan-400/45"
                subtitle="Все оплаченные заказы за выбранный период"
              />
              <StatCard
                title="Возвраты"
                value={fmt(summary.total_refunds)}
                icon={Undo2}
                gradient="from-sky-400/55 via-indigo-400/40 to-sky-500/45"
                subtitle="Сумма оформленных возвратов заказов"
              />
              <StatCard
                title="OPEX (на сегодня)"
                value={fmt(summary.opex_total)}
                icon={Cog}
                gradient="from-amber-400/55 via-orange-400/45 to-rose-400/40"
                subtitle="Постоянные расходы + ручные расходы"
              />
              <StatCard
                title="COGS (на сегодня)"
                value={fmt(summary.cogs_total)}
                icon={Package}
                gradient="from-violet-400/55 via-fuchsia-400/45 to-pink-400/45"
                subtitle="Себестоимость заказов по ставкам"
              />
              <StatCard
                title="Зарплаты (реальные)"
                value={fmt(summary.payroll_total)}
                icon={WalletCards}
                gradient="from-cyan-400/55 via-sky-400/45 to-indigo-400/45"
                subtitle="Net-день сотрудников за период"
              />
              <StatCard
                title="Чистая прибыль"
                value={fmt(summary.net_profit)}
                icon={netPositive ? TrendingUp : TrendingDown}
                valueClass={netPositive ? 'text-emerald-600' : 'text-rose-600'}
                gradient={
                  netPositive
                    ? 'from-emerald-400/60 via-teal-400/50 to-lime-400/45'
                    : 'from-rose-500/60 via-orange-400/55 to-amber-400/45'
                }
                subtitle="Доходы − возвраты − OPEX − COGS − реальные зарплаты"
              />
            </div>

            {/* строка KPI: маржа + средний чек оправы + средний чек линз */}
            <div className="grid gap-4 sm:grid-cols-3">
              <KpiCard label="Маржа (%)" value={`${kpis?.margin ?? 0}%`} />
              <KpiCard
                label="Средний чек оправы"
                value={fmt(kpis?.frameAvg ?? 0)}
              />
              <KpiCard
                label="Средний чек линз"
                value={fmt(kpis?.lensAvg ?? 0)}
              />
            </div>
          </>
        )}

        {/* Графики */}
        <ChartCard
          title="Чистая прибыль по дням"
          action={summary && (
            <button
              onClick={() => setShowNetDetails(true)}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm hover:border-sky-400 hover:text-sky-700 transition"
            >
              <Info className="h-3.5 w-3.5 text-slate-400" />
              Детали прибыли
            </button>
          )}
        >
          <ReactECharts
            option={optionNetProfit}
            opts={{ renderer: 'svg' }}
            style={{ height: '100%', width: '100%' }}
          />
        </ChartCard>

        <ChartCard title="Доходы vs Расходы по дням">
          <ReactECharts
            option={optionIncomeVsExpenses}
            opts={{ renderer: 'svg' }}
            style={{ height: '100%', width: '100%' }}
          />
        </ChartCard>

        <ChartCard title="Структура ручных расходов (категории)" height={360}>
          <ReactECharts
            option={optionExpPie}
            opts={{ renderer: 'svg' }}
            style={{ height: '100%', width: '100%' }}
          />
        </ChartCard>

        {/* Детализация по дням */}
        {netRows.length > 0 && (
          <div className="rounded-2xl border border-slate-100/80 bg-white/95 backdrop-blur-sm shadow-[0_20px_60px_rgba(15,23,42,0.18)]">
            <div className="flex items-center justify-between px-5 pt-4">
              <div className="text-[15px] font-semibold text-slate-800">
                Детализация по дням
              </div>
              <div className="ml-4 h-px flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
            </div>
            <div className="p-5 overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <Th>Дата</Th>
                    <Th align="right">Доход</Th>
                    <Th align="right">Возвраты</Th>
                    <Th align="right">OPEX</Th>
                    <Th align="right">COGS</Th>
                    <Th align="right">Зарплаты</Th>
                    <Th align="right">Чистая прибыль</Th>
                  </tr>
                </thead>
                <tbody>
                  {netRows.map((r) => (
                    <tr
                      key={r.day}
                      className="odd:bg-white even:bg-slate-50/60"
                    >
                      <Td>{formatDayRu(r.day)}</Td>
                      <Td align="right">{fmt(r.income)}</Td>
                      <Td align="right">{fmt(r.refunds)}</Td>
                      <Td align="right">{fmt(r.opex_total)}</Td>
                      <Td align="right">{fmt(r.cogs_total)}</Td>
                      <Td align="right">{fmt(r.payroll_total)}</Td>
                      <Td
                        align="right"
                        className={
                          r.net_profit < 0 ? 'text-rose-600' : 'text-emerald-600'
                        }
                      >
                        {fmt(r.net_profit)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Последние расходы */}
        <div className="rounded-2xl border border-slate-100/80 bg-white/95 backdrop-blur-sm shadow-[0_20px_60px_rgba(15,23,42,0.18)]">
          <div className="flex items-center justify-between px-5 pt-4">
            <div className="text-[15px] font-semibold text-slate-800">
              Последние расходы (за период)
            </div>
            <div className="ml-4 h-px flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
          </div>
          <div className="p-5">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-[13px] font-medium text-slate-700">
                    Дата
                  </th>
                  <th className="px-3 py-2 text-left text-[13px] font-medium text-slate-700">
                    Категория
                  </th>
                  <th className="px-3 py-2 text-right text-[13px] font-medium text-slate-700">
                    Сумма
                  </th>
                  <th className="px-3 py-2 text-left text-[13px] font-medium text-slate-700">
                    Комментарий
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentExpenses.length === 0 && (
                  <tr>
                    <td
                      className="px-3 py-3 text-center text-slate-400"
                      colSpan={4}
                    >
                      Нет расходов за выбранный период.
                    </td>
                  </tr>
                )}
                {recentExpenses.map((it) => (
                  <tr
                    key={it.id}
                    className="odd:bg-white even:bg-slate-50/60"
                  >
                    <td className="px-3 py-2">
                      {formatDayRu(it.expense_date)}
                    </td>
                    <td className="px-3 py-2">
                      {humanizeExpenseCategory(it.category)}
                    </td>
                    <td className="px-3 py-2 text-right">{fmt(it.amount)}</td>
                    <td className="px-3 py-2">
                      {it.comment ? it.comment : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {summary && showNetDetails && (
          <NetDetailsModal
            summary={summary}
            onClose={() => setShowNetDetails(false)}
          />
        )}
      </div>
    </div>
  );
}

/* ---------- Мелкие компоненты ---------- */

type IconType = React.ComponentType<React.SVGProps<SVGSVGElement>>;

function StatCard({
  title,
  value,
  icon,
  valueClass,
  gradient = 'from-slate-200 to-slate-100',
  subtitle,
}: {
  title: string;
  value: string | number;
  icon: IconType;
  valueClass?: string;
  gradient?: string;
  subtitle?: string;
}) {
  const Icon = icon;
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-100/80 bg-white/95 backdrop-blur-sm p-4 shadow-[0_18px_60px_rgba(15,23,42,0.16)] transition hover:shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
      <div
        className={`pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-gradient-to-br ${gradient} blur-2xl opacity-70 group-hover:opacity-100`}
      />
      <div className="relative z-10 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div
            className={`grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br ${gradient} text-slate-950 shadow-[0_14px_40px_rgba(15,23,42,0.45)]`}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
              {title}
            </div>
            <div
              className={`mt-1 text-xl font-semibold ${
                valueClass ?? 'text-slate-900'
              }`}
            >
              {value}
            </div>
          </div>
        </div>
        {subtitle && (
          <div className="pl-[52px] text-[11px] leading-snug text-slate-500">
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-slate-100/80 bg-white/95 backdrop-blur-sm p-4 shadow-[0_18px_60px_rgba(15,23,42,0.16)]">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function ChartCard({
  title,
  height = 340,
  children,
  action,
}: {
  title: React.ReactNode;
  height?: number;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-100/80 bg-white/95 backdrop-blur-sm shadow-[0_20px_60px_rgba(15,23,42,0.18)]">
      <div className="flex items-center justify-between px-5 pt-4">
        <div className="text-[15px] font-semibold text-slate-800">{title}</div>
        <div className="flex items-center gap-3">
          {action}
          <div className="h-px w-24 sm:w-32 bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
        </div>
      </div>
      <div className="p-5" style={{ height }}>
        {children}
      </div>
    </div>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <th
      className={`px-3 py-2 text-[13px] font-medium text-slate-700 ${
        align === 'right'
          ? 'text-right'
          : align === 'center'
          ? 'text-center'
          : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <td
      className={`px-3 py-2 text-sm ${
        align === 'right'
          ? 'text-right'
          : align === 'center'
          ? 'text-center'
          : 'text-left'
      }`}
    >
      {children}
    </td>
  );
}

/* ---------- Модалка деталей чистой прибыли ---------- */

function NetDetailsModal({
  summary,
  onClose,
}: {
  summary: SummaryToDate;
  onClose: () => void;
}) {
  const income = Number(summary.total_income || 0);
  const refunds = Number(summary.total_refunds || 0);
  const opex = Number(summary.opex_total || 0);
  const cogs = Number(summary.cogs_total || 0);
  const payroll = Number(summary.payroll_total || 0);

  const netFront = income - refunds - opex - cogs - payroll;
  const netFromDb = summary.net_profit_db ?? summary.net_profit ?? 0;
  const diff = netFromDb - netFront;

  const payrollDb =
    summary.payroll_total_db !== undefined
      ? Number(summary.payroll_total_db)
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">
            Детали расчёта чистой прибыли
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-sm"
          >
            ✕
          </button>
        </div>

        <div className="space-y-1 text-sm text-slate-800">
          <Row label="Доходы (total_income)" value={income} />
          <Row label="Минус возвраты (total_refunds)" value={-refunds} />
          <Row label="Минус OPEX (opex_total)" value={-opex} />
          <Row label="Минус COGS (cogs_total)" value={-cogs} />
          <Row label="Минус зарплаты (payroll_total)" value={-payroll} />
        </div>

        <div className="mt-3 border-t border-slate-200 pt-3 space-y-1 text-sm text-slate-800">
          <Row label="Итого по формуле (на фронте)" value={netFront} bold />
          <Row
            label="net_profit из БД (fn_finance_summary_todate_v2)"
            value={netFromDb}
          />
          {payrollDb !== null && payrollDb !== payroll && (
            <Row label="payroll_total из БД" value={payrollDb} small muted />
          )}
          <Row
            label="Разница (БД − формула фронта)"
            value={diff}
            small
            muted={diff === 0}
            highlight={diff !== 0}
          />
        </div>

        <p className="mt-3 text-[11px] leading-snug text-slate-500">
          Фронт считает чистую прибыль по формуле «Доходы − Возвраты − OPEX −
          COGS − реальные зарплаты (данные из payroll-вьюхи, если доступны)».
          Если разница с net_profit из БД не равна нулю, значит SQL-функция
          использует свою формулу.
        </p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  small,
  muted,
  highlight,
}: {
  label: string;
  value: number;
  bold?: boolean;
  small?: boolean;
  muted?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex justify-between ${
        small ? 'text-xs' : 'text-sm'
      } ${muted ? 'text-slate-500' : 'text-slate-800'}`}
    >
      <span>{label}</span>
      <span
        className={[
          bold ? 'font-semibold' : '',
          highlight && value !== 0
            ? value > 0
              ? 'text-emerald-600'
              : 'text-rose-600'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {fmt(value)}
      </span>
    </div>
  );
}
