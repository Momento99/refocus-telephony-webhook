import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getReconciliationPeriodEnd,
  getReconciliationPeriodStart,
  shiftReconciliationPeriodISO,
} from './reconciliation';

test('uses the Bishkek business date at the Sunday cutover boundary', () => {
  assert.equal(
    getReconciliationPeriodStart(new Date('2026-08-15T17:59:59.999Z')),
    '2026-08-10',
  );
  assert.equal(
    getReconciliationPeriodStart(new Date('2026-08-15T18:00:00.000Z')),
    '2026-08-16',
  );
});

test('keeps historical Monday periods and the six-day transition period', () => {
  assert.equal(getReconciliationPeriodStart(new Date('2026-08-09T12:00:00Z')), '2026-08-03');
  assert.equal(getReconciliationPeriodStart(new Date('2026-08-15T12:00:00Z')), '2026-08-10');
  assert.equal(getReconciliationPeriodEnd('2026-08-03'), '2026-08-09');
  assert.equal(getReconciliationPeriodEnd('2026-08-10'), '2026-08-15');
});

test('uses Sunday through Saturday from 16 August 2026', () => {
  assert.equal(getReconciliationPeriodStart(new Date('2026-08-16T12:00:00Z')), '2026-08-16');
  assert.equal(getReconciliationPeriodStart(new Date('2026-08-22T12:00:00Z')), '2026-08-16');
  assert.equal(getReconciliationPeriodStart(new Date('2026-08-23T12:00:00Z')), '2026-08-23');
  assert.equal(getReconciliationPeriodEnd('2026-08-16'), '2026-08-22');
});

test('navigates symmetrically across the short transition period', () => {
  assert.equal(shiftReconciliationPeriodISO('2026-08-10', 1), '2026-08-16');
  assert.equal(shiftReconciliationPeriodISO('2026-08-16', -1), '2026-08-10');
  assert.equal(shiftReconciliationPeriodISO('2026-08-16', 1), '2026-08-23');
  assert.equal(shiftReconciliationPeriodISO('2026-08-10', -1), '2026-08-03');
});
