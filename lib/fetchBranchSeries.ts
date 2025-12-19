// /lib/fetchBranchSeries.ts
import getSupabase from '@/lib/supabaseClient';

export const BRANCHES = [
  'Кант',
  'Кара-Балта',
  'Беловодск',
  'Сокулук (мастерская)',
] as const;
export type BranchName = (typeof BRANCHES)[number];

export const BRANCH_COLORS: Record<BranchName, string> = {
  'Кант': '#0ea5e9',                 // sky-500
  'Кара-Балта': '#22c55e',           // green-500
  'Беловодск': '#a855f7',            // purple-500
  'Сокулук (мастерская)': '#f59e0b', // amber-500
};

function fmtISO(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(d: Date, days: number) { const x = new Date(d); x.setDate(x.getDate() + days); return x; }
function monthStart(date: Date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function monthEnd(date: Date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0); }

type RawRow = { day: string; branch_name: string; revenue: number };

// Месяц: по дням, нули в пропусках
export async function fetchMonthDailyByBranch(
  monthDate: Date = new Date(),
  onlyBranches?: BranchName[],
) {
  const sb = getSupabase();
  const from = monthStart(monthDate);
  const to = monthEnd(monthDate);
  const { data, error } = await sb
    .from('stats_daily')
    .select('day,branch_name,revenue')
    .gte('day', fmtISO(from))
    .lte('day', fmtISO(to));
  if (error) throw error;
  const rows = (data as RawRow[]) ?? [];

  const active = (onlyBranches?.length ? onlyBranches : BRANCHES) as BranchName[];

  const bucket: Record<string, Record<string, number>> = {};
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    const key = fmtISO(d);
    bucket[key] = {};
    active.forEach(b => { bucket[key][b] = 0; });
  }
  for (const r of rows) {
    if (!active.includes(r.branch_name as BranchName)) continue;
    if (!bucket[r.day]) continue;
    bucket[r.day][r.branch_name] += Number(r.revenue || 0);
  }
  const out = Object.keys(bucket).sort().map(day => {
    const row: any = { day, total: 0 };
    for (const b of active) {
      const v = bucket[day][b] || 0;
      row[b] = v; row.total += v;
    }
    return row;
  });
  return { series: out, branches: active };
}

// Год: по месяцам, нули в пропусках
export async function fetchYearMonthlyByBranch(
  year = new Date().getFullYear(),
  onlyBranches?: BranchName[],
) {
  const sb = getSupabase();
  const from = new Date(year, 0, 1);
  const to = new Date(year, 11, 31);

  const { data, error } = await sb
    .from('stats_daily')
    .select('day,branch_name,revenue')
    .gte('day', fmtISO(from))
    .lte('day', fmtISO(to));
  if (error) throw error;
  const rows = (data as RawRow[]) ?? [];

  const active = (onlyBranches?.length ? onlyBranches : BRANCHES) as BranchName[];
  const monthKey = (d: string) => d.slice(0, 7);

  const bucket: Record<string, Record<string, number>> = {};
  for (let m = 0; m < 12; m++) {
    const k = `${year}-${String(m + 1).padStart(2, '0')}`;
    bucket[k] = {}; active.forEach(b => { bucket[k][b] = 0; });
  }
  for (const r of rows) {
    const k = monthKey(r.day);
    if (!bucket[k]) continue;
    if (!active.includes(r.branch_name as BranchName)) continue;
    bucket[k][r.branch_name] += Number(r.revenue || 0);
  }
  const out = Object.keys(bucket).sort().map(period => {
    const row: any = { period, total: 0 };
    for (const b of active) {
      const v = bucket[period][b] || 0;
      row[b] = v; row.total += v;
    }
    return row;
  });
  return { series: out, branches: active };
}
