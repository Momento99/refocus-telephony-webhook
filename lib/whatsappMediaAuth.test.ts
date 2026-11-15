import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authorizeWhatsappMedia, canReadWhatsappMedia } from './whatsappMediaAuth';

const headers = { 'x-pos-session-id': '2000', 'x-pos-client-uuid': '12345678-1234-4234-8234-123456789abc', 'x-terminal-code': 'TEST-123' };

test('a bare message UUID or predictable session id is insufficient for media access', async () => {
  let calls = 0;
  const admin = { rpc: async () => { calls++; } } as unknown as SupabaseClient;
  assert.equal((await authorizeWhatsappMedia(new Request('https://crm.test/api/whatsapp/media?message_id=123'), admin)).ok, false);
  assert.equal((await authorizeWhatsappMedia(new Request('https://crm.test', { headers: { 'x-pos-session-id': '2000' } }), admin)).ok, false);
  assert.equal(calls, 0);
});

test('only a server-verified private device capability grants branch access', async () => {
  let args: any;
  const admin = { rpc: async (name: string, supplied: any) => {
    assert.equal(name, 'whatsapp_authorize_pos'); args = supplied;
    return { data: [{ employee_id: 19, branch_id: 4 }], error: null };
  } } as unknown as SupabaseClient;
  const result = await authorizeWhatsappMedia(new Request('https://crm.test', { headers }), admin);
  assert.equal(result.ok, true);
  assert.deepEqual(args, { p_pos_session_id: '2000', p_client_uuid: headers['x-pos-client-uuid'], p_terminal_code: 'TEST-123' });
  if (!result.ok) throw new Error('expected authorized');
  assert.equal(canReadWhatsappMedia(result.actor, 4), true);
  assert.equal(canReadWhatsappMedia(result.actor, null), true);
  assert.equal(canReadWhatsappMedia(result.actor, 5), false);
});

test('invalid device and unavailable validator fail closed with distinct recoverable errors', async () => {
  for (const [code, expectedStatus] of [['42501', 401], ['PGRST202', 503]] as const) {
    const admin = { rpc: async () => ({ data: null, error: { code } }) } as unknown as SupabaseClient;
    const result = await authorizeWhatsappMedia(new Request('https://crm.test', { headers }), admin);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, expectedStatus);
  }
});
