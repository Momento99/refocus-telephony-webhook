import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { expireStaleWhatsappFollowups, sendPendingWhatsappFollowup, type WhatsappFollowupItem } from './whatsappFollowup';

const now = Date.parse('2026-11-15T15:00:00Z');
const config = { is_active: true, phone_number_id: 'phone-id', access_token: 'test-token' };
const item: WhatsappFollowupItem = { id: 'queue-1', customer_id: 1, order_id: 1, branch_id: 1, phone_number: '996000000000',
  scenario: 'aftercare_day12', template_name: 'aftercare', template_language: 'ru', template_variables: null,
  attempts: 0, created_at: '2026-11-15T10:00:00Z' };
function fixture(initial: Record<string, unknown> = {}) {
  const row: any = { ...item, status: 'pending', last_attempt_at: null, accepted_wa_message_id: null, ...initial };
  const requests: Array<{ method: string; params: URLSearchParams; body: any }> = [];
  let beforePatch: (() => void) | null = null;
  const admin = createClient('https://followup-test.invalid', 'test-key', {
    auth: { persistSession: false }, global: { fetch: async (input, init) => {
      const req = new Request(input, init), url = new URL(req.url);
      const body = req.method === 'GET' ? null : await req.json();
      requests.push({ method: req.method, params: url.searchParams, body });
      assert.ok(url.pathname.endsWith('/whatsapp_followup_queue'));
      if (body && beforePatch) { const run = beforePatch; beforePatch = null; run(); }
      const matches = [...url.searchParams].every(([key, value]) => {
        if (['select', 'order', 'limit', 'offset', 'or'].includes(key)) return true;
        if (value === 'is.null') return row[key] == null;
        if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
        return true;
      });
      if (body && matches) Object.assign(row, body);
      const data = req.method === 'GET' ? (matches ? [{ ...row }] : []) : (matches ? { ...row } : null);
      return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
    } },
  });
  return { admin, row, requests, race: (fn: () => void) => { beforePatch = fn; } };
}

test('two overlapping cron workers make one provider request and one local record', async () => {
  const f = fixture(); let sends = 0, records = 0;
  const options = { now: () => now, fetch: async () => { sends++; return new Response(JSON.stringify({ messages: [{ id: 'wamid.one' }] })); },
    recordAccepted: async () => { records++; return 'message-1'; } };
  const results = await Promise.all([sendPendingWhatsappFollowup(f.admin, item, config, options), sendPendingWhatsappFollowup(f.admin, item, config, options)]);
  assert.equal(sends, 1); assert.equal(records, 1);
  assert.deepEqual(results.map(r => r.state).sort(), ['sent', 'skipped']);
  assert.equal(f.row.status, 'sent'); assert.equal(f.row.attempts, 1);
  assert.equal(f.row.accepted_wa_message_id, 'wamid.one');
  assert.equal(f.row.sent_message_id, 'message-1');
});

test('a lost provider response is terminally uncertain and not automatically retransmitted', async () => {
  const f = fixture(); let sends = 0;
  const options = { now: () => now, fetch: async () => { sends++; throw new Error('Timeout'); }, recordAccepted: async () => { throw new Error('Must not record'); } };
  assert.equal((await sendPendingWhatsappFollowup(f.admin, item, config, options)).state, 'uncertain');
  assert.equal(f.row.status, 'failed');
  assert.equal((await sendPendingWhatsappFollowup(f.admin, item, config, options)).state, 'skipped');
  assert.equal(sends, 1);
});

test('missing provider ID and server errors are uncertain instead of pending retries', async () => {
  for (const [status, payload] of [[200, {}], [503, { error: { code: 1, message: 'server error' } }]] as const) {
    const f = fixture();
    const outcome = await sendPendingWhatsappFollowup(f.admin, item, config, { now: () => now,
      fetch: async () => new Response(JSON.stringify(payload), { status }), recordAccepted: async () => 'unused' });
    assert.equal(outcome.state, 'uncertain'); assert.equal(f.row.status, 'failed');
  }
});

test('explicit provider rejection retries with backoff at most three times', async () => {
  const f = fixture(); let sends = 0;
  const options = { now: () => now, fetch: async () => { sends++; return new Response(JSON.stringify({ error: { code: 130429, message: 'Rate limited' } }), { status: 429 }); }, recordAccepted: async () => 'unused' };
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await sendPendingWhatsappFollowup(f.admin, { ...item, attempts: attempt }, config, options);
    assert.equal(result.state, attempt < 2 ? 'retry' : 'failed');
  }
  assert.equal(sends, 3); assert.equal(f.row.status, 'failed');
  assert.equal(f.row.scheduled_at, '2026-11-15T15:05:00.000Z');
  await sendPendingWhatsappFollowup(f.admin, { ...item, attempts: 3 }, config, options);
  assert.equal(sends, 3);
});

test('accepted ID survives local recording failure and cannot be sent again', async () => {
  const f = fixture(); let sends = 0;
  const options = { now: () => now, fetch: async () => { sends++; return new Response(JSON.stringify({ messages: [{ id: 'wamid.accepted' }] })); },
    recordAccepted: async () => null };
  assert.equal((await sendPendingWhatsappFollowup(f.admin, item, config, options)).state, 'uncertain');
  assert.equal(f.row.status, 'failed'); assert.equal(f.row.accepted_wa_message_id, 'wamid.accepted');
  await sendPendingWhatsappFollowup(f.admin, item, config, options);
  assert.equal(sends, 1);
});

test('a late acceptance preserves its provider ID even if stale cleanup changed the claim status', async () => {
  const f = fixture(); let records = 0;
  const result = await sendPendingWhatsappFollowup(f.admin, item, config, { now: () => now,
    fetch: async () => { f.row.status = 'failed'; return new Response(JSON.stringify({ messages: [{ id: 'wamid.late' }] })); },
    recordAccepted: async () => { records++; return 'unused'; } });
  assert.equal(result.state, 'uncertain'); assert.equal(f.row.accepted_wa_message_id, 'wamid.late');
  assert.equal(f.row.status, 'failed'); assert.equal(records, 0);
});

test('stale cleanup handles NULL timestamps and cannot overwrite a newer claimed attempt', async () => {
  const f = fixture({ status: 'sending', last_attempt_at: null });
  assert.equal(await expireStaleWhatsappFollowups(f.admin, now), 1);
  assert.equal(f.row.status, 'failed');
  assert.equal(f.requests[1].params.get('last_attempt_at'), 'is.null');
  const race = fixture({ status: 'sending', last_attempt_at: '2026-11-15T14:00:00Z' });
  race.race(() => { race.row.last_attempt_at = '2026-11-15T15:00:00Z'; });
  assert.equal(await expireStaleWhatsappFollowups(race.admin, now), 0);
  assert.equal(race.row.status, 'sending');
});
