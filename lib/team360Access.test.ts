import assert from 'node:assert/strict';
import test from 'node:test';
import { managerTeamMetrics, teamPeriod } from './team360Access';

test('manager team metrics omit private fields and future unknown additions', () => {
  const result = managerTeamMetrics({
    employee_id: 42, full_name: 'Продавец', branch_name: 'Токмок', orders_count: 7,
    revenue_total: '21000.00', avg_check: '3000.00', wa_avg_score: null,
    hours_worked: 54, sessions_count: 6, late_minutes_total: 15, afk_minutes_total: 20,
    penalty_count: 1, bonus_amount: 2000, fine_amount: 500,
    phone: 'private', login: 'private', passport: { number: 'private' },
    future_payroll_field: { salary: 50000 }, app_exits_count: 3, feedback_avg_mood: 2,
  });
  assert.equal(result.employee_id, 42);
  assert.equal(result.revenue_total, '21000.00');
  assert.equal(result.wa_avg_score, null);
  for (const field of ['hours_worked', 'sessions_count', 'late_minutes_total', 'afk_minutes_total',
    'penalty_count', 'bonus_amount', 'fine_amount', 'phone', 'login', 'passport',
    'future_payroll_field', 'app_exits_count', 'feedback_avg_mood']) {
    assert.equal(Object.hasOwn(result, field), false, field);
  }
});

test('team period ends immediately after the selected last day', () => {
  assert.deepEqual(teamPeriod('2026-11-01', '2026-11-09'), {
    from: '2026-11-01', to: '2026-11-09',
    fromIso: '2026-11-01T00:00:00Z', toIso: '2026-11-10T00:00:00.000Z',
  });
  assert.equal(teamPeriod('2026-02-30', '2026-03-01'), null);
  assert.equal(teamPeriod('2026-11-09', '2026-11-01'), null);
  assert.equal(teamPeriod(null, '2026-11-09'), null);
  assert.equal(teamPeriod({} as never, '2026-11-09'), null);
});
