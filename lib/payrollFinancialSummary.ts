export type PayrollFinancialDay = {
  day: string;
  branch_id: number;
  hours: number;
  hour_pay: number;
  bonus: number;
  penalties: number;
  net_day: number;
  management_day?: number;
};

const DAY_MS = 86_400_000;
const DAYS_PER_REQUEST = 60;
const PARALLEL_REQUESTS = 2;
const RPC_ROW_LIMIT = 1000;

const isoDate = (date: number) => new Date(date).toISOString().slice(0, 10);

async function fetchPayrollRange(
  start: number,
  end: number,
  branchIds: number[] | null,
): Promise<PayrollFinancialDay[]> {
  const response = await fetch('/api/manager/rpc/crm_manager_payroll_by_day', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify({ p_from: isoDate(start), p_to: isoDate(end), p_branch_ids: branchIds }),
  });
  const data = await response.json().catch(() => null);
  const timedOut = !response.ok && data?.code === '57014';
  const reachedRowLimit = response.ok && Array.isArray(data) && data.length >= RPC_ROW_LIMIT;
  if (timedOut || reachedRowLimit) {
    if (start === end) throw new Error(`Не удалось полностью загрузить расходы на персонал за ${isoDate(start)}`);
    const middle = start + Math.floor((end - start) / DAY_MS / 2) * DAY_MS;
    const first = await fetchPayrollRange(start, middle, branchIds);
    const second = await fetchPayrollRange(middle + DAY_MS, end, branchIds);
    return first.concat(second);
  }
  if (!response.ok) throw new Error(data?.message || 'Не удалось загрузить расходы на персонал');
  if (!Array.isArray(data)) throw new Error('Некорректный ответ расчёта расходов на персонал');
  return data as PayrollFinancialDay[];
}

export async function fetchPayrollFinancialSummary(
  from: string,
  to: string,
  branchIds: number[] | null,
): Promise<PayrollFinancialDay[]> {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || isoDate(start) !== from || isoDate(end) !== to) {
    throw new Error('Некорректный период расчёта расходов на персонал');
  }

  const ranges: { start: number; end: number }[] = [];
  for (let date = start; date <= end; date += DAYS_PER_REQUEST * DAY_MS) {
    ranges.push({ start: date, end: Math.min(end, date + (DAYS_PER_REQUEST - 1) * DAY_MS) });
  }

  // The RPC returns one aggregate per day and branch. Disjoint inclusive
  // ranges preserve both payroll and management accruals without truncation.
  const rows: PayrollFinancialDay[] = [];
  for (let i = 0; i < ranges.length; i += PARALLEL_REQUESTS) {
    const group = await Promise.all(ranges.slice(i, i + PARALLEL_REQUESTS).map(range =>
      fetchPayrollRange(range.start, range.end, branchIds),
    ));
    for (const days of group) rows.push(...days);
  }
  return rows;
}
