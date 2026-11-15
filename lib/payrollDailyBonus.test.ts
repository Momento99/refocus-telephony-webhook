import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDatedBonusesToPeriod, allocateDatedBonuses, datedPayrollBonuses, unallocatedMonthlyAdjustments,
  type PayrollBonusAdjustment, type PayrollBonusDay } from './payrollDailyBonus';

const adjustment = (patch: Partial<PayrollBonusAdjustment> = {}): PayrollBonusAdjustment => ({
  id: 2, employee_id: 35, branch_id: 1, period: '2026-11-12', amount: 560.66,
  kind: 'bonus', reason: 'Бонус за 3 заказа [payroll_day:2026-11-12] [owner_test]', ...patch,
});
const day = (patch: Partial<PayrollBonusDay> = {}): PayrollBonusDay => ({
  employee_id: 35, full_name: 'Светлана', branch_id: 1, day: '2026-11-12', hours: 8,
  hourly_rate: 125, hour_pay: 1000, paid_sum: 0, bonus_percent: 7, bonus: 0,
  penalties: 0, social_fund_day: 66.67, income_tax_day: 40, net_day: 893.33, ...patch,
});

test('allocation moves a ledger credit into its daily bonus without duplicating monthly pay', () => {
  const source = [day()];
  const bonuses = datedPayrollBonuses([adjustment()], '2026-11-01', '2026-12-01');
  const result = allocateDatedBonuses(source, bonuses, 35, 'Светлана');
  assert.equal(result.days[0].bonus, 560.66);
  assert.equal(result.days[0].net_day, 1453.99);
  assert.equal(source[0].bonus, 0, 'canonical rows remain unchanged');
  const monthlyAdjustment = 560.66;
  assert.equal(Math.round((result.days[0].net_day + monthlyAdjustment - result.allocatedAmount) * 100),
    Math.round((source[0].net_day + monthlyAdjustment) * 100));
  assert.equal(result.days[0].dated_bonus_reason, 'Бонус за 3 заказа');
  const week = addDatedBonusesToPeriod(new Map([['35', 3000]]), bonuses);
  assert.equal(week.get('35'), 3560.66);
});

test('same date in another branch and another employee do not receive the credit', () => {
  const rows = [day({ branch_id: 2, bonus: 50 }), day({ employee_id: 39, bonus: 80 })];
  const bonus = datedPayrollBonuses([adjustment()], '2026-11-01', '2026-12-01');
  const result = allocateDatedBonuses(rows, bonus, 35, 'Светлана');
  assert.equal(result.days.find(d => d.employee_id === 35 && d.branch_id === 2)?.bonus, 50);
  assert.equal(result.days.find(d => d.employee_id === 39)?.bonus, 80);
  const created = result.days.find(d => d.employee_id === 35 && d.branch_id === 1)!;
  assert.equal(created.bonus, 560.66);
  assert.equal(created.net_day, 560.66);
  assert.equal(created.hours + created.hour_pay + created.paid_sum + created.social_fund_day + created.income_tax_day, 0);
});

test('cross-month weeks include both tails, first-day marked credits, and negative corrections', () => {
  const rows = [
    adjustment({ id: 1, period: '2026-10-31', amount: 100, reason: '[payroll_day:2026-10-31]' }),
    adjustment({ id: 2, period: '2026-11-01', amount: 40, reason: '[payroll_day:2026-11-01]' }),
    adjustment({ id: 3, period: '2026-11-02', amount: -20, reason: '[payroll_day:2026-11-02]' }),
    adjustment({ id: 4, period: '2026-11-01', amount: 400, reason: 'Monthly bonus' }),
  ];
  assert.equal(datedPayrollBonuses(rows, '2026-10-26', '2026-11-02').reduce((s, r) => s + r.amount, 0), 140);
  assert.equal(datedPayrollBonuses(rows, '2026-11-01', '2026-12-01').reduce((s, r) => s + r.amount, 0), 20);
  const negative = datedPayrollBonuses(rows, '2026-11-02', '2026-11-09');
  assert.equal(addDatedBonusesToPeriod(new Map([['35', 100]]), negative).get('35'), 80);
});

test('unmarked, mismatched, malformed and duplicate ledger rows never inflate a daily credit', () => {
  const valid = adjustment();
  const rows = [valid, valid,
    adjustment({ id: 3, reason: 'Monthly bonus' }),
    adjustment({ id: 4, period: '2026-11-01' }),
    adjustment({ id: 5, reason: '[payroll_day:2026-11-31]', period: '2026-11-31' }),
    adjustment({ id: 6, amount: 'NaN' }),
    adjustment({ id: 7, kind: 'fine' }),
    adjustment({ id: 8, reason: '[payroll_day:2026-11-12] [payroll_day:2026-11-13]' }),
  ];
  assert.deepEqual(datedPayrollBonuses(rows, '2026-11-01', '2026-12-01').map(r => r.id), [2]);
});

test('weekly details retain undated monthly adjustments but never inherit other weeks marked credits', () => {
  const rows = [adjustment(),
    adjustment({ id: 3, period: '2026-11-20', amount: 100, reason: '[payroll_day:2026-11-20]' }),
    adjustment({ id: 4, period: '2026-11-01', amount: 300, reason: 'Monthly premium' }),
  ];
  const monthlyTotal = 960.66;
  const monthBonuses = datedPayrollBonuses(rows, '2026-11-01', '2026-12-01');
  const weekBonuses = datedPayrollBonuses(rows, '2026-11-09', '2026-11-16');
  assert.equal(unallocatedMonthlyAdjustments(monthlyTotal, monthBonuses, 35), 300);
  assert.equal(addDatedBonusesToPeriod(new Map([['35', 0]]), weekBonuses).get('35'), 560.66);
  const emptyWeek = datedPayrollBonuses(rows, '2026-11-02', '2026-11-09');
  assert.equal(emptyWeek.length, 0);
  assert.equal(unallocatedMonthlyAdjustments(monthlyTotal, monthBonuses, 35), 300);
});
