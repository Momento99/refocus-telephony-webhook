// lib/adminStats.ts
import getSupabase from '@/lib/supabaseClient'

/* ========= types ========= */
export type BranchRow = {
  branch: string
  ov_orders: number
  sd_orders: number
  ov_revenue: number
  sd_revenue: number
}

export type PaymentsBreakdownRow = {
  method: string
  cnt: number
  sum: number
}

export type StatusCountRow = { status: string; cnt: number }

export type RevInflowRow = {
  day: string // YYYY-MM-DD
  revenue: number
  inflow: number
  debt: number
}

export type HeatRow = { dow: number; hh: number; orders_cnt: number; revenue_sum: number }
export type CheckBinRow = { from_amt: number; to_amt: number; cnt: number }
export type RefundRow = { day: string; refunds_cnt: number; refunds_sum: number }

/** Клиенты */
export type NewReturningRow = {
  new_customers: number
  returning_customers: number
  customers_total: number
  returning_share: number // 0..1
}
export type AvgMedianCheck = { avg_check: number; median_check: number }

/** Демография — универсальная вьюшка */
export type DemUnifiedRow = {
  metric: 'gender_share' | 'age_buckets' | 'age_years' | 'age_summary' | 'totals'
  d1: string | null
  d2: string | null
  value: number | string
}

/** Серия по возрастам: один ряд на пол */
export type AgeSeriesRow = {
  age: number      // 3..90
  gender: 'Муж' | 'Жен'
  orders_cnt: number
}

/** Структура линз */
export type LensStructRow = {
  lens_family: string
  items_cnt: number
  revenue_sum: number
}

/** Чистая прибыль по дням */
export type NetProfitRow = {
  day: string
  orders_count: number
  income: number
  refunds: number
  opex_total: number
  cogs_total: number
  payroll_total: number
  net_profit: number
}

/* ========= helpers ========= */
const toNum = (v: any) => (typeof v === 'number' ? v : Number(v ?? 0))

function normalizeDates(from: string, to: string): [string, string] {
  const onlyDate = (s: string) => {
    if (!s) return new Date().toISOString().slice(0, 10)
    const m = String(s).match(/^(\d{4}-\d{2}-\d{2})/)
    if (m) return m[1]
    const d = new Date(s)
    return isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10)
  }
  let f = onlyDate(from)
  let t = onlyDate(to)
  if (f > t) [f, t] = [t, f]
  return [f, t]
}

const toTextArray = (arr?: string[] | null) => (!arr || arr.length === 0 ? null : arr)

async function callRpc<T>(fn: string, params: Record<string, any>) {
  const sb = getSupabase()
  const { data, error } = await sb.rpc(fn, params)
  if (error) throw new Error(`[${fn}] ${error.message}`)
  return (data ?? []) as T[]
}

/* ========= RPC wrappers ========= */

export async function rpcPeriodByBranch(from: string, to: string, branches: string[] = []) {
  const [f, t] = normalizeDates(from, to)
  const rows = await callRpc<BranchRow>('admin_period_by_branch', {
    from_dt: f,
    to_dt: t,
    branches: toTextArray(branches),
  })
  return rows.map((r) => ({
    branch: r.branch,
    ov_orders: toNum(r.ov_orders),
    sd_orders: toNum(r.sd_orders),
    ov_revenue: toNum(r.ov_revenue),
    sd_revenue: toNum(r.sd_revenue),
  }))
}

export async function rpcPaymentsBreakdown(from: string, to: string, branches: string[] = []) {
  const [f, t] = normalizeDates(from, to)
  const rows = await callRpc<PaymentsBreakdownRow>('admin_payments_breakdown', {
    from_dt: f,
    to_dt: t,
    branches: toTextArray(branches),
  })
  return rows.map((r) => ({ method: r.method, cnt: toNum(r.cnt), sum: toNum(r.sum) }))
}

export async function rpcStatusCounts(from: string, to: string, branches: string[] = []) {
  const [f, t] = normalizeDates(from, to)
  const rows = await callRpc<StatusCountRow>('admin_status_counts', {
    from_dt: f,
    to_dt: t,
    branches: toTextArray(branches),
  })
  return rows.map((r) => ({ status: r.status, cnt: toNum(r.cnt) }))
}

export async function rpcRevenueInflowByDay(from: string, to: string, branches: string[] = []) {
  const [f, t] = normalizeDates(from, to)
  const rows = await callRpc<RevInflowRow>('admin_revenue_inflow_by_day', {
    from_dt: f,
    to_dt: t,
    branches: toTextArray(branches),
  })
  return rows.map((r) => ({
    day: r.day,
    revenue: toNum(r.revenue),
    inflow: toNum(r.inflow),
    debt: toNum(r.debt),
  }))
}

export async function rpcHeatmap(from: string, to: string, branches: string[] = []) {
  const [f, t] = normalizeDates(from, to)
  const rows = await callRpc<HeatRow>('admin_heatmap_dow_hour', {
    from_dt: f,
    to_dt: t,
    branches: toTextArray(branches),
  })
  return rows.map((r) => ({
    dow: toNum(r.dow),
    hh: toNum(r.hh),
    orders_cnt: toNum(r.orders_cnt),
    revenue_sum: toNum(r.revenue_sum),
  }))
}

export async function rpcCheckHistogram(
  from: string,
  to: string,
  bucket = 200,
  max = 30000,
  branches: string[] = [],
) {
  const [f, t] = normalizeDates(from, to)
  const rows = await callRpc<CheckBinRow>('admin_check_histogram', {
    from_dt: f,
    to_dt: t,
    bucket_kgs: bucket,
    max_kgs: max,
    branches: toTextArray(branches),
  })
  return rows.map((r) => ({
    from_amt: toNum(r.from_amt),
    to_amt: toNum(r.to_amt),
    cnt: toNum(r.cnt),
  }))
}

export async function rpcRefundsByDay(from: string, to: string, branches: string[] = []) {
  const [f, t] = normalizeDates(from, to)
  const rows = await callRpc<RefundRow>('admin_refunds_by_day', {
    from_dt: f,
    to_dt: t,
    branches: toTextArray(branches),
  })
  return rows.map((r) => ({
    day: r.day,
    refunds_cnt: toNum(r.refunds_cnt),
    refunds_sum: toNum(r.refunds_sum),
  }))
}

/* ======== Клиентские метрики ======== */

export async function rpcNewVsReturning(from: string, to: string, branches: string[] = []) {
  const [f, t] = normalizeDates(from, to)
  const rows = await callRpc<NewReturningRow>('admin_new_vs_returning', {
    from_dt: f,
    to_dt: t,
    branches: toTextArray(branches),
  })
  const r = rows[0] || {
    new_customers: 0,
    returning_customers: 0,
    customers_total: 0,
    returning_share: 0,
  }
  return {
    new_customers: toNum(r.new_customers),
    returning_customers: toNum(r.returning_customers),
    customers_total: toNum(r.customers_total),
    returning_share: Number(r.returning_share ?? 0),
  } as NewReturningRow
}

export async function rpcAvgIntervalDays(from: string, to: string, branches: string[] = []) {
  const [f, t] = normalizeDates(from, to)
  const rows = await callRpc<{ avg_interval_days: number }>('admin_avg_interval_days', {
    from_dt: f,
    to_dt: t,
    branches: toTextArray(branches),
  })
  return toNum(rows[0]?.avg_interval_days)
}

export async function rpcAvgMedianCheck(from: string, to: string, branches: string[] = []) {
  const [f, t] = normalizeDates(from, to)
  const rows = await callRpc<AvgMedianCheck>('admin_avg_median_check', {
    from_dt: f,
    to_dt: t,
    branches: toTextArray(branches),
  })
  const r = rows[0] || { avg_check: 0, median_check: 0 }
  return { avg_check: toNum(r.avg_check), median_check: toNum(r.median_check) }
}

/* ======== Демография: единая вьюшка ======== */
export async function qDemographyUnified(): Promise<DemUnifiedRow[]> {
  const sb = getSupabase()
  const { data, error } = await sb.from('stats_customers_unified').select('*')
  if (error) throw new Error(`[stats_customers_unified] ${error.message}`)
  return (data ?? []) as DemUnifiedRow[]
}

/* ======== Возрастная серия: Муж/Жен по годам ======== */
export async function rpcAgeGenderSeries(
  from: string,
  to: string,
  branches: string[] = []
): Promise<AgeSeriesRow[]> {
  const [f, t] = normalizeDates(from, to)
  const rows = await callRpc<AgeSeriesRow>('admin_age_orders_by_year', {
    from_dt: f,
    to_dt: t,
    branches: toTextArray(branches),
  })
  return rows.map((r) => ({
    age: toNum(r.age),
    gender: (r.gender === 'Муж' ? 'Муж' : 'Жен') as 'Муж' | 'Жен',
    orders_cnt: toNum(r.orders_cnt),
  }))
}

/* ======== Структура линз ======== */
export async function rpcLensStructure(
  from: string,
  to: string,
  branches: string[] = []
) {
  const [f, t] = normalizeDates(from, to)
  const rows = await callRpc<LensStructRow>('admin_lens_structure', {
    from_dt: f,
    to_dt: t,
    branches: toTextArray(branches),
  })
  return rows.map(r => ({
    lens_family: r.lens_family,
    items_cnt: toNum(r.items_cnt),
    revenue_sum: Number(r.revenue_sum ?? 0),
  }))
}

/* ======== Чистая прибыль по дням ======== */
export async function rpcNetProfitByDay(
  from: string,
  to: string,
  branches: string[] = []
) {
  const [f, t] = normalizeDates(from, to)
  const rows = await callRpc<NetProfitRow>('admin_net_profit_by_day', {
    from_dt: f,
    to_dt: t,
    branches: toTextArray(branches),
  })
  return rows.map(r => ({
    day: r.day,
    orders_count: toNum(r.orders_count),
    income: toNum(r.income),
    refunds: toNum(r.refunds),
    opex_total: toNum(r.opex_total),
    cogs_total: toNum(r.cogs_total),
    payroll_total: toNum(r.payroll_total),
    net_profit: toNum(r.net_profit),
  }))
}

/* Алиас под старое имя, используемое на странице */
export { rpcAgeGenderSeries as rpcAgeByYear }
