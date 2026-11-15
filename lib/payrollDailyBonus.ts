/** A dated ledger credit stays in the monthly adjustment total. This metadata
 * only allocates it to a day and a week; it never creates a sale or payment. */
export type PayrollBonusAdjustment = {
  id: number | string;
  employee_id: number | string;
  branch_id: number | string;
  period: string;
  amount: number | string;
  kind: string;
  reason: string;
};

export type DatedPayrollBonus = {
  id: number;
  employee_id: number;
  branch_id: number;
  day: string;
  amount: number;
  reason: string;
};

export type PayrollBonusDay = {
  employee_id: number;
  full_name: string;
  branch_id: number;
  day: string;
  hours: number;
  hourly_rate: number;
  hour_pay: number;
  paid_sum: number;
  bonus_percent: number;
  bonus: number;
  penalties: number;
  social_fund_day: number;
  income_tax_day: number;
  net_day: number;
  plan_premium?: number;
  dated_bonus?: number;
  dated_bonus_reason?: string;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function datedPayrollBonuses(
  adjustments: PayrollBonusAdjustment[],
  from: string,
  endExclusive: string,
): DatedPayrollBonus[] {
  const result: DatedPayrollBonus[] = [];
  const seen = new Set<number>();
  for (const row of adjustments) {
    if (row.kind !== 'bonus') continue;
    const markers = [...String(row.reason || '').matchAll(/\[payroll_day:(\d{4}-\d{2}-\d{2})\]/g)];
    // An explicit marker also permits a daily bonus on the first of a month;
    // unmarked existing bonuses keep their original monthly meaning.
    if (markers.length !== 1) continue;
    const day = markers[0][1];
    if (!validDate(day) || day !== row.period || day < from || day >= endExclusive) continue;
    const id = Number(row.id), employeeId = Number(row.employee_id), branchId = Number(row.branch_id);
    const amount = Number(row.amount);
    if (![id, employeeId, branchId].every(value => Number.isSafeInteger(value) && value > 0)
      || !Number.isFinite(amount) || amount === 0 || seen.has(id)) continue;
    seen.add(id);
    result.push({
      id, employee_id: employeeId, branch_id: branchId, day, amount: roundMoney(amount),
      reason: String(row.reason || '').replace(/\[payroll_day:[^\]]*\]/g, '').replace(/\[owner_[^\]]*\]/g, '').trim(),
    });
  }
  return result;
}

export function addDatedBonusesToPeriod(
  source: Map<string, number>,
  bonuses: DatedPayrollBonus[],
): Map<string, number> {
  const result = new Map(source);
  for (const bonus of bonuses) {
    const key = String(bonus.employee_id);
    result.set(key, roundMoney((result.get(key) || 0) + bonus.amount));
  }
  return result;
}

export function unallocatedMonthlyAdjustments(
  monthlyTotal: number,
  monthBonuses: DatedPayrollBonus[],
  employeeId: number,
): number {
  return roundMoney(monthlyTotal - monthBonuses
    .filter(bonus => bonus.employee_id === employeeId)
    .reduce((sum, bonus) => sum + bonus.amount, 0));
}

export function allocateDatedBonuses(
  source: PayrollBonusDay[],
  bonuses: DatedPayrollBonus[],
  employeeId: number,
  fullName: string,
): { days: PayrollBonusDay[]; allocatedAmount: number } {
  const days = source.map(row => ({ ...row }));
  const byDay = new Map(days.map(row => [`${row.employee_id}:${row.branch_id}:${row.day}`, row]));
  let allocatedAmount = 0;
  for (const bonus of bonuses) {
    if (bonus.employee_id !== employeeId) continue;
    const key = `${bonus.employee_id}:${bonus.branch_id}:${bonus.day}`;
    let day = byDay.get(key);
    if (!day) {
      day = {
        employee_id: employeeId, full_name: fullName, branch_id: bonus.branch_id, day: bonus.day,
        hours: 0, hourly_rate: 0, hour_pay: 0, paid_sum: 0, bonus_percent: 0,
        bonus: 0, penalties: 0, social_fund_day: 0, income_tax_day: 0, net_day: 0, plan_premium: 0,
      };
      days.push(day);
      byDay.set(key, day);
    }
    day.bonus = roundMoney(Number(day.bonus || 0) + bonus.amount);
    day.net_day = roundMoney(Number(day.net_day || 0) + bonus.amount);
    day.dated_bonus = roundMoney(Number(day.dated_bonus || 0) + bonus.amount);
    day.dated_bonus_reason = [day.dated_bonus_reason, bonus.reason].filter(Boolean).join('\n');
    allocatedAmount = roundMoney(allocatedAmount + bonus.amount);
  }
  days.sort((a, b) => a.day.localeCompare(b.day) || a.branch_id - b.branch_id);
  return { days, allocatedAmount };
}
