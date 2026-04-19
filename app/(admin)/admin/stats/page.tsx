// app/(admin)/admin/stats/page.tsx
'use client';

import * as React from 'react';
import type { EChartsOption } from 'echarts';
import dynamic from 'next/dynamic';
import Link from 'next/link';
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
  ChevronRight,
  PiggyBank,
} from 'lucide-react';

const ChevronRightIcon = () => (
  <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-cyan-500 transition-colors" />
);

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

// Конкретные диоптрии
type LensSphRow = {
  sph: string;
  cnt: number;
};

// Чистая прибыль по дням (все поля из admin_net_profit_by_day)
type NetProfitRow = { day: string; orders_count: number; income: number; refunds: number; opex_total: number; cogs_total: number; payroll_total: number; net_profit: number };

// Заказы по 10-минутным интервалам (bucket = 'HH24:MI' из SQL)
type Orders10Row = {
  bucket: string;
  orders_cnt: number;
  revenue_sum: number;
};

// Дата старта POS по каждому филиалу (первый реальный оплаченный заказ)
const BRANCH_START_DATE: Record<string, string> = {
  'Сокулук': '2025-11-15',
  'Кара-Балта': '2025-11-20',
  'Кант': '2025-12-17',
  // Беловодск и Токмок ещё не подключены к POS
};

// Только подключённые филиалы
const ALL_BRANCHES = Object.keys(BRANCH_START_DATE);

/** Дата старта для выбранных филиалов (самая ранняя из выбранных) */
function getEffectiveStartDate(selectedBranches: string[]): string {
  const branches = selectedBranches.length > 0 ? selectedBranches : ALL_BRANCHES;
  const dates = branches.map((b) => BRANCH_START_DATE[b]).filter(Boolean);
  if (dates.length === 0) return '2025-11-15';
  return dates.sort()[0];
}

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

  // 3) Самый безопасный фолбэк
  return { from: '2025-11-15', to: todayISO() };
}

export default function AdminStatsPage() {
  /* --- доступ --- */
  const [gate, setGate] = React.useState<'pending' | 'ok' | 'denied'>('pending');

  /* --- фильтры --- */
  const branchOptions = ALL_BRANCHES;
  const [branches, setBranches] = React.useState<string[]>([]); // [] = все филиалы

  const [fromISO, setFromISO] = React.useState<string>(() => getEffectiveStartDate([]));
  const [toISO, setToISO] = React.useState<string>(() => todayISO());

  // При смене филиалов — подставляем правильную дату старта
  const prevBranchesRef = React.useRef<string[]>([]);
  React.useEffect(() => {
    const prev = prevBranchesRef.current;
    if (JSON.stringify(prev) !== JSON.stringify(branches)) {
      prevBranchesRef.current = branches;
      const effectiveStart = getEffectiveStartDate(branches);
      // Обновляем только если текущая fromISO раньше чем дата старта филиала
      setFromISO((cur) => cur < effectiveStart ? effectiveStart : cur);
    }
  }, [branches]);
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

  // Реальные зарплаты из v_payroll_daily + средние чеки из fn_finance_summary_todate_v2
  const [realPayroll, setRealPayroll] = React.useState(0);
  const [avgFrameCheck, setAvgFrameCheck] = React.useState(0);
  const [avgLensCheck, setAvgLensCheck] = React.useState(0);

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

      // Если диапазона нет — с даты старта выбранных филиалов
      if (!urlFrom) setFromISO(getEffectiveStartDate(initialBranches));
      if (!urlTo) setToISO(todayISO());

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

      // Сбрасываем финансовые данные чтобы не мелькали старые цифры
      setRealPayroll(0);
      setAvgFrameCheck(0);
      setAvgLensCheck(0);
      setNetProfit([]);

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

        // === конкретные диоптрии (прямой запрос) ===
        try {
          const sb = getSupabase();
          // SQL через RPC не нужен — делаем join через JS
          // Сначала получаем order_id из payments за период
          let pq = sb.from('payments').select('order_id, created_at').gte('created_at', from).lt('created_at', to + 'T23:59:59');
          const { data: payRows } = await pq;
          const orderIds = [...new Set((payRows || []).map((r: any) => r.order_id))];

          if (orderIds.length > 0) {
            // Берём sph из order_items для этих заказов, с фильтром по филиалам
            let oiq = sb.from('order_items').select('sph, order_id').in('order_id', orderIds).eq('item_type', 'lens').not('sph', 'is', null);
            const { data: oiRows } = await oiq;

            // Если нужен фильтр по филиалам — дополнительно фильтруем
            let filteredRows = oiRows || [];
            if (brForRpc && brForRpc.length > 0) {
              const { data: brOrders } = await sb.from('orders').select('id, branch_id').in('id', orderIds);
              const { data: brList } = await sb.from('branches').select('id, name').in('name', brForRpc);
              const brIdSet = new Set((brList || []).map((b: any) => b.id));
              const validOrderIds = new Set((brOrders || []).filter((o: any) => brIdSet.has(o.branch_id)).map((o: any) => o.id));
              filteredRows = filteredRows.filter((r: any) => validOrderIds.has(r.order_id));
            }

            const sphMap = new Map<string, number>();
            for (const r of filteredRows) {
              const sph = String(r.sph);
              sphMap.set(sph, (sphMap.get(sph) || 0) + 1);
            }
            const sphRows = [...sphMap.entries()]
              .map(([sph, cnt]) => ({ sph, cnt }))
              .sort((a, b) => parseFloat(a.sph) - parseFloat(b.sph));
            setLensSph(sphRows);
          } else {
            setLensSph([]);
          }
        } catch (e: any) {
          console.warn('[lens_sph_exact]', e?.message ?? e);
          setLensSph([]);
        }

        // === реальные зарплаты из v_payroll_daily ===
        try {
          const sb = getSupabase();
          let q = sb.from('v_payroll_daily').select('net_day, day').gte('day', from).lte('day', to);
          if (brForRpc && brForRpc.length > 0) {
            const { data: brIds } = await sb.from('branches').select('id').in('name', brForRpc);
            if (brIds?.length) q = q.in('branch_id', brIds.map((b: any) => b.id));
          }
          const { data: payData } = await q;
          // Исключаем воскресенья для консистентности с другими метриками
          const totalPayroll = (payData || [])
            .filter((r: any) => !isSundayISO(String(r.day)))
            .reduce((s: number, r: any) => s + (Number(r.net_day) || 0), 0);
          setRealPayroll(totalPayroll);
        } catch {
          setRealPayroll(0);
        }

        // === средние чеки оправ/линз — прямой запрос к order_items ===
        try {
          const sb = getSupabase();
          // Получаем оплаченные заказы за период
          let pq = sb.from('payments').select('order_id').gte('created_at', from).lt('created_at', to + 'T23:59:59');
          const { data: paidRows } = await pq;
          const paidIds = [...new Set((paidRows || []).map((r: any) => r.order_id))];

          if (paidIds.length > 0) {
            // Фильтр по филиалам если нужен
            let validIds = paidIds;
            if (brForRpc && brForRpc.length > 0) {
              const { data: brList } = await sb.from('branches').select('id').in('name', brForRpc);
              const brIdSet = new Set((brList || []).map((b: any) => b.id));
              const { data: ordRows } = await sb.from('orders').select('id, branch_id').in('id', paidIds);
              validIds = (ordRows || []).filter((o: any) => brIdSet.has(o.branch_id)).map((o: any) => o.id);
            }

            if (validIds.length > 0) {
              const { data: oiRows } = await sb.from('order_items').select('order_id, item_type, price, qty').in('order_id', validIds);
              const byOrder = new Map<number, { frame: number; lens: number }>();
              for (const r of (oiRows || [])) {
                const oid = r.order_id;
                const prev = byOrder.get(oid) ?? { frame: 0, lens: 0 };
                const amt = (Number(r.price) || 0) * (Number(r.qty) || 1);
                if (r.item_type === 'frame') prev.frame += amt;
                else if (r.item_type === 'lens') prev.lens += amt;
                byOrder.set(oid, prev);
              }
              let frameSum = 0, frameCnt = 0, lensSum = 0, lensCnt = 0;
              for (const v of byOrder.values()) {
                if (v.frame > 0) { frameSum += v.frame; frameCnt++; }
                if (v.lens > 0) { lensSum += v.lens; lensCnt++; }
              }
              setAvgFrameCheck(frameCnt > 0 ? Math.round(frameSum / frameCnt) : 0);
              setAvgLensCheck(lensCnt > 0 ? Math.round(lensSum / lensCnt) : 0);
            } else {
              setAvgFrameCheck(0);
              setAvgLensCheck(0);
            }
          } else {
            setAvgFrameCheck(0);
            setAvgLensCheck(0);
          }
        } catch {
          setAvgFrameCheck(0);
          setAvgLensCheck(0);
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
      else r = { from: getEffectiveStartDate(branches), to: todayISO() };

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

  // Финансовые итоги из netProfit + реальные зарплаты + средние чеки
  const financeTotals = React.useMemo(() => {
    let income = 0, opex = 0, cogs = 0, netProfitSum = 0;
    for (const r of netProfit) {
      income += r.income || 0;
      opex += r.opex_total || 0;
      cogs += r.cogs_total || 0;
      netProfitSum += r.net_profit || 0;
    }
    // Реальная прибыль = доходы - расходы (opex+cogs) - реальные зарплаты
    const realNet = income - opex - cogs - realPayroll;
    const margin = income > 0 ? Math.round((realNet / income) * 100) : 0;
    return { income, opex, cogs, payroll: realPayroll, netProfit: realNet, margin, frameAvg: avgFrameCheck, lensAvg: avgLensCheck };
  }, [netProfit, realPayroll, avgFrameCheck, avgLensCheck]);

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

  // Доходы и расходы по дням
  const optionIncomeVsExpenses: EChartsOption = React.useMemo(() => ({
    backgroundColor: 'transparent',
    legend: { top: 0, textStyle: { color: chartTheme.subtext, fontWeight: 600 } },
    grid: { top: 40, right: 18, bottom: 38, left: 56 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: 'rgba(34,211,238,0.45)' } }, valueFormatter: (v) => nf(Number(v as number)), ...(tooltipGlass as any) },
    xAxis: { type: 'category', data: netProfit.map((r) => r.day), ...axisCommon },
    yAxis: { type: 'value', ...axisCommon, axisLabel: { color: chartTheme.axis, formatter: (v: number) => nf(v) } },
    series: [
      { name: 'Доходы', type: 'line', smooth: 0.35, symbol: 'circle', symbolSize: 5, lineStyle: { width: 2.5, color: chartTheme.teal }, itemStyle: { color: chartTheme.teal }, areaStyle: { opacity: 0.06 }, data: netProfit.map((r) => r.income || 0) },
      { name: 'Расходы', type: 'bar', barMaxWidth: 20, itemStyle: { color: chartTheme.sky, borderRadius: [4, 4, 0, 0] }, data: netProfit.map((r) => (r.refunds || 0) + (r.opex_total || 0) + (r.cogs_total || 0) + (r.payroll_total || 0)) },
    ],
  }), [netProfit, axisCommon, chartTheme, tooltipGlass]);

  // Структура расходов (pie по категориям из netProfit)
  const optionExpensesPie: EChartsOption = React.useMemo(() => {
    const totals = { refunds: 0, opex: 0, cogs: 0, payroll: 0 };
    for (const r of netProfit) {
      totals.refunds += r.refunds || 0;
      totals.opex += r.opex_total || 0;
      totals.cogs += r.cogs_total || 0;
      totals.payroll += r.payroll_total || 0;
    }
    const data = [
      { name: 'Возвраты', value: Math.round(totals.refunds) },
      { name: 'OPEX', value: Math.round(totals.opex) },
      { name: 'Себестоимость', value: Math.round(totals.cogs) },
      { name: 'Зарплаты', value: Math.round(totals.payroll) },
    ].filter((d) => d.value > 0);
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', valueFormatter: (v) => nf(Number(v as number)), ...(tooltipGlass as any) },
      legend: { top: 0, textStyle: { color: chartTheme.subtext, fontWeight: 600 } },
      series: [{ type: 'pie', radius: ['35%', '70%'], center: ['50%', '58%'], label: { formatter: '{b}: {c}', color: chartTheme.text }, data }],
    };
  }, [netProfit, chartTheme, tooltipGlass]);

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
        xAxis: { type: 'category', data: [] },
        yAxis: { type: 'value' },
        series: [{ type: 'bar', data: [] }],
      };
    }

    const labels = lensSph.map((r) => r.sph);
    const values = lensSph.map((r) => r.cnt);

    return {
      backgroundColor: 'transparent',
      grid: { top: 20, right: 18, bottom: 50, left: 48 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v) => nf(Number(v)),
        ...(tooltipGlass as any),
      },
      xAxis: {
        type: 'category',
        data: labels,
        ...axisCommon,
        axisLabel: { color: chartTheme.axis, fontSize: 10, rotate: 45 },
      },
      yAxis: { type: 'value', ...axisCommon, minInterval: 1, axisLabel: { color: chartTheme.axis, formatter: (v: number) => nf(v) } },
      series: [
        {
          name: 'Кол-во линз',
          type: 'bar',
          barMaxWidth: 16,
          itemStyle: { borderRadius: [6, 6, 0, 0], color: gradTeal as any },
          data: values,
        },
      ],
    };
  }, [lensSph, axisCommon, chartTheme, gradTeal, tooltipGlass]);

  /* ========== UI ========== */
  return (
    <div className="text-slate-50">
      <div>
        {gate === 'pending' && (
          <Section tone="neutral">
            <div className="text-sm text-slate-500">Проверяю доступ…</div>
          </Section>
        )}

        {gate === 'denied' && (
          <Section tone="danger">
            <div className="inline-flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200">
              <AlertTriangle className="h-4 w-4" />
              Доступ только владельцу.
            </div>
          </Section>
        )}

        {gate === 'ok' && (
          <>
            {/* Header (бренд-стандарт) */}
            <div className="mb-6 flex items-start gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
                <BarChart3 className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="text-2xl font-bold tracking-tight text-slate-50">Статистика</div>
                <div className="mt-0.5 text-[12px] text-cyan-300/50">
                  Аналитика заказов, выручки и операций
                </div>
              </div>
            </div>

            {/* Навигация */}
            <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Link
                href="/finance/settings"
                className="group flex items-center gap-4 rounded-2xl px-5 py-4 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] transition hover:ring-cyan-300/40"
              >
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.28)]">
                  <CreditCard className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold text-slate-900">Финансовые ставки</div>
                  <div className="mt-0.5 text-xs text-slate-500">OPEX и себестоимость по филиалам</div>
                </div>
                <ChevronRightIcon />
              </Link>

              <Link
                href="/admin/budget"
                className="group flex items-center gap-4 rounded-2xl px-5 py-4 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] transition hover:ring-cyan-300/40"
              >
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.28)]">
                  <PiggyBank className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold text-slate-900">Бюджет расходов</div>
                  <div className="mt-0.5 text-xs text-slate-500">План и контроль расходов по филиалам</div>
                </div>
                <ChevronRightIcon />
              </Link>
            </div>

            {/* Filters */}
            <Section tone="neutral">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1">
                  <SoftGhostButton onClick={() => applyPreset('7d')}>7д</SoftGhostButton>
                  <SoftGhostButton onClick={() => applyPreset('month')}>Месяц</SoftGhostButton>
                  <SoftGhostButton onClick={() => applyPreset('all')}>Всё время</SoftGhostButton>
                </div>

                <div className="h-5 w-px bg-slate-200 mx-1" />

                <InputDate value={fromISO} onChange={(v) => setFromISO(v.slice(0, 10))} />
                <span className="text-slate-400 text-xs">—</span>
                <InputDate value={toISO} onChange={(v) => setToISO(v.slice(0, 10))} />

                <div className="h-5 w-px bg-slate-200 mx-1" />

                <Chip active={branches.length === 0} onClick={() => setBranches([])}>Все</Chip>
                {branchOptions.map((b) => {
                  const active = branches.includes(b);
                  return (
                    <Chip key={b} active={active} onClick={() => setBranches((prev) => (active ? prev.filter((x) => x !== b) : [...prev, b]))}>
                      {b}
                    </Chip>
                  );
                })}

                <div className="h-5 w-px bg-slate-200 mx-1" />

                <SoftPrimaryButton onClick={() => loadAll()} disabled={loading} icon={TrendingUp}>
                  {loading ? '…' : 'Показать'}
                </SoftPrimaryButton>
              </div>

              {err && (
                <div className="mt-4 inline-flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 ring-1 ring-amber-200">
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

            {/* Finance KPIs */}
            <div className="mt-4 grid gap-4 md:grid-cols-5">
              <KPI label="Доходы" value={loading ? '0' : nf(financeTotals.income)} icon={HandCoins} iconTone="money" accent="from-cyan-200/55 via-teal-200/45 to-sky-200/40" />
              <KPI label="OPEX" value={loading ? '0' : nf(financeTotals.opex)} icon={CreditCard} iconTone="money" accent="from-sky-200/55 via-cyan-200/45 to-slate-200/40" />
              <KPI label="Себестоимость" value={loading ? '0' : nf(financeTotals.cogs)} icon={CreditCard} iconTone="money" accent="from-slate-200/55 via-sky-200/45 to-cyan-200/40" />
              <KPI label="Зарплаты" value={loading ? '0' : nf(financeTotals.payroll)} icon={CreditCard} iconTone="money" accent="from-teal-200/55 via-cyan-200/45 to-sky-200/40" />
              <KPI label="Чистая прибыль" value={loading ? '0' : nf(financeTotals.netProfit)} icon={TrendingUp} iconTone="money" accent="from-cyan-200/55 via-sky-200/45 to-teal-200/40" />
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <KPI label="Маржа" value={loading ? '0%' : `${financeTotals.margin}%`} icon={Percent} iconTone="money" accent="from-teal-200/55 via-cyan-200/45 to-sky-200/40" />
              <KPI label="Средний чек оправы" value={loading ? '0' : financeTotals.frameAvg > 0 ? nf(financeTotals.frameAvg) : '—'} icon={BarChart3} iconTone="money" accent="from-sky-200/55 via-cyan-200/45 to-teal-200/40" />
              <KPI label="Средний чек линз" value={loading ? '0' : financeTotals.lensAvg > 0 ? nf(financeTotals.lensAvg) : '—'} icon={BarChart3} iconTone="money" accent="from-cyan-200/55 via-teal-200/45 to-sky-200/40" />
            </div>

            {/* Charts */}
            <Section
              tone="money"
              title={
                <span className="inline-flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
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
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
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

            <Section
              tone="money"
              title={
                <span className="inline-flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-500 text-white shadow-[0_4px_16px_rgba(34,211,238,0.30)]">
                    <HandCoins className="h-4 w-4" />
                  </div>
                  Доходы и расходы по дням
                </span>
              }
            >
              <ChartFrame height={360}>
                <ReactECharts option={optionIncomeVsExpenses} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
              </ChartFrame>
            </Section>

            <Section
              tone="neutral"
              title={
                <span className="inline-flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-500 text-white shadow-[0_4px_16px_rgba(34,211,238,0.30)]">
                    <PieChart className="h-4 w-4" />
                  </div>
                  Структура расходов
                </span>
              }
            >
              <ChartFrame height={360}>
                <ReactECharts option={optionExpensesPie} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
              </ChartFrame>
            </Section>

            {/* By branch table */}
            <Section
              tone="neutral"
              title={
                <span className="inline-flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
                    <Building2 className="h-4 w-4" />
                  </div>
                  Сравнение по филиалам
                </span>
              }
              aside={<span className="text-xs text-slate-600/80">orders_view vs stats_daily</span>}
            >
              <GlassTable>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/80 text-slate-600">
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
                      <tr key={r.branch} className="odd:bg-white even:bg-slate-50/60">
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
                    <div className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-500 text-white shadow-[0_4px_12px_rgba(16,185,129,0.28)]">
                      <HandCoins className="h-4 w-4" />
                    </div>
                    Оплаты по методам
                  </span>
                }
                aside={<span className="text-xs text-slate-600/80">Сверка с поступлениями</span>}
              >
                <GlassTable>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50/80 text-slate-600">
                      <tr>
                        <Th>Метод</Th>
                        <ThRight>Кол-во</ThRight>
                        <ThRight>Сумма</ThRight>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.method} className="odd:bg-white even:bg-slate-50/60">
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
                  <div className="mt-3 rounded-xl bg-slate-50/60 px-4 py-3 text-xs text-slate-600 ring-1 ring-sky-100">
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
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
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
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
                    <BarChart3 className="h-4 w-4" />
                  </div>
                  Линзы: по видам и диоптриям
                </span>
              }
              aside={<span className="text-xs text-slate-600/80">Срез по продажам</span>}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <ChartFrame height={420} title="По видам линз" icon={BarChart3}>
                  <ReactECharts option={optionLensTypes} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
                </ChartFrame>

                <ChartFrame height={420} title="По диоптриям (SPH)" icon={BarChart3}>
                  <ReactECharts option={optionLensSphRanges} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
                </ChartFrame>
              </div>
            </Section>

            {/* Age */}
            <Section
              tone="neutral"
              title={
                <span className="inline-flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
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
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
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
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
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
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
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
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-rose-500 text-white shadow-[0_4px_12px_rgba(244,63,94,0.28)]">
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

  const toneRing =
    tone === 'danger' ? 'ring-rose-200' : 'ring-sky-100';

  return (
    <section
      className={`mt-5 rounded-2xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)] ring-1 ${toneRing}`}
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
      className="rounded-2xl bg-white p-2 ring-1 ring-sky-100"
      style={{ height } as React.CSSProperties}
    >
      {title && (
        <div className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold text-slate-600">
          {Icon && (
            <span className="grid h-7 w-7 place-items-center rounded-xl bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
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
    <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-sky-100">
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
  danger = false,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ElementType;
  accent?: string;
  danger?: boolean;
  iconTone?: 'money' | 'danger' | 'violet' | 'neutral';
}) {
  const Icon = icon;

  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] transition hover:ring-cyan-300/40">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)]">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
          <div className={`mt-1 text-2xl font-bold ${danger ? 'text-rose-600' : 'text-slate-900'}`}>{value}</div>
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

  const ring =
    tone === 'ok'     ? 'ring-emerald-200' :
    tone === 'warn'   ? 'ring-amber-200' :
    tone === 'danger' ? 'ring-rose-200' :
                        'ring-sky-100';

  const iconColor =
    tone === 'ok'     ? 'text-emerald-600 bg-emerald-50' :
    tone === 'warn'   ? 'text-amber-600 bg-amber-50' :
    tone === 'danger' ? 'text-rose-600 bg-rose-50' :
                        'text-cyan-600 bg-cyan-50';

  return (
    <div className={`rounded-2xl bg-white p-4 ring-1 shadow-[0_8px_30px_rgba(15,23,42,0.45)] ${ring}`}>
      <div className="flex items-center gap-3">
        {Icon && (
          <div className={`grid h-10 w-10 place-items-center rounded-xl ${iconColor}`}>
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-1 text-lg font-bold text-slate-900">{value}</div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{children}</label>;
}

function InputDate({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <input
        type="date"
        className="w-full rounded-xl bg-white px-3 py-2.5 pr-9 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70"
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
        'h-8 rounded-full px-3 text-xs font-semibold transition',
        active
          ? 'bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
          : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50',
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
        'inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-cyan-300/70',
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
      className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-300/70"
    >
      {Icon && <Icon className="h-4 w-4 text-cyan-600" />}
      {children}
    </button>
  );
}
