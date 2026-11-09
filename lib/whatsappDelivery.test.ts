import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { applyWhatsappDeliveryStatus, orderReadySkipReason, reconcileWhatsappQueue, whatsappDeliveryPatch } from './whatsappDelivery';

type Reply = { data: unknown; status?: number };
function fixture(replies: Reply[]) {
  const requests: Array<{ url: URL; method: string; body: Record<string, unknown> | null }> = [];
  const pending = [...replies];
  const admin = createClient('https://delivery-test.invalid', 'test-service-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const request = new Request(input, init);
      const body = request.method === 'GET' ? null : await request.json();
      requests.push({ url: new URL(request.url), method: request.method, body });
      const reply = pending.shift();
      assert.ok(reply, 'Unexpected database request');
      return new Response(JSON.stringify(reply.data), {
        status: reply.status ?? 200, headers: { 'content-type': 'application/json' },
      });
    } },
  });
  return { admin, requests, done: () => assert.equal(pending.length, 0) };
}

const failure = {
  id: 'wamid.payment', status: 'failed' as const,
  errors: [{ code: 131042, title: 'Business eligibility payment issue',
    error_data: { details: 'Payment could not be processed.' } }],
};
const failedRow = {
  status: 'failed', error_code: '131042',
  error_message: 'Business eligibility payment issue: Payment could not be processed.',
};

test('ready notifications are restricted to recent, uncollected, undeleted ready orders', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');
  const fresh = { status: 'READY', is_deleted: false, ready_at: '2026-09-25T07:00:00Z', delivered_at: null };
  const queued = fresh.ready_at;
  assert.equal(orderReadySkipReason(fresh, queued, now), null);
  assert.equal(orderReadySkipReason({ ...fresh, status: 'DELIVERED' }, queued, now), 'order_ready_already_delivered');
  assert.equal(orderReadySkipReason({ ...fresh, delivered_at: '2026-09-26T10:00:00Z' }, queued, now), 'order_ready_already_delivered');
  assert.equal(orderReadySkipReason({ ...fresh, is_deleted: true }, queued, now), 'order_ready_order_deleted');
  assert.equal(orderReadySkipReason({ ...fresh, status: 'REFUNDED' }, queued, now), 'order_ready_order_not_ready');
  assert.equal(orderReadySkipReason(null, queued, now), 'order_ready_order_missing');
});

test('seven-day exclusion applies to both original ready time and queue time', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');
  const fresh = { status: 'READY', is_deleted: false, ready_at: '2026-09-25T07:00:00Z', delivered_at: null };
  assert.equal(orderReadySkipReason(fresh, '2026-09-20T12:00:00Z', now), 'order_ready_older_than_seven_days');
  assert.equal(orderReadySkipReason({ ...fresh, ready_at: '2026-09-10T06:00:00Z' }, fresh.ready_at, now), 'order_ready_older_than_seven_days');
  assert.equal(orderReadySkipReason({ ...fresh, ready_at: null }, fresh.ready_at, now), 'order_ready_missing_timestamp');
});

test('preserves the provider error detail needed to diagnose billing failures', () => {
  assert.deepEqual(whatsappDeliveryPatch(failure), failedRow);
  assert.deepEqual(whatsappDeliveryPatch({ id: 'x', status: 'delivered' }), {
    status: 'delivered', error_code: null, error_message: null,
  });
  assert.equal(whatsappDeliveryPatch({ id: 'x', status: 'failed' }).error_message, 'WhatsApp delivery failed');
});

test('a payment rejection marks the linked queue failed and does not schedule a resend', async () => {
  const f = fixture([{ data: [] }, { data: { id: 'msg-1' } }, { data: failedRow }, { data: [] }]);
  await applyWhatsappDeliveryStatus(f.admin, failure);
  f.done();
  assert.deepEqual(f.requests[0].body, failedRow);
  assert.equal(f.requests[0].url.searchParams.get('wa_message_id'), 'eq.wamid.payment');
  const queue = f.requests[3];
  assert.equal(queue.url.pathname, '/rest/v1/whatsapp_followup_queue');
  assert.equal(queue.url.searchParams.get('sent_message_id'), 'eq.msg-1');
  assert.equal(queue.url.searchParams.get('status'), 'in.(sent,failed)');
  assert.equal(queue.body?.status, 'failed');
  assert.match(String(queue.body?.error_message), /131042.*Payment could not be processed/);
  assert.equal('attempts' in queue.body!, false);
  assert.equal('scheduled_at' in queue.body!, false);
  assert.ok(f.requests.every(r => r.method === 'GET' || r.method === 'PATCH'));
});

test('a delayed sent callback cannot overwrite an existing failed, delivered, or read status', async () => {
  const f = fixture([{ data: [] }, { data: { id: 'msg-1' } }, { data: failedRow }, { data: [] }]);
  await applyWhatsappDeliveryStatus(f.admin, { id: 'wamid.payment', status: 'sent' });
  f.done();
  assert.equal(f.requests[0].url.searchParams.get('status'), 'in.(pending,sent)');
  assert.equal(f.requests[3].body?.status, 'failed');
});

test('read is not downgraded by a delayed delivered callback', async () => {
  const f = fixture([{ data: [] }, { data: { id: 'msg-1' } },
    { data: { status: 'read', error_code: null, error_message: null } }, { data: [] }]);
  await applyWhatsappDeliveryStatus(f.admin, { id: 'wamid.payment', status: 'delivered' });
  f.done();
  assert.equal(f.requests[0].url.searchParams.get('status'), 'in.(pending,sent,failed,delivered)');
  // Only a previous provider delivery failure is cleared; cancelled rows remain untouched.
  assert.equal(f.requests[3].url.searchParams.get('status'), 'eq.failed');
  assert.equal(f.requests[3].url.searchParams.get('error_message'), 'like.WhatsApp delivery %');
  assert.equal(f.requests[3].body?.error_message, null);
});

test('scheduler reconciliation catches a webhook that arrived before the queue was linked', async () => {
  const f = fixture([{ data: failedRow }, { data: [] }]);
  await reconcileWhatsappQueue(f.admin, 'msg-linked-later');
  f.done();
  assert.equal(f.requests[1].url.searchParams.get('sent_message_id'), 'eq.msg-linked-later');
  assert.equal(f.requests[1].body?.status, 'failed');
});

test('non-retail status callbacks do not touch the retail queue', async () => {
  const f = fixture([{ data: [] }, { data: null }]);
  await applyWhatsappDeliveryStatus(f.admin, failure);
  f.done();
  assert.equal(f.requests.length, 2);
});

test('a database failure is propagated so the webhook can request redelivery', async () => {
  const f = fixture([{ status: 503, data: { message: 'Database unavailable', code: 'PGRST001' } }]);
  await assert.rejects(applyWhatsappDeliveryStatus(f.admin, failure), /Save WhatsApp delivery: Database unavailable/);
  f.done();
});

test('duplicate callbacks retry queue synchronization when the prior queue write failed', async () => {
  const f = fixture([{ data: [] }, { data: { id: 'msg-1' } }, { data: failedRow },
    { status: 403, data: { message: 'Queue write denied', code: '42501' } }]);
  await assert.rejects(applyWhatsappDeliveryStatus(f.admin, failure), /Save WhatsApp queue delivery: Queue write denied/);
  f.done();
});
