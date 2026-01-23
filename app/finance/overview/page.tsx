'use client';

import React, { useEffect, useMemo, useState } from 'react';
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
  X,
} from 'lucide-react';

/* локаль dayjs */
dayjs.locale('ru');

/* ---------- ECharts без SSR ---------- */
const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

/* ---------- ВАЖНО: дата старта учёта ---------- */
/**
 * По твоим словам: первые данные пошли с 14–15 ноября прошлого года.
 * Ставим минимальную дату расчёта как 2025-11-14 (если текущий год 2026).
 * НИ ОДИН отчёт не должен начинаться раньше этой даты, если период пересекает её.
 */
const DATA_START_ISO = '2025-11-14';
const DATA_START = dayjs(DATA_START_ISO).startOf('day');

function clampPeriodToDataStart(from: dayjs.Dayjs, to: dayjs.Dayjs) {
  let f = from.startOf('day');
  let t = to.startOf('day');

  const today = dayjs().startOf('day');
  if (t.isAfter(today)) t = today;

  // если период вообще целиком ДО старта учёта — не трогаем (будет “нет данных”)
  if (t.isBefore(DATA_START)) {
    if (t.isBefore(f)) {
      const tmp = f;
      f = t;
      t = tmp;
    }
    return { from: f, to: t };
  }

  // если период пересекает старт учёта — clamp from
  if (f.isBefore(DATA_START)) f = DATA_START;

  if (t.isBefore(f)) t = f;
  return { from: f, to: t };
}

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

  // иногда RPC в “Общие” возвращает по филиалам — оставляем поля optional
  branch_id?: number | null;
  branch_name?: string | null;
  branch?: string | null;

  orders_count: number;
  income: number;
  refunds: number;
  opex_total: number;
  cogs_total: number;
  payroll_total: number;
  net_profit: number;
};

type ExpCat = { category: string; sum: number };

type PayrollDailyRow = {
  branch_id: number | null;
  day: string;
  net_day: number;
};

/* ---------- Константы ---------- */

const BRANCHES = [
  { id: 0, name: 'Общие' },
  { id: 1, name: 'Сокулук' },
  { id: 2, name: 'Беловодск' }, // ВЕРНУЛИ
  { id: 3, name: 'Кара-Балта' },
  { id: 4, name: 'Кант' },
];

/* ---------- utils ---------- */

function fmt(n: number) {
  try {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(n || 0));
  } catch {
    return String(n ?? 0);
  }
}

function toNum(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** 1 декабря / 2 декабря / ... (по умолчанию без года) */
function formatDayRu(raw: string, withYear = false): string {
  if (!raw) return '';
  const normalized = raw.replace(/\./g, '-').slice(0, 10);
  const d = dayjs(normalized);
  if (!d.isValid()) return raw;
  return d.format(withYear ? 'D MMMM YYYY' : 'D MMMM');
}

function isSunday(isoDate: string): boolean {
  const d = dayjs(isoDate.slice(0, 10));
  return d.isValid() && d.day() === 0; // 0 = Sunday
}

function countDaysExcludingSundays(fromISO: string, toISO: string): number {
  let d = dayjs(fromISO).startOf('day');
  const end = dayjs(toISO).startOf('day');
  if (!d.isValid() || !end.isValid()) return 0;
  if (d.isAfter(end)) return 0;

  let cnt = 0;
  while (!d.isAfter(end)) {
    if (d.day() !== 0) cnt += 1;
    d = d.add(1, 'day');
  }
  return cnt;
}

/** Перевод категорий ручных расходов в понятный русский */
function humanizeExpenseCategory(raw: string | null | undefined): string {
  if (!raw) return 'Без категории';

  const original = raw.trim();
  const c = original.toLowerCase();

  if (c === 'cons' || c === 'consum' || c === 'consumable' || c === 'consumables' || c.startsWith('consum')) {
    return 'Расходники';
  }

  if (c === 'cable' || c === 'cables' || c.includes('cable')) return 'Кабели и провода';
  if (c === 'road' || c === 'roads' || c.includes('road')) return 'Дорога';
  if (c === 'rent' || c === 'аренда') return 'Аренда';
  if (c.includes('fuel') || c.includes('benzin') || c.includes('bensin')) return 'Топливо';
  if (c.includes('taxi')) return 'Такси';
  if (c.includes('util') || c.includes('svet') || c.includes('electr')) return 'Коммунальные услуги';
  if (c.includes('ad') || c.includes('promo') || c.includes('market')) return 'Реклама и маркетинг';
  if (c.includes('repair') || c.includes('remont')) return 'Ремонт и сервис';
  if (c.includes('office') || c.includes('канц')) return 'Офис и канцтовары';
  if (c === 'meal' || c === 'meals' || c === 'food' || c === 'lunch') return 'Питание';
  if (c === 'misc' || c === 'miscellaneous' || c === 'other') return 'Прочие расходы';

  return original[0].toUpperCase() + original.slice(1);
}

function normalizeError(e: any): string {
  if (!e) return 'Неизвестная ошибка';
  if (typeof e === 'string') return e;
  if (typeof e.message === 'string' && e.message) return e.message;
  if (typeof e.error_description === 'string' && e.error_description) return e.error_description;
  if (typeof e.details === 'string' && e.details) return e.details;
  if (typeof e.hint === 'string' && e.hint) return e.hint;
  try {
    return JSON.stringify(e);
  } catch {
    return 'Неизвестная ошибка';
  }
}

/* ---------- UI helpers ---------- */

type IconType = React.ComponentType<React.SVGProps<SVGSVGElement>>;

function SoftPrimaryButton({
  children,
  className = '',
  disabled,
  onClick,
  type = 'button',
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white',
        'bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400',
        'shadow-[0_18px_55px_rgba(34,197,235,0.55)]',
        'hover:opacity-95 active:opacity-90',
        'focus:outline-none focus:ring-2 focus:ring-teal-300/70',
        'disabled:opacity-45 disabled:cursor-not-allowed',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function SoftGhostButton({
  children,
  className = '',
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium',
        'bg-white/85 hover:bg-white text-teal-700',
        'ring-1 ring-teal-200',
        'shadow-[0_14px_40px_rgba(15,23,42,0.12)]',
        'focus:outline-none focus:ring-2 focus:ring-teal-300/60',
        'disabled:opacity-45 disabled:cursor-not-allowed',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function GlassSection({
  children,
  className = '',
  tone = 'money',
}: {
  children: React.ReactNode;
  className?: string;
  tone?: 'money' | 'danger' | 'neutral';
}) {
  const toneBg =
    tone === 'danger'
      ? 'from-white via-rose-50 to-amber-50/85'
      : tone === 'neutral'
      ? 'from-white via-slate-50 to-slate-50/85'
      : 'from-white via-slate-50 to-sky-50/85';

  const toneRing =
    tone === 'danger'
      ? 'ring-rose-200/80'
      : tone === 'neutral'
      ? 'ring-slate-200/80'
      : 'ring-sky-200/80';

  return (
    <div
      className={[
        'rounded-3xl bg-gradient-to-br',
        toneBg,
        'ring-1',
        toneRing,
        'backdrop-blur-xl',
        'shadow-[0_22px_70px_rgba(15,23,42,0.20)]',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}

/* ---------- helpers: aggregation ---------- */

function aggregateNetRowsByDay(rows: NetRow[]): NetRow[] {
  const map = new Map<string, NetRow>();

  for (const r of rows) {
    const day = String(r.day).slice(0, 10);
    const prev = map.get(day);
    if (!prev) {
      map.set(day, {
        day,
        orders_count: toNum(r.orders_count),
        income: toNum(r.income),
        refunds: toNum(r.refunds),
        opex_total: toNum(r.opex_total),
        cogs_total: toNum(r.cogs_total),
        payroll_total: toNum(r.payroll_total),
        net_profit: toNum(r.net_profit),
        branch_id: null,
        branch_name: null,
        branch: null,
      });
    } else {
      prev.orders_count += toNum(r.orders_count);
      prev.income += toNum(r.income);
      prev.refunds += toNum(r.refunds);
      prev.opex_total += toNum(r.opex_total);
      prev.cogs_total += toNum(r.cogs_total);
      prev.payroll_total += toNum(r.payroll_total);
      prev.net_profit += toNum(r.net_profit);
      map.set(day, prev);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));
}

function recomputeSummaryFromNetRows(base: SummaryToDate, rowsNoSunday: NetRow[], fromDate: string, toDate: string): SummaryToDate {
  const totals = rowsNoSunday.reduce(
    (acc, r) => {
      acc.orders += toNum(r.orders_count);
      acc.income += toNum(r.income);
      acc.refunds += toNum(r.refunds);
      acc.opex += toNum(r.opex_total);
      acc.cogs += toNum(r.cogs_total);
      acc.payroll += toNum(r.payroll_total);
      acc.net += toNum(r.net_profit);
      return acc;
    },
    { orders: 0, income: 0, refunds: 0, opex: 0, cogs: 0, payroll: 0, net: 0 },
  );

  const daysElapsedNoSunday = countDaysExcludingSundays(fromDate, toDate);

  return {
    ...base,
    days_elapsed: daysElapsedNoSunday,
    orders_count: totals.orders,
    total_income: totals.income,
    total_refunds: totals.refunds,
    opex_total: totals.opex,
    cogs_total: totals.cogs,
    payroll_total: totals.payroll,
    net_profit: totals.net,
  };
}

/* ---------- Страница ---------- */

type PeriodMode = 'month' | 'year' | 'range' | 'all';

export default function FinanceOverviewPage() {
  const [branchId, setBranchId] = useState<number>(1);

  // Период
  const [periodMode, setPeriodMode] = useState<PeriodMode>('month');
  const [month, setMonth] = useState<string>(dayjs().format('YYYY-MM'));
  const [year, setYear] = useState<string>(dayjs().format('YYYY'));
  const [rangeFrom, setRangeFrom] = useState<string>(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [rangeTo, setRangeTo] = useState<string>(dayjs().format('YYYY-MM-DD'));

  // В “Общие” по умолчанию НЕ включаем “центральные” (branch_id = null) расходы в списках расходов,
  // чтобы “Общие” совпадало с суммой филиалов и не «взрывалось» от закупов/общих расходов.
  const [includeCentralInCommon, setIncludeCentralInCommon] = useState<boolean>(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<SummaryToDate | null>(null);
  const [recentExpenses, setRecentExpenses] = useState<ExpenseItem[]>([]);
  const [netRows, setNetRows] = useState<NetRow[]>([]);
  const [expCats, setExpCats] = useState<ExpCat[]>([]);
  const [showNetDetails, setShowNetDetails] = useState(false);

  const branchName = useMemo(() => BRANCHES.find((b) => b.id === branchId)?.name ?? 'Общие', [branchId]);

  const period = useMemo(() => {
    // 1) raw from/to + label
    let rawFrom: dayjs.Dayjs;
    let rawTo: dayjs.Dayjs;
    let label: string;

    if (periodMode === 'all') {
      rawFrom = DATA_START;
      rawTo = dayjs().startOf('day');
      label = 'Всё время';
      return { from: rawFrom, to: rawTo, label };
    }

    if (periodMode === 'year') {
      const y = Number(year) || dayjs().year();
      rawFrom = dayjs(`${String(y)}-01-01`).startOf('year');
      const rawEnd = rawFrom.endOf('year');
      rawTo = dayjs().isAfter(rawEnd) ? rawEnd.startOf('day') : dayjs().startOf('day');
      label = String(y);

      const clamped = clampPeriodToDataStart(rawFrom, rawTo);
      return { ...clamped, label };
    }

    if (periodMode === 'range') {
      rawFrom = dayjs(rangeFrom).startOf('day');
      rawTo = dayjs(rangeTo).startOf('day');

      if (!rawFrom.isValid()) rawFrom = dayjs().startOf('month');
      if (!rawTo.isValid()) rawTo = dayjs().startOf('day');

      if (rawTo.isBefore(rawFrom)) {
        const tmp = rawFrom;
        rawFrom = rawTo;
        rawTo = tmp;
      }

      const clamped = clampPeriodToDataStart(rawFrom, rawTo);
      label = `${formatDayRu(clamped.from.format('YYYY-MM-DD'), true)} — ${formatDayRu(clamped.to.format('YYYY-MM-DD'), true)}`;
      return { ...clamped, label };
    }

    // month
    const mStart = dayjs(`${month}-01`).startOf('month');
    const mEnd = mStart.endOf('month');
    rawFrom = mStart.startOf('day');
    rawTo = dayjs().isAfter(mEnd) ? mEnd.startOf('day') : dayjs().startOf('day');
    label = mStart.format('MMMM YYYY');

    const clamped = clampPeriodToDataStart(rawFrom, rawTo);
    return { ...clamped, label };
  }, [periodMode, month, year, rangeFrom, rangeTo]);

  const fromDate = useMemo(() => period.from.format('YYYY-MM-DD'), [period]);
  const toDate = useMemo(() => period.to.format('YYYY-MM-DD'), [period]);

  async function loadData() {
    setLoading(true);
    setError(null);

    try {
      const sb = getBrowserSupabase();

      /* 1) сводка (как вернул SQL) — сохраняем для диагностики (avg checks берём отсюда) */
      const { data: sumRaw, error: sErr } = await sb
        .rpc('fn_finance_summary_todate_v2', {
          p_branch_id: branchId,
          p_month: fromDate,
          p_today: toDate,
        })
        .single<SummaryToDate>();

      if (sErr) {
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

      /* 2) net по дням:
            - если выбран конкретный филиал: один вызов
            - если “Общие”: делаем по одному вызову на каждый филиал и суммируем
              (так “Общие” = сумма филиалов, без «левых» общих/складских строк)
      */
      let netLocal: NetRow[] = [];

      if (branchId > 0) {
        const { data: netRaw, error: nErr } = await sb
          .rpc('admin_net_profit_by_day', {
            from_dt: fromDate,
            to_dt: toDate,
            branches: [branchName],
          })
          .returns<NetRow[]>();

        if (nErr) setError(`Ошибка детализации по дням: ${normalizeError(nErr)}`);

        netLocal = (netRaw ?? []).map((r: any) => ({
          day: String(r.day ?? '').slice(0, 10),
          branch_id: branchId,
          branch_name: branchName,
          branch: r.branch ?? branchName,
          orders_count: toNum(r.orders_count),
          income: toNum(r.income),
          refunds: toNum(r.refunds),
          opex_total: toNum(r.opex_total),
          cogs_total: toNum(r.cogs_total),
          payroll_total: toNum(r.payroll_total),
          net_profit: toNum(r.net_profit),
        }));
      } else {
        const activeBranches = BRANCHES.filter((b) => b.id !== 0);

        const results = await Promise.all(
          activeBranches.map(async (b) => {
            const { data, error } = await sb
              .rpc('admin_net_profit_by_day', {
                from_dt: fromDate,
                to_dt: toDate,
                branches: [b.name],
              })
              .returns<NetRow[]>();

            if (error) {
              console.warn('admin_net_profit_by_day error (branch)', b.name, error);
              return [] as NetRow[];
            }

            return (data ?? []).map((r: any) => ({
              day: String(r.day ?? '').slice(0, 10),
              branch_id: b.id,
              branch_name: b.name,
              branch: r.branch ?? b.name,
              orders_count: toNum(r.orders_count),
              income: toNum(r.income),
              refunds: toNum(r.refunds),
              opex_total: toNum(r.opex_total),
              cogs_total: toNum(r.cogs_total),
              payroll_total: toNum(r.payroll_total),
              net_profit: toNum(r.net_profit),
            })) as NetRow[];
          }),
        );

        netLocal = results.flat();
      }

      /* 3) реальные зарплаты по дням:
            - строим payrollMap по ключу day__branch_id
            - патчим net_profit = income - refunds - opex - cogs - payroll
            - если “Общие” => после патча агрегируем в 1 строку на день
      */
      try {
        async function fetchPayrollView(viewName: string) {
          let q = sb
            .from(viewName)
            .select('branch_id, day, net_day')
            .gte('day', fromDate)
            .lte('day', toDate);

          if (branchId > 0) q = q.eq('branch_id', branchId);

          return q.returns<PayrollDailyRow[]>();
        }

        let payRows: PayrollDailyRow[] = [];
        {
          const { data: d1, error: e1 } = await fetchPayrollView('v_payroll_daily_v2');
          if (!e1) {
            payRows = d1 ?? [];
          } else {
            const { data: d2, error: e2 } = await fetchPayrollView('v_payroll_daily');
            payRows = e2 ? [] : d2 ?? [];
          }
        }

        const keyDayBranch = (day: string, bid: number | null | undefined) => `${day.slice(0, 10)}__${bid ?? 'null'}`;

        if (payRows.length > 0 && netLocal.length > 0) {
          const payrollMap = new Map<string, number>();

          for (const r of payRows) {
            const d = String(r.day).slice(0, 10);
            const bid = r.branch_id ?? null;
            const k = keyDayBranch(d, bid);
            payrollMap.set(k, (payrollMap.get(k) || 0) + toNum(r.net_day));
          }

          netLocal = netLocal.map((r) => {
            const d = r.day.slice(0, 10);
            const bid = r.branch_id ?? (branchId > 0 ? branchId : null);
            const p = payrollMap.get(keyDayBranch(d, bid)) || 0;

            const income = toNum(r.income);
            const refunds = toNum(r.refunds);
            const opex = toNum(r.opex_total);
            const cogs = toNum(r.cogs_total);
            const net_profit = income - refunds - opex - cogs - p;

            return {
              ...r,
              payroll_total: p,
              net_profit,
            };
          });
        }

        if (branchId === 0) netLocal = aggregateNetRowsByDay(netLocal);
      } catch (e) {
        console.warn('payroll patch error (ignored)', e);
        if (branchId === 0) netLocal = aggregateNetRowsByDay(netLocal);
      }

      /* 4) воскресенье исключаем */
      const netNoSunday = netLocal.filter((r) => !isSunday(r.day));

      /* 5) сводка для UI: пересчитываем из netRows (без воскресенья),
            но сохраняем то, что вернула БД, в diagnostic поля */
      const baseForUi: SummaryToDate = {
        ...sum,
        net_profit_db: sum.net_profit ?? 0,
        payroll_total_db: sum.payroll_total ?? 0,
      };

      const recomputed = recomputeSummaryFromNetRows(baseForUi, netNoSunday, fromDate, toDate);

      setSummary(recomputed);
      setNetRows(netNoSunday);

      /* 6) ручные расходы (последние 50)
            - если филиал: показываем branch + общие (null) как раньше
            - если “Общие”: по умолчанию НЕ показываем null (центральные)
      */
      let q = sb
        .from('expenses')
        .select('*')
        .gte('expense_date', fromDate)
        .lt('expense_date', dayjs(toDate).add(1, 'day').format('YYYY-MM-DD'))
        .order('expense_date', { ascending: false })
        .order('id', { ascending: false })
        .limit(50);

      if (branchId > 0) {
        q = q.or(`branch_id.eq.${branchId},branch_id.is.null`);
      } else {
        if (!includeCentralInCommon) q = q.not('branch_id', 'is', null);
      }

      const { data: exp, error: eErr } = await q.returns<ExpenseItem[]>();
      if (eErr) {
        console.warn('expenses list error', eErr);
        setRecentExpenses([]);
      } else {
        const filtered = (exp ?? []).filter((it) => !isSunday(String(it.expense_date).slice(0, 10)));
        setRecentExpenses(filtered);
      }

      /* 7) структура расходов по категориям */
      let q2 = sb
        .from('expenses')
        .select('category, amount, expense_date, branch_id')
        .gte('expense_date', fromDate)
        .lt('expense_date', dayjs(toDate).add(1, 'day').format('YYYY-MM-DD'));

      if (branchId > 0) {
        q2 = q2.or(`branch_id.eq.${branchId},branch_id.is.null`);
      } else {
        if (!includeCentralInCommon) q2 = q2.not('branch_id', 'is', null);
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

        (expAll ?? [])
          .filter((r) => !isSunday(String(r.expense_date).slice(0, 10)))
          .forEach((r) => {
            const key = r.category || 'Без категории';
            agg.set(key, (agg.get(key) || 0) + toNum(r.amount));
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
  }, [branchId, periodMode, month, year, rangeFrom, rangeTo, includeCentralInCommon]);

  /* ---------- Доп. KPI ---------- */
  const kpis = useMemo(() => {
    if (!summary) return null;

    const margin = summary.total_income > 0 ? Math.round((summary.net_profit / summary.total_income) * 100) : 0;
    const frameAvg = toNum(summary.avg_frame_check);
    const lensAvg = toNum(summary.avg_lens_check);

    return { margin, frameAvg, lensAvg };
  }, [summary]);

  /* ---------- Графики ---------- */
  const optionNetProfit: EChartsOption = useMemo(() => {
    const x = netRows.map((r) => r.day);
    return {
      grid: { top: 28, right: 14, bottom: 40, left: 64 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'line' }, valueFormatter: (v) => fmt(Number(v as number)) },
      xAxis: {
        type: 'category',
        data: x,
        axisLine: { lineStyle: { color: '#e2e8f0' } },
        axisLabel: { color: '#0f172a', fontSize: 12, formatter: (value: unknown) => formatDayRu(String(value)) },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#0f172a', fontSize: 12, formatter: (v: number) => fmt(v) },
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
          data: netRows.map((r) => toNum(r.net_profit)),
        },
      ],
    };
  }, [netRows]);

  const optionIncomeVsExpenses: EChartsOption = useMemo(() => {
    const x = netRows.map((r) => r.day);
    const income = netRows.map((r) => toNum(r.income));
    const expenses = netRows.map((r) => toNum(r.refunds) + toNum(r.opex_total) + toNum(r.cogs_total) + toNum(r.payroll_total));

    return {
      legend: { top: 0, textStyle: { color: '#0f172a', fontSize: 12, fontWeight: 500 } },
      grid: { top: 40, right: 14, bottom: 40, left: 64 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'line' }, valueFormatter: (v) => fmt(Number(v as number)) },
      xAxis: {
        type: 'category',
        data: x,
        axisLine: { lineStyle: { color: '#e2e8f0' } },
        axisLabel: { color: '#0f172a', fontSize: 12, formatter: (value: unknown) => formatDayRu(String(value)) },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#0f172a', fontSize: 12, formatter: (v: number) => fmt(v) },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      series: [
        { name: 'Доходы', type: 'line', smooth: true, symbol: 'circle', symbolSize: 6, lineStyle: { width: 2 }, areaStyle: { opacity: 0.06 }, data: income },
        { name: 'Расходы', type: 'bar', barMaxWidth: 22, data: expenses },
      ],
    };
  }, [netRows]);

  const optionExpPie: EChartsOption = useMemo(() => {
    const top = expCats.slice(0, 12);
    const rest = expCats.slice(12);
    const restSum = rest.reduce((a, r) => a + r.sum, 0);

    const data = [
      ...top.map((r) => ({ name: humanizeExpenseCategory(r.category), value: Math.round(r.sum) })),
      ...(restSum > 0 ? [{ name: 'Прочее', value: Math.round(restSum) }] : []),
    ];

    return {
      tooltip: { trigger: 'item', valueFormatter: (v) => fmt(Number(v as number)) },
      legend: { top: 0, textStyle: { color: '#0f172a', fontSize: 12 } },
      series: [{ type: 'pie', radius: ['35%', '70%'], center: ['50%', '58%'], label: { formatter: '{b}: {c}' }, data }],
    };
  }, [expCats]);

  /* ---------- Экспорт ---------- */
  function exportNetCsv() {
    const periodKey =
      periodMode === 'month' ? month : periodMode === 'year' ? year : periodMode === 'range' ? `${fromDate}_${toDate}` : 'all_time';

    const rows = [
      ['day', 'orders_count', 'income', 'refunds', 'opex_total', 'cogs_total', 'payroll_total', 'net_profit'],
      ...netRows.map((r) => [r.day, toNum(r.orders_count), toNum(r.income), toNum(r.refunds), toNum(r.opex_total), toNum(r.cogs_total), toNum(r.payroll_total), toNum(r.net_profit)]),
    ];

    const csv = rows.map((r) => r.join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `net_profit_${branchName}_${periodKey}_no_sunday.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const netPositive = (summary?.net_profit ?? 0) >= 0;

  return (
    <div className="min-h-[100dvh] bg-transparent text-slate-900">
      <div className="mx-auto w-full max-w-7xl px-5 pt-8 pb-10 space-y-5">
        {/* Header */}
        <GlassSection className="px-5 py-5 sm:px-6" tone="money">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 blur-xl opacity-35" />
                <div className="relative grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_18px_55px_rgba(34,197,235,0.70)]">
                  <CircleDollarSign className="h-5 w-5" />
                </div>
              </div>

              <div>
                <h1 className="text-[22px] md:text-[30px] font-semibold leading-tight text-slate-900 drop-shadow-[0_2px_18px_rgba(34,197,235,0.25)]">
                  Финансовый обзор
                </h1>
                <p className="mt-1 text-xs md:text-sm text-slate-600/90">
                  Доходы, расходы, реальные зарплаты и чистая прибыль (воскресенье исключено).
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Минимальная дата учёта: <span className="font-medium text-slate-700">{formatDayRu(DATA_START_ISO, true)}</span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
              <span className="inline-flex items-center rounded-full bg-white/85 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-sky-700 ring-1 ring-sky-200/80 shadow-[0_14px_40px_rgba(15,23,42,0.12)]">
                {branchName.toUpperCase()}
              </span>

              <span className="inline-flex items-center rounded-full bg-white/85 px-3 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200/80 shadow-[0_14px_40px_rgba(15,23,42,0.10)]">
                <Calendar className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
                {period.label}
              </span>

              <span className="inline-flex items-center rounded-full bg-white/85 px-3 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-teal-200/80 shadow-[0_14px_40px_rgba(15,23,42,0.10)]">
                Воскресенье исключено
              </span>

              <Link
                href={`/finance/settings?branch=${branchId}`}
                className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium bg-white/85 hover:bg-white text-teal-700 ring-1 ring-teal-200 shadow-[0_14px_40px_rgba(15,23,42,0.12)] transition focus:outline-none focus:ring-2 focus:ring-teal-300/60"
              >
                <Settings2 className="h-4 w-4" />
                Настройки ставок
              </Link>

              <SoftPrimaryButton onClick={exportNetCsv} disabled={netRows.length === 0}>
                <Download className="h-4 w-4" />
                Экспорт CSV
              </SoftPrimaryButton>
            </div>
          </div>
        </GlassSection>

        {/* Фильтры */}
        <GlassSection className="px-5 py-4 sm:px-6" tone="neutral">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col">
              <label className="text-[11px] font-medium text-slate-500">Филиал</label>
              <select
                className="mt-1 w-[220px] rounded-[14px] bg-white/90 px-3 py-2 text-sm text-slate-900 shadow-[0_18px_55px_rgba(15,23,42,0.10)] outline-none ring-1 ring-sky-200 focus:ring-2 focus:ring-cyan-400"
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

            {/* Режим периода */}
            <div className="flex flex-col">
              <label className="text-[11px] font-medium text-slate-500">Период</label>
              <select
                className="mt-1 w-[190px] rounded-[14px] bg-white/90 px-3 py-2 text-sm text-slate-900 shadow-[0_18px_55px_rgba(15,23,42,0.10)] outline-none ring-1 ring-sky-200 focus:ring-2 focus:ring-cyan-400"
                value={periodMode}
                onChange={(e) => setPeriodMode(e.target.value as PeriodMode)}
              >
                <option value="month">Месяц</option>
                <option value="year">Год</option>
                <option value="range">Диапазон</option>
                <option value="all">Всё время</option>
              </select>
            </div>

            {/* Ввод периода */}
            {periodMode === 'month' && (
              <div className="flex flex-col">
                <label className="text-[11px] font-medium text-slate-500">Месяц</label>
                <div className="relative mt-1">
                  <input
                    type="month"
                    className="w-[210px] rounded-[14px] bg-white/90 pl-9 pr-3 py-2 text-sm text-slate-900 shadow-[0_18px_55px_rgba(15,23,42,0.10)] outline-none ring-1 ring-sky-200 focus:ring-2 focus:ring-cyan-400"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                  />
                  <Calendar className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                </div>
              </div>
            )}

            {periodMode === 'year' && (
              <div className="flex flex-col">
                <label className="text-[11px] font-medium text-slate-500">Год</label>
                <div className="relative mt-1">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={2000}
                    max={dayjs().year()}
                    className="w-[150px] rounded-[14px] bg-white/90 px-3 py-2 text-sm text-slate-900 shadow-[0_18px_55px_rgba(15,23,42,0.10)] outline-none ring-1 ring-sky-200 focus:ring-2 focus:ring-cyan-400"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                  />
                </div>
              </div>
            )}

            {periodMode === 'range' && (
              <>
                <div className="flex flex-col">
                  <label className="text-[11px] font-medium text-slate-500">С</label>
                  <input
                    type="date"
                    className="mt-1 w-[170px] rounded-[14px] bg-white/90 px-3 py-2 text-sm text-slate-900 shadow-[0_18px_55px_rgba(15,23,42,0.10)] outline-none ring-1 ring-sky-200 focus:ring-2 focus:ring-cyan-400"
                    value={rangeFrom}
                    onChange={(e) => setRangeFrom(e.target.value)}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-[11px] font-medium text-slate-500">По</label>
                  <input
                    type="date"
                    className="mt-1 w-[170px] rounded-[14px] bg-white/90 px-3 py-2 text-sm text-slate-900 shadow-[0_18px_55px_rgba(15,23,42,0.10)] outline-none ring-1 ring-sky-200 focus:ring-2 focus:ring-cyan-400"
                    value={rangeTo}
                    onChange={(e) => setRangeTo(e.target.value)}
                  />
                </div>
              </>
            )}

            <SoftPrimaryButton onClick={loadData} disabled={loading} className="px-5">
              {loading ? 'Обновляю…' : 'Обновить данные'}
            </SoftPrimaryButton>

            <SoftGhostButton
              onClick={() => {
                setPeriodMode('month');
                setMonth(dayjs().format('YYYY-MM'));
              }}
              disabled={loading}
            >
              Текущий месяц
            </SoftGhostButton>

            <SoftGhostButton
              onClick={() => {
                setPeriodMode('year');
                setYear(String(dayjs().year() - 1));
              }}
              disabled={loading}
            >
              Прошлый год
            </SoftGhostButton>

            <SoftGhostButton
              onClick={() => {
                setPeriodMode('all');
              }}
              disabled={loading}
            >
              Всё время
            </SoftGhostButton>

            {branchId === 0 && (
              <label className="ml-2 inline-flex items-center gap-2 text-xs text-slate-700 select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={includeCentralInCommon}
                  onChange={(e) => setIncludeCentralInCommon(e.target.checked)}
                />
                Включать общие расходы (branch_id = null) в списки расходов
              </label>
            )}
          </div>

          <div className="mt-3 text-xs text-slate-600/90">
            Период:{' '}
            <span className="font-medium text-slate-900">{formatDayRu(fromDate, true)}</span> —{' '}
            <span className="font-medium text-slate-900">{formatDayRu(toDate, true)}</span>
            {summary && (
              <span className="ml-2 text-slate-600/90">
                · Дней учтено (без воскресений): <span className="font-medium text-slate-900">{summary.days_elapsed}</span> · Заказов:{' '}
                <span className="font-medium text-slate-900">{summary.orders_count}</span>
              </span>
            )}
          </div>
        </GlassSection>

        {error && (
          <GlassSection className="px-4 py-3" tone="danger">
            <div className="text-sm text-rose-700">{error}</div>
          </GlassSection>
        )}

        {/* KPI блоки */}
        {summary && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
              <StatCard title="Доходы" value={fmt(summary.total_income)} icon={CircleDollarSign} tone="ok" subtitle="Оплаченные заказы (без воскресенья)" />
              <StatCard title="Возвраты" value={fmt(summary.total_refunds)} icon={Undo2} tone="info" subtitle="Возвраты (без воскресенья)" />
              <StatCard title="OPEX" value={fmt(summary.opex_total)} icon={Cog} tone="warn" subtitle="Расходы (без воскресенья)" />
              <StatCard title="COGS" value={fmt(summary.cogs_total)} icon={Package} tone="neutral" subtitle="Себестоимость (без воскресенья)" />
              <StatCard title="Зарплаты (реальные)" value={fmt(summary.payroll_total)} icon={WalletCards} tone="info" subtitle="Net-дни (без воскресенья)" />
              <StatCard
                title="Чистая прибыль"
                value={fmt(summary.net_profit)}
                icon={netPositive ? TrendingUp : TrendingDown}
                tone={netPositive ? 'ok' : 'bad'}
                valueClass={netPositive ? 'text-emerald-700' : 'text-rose-700'}
                subtitle="Итог по дням (без воскресенья)"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <KpiCard label="Маржа (%)" value={`${kpis?.margin ?? 0}%`} />
              <KpiCard label="Средний чек оправы" value={fmt(kpis?.frameAvg ?? 0)} />
              <KpiCard label="Средний чек линз" value={fmt(kpis?.lensAvg ?? 0)} />
            </div>
          </>
        )}

        {/* Графики */}
        <ChartCard
          title="Чистая прибыль по дням"
          action={
            summary && (
              <SoftGhostButton onClick={() => setShowNetDetails(true)}>
                <Info className="h-4 w-4 text-slate-500" />
                Детали
              </SoftGhostButton>
            )
          }
        >
          <ReactECharts option={optionNetProfit} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
        </ChartCard>

        <ChartCard title="Доходы vs Расходы по дням">
          <ReactECharts option={optionIncomeVsExpenses} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
        </ChartCard>

        <ChartCard title="Структура ручных расходов (категории)" height={360}>
          <ReactECharts option={optionExpPie} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
        </ChartCard>

        {/* Детализация по дням */}
        {netRows.length > 0 && (
          <GlassSection className="overflow-hidden" tone="money">
            <div className="flex items-center justify-between px-5 pt-4">
              <div className="text-[15px] font-semibold text-slate-800">Детализация по дням (без воскресенья)</div>
              <div className="ml-4 h-px flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
            </div>

            <div className="p-5 overflow-auto">
              <div className="min-w-[860px] overflow-hidden rounded-2xl ring-1 ring-slate-200 bg-white/70 backdrop-blur-xl shadow-[0_18px_60px_rgba(15,23,42,0.12)]">
                <table className="w-full text-sm">
                  <thead className="bg-white/90">
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
                      <tr key={r.day} className="odd:bg-white/80 even:bg-slate-50/60 hover:bg-sky-50/60 transition">
                        <Td>{formatDayRu(r.day)}</Td>
                        <Td align="right">{fmt(toNum(r.income))}</Td>
                        <Td align="right">{fmt(toNum(r.refunds))}</Td>
                        <Td align="right">{fmt(toNum(r.opex_total))}</Td>
                        <Td align="right">{fmt(toNum(r.cogs_total))}</Td>
                        <Td align="right">{fmt(toNum(r.payroll_total))}</Td>
                        <Td align="right" className={toNum(r.net_profit) < 0 ? 'text-rose-700' : 'text-emerald-700'}>
                          {fmt(toNum(r.net_profit))}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </GlassSection>
        )}

        {/* Последние расходы */}
        <GlassSection className="overflow-hidden" tone="neutral">
          <div className="flex items-center justify-between px-5 pt-4">
            <div className="text-[15px] font-semibold text-slate-800">Последние расходы (за период, без воскресенья)</div>
            <div className="ml-4 h-px flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
          </div>

          <div className="p-5">
            <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200 bg-white/70 backdrop-blur-xl shadow-[0_18px_60px_rgba(15,23,42,0.12)]">
              <table className="w-full text-sm">
                <thead className="bg-white/90">
                  <tr>
                    <th className="px-3 py-2 text-left text-[13px] font-medium text-slate-700">Дата</th>
                    <th className="px-3 py-2 text-left text-[13px] font-medium text-slate-700">Категория</th>
                    <th className="px-3 py-2 text-right text-[13px] font-medium text-slate-700">Сумма</th>
                    <th className="px-3 py-2 text-left text-[13px] font-medium text-slate-700">Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {recentExpenses.length === 0 && (
                    <tr>
                      <td className="px-3 py-4 text-center text-slate-500" colSpan={4}>
                        Нет расходов за выбранный период.
                      </td>
                    </tr>
                  )}

                  {recentExpenses.map((it) => (
                    <tr key={it.id} className="odd:bg-white/80 even:bg-slate-50/60 hover:bg-sky-50/60 transition">
                      <td className="px-3 py-2">{formatDayRu(it.expense_date)}</td>
                      <td className="px-3 py-2">{humanizeExpenseCategory(it.category)}</td>
                      <td className="px-3 py-2 text-right">{fmt(toNum(it.amount))}</td>
                      <td className="px-3 py-2">{it.comment ? it.comment : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </GlassSection>

        {summary && showNetDetails && <NetDetailsModal summary={summary} onClose={() => setShowNetDetails(false)} />}
      </div>
    </div>
  );
}

/* ---------- Мелкие компоненты ---------- */

function StatCard({
  title,
  value,
  icon,
  valueClass,
  subtitle,
  tone = 'neutral',
}: {
  title: string;
  value: string | number;
  icon: IconType;
  valueClass?: string;
  subtitle?: string;
  tone?: 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
}) {
  const Icon = icon;

  const toneBg =
    tone === 'ok'
      ? 'from-emerald-50 via-white to-emerald-50'
      : tone === 'warn'
      ? 'from-amber-50 via-white to-amber-50'
      : tone === 'bad'
      ? 'from-red-50 via-white to-rose-50'
      : tone === 'info'
      ? 'from-sky-50 via-white to-sky-50'
      : 'from-slate-50 via-white to-slate-50';

  const toneRing =
    tone === 'ok'
      ? 'ring-emerald-200/80'
      : tone === 'warn'
      ? 'ring-amber-200/80'
      : tone === 'bad'
      ? 'ring-rose-200/80'
      : tone === 'info'
      ? 'ring-sky-200/80'
      : 'ring-slate-200/80';

  const iconGrad =
    tone === 'ok'
      ? 'from-emerald-400 via-teal-400 to-cyan-400'
      : tone === 'warn'
      ? 'from-amber-400 via-orange-400 to-rose-400'
      : tone === 'bad'
      ? 'from-rose-500 via-orange-400 to-amber-400'
      : tone === 'info'
      ? 'from-sky-500 via-cyan-400 to-emerald-400'
      : 'from-slate-400 via-slate-300 to-slate-200';

  return (
    <div
      className={[
        'relative overflow-hidden rounded-2xl p-5',
        'bg-gradient-to-br',
        toneBg,
        'ring-1',
        toneRing,
        'backdrop-blur-xl',
        'shadow-[0_18px_60px_rgba(15,23,42,0.16)] hover:shadow-[0_24px_70px_rgba(15,23,42,0.22)] transition',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <div className="relative">
          <div className="absolute -inset-2 rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 blur-xl opacity-25" />
          <div
            className={[
              'relative grid h-10 w-10 place-items-center rounded-xl text-white',
              'bg-gradient-to-br',
              iconGrad,
              'shadow-[0_14px_40px_rgba(15,23,42,0.22)]',
            ].join(' ')}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">{title}</div>
          <div className={['mt-1 text-[22px] font-semibold text-slate-900', valueClass ?? ''].join(' ')}>{value}</div>
          {subtitle && <div className="mt-1 text-[11px] leading-snug text-slate-600/90">{subtitle}</div>}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl p-5 bg-gradient-to-br from-white via-slate-50 to-sky-50/85 ring-1 ring-sky-200/80 backdrop-blur-xl shadow-[0_18px_60px_rgba(15,23,42,0.14)]">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">{label}</div>
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
    <GlassSection tone="money">
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
    </GlassSection>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      className={[
        'px-3 py-2 text-[13px] font-medium text-slate-700',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
      ].join(' ')}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  className = '',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  return (
    <td
      className={[
        'px-3 py-2 text-sm text-slate-800',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      ].join(' ')}
    >
      {children}
    </td>
  );
}

/* ---------- Модалка деталей чистой прибыли ---------- */

function NetDetailsModal({ summary, onClose }: { summary: SummaryToDate; onClose: () => void }) {
  const income = toNum(summary.total_income);
  const refunds = toNum(summary.total_refunds);
  const opex = toNum(summary.opex_total);
  const cogs = toNum(summary.cogs_total);
  const payroll = toNum(summary.payroll_total);

  const netFront = income - refunds - opex - cogs - payroll;
  const netFromDb = summary.net_profit_db ?? summary.net_profit ?? 0;
  const diff = netFromDb - netFront;

  const payrollDb = summary.payroll_total_db !== undefined ? toNum(summary.payroll_total_db) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white/95 ring-1 ring-sky-200 backdrop-blur-xl shadow-[0_30px_120px_rgba(0,0,0,0.65)] p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Детали расчёта (без воскресенья)</h2>
          <button
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-slate-100 text-slate-500 transition"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-1 text-sm text-slate-800">
          <Row label="Доходы" value={income} />
          <Row label="Минус возвраты" value={-refunds} />
          <Row label="Минус OPEX" value={-opex} />
          <Row label="Минус COGS" value={-cogs} />
          <Row label="Минус зарплаты" value={-payroll} />
        </div>

        <div className="mt-3 border-t border-slate-200 pt-3 space-y-1 text-sm text-slate-800">
          <Row label="Итого по формуле (фронт)" value={netFront} bold />
          <Row label="net_profit из БД (как вернул RPC)" value={netFromDb} />
          {payrollDb !== null && payrollDb !== payroll && <Row label="payroll_total из БД" value={payrollDb} small muted />}
          <Row label="Разница (БД − фронт)" value={diff} small muted={diff === 0} highlight={diff !== 0} />
        </div>

        <p className="mt-3 text-[11px] leading-snug text-slate-500">
          На странице воскресенье исключено. Для “Общие” данные по дням берутся как сумма отдельных филиалов, чтобы общие/складские строки не “раздували” COGS/OPEX.
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
    <div className={['flex justify-between', small ? 'text-xs' : 'text-sm', muted ? 'text-slate-500' : 'text-slate-800'].join(' ')}>
      <span>{label}</span>
      <span
        className={[
          bold ? 'font-semibold' : '',
          highlight && value !== 0 ? (value > 0 ? 'text-emerald-700' : 'text-rose-700') : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {fmt(value)}
      </span>
    </div>
  );
}
