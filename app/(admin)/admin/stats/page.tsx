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
} from 'lucide-react';

const ChevronRightIcon = () => (
  <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-cyan-500 transition-colors" />
);

import {
  rpcRevenueInflowByDay,
  rpcPeriodByBranch,
  rpcPaymentsBreakdown,
  rpcHeatmap,
  rpcRefundsByDay,
  rpcNewVsReturning,
  rpcAvgIntervalDays,
  rpcAvgMedianCheck,
  rpcAgeByYear, // возраста (М/Ж)
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

/** Гранулярность временной оси тренда среднего чека (адаптивно от длины периода) */
type TrendGran = 'day' | 'week' | 'month';

/** Строка тренда среднего чека: один временной бакет (день/неделя/месяц) */
type AvgCheckTrendRow = {
  bucket: string; // ключ сортировки: YYYY-MM-DD (день / понедельник недели) или YYYY-MM (месяц)
  label: string; // подпись на оси X
  frameAvg: number | null; // средний чек оправ в бакете (null — нет продаж оправ)
  lensAvg: number | null; // средний чек линз в бакете
  frameCnt: number; // число заказов с оправой
  lensCnt: number; // число заказов с линзой
};

/** Ключ бакета для даты YYYY-MM-DD при заданной гранулярности */
function trendBucketKey(dateISO: string, gran: TrendGran): string {
  if (gran === 'month') return dateISO.slice(0, 7); // YYYY-MM
  if (gran === 'week') {
    const d = new Date(`${dateISO}T00:00:00Z`);
    const mondayOffset = (d.getUTCDay() + 6) % 7; // 0 = понедельник
    d.setUTCDate(d.getUTCDate() - mondayOffset);
    return d.toISOString().slice(0, 10);
  }
  return dateISO;
}

/** Короткая подпись бакета для оси X */
function trendBucketLabel(bucket: string, gran: TrendGran): string {
  if (gran === 'month') {
    const [y, m] = bucket.split('-');
    return `${m}.${y.slice(2)}`;
  }
  const [, m, d] = bucket.split('-');
  return `${d}.${m}`;
}

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

/* ========== выборка БЕЗ лимита 1000 строк ==========
 * PostgREST режет любую выборку на 1000 строк (db-max-rows). За «Всё время»
 * у нас 1000+ заказов / 3000+ позиций / 1800+ платежей — без пагинации
 * доходы, маржа и средние чеки молча занижались. Эти хелперы тянут все строки.
 */
const PAGE_SIZE = 1000;

/** Тянет ВСЕ строки запроса постранично (.range), обходя лимит в 1000. */
async function fetchAllPaged<T>(
  makeQuery: (rangeFrom: number, rangeTo: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await makeQuery(from, to);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

/**
 * Запрос с фильтром .in(col, ids) по чанкам id (защита и от лимита строк,
 * и от слишком длинного URL при тысячах id), с пагинацией внутри каждого чанка.
 */
async function fetchByIdChunks<T>(
  ids: Array<number | string>,
  makeQuery: (
    chunk: Array<number | string>,
    rangeFrom: number,
    rangeTo: number,
  ) => PromiseLike<{ data: T[] | null; error: any }>,
  chunkSize = 300,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const rows = await fetchAllPaged<T>((a, b) => makeQuery(chunk, a, b));
    out.push(...rows);
  }
  return out;
}

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
type DistBin = { from_amt: number; cnt: number };
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

// Виды линз: сгруппированы по типу покрытия с каталожными названиями
type LensCatRow = {
  name: string;
  cnt: number;
};

// Конкретные диоптрии
type LensSphRow = {
  sph: string;
  cnt: number;
};

/**
 * Полный список видов линз (по типу покрытия, каталожные названия).
 * Цвета хамелеона и знаки +/− сливаются в один вид; индекс 1.67, асферика
 * и астигматика остаются отдельными видами — это разные продукты с разной ценой.
 * Показываем ВСЕ виды, даже с нулевыми продажами за период.
 */
const LENS_CATEGORIES: string[] = [
  'Стандарт',
  'Антиблик',
  'Защита от экранов',
  'Хамелеон',
  'Стандарт 1.67',
  'Антиблик 1.67',
  'Защита от экранов 1.67',
  'Blue Block X',
  'Асферика стандарт',
  'Асферика антиблик',
  'Асферика защита от экрана',
  'Поликарбонат',
  'Контроль миопии',
  'Астигматика стандарт',
  'Астигматика антиблик',
  'Астигматика защита от экрана',
  'Астигматика хамелеон',
  'Астигматика Blue Block X',
];

/** Первый токен lens_type ('AR_PLUS [0–2.75]' → 'AR_PLUS') → каталожное название вида. */
function lensTypeToCategory(lensType: string | null | undefined): string {
  const tok = String(lensType ?? '').trim().split(/\s+/)[0].toUpperCase();
  if (!tok) return 'Прочее';
  // Астигматика (AST_*) — отдельная ветка
  if (tok.startsWith('AST_')) {
    if (tok.startsWith('AST_CHAME')) return 'Астигматика хамелеон';
    if (tok.startsWith('AST_BBX')) return 'Астигматика Blue Block X';
    if (tok.startsWith('AST_BB')) return 'Астигматика защита от экрана';
    if (tok.startsWith('AST_AR')) return 'Астигматика антиблик';
    if (tok.startsWith('AST_WHITE')) return 'Астигматика стандарт';
    return 'Астигматика прочее';
  }
  // Асферика (ASPH_*)
  if (tok.startsWith('ASPH_')) {
    if (tok.startsWith('ASPH_AR')) return 'Асферика антиблик';
    if (tok.startsWith('ASPH_BB')) return 'Асферика защита от экрана';
    if (tok.startsWith('ASPH_STANDARD') || tok.startsWith('ASPH_WHITE')) return 'Асферика стандарт';
    return 'Асферика прочее';
  }
  if (tok === 'POLY' || tok.startsWith('PC_159')) return 'Поликарбонат';
  if (tok.startsWith('MYOPIA')) return 'Контроль миопии';
  if (tok.startsWith('CHAME')) return 'Хамелеон'; // все цвета: BLACK/BROWN/BLUE/GREEN/PURPLE/PLUS/MINUS
  if (tok === 'BBX') return 'Blue Block X';
  // утончённые 1.67 — отдельные виды (проверяем до общих WHITE/AR/BB)
  if (tok === 'WHITE_167') return 'Стандарт 1.67';
  if (tok === 'AR_PLUS_167' || tok === 'AR_MINUS_167' || tok === 'AR_167') return 'Антиблик 1.67';
  if (tok === 'BB_167') return 'Защита от экранов 1.67';
  // базовые покрытия
  if (tok.startsWith('WHITE')) return 'Стандарт';
  if (tok.startsWith('AR')) return 'Антиблик';
  if (tok.startsWith('BB')) return 'Защита от экранов';
  return 'Прочее';
}

/** Строит гистограмму (распределение) сумм по корзинам шириной `bucket`. */
function buildHistogram(values: number[], bucket: number): DistBin[] {
  if (!values.length) return [];
  let maxV = 0;
  for (const v of values) if (v > maxV) maxV = v;
  const top = Math.max(bucket, Math.ceil((maxV + 1) / bucket) * bucket);
  const counts = new Map<number, number>();
  for (let e = 0; e < top; e += bucket) counts.set(e, 0);
  for (const v of values) {
    const e = Math.floor(v / bucket) * bucket;
    counts.set(e, (counts.get(e) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([from_amt, cnt]) => ({ from_amt, cnt }))
    .sort((a, b) => a.from_amt - b.from_amt);
}

/**
 * lens_type → id вида в lens_catalog (для подтягивания себестоимости cost_price_*).
 * У части видов (1.67-стандарт, Blue Block X, астигматика-стандарт/BBX) нет точного
 * аналога в каталоге — берём ближайший по себестоимости (помечены в LENS_PROXY_COST).
 */
function lensTypeToCatalogId(lensType: string | null | undefined): string | null {
  const tok = String(lensType ?? '').trim().split(/\s+/)[0].toUpperCase();
  if (!tok) return null;
  if (tok.startsWith('AST_')) {
    if (tok.startsWith('AST_CHAME')) return 'ast-chameleon';
    if (tok.startsWith('AST_BBX')) return 'ast-screen';   // прокси
    if (tok.startsWith('AST_BB')) return 'ast-screen';
    if (tok.startsWith('AST_AR')) return 'ast-antiglare';
    if (tok.startsWith('AST_WHITE')) return 'ast-antiglare'; // прокси (нет ast-standard)
    return 'ast-antiglare';
  }
  if (tok.startsWith('ASPH_')) {
    if (tok.startsWith('ASPH_AR')) return 'asph-antiglare';
    if (tok.startsWith('ASPH_BB')) return 'asph-screen';
    if (tok.startsWith('ASPH_STANDARD') || tok.startsWith('ASPH_WHITE')) return 'asph-standard';
    return 'asph-standard';
  }
  if (tok === 'POLY' || tok.startsWith('PC_159')) return 'polycarbonate';
  if (tok.startsWith('MYOPIA')) return 'myopia-control';
  if (tok.startsWith('CHAME')) return 'chameleon';
  if (tok === 'BBX') return 'screen'; // прокси (нет отдельного BBX в каталоге)
  if (tok === 'WHITE_167') return 'standard'; // прокси (нет thin-standard)
  if (tok === 'AR_PLUS_167' || tok === 'AR_MINUS_167' || tok === 'AR_167') return 'thin-antiglare';
  if (tok === 'BB_167') return 'thin-screen';
  if (tok.startsWith('WHITE')) return 'standard';
  if (tok.startsWith('AR')) return 'antiglare';
  if (tok.startsWith('BB')) return 'screen';
  return null;
}

/** Виды, у которых себестоимость взята с ближайшего аналога (для пометки «*» в таблице). */
const LENS_PROXY_COST = new Set<string>([
  'Стандарт 1.67',
  'Blue Block X',
  'Астигматика стандарт',
  'Астигматика Blue Block X',
]);

/** Высокий тир рецепта по метке диапазона в lens_type ('[0–2.75]' → низкий, иначе высокий). */
function lensTypeIsHighTier(lensType: string | null | undefined): boolean {
  const m = String(lensType ?? '').match(/\[(\d+(?:\.\d+)?)/);
  if (!m) return false;
  return Number(m[1]) > 0; // диапазоны, начинающиеся не с 0 (3–5.5, 6–8.5, 2–3.75 …) = от ±3.0
}

// Маржа по видам линз (вычисляется на клиенте из order_items + lens_catalog.cost_price_*)
type LensMarginRow = { name: string; units: number; revenue: number; cost: number };

// Выручка на трудочас + ФОТ/выручка по филиалам
type SplhRow = { branch: string; revenue: number; hours: number; gross: number; splh: number; lcr: number };

// Чистая прибыль по дням (все поля из admin_net_profit_by_day)
type NetProfitRow = { day: string; orders_count: number; income: number; refunds: number; opex_total: number; cogs_total: number; payroll_total: number; net_profit: number };

// Заказы по 10-минутным интервалам (bucket = 'HH24:MI' из SQL)
type Orders10Row = {
  bucket: string;
  orders_cnt: number;
  revenue_sum: number;
};

// Дата старта POS по каждому филиалу (первый реальный оплаченный заказ).
// Порядок ключей задаёт порядок чипов в фильтре.
const BRANCH_START_DATE: Record<string, string> = {
  'Сокулук': '2025-11-15',
  'Беловодск': '2026-06-03',
  'Кара-Балта': '2025-11-20',
  'Кант': '2025-12-17',
  'Токмок': '2026-05-21',
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

export default function AdminStatsPage() {
  /* --- доступ --- */
  const [gate, setGate] = React.useState<'pending' | 'ok' | 'denied'>('pending');

  /* --- фильтры --- */
  const branchOptions = ALL_BRANCHES;
  const [branches, setBranches] = React.useState<string[]>([]); // [] = все филиалы

  const [fromISO, setFromISO] = React.useState<string>(() => getEffectiveStartDate([]));
  const [toISO, setToISO] = React.useState<string>(() => todayISO());

  // Режим расчёта доходов:
  //   'gross' — по выручке (сумма заказов, включая долги — как будто их вернут)
  //   'cash'  — по фактическим поступлениям (платежам)
  // По умолчанию gross: 99% долгов возвращаются, и так маржа реалистичнее.
  const [revenueMode, setRevenueMode] = React.useState<'gross' | 'cash'>('gross');

  const [filtersReady, setFiltersReady] = React.useState(false);

  /* --- данные --- */
  const [byDay, setByDay] = React.useState<DayRow[]>([]);
  const [byBranch, setByBranch] = React.useState<BranchRow[]>([]);
  const [payments, setPayments] = React.useState<PayRow[]>([]);
  const [custKpis, setCustKpis] = React.useState<CustKpis | null>(null);
  const [heat, setHeat] = React.useState<HeatRow[]>([]);
  const [frameBins, setFrameBins] = React.useState<DistBin[]>([]);
  const [lensBins, setLensBins] = React.useState<DistBin[]>([]);
  const [refunds, setRefunds] = React.useState<RefundRow[]>([]);
  const [ageRows, setAgeRows] = React.useState<AgeRow[]>([]);
  const [lensCats, setLensCats] = React.useState<LensCatRow[]>([]);
  const [lensMargin, setLensMargin] = React.useState<LensMarginRow[]>([]);
  const [lensSph, setLensSph] = React.useState<LensSphRow[]>([]);
  const [splh, setSplh] = React.useState<SplhRow[]>([]);
  const [netProfit, setNetProfit] = React.useState<NetProfitRow[]>([]);
  const [orders10, setOrders10] = React.useState<Orders10Row[]>([]);

  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // Реальные зарплаты из v_payroll_daily + средние чеки из fn_finance_summary_todate_v2
  const [realPayroll, setRealPayroll] = React.useState(0);
  const [avgFrameCheck, setAvgFrameCheck] = React.useState(0);
  const [avgLensCheck, setAvgLensCheck] = React.useState(0);
  // Динамика среднего чека оправ/линз по бакетам времени
  const [avgCheckTrend, setAvgCheckTrend] = React.useState<AvgCheckTrendRow[]>([]);
  const [avgCheckGran, setAvgCheckGran] = React.useState<TrendGran>('week');
  // Аренда (фикс. OPEX) за воскресенья — нужна для итогов, т.к. она платится в т.ч. в выходные,
  // хотя из дневных рядов воскресенья исключаются для других метрик.
  const [sundayOpex, setSundayOpex] = React.useState(0);

  // навигация/URL
  const router = useRouter();
  const searchParams = useSearchParams();

  // Счётчик загрузок: защита от гонок — результат устаревшего запроса не должен
  // перетирать свежий (быстрые клики по фильтрам).
  const runIdRef = React.useRef(0);
  // Запоминаем дату «С», выставленную автоматически от старта филиала. Если пользователь
  // её не трогал — при смене филиала следуем за филиалом (и вперёд, и назад).
  const autoFromRef = React.useRef<string>('');
  // Гарантируем единоразовую первичную загрузку.
  const didInitRef = React.useRef(false);

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

      // Защита от перевёрнутого диапазона в ссылке (from > to) — меняем местами,
      // чтобы поля и запрашиваемый период совпадали с первого рендера.
      let f = urlFrom;
      let t = urlTo;
      if (f && t && f > t) [f, t] = [t, f];

      // Если из URL дали диапазон — используем его
      if (f) setFromISO(f);
      if (t) setToISO(t);

      // Если диапазона нет — с даты старта выбранных филиалов
      if (!f) {
        const eff = getEffectiveStartDate(initialBranches);
        setFromISO(eff);
        autoFromRef.current = eff; // дата выставлена автоматически
      }
      if (!t) setToISO(todayISO());

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
    async (override?: { fromISO?: string; toISO?: string; branches?: string[]; revenueMode?: 'gross' | 'cash' }) => {
      const myRun = ++runIdRef.current;
      const isStale = () => runIdRef.current !== myRun;
      setLoading(true);
      setErr(null);

      // Сбрасываем финансовые данные чтобы не мелькали старые цифры
      setRealPayroll(0);
      setAvgFrameCheck(0);
      setAvgLensCheck(0);
      setAvgCheckTrend([]);
      setFrameBins([]);
      setLensBins([]);
      setLensCats([]);
      setLensMargin([]);
      setSplh([]);
      setNetProfit([]);
      setSundayOpex(0);

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
      const mode = override?.revenueMode ?? revenueMode;
      // Верхняя граница created_at — эксклюзивный +1 день, единообразно для всех прямых
      // запросов (раньше часть запросов брала "to + 'T23:59:59'" и теряла последнюю секунду).
      const toExcISO = (() => {
        const d = new Date(`${to}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        return d.toISOString().slice(0, 10);
      })();

      try {
        const results = await Promise.allSettled([
          rpcRevenueInflowByDay(from, to, brForRpc as any), // 0
          rpcPeriodByBranch(from, to, brForRpc as any), // 1
          rpcPaymentsBreakdown(from, to, brForRpc as any), // 2
          rpcNewVsReturning(from, to, brForRpc as any), // 3
          rpcAvgIntervalDays(from, to, brForRpc as any), // 4
          rpcAvgMedianCheck(from, to, brForRpc as any), // 5
          rpcHeatmap(from, to, brForRpc as any), // 6
          rpcRefundsByDay(from, to, brForRpc as any), // 7
          rpcAgeByYear(from, to, brForRpc as any), // 8
          rpcNetProfitByDay(from, to, brForRpc as any), // 9
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
        const refundRows = get<RefundRow[]>(7, []);
        const ages = get<AgeRow[]>(8, []);
        const np = get<NetProfitRow[]>(9, []);

        // Сохраняем аренду (фикс. OPEX) за воскресенья — она входит в общие итоги,
        // хотя из дневных рядов воскресенья исключаются (в выходной не работают,
        // но аренда платится за все 365 дней).
        const sundayOpexSum = (np || [])
          .filter((r) => isSundayISO(String(r.day)))
          .reduce((s, r) => s + (Number(r.opex_total) || 0), 0);
        if (isStale()) return;
        setSundayOpex(sundayOpexSum);

        // Серверная выручка по дням (rpcRevenueInflowByDay) — потолок для cash-режима;
        // доступна в обоих режимах (в отличие от grossByDay, который пуст в cash).
        const revByDay = new Map<string, number>();
        for (const r of d || []) revByDay.set(String(r.day).slice(0, 10), Number(r.revenue) || 0);

        // Заранее получаем branch_id'ы выбранных филиалов (используются и для ЗП, и для выручки).
        let branchIds: number[] | null = null;
        if (brForRpc && brForRpc.length > 0) {
          try {
            const sb = getSupabase();
            const { data: brIds } = await sb.from('branches').select('id').in('name', brForRpc);
            if (brIds?.length) branchIds = brIds.map((b: any) => b.id);
          } catch {
            branchIds = null;
          }
        }

        // === Выручка по дням (для режима 'gross': income = sum(orders.total_amount)) ===
        // В режиме 'cash' оставляем income из RPC (= фактические поступления).
        const grossByDay = new Map<string, number>();
        if (mode === 'gross') {
          try {
            const sb = getSupabase();
            const ordersData = await fetchAllPaged<any>((a, bb) => {
              let qo = sb
                .from('orders')
                .select('created_at, total_amount, branch_id')
                .gte('created_at', from)
                .lt('created_at', toExcISO)
                .eq('is_deleted', false)
                .range(a, bb);
              if (branchIds) qo = qo.in('branch_id', branchIds);
              return qo;
            });
            for (const r of ordersData as any[]) {
              const d = String(r.created_at).slice(0, 10);
              grossByDay.set(d, (grossByDay.get(d) || 0) + (Number(r.total_amount) || 0));
            }
          } catch {
            /* при ошибке оставляем grossByDay пустым → откатимся к cash */
            warns.push('Не удалось посчитать выручку (режим «по выручке») — показаны поступления');
          }
        }

        // Загружаем реальную ЗП по дням и патчим net_profit в np
        // (RPC admin_net_profit_by_day возвращает payroll_total=0, поэтому график без патча
        // показывает "прибыль" БЕЗ учёта ЗП — не сходится с KPI).
        let npPatched = np;
        let totalPayroll = 0;
        try {
          const sb = getSupabase();
          let payErr: any = null;
          let rows = await fetchAllPaged<any>((a, bb) => {
            let q = sb
              .from('v_payroll_daily_canonical')
              .select('day, net_day')
              .gte('day', from)
              .lte('day', to)
              .range(a, bb);
            if (branchIds) q = q.in('branch_id', branchIds);
            return q;
          }).catch((e) => { payErr = e; return [] as any[]; });
          // Fallback на v_payroll_daily, если canonical недоступен
          if (payErr || rows.length === 0) {
            rows = await fetchAllPaged<any>((a, bb) => {
              let q2 = sb
                .from('v_payroll_daily')
                .select('day, net_day')
                .gte('day', from)
                .lte('day', to)
                .range(a, bb);
              if (branchIds) q2 = q2.in('branch_id', branchIds);
              return q2;
            }).catch(() => [] as any[]);
          }
          // Карта day → сумма net_day (по всем сотрудникам выбранных филиалов)
          const payByDay = new Map<string, number>();
          for (const r of rows) {
            const d = String(r.day).slice(0, 10);
            payByDay.set(d, (payByDay.get(d) || 0) + (Number(r.net_day) || 0));
          }
          npPatched = (np || []).map((r) => {
            const dayKey = String(r.day).slice(0, 10);
            const p = payByDay.get(dayKey) || 0;
            const rpcIncome = Number(r.income) || 0;
            const grossIncome = grossByDay.get(dayKey);
            // Потолок дня: gross-выручка (если считали) либо серверная revenue.
            const dayCap = grossIncome !== undefined ? grossIncome : revByDay.get(dayKey);
            // В cash mode: если платежи (rpcIncome) превышают выручку дня — это
            // переплата/сиротский платёж, обрезаем до выручки. Иначе маржа надувается.
            const cashIncome = dayCap !== undefined && rpcIncome > dayCap ? dayCap : rpcIncome;
            const income = mode === 'gross' && grossIncome !== undefined ? grossIncome : cashIncome;
            const refunds = Number(r.refunds) || 0;
            const opex = Number(r.opex_total) || 0;
            const cogs = Number(r.cogs_total) || 0;
            return {
              ...r,
              income,
              payroll_total: p,
              net_profit: income - refunds - opex - cogs - p,
            };
          });
          // Сумма ЗП за весь период, включая воскресенья — симметрично воскресной аренде
          // в OPEX (в выходные бывают бонусы/корректировки net_day).
          totalPayroll = rows.reduce((s: number, r: any) => s + (Number(r.net_day) || 0), 0);
        } catch {
          /* фолбэк — оставляем np как есть */
        }
        if (isStale()) return;
        setRealPayroll(totalPayroll);

        // КЛЭМП: поступления не могут превышать выручку за день
        // (защита от платежей за удалённые/чужие заказы — отрицательного долга не бывает).
        const dClamped = (d || []).map((r) => {
          const rev = Number(r.revenue) || 0;
          const inf = Number(r.inflow) || 0;
          return inf > rev ? { ...r, inflow: rev } : r;
        });

        // УБИРАЕМ ВОСКРЕСЕНЬЯ ИЗ ДНЕВНЫХ РЯДОВ
        if (isStale()) return;
        setByDay(dropSundays(dClamped));
        setRefunds(dropSundays(refundRows));
        setNetProfit(dropSundays(npPatched));

        // Остальное
        setByBranch(b);
        setPayments(p);
        setHeat(heatRows);
        setAgeRows(ages);

        setCustKpis({
          avg_check: Number(ck.avg_check || 0),
          median_check: Number(ck.median_check || 0),
          avg_interval_days: Number(avgInt || 0),
          returning_share: Number(nv.returning_share || 0),
          new_customers: nv.new_customers,
          returning_customers: nv.returning_customers,
          customers_total: nv.customers_total,
        });

        // === Универсум заказов за период (с учётом режима и филиалов) — общий
        //    для распределения диоптрий и средних чеков/маржи.
        //    gross = все заказы (вкл. долг), cash = только оплаченные. ===
        let validIds: number[] = [];
        try {
          const sb = getSupabase();
          if (mode === 'gross') {
            const ordRows = await fetchAllPaged<any>((a, bb) => {
              let oq = sb
                .from('orders')
                .select('id')
                .gte('created_at', from)
                .lt('created_at', toExcISO)
                .eq('is_deleted', false)
                .range(a, bb);
              if (branchIds) oq = oq.in('branch_id', branchIds);
              return oq;
            });
            validIds = (ordRows || []).map((o: any) => o.id);
          } else {
            const paidRows = await fetchAllPaged<any>((a, bb) =>
              sb.from('payments').select('order_id')
                .gte('created_at', from).lt('created_at', toExcISO).range(a, bb),
            );
            const paidIds = [...new Set((paidRows || []).map((r: any) => r.order_id))];
            if (paidIds.length > 0 && branchIds) {
              const ordRows = await fetchByIdChunks<any>(paidIds, (chunk, a, bb) =>
                sb.from('orders').select('id, branch_id').in('id', chunk).range(a, bb),
              );
              const brIdSet = new Set(branchIds);
              validIds = (ordRows || []).filter((o: any) => brIdSet.has(o.branch_id)).map((o: any) => o.id);
            } else {
              validIds = paidIds;
            }
          }
        } catch {
          validIds = [];
        }

        // === конкретные диоптрии (SPH) — по тому же универсуму заказов ===
        try {
          const sb = getSupabase();
          if (validIds.length > 0) {
            const oiRows = await fetchByIdChunks<any>(validIds, (chunk, a, bb) =>
              sb.from('order_items').select('sph, order_id')
                .in('order_id', chunk).eq('item_type', 'lens').not('sph', 'is', null).range(a, bb),
            );
            const sphMap = new Map<string, number>();
            for (const r of oiRows) {
              const sph = String(r.sph);
              sphMap.set(sph, (sphMap.get(sph) || 0) + 1);
            }
            const sphRows = [...sphMap.entries()]
              .map(([sph, cnt]) => ({ sph, cnt }))
              .sort((a, b) => parseFloat(a.sph) - parseFloat(b.sph));
            if (isStale()) return;
            setLensSph(sphRows);
          } else {
            if (isStale()) return;
            setLensSph([]);
          }
        } catch (e: any) {
          console.warn('[lens_sph_exact]', e?.message ?? e);
          setLensSph([]);
        }

        // === средние чеки оправ/линз + виды/маржа линз — по тому же универсуму заказов ===
        try {
          const sb = getSupabase();
          if (validIds.length > 0) {
            // Себестоимость линз из каталога (для маржи по видам)
            const { data: catRows } = await sb.from('lens_catalog').select('id, cost_price_from, cost_price_to');
            const costMap = new Map<string, { from: number; to: number }>();
            for (const c of (catRows || [])) {
              costMap.set(String(c.id), { from: Number(c.cost_price_from) || 0, to: Number(c.cost_price_to) || 0 });
            }

            const oiRows = await fetchByIdChunks<any>(validIds, (chunk, a, bb) =>
              sb.from('order_items')
                .select('order_id, item_type, price, qty, lens_type')
                .in('order_id', chunk).range(a, bb),
            );
            const byOrder = new Map<number, { frame: number; lens: number }>();
            const catMap = new Map<string, number>(); // вид линзы → кол-во проданных линз
            const marginMap = new Map<string, { units: number; revenue: number; cost: number }>();
            for (const r of (oiRows || [])) {
              const oid = r.order_id;
              const prev = byOrder.get(oid) ?? { frame: 0, lens: 0 };
              const amt = (Number(r.price) || 0) * (Number(r.qty) || 1);
              if (r.item_type === 'frame') prev.frame += amt;
              else if (r.item_type === 'lens') {
                prev.lens += amt;
                const cat = lensTypeToCategory(r.lens_type);
                catMap.set(cat, (catMap.get(cat) || 0) + 1);
                // Маржа: выручка = факт. price, себестоимость = каталожная по тиру (за линзу)
                const catId = lensTypeToCatalogId(r.lens_type);
                const c = catId ? costMap.get(catId) : undefined;
                const unitCost = c ? (lensTypeIsHighTier(r.lens_type) ? c.to : c.from) : 0;
                const qn = Number(r.qty) || 1;
                const mm = marginMap.get(cat) ?? { units: 0, revenue: 0, cost: 0 };
                mm.units += qn;
                mm.revenue += amt;
                mm.cost += unitCost * qn;
                marginMap.set(cat, mm);
              }
              byOrder.set(oid, prev);
            }
            // Средние чеки + распределения по оправам/линзам (только заказы, где есть такая позиция)
            let frameSum = 0, frameCnt = 0, lensSum = 0, lensCnt = 0;
            const frameAmts: number[] = [], lensAmts: number[] = [];
            for (const v of byOrder.values()) {
              if (v.frame > 0) { frameSum += v.frame; frameCnt++; frameAmts.push(v.frame); }
              if (v.lens > 0) { lensSum += v.lens; lensCnt++; lensAmts.push(v.lens); }
            }
            if (isStale()) return;
            setAvgFrameCheck(frameCnt > 0 ? Math.round(frameSum / frameCnt) : 0);
            setAvgLensCheck(lensCnt > 0 ? Math.round(lensSum / lensCnt) : 0);
            setFrameBins(buildHistogram(frameAmts, 500));
            setLensBins(buildHistogram(lensAmts, 250));
            // Виды линз: все каталожные виды (0 у непроданных) + нераспознанные снизу
            const extra = [...catMap.keys()].filter((k) => !LENS_CATEGORIES.includes(k));
            setLensCats(
              [...LENS_CATEGORIES, ...extra].map((name) => ({ name, cnt: catMap.get(name) || 0 })),
            );
            // Маржа по видам линз (только проданные виды)
            setLensMargin(
              [...marginMap.entries()]
                .map(([name, m]) => ({ name, units: m.units, revenue: Math.round(m.revenue), cost: Math.round(m.cost) }))
                .filter((r) => r.units > 0),
            );

            // === Динамика среднего чека оправ/линз по бакетам времени ===
            // Гранулярность адаптивная: короткий период — по дням, средний — по неделям, год+ — по месяцам.
            const spanDays =
              Math.round(
                (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000,
              ) + 1;
            const gran: TrendGran = spanDays <= 21 ? 'day' : spanDays <= 210 ? 'week' : 'month';

            // order_id → дата заказа (YYYY-MM-DD), чтобы разложить byOrder по бакетам
            const dateById = new Map<number, string>();
            try {
              const ordDateRows = await fetchByIdChunks<any>(validIds, (chunk, a, bb) =>
                sb.from('orders').select('id, created_at').in('id', chunk).range(a, bb),
              );
              for (const o of ordDateRows || []) {
                dateById.set(Number(o.id), String(o.created_at).slice(0, 10));
              }
            } catch {
              /* при ошибке dateById пуст → тренд будет пустым */
            }

            const bucketAgg = new Map<
              string,
              { frameSum: number; frameCnt: number; lensSum: number; lensCnt: number }
            >();
            for (const [oid, v] of byOrder.entries()) {
              const dISO = dateById.get(Number(oid));
              if (!dISO || dISO < from || dISO >= toExcISO) continue;
              const key = trendBucketKey(dISO, gran);
              const agg = bucketAgg.get(key) ?? { frameSum: 0, frameCnt: 0, lensSum: 0, lensCnt: 0 };
              if (v.frame > 0) {
                agg.frameSum += v.frame;
                agg.frameCnt++;
              }
              if (v.lens > 0) {
                agg.lensSum += v.lens;
                agg.lensCnt++;
              }
              bucketAgg.set(key, agg);
            }
            const trendRows: AvgCheckTrendRow[] = [...bucketAgg.entries()]
              .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
              .map(([bucket, agg]) => ({
                bucket,
                label: trendBucketLabel(bucket, gran),
                frameAvg: agg.frameCnt > 0 ? Math.round(agg.frameSum / agg.frameCnt) : null,
                lensAvg: agg.lensCnt > 0 ? Math.round(agg.lensSum / agg.lensCnt) : null,
                frameCnt: agg.frameCnt,
                lensCnt: agg.lensCnt,
              }));
            if (isStale()) return;
            setAvgCheckGran(gran);
            setAvgCheckTrend(trendRows);
          } else {
            setAvgFrameCheck(0);
            setAvgLensCheck(0);
            setFrameBins([]);
            setLensBins([]);
            setLensCats([]);
            setLensMargin([]);
            setAvgCheckTrend([]);
          }
        } catch {
          setAvgFrameCheck(0);
          setAvgLensCheck(0);
          setFrameBins([]);
          setLensBins([]);
          setLensCats([]);
          setLensMargin([]);
          setAvgCheckTrend([]);
        }

        // === SPLH (выручка/час) + ФОТ/выручка (LCR, брутто) по филиалам ===
        try {
          const sb = getSupabase();
          // Часы и брутто-ФОТ по филиалам за период (постранично — обход лимита 1000)
          const spRows = await fetchAllPaged<any>((a, bb) => {
            let qsp = sb
              .from('v_payroll_daily_canonical')
              .select('branch_id, hours, hour_pay, bonus, penalties')
              .gte('day', from)
              .lte('day', to)
              .range(a, bb);
            if (branchIds) qsp = qsp.in('branch_id', branchIds);
            return qsp;
          });
          const payByBr = new Map<number, { hours: number; gross: number }>();
          for (const r of spRows) {
            const bid = Number(r.branch_id);
            const prev = payByBr.get(bid) ?? { hours: 0, gross: 0 };
            prev.hours += Number(r.hours) || 0;
            prev.gross += (Number(r.hour_pay) || 0) + (Number(r.bonus) || 0) - (Number(r.penalties) || 0);
            payByBr.set(bid, prev);
          }
          // branch_id ↔ name
          const { data: brAll } = await sb.from('branches').select('id, name');
          const nameToId = new Map<string, number>((brAll || []).map((x: any) => [x.name, Number(x.id)]));
          // Выручка по филиалу — из byBranch (orders_view), как в таблице сравнения
          const rows: SplhRow[] = (b || [])
            .map((br) => {
              const bid = nameToId.get(br.branch);
              const pay = bid != null ? payByBr.get(bid) : undefined;
              const revenue = Number(br.ov_revenue) || 0;
              const hours = pay?.hours || 0;
              const gross = pay?.gross || 0;
              return {
                branch: br.branch,
                revenue,
                hours: Math.round(hours),
                gross, // сырой брутто-ФОТ (для точного агрегата ФОТ/выручка)
                splh: hours > 0 ? Math.round(revenue / hours) : 0,
                lcr: revenue > 0 ? Math.round((gross / revenue) * 1000) / 10 : 0,
              };
            })
            .filter((r) => r.revenue > 0 || r.hours > 0);
          if (isStale()) return;
          setSplh(rows);
        } catch {
          setSplh([]);
        }

        // === заказы по 10-минутным интервалам ===
        try {
          const sb = getSupabase();
          const { data: orders10Raw, error: err10 } = await sb.rpc('stats_orders_by_10min', {
            p_from: from,
            p_to: to,
            p_branches: brForRpc,
          });

          if (isStale()) return;
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

        if (isStale()) return;
        if (warns.length) setErr(warns.join(' · '));
        else setErr(null);

        pushFiltersToURL(from, to, br);
      } finally {
        // спиннер гасит только актуальный запрос (устаревший — молчит)
        if (!isStale()) setLoading(false);
      }
    },
    [fromISO, toISO, branches, revenueMode, pushFiltersToURL],
  );

  /* --- первичная загрузка: ровно один раз, когда доступ и фильтры готовы.
     Дальше перезагружают только явные действия (пресеты/даты/филиалы/режим/«Обновить»),
     чтобы не было скрытой авто-перезагрузки и двойных запросов. --- */
  React.useEffect(() => {
    if (gate === 'ok' && filtersReady && !didInitRef.current) {
      didInitRef.current = true;
      void loadAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate, filtersReady]);

  /* --- быстрые пресеты (сразу грузим данные, чтобы не было "нажал — ничего не изменилось") --- */
  const applyPreset = React.useCallback(
    async (preset: 'all' | 'month' | '30d' | '7d' | 'year' | 'branch_start') => {
      let r: { from: string; to: string };

      if (preset === 'month') r = getCurrentMonthRange();
      else if (preset === '30d') r = getLastNDaysRange(30);
      else if (preset === '7d') r = getLastNDaysRange(7);
      else if (preset === 'year') r = getCurrentYearRange();
      else if (preset === 'branch_start') {
        // Старт = дата открытия выбранного филиала (если выбран один филиал — берём его,
        // если выбрано несколько — самую раннюю из выбранных, как и "Всё время")
        r = { from: getEffectiveStartDate(branches), to: todayISO() };
      } else r = { from: getEffectiveStartDate(branches), to: todayISO() };

      const nextFrom = r.from.slice(0, 10);
      const nextTo = r.to.slice(0, 10);

      setFromISO(nextFrom);
      setToISO(nextTo);
      // 'all'/'branch_start' выставляют дату старта филиала автоматически — запоминаем,
      // чтобы смена филиала могла за ней следовать; явный период (7д/30д/месяц/год) — нет.
      autoFromRef.current = (preset === 'all' || preset === 'branch_start') ? nextFrom : '';

      // мгновенная подгрузка по новому диапазону
      void loadAll({ fromISO: nextFrom, toISO: nextTo, branches });
    },
    [branches, loadAll],
  );

  /* --- смена филиалов: следуем за датой старта (если её не трогали вручную) и грузим --- */
  const applyBranches = React.useCallback(
    (next: string[]) => {
      const eff = getEffectiveStartDate(next);
      // дату «С» не меняли вручную → следуем за филиалом (вперёд И назад);
      // иначе не даём периоду начинаться раньше старта POS филиала.
      const followAuto = fromISO === autoFromRef.current;
      const nextFrom = followAuto ? eff : (fromISO < eff ? eff : fromISO);
      autoFromRef.current = nextFrom;
      setBranches(next);
      setFromISO(nextFrom);
      void loadAll({ branches: next, fromISO: nextFrom });
    },
    [fromISO, loadAll],
  );

  const toggleBranch = React.useCallback(
    (b: string) => {
      const active = branches.includes(b);
      applyBranches(active ? branches.filter((x) => x !== b) : [...branches, b]);
    },
    [branches, applyBranches],
  );

  const applyRevenueMode = React.useCallback(
    (m: 'gross' | 'cash') => {
      if (m === revenueMode) return;
      setRevenueMode(m);
      void loadAll({ revenueMode: m });
    },
    [revenueMode, loadAll],
  );

  const applyFrom = React.useCallback(
    (v: string) => {
      const nv = v.slice(0, 10);
      if (!nv) return;
      setFromISO(nv);
      void loadAll({ fromISO: nv });
    },
    [loadAll],
  );

  const applyTo = React.useCallback(
    (v: string) => {
      const nv = v.slice(0, 10);
      if (!nv) return;
      setToISO(nv);
      void loadAll({ toISO: nv });
    },
    [loadAll],
  );

  /* --- дата открытия выбранного филиала (для подписи кнопки "С открытия") --- */
  const branchStartInfo = React.useMemo(() => {
    if (branches.length !== 1) return null;
    const name = branches[0];
    const iso = BRANCH_START_DATE[name];
    if (!iso) return null;
    const [y, m, d] = iso.split('-');
    return { name, iso, label: `${d}.${m}.${y}` };
  }, [branches]);

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
    let income = 0, opexWorkdays = 0, cogs = 0, refunds = 0;
    for (const r of netProfit) {
      income += r.income || 0;
      refunds += r.refunds || 0;
      opexWorkdays += r.opex_total || 0;
      cogs += r.cogs_total || 0;
    }
    // OPEX за все дни = рабочие дни + воскресенья (аренда платится и в выходные)
    const opex = opexWorkdays + (sundayOpex || 0);
    // Реальная прибыль = доходы − возвраты − расходы (opex+cogs) − реальные зарплаты.
    // Та же формула, что в дневном ряду net_profit, поэтому верхний KPI «Чистая прибыль»
    // и график «Чистая прибыль по дням» сходятся (с точностью до воскресной аренды).
    const realNet = income - refunds - opex - cogs - realPayroll;
    const margin = income > 0 ? Math.round((realNet / income) * 100) : 0;
    // Чистая прибыль в среднем за день. Делим на число рабочих дней с данными в периоде.
    const workDays = netProfit.length;
    const profitPerDay = workDays > 0 ? Math.round(realNet / workDays) : 0;
    return { income, opex, cogs, payroll: realPayroll, netProfit: realNet, margin, profitPerDay, workDays, frameAvg: avgFrameCheck, lensAvg: avgLensCheck };
  }, [netProfit, realPayroll, avgFrameCheck, avgLensCheck, sundayOpex]);

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

  // Динамика среднего чека: две линии (оправы / линзы) на общей временной оси
  const optionAvgCheckTrend: EChartsOption = React.useMemo(() => {
    const x = avgCheckTrend.map((r) => r.label);
    const frame = avgCheckTrend.map((r) => r.frameAvg);
    const lens = avgCheckTrend.map((r) => r.lensAvg);
    const cntByLabel = new Map(
      avgCheckTrend.map((r) => [r.label, { f: r.frameCnt, l: r.lensCnt }]),
    );
    const granRu = avgCheckGran === 'day' ? 'День' : avgCheckGran === 'week' ? 'Неделя с' : 'Месяц';

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
        ...(tooltipGlass as any),
        formatter: (params: any) => {
          const arr = Array.isArray(params) ? params : [params];
          const label = arr[0]?.axisValue ?? '';
          const c = cntByLabel.get(label);
          const lines = arr
            .map((p: any) => {
              const val =
                p.value === null || p.value === undefined
                  ? '—'
                  : `${nf(Math.round(p.value))} сом`;
              const cnt = p.seriesName === 'Оправы' ? c?.f : c?.l;
              const cntTxt =
                cnt !== undefined
                  ? ` <span style="color:rgba(15,23,42,0.5)">· ${cnt} зак.</span>`
                  : '';
              return `${p.marker} ${p.seriesName}: <b>${val}</b>${cntTxt}`;
            })
            .join('<br/>');
          return `<div style="font-weight:600;margin-bottom:2px">${granRu} ${label}</div>${lines}`;
        },
      },
      xAxis: { type: 'category', data: x, boundaryGap: false, ...axisCommon },
      yAxis: {
        type: 'value',
        ...axisCommon,
        axisLabel: {
          color: chartTheme.axis,
          fontSize: 11,
          formatter: (v: number) => nf(Number(v)),
        },
      },
      series: [
        {
          name: 'Оправы',
          type: 'line',
          smooth: 0.35,
          symbol: 'circle',
          symbolSize: 6,
          connectNulls: true,
          lineStyle: { width: 3, color: chartTheme.cyan },
          itemStyle: { color: chartTheme.cyan },
          emphasis: { focus: 'series' },
          data: frame,
        },
        {
          name: 'Линзы',
          type: 'line',
          smooth: 0.35,
          symbol: 'circle',
          symbolSize: 6,
          connectNulls: true,
          lineStyle: { width: 3, color: chartTheme.violet },
          itemStyle: { color: chartTheme.violet },
          emphasis: { focus: 'series' },
          data: lens,
        },
      ],
    };
  }, [avgCheckTrend, avgCheckGran, axisCommon, chartTheme, tooltipGlass]);

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

  // Общий билдер кривой распределения чеков (по корзинам сумм)
  const buildDistOption = React.useCallback(
    (data: DistBin[], unit: string): EChartsOption => {
      const nonEmpty = (data || []).filter((b) => (b.cnt || 0) > 0);
      if (!nonEmpty.length) {
        return {
          backgroundColor: 'transparent',
          xAxis: { type: 'value' },
          yAxis: { type: 'value' },
          series: [{ type: 'line', data: [] }],
        };
      }
      const sorted = [...data].sort((a, b) => (a.from_amt || 0) - (b.from_amt || 0));
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
            return `Чек ${unit}: <b>${nf(Math.round(amount))}</b> сом<br/>Кол-во чеков: <b>${nf(Math.round(count))}</b>`;
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
    },
    [axisCommon, chartTheme, gradTeal, gradMoneyArea, tooltipGlass],
  );

  const optionFrameBins: EChartsOption = React.useMemo(
    () => buildDistOption(frameBins, 'по оправам'),
    [buildDistOption, frameBins],
  );
  const optionLensBins: EChartsOption = React.useMemo(
    () => buildDistOption(lensBins, 'по линзам'),
    [buildDistOption, lensBins],
  );

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
    if (!lensCats || lensCats.length === 0) {
      return {
        backgroundColor: 'transparent',
        xAxis: { type: 'value' },
        yAxis: { type: 'category', data: [] },
        series: [{ type: 'bar', data: [] }],
      };
    }
    // По убыванию продаж; непроданные виды (0) уходят вниз графика
    const sorted = [...lensCats].sort((a, b) => b.cnt - a.cnt);
    const cats = sorted.map((r) => r.name || '—').reverse();
    const vals = sorted.map((r) => r.cnt || 0).reverse();

    return {
      backgroundColor: 'transparent',
      grid: { top: 14, right: 40, bottom: 12, left: 210 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v) => nf(Number(v)),
        ...(tooltipGlass as any),
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
          type: 'bar',
          barMaxWidth: 16,
          itemStyle: { borderRadius: 10, color: gradTeal as any },
          data: vals,
          label: {
            show: true,
            position: 'right',
            color: chartTheme.axis,
            fontSize: 11,
            formatter: (p: any) => (Number(p.value) > 0 ? nf(Number(p.value)) : ''),
          },
        },
      ],
    };
  }, [lensCats, axisCommon, chartTheme, gradTeal, tooltipGlass]);

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

  // Маржа по видам линз: таблица + Парето (по убыванию абсолютной маржи)
  const lensMarginView = React.useMemo(() => {
    const base = lensMargin
      .map((r) => {
        const margin = r.revenue - r.cost;
        return {
          name: r.name,
          units: r.units,
          revenue: r.revenue,
          cost: r.cost,
          margin,
          marginPct: r.revenue > 0 ? (margin / r.revenue) * 100 : 0,
          proxy: LENS_PROXY_COST.has(r.name),
        };
      })
      .sort((a, b) => b.margin - a.margin);
    const totalMargin = base.reduce((s, r) => s + r.margin, 0);
    const totalRevenue = base.reduce((s, r) => s + r.revenue, 0);
    let cum = 0;
    const rows = base.map((r) => {
      const share = totalMargin > 0 ? (r.margin / totalMargin) * 100 : 0;
      cum += share;
      return { ...r, share, cumShare: Math.round(cum * 10) / 10 };
    });
    return {
      rows,
      totalMargin,
      totalRevenue,
      avgMarginPct: totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0,
    };
  }, [lensMargin]);

  const optionLensMargin: EChartsOption = React.useMemo(() => {
    const rows = lensMarginView.rows;
    if (!rows.length) {
      return { backgroundColor: 'transparent', xAxis: { type: 'category', data: [] }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: [] }] };
    }
    const names = rows.map((r) => r.name);
    const margins = rows.map((r) => Math.round(r.margin));
    const cum = rows.map((r) => r.cumShare);
    return {
      backgroundColor: 'transparent',
      grid: { top: 32, right: 52, bottom: 96, left: 64 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const arr = Array.isArray(params) ? params : [params];
          const r = rows[arr[0].dataIndex];
          return `${r.name}${r.proxy ? ' *' : ''}<br/>Маржа: <b>${nf(Math.round(r.margin))}</b> сом (${Math.round(r.marginPct)}%)<br/>Выручка: <b>${nf(r.revenue)}</b> · Себест.: ${nf(r.cost)}<br/>Доля в марже: <b>${r.share.toFixed(1)}%</b> (накоп. ${r.cumShare}%)`;
        },
        ...(tooltipGlass as any),
      },
      legend: { top: 0, data: ['Маржа, сом', 'Накопленная доля'], textStyle: { color: chartTheme.subtext, fontWeight: 600 } },
      xAxis: { type: 'category', data: names, ...axisCommon, axisLabel: { color: chartTheme.axis, fontSize: 10, rotate: 38, interval: 0 } },
      yAxis: [
        { type: 'value', ...axisCommon, axisLabel: { color: chartTheme.axis, formatter: (v: number) => nf(v) } },
        { type: 'value', min: 0, max: 100, position: 'right', axisLabel: { color: chartTheme.axis, formatter: '{value}%' }, splitLine: { show: false } },
      ],
      series: [
        { name: 'Маржа, сом', type: 'bar', barMaxWidth: 26, itemStyle: { borderRadius: [8, 8, 0, 0], color: gradTeal as any }, data: margins },
        { name: 'Накопленная доля', type: 'line', yAxisIndex: 1, smooth: 0.2, symbol: 'circle', symbolSize: 5, lineStyle: { width: 2.5, color: chartTheme.rose }, itemStyle: { color: chartTheme.rose }, data: cum },
      ],
    };
  }, [lensMarginView, axisCommon, chartTheme, gradTeal, tooltipGlass]);

  // SPLH + LCR по филиалам (агрегат для KPI)
  const splhTotals = React.useMemo(() => {
    const revenue = splh.reduce((s, r) => s + r.revenue, 0);
    const hours = splh.reduce((s, r) => s + r.hours, 0);
    const gross = splh.reduce((s, r) => s + r.gross, 0);
    return {
      splh: hours > 0 ? Math.round(revenue / hours) : 0,
      lcr: revenue > 0 ? Math.round((gross / revenue) * 1000) / 10 : 0,
      revenue,
      hours,
    };
  }, [splh]);

  const optionSplh: EChartsOption = React.useMemo(() => {
    if (!splh.length) {
      return { backgroundColor: 'transparent', xAxis: { type: 'category', data: [] }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: [] }] };
    }
    const rows = [...splh].sort((a, b) => b.splh - a.splh);
    const names = rows.map((r) => r.branch);
    const splhVals = rows.map((r) => r.splh);
    const lcrVals = rows.map((r) => r.lcr);
    return {
      backgroundColor: 'transparent',
      grid: { top: 36, right: 56, bottom: 36, left: 64 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const arr = Array.isArray(params) ? params : [params];
          const r = rows[arr[0].dataIndex];
          return `${r.branch}<br/>Выручка/час: <b>${nf(r.splh)}</b> сом<br/>ФОТ/выручка: <b>${r.lcr}%</b><br/>Часы: ${nf(r.hours)} · Выручка: ${nf(r.revenue)}`;
        },
        ...(tooltipGlass as any),
      },
      legend: { top: 0, data: ['Выручка/час', 'ФОТ/выручка, %'], textStyle: { color: chartTheme.subtext, fontWeight: 600 } },
      xAxis: { type: 'category', data: names, ...axisCommon },
      yAxis: [
        { type: 'value', ...axisCommon, axisLabel: { color: chartTheme.axis, formatter: (v: number) => nf(v) } },
        { type: 'value', position: 'right', min: 0, axisLabel: { color: chartTheme.axis, formatter: '{value}%' }, splitLine: { show: false } },
      ],
      series: [
        {
          name: 'Выручка/час',
          type: 'bar',
          barMaxWidth: 40,
          itemStyle: { borderRadius: [10, 10, 6, 6], color: gradTeal as any },
          data: splhVals,
          label: { show: true, position: 'top', color: chartTheme.axis, fontSize: 11, formatter: (p: any) => nf(Number(p.value)) },
        },
        { name: 'ФОТ/выручка, %', type: 'line', yAxisIndex: 1, smooth: 0.2, symbol: 'circle', symbolSize: 6, lineStyle: { width: 2.5, color: chartTheme.rose }, itemStyle: { color: chartTheme.rose }, data: lcrVals },
      ],
    };
  }, [splh, axisCommon, chartTheme, gradTeal, tooltipGlass]);

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
            <div className="mb-5 grid grid-cols-1 gap-3">
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
            </div>

            {/* Filters */}
            <Section tone="neutral">
              <div className="flex flex-col gap-4">
                {/* Строка 1: период (пресеты), даты, режим расчёта, обновить */}
                <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                  <FilterGroup label="Период">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SoftGhostButton onClick={() => applyPreset('7d')}>7 дней</SoftGhostButton>
                      <SoftGhostButton onClick={() => applyPreset('30d')}>30 дней</SoftGhostButton>
                      <SoftGhostButton onClick={() => applyPreset('month')}>Месяц</SoftGhostButton>
                      <SoftGhostButton onClick={() => applyPreset('year')}>Год</SoftGhostButton>
                      <SoftGhostButton onClick={() => applyPreset('all')}>Всё время</SoftGhostButton>
                      {branchStartInfo && (
                        <SoftGhostButton
                          onClick={() => applyPreset('branch_start')}
                          title={`Считать с даты открытия филиала ${branchStartInfo.name} (${branchStartInfo.label})`}
                        >
                          С открытия ({branchStartInfo.label})
                        </SoftGhostButton>
                      )}
                    </div>
                  </FilterGroup>

                  <FilterGroup label="Даты">
                    <div className="flex items-center gap-2">
                      <DateField ariaLabel="Дата начала периода" value={fromISO} max={toISO || todayISO()} onChange={applyFrom} />
                      <span className="text-slate-400 text-xs">—</span>
                      <DateField ariaLabel="Дата конца периода" value={toISO} min={fromISO} max={todayISO()} onChange={applyTo} />
                    </div>
                  </FilterGroup>

                  <FilterGroup label="Расчёт финансов">
                    <div
                      className="inline-flex items-center rounded-xl bg-white ring-1 ring-slate-200 p-0.5 text-xs font-medium"
                      title="Доходы, маржа и средние чеки считаются от выручки (включая долги) или только от поступивших платежей"
                    >
                      <button
                        type="button"
                        onClick={() => applyRevenueMode('gross')}
                        className={[
                          'px-3 py-1.5 rounded-lg transition',
                          revenueMode === 'gross'
                            ? 'bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
                            : 'text-slate-600 hover:bg-slate-50',
                        ].join(' ')}
                      >
                        По выручке
                      </button>
                      <button
                        type="button"
                        onClick={() => applyRevenueMode('cash')}
                        className={[
                          'px-3 py-1.5 rounded-lg transition',
                          revenueMode === 'cash'
                            ? 'bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
                            : 'text-slate-600 hover:bg-slate-50',
                        ].join(' ')}
                      >
                        По поступлениям
                      </button>
                    </div>
                  </FilterGroup>

                  <div className="ml-auto self-end">
                    <SoftPrimaryButton onClick={() => loadAll()} loading={loading} icon={RefreshCw}>
                      {loading ? 'Обновляю…' : 'Обновить'}
                    </SoftPrimaryButton>
                  </div>
                </div>

                {/* Строка 2: филиалы — отдельной строкой, удобно выбрать один или несколько */}
                <FilterGroup label={branches.length ? `Филиалы · выбрано ${branches.length}` : 'Филиалы · все'}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip active={branches.length === 0} onClick={() => applyBranches([])}>Все</Chip>
                    {branchOptions.map((b) => (
                      <Chip key={b} active={branches.includes(b)} onClick={() => toggleBranch(b)}>
                        {b}
                      </Chip>
                    ))}
                  </div>
                </FilterGroup>
              </div>

              {/* Подпись о режиме расчёта финансов */}
              <div className="mt-3 text-xs text-slate-500">
                {revenueMode === 'gross' ? (
                  <>
                    💡 Доходы, маржа и средние чеки считаются <b>по выручке</b> (включая долг — как будто все долги вернут).
                    Верхние KPI «Выручка/Поступления/Долг» показывают факт независимо от режима.
                  </>
                ) : (
                  <>
                    💡 Доходы, маржа и средние чеки считаются <b>по поступлениям</b> (только оплаченные заказы).
                    Долги в финансы не входят. Верхние KPI «Выручка/Поступления/Долг» — факт по БД.
                  </>
                )}
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
              <KPI label="Доходы" value={loading ? '…' : nf(financeTotals.income)} icon={HandCoins} iconTone="money" accent="from-cyan-200/55 via-teal-200/45 to-sky-200/40" />
              <KPI label="OPEX" value={loading ? '…' : nf(financeTotals.opex)} icon={CreditCard} iconTone="money" accent="from-sky-200/55 via-cyan-200/45 to-slate-200/40" />
              <KPI label="Себестоимость" value={loading ? '…' : nf(financeTotals.cogs)} icon={CreditCard} iconTone="money" accent="from-slate-200/55 via-sky-200/45 to-cyan-200/40" />
              <KPI label="Зарплаты" value={loading ? '…' : nf(financeTotals.payroll)} icon={CreditCard} iconTone="money" accent="from-teal-200/55 via-cyan-200/45 to-sky-200/40" />
              <KPI label="Чистая прибыль" value={loading ? '…' : nf(financeTotals.netProfit)} icon={TrendingUp} iconTone="money" accent="from-cyan-200/55 via-sky-200/45 to-teal-200/40" />
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <KPI label="Маржа" value={loading ? '…' : `${financeTotals.margin}%`} icon={Percent} iconTone="money" accent="from-teal-200/55 via-cyan-200/45 to-sky-200/40" />
              <KPI
                label="Чистая прибыль / день"
                value={loading ? '…' : `${nf(financeTotals.profitPerDay)} сом`}
                icon={TrendingUp}
                iconTone="money"
                accent="from-emerald-200/55 via-teal-200/45 to-cyan-200/40"
              />
              <KPI label="Средний чек оправы" value={loading ? '…' : financeTotals.frameAvg > 0 ? nf(financeTotals.frameAvg) : '—'} icon={BarChart3} iconTone="money" accent="from-sky-200/55 via-cyan-200/45 to-teal-200/40" />
              <KPI label="Средний чек линз" value={loading ? '…' : financeTotals.lensAvg > 0 ? nf(financeTotals.lensAvg) : '—'} icon={BarChart3} iconTone="money" accent="from-cyan-200/55 via-teal-200/45 to-sky-200/40" />
            </div>

            {/* Charts */}

            {/* Изменение среднего чека по оправам и линзам */}
            <Section
              tone="money"
              title={
                <span className="inline-flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
                    <LineChart className="h-4 w-4" />
                  </div>
                  Изменение среднего чека
                </span>
              }
              aside={
                <span className="text-xs text-slate-600/80">
                  Оправы и линзы, динамика по{' '}
                  {avgCheckGran === 'day' ? 'дням' : avgCheckGran === 'week' ? 'неделям' : 'месяцам'} (по{' '}
                  {revenueMode === 'gross' ? 'выручке' : 'поступлениям'})
                </span>
              }
            >
              {avgCheckTrend.length > 0 ? (
                <ChartFrame height={360}>
                  <ReactECharts
                    option={optionAvgCheckTrend}
                    lazyUpdate
                    notMerge
                    opts={{ renderer: 'svg' }}
                    style={{ height: '100%', width: '100%' }}
                  />
                </ChartFrame>
              ) : (
                <div className="flex h-[180px] items-center justify-center text-sm text-slate-500">
                  {loading ? 'Загрузка…' : 'Нет данных за период'}
                </div>
              )}
            </Section>

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

            {/* Производительность: SPLH + ФОТ/выручка */}
            <Section
              tone="money"
              title={
                <span className="inline-flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
                    <Timer className="h-4 w-4" />
                  </div>
                  Производительность: выручка на час и ФОТ
                </span>
              }
              aside={<span className="text-xs text-slate-600/80">SPLH = выручка / трудочас · ФОТ брутто (до налогов сотрудника)</span>}
            >
              <div className="mb-4 grid gap-4 md:grid-cols-2">
                <StatBox label="Выручка на трудочас (выбранные)" value={`${nf(splhTotals.splh)} сом`} icon={TrendingUp} tone="neutral" />
                <StatBox label="ФОТ / выручка" value={`${splhTotals.lcr}%`} icon={Percent} tone={splhTotals.lcr > 25 ? 'warn' : 'ok'} />
              </div>
              <ChartFrame height={340}>
                <ReactECharts option={optionSplh} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
              </ChartFrame>
              <div className="mt-4">
                <GlassTable>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50/80 text-slate-600">
                      <tr>
                        <Th>Филиал</Th>
                        <ThRight>Выручка</ThRight>
                        <ThRight>Часы</ThRight>
                        <ThRight>Выручка / час</ThRight>
                        <ThRight>ФОТ / выручка</ThRight>
                      </tr>
                    </thead>
                    <tbody>
                      {[...splh].sort((a, b) => b.splh - a.splh).map((r) => (
                        <tr key={r.branch} className="odd:bg-white even:bg-slate-50/60">
                          <td className="px-3 py-2 font-medium text-slate-800">{r.branch}</td>
                          <td className="px-3 py-2 text-right">{nf(r.revenue)}</td>
                          <td className="px-3 py-2 text-right">{nf(r.hours)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-900">{nf(r.splh)}</td>
                          <td className={'px-3 py-2 text-right font-semibold ' + (r.lcr > 25 ? 'text-rose-600' : 'text-slate-900')}>{r.lcr}%</td>
                        </tr>
                      ))}
                      {splh.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-slate-500">Нет данных за период</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </GlassTable>
              </div>
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
                <ChartFrame height={560} title="По видам линз" icon={BarChart3}>
                  <ReactECharts option={optionLensTypes} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
                </ChartFrame>

                <ChartFrame height={560} title="По диоптриям (SPH)" icon={BarChart3}>
                  <ReactECharts option={optionLensSphRanges} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
                </ChartFrame>
              </div>
            </Section>

            {/* Маржа по видам линз */}
            <Section
              tone="money"
              title={
                <span className="inline-flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
                    <HandCoins className="h-4 w-4" />
                  </div>
                  Маржа по видам линз
                </span>
              }
              aside={<span className="text-xs text-slate-600/80">Себестоимость из каталога · только линзы (оправы не учитываются)</span>}
            >
              <div className="mb-4 grid gap-4 md:grid-cols-3">
                <StatBox label="Выручка по линзам" value={nf(lensMarginView.totalRevenue)} icon={HandCoins} tone="neutral" />
                <StatBox label="Маржа по линзам" value={nf(lensMarginView.totalMargin)} icon={TrendingUp} tone="ok" />
                <StatBox label="Средняя маржа" value={`${Math.round(lensMarginView.avgMarginPct)}%`} icon={Percent} tone="neutral" />
              </div>
              <ChartFrame height={380}>
                <ReactECharts option={optionLensMargin} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
              </ChartFrame>
              <div className="mt-4">
                <GlassTable>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50/80 text-slate-600">
                      <tr>
                        <Th>Вид линзы</Th>
                        <ThRight>Шт</ThRight>
                        <ThRight>Выручка</ThRight>
                        <ThRight>Маржа</ThRight>
                        <ThRight>Маржа %</ThRight>
                        <ThRight>Доля в марже</ThRight>
                      </tr>
                    </thead>
                    <tbody>
                      {lensMarginView.rows.map((r) => (
                        <tr key={r.name} className="odd:bg-white even:bg-slate-50/60">
                          <td className="px-3 py-2 font-medium text-slate-800">
                            {r.name}
                            {r.proxy && <span className="text-slate-400" title="Себестоимость оценочная — ближайший аналог в каталоге"> *</span>}
                          </td>
                          <td className="px-3 py-2 text-right">{nf(r.units)}</td>
                          <td className="px-3 py-2 text-right">{nf(r.revenue)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-900">{nf(Math.round(r.margin))}</td>
                          <td className="px-3 py-2 text-right">{Math.round(r.marginPct)}%</td>
                          <td className="px-3 py-2 text-right">{r.share.toFixed(1)}%</td>
                        </tr>
                      ))}
                      {lensMarginView.rows.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-6 text-center text-slate-500">Нет данных за период</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </GlassTable>
                {lensMarginView.rows.some((r) => r.proxy) && (
                  <div className="mt-2 text-[11px] text-slate-500">
                    * себестоимость взята с ближайшего аналога в каталоге (нет точного совпадения вида).
                  </div>
                )}
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
                  Распределение чеков: оправы и линзы
                </span>
              }
              aside={<span className="text-xs text-slate-600/80">Кривые по корзинам сумм (по {revenueMode === 'gross' ? 'выручке' : 'поступлениям'})</span>}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <ChartFrame height={340} title="Чеки по оправам" icon={BarChart3}>
                  <ReactECharts option={optionFrameBins} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
                </ChartFrame>
                <ChartFrame height={340} title="Чеки по линзам" icon={BarChart3}>
                  <ReactECharts option={optionLensBins} opts={{ renderer: 'svg' }} style={{ height: '100%', width: '100%' }} />
                </ChartFrame>
              </div>
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
    <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-sky-100">
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
  iconTone = 'money',
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ElementType;
  accent?: string; // принимается для совместимости вызовов; визуал задаёт iconTone
  danger?: boolean;
  iconTone?: 'money' | 'danger' | 'violet' | 'neutral';
}) {
  const Icon = icon;
  const iconBg =
    iconTone === 'danger' ? 'bg-rose-500 shadow-[0_4px_16px_rgba(244,63,94,0.28)]' :
    iconTone === 'violet' ? 'bg-violet-500 shadow-[0_4px_16px_rgba(139,92,246,0.28)]' :
                            'bg-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.28)]';

  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] transition hover:ring-cyan-300/40">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className={`grid h-10 w-10 place-items-center rounded-2xl text-white ${iconBg}`}>
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

/** Подпись-группа фильтра: маленький заголовок над контролом. */
function FilterGroup({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </div>
  );
}

/**
 * Поле даты с НАДЁЖНЫМ открытием календаря: клик по полю или по иконке вызывает
 * native showPicker() (Chrome/Edge/Electron). Раньше декоративная иконка с
 * pointer-events-none перекрывала системный индикатор и календарь не открывался.
 */
function DateField({
  value,
  onChange,
  min,
  max,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  ariaLabel?: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const openPicker = () => {
    const el = ref.current;
    if (!el) return;
    try {
      (el as any).showPicker?.();
    } catch {
      el.focus();
    }
  };
  return (
    <div className="relative">
      <input
        ref={ref}
        type="date"
        aria-label={ariaLabel}
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        onClick={openPicker}
        className="w-full min-w-[120px] sm:w-[150px] cursor-pointer rounded-xl bg-white px-3 py-2.5 pr-9 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-y-0 [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:w-9 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={openPicker}
        className="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition hover:bg-cyan-50 hover:text-cyan-600"
      >
        <CalendarDays className="h-4 w-4" />
      </button>
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
  loading = false,
  className = '',
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void | Promise<void>;
  icon?: React.ElementType;
  loading?: boolean;
  className?: string;
}) {
  const Icon = icon;

  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={() => void onClick?.()}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-cyan-300/70',
        className,
      ].join(' ')}
    >
      {Icon && <Icon className={['h-4 w-4', loading ? 'animate-spin' : ''].join(' ')} />}
      {children}
    </button>
  );
}

function SoftGhostButton({
  children,
  onClick,
  icon,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void | Promise<void>;
  icon?: React.ElementType;
  title?: string;
}) {
  const Icon = icon;
  return (
    <button
      type="button"
      onClick={() => void onClick?.()}
      title={title}
      className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-300/70"
    >
      {Icon && <Icon className="h-4 w-4 text-cyan-600" />}
      {children}
    </button>
  );
}
