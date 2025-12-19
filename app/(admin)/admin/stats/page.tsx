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
} from 'lucide-react';

import {
  rpcRevenueInflowByDay,
  rpcPeriodByBranch,
  rpcPaymentsBreakdown,
  rpcStatusCounts,
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

const nf = (n: number) =>
  Number.isFinite(+n) ? Number(n).toLocaleString('ru-RU') : '0';

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

/** Берём только YYYY-MM-DD */
const onlyDate = (s: string | null) => {
  if (!s) return null;
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/** Текущий месяц: с 1-го числа до сегодня (локальное время) */
const getCurrentMonthRange = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const pad = (v: number) => String(v).padStart(2, '0');

  const from = `${year}-${pad(month)}-01`;
  const to = `${year}-${pad(month)}-${pad(day)}`;

  return { from, to };
};

/** Проверка роли owner */
async function isOwner(): Promise<boolean> {
  const sb = getSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return false;
  const { data } = await sb
    .from('profiles')
    .select('role')
    .eq('id', u.user.id)
    .single();
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
type StatusRow = { status: string; cnt: number };

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

export default function AdminStatsPage() {
  /* --- доступ --- */
  const [gate, setGate] = React.useState<'pending' | 'ok' | 'denied'>(
    'pending',
  );

  /* --- фильтры --- */
  const [fromISO, setFromISO] = React.useState<string>(
    () => getCurrentMonthRange().from,
  );
  const [toISO, setToISO] = React.useState<string>(
    () => getCurrentMonthRange().to,
  );
  const branchOptions = ALL_BRANCHES;
  const [branches, setBranches] = React.useState<string[]>([]); // [] = все филиалы

  /* --- данные --- */
  const [byDay, setByDay] = React.useState<DayRow[]>([]);
  const [byBranch, setByBranch] = React.useState<BranchRow[]>([]);
  const [payments, setPayments] = React.useState<PayRow[]>([]);
  const [statuses, setStatuses] = React.useState<StatusRow[]>([]);
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

  /* --- читаем фильтры из URL и нормализуем --- */
  React.useEffect(() => {
    const urlFrom = onlyDate(searchParams.get('from'));
    const urlTo = onlyDate(searchParams.get('to'));
    const urlBranches = searchParams.get('branches');
    if (urlFrom) setFromISO(urlFrom);
    if (urlTo) setToISO(urlTo);
    if (urlBranches) {
      const parsed = urlBranches
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      setBranches(parsed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushFiltersToURL = React.useCallback(() => {
    const qs = new URLSearchParams();
    qs.set('from', fromISO.slice(0, 10));
    qs.set('to', toISO.slice(0, 10));
    if (branches.length) qs.set('branches', branches.join(','));
    router.replace(`?${qs.toString()}`, { scroll: false });
  }, [router, fromISO, toISO, branches]);

  /* --- загрузчик (устойчивый к падению отдельных RPC) --- */
  async function loadAll() {
    setLoading(true);
    setErr(null);

    const brArg: string[] = branches.length ? branches : [];

    const results = await Promise.allSettled([
      rpcRevenueInflowByDay(fromISO, toISO, brArg), // 0
      rpcPeriodByBranch(fromISO, toISO, brArg), // 1
      rpcPaymentsBreakdown(fromISO, toISO, brArg), // 2
      rpcStatusCounts(fromISO, toISO, brArg), // 3
      rpcNewVsReturning(fromISO, toISO, brArg), // 4
      rpcAvgIntervalDays(fromISO, toISO, brArg), // 5
      rpcAvgMedianCheck(fromISO, toISO, brArg), // 6
      rpcHeatmap(fromISO, toISO, brArg), // 7
      rpcCheckHistogram(fromISO, toISO, 200, 30000, brArg), // 8
      rpcRefundsByDay(fromISO, toISO, brArg), // 9
      rpcAgeByYear(fromISO, toISO, brArg), // 10
      rpcLensStructure(fromISO, toISO, brArg), // 11
      rpcNetProfitByDay(fromISO, toISO, brArg), // 12
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
    const s = get<StatusRow[]>(3, []);
    const nv = get<{
      new_customers: number;
      returning_customers: number;
      customers_total: number;
      returning_share: number;
    }>(4, {
      new_customers: 0,
      returning_customers: 0,
      customers_total: 0,
      returning_share: 0,
    });
    const avgInt = get<number>(5, 0);
    const ck = get<{ avg_check: number; median_check: number }>(6, {
      avg_check: 0,
      median_check: 0,
    });
    const heatRows = get<HeatRow[]>(7, []);
    const binRows = get<BinRow[]>(8, []);
    const refundRows = get<RefundRow[]>(9, []);
    const ages = get<AgeRow[]>(10, []);
    const lens = get<LensStructRow[]>(11, []);
    const np = get<NetProfitRow[]>(12, []);

    setByDay(d);
    setByBranch(b);
    setPayments(p);
    setStatuses(s);
    setHeat(heatRows);
    setBins(binRows);
    setRefunds(refundRows);
    setAgeRows(ages);
    setLensStruct(lens);
    setNetProfit(np);

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
      const { data: lensSphRaw, error: lensErr } = await sb.rpc(
        'stats_lens_sph_ranges',
        {
          p_from: fromISO,
          p_to: toISO,
          p_branches: brArg.length ? brArg : null,
        },
      );

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
      const { data: orders10Raw, error: err10 } = await sb.rpc(
        'stats_orders_by_10min',
        {
          p_from: fromISO,
          p_to: toISO,
          p_branches: brArg.length ? brArg : null,
        },
      );

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

    if (warns.length) {
      setErr(warns.join(' · '));
    } else {
      setErr(null);
    }

    pushFiltersToURL();
    setLoading(false);
  }

  /* --- первичная загрузка --- */
  React.useEffect(() => {
    if (gate === 'ok') void loadAll();
  }, [gate]); // eslint-disable-line react-hooks/exhaustive-deps

  /* --- агрегаты KPI --- */
  const totals = React.useMemo(() => {
    const revenue = byDay.reduce((a, r) => a + (r.revenue || 0), 0);
    const inflow = byDay.reduce((a, r) => a + (r.inflow || 0), 0);
    const debt = Math.max(0, revenue - inflow);
    const orders = statuses.reduce((a, s) => a + (s.cnt || 0), 0);
    return { revenue, inflow, debt, orders };
  }, [byDay, statuses]);

  // агрегаты по методам оплаты (для проверки против inflow)
  const paymentsTotals = React.useMemo(
    () => ({
      cnt: payments.reduce((a, p) => a + (p.cnt || 0), 0),
      sum: payments.reduce((a, p) => a + (p.sum || 0), 0),
    }),
    [payments],
  );

  /* ========== ECharts options ========== */

  const optionByDay: EChartsOption = React.useMemo(() => {
    const x = byDay.map((r) => r.day);
    const rev = byDay.map((r) => r.revenue || 0);
    const inf = byDay.map((r) => r.inflow || 0);
    const deb = byDay.map((r) => Math.max(0, r.debt || 0));

    return {
      grid: { top: 40, right: 18, bottom: 36, left: 54 },
      legend: {
        top: 4,
        itemWidth: 14,
        itemHeight: 8,
        textStyle: { color: '#334155', fontSize: 12, fontWeight: 500 },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        valueFormatter: (v) => nf(Number(v)),
      },
      xAxis: {
        type: 'category',
        data: x,
        boundaryGap: true,
        axisLabel: { color: '#334155', fontSize: 12 },
        axisLine: { lineStyle: { color: '#cbd5e1' } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: '#334155',
          fontSize: 12,
          formatter: (val: number) => nf(Number(val)),
        },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      series: [
        {
          name: 'Выручка',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2 },
          emphasis: { focus: 'series' },
          data: rev,
        },
        {
          name: 'Поступления',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2 },
          emphasis: { focus: 'series' },
          data: inf,
        },
        {
          name: 'Долг',
          type: 'bar',
          barMaxWidth: 18,
          emphasis: { focus: 'series' },
          data: deb,
        },
      ],
    };
  }, [byDay]);

  // Чистая прибыль
  const optionNetProfit: EChartsOption = React.useMemo(() => {
    const x = netProfit.map((r) => r.day);
    const y = netProfit.map((r) => r.net_profit || 0);
    return {
      grid: { top: 30, right: 18, bottom: 36, left: 54 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        valueFormatter: (v) => nf(Number(v)),
      },
      xAxis: {
        type: 'category',
        data: x,
        axisLabel: { color: '#334155' },
        axisLine: { lineStyle: { color: '#cbd5e1' } },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: '#334155',
          formatter: (v: number) => nf(v),
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
          data: y,
          areaStyle: { opacity: 0.08 },
        },
      ],
    };
  }, [netProfit]);

  const optionNewReturning: EChartsOption = React.useMemo(() => {
    const a = custKpis?.new_customers ?? 0;
    const b = custKpis?.returning_customers ?? 0;
    return {
      tooltip: { trigger: 'item', valueFormatter: (v) => nf(Number(v)) },
      legend: { top: 0, textStyle: { color: '#334155' } },
      series: [
        {
          type: 'pie',
          radius: ['35%', '70%'],
          center: ['50%', '55%'],
          label: { formatter: '{b}: {c}' },
          data: [
            { name: 'Новые', value: a },
            { name: 'Вернувшиеся', value: b },
          ],
        },
      ],
    };
  }, [custKpis]);

  /* ====== Гендер (pie) ====== */
  const optionGenderPie: EChartsOption = React.useMemo(() => {
    let male = 0;
    let female = 0;
    for (const r of ageRows) {
      if (r.gender === 'Муж') male += r.orders_cnt || 0;
      if (r.gender === 'Жен') female += r.orders_cnt || 0;
    }
    return {
      tooltip: { trigger: 'item', valueFormatter: (v) => nf(Number(v)) },
      legend: { top: 0, textStyle: { color: '#334155' } },
      series: [
        {
          type: 'pie',
          radius: ['40%', '70%'],
          center: ['50%', '55%'],
          label: { formatter: '{b}: {c}' },
          data: [
            { name: 'Жен', value: female },
            { name: 'Муж', value: male },
          ],
        },
      ],
    };
  }, [ageRows]);

  /* ====== Заказы по 10-минутным интервалам ====== */
  const optionOrdersBy10Min: EChartsOption = React.useMemo(() => {
    if (!orders10.length) {
      return {
        xAxis: { type: 'category', data: [] },
        yAxis: { type: 'value' },
        series: [{ type: 'bar', data: [] }],
      };
    }

    // 1) Агрегируем все строки по bucket
    const bucketMap = new Map<
      string,
      { orders_cnt: number; revenue_sum: number }
    >();

    for (const row of orders10) {
      const bucket = String(row.bucket); // '11:20'
      const prev = bucketMap.get(bucket) ?? { orders_cnt: 0, revenue_sum: 0 };
      bucketMap.set(bucket, {
        orders_cnt: prev.orders_cnt + Number(row.orders_cnt || 0),
        revenue_sum: prev.revenue_sum + Number(row.revenue_sum || 0),
      });
    }

    // 2) Превращаем в массив и сортируем по времени
    const aggregated = [...bucketMap.entries()]
      .map(([bucket, v]) => ({
        bucket,
        orders_cnt: v.orders_cnt,
        revenue_sum: v.revenue_sum,
      }))
      .sort((a, b) => {
        const [ha, ma] = a.bucket.split(':').map(Number);
        const [hb, mb] = b.bucket.split(':').map(Number);
        return ha * 60 + ma - (hb * 60 + mb);
      });

    const labels = aggregated.map((r) => r.bucket);
    const orders = aggregated.map((r) => r.orders_cnt ?? 0);

    return {
      grid: { top: 26, right: 16, bottom: 58, left: 44 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const idx = p.dataIndex ?? 0;
          const row = aggregated[idx];
          const time = row.bucket;
          const ordersText = nf(row.orders_cnt ?? 0);
          const revenueText = nf(Number(row.revenue_sum ?? 0));
          return `${time}<br/>Заказы: ${ordersText}<br/>Выручка: ${revenueText}`;
        },
      },
      dataZoom: [
        {
          type: 'inside',
          start: 0,
          end: 100,
        },
        {
          type: 'slider',
          height: 18,
          bottom: 4,
          handleSize: 12,
        },
      ],
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: {
          color: '#334155',
          fontSize: 10,
          rotate: 45,
        },
        axisLine: { lineStyle: { color: '#cbd5e1' } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#334155' },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
        minInterval: 1,
      },
      series: [
        {
          name: 'Заказы',
          type: 'bar',
          barMaxWidth: 14,
          data: orders,
        },
      ],
    };
  }, [orders10]);

  /* ====== Дни недели (bar) ====== */
  const optionOrdersByDow: EChartsOption = React.useMemo(() => {
    const labels: Record<number, string> = {
      1: 'Пн',
      2: 'Вт',
      3: 'Ср',
      4: 'Чт',
      5: 'Пт',
      6: 'Сб',
    };
    const sums = new Map<number, number>();
    for (const h of heat)
      sums.set(h.dow, (sums.get(h.dow) || 0) + (h.orders_cnt || 0));
    const dows = [1, 2, 3, 4, 5, 6];
    const x = dows.map((d) => labels[d]);
    const y = dows.map((d) => sums.get(d) ?? 0);

    return {
      grid: { top: 26, right: 16, bottom: 32, left: 44 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v) => nf(Number(v)),
      },
      xAxis: {
        type: 'category',
        data: x,
        axisLabel: { color: '#334155' },
        axisLine: { lineStyle: { color: '#cbd5e1' } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#334155' },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
        minInterval: 1,
      },
      series: [{ type: 'bar', barMaxWidth: 26, data: y }],
    };
  }, [heat]);

  /* ====== Новое распределение чеков (line) ====== */
  const optionBins: EChartsOption = React.useMemo(() => {
    if (!bins.length) {
      return {
        xAxis: { type: 'value' },
        yAxis: { type: 'value' },
        series: [{ type: 'line', data: [] }],
      };
    }

    // Берём только реальные суммы, где есть хоть один чек
    const nonEmpty = bins.filter((b) => (b.cnt || 0) > 0);
    if (!nonEmpty.length) {
      return {
        xAxis: { type: 'value' },
        yAxis: { type: 'value' },
        series: [{ type: 'line', data: [] }],
      };
    }

    // Сортируем по сумме чека
    const sorted = [...nonEmpty].sort(
      (a, b) => (a.from_amt || 0) - (b.from_amt || 0),
    );

    // Берём точку по нижней границе корзины
    const points = sorted.map((b) => [
      Number(b.from_amt || 0),
      Number(b.cnt || 0),
    ]);

    return {
      grid: { top: 24, right: 18, bottom: 40, left: 54 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const [amount, count] = p.data as [number, number];
          return `Чек: ${nf(Math.round(amount))} сом<br/>Кол-во чеков: ${nf(
            Math.round(count),
          )}`;
        },
      },
      xAxis: {
        type: 'value',
        axisLabel: {
          color: '#334155',
          fontSize: 12,
          formatter: (v: number) => nf(v),
        },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#334155', fontSize: 12 },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
        minInterval: 1,
      },
      series: [
        {
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 4,
          data: points,
          areaStyle: { opacity: 0.08 },
        },
      ],
    };
  }, [bins]);

  const optionRefunds: EChartsOption = React.useMemo(() => {
    const x = refunds.map((r) => r.day);
    const y = refunds.map((r) => Number(r.refunds_sum || 0));
    return {
      grid: { top: 24, right: 12, bottom: 36, left: 54 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        valueFormatter: (v) => nf(Number(v)),
      },
      xAxis: {
        type: 'category',
        data: x,
        axisLabel: { color: '#334155', fontSize: 12 },
        axisLine: { lineStyle: { color: '#cbd5e1' } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: '#334155',
          fontSize: 12,
          formatter: (v: number) => nf(v),
        },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      series: [{ type: 'bar', barMaxWidth: 18, data: y }],
    };
  }, [refunds]);

  /* ======== Возраст (line, М/Ж) ======== */
  const optionAgeLine: EChartsOption = React.useMemo(() => {
    const ages = Array.from({ length: 88 }, (_, i) => i + 3);
    const maleMap = new Map<number, number>();
    const femaleMap = new Map<number, number>();
    for (const r of ageRows) {
      if (r.gender === 'Муж')
        maleMap.set(r.age, (maleMap.get(r.age) || 0) + (r.orders_cnt || 0));
      else if (r.gender === 'Жен')
        femaleMap.set(
          r.age,
          (femaleMap.get(r.age) || 0) + (r.orders_cnt || 0),
        );
    }
    const maleSeries = ages.map((a) => maleMap.get(a) ?? 0);
    const femaleSeries = ages.map((a) => femaleMap.get(a) ?? 0);

    return {
      grid: { top: 28, right: 18, bottom: 36, left: 46 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        valueFormatter: (v) => nf(Number(v)),
      },
      legend: {
        top: 0,
        data: ['Жен', 'Муж'],
        textStyle: { color: '#334155' },
      },
      xAxis: {
        type: 'category',
        data: ages,
        axisLabel: { color: '#334155', fontSize: 11 },
        axisLine: { lineStyle: { color: '#cbd5e1' } },
        axisTick: { show: false },
        boundaryGap: false,
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#334155', fontSize: 12 },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
        minInterval: 1,
      },
      series: [
        {
          name: 'Жен',
          type: 'line',
          symbol: 'circle',
          symbolSize: 4,
          smooth: false,
          data: femaleSeries,
        },
        {
          name: 'Муж',
          type: 'line',
          symbol: 'circle',
          symbolSize: 4,
          smooth: false,
          data: maleSeries,
        },
      ],
    };
  }, [ageRows]);

  /* ======== Покупки по видам линз (шт) ======== */
  const optionLensTypes: EChartsOption = React.useMemo(() => {
    if (!lensStruct || lensStruct.length === 0) {
      return {
        xAxis: { type: 'value' },
        yAxis: { type: 'category', data: [] },
        series: [{ type: 'bar', data: [] }],
      };
    }
    const sorted = [...lensStruct].sort((a, b) => b.items_cnt - a.items_cnt);
    const cats = sorted
      .map((r) => r.lens_family || '—')
      .reverse();
    const vals = sorted
      .map((r) => r.items_cnt || 0)
      .reverse();

    return {
      grid: { top: 10, right: 18, bottom: 10, left: 180 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v) => nf(Number(v)),
      },
      xAxis: {
        type: 'value',
        axisLabel: { color: '#334155' },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
        minInterval: 1,
      },
      yAxis: {
        type: 'category',
        data: cats,
        axisLabel: { color: '#334155' },
      },
      series: [{ type: 'bar', barMaxWidth: 22, data: vals }],
    };
  }, [lensStruct]);

  /* ======== Диапазоны диоптрий (шт) ======== */
  const optionLensSphRanges: EChartsOption = React.useMemo(() => {
    if (!lensSph || lensSph.length === 0) {
      return {
        xAxis: { type: 'value' },
        yAxis: { type: 'category', data: [] },
        series: [{ type: 'bar', data: [] }],
      };
    }

    // Агрегируем по диапазону: отдельно обычные и астигматические
    const map = new Map<
      string,
      { total: number; sph: number; astig: number }
    >();

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

    const aggregated = [...map.entries()]
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => a.total - b.total);

    const rows = [...aggregated].reverse();
    const cats = rows.map((r) => r.label);
    const sphData = rows.map((r) => r.sph);
    const astigData = rows.map((r) => r.astig);

    return {
      grid: { top: 26, right: 18, bottom: 10, left: 220 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const list = Array.isArray(params) ? params : [params];
          const idx = list[0]?.dataIndex ?? 0;
          const row = rows[idx];
          return [
            row.label,
            `Всего: ${nf(row.total)}`,
            `Обычные: ${nf(row.sph)}`,
            `Астигматические: ${nf(row.astig)}`,
          ].join('<br/>');
        },
      },
      legend: {
        top: 0,
        textStyle: { color: '#334155', fontSize: 11 },
        data: ['Обычные', 'Астигматические'],
      },
      xAxis: {
        type: 'value',
        axisLabel: { color: '#334155', fontSize: 11 },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
        minInterval: 1,
      },
      yAxis: {
        type: 'category',
        data: cats,
        axisLabel: { color: '#334155', fontSize: 11 },
      },
      series: [
        {
          name: 'Обычные',
          type: 'bar',
          stack: 'total',
          barMaxWidth: 22,
          data: sphData,
        },
        {
          name: 'Астигматические',
          type: 'bar',
          stack: 'total',
          barMaxWidth: 22,
          data: astigData,
        },
      ],
    };
  }, [lensSph]);

  /* ========== UI ========== */
  return (
    <div className="min-h-[100dvh] text-slate-900 text-sm">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Шапка */}
        <header className="rounded-3xl border border-sky-100/80 bg-white/95 px-4 py-5 shadow-[0_22px_80px_rgba(15,23,42,0.22)] backdrop-blur-2xl sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 via-cyan-400 to-emerald-400 text-slate-950 shadow-[0_18px_55px_rgba(56,189,248,0.7)]">
                <BarChart3 className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-[20px] font-semibold leading-tight text-slate-900 md:text-[24px]">
                  Статистика по всем оптикам
                </h1>
                <p className="mt-1 text-xs text-slate-500 md:text-sm">
                  Выручка, прибыль, клиенты и загрузка по филиалам в одном
                  экране.
                </p>
              </div>
            </div>
            <div className="flex flex-col items-start text-[11px] text-slate-500 sm:items-end sm:text-xs">
              <span className="font-medium text-slate-700">Период</span>
              <span>
                {fromISO} — {toISO}
              </span>
              <span className="mt-0.5 max-w-[260px] truncate text-right">
                {branches.length > 0
                  ? `Филиалы: ${branches.join(', ')}`
                  : 'Филиалы: все филиалы'}
              </span>
            </div>
          </div>
        </header>

        {gate === 'pending' && (
          <Section>
            <div className="text-sm text-slate-500">Проверяю доступ…</div>
          </Section>
        )}
        {gate === 'denied' && (
          <Section>
            <div className="rounded-2xl border border-rose-200 bg-rose-50/95 px-4 py-3 text-sm text-rose-700 shadow-[0_14px_40px_rgba(248,113,113,0.35)]">
              Доступ только владельцу.
            </div>
          </Section>
        )}

        {gate === 'ok' && (
          <>
            {/* Фильтры */}
            <Section>
              <div className="grid gap-4 lg:grid-cols-12">
                <div className="lg:col-span-3">
                  <Label>
                    <CalendarDays className="mr-2 -mt-0.5 inline h-4 w-4 text-slate-500" />
                    С даты
                  </Label>
                  <InputDate
                    value={fromISO}
                    onChange={(v) => setFromISO(v.slice(0, 10))}
                  />
                </div>
                <div className="lg:col-span-3">
                  <Label>
                    <CalendarDays className="mr-2 -mt-0.5 inline h-4 w-4 text-slate-500" />
                    По дату
                  </Label>
                  <InputDate
                    value={toISO}
                    onChange={(v) => setToISO(v.slice(0, 10))}
                  />
                </div>
                <div className="lg:col-span-4">
                  <Label>
                    <Building2 className="mr-2 -mt-0.5 inline h-4 w-4 text-slate-500" />
                    Филиалы (для KPI)
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {/* Чип "Все филиалы" */}
                    <Chip
                      active={branches.length === 0}
                      onClick={() => setBranches([])}
                    >
                      Все филиалы
                    </Chip>

                    {/* Отдельные филиалы */}
                    {branchOptions.map((b) => {
                      const active = branches.includes(b);
                      return (
                        <Chip
                          key={b}
                          active={active}
                          onClick={() =>
                            setBranches((prev) =>
                              active
                                ? prev.filter((x) => x !== b)
                                : [...prev, b],
                            )
                          }
                        >
                          {b}
                        </Chip>
                      );
                    })}
                    {branches.length > 0 && (
                      <button
                        onClick={() => setBranches([])}
                        className="text-sm text-slate-600/80 underline hover:text-slate-800"
                      >
                        Сбросить
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-end lg:col-span-2">
                  <PrimaryButton onClick={loadAll} disabled={loading}>
                    {loading ? (
                      <span className="inline-flex items-center gap-2">
                        <RefreshCw className="h-4 w-4 animate-spin" />{' '}
                        Обновляю…
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" /> Показать
                      </span>
                    )}
                  </PrimaryButton>
                </div>
              </div>
              {err && (
                <div className="mt-3 flex items-start gap-2 text-sm text-rose-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4" />
                  <span>Предупреждение: {err}</span>
                </div>
              )}
            </Section>

            {/* KPI */}
            <div className="mt-6 grid gap-4 md:grid-cols-4">
              <KPI
                label="Выручка"
                value={nf(totals.revenue)}
                icon={LineChart}
                accent="from-sky-500/55 via-cyan-400/45 to-indigo-400/40"
              />
              <KPI
                label="Поступления"
                value={nf(totals.inflow)}
                icon={HandCoins}
                accent="from-emerald-400/55 via-teal-400/45 to-cyan-400/40"
              />
              <KPI
                label="Долг"
                value={nf(totals.debt)}
                icon={ReceiptRussianRuble}
                accent="from-rose-500/60 via-orange-400/55 to-amber-400/45"
                danger={totals.debt > 0}
              />
              <KPI
                label="Заказы"
                value={nf(totals.orders)}
                icon={Users2}
                accent="from-violet-400/55 via-fuchsia-400/45 to-pink-400/45"
              />
            </div>

            {/* Основной график */}
            <Section title="Выручка / Поступления / Долг">
              <div
                className="rounded-2xl border border-slate-100/80 bg-white/95 p-2 shadow-[0_20px_60px_rgba(15,23,42,0.18)]"
                style={{ height: 360 } as React.CSSProperties}
              >
                <ReactECharts
                  option={optionByDay}
                  lazyUpdate
                  notMerge
                  opts={{ renderer: 'svg' }}
                  style={{ height: '100%', width: '100%' }}
                />
              </div>
            </Section>

            {/* Чистая прибыль */}
            <Section title="Чистая прибыль по дням">
              <div
                className="rounded-2xl border border-slate-100/80 bg-white/95 p-2 shadow-[0_20px_60px_rgba(15,23,42,0.18)]"
                style={{ height: 360 } as React.CSSProperties}
              >
                <ReactECharts
                  option={optionNetProfit}
                  opts={{ renderer: 'svg' }}
                  style={{ height: '100%', width: '100%' }}
                />
              </div>
            </Section>

            {/* По филиалам */}
            <Section title="Сравнение по филиалам">
              <div className="overflow-auto rounded-2xl border border-slate-100/80 bg-white/95 shadow-[0_20px_60px_rgba(15,23,42,0.18)]">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left text-[13px] font-medium">
                        Филиал
                      </th>
                      <th className="px-3 py-2 text-right text-[13px] font-medium">
                        Заказы (orders_view)
                      </th>
                      <th className="px-3 py-2 text-right text-[13px] font-medium">
                        Выручка (orders_view)
                      </th>
                      <th className="px-3 py-2 text-right text-[13px] font-medium">
                        Заказы (stats_daily)
                      </th>
                      <th className="px-3 py-2 text-right text-[13px] font-medium">
                        Выручка (stats_daily)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {byBranch.map((r) => (
                      <tr
                        key={r.branch}
                        className="odd:bg-white even:bg-slate-50/40"
                      >
                        <td className="px-3 py-2">{r.branch}</td>
                        <td className="px-3 py-2 text-right">
                          {nf(r.ov_orders)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {nf(r.ov_revenue)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {nf(r.sd_orders)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {nf(r.sd_revenue)}
                        </td>
                      </tr>
                    ))}
                    {byBranch.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-3 py-3 text-center text-slate-500"
                        >
                          Нет данных за период
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>

            {/* Оплаты по методам + статусы */}
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <Section title="Оплаты по методам">
                <div className="overflow-hidden rounded-2xl border border-slate-100/80 bg-white/95 shadow-[0_20px_60px_rgba(15,23,42,0.18)]">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left text-[13px] font-medium">
                          Метод
                        </th>
                        <th className="px-3 py-2 text-right text-[13px] font-medium">
                          Кол-во
                        </th>
                        <th className="px-3 py-2 text-right text-[13px] font-medium">
                          Сумма
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr
                          key={p.method}
                          className="odd:bg-white even:bg-slate-50/40"
                        >
                          <td className="px-3 py-2">
                            {paymentMethodLabel(p.method)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {nf(p.cnt)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {nf(p.sum)}
                          </td>
                        </tr>
                      ))}
                      {payments.length === 0 && (
                        <tr>
                          <td
                            colSpan={3}
                            className="px-3 py-3 text-center text-slate-500"
                          >
                            Нет данных
                          </td>
                        </tr>
                      )}
                    </tbody>
                    {payments.length > 0 && (
                      <tfoot>
                        <tr className="border-t border-slate-200 bg-slate-50/70">
                          <td className="px-3 py-2 text-right font-medium">
                            Итого
                          </td>
                          <td className="px-3 py-2 text-right font-medium">
                            {nf(paymentsTotals.cnt)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium">
                            {nf(paymentsTotals.sum)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                {payments.length > 0 && (
                  <div className="mt-2 text-xs text-slate-500">
                    Поступления по KPI: {nf(totals.inflow)} сом. Сумма по
                    методам: {nf(paymentsTotals.sum)} сом.
                    {Math.round(totals.inflow) !==
                      Math.round(paymentsTotals.sum) && (
                      <span className="ml-1 text-amber-600">
                        Есть расхождение — проверь SQL функций
                        rpcRevenueInflowByDay / rpcPaymentsBreakdown.
                      </span>
                    )}
                  </div>
                )}
              </Section>

              <Section title="Статусы заказов">
                <div className="overflow-hidden rounded-2xl border border-slate-100/80 bg-white/95 shadow-[0_20px_60px_rgba(15,23,42,0.18)]">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left text-[13px] font-medium">
                          Статус
                        </th>
                        <th className="px-3 py-2 text-right text-[13px] font-medium">
                          Кол-во
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {statuses.map((s) => (
                        <tr
                          key={s.status}
                          className="odd:bg-white even:bg-slate-50/40"
                        >
                          <td className="px-3 py-2">{s.status}</td>
                          <td className="px-3 py-2 text-right">
                            {nf(s.cnt)}
                          </td>
                        </tr>
                      ))}
                      {statuses.length === 0 && (
                        <tr>
                          <td
                            colSpan={2}
                            className="px-3 py-3 text-center text-slate-500"
                          >
                            Нет данных
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Section>
            </div>

            {/* Клиенты */}
            <Section title="Клиенты">
              {custKpis ? (
                <>
                  <div className="grid gap-4 md:grid-cols-4">
                    <KPI
                      label="Средний чек"
                      value={nf(Math.round(custKpis.avg_check))}
                      icon={CreditCard}
                      accent="from-indigo-400/55 via-sky-400/45 to-cyan-400/40"
                    />
                    <KPI
                      label="Медианный чек"
                      value={nf(Math.round(custKpis.median_check))}
                      icon={CreditCard}
                      accent="from-indigo-400/55 via-sky-400/45 to-cyan-400/40"
                    />
                    <KPI
                      label="Средний интервал (дни)"
                      value={(custKpis.avg_interval_days ?? 0).toFixed(1)}
                      icon={CalendarDays}
                      accent="from-amber-400/55 via-orange-400/45 to-rose-400/40"
                    />
                    <KPI
                      label="Доля вернувшихся"
                      value={`${Math.round(
                        (custKpis.returning_share ?? 0) * 100,
                      )}%`}
                      icon={Users2}
                      accent="from-emerald-400/55 via-teal-400/45 to-cyan-400/40"
                    />
                  </div>
                  <div
                    className="mt-4 rounded-2xl border border-slate-100/80 bg-white/95 p-2 shadow-[0_20px_60px_rgba(15,23,42,0.18)]"
                    style={{ height: 320 } as React.CSSProperties}
                  >
                    <ReactECharts
                      option={optionNewReturning}
                      opts={{ renderer: 'svg' }}
                      style={{ height: '100%' }}
                    />
                  </div>
                </>
              ) : (
                <div className="text-sm text-slate-500">Нет данных…</div>
              )}
            </Section>

            {/* Линзы: виды + диоптрии */}
            <Section title="Линзы: по видам и диапазонам диоптрий">
              <div className="grid gap-4 md:grid-cols-2">
                <div
                  className="rounded-2xl border border-slate-100/80 bg-white/95 p-2 shadow-[0_20px_60px_rgba(15,23,42,0.18)]"
                  style={{ height: 420 } as React.CSSProperties}
                >
                  <div className="mb-1 px-2 text-xs font-medium text-slate-500">
                    По видам линз
                  </div>
                  <ReactECharts
                    option={optionLensTypes}
                    opts={{ renderer: 'svg' }}
                    style={{ height: '100%', width: '100%' }}
                  />
                </div>
                <div
                  className="rounded-2xl border border-slate-100/80 bg-white/95 p-2 shadow-[0_20px_60px_rgba(15,23,42,0.18)]"
                  style={{ height: 420 } as React.CSSProperties}
                >
                  <div className="mb-1 px-2 text-xs font-medium text-slate-500">
                    По диапазонам диоптрий
                  </div>
                  <ReactECharts
                    option={optionLensSphRanges}
                    opts={{ renderer: 'svg' }}
                    style={{ height: '100%', width: '100%' }}
                  />
                </div>
              </div>
            </Section>

            {/* Гендер покупателей */}
            <Section title="Гендер покупателей (шт)">
              <div
                className="rounded-2xl border border-slate-100/80 bg-white/95 p-2 shadow-[0_20px_60px_rgba(15,23,42,0.18)]"
                style={{ height: 300 } as React.CSSProperties}
              >
                <ReactECharts
                  option={optionGenderPie}
                  opts={{ renderer: 'svg' }}
                  style={{ height: '100%', width: '100%' }}
                />
              </div>
            </Section>

            {/* Возраст */}
            <Section title="Покупки по возрасту (годы)">
              <div
                className="rounded-2xl border border-slate-100/80 bg-white/95 p-2 shadow-[0_20px_60px_rgba(15,23,42,0.18)]"
                style={{ height: 320 } as React.CSSProperties}
              >
                <ReactECharts
                  option={optionAgeLine}
                  opts={{ renderer: 'svg' }}
                  style={{ height: '100%', width: '100%' }}
                />
              </div>
            </Section>

            {/* Время заказов по 10 минут */}
            <Section title="Заказы по времени (каждые 10 минут)">
              <div
                className="rounded-2xl border border-slate-100/80 bg-white/95 p-2 shadow-[0_20px_60px_rgba(15,23,42,0.18)]"
                style={{ height: 320 } as React.CSSProperties}
              >
                <ReactECharts
                  option={optionOrdersBy10Min}
                  opts={{ renderer: 'svg' }}
                  style={{ height: '100%', width: '100%' }}
                />
              </div>
            </Section>

            {/* Дни недели */}
            <Section title="Заказы по дням недели">
              <div
                className="rounded-2xl border border-slate-100/80 bg-white/95 p-2 shadow-[0_20px_60px_rgba(15,23,42,0.18)]"
                style={{ height: 300 } as React.CSSProperties}
              >
                <ReactECharts
                  option={optionOrdersByDow}
                  opts={{ renderer: 'svg' }}
                  style={{ height: '100%', width: '100%' }}
                />
              </div>
            </Section>

            {/* Гистограмма чеков */}
            <Section title="Распределение чеков (сом)">
              <div
                className="rounded-2xl border border-slate-100/80 bg-white/95 p-2 shadow-[0_20px_60px_rgba(15,23,42,0.18)]"
                style={{ height: 320 } as React.CSSProperties}
              >
                <ReactECharts
                  option={optionBins}
                  opts={{ renderer: 'svg' }}
                  style={{ height: '100%' }}
                />
              </div>
            </Section>

            {/* Возвраты */}
            <Section title="Возвраты по дням">
              <div
                className="rounded-2xl border border-slate-100/80 bg-white/95 p-2 shadow-[0_20px_60px_rgba(15,23,42,0.18)]"
                style={{ height: 300 } as React.CSSProperties}
              >
                <ReactECharts
                  option={optionRefunds}
                  opts={{ renderer: 'svg' }}
                  style={{ height: '100%', width: '100%' }}
                />
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

/* ====== малые компоненты ====== */

function Section({
  children,
  title,
  aside,
}: {
  children: React.ReactNode;
  title?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  const hasHeader = title || aside;
  return (
    <section className="mt-4 rounded-2xl border border-slate-100/80 bg-white/95 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.18)] backdrop-blur-sm">
      {hasHeader && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && (
            <h2 className="text-[15px] font-semibold text-slate-800">
              {title}
            </h2>
          )}
          {aside && <div className="text-xs text-slate-500">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

function KPI({
  label,
  value,
  icon,
  accent = 'from-slate-200 to-slate-100',
  danger = false,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ElementType;
  accent?: string;
  danger?: boolean;
}) {
  const Icon = icon;
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-100/80 bg-white/95 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.16)] backdrop-blur-sm transition hover:shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
      <div
        className={`pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-gradient-to-br ${accent} blur-2xl opacity-70 group-hover:opacity-100`}
      />
      <div className="relative z-10 flex items-center gap-3">
        {Icon && (
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900 text-white shadow">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
            {label}
          </div>
          <div
            className={`mt-1 text-xl font-semibold ${
              danger ? 'text-rose-600' : 'text-slate-900'
            }`}
          >
            {value}
          </div>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-xs font-medium text-slate-600">
      {children}
    </label>
  );
}

function InputDate({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <input
        type="date"
        className="w-full rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 pr-9 text-sm text-slate-900 shadow-sm outline-none focus:ring-2 focus:ring-sky-300"
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
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'h-8 rounded-full px-3 text-sm border transition shadow-sm',
        active
          ? 'border-transparent bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-500 text-white shadow'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="w-full rounded-2xl bg-gradient-to-r from-sky-600 via-indigo-600 to-violet-600 px-4 py-2 text-sm font-medium text-white shadow-[0_16px_40px_rgba(37,99,235,0.75)] hover:opacity-95 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
