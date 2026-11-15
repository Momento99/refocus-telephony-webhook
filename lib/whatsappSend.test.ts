import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { sendPendingWhatsappText, whatsappCustomerWindowOpen } from './whatsappSend';
import { WHATSAPP_AUTO_WELCOME } from './whatsappThreadState';

const now = Date.parse('2026-11-15T10:00:00Z');
const config = { phone_number_id: 'phone-id', access_token: 'private-test-token', is_active: true };
function setup(options: { status?: string; providerId?: string; oldInbound?: boolean; lostClaim?: boolean; afterAcceptance?: string; peerInbound?: boolean; preflightRace?: boolean } = {}) {
  const row: any = {
    id: 'message', thread_id: 'thread', direction: 'outbound', message_type: 'text', body: 'Ответ клиенту',
    status: options.status || 'pending', wa_message_id: options.providerId || null,
    error_code: options.status === 'failed' ? '131047' : null, error_message: 'Provider rejected it', attempts: 0,
    created_at: '2026-11-15T09:59:00Z',
  };
  const incoming = { id: 'inbound', direction: 'inbound', message_type: 'text', body: 'Когда готов заказ?', status: 'delivered',
    created_at: options.oldInbound ? '2026-11-14T09:59:00Z' : '2026-11-15T09:00:00Z' };
  const thread: any = { id: 'thread', phone_number: '996000000000', status: 'waiting_seller', updated_at: '2026-11-15T09:00:00Z',
    first_customer_message_at: incoming.created_at, first_seller_response_at: null,
    last_customer_message_at: incoming.created_at, last_message_at: incoming.created_at, farewell_sent_at: null, closed_at: null };
  const requests: Array<{ table: string; method: string; body: any; params: URLSearchParams }> = [];
  const admin = createClient('https://sender-test.invalid', 'test-service-key', {
    auth: { persistSession: false }, global: { fetch: async (input, init) => {
      const req = new Request(input, init), url = new URL(req.url), table = url.pathname.split('/').at(-1)!;
      const body = req.method === 'GET' ? null : await req.json();
      requests.push({ table, method: req.method, body, params: url.searchParams });
      let data: any;
      if (table === 'whatsapp_delivery_receipts') data = [];
      else if (table === 'whatsapp_api_config') data = { auto_welcome_text: WHATSAPP_AUTO_WELCOME };
      else if (table === 'whatsapp_threads') {
        if (body) Object.assign(thread, body);
        data = url.searchParams.has('phone_number') ? (options.peerInbound ? [thread, { id: 'peer-thread' }] : [thread]) : thread;
      } else if (table === 'whatsapp_messages') {
        if (body) {
          if ((body.status === 'sending' && options.lostClaim) || (body.status === 'failed' && options.preflightRace)) data = null;
          else {
            Object.assign(row, body);
            if (body.status === 'sent' && options.afterAcceptance) row.status = options.afterAcceptance;
            data = row;
          }
        } else if (url.searchParams.get('direction') === 'eq.inbound') data = { created_at: url.searchParams.get('thread_id')?.startsWith('in.') && options.peerInbound ? '2026-11-15T09:30:00Z' : incoming.created_at };
        else if (url.searchParams.has('id')) data = row;
        else data = [incoming, row];
      } else throw new Error(`Unexpected table: ${table}`);
      return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
    } },
  });
  return { admin, row, thread, requests };
}

test('24-hour window uses actual latest inbound, including exact expiry and absent input', () => {
  assert.equal(whatsappCustomerWindowOpen('2026-11-14T10:00:01Z', now), true);
  assert.equal(whatsappCustomerWindowOpen('2026-11-14T10:00:00Z', now), false);
  assert.equal(whatsappCustomerWindowOpen(null, now), false);
  assert.equal(whatsappCustomerWindowOpen('bad-date', now), false);
  assert.equal(whatsappCustomerWindowOpen('2026-11-15T11:00:00Z', now), false);
});

test('failed message with provider id is a failure, never already_sent success or an implicit retry', async () => {
  const f = setup({ status: 'failed', providerId: 'wamid.failed' });
  const r = await sendPendingWhatsappText(f.admin, 'message', { config, now: () => now, fetch: async () => { throw new Error('Must not send'); } });
  assert.equal(r.body.ok, false);
  assert.equal(r.body.error, 'CUSTOMER_WINDOW_CLOSED');
  assert.equal(f.requests.length, 1);
});

test('missing config cannot strand a pending message in sending', async () => {
  const f = setup();
  const r = await sendPendingWhatsappText(f.admin, 'message', { config: { ...config, access_token: null }, now: () => now });
  assert.equal(r.body.error, 'CONFIG_MISSING');
  assert.equal(f.row.status, 'pending');
  assert.equal(f.requests.some(r => r.method === 'PATCH'), false);
});

test('expired customer window fails visibly without sending and keeps the question pending', async () => {
  const f = setup({ oldInbound: true });
  const r = await sendPendingWhatsappText(f.admin, 'message', { config, now: () => now, fetch: async () => { throw new Error('Must not send'); } });
  assert.equal(r.body.error, 'CUSTOMER_WINDOW_CLOSED');
  assert.equal(f.row.status, 'failed');
  assert.equal(f.thread.status, 'waiting_seller');
  assert.equal(f.thread.first_seller_response_at, null);
  assert.equal(f.requests.some(r => r.body?.status === 'sending'), false);
});

test('a concurrent immediate/cron claimant results in zero duplicate provider requests', async () => {
  const f = setup({ lostClaim: true });
  let sends = 0;
  const r = await sendPendingWhatsappText(f.admin, 'message', { config, now: () => now, fetch: async () => { sends++; throw new Error('Must not send'); } });
  assert.equal(r.httpStatus, 202);
  assert.equal(r.body.already_being_sent, true);
  assert.equal(sends, 0);
  const claim = f.requests.find(r => r.body?.status === 'sending')!;
  assert.equal(claim.params.get('status'), 'eq.pending');
  assert.equal(claim.params.get('wa_message_id'), 'is.null');
});

test('accepted text is sent once, response field is updated only after acceptance', async () => {
  const f = setup();
  let sends = 0;
  const r = await sendPendingWhatsappText(f.admin, 'message', { config, now: () => now, fetch: async (_url, init) => {
    sends++;
    assert.equal(f.thread.status, 'waiting_seller');
    assert.equal(f.row.status, 'sending');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer private-test-token');
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.accepted' }] }), { status: 200 });
  } });
  assert.equal(sends, 1);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.status, 'sent');
  assert.equal(f.thread.status, 'waiting_customer');
  assert.equal(f.row.attempts, 1);
  assert.equal(JSON.stringify(r).includes('private-test-token'), false);
});

test('provider rejection records the error and does not resolve the conversation', async () => {
  const f = setup();
  const r = await sendPendingWhatsappText(f.admin, 'message', { config, now: () => now, fetch: async () => new Response(JSON.stringify({ error: { code: 131047, message: 'Re-engagement message' } }), { status: 400 }) });
  assert.equal(r.body.ok, false);
  assert.equal(r.body.error, 'CUSTOMER_WINDOW_CLOSED');
  assert.equal(f.row.error_code, '131047');
  assert.equal(f.thread.status, 'waiting_seller');
});

test('a failed callback arriving after acceptance is returned as failure, not sent success', async () => {
  const f = setup({ afterAcceptance: 'failed' });
  const r = await sendPendingWhatsappText(f.admin, 'message', { config, now: () => now, fetch: async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.accepted' }] })) });
  assert.equal(r.body.ok, false);
  assert.equal(f.thread.status, 'waiting_seller');
});

test('lost provider response is marked uncertain and never automatically retried', async () => {
  const f = setup();
  let sends = 0;
  const options = { config, now: () => now, fetch: async () => { sends++; throw new Error('Timeout'); } };
  const r = await sendPendingWhatsappText(f.admin, 'message', options);
  assert.equal(r.body.error, 'SEND_STATUS_UNKNOWN');
  assert.equal(f.row.status, 'failed');
  await sendPendingWhatsappText(f.admin, 'message', options);
  assert.equal(sends, 1);
});

test('preflight rejection cannot overwrite a send another request already claimed', async () => {
  const f = setup({ oldInbound: true, preflightRace: true });
  const r = await sendPendingWhatsappText(f.admin, 'message', { config, now: () => now });
  assert.equal(r.httpStatus, 202);
  const failure = f.requests.find(r => r.body?.status === 'failed')!;
  assert.equal(failure.params.get('status'), 'eq.pending');
  assert.equal(f.requests.some(r => r.table === 'whatsapp_threads' && r.method === 'PATCH'), false);
});

test('the 24-hour recipient window can be opened by another thread for the same phone', async () => {
  const f = setup({ oldInbound: true, peerInbound: true });
  let sends = 0;
  const r = await sendPendingWhatsappText(f.admin, 'message', { config, now: () => now, fetch: async () => {
    sends++; return new Response(JSON.stringify({ messages: [{ id: 'wamid.peer' }] }));
  } });
  assert.equal(r.body.ok, true);
  assert.equal(sends, 1);
});

test('a crashed old sending row becomes visibly uncertain without another provider request', async () => {
  const f = setup({ status: 'sending' });
  f.row.last_attempt_at = '2026-11-15T09:54:00Z';
  const r = await sendPendingWhatsappText(f.admin, 'message', { config, now: () => now, fetch: async () => { throw new Error('Must not send'); } });
  assert.equal(r.body.error, 'SEND_STATUS_UNKNOWN');
  assert.equal(f.row.status, 'failed');
});
