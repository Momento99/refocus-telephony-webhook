import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPayrollFinancialSummary } from './payrollFinancialSummary';

type Range = { p_from: string; p_to: string; p_branch_ids: number[] | null };

test('loads a long range in contiguous, inclusive requests and keeps the branch filter', async (t) => {
  const requests: Range[] = [];
  let active = 0;
  let peak = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const range = JSON.parse(String(init.body)) as Range;
    requests.push(range);
    peak = Math.max(peak, ++active);
    await new Promise<void>(resolve => setImmediate(resolve));
    active--;
    return Response.json([{ day: range.p_from, branch_id: 3, net_day: 100, management_day: 10 }]);
  });

  const rows = await fetchPayrollFinancialSummary('2025-11-15', '2026-03-15', [3]);
  assert.deepEqual(requests, [
    { p_from: '2025-11-15', p_to: '2026-01-13', p_branch_ids: [3] },
    { p_from: '2026-01-14', p_to: '2026-03-14', p_branch_ids: [3] },
    { p_from: '2026-03-15', p_to: '2026-03-15', p_branch_ids: [3] },
  ]);
  assert.equal(peak, 2);
  assert.deepEqual(rows.map(row => [row.day, row.net_day, row.management_day]),
    requests.map(range => [range.p_from, 100, 10]));
});

for (const failure of ['timeout', 'row limit'] as const) {
  test(`splits a range that hits the ${failure} without using a partial result`, async (t) => {
    const requests: Range[] = [];
    t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      const range = JSON.parse(String(init.body)) as Range;
      requests.push(range);
      if (range.p_from !== range.p_to) {
        return failure === 'timeout'
          ? Response.json({ code: '57014' }, { status: 400 })
          : Response.json(Array.from({ length: 1000 }, () => ({ day: range.p_from, net_day: 999 })));
      }
      return Response.json([{ day: range.p_from, branch_id: 1, net_day: 100 }]);
    });

    const rows = await fetchPayrollFinancialSummary('2026-11-19', '2026-11-20', null);
    assert.deepEqual(requests.map(range => [range.p_from, range.p_to, range.p_branch_ids]), [
      ['2026-11-19', '2026-11-20', null],
      ['2026-11-19', '2026-11-19', null],
      ['2026-11-20', '2026-11-20', null],
    ]);
    assert.deepEqual(rows.map(row => [row.day, row.net_day]), [['2026-11-19', 100], ['2026-11-20', 100]]);
  });
}

test('propagates a failed payroll day instead of returning zero payroll', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: '57014' }, { status: 400 }));
  await assert.rejects(fetchPayrollFinancialSummary('2026-11-22', '2026-11-22', null), /2026-11-22/);
});
