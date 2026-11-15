import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { applyWhatsappDeliveryStatus, replayWhatsappDeliveryReceipts, pruneWhatsappDeliveryReceipts } from './whatsappDelivery';

function fixture(options: { receiptError?: { code: string; message: string }; missingCleanup?: boolean } = {}) {
  let message: any = null;
  const receipts = new Map<string, any>();
  const calls: Array<{ method: string; table: string; body: any; params: URLSearchParams }> = [];
  const admin = createClient('https://receipt-test.invalid', 'test-key', {
    auth: { persistSession: false }, global: { fetch: async (input, init) => {
      const req = new Request(input, init), url = new URL(req.url), table = url.pathname.split('/').at(-1)!;
      const body = req.method === 'GET' ? null : await req.json();
      calls.push({ method: req.method, table, body, params: url.searchParams });
      let data: any = [];
      let status = 200;
      if (table === 'whatsapp_delivery_receipts') {
        if (options.receiptError) { data = options.receiptError; status = options.receiptError.code === '42501' ? 403 : 404; }
        else if (req.method === 'POST') receipts.set(`${body.wa_message_id}:${body.status}`, body);
        else data = [...receipts.values()].filter(r => url.searchParams.get('wa_message_id') === `eq.${r.wa_message_id}`);
      } else if (table === 'whatsapp_messages') {
        const matches = !!message && (!url.searchParams.has('wa_message_id') || url.searchParams.get('wa_message_id') === `eq.${message.wa_message_id}`);
        if (req.method === 'PATCH') {
          if (matches && url.searchParams.get('status')?.slice(4, -1).split(',').includes(message.status)) Object.assign(message, body);
        } else data = matches ? message : null;
      } else if (table === 'whatsapp_followup_queue') data = [];
      else if (table === 'whatsapp_prune_delivery_receipts') {
        if (options.missingCleanup) { data = { code: 'PGRST202', message: 'function missing' }; status = 404; }
        else data = 7;
      } else throw new Error(`Unexpected request ${table}`);
      return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    } },
  });
  return { admin, receipts, calls, link: (status = 'sent') => { message = { id: 'local-message', wa_message_id: 'wamid.early', status, error_code: null, error_message: null }; }, message: () => message };
}

test('a receipt that beats provider-ID linkage is durable and replayed after linkage', async () => {
  const f = fixture();
  await applyWhatsappDeliveryStatus(f.admin, { id: 'wamid.early', status: 'read', timestamp: '1794733200' });
  assert.equal(f.message(), null);
  assert.equal(f.receipts.size, 1);
  assert.equal(f.calls[0].table, 'whatsapp_delivery_receipts', 'persist before message lookup');
  assert.deepEqual(Object.keys(f.calls[0].body).sort(), ['wa_message_id', 'status', 'provider_timestamp', 'error_code', 'error_message', 'received_at'].sort());
  f.link();
  assert.equal(await replayWhatsappDeliveryReceipts(f.admin, 'wamid.early'), true);
  assert.equal(f.message().status, 'read');
});

test('duplicate callbacks are idempotent by provider ID/status and late failures cannot downgrade read', async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) await applyWhatsappDeliveryStatus(f.admin, { id: 'wamid.early', status: 'read' });
  await applyWhatsappDeliveryStatus(f.admin, { id: 'wamid.early', status: 'failed', errors: [{ code: 131047, title: 'Expired window' }] });
  await applyWhatsappDeliveryStatus(f.admin, { id: 'wamid.early', status: 'sent' });
  assert.equal(f.receipts.size, 3);
  f.link();
  await replayWhatsappDeliveryReceipts(f.admin, 'wamid.early');
  assert.equal(f.message().status, 'read');
  await applyWhatsappDeliveryStatus(f.admin, { id: 'wamid.early', status: 'failed', errors: [{ code: 131047 }] });
  assert.equal(f.message().status, 'read');
});

test('an early failed receipt overrides accepted/sent and retains its error', async () => {
  const f = fixture();
  await applyWhatsappDeliveryStatus(f.admin, { id: 'wamid.early', status: 'failed', errors: [{ code: 131047, title: 'Expired window' }] });
  f.link();
  await replayWhatsappDeliveryReceipts(f.admin, 'wamid.early');
  assert.equal(f.message().status, 'failed');
  assert.equal(f.message().error_code, '131047');
  assert.equal(f.message().error_message, 'Expired window');
});

test('missing additive migration uses the existing delivery path without breaking callbacks', async () => {
  const f = fixture({ receiptError: { code: 'PGRST205', message: 'table not present in schema cache' }, missingCleanup: true });
  f.link();
  await applyWhatsappDeliveryStatus(f.admin, { id: 'wamid.early', status: 'delivered' });
  assert.equal(f.message().status, 'delivered');
  assert.equal(await replayWhatsappDeliveryReceipts(f.admin, 'wamid.early'), false);
  assert.equal(await pruneWhatsappDeliveryReceipts(f.admin), 0);
});

test('real persistence errors fail the webhook for redelivery rather than silently lose a receipt', async () => {
  const f = fixture({ receiptError: { code: '42501', message: 'permission denied' } });
  await assert.rejects(applyWhatsappDeliveryStatus(f.admin, { id: 'wamid.early', status: 'read' }), /Persist WhatsApp delivery receipt/);
  assert.equal(f.calls.length, 1);
});

test('cleanup uses a bounded service-only RPC and never requests customer content', async () => {
  const f = fixture();
  assert.equal(await pruneWhatsappDeliveryReceipts(f.admin), 7);
  assert.deepEqual(f.calls[0].body, { p_limit: 500 });
});
