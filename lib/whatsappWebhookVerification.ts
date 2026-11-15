import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWhatsappWebhookSignature(
  rawBody: Uint8Array,
  signature: string | null,
  appSecret: string | undefined,
): { ok: boolean; configured: boolean } {
  // Keep the existing integration operational until its Meta app secret is
  // configured. The challenge verify_token is NOT the app secret.
  if (!appSecret) return { ok: true, configured: false };
  if (!signature || !/^sha256=[0-9a-f]{64}$/i.test(signature)) return { ok: false, configured: true };
  const received = Buffer.from(signature.slice(7), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return { ok: timingSafeEqual(received, expected), configured: true };
}
