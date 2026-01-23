// app/(admin)/admin/stats/page.tsx
'use client';

import * as React from 'react';
import type { EChartsOption } from 'echarts';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import getSupabase from '@/lib/supabaseClient';
import {
  CalendarDays,
  Building2,
  RefreshCw,
  TrendingUp,
  HandCoins,
  ReceiptRussianRuble,
  AlertTriangle,
  Users2,
  CreditCard,
  BarChart3,
  LineChart,
  PieChart,
  Timer,
  Percent,
} from 'lucide-react';

import {
  rpcRevenueInflowByDay,
  rpcPeriodByBranch,
  rpcPaymentsBreakdown,
  rpcHeatmap,
  rpcCheckHistogram,
  rpcRefundsByDay,
  rpcNewVsReturning,
  rpcAvgIntervalDays,
  rpcAvgMedianCheck,
  rpcAgeByYear, // возраста (М/Ж)
  rpcLensStructure, // структура линз
  rpcNetProfitByDay, // чистая прибыль по дням
} from '@/lib/adminStats';

// ECharts без SSR
const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

/* ========== helpers ========== */

const nf = (n: number) => (Number.isFinite(+n) ? Number(n).toLocaleString('ru-RU') : '0');

/** YYYY-MM-DD в локальном времени */
const toISODateLocal = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const todayISO = () => toISODateLocal(new Date());

/** Берём только YYYY-MM-DD */
const onlyDate = (s: string | null) => {
  if (!s) return null;
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : toISODateLocal(d);
};

const normalizeDay = (s: string) => onlyDate(s) ?? String(s).slice(0, 10);

const isSundayISO = (s: string) => {
  const iso = normalizeDay(s);
  const d = new Date(`${iso}T00:00:00`);
  return d.getDay() === 0; // Sunday
};

const dropSundays = <T extends { day: string }>(rows: T[]) =>
  rows
    .map((r) => ({ ...r, day: normalizeDay(r.day) }))
    .filter((r) => !isSundayISO(r.day));

/** Человекочитаемое имя метода оплаты */
const paymentMethodLabel = (m: string) => {
  switch (m) {
    case 'cash':
      return 'Наличные';
    case 'pos':
      return 'Карта (POS-терминал)';
    case 'transfer':
      return 'Перевод / QR';
    case 'mixed':
      return 'Смешанная оплата';
    default:
      return m || '—';
  }
};

/** Диапазоны */
const getCurrentMonthRange = () => {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const to = toISODateLocal(now);
  return { from, to };
};

const getLastNDaysRange = (days: number) => {
  const now = new Date();
  const to = toISODateLocal(now);
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - Math.max(0, days - 1));
  const from = toISODateLocal(fromDate);
  return { from, to };
};

const getCurrentYearRange = () => {
  const now = new Date();
  const from = `${now.getFullYear()}-01-01`;
  const to = toISODateLocal(now);
  return { from, to };
};

/** Проверка роли owner */
async function isOwner(): Promise<boolean> {
  const sb = getSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return false;
  const { data } = await sb.from('profiles').select('role').eq('id', u.user.id).single();
  return data?.role === 'owner';
}

/* ========== типы ответов ========== */
type DayRow = { day: string; revenue: number; inflow: number; debt: number };
type BranchRow = {
  branch: string;
  ov_orders: number;
  sd_orders: number;
  ov_revenue: number;
  sd_revenue: number;
};
type PayRow = { method: string; cnt: number; sum: number };

type HeatRow = {
  dow: number;
  hh: number;
  orders_cnt: number;
  revenue_sum: number;
};
type BinRow = { from_amt: number; to_amt: number; cnt: number };
type RefundRow = { day: string; refunds_cnt: number; refunds_sum: number };

type CustKpis = {
  avg_check: number;
  median_check: number;
  avg_interval_days: number;
  returning_share: number;
  new_customers: number;
  returning_customers: number;
  customers_total: number;
};

// Возраст/пол
type AgeRow = { age: number; gender: 'Муж' | 'Жен'; orders_cnt: number };

// Структура линз
type LensStructRow = {
  lens_family: string;
  items_cnt: number;
  revenue_sum: number;
};

// Диапазоны диоптрий
type LensSphRow = {
  range_label: string | null;
  lens_kind: 'sph' | 'astig' | null; // обычные / астигматические
  items_cnt: number;
  revenue_sum: number;
};

// Чистая прибыль по дням
type NetProfitRow = { day: string; net_profit: number };

// Заказы по 10-минутным интервалам (bucket = 'HH24:MI' из SQL)
type Orders10Row = {
  bucket: string;
  orders_cnt: number;
  revenue_sum: number;
};

// полный список филиалов для фильтра
const ALL_BRANCHES = ['Кант', 'Кара-Балта', 'Беловодск', 'Сокулук', 'Токмок'];

/* ====== попытка получить границы "за всё время" ====== */
async function fetchAllTimeBounds(p_branches: string[]) {
  const sb = getSupabase();

  // 1) Если вдруг есть RPC под границы — попробуем (не обязателен)
  try {
    const { data, error } = await sb.rpc(
      'stats_date_bounds',
      {
        p_branches: p_branches.length ? p_branches : null,
      } as any,
    );

    if (!error && data && (data.min_day || data.max_day)) {
      const from = onlyDate(data.min_day) ?? '2020-01-01';
      const to = onlyDate(data.max_day) ?? todayISO();
      return { from, to };
    }
  } catch {
    // ignore
  }

  // 2) Фолбэк: попробуем по stats_daily (если таблица есть)
  try {
    const { data: minArr, error: e1 } = await sb
      .from('stats_daily' as any)
      .select('day')
      .order('day', { ascending: true })
      .limit(1);

    const { data: maxArr, error: e2 } = await sb
      .from('stats_daily' as any)
      .select('day')
      .order('day', { ascending: false })
      .limit(1);

    if (!e1 && !e2) {
      const minDay = Array.isArray(minArr) ? minArr[0]?.day : null;
      const maxDay = Array.isArray(maxArr) ? maxArr[0]?.day : null;
      const from = onlyDate(minDay ?? null) ?? '2020-01-01';
      const to = onlyDate(maxDay ?? null) ?? todayISO();
      return { from, to };
    }
  } catch {
    // ignore
  }

  // 3) Самый безопасный фолбэк: "очень давно → сегодня"
  return { from: '2020-01-01', to: todayISO() };
}

export default function AdminStatsPage() {
  /* --- доступ --- */
  const [gate, setGate] = React.useState<'pending' | 'ok' | 'denied'>('pending');

  /* --- фильтры --- */
  const branchOptions = ALL_BRANCHES;
  const [branches, setBranches] = React.useState<string[]>([]); // [] = все филиалы

  // IMPORTANT: по умолчанию хотим "за всё время"
  const [fromISO, setFromISO] = React.useState<string>('2020-01-01');
  const [toISO, setToISO] = React.useState<string>(() => todayISO());
  const [filtersReady, setFiltersReady] = React.useState(false);

  /* --- данные --- */
  const [byDay, setByDay] = React.useState<DayRow[]>([]);
  const [byBranch, setByBranch] = React.useState<BranchRow[]>([]);
  const [payments, setPayments] = React.useState<PayRow[]>([]);
  const [custKpis, setCustKpis] = React.useState<CustKpis | null>(null);
  const [heat, setHeat] = React.useState<HeatRow[]>([]);
  const [bins, setBins] = React.useState<BinRow[]>([]);
  const [refunds, setRefunds] = React.useState<RefundRow[]>([]);
  const [ageRows, setAgeRows] = React.useState<AgeRow[]>([]);
  const [lensStruct, setLensStruct] = React.useState<LensStructRow[]>([]);
  const [lensSph, setLensSph] = React.useState<LensSphRow[]>([]);
  const [netProfit, setNetProfit] = React.useState<NetProfitRow[]>([]);
  const [orders10, setOrders10] = React.useState<Orders10Row[]>([]);

  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // навигация/URL
  const router = useRouter();
  const searchParams = useSearchParams();

  // ВАЖНО: null = "все филиалы" (и для RPC это обычно правильнее, чем [])
  const brArg = React.useMemo<string[] | null>(() => (branches.length ? branches : null), [branches]);

  /* --- проверка доступа --- */
  React.useEffect(() => {
    (async () => {
      try {
        setGate((await isOwner()) ? 'ok' : 'denied');
      } catch {
        setGate('denied');
      }
    })();
  }, []);

  /* --- читаем фильтры из URL; если диапазона нет — ставим "за всё время" по реальным данным --- */
  React.useEffect(() => {
    (async () => {
      const urlFrom = onlyDate(searchParams.get('from'));
      const urlTo = onlyDate(searchParams.get('to'));
      const urlBranches = searchParams.get('branches');

      const initialBranches = urlBranches
        ? urlBranches
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      if (initialBranches.length) setBranches(initialBranches);

      // Если из URL дали диапазон — используем его
      if (urlFrom) setFromISO(urlFrom);
      if (urlTo) setToISO(urlTo);

      // Если диапазона нет — подтягиваем реальные границы (или fallback)
      if (!urlFrom && !urlTo) {
        const bounds = await fetchAllTimeBounds(initialBranches);
        setFromISO(bounds.from);
        setToISO(bounds.to);
      }

      setFiltersReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushFiltersToURL = React.useCallback(
    (from: string, to: string, br: string[]) => {
      const qs = new URLSearchParams();
      qs.set('from', from.slice(0, 10));
      qs.set('to', to.slice(0, 10));
      if (br.length) qs.set('branches', br.join(','));
      router.replace(`?${qs.toString()}`, { scroll: false });
    },
    [router],
  );

  /* --- загрузчик (устойчивый к падению отдельных RPC) --- */
  const loadAll = React.useCallback(
    async (override?: { fromISO?: string; toISO?: string; branches?: string[] }) => {
      setLoading(true);
      setErr(null);

      // берём либо override, либо стейт
      let from = (override?.fromISO ?? fromISO).slice(0, 10);
      let to = (override?.toISO ?? toISO).slice(0, 10);
      const br = override?.branches ?? branches;

      // защита от "from > to"
      if (from > to) {
        const tmp = from;
        from = to;
        to = tmp;
      }

      const brForRpc: string[] | null = br.length ? br : null;

      try {
        const results = await Promise.allSettled([
          rpcRevenueInflowByDay(from, to, brForRpc as any), // 0
          rpcPeriodByBranch(from, to, brForRpc as any), // 1
          rpcPaymentsBreakdown(from, to, brForRpc as any), // 2
          rpcNewVsReturning(from, to, brForRpc as any), // 3
          rpcAvgIntervalDays(from, to, brForRpc as any), // 4
          rpcAvgMedianCheck(from, to, brForRpc as any), // 5
          rpcHeatmap(from, to, brForRpc as any), // 6
          rpcCheckHistogram(from, to, 200, 30000, brForRpc as any), // 7
          rpcRefundsByDay(from, to, brForRpc as any), // 8
          rpcAgeByYear(from, to, brForRpc as any), // 9
          rpcLensStructure(from, to, brForRpc as any), // 10
          rpcNetProfitByDay(from, to, brForRpc as any), // 11
        ]);

        const warns: string[] = [];
        const get = <T,>(i: number, fallback: T): T => {
          const r = results[i];
          if (r.status === 'fulfilled') return r.value as T;
          warns.push(String((r as PromiseRejectedResult).reason || 'unknown error'));
          return fallback;
        };

        const d = get<DayRow[]>(0, []);
        const b = get<BranchRow[]>(1, []);
        const p = get<PayRow[]>(2, []);
        const nv = get<{
          new_customers: number;
          returning_customers: number;
          customers_total: number;
          returning_share: number;
        }>(3, {
          new_customers: 0,
          returning_customers: 0,
          customers_total: 0,
          returning_share: 0,
        });
        const avgInt = get<number>(4, 0);
        const ck = get<{ avg_check: number; median_check: number }>(5, {
          avg_check: 0,
          median_check: 0,
        });
        const heatRows = get<HeatRow[]>(6, []);
        const binRows = get<BinRow[]>(7, []);
        const refundRows = get<RefundRow[]>(8, []);
        const ages = get<AgeRow[]>(9, []);
        const lens = get<LensStructRow[]>(10, []);
        const np = get<NetProfitRow[]>(11, []);

        // УБИРАЕМ ВОСКРЕСЕНЬЯ ИЗ ДНЕВНЫХ РЯДОВ
        setByDay(dropSundays(d));
        setRefunds(dropSundays(refundRows));
        setNetProfit(dropSundays(np));

        // Остальное
        setByBranch(b);
        setPayments(p);
        setHeat(heatRows);
        setBins(binRows);
        setAgeRows(ages);
        setLensStruct(lens);

        setCustKpis({
          avg_check: Number(ck.avg_check || 0),
          median_check: Number(ck.median_check || 0),
          avg_interval_days: Number(avgInt || 0),
          returning_share: Number(nv.returning_share || 0),
          new_customers: nv.new_customers,
          returning_customers: nv.returning_customers,
          customers_total: nv.customers_total,
        });

        // === диапазоны диоптрий (stats_lens_sph_ranges) ===
        try {
          const sb = getSupabase();
          const { data: lensSphRaw, error: lensErr } = await sb.rpc('stats_lens_sph_ranges', {
            p_from: from,
            p_to: to,
            p_branches: brForRpc,
          });

          if (lensErr) {
            console.warn('[stats_lens_sph_ranges]', lensErr.message);
            setLensSph([]);
          } else if (Array.isArray(lensSphRaw)) {
            setLensSph(
              lensSphRaw.map((r: any) => ({
                range_label: r.range_label ?? null,
                lens_kind: (r.lens_kind as 'sph' | 'astig' | null) ?? null,
                items_cnt: Number(r.items_cnt || 0),
                revenue_sum: Number(r.revenue_sum || 0),
              })),
            );
          } else {
            setLensSph([]);
          }
        } catch (e: any) {
          console.warn('[stats_lens_sph_ranges]', e?.message ?? e);
          setLensSph([]);
        }

        // === заказы по 10-минутным интервалам ===
        try {
          const sb = getSupabase();
          const { data: orders10Raw, error: err10 } = await sb.rpc('stats_orders_by_10min', {
            p_from: from,
            p_to: to,
            p_branches: brForRpc,
          });

          if (err10) {
            warns.push(err10.message);
            setOrders10([]);
          } else if (Array.isArray(orders10Raw)) {
            setOrders10(
              orders10Raw.map((r: any) => ({
                bucket: String(r.bucket), // '11:40'
                orders_cnt: Number(r.orders_cnt || 0),
                revenue_sum: Number(r.revenue_sum || 0),
              })),
            );
          } else {
            setOrders10([]);
          }
        } catch (e: any) {
          warns.push(String(e?.message ?? e));
          setOrders10([]);
        }

        if (warns.length) setErr(warns.join(' · '));
        else setErr(null);

        pushFiltersToURL(from, to, br);
      } finally {
        setLoading(false);
      }
    },
    [fromISO, toISO, branches, pushFiltersToURL],
  );

  /* --- первичная загрузка (только когда фильтры готовы) --- */
  React.useEffect(() => {
    if (gate === 'ok' && filtersReady) void loadAll();
  }, [gate, filtersReady, loadAll]);

  /* --- быстрые пресеты (сразу грузим данные, чтобы не было "нажал — ничего не изменилось") --- */
  const applyPreset = React.useCallback(
    async (preset: 'all' | 'month' | '30d' | '7d' | 'year') => {
      let r: { from: string; to: string };

      if (preset === 'month') r = getCurrentMonthRange();
      else if (preset === '30d') r = getLastNDaysRange(30);
      else if (preset === '7d') r = getLastNDaysRange(7);
      else if (preset === 'year') r = getCurrentYearRange();
      else r = await fetchAllTimeBounds(branches);

      const nextFrom = r.from.slice(0, 10);
      const nextTo = r.to.slice(0, 10);

      setFromISO(nextFrom);
      setToISO(nextTo);

      // мгновенная подгрузка по новому диапазону
      void loadAll({ fromISO: nextFrom, toISO: nextTo, branches });
    },
    [branches, loadAll],
  );

  /* --- агрегаты KPI --- */
  const totals = React.useMemo(() => {
    const revenue = byDay.reduce((a, r) => a + (r.revenue || 0), 0);
    const inflow = byDay.reduce((a, r) => a + (r.inflow || 0), 0);
    const debt = Math.max(0, revenue - inflow);

    // Статусы заказов убрали — берём кол-во заказов из сравнения по филиалам (orders_view)
    const orders = byBranch.reduce((a, r) => a + (r.ov_orders || 0), 0);

    return { revenue, inflow, debt, orders };
  }, [byDay, byBranch]);

  const paymentsTotals = React.useMemo(
    () => ({
      cnt: payments.reduce((a, p) => a + (p.cnt || 0), 0),
      sum: payments.reduce((a, p) => a + (p.sum || 0), 0),
    }),
    [payments],
  );

  /* ========== Chart styles (Refocus glass) ========== */

  const chartTheme = React.useMemo(
    () => ({
      text: '#0f172a',
      subtext: 'rgba(15,23,42,0.65)',
      axis: 'rgba(15,23,42,0.55)',
      axisLine: 'rgba(148,163,184,0.55)',
      split: 'rgba(148,163,184,0.25)',
      tooltipBg: 'rgba(255,255,255,0.92)',
      tooltipBorder: 'rgba(56,189,248,0.35)',
      teal: '#14b8a6',
      cyan: '#22d3ee',
      sky: '#38bdf8',
      emerald: '#34d399',
      rose: '#fb7185',
      amber: '#fbbf24',
      indigo: '#818cf8',
      violet: '#a78bfa',
      navy: '#0f172a', // мужской (тёмно-синий)
    }),
    [],
  );

  const gradTeal = React.useMemo(
    () => ({
      type: 'linear',
      x: 0,
      y: 0,
      x2: 1,
      y2: 0,
      colorStops: [
        { offset: 0, color: chartTheme.teal },
        { offset: 0.55, color: chartTheme.cyan },
        { offset: 1, color: chartTheme.sky },
      ],
    }),
    [chartTheme],
  );

  const gradMoneyArea = React.useMemo(
    () => ({
      type: 'linear',
      x: 0,
      y: 0,
      x2: 0,
      y2: 1,
      colorStops: [
        { offset: 0, color: 'rgba(34,211,238,0.28)' },
        { offset: 1, color: 'rgba(34,211,238,0.02)' },
      ],
    }),
    [],
  );

  const tooltipGlass = React.useMemo(
    () => ({
      backgroundColor: chartTheme.tooltipBg,
      borderColor: chartTheme.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: chartTheme.text, fontSize: 12, fontWeight: 500 },
      extraCssText:
        'backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-radius: 14px; box-shadow: 0 22px 70px rgba(15,23,42,0.18); padding: 10px 12px;',
    }),
    [chartTheme],
  );

  const axisCommon = React.useMemo(
    () => ({
      axisLabel: { color: chartTheme.axis, fontSize: 11 },
      axisLine: { lineStyle: { color: chartTheme.axisLine } },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: chartTheme.split } },
    }),
    [chartTheme],
  );

  /* ========== ECharts options ========== */

  const optionByDay: EChartsOption = React.useMemo(() => {
    const x = byDay.map((r) => r.day);
    const rev = byDay.map((r) => r.revenue || 0);
    const inf = byDay.map((r) => r.inflow || 0);
    const deb = byDay.map((r) => Math.max(0, r.debt || 0));

    return {
      backgroundColor: 'transparent',
      grid: { top: 46, right: 18, bottom: 38, left: 56 },
      legend: {
        top: 8,
        itemWidth: 14,
        itemHeight: 8,
        textStyle: { color: chartTheme.subtext, fontSize: 12, fontWeight: 600 },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: 'rgba(56,189,248,0.45)' } },
        valueFormatter: (v) => nf(Number(v)),
        ...(tooltipGlass as any),
      },
      xAxis: {
        type: 'category',
        data: x,
        boundaryGap: true,
        ...axisCommon,
      },
      yAxis: {
        type: 'value',
        ...axisCommon,
        axisLabel: {
          color: chartTheme.axis,
          fontSize: 11,
          formatter: (val: number) => nf(Number(val)),
        },
      },
      series: [
        {
          name: 'Выручка',
          type: 'line',
          smooth: 0.35,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 3, color: gradTeal as any },
          itemStyle: { color: chartTheme.cyan },
          emphasis: { focus: 'series' },
          data: rev,
          areaStyle: { opacity: 1, color: gradMoneyArea as any },
        },
        {
          name: 'Поступления',
          type: 'line',
          smooth: 0.35,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: {
            width: 3,
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 1,
              y2: 0,
              colorStops: [
                { offset: 0, color: chartTheme.emerald },
                { offset: 0.6, color: chartTheme.teal },
                { offset: 1, color: chartTheme.cyan },
              ],
            } as any,
          },
          itemStyle: { color: chartTheme.emerald },
          emphasis: { focus: 'series' },
          data: inf,
          areaStyle: {
            opacity: 1,
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(52,211,153,0.20)' },
                { offset: 1, color: 'rgba(52,211,153,0.02)' },
              ],
            } as any,
          },
        },
        {
          name: 'Долг',
          type: 'bar',
          barMaxWidth: 18,
          emphasis: { focus: 'series' },
          itemStyle: {
            borderRadius: [10, 10, 6, 6],
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(251,113,133,0.95)' },
                { offset: 1, color: 'rgba(251,191,36,0.55)' },
              ],
            } as any,
          },
          data: deb,
        },
      ],
    };
  }, [byDay, axisCommon, chartTheme, gradTeal, gradMoneyArea, tooltipGlass]);

  const optionNetProfit: EChartsOption = React.useMemo(() => {
    const x = netProfit.map((r) => r.day);
    const y = netProfit.map((r) => r.net_profit || 0);

    return {
      backgroundColor: 'transparent',
      grid: { top: 40, right: 18, bottom: 38, left: 56 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: 'rgba(34,211,238,0.45)' } },
        valueFormatter: (v) => nf(Number(v)),
        ...(tooltipGlass as any),
      },
      xAxis: { type: 'category', data: x, ...axisCommon },
      yAxis: {
        type: 'value',
        ...axisCommon,
        axisLabel: { color: chartTheme.axis, formatter: (v: number) => nf(v) },
      },
      series: [
        {
          name: 'Чистая прибыль',
          type: 'line',
          smooth: 0.35,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 3, color: gradTeal as any },
          itemStyle: { color: chartTheme.teal },
          data: y,
          areaStyle: {
            opacity: 1,
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(20,184,166,0.18)' },
                { offset: 1, color: 'rgba(20,184,166,0.02)' },
              ],
            } as any,
          },
        },
      ],
    };
  }, [netProfit, axisCommon, chartTheme, gradTeal, tooltipGlass]);

  const optionNewReturning: EChartsOption = React.useMemo(() => {
    const a = custKpis?.new_customers ?? 0;
    const b = custKpis?.returning_customers ?? 0;
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', valueFormatter: (v) => nf(Number(v)), ...(tooltipGlass as any) },
      legend: { top: 6, textStyle: { color: chartTheme.subtext, fontWeight: 600 } },
      series: [
        {
          type: 'pie',
          radius: ['40%', '72%'],
          center: ['50%', '56%'],
          avoidLabelOverlap: true,
          label: { formatter: '{b}: {c} ({d}%)', color: chartTheme.text, fontWeight: 600 },
          labelLine: { length: 10, length2: 10 },
          itemStyle: { borderColor: 'rgba(255,255,255,0.8)', borderWidth: 2 },
          data: [
            { name: 'Новые', value: a, itemStyle: { color: chartTheme.cyan } },
            { name: 'Вернувшиеся', value: b, itemStyle: { color: chartTheme.teal } },
          ],
        },
      ],
    };
  }, [custKpis, chartTheme, tooltipGlass]);

  // Гендер покупателей: МУЖ — бирюзовый; ЖЕН — как было. + проценты
  const optionGenderPie: EChartsOption = React.useMemo(() => {
    let male = 0;
    let female = 0;
    for (const r of ageRows) {
      if (r.gender === 'Муж') male += r.orders_cnt || 0;
      if (r.gender === 'Жен') female += r.orders_cnt || 0;
    }
    const total = male + female;
    const malePct = total ? Math.round((male / total) * 100) : 0;
    const femalePct = total ? Math.round((female / total) * 100) : 0;

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => `${p.name}: <b>${nf(Number(p.value || 0))}</b> (${Number(p.percent || 0)}%)`,
        ...(tooltipGlass as any),
      },
      legend: {
        top: 6,
        textStyle: { color: chartTheme.subtext, fontWeight: 600 },
        formatter: (name: string) => {
          if (name === 'Муж') return `Муж — ${malePct}%`;
          if (name === 'Жен') return `Жен — ${femalePct}%`;
          return name;
        },
      } as any,
      series: [
        {
          type: 'pie',
          radius: ['42%', '74%'],
          center: ['50%', '56%'],
          label: { formatter: '{b}: {c} ({d}%)', color: chartTheme.text, fontWeight: 600 },
          labelLine: { length: 10, length2: 10 },
          itemStyle: { borderColor: 'rgba(255,255,255,0.8)', borderWidth: 2 },
          data: [
            { name: 'Жен', value: female, itemStyle: { color: chartTheme.violet } },
            { name: 'Муж', value: male, itemStyle: { color: chartTheme.cyan } },
          ],
        },
      ],
    };
  }, [ageRows, chartTheme, tooltipGlass]);

  const optionOrdersBy10Min: EChartsOption = React.useMemo(() => {
    if (!orders10.length) {
      return {
        backgroundColor: 'transparent',
        xAxis: { type: 'category', data: [] },
        yAxis: { type: 'value' },
        series: [{ type: 'bar', data: [] }],
      };
    }

    const bucketMap = new Map<string, { orders_cnt: number; revenue_sum: number }>();
    for (const row of orders10) {
      const bucket = String(row.bucket);
      const prev = bucketMap.get(bucket) ?? { orders_cnt: 0, revenue_sum: 0 };
      bucketMap.set(bucket, {
        orders_cnt: prev.orders_cnt + Number(row.orders_cnt || 0),
        revenue_sum: prev.revenue_sum + Number(row.revenue_sum || 0),
      });
    }

    const aggregated = [...bucketMap.entries()]
      .map(([bucket, v]) => ({ bucket, orders_cnt: v.orders_cnt, revenue_sum: v.revenue_sum }))
      .sort((a, b) => {
        const [ha, ma] = a.bucket.split(':').map(Number);
        const [hb, mb] = b.bucket.split(':').map(Number);
        return ha * 60 + ma - (hb * 60 + mb);
      });

    const labels = aggregated.map((r) => r.bucket);
    const orders = aggregated.map((r) => r.orders_cnt ?? 0);

    return {
      backgroundColor: 'transparent',
      grid: { top: 30, right: 16, bottom: 62, left: 52 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const idx = p.dataIndex ?? 0;
          const row = aggregated[idx];
          return `${row.bucket}<br/>Заказы: <b>${nf(row.orders_cnt)}</b><br/>Выручка: <b>${nf(
            Number(row.revenue_sum),
          )}</b>`;
        },
        ...(tooltipGlass as any),
      },
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        { type: 'slider', height: 18, bottom: 6, handleSize: 12 },
      ],
      xAxis: {
        type: 'category',
        data: labels,
        ...axisCommon,
        axisLabel: { color: chartTheme.axis, fontSize: 10, rotate: 45 },
      },
      yAxis: { type: 'value', ...axisCommon, minInterval: 1 },
      series: [
        {
          name: 'Заказы',
          type: 'bar',
          barMaxWidth: 14,
          itemStyle: {
            borderRadius: [10, 10, 6, 6],
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(34,211,238,0.95)' },
                { offset: 1, color: 'rgba(20,184,166,0.55)' },
              ],
            } as any,
          },
          data: orders,
        },
      ],
    };
  }, [orders10, axisCommon, chartTheme, tooltipGlass]);

  const optionOrdersByDow: EChartsOption = React.useMemo(() => {
    const labels: Record<number, string> = { 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт', 6: 'Сб' }; // воскресенье намеренно отсутствует
    const sums = new Map<number, number>();
    for (const h of heat) sums.set(h.dow, (sums.get(h.dow) || 0) + (h.orders_cnt || 0));
    const dows = [1, 2, 3, 4, 5, 6];
    const x = dows.map((d) => labels[d]);
    const y = dows.map((d) => sums.get(d) ?? 0);

    return {
      backgroundColor: 'transparent',
      grid: { top: 30, right: 16, bottom: 38, left: 52 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v) => nf(Number(v)),
        ...(tooltipGlass as any),
      },
      xAxis: { type: 'category', data: x, ...axisCommon },
      yAxis: { type: 'value', ...axisCommon, minInterval: 1 },
      series: [
        {
          type: 'bar',
          barMaxWidth: 28,
          itemStyle: {
            borderRadius: [12, 12, 6, 6],
            color: gradTeal as any,
          },
          data: y,
        },
      ],
    };
  }, [heat, axisCommon, gradTeal, tooltipGlass]);

  const optionBins: EChartsOption = React.useMemo(() => {
    if (!bins.length) {
      return {
        backgroundColor: 'transparent',
        xAxis: { type: 'value' },
        yAxis: { type: 'value' },
        series: [{ type: 'line', data: [] }],
      };
    }
    const nonEmpty = bins.filter((b) => (b.cnt || 0) > 0);
    if (!nonEmpty.length) {
      return {
        backgroundColor: 'transparent',
        xAxis: { type: 'value' },
        yAxis: { type: 'value' },
        series: [{ type: 'line', data: [] }],
      };
    }
    const sorted = [...nonEmpty].sort((a, b) => (a.from_amt || 0) - (b.from_amt || 0));
    const points = sorted.map((b) => [Number(b.from_amt || 0), Number(b.cnt || 0)]);

    return {
      backgroundColor: 'transparent',
      grid: { top: 26, right: 18, bottom: 42, left: 56 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: 'rgba(56,189,248,0.45)' } },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const [amount, count] = p.data as [number, number];
          return `Чек: <b>${nf(Math.round(amount))}</b> сом<br/>Кол-во чеков: <b>${nf(Math.round(count))}</b>`;
        },
        ...(tooltipGlass as any),
      },
      xAxis: {
        type: 'value',
        ...axisCommon,
        axisLabel: { color: chartTheme.axis, formatter: (v: number) => nf(v) },
      },
      yAxis: { type: 'value', ...axisCommon, minInterval: 1 },
      series: [
        {
          type: 'line',
          smooth: 0.35,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { width: 3, color: gradTeal as any },
          itemStyle: { color: chartTheme.cyan },
          data: points,
          areaStyle: { opacity: 1, color: gradMoneyArea as any },
        },
      ],
    };
  }, [bins, axisCommon, chartTheme, gradTeal, gradMoneyArea, tooltipGlass]);

  const optionRefunds: EChartsOption = React.useMemo(() => {
    const x = refunds.map((r) => r.day);
    const y = refunds.map((r) => Number(r.refunds_sum || 0));
    return {
      backgroundColor: 'transparent',
      grid: { top: 26, right: 12, bottom: 38, left: 56 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v) => nf(Number(v)),
        ...(tooltipGlass as any),
      },
      xAxis: { type: 'category', data: x, ...axisCommon },
      yAxis: {
        type: 'value',
        ...axisCommon,
        axisLabel: { color: chartTheme.axis, formatter: (v: number) => nf(v) },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 18,
          itemStyle: {
            borderRadius: [10, 10, 6, 6],
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(251,113,133,0.95)' },
                { offset: 1, color: 'rgba(251,191,36,0.55)' },
              ],
            } as any,
          },
          data: y,
        },
      ],
    };
  }, [refunds, axisCommon, chartTheme, tooltipGlass]);

  // Покупки по возрасту: МУЖ — тёмно-синий (везде); ЖЕН — как было
  const optionAgeLine: EChartsOption = React.useMemo(() => {
    const ages = Array.from({ length: 88 }, (_, i) => i + 3);
    const maleMap = new Map<number, number>();
    const femaleMap = new Map<number, number>();
    for (const r of ageRows) {
      if (r.gender === 'Муж') maleMap.set(r.age, (maleMap.get(r.age) || 0) + (r.orders_cnt || 0));
      else if (r.gender === 'Жен') femaleMap.set(r.age, (femaleMap.get(r.age) || 0) + (r.orders_cnt || 0));
    }
    const maleSeries = ages.map((a) => maleMap.get(a) ?? 0);
    const femaleSeries = ages.map((a) => femaleMap.get(a) ?? 0);

    return {
      backgroundColor: 'transparent',
      grid: { top: 38, right: 18, bottom: 38, left: 52 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        valueFormatter: (v) => nf(Number(v)),
        ...(tooltipGlass as any),
      },
      legend: { top: 8, data: ['Жен', 'Муж'], textStyle: { color: chartTheme.subtext, fontWeight: 600 } },
      xAxis: { type: 'category', data: ages, ...axisCommon, boundaryGap: false },
      yAxis: { type: 'value', ...axisCommon, minInterval: 1 },
      series: [
        {
          name: 'Жен',
          type: 'line',
          symbol: 'circle',
          symbolSize: 4,
          smooth: 0.25,
          lineStyle: { width: 3, color: chartTheme.violet },
          itemStyle: { color: chartTheme.violet },
          areaStyle: {
            opacity: 1,
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(167,139,250,0.16)' },
                { offset: 1, color: 'rgba(167,139,250,0.02)' },
              ],
            } as any,
          },
          data: femaleSeries,
        },
        {
          name: 'Муж',
          type: 'line',
          symbol: 'circle',
          symbolSize: 4,
          smooth: 0.25,
          lineStyle: { width: 3, color: chartTheme.navy },
          itemStyle: { color: chartTheme.navy },
          areaStyle: {
            opacity: 1,
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(15,23,42,0.14)' },
                { offset: 1, color: 'rgba(15,23,42,0.02)' },
              ],
            } as any,
          },
          data: maleSeries,
        },
      ],
    };
  }, [ageRows, axisCommon, chartTheme, tooltipGlass]);

  const optionLensTypes: EChartsOption = React.useMemo(() => {
    if (!lensStruct || lensStruct.length === 0) {
      return {
        backgroundColor: 'transparent',
        xAxis: { type: 'value' },
        yAxis: { type: 'category', data: [] },
        series: [{ type: 'bar', data: [] }],
      };
    }
    const sorted = [...lensStruct].sort((a, b) => b.items_cnt - a.items_cnt);
    const cats = sorted.map((r) => r.lens_family || '—').reverse();
    const vals = sorted.map((r) => r.items_cnt || 0).reverse();

    return {
      backgroundColor: 'transparent',
      grid: { top: 14, right: 18, bottom: 12, left: 190 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v) => nf(Number(v)),
        ...(tooltipGlass as any),
      },
      xAxis: { type: 'value', ...axisCommon, minInterval: 1 },
      yAxis: { type: 'category', data: cats, ...axisCommon },
      series: [
        {
          type: 'bar',
          barMaxWidth: 22,
          itemStyle: { borderRadius: 10, color: gradTeal as any },
          data: vals,
        },
      ],
    };
  }, [lensStruct, axisCommon, gradTeal, tooltipGlass]);

  const optionLensSphRanges: EChartsOption = React.useMemo(() => {
    if (!lensSph || lensSph.length === 0) {
      return {
        backgroundColor: 'transparent',
        xAxis: { type: 'value' },
        yAxis: { type: 'category', data: [] },
        series: [{ type: 'bar', data: [] }],
      };
    }

    const map = new Map<string, { total: number; sph: number; astig: number }>();
    for (const row of lensSph) {
      const label = row.range_label || 'Без диапазона';
      const kind = row.lens_kind === 'astig' ? 'astig' : 'sph';
      const cnt = Number(row.items_cnt || 0);
      const prev = map.get(label) ?? { total: 0, sph: 0, astig: 0 };
      prev.total += cnt;
      if (kind === 'astig') prev.astig += cnt;
      else prev.sph += cnt;
      map.set(label, prev);
    }

    const rows = [...map.entries()]
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.total - a.total);

    const cats = rows.map((r) => r.label);
    const sphData = rows.map((r) => r.sph);
    const astigData = rows.map((r) => r.astig);

    return {
      backgroundColor: 'transparent',
      grid: { top: 44, right: 18, bottom: 12, left: 240 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const list = Array.isArray(params) ? params : [params];
          const idx = list[0]?.dataIndex ?? 0;
          const row = rows[idx];
          return [
            `<b>${row.label}</b>`,
            `Всего: ${nf(row.total)}`,
            `Обычные: ${nf(row.sph)}`,
            `Астигматические: ${nf(row.astig)}`,
          ].join('<br/>');
        },
        ...(tooltipGlass as any),
      },
      legend: {
        top: 8,
        textStyle: { color: chartTheme.subtext, fontSize: 11, fontWeight: 600 },
        data: ['Обычные', 'Астигматические'],
      },
      xAxis: { type: 'value', ...axisCommon, minInterval: 1 },
      yAxis: {
        type: 'category',
        data: cats,
        ...axisCommon,
        axisLabel: { color: chartTheme.axis, fontSize: 11 },
      },
      series: [
        {
          name: 'Обычные',
          type: 'bar',
          stack: 'total',
          barMaxWidth: 22,
          itemStyle: { borderRadius: [10, 0, 0, 10], color: 'rgba(34,211,238,0.90)' },
          data: sphData,
        },
        {
          name: 'Астигматические',
          type: 'bar',
          stack: 'total',
          barMaxWidth: 22,
          itemStyle: { borderRadius: [0, 10, 10, 0], color: 'rgba(20,184,166,0.78)' },
          data: astigData,
        },
      ],
    };
  }, [lensSph, axisCommon, chartTheme, tooltipGlass]);

  /* ========== UI ========== */
  return (
    <div className="min-h-[100dvh] bg-transparent text-slate-900">
      {/* декоративные подсветки (фон остаётся прозрачным) */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -left-24 -top-20 h-72 w-72 rounded-full bg-gradient-to-br from-teal-300/30 via-cyan-300/22 to-sky-300/18 blur-3xl" />
        <div className="absolute -right-28 top-24 h-80 w-80 rounded-full bg-gradient-to-br from-sky-300/22 via-indigo-300/16 to-violet-300/16 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-gradient-to-br from-emerald-300/18 via-teal-300/14 to-cyan-300/16 blur-3xl" />
      </div>

      <div className="mx-auto w-full max-w-7xl px-5 pb-10 pt-8">
        {/* Header */}
        <header className="rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/80 p-5 ring-1 ring-sky-200/55 shadow-[0_22px_80px_rgba(15,23,42,0.22)] backdrop-blur-2xl sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_18px_55px_rgba(34,211,238,0.55)]">
                <BarChart3 className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-[22px] font-semibold leading-tight text-slate-900 md:text-[28px]">
                  Статистика по всем оптикам
                </h1>
                <p className="mt-1 text-xs text-slate-600/90 md:text-sm">
                  Один экран: выручка, прибыль, клиенты, линзы и загрузка по времени.
                </p>
              </div>
            </div>

            <div className="flex flex-col items-start gap-3 sm:items-end">
              <div className="text-[11px] text-slate-600/90 sm:text-xs">
                <div className="font-medium text-slate-800">Период</div>
                <div className="mt-0.5">
                  <span className="font-medium text-slate-900">{fromISO}</span> —{' '}
                  <span className="font-medium text-slate-900">{toISO}</span>
                </div>
                <div className="mt-0.5 max-w-[320px] truncate">
                  {branches.length > 0 ? `Филиалы: ${branches.join(', ')}` : 'Филиалы: все'}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">Примечание: воскресенья исключены из дневных графиков.</div>
              </div>

              <div className="flex flex-wrap gap-2">
                <SoftGhostButton onClick={() => applyPreset('all')} icon={CalendarDays}>
                  Всё время
                </SoftGhostButton>
                <SoftGhostButton onClick={() => applyPreset('month')} icon={CalendarDays}>
                  Этот месяц
                </SoftGhostButton>
                <SoftGhostButton onClick={() => applyPreset('30d')} icon={Timer}>
                  30 дней
                </SoftGhostButton>
                <SoftGhostButton onClick={() => applyPreset('7d')} icon={Timer}>
                  7 дней
                </SoftGhostButton>
                <SoftGhostButton onClick={() => applyPreset('year')} icon={CalendarDays}>
                  Год
                </SoftGhostButton>

                <SoftPrimaryButton onClick={() => loadAll()} disabled={loading} icon={RefreshCw}>
                  {loading ? 'Обновляю…' : 'Обновить'}
                </SoftPrimaryButton>
              </div>
            </div>
          </div>
        </header>

        {gate === 'pending' && (
          <Section tone="neutral">
            <div className="text-sm text-slate-500">Проверяю доступ…</div>
          </Section>
        )}

        {gate === 'denied' && (
          <Section tone="danger">
            <div className="inline-flex items-center gap-2 rounded-2xl bg-rose-50/90 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200 shadow-[0_14px_40px_rgba(248,113,113,0.25)]">
              <AlertTriangle className="h-4 w-4" />
              Доступ только владельцу.
            </div>
          </Section>
        )}

        {gate === 'ok' && (
          <>
            {/* Filters */}
            <Section
              tone="neutral"
              title={
                <span className="inline-flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_10px_30px_rgba(34,211,238,0.35)]">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                  Фильтры
                </span>
              }
              aside={
                <span className="inline-flex items-center gap-2 text-slate-600/80">
                  <Percent className="h-4 w-4" />
                  По умолчанию: всё время
                </span>
              }
            >
              <div className="grid gap-4 lg:grid-cols-12">
                <div className="lg:col-span-3">
                  <Label>
                    <CalendarDays className="mr-2 -mt-0.5 inline h-4 w-4 text-slate-500" />
                    С даты
                  </Label>
                  <InputDate value={fromISO} onChange={(v) => setFromISO(v.slice(0, 10))} />
                </div>

                <div className="lg:col-span-3">
                  <Label>
                    <CalendarDays className="mr-2 -mt-0.5 inline h-4 w-4 text-slate-500" />
                    По дату
                  </Label>
                  <InputDate value={toISO} onChange={(v) => setToISO(v.slice(0, 10))} />
                </div>

                <div className="lg:col-span-4">
                  <Label>
                    <Building2 className="mr-2 -mt-0.5 inline h-4 w-4 text-slate-500" />
                    Филиалы
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    <Chip active={branches.length === 0} onClick={() => setBranches([])}>
                      Все филиалы
                    </Chip>

                    {branchOptions.map((b) => {
                      const active = branches.includes(b);
                      return (
                        <Chip
                          key={b}
                          active={active}
                          onClick={() => setBranches((prev) => (active ? prev.filter((x) => x !== b) : [...prev, b]))}
                        >
                          {b}
                        </Chip>
                      );
                    })}

                    {branches.length > 0 && (
                      <button
                        onClick={() => setBranches([])}
                        className="ml-1 text-xs font-medium text-slate-600/80 underline decoration-slate-400/40 underline-offset-4 hover:text-slate-900"
                      >
                        Сбросить
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-end lg:col-span-2">
                  <SoftPrimaryButton onClick={() => loadAll()} disabled={loading} icon={TrendingUp} className="w-full">
                    {loading ? 'Загружаю…' : 'Показать'}
                  </SoftPrimaryButton>
                </div>
              </div>

              {err && (
                <div className="mt-4 inline-flex items-start gap-2 rounded-2xl bg-amber-50/90 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200 shadow-[0_14px_40px_rgba(245,158,11,0.18)]">
                  <AlertTriangle className="mt-0.5 h-4 w-4" />
                  <span className="leading-snug">Предупреждение: {err}</span>
                </div>
              )}
            </Section>

            {/* KPI */}
            <div className="mt-6 grid gap-4 md:grid-cols-4">
              <KPI
                label="Выручка"
                value={nf(totals.revenue)}
                icon={LineChart}
                iconTone="money"
                accent="from-sky-200/55 via-cyan-200/45 to-teal-200/40"
              />
              <KPI
                label="Поступления"
                value={nf(totals.inflow)}
                icon={HandCoins}
                iconTone="money"
                accent="from-emerald-200/55 via-teal-200/45 to-cyan-200/40"
              />
              <KPI
                label="Долг"
                value={nf(totals.debt)}
                icon={ReceiptRussianRuble}
                iconTone="danger"
                accent="from-rose-200/55 via-orange-200/55 to-amber-200/45"
                danger={totals.debt > 0}
              />
              <KPI
                label="Заказы"
                value={nf(totals.orders)}
                icon={Users2}
                iconTone="violet"
                accent="from-violet-200/55 via-fuchsia-200/45 to-pink-200/45"
              />
            </div>

            {/* Charts */}
            <Section
              tone="money"
              title={
                <span className="inline-flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_10px_30px_rgba(34,211,238,0.35)]">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                  Выручка / Поступления / Долг
                </span>
              }
              aside={<span className="text-xs text-slate-600/80">Линии + столбики, один график (без воскресений)</span>}
            >
              <ChartFrame height={380}>
                <ReactECharts option={optionByDay} lazyUpdate notMerge opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
              </ChartFrame>
            </Section>

            <Section
              tone="money"
              title={
                <span className="inline-flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_10px_30px_rgba(34,211,238,0.35)]">
                    <LineChart className="h-4 w-4" />
                  </div>
                  Чистая прибыль по дням
                </span>
              }
              aside={<span className="text-xs text-slate-600/80">Линия с заливкой (без воскресений)</span>}
            >
              <ChartFrame height={360}>
                <ReactECharts option={optionNetProfit} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
              </ChartFrame>
            </Section>

            {/* By branch table */}
            <Section
              tone="neutral"
              title={
                <span className="inline-flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-sky-400 via-cyan-400 to-teal-400 text-white shadow-[0_10px_30px_rgba(34,211,238,0.30)]">
                    <Building2 className="h-4 w-4" />
                  </div>
                  Сравнение по филиалам
                </span>
              }
              aside={<span className="text-xs text-slate-600/80">orders_view vs stats_daily</span>}
            >
              <GlassTable>
                <table className="w-full text-sm">
                  <thead className="bg-gradient-to-r from-slate-50 via-white to-sky-50/70 text-slate-600">
                    <tr>
                      <Th>Филиал</Th>
                      <ThRight>Заказы (orders_view)</ThRight>
                      <ThRight>Выручка (orders_view)</ThRight>
                      <ThRight>Заказы (stats_daily)</ThRight>
                      <ThRight>Выручка (stats_daily)</ThRight>
                    </tr>
                  </thead>
                  <tbody>
                    {byBranch.map((r) => (
                      <tr key={r.branch} className="odd:bg-white/70 even:bg-slate-50/60">
                        <td className="px-3 py-2 font-medium text-slate-800">{r.branch}</td>
                        <td className="px-3 py-2 text-right">{nf(r.ov_orders)}</td>
                        <td className="px-3 py-2 text-right">{nf(r.ov_revenue)}</td>
                        <td className="px-3 py-2 text-right">{nf(r.sd_orders)}</td>
                        <td className="px-3 py-2 text-right">{nf(r.sd_revenue)}</td>
                      </tr>
                    ))}
                    {byBranch.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                          Нет данных за период
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </GlassTable>
            </Section>

            {/* Payments (Статусы заказов УБРАНЫ) */}
            <div className="mt-6">
              <Section
                tone="money"
                title={
                  <span className="inline-flex items-center gap-2">
                    <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 via-teal-400 to-cyan-400 text-white shadow-[0_10px_30px_rgba(52,211,153,0.28)]">
                      <HandCoins className="h-4 w-4" />
                    </div>
                    Оплаты по методам
                  </span>
                }
                aside={<span className="text-xs text-slate-600/80">Сверка с поступлениями</span>}
              >
                <GlassTable>
                  <table className="w-full text-sm">
                    <thead className="bg-gradient-to-r from-slate-50 via-white to-emerald-50/60 text-slate-600">
                      <tr>
                        <Th>Метод</Th>
                        <ThRight>Кол-во</ThRight>
                        <ThRight>Сумма</ThRight>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.method} className="odd:bg-white/70 even:bg-slate-50/60">
                          <td className="px-3 py-2 font-medium text-slate-800">{paymentMethodLabel(p.method)}</td>
                          <td className="px-3 py-2 text-right">{nf(p.cnt)}</td>
                          <td className="px-3 py-2 text-right">{nf(p.sum)}</td>
                        </tr>
                      ))}
                      {payments.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-3 py-6 text-center text-slate-500">
                            Нет данных
                          </td>
                        </tr>
                      )}
                    </tbody>
                    {payments.length > 0 && (
                      <tfoot>
                        <tr className="border-t border-slate-200 bg-slate-50/70">
                          <td className="px-3 py-2 text-right font-semibold text-slate-800">Итого</td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-800">{nf(paymentsTotals.cnt)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-800">{nf(paymentsTotals.sum)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </GlassTable>

                {payments.length > 0 && (
                  <div className="mt-3 rounded-2xl bg-white/70 px-4 py-3 text-xs text-slate-600 ring-1 ring-sky-200/50 shadow-[0_14px_40px_rgba(15,23,42,0.10)]">
                    Поступления по KPI: <b className="text-slate-900">{nf(totals.inflow)}</b> сом. Сумма по методам:{' '}
                    <b className="text-slate-900">{nf(paymentsTotals.sum)}</b> сом.
                    {Math.round(totals.inflow) !== Math.round(paymentsTotals.sum) && (
                      <span className="ml-2 text-amber-700">
                        Есть расхождение — проверь rpcRevenueInflowByDay / rpcPaymentsBreakdown.
                      </span>
                    )}
                  </div>
                )}
              </Section>
            </div>

            {/* Customers */}
            <Section
              tone="neutral"
              title={
                <span className="inline-flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-indigo-400 via-sky-400 to-cyan-400 text-white shadow-[0_10px_30px_rgba(129,140,248,0.28)]">
                    <Users2 className="h-4 w-4" />
                  </div>
                  Клиенты
                </span>
              }
              aside={<span className="text-xs text-slate-600/80">Новые / Вернувшиеся</span>}
            >
              {custKpis ? (
                <>
                  <div className="grid gap-4 md:grid-cols-4">
                    <StatBox label="Средний чек" value={nf(Math.round(custKpis.avg_check))} icon={CreditCard} tone="neutral" />
                    <StatBox label="Медианный чек" value={nf(Math.round(custKpis.median_check))} icon={CreditCard} tone="neutral" />
                    <StatBox
                      label="Средний интервал (дни)"
                      value={(custKpis.avg_interval_days ?? 0).toFixed(1)}
                      icon={CalendarDays}
                      tone="warn"
                    />
                    <StatBox
                      label="Доля вернувшихся"
                      value={`${Math.round((custKpis.returning_share ?? 0) * 100)}%`}
                      icon={Users2}
                      tone="ok"
                    />
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <ChartFrame height={320} title="Новые vs Вернувшиеся" icon={PieChart}>
                      <ReactECharts option={optionNewReturning} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
                    </ChartFrame>

                    <ChartFrame height={320} title="Гендер покупателей" icon={PieChart}>
                      <ReactECharts option={optionGenderPie} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
                    </ChartFrame>
                  </div>
                </>
              ) : (
                <EmptyState>Нет данных…</EmptyState>
              )}
            </Section>

            {/* Lenses */}
            <Section
              tone="neutral"
              title={
                <span className="inline-flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_10px_30px_rgba(34,211,238,0.28)]">
                    <BarChart3 className="h-4 w-4" />
                  </div>
                  Линзы: по видам и диапазонам диоптрий
                </span>
              }
              aside={<span className="text-xs text-slate-600/80">Срез по продажам</span>}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <ChartFrame height={420} title="По видам линз" icon={BarChart3}>
                  <ReactECharts option={optionLensTypes} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
                </ChartFrame>

                <ChartFrame height={420} title="По диапазонам диоптрий" icon={BarChart3}>
                  <ReactECharts option={optionLensSphRanges} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
                </ChartFrame>
              </div>
            </Section>

            {/* Age */}
            <Section
              tone="neutral"
              title={
                <span className="inline-flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-violet-400 via-indigo-400 to-sky-400 text-white shadow-[0_10px_30px_rgba(167,139,250,0.22)]">
                    <LineChart className="h-4 w-4" />
                  </div>
                  Покупки по возрасту (годы)
                </span>
              }
              aside={<span className="text-xs text-slate-600/80">М/Ж, линия с заливкой</span>}
            >
              <ChartFrame height={340}>
                <ReactECharts option={optionAgeLine} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
              </ChartFrame>
            </Section>

            {/* Time */}
            <Section
              tone="neutral"
              title={
                <span className="inline-flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-sky-400 via-cyan-400 to-teal-400 text-white shadow-[0_10px_30px_rgba(34,211,238,0.22)]">
                    <Timer className="h-4 w-4" />
                  </div>
                  Заказы по времени (каждые 10 минут)
                </span>
              }
              aside={<span className="text-xs text-slate-600/80">Слайдер + zoom</span>}
            >
              <ChartFrame height={340}>
                <ReactECharts option={optionOrdersBy10Min} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
              </ChartFrame>
            </Section>

            <Section
              tone="neutral"
              title={
                <span className="inline-flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_10px_30px_rgba(34,211,238,0.22)]">
                    <BarChart3 className="h-4 w-4" />
                  </div>
                  Заказы по дням недели
                </span>
              }
              aside={<span className="text-xs text-slate-600/80">Воскресенье исключено</span>}
            >
              <ChartFrame height={300}>
                <ReactECharts option={optionOrdersByDow} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
              </ChartFrame>
            </Section>

            <Section
              tone="neutral"
              title={
                <span className="inline-flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-sky-400 via-cyan-400 to-teal-400 text-white shadow-[0_10px_30px_rgba(34,211,238,0.22)]">
                    <LineChart className="h-4 w-4" />
                  </div>
                  Распределение чеков (сом)
                </span>
              }
              aside={<span className="text-xs text-slate-600/80">Кривая по корзинам</span>}
            >
              <ChartFrame height={340}>
                <ReactECharts option={optionBins} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
              </ChartFrame>
            </Section>

            <Section
              tone="danger"
              title={
                <span className="inline-flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-rose-400 via-orange-300 to-amber-300 text-white shadow-[0_10px_30px_rgba(251,113,133,0.18)]">
                    <ReceiptRussianRuble className="h-4 w-4" />
                  </div>
                  Возвраты по дням
                </span>
              }
              aside={<span className="text-xs text-slate-600/80">Сумма возвратов (без воскресений)</span>}
            >
              <ChartFrame height={300}>
                <ReactECharts option={optionRefunds} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
              </ChartFrame>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

/* ====== small UI components (Refocus glass) ====== */

function Section({
  children,
  title,
  aside,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  title?: React.ReactNode;
  aside?: React.ReactNode;
  tone?: 'neutral' | 'money' | 'danger';
}) {
  const hasHeader = title || aside;

  const toneBg =
    tone === 'money'
      ? 'from-white via-slate-50 to-sky-50/85'
      : tone === 'danger'
        ? 'from-white via-rose-50 to-amber-50/80'
        : 'from-white via-slate-50 to-sky-50/80';

  const toneRing =
    tone === 'money' ? 'ring-sky-200/55' : tone === 'danger' ? 'ring-rose-200/55' : 'ring-sky-200/45';

  return (
    <section
      className={[
        'mt-5 rounded-3xl bg-gradient-to-br p-5 shadow-[0_22px_70px_rgba(15,23,42,0.18)] backdrop-blur-xl ring-1',
        toneBg,
        toneRing,
      ].join(' ')}
    >
      {hasHeader && (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {title && <h2 className="text-[15px] font-semibold text-slate-800">{title}</h2>}
          {aside && <div className="text-xs text-slate-500">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

function ChartFrame({
  children,
  height,
  title,
  icon,
}: {
  children: React.ReactNode;
  height: number;
  title?: string;
  icon?: React.ElementType;
}) {
  const Icon = icon;
  return (
    <div
      className="rounded-2xl bg-white/70 p-2 ring-1 ring-sky-200/40 shadow-[0_20px_60px_rgba(15,23,42,0.14)] backdrop-blur-xl"
      style={{ height } as React.CSSProperties}
    >
      {title && (
        <div className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold text-slate-600">
          {Icon && (
            <span className="grid h-7 w-7 place-items-center rounded-xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_10px_26px_rgba(34,211,238,0.25)]">
              <Icon className="h-4 w-4" />
            </span>
          )}
          {title}
        </div>
      )}
      <div style={{ height: title ? 'calc(100% - 34px)' : '100%' }}>{children}</div>
    </div>
  );
}

function GlassTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white/70 ring-1 ring-sky-200/40 shadow-[0_20px_60px_rgba(15,23,42,0.14)] backdrop-blur-xl">
      {children}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left text-[13px] font-semibold">{children}</th>;
}
function ThRight({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-right text-[13px] font-semibold">{children}</th>;
}

function KPI({
  label,
  value,
  icon,
  accent = 'from-slate-200 to-slate-100',
  danger = false,
  iconTone = 'money',
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ElementType;
  accent?: string;
  danger?: boolean;
  iconTone?: 'money' | 'danger' | 'violet' | 'neutral';
}) {
  const Icon = icon;

  const iconBg =
    iconTone === 'danger'
      ? 'from-rose-400 via-orange-300 to-amber-300'
      : iconTone === 'violet'
        ? 'from-violet-400 via-indigo-400 to-sky-400'
        : iconTone === 'neutral'
          ? 'from-slate-700 via-slate-800 to-slate-900'
          : 'from-teal-400 via-cyan-400 to-sky-400';

  return (
    <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/80 p-4 ring-1 ring-sky-200/55 shadow-[0_18px_60px_rgba(15,23,42,0.16)] backdrop-blur-xl transition hover:shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
      <div className={`pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-gradient-to-br ${accent} blur-2xl opacity-70 group-hover:opacity-100`} />
      <div className="relative z-10 flex items-center gap-3">
        {Icon && (
          <div
            className={[
              'grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-[0_14px_40px_rgba(15,23,42,0.18)]',
              iconBg,
            ].join(' ')}
          >
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500/90">{label}</div>
          <div className={`mt-1 text-[22px] font-semibold ${danger ? 'text-rose-600' : 'text-slate-900'}`}>{value}</div>
        </div>
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ElementType;
  tone: 'neutral' | 'ok' | 'warn' | 'danger';
}) {
  const Icon = icon;

  const bg =
    tone === 'ok'
      ? 'from-emerald-50 via-white to-emerald-50'
      : tone === 'warn'
        ? 'from-amber-50 via-white to-amber-50'
        : tone === 'danger'
          ? 'from-rose-50 via-white to-rose-50'
          : 'from-sky-50 via-white to-sky-50';

  const ring =
    tone === 'ok'
      ? 'ring-emerald-200/70'
      : tone === 'warn'
        ? 'ring-amber-200/70'
        : tone === 'danger'
          ? 'ring-rose-200/70'
          : 'ring-sky-200/70';

  const iconBg =
    tone === 'ok'
      ? 'from-emerald-400 via-teal-400 to-cyan-400'
      : tone === 'warn'
        ? 'from-amber-400 via-orange-300 to-rose-300'
        : tone === 'danger'
          ? 'from-rose-400 via-orange-300 to-amber-300'
          : 'from-teal-400 via-cyan-400 to-sky-400';

  return (
    <div className={['rounded-2xl bg-gradient-to-br p-4 shadow-[0_16px_50px_rgba(15,23,42,0.14)] backdrop-blur-xl ring-1', bg, ring].join(' ')}>
      <div className="flex items-center gap-3">
        {Icon && (
          <div
            className={[
              'grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-[0_14px_40px_rgba(15,23,42,0.14)]',
              iconBg,
            ].join(' ')}
          >
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500/90">{label}</div>
          <div className="mt-1 text-[18px] font-semibold text-slate-900">{value}</div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/80 p-8 text-center text-sm text-slate-600 ring-1 ring-sky-200/50 shadow-[0_22px_70px_rgba(15,23,42,0.12)] backdrop-blur-xl">
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-semibold text-slate-600">{children}</label>;
}

function InputDate({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <input
        type="date"
        className="w-full rounded-[14px] bg-white/90 px-3 py-2 pr-9 text-sm text-slate-900 ring-1 ring-sky-200/80 shadow-[0_14px_40px_rgba(15,23,42,0.10)] outline-none focus:ring-2 focus:ring-cyan-400/80"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <CalendarDays className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void | Promise<void>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => void onClick?.()}
      className={[
        'h-8 rounded-full px-3 text-xs font-semibold transition shadow-[0_12px_32px_rgba(15,23,42,0.10)] ring-1',
        active
          ? 'bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 text-white ring-sky-200/40'
          : 'bg-white/85 text-slate-700 ring-teal-200/60 hover:bg-white',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function SoftPrimaryButton({
  children,
  disabled,
  onClick,
  icon,
  className = '',
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void | Promise<void>;
  icon?: React.ElementType;
  className?: string;
}) {
  const Icon = icon;
  const spin = typeof children === 'string' && (children === 'Обновляю…' || children === 'Загружаю…');

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void onClick?.()}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_40px_rgba(34,211,238,0.35)] ring-1 ring-sky-200/40 hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-teal-300/70',
        className,
      ].join(' ')}
    >
      {Icon && <Icon className={['h-4 w-4', spin && !disabled ? 'animate-spin' : ''].join(' ')} />}
      {children}
    </button>
  );
}

function SoftGhostButton({
  children,
  onClick,
  icon,
}: {
  children: React.ReactNode;
  onClick?: () => void | Promise<void>;
  icon?: React.ElementType;
}) {
  const Icon = icon;
  return (
    <button
      type="button"
      onClick={() => void onClick?.()}
      className="inline-flex items-center gap-2 rounded-xl bg-white/85 px-3.5 py-2 text-xs font-semibold text-teal-700 ring-1 ring-teal-200/70 shadow-[0_14px_40px_rgba(15,23,42,0.10)] hover:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
    >
      {Icon && <Icon className="h-4 w-4 text-teal-600" />}
      {children}
    </button>
  );
}
