import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWhatsappWebhookSignature } from './whatsappWebhookVerification';

const body = new TextEncoder().encode('{"message":"Здравствуйте 👋"}');
const secret = 'fixture-app-secret';
const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

test('valid raw UTF-8 webhook bytes pass; altered content or wrong secret fail', () => {
  assert.deepEqual(verifyWhatsappWebhookSignature(body, signature, secret), { ok: true, configured: true });
  assert.equal(verifyWhatsappWebhookSignature(new TextEncoder().encode('{"message": "Здравствуйте 👋"}'), signature, secret).ok, false);
  assert.equal(verifyWhatsappWebhookSignature(body, signature, 'other-secret').ok, false);
});

test('missing and malformed signatures fail closed when the app secret is configured', () => {
  for (const value of [null, '', 'sha256=abc', 'sha256=' + 'g'.repeat(64), 'sha1=' + 'a'.repeat(64), signature + '\n']) {
    assert.deepEqual(verifyWhatsappWebhookSignature(body, value, secret), { ok: false, configured: true });
  }
});

test('an unconfigured app secret preserves legacy ingestion without pretending to verify it', () => {
  assert.deepEqual(verifyWhatsappWebhookSignature(body, null, undefined), { ok: true, configured: false });
  assert.deepEqual(verifyWhatsappWebhookSignature(body, 'invalid', ''), { ok: true, configured: false });
});
