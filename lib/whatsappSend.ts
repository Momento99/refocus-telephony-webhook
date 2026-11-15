import type { SupabaseClient } from '@supabase/supabase-js';
import { reconcileWhatsappThread } from './whatsappThreadState';
import { replayWhatsappDeliveryReceipts } from './whatsappDelivery';

export type WhatsappSendConfig = { phone_number_id: string | null; access_token: string | null; is_active: boolean | null };
export type WhatsappSendResult = { httpStatus: number; body: Record<string, unknown> & { ok: boolean } };
const result = (httpStatus: number, body: WhatsappSendResult['body']): WhatsappSendResult => ({ httpStatus, body });

export function whatsappCustomerWindowOpen(lastInboundAt: string | null, now = Date.now()): boolean {
  if (!lastInboundAt) return false;
  const time = Date.parse(lastInboundAt);
  return Number.isFinite(time) && time <= now && now - time < 24 * 60 * 60 * 1000;
}

async function syncThread(admin: SupabaseClient, threadId: string): Promise<string | null> {
  try { await reconcileWhatsappThread(admin, threadId); return null; }
  catch (error) {
    // A local metadata problem must never cause a second provider send.
    console.error('[whatsapp send] thread synchronization failed', { threadId, error: String(error) });
    return 'THREAD_SYNC_PENDING';
  }
}

async function replayReceipts(admin: SupabaseClient, providerId: string): Promise<string | null> {
  try { await replayWhatsappDeliveryReceipts(admin, providerId); return null; }
  catch (error) {
    console.error('[whatsapp send] receipt replay failed', { providerId, error: String(error) });
    return 'DELIVERY_SYNC_PENDING';
  }
}

/** Shared by immediate POS send and the cron fallback: one CAS claim, one provider request. */
export async function sendPendingWhatsappText(
  admin: SupabaseClient,
  messageId: string,
  options: { fetch?: typeof fetch; now?: () => number; config?: WhatsappSendConfig } = {},
): Promise<WhatsappSendResult> {
  const now = options.now || Date.now;
  const { data: message, error: messageError } = await admin.from('whatsapp_messages')
    .select('id,thread_id,direction,message_type,body,status,wa_message_id,error_code,error_message,attempts,last_attempt_at,created_at')
    .eq('id', messageId).maybeSingle();
  if (messageError) return result(503, { ok: false, error: 'DB_ERROR' });
  if (!message) return result(404, { ok: false, error: 'NOT_FOUND' });
  if (message.direction !== 'outbound') return result(400, { ok: false, error: 'NOT_OUTBOUND' });
  // A provider-assigned ID does not prove delivery; failed messages must never return success.
  if (message.status === 'failed') return result(409, {
    ok: false, status: 'failed', error: message.error_code === '131047' ? 'CUSTOMER_WINDOW_CLOSED' : 'MESSAGE_FAILED',
    provider_code: message.error_code, details: message.error_message,
  });
  if (['sent', 'delivered', 'read'].includes(message.status) && message.wa_message_id) {
    const receiptWarning = await replayReceipts(admin, message.wa_message_id);
    const syncWarning = await syncThread(admin, message.thread_id);
    const { data: current } = await admin.from('whatsapp_messages').select('status,error_code,error_message')
      .eq('id', message.id).maybeSingle();
    if (current?.status === 'failed') return result(409, {
      ok: false, status: 'failed', error: current.error_code === '131047' ? 'CUSTOMER_WINDOW_CLOSED' : 'MESSAGE_FAILED',
      provider_code: current.error_code, details: current.error_message,
    });
    const warning = receiptWarning || syncWarning;
    return result(200, { ok: true, status: current?.status || message.status, already_sent: true, ...(warning ? { warning } : {}) });
  }
  if (message.status === 'sending') {
    const started = Date.parse(message.last_attempt_at || message.created_at);
    if (Number.isFinite(started) && now() - started > 5 * 60 * 1000) {
      let stale = admin.from('whatsapp_messages').update({ status: 'failed', error_code: 'SEND_STATUS_UNKNOWN',
        error_message: 'Не удалось подтвердить завершение отправки. Проверьте переписку перед повтором.' })
        .eq('id', message.id).eq('status', 'sending');
      stale = message.last_attempt_at == null ? stale.is('last_attempt_at', null) : stale.eq('last_attempt_at', message.last_attempt_at);
      const { data: marked, error } = await stale.select('id').maybeSingle();
      if (error) return result(503, { ok: false, error: 'SAVE_FAILED_STATUS' });
      if (marked) {
        await syncThread(admin, message.thread_id);
        return result(409, { ok: false, status: 'failed', error: 'SEND_STATUS_UNKNOWN', details: 'Отправка не подтверждена. Проверьте переписку перед повтором.' });
      }
    }
    return result(202, { ok: true, status: 'sending', already_being_sent: true });
  }
  if (message.status !== 'pending' || message.wa_message_id) return result(409, { ok: false, error: 'BAD_STATUS', status: message.status });

  let ownsClaim = false;
  const fail = async (code: string, details: string, httpStatus = 502, error = 'WA_SEND_FAILED') => {
    const { data: marked, error: saveError } = await admin.from('whatsapp_messages')
      .update({ status: 'failed', error_code: code, error_message: details })
      .eq('id', message.id).eq('status', ownsClaim ? 'sending' : 'pending').select('id').maybeSingle();
    if (saveError) return result(503, { ok: false, error: 'SAVE_FAILED_STATUS', details: 'Проверьте статус сообщения перед повторной отправкой.' });
    if (!marked) return result(202, { ok: true, status: 'sending', already_being_sent: true });
    await syncThread(admin, message.thread_id);
    return result(httpStatus, { ok: false, status: 'failed', error, provider_code: code, details });
  };

  if (message.message_type !== 'text' || !message.body?.trim()) {
    return fail('EMPTY_OR_UNSUPPORTED_BODY', 'Сообщение должно содержать текст.', 400, 'UNSUPPORTED_MESSAGE_TYPE');
  }
  if (message.body.length > 4096) return fail('BODY_TOO_LONG', 'Максимум 4096 символов.', 400, 'BODY_TOO_LONG');

  const { data: thread, error: threadError } = await admin.from('whatsapp_threads')
    .select('id,phone_number').eq('id', message.thread_id).maybeSingle();
  if (threadError) return result(503, { ok: false, error: 'THREAD_READ_FAILED' });
  if (!thread?.phone_number) return fail('THREAD_NOT_FOUND', 'Диалог не найден.', 404, 'THREAD_NOT_FOUND');
  let config = options.config;
  if (!config) {
    const { data, error } = await admin.from('whatsapp_api_config')
      .select('phone_number_id,access_token,is_active').eq('id', 1).maybeSingle();
    if (error) return result(503, { ok: false, error: 'CONFIG_READ_FAILED' });
    config = data as WhatsappSendConfig | undefined;
  }
  // Validate configuration before acquiring the row so a temporary outage cannot strand it in sending.
  if (!config?.phone_number_id || !config.access_token) return result(503, { ok: false, error: 'CONFIG_MISSING' });
  if (!config.is_active) return result(409, { ok: false, error: 'INTEGRATION_INACTIVE' });
  const { data: inbound, error: inboundError } = await admin.from('whatsapp_messages')
    .select('created_at').eq('thread_id', message.thread_id).eq('direction', 'inbound')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (inboundError) return result(503, { ok: false, error: 'CUSTOMER_WINDOW_READ_FAILED' });
  let lastInboundAt = inbound?.created_at || null;
  if (!whatsappCustomerWindowOpen(lastInboundAt, now())) {
    // Meta's service window belongs to the recipient, not to our reopenable thread ID.
    const { data: phoneThreads, error: phoneThreadsError } = await admin.from('whatsapp_threads')
      .select('id').eq('phone_number', thread.phone_number);
    if (phoneThreadsError) return result(503, { ok: false, error: 'CUSTOMER_WINDOW_READ_FAILED' });
    const others = (phoneThreads || []).map(t => t.id).filter(id => id !== message.thread_id);
    if (others.length) {
      const { data: otherInbound, error: otherInboundError } = await admin.from('whatsapp_messages')
        .select('created_at').in('thread_id', others).eq('direction', 'inbound')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (otherInboundError) return result(503, { ok: false, error: 'CUSTOMER_WINDOW_READ_FAILED' });
      if (otherInbound?.created_at && (!lastInboundAt || Date.parse(otherInbound.created_at) > Date.parse(lastInboundAt))) {
        lastInboundAt = otherInbound.created_at;
      }
    }
  }
  if (!whatsappCustomerWindowOpen(lastInboundAt, now())) {
    return fail('131047', 'Прошло более 24 часов после сообщения клиента. Дождитесь нового сообщения клиента или свяжитесь с ним другим способом.', 409, 'CUSTOMER_WINDOW_CLOSED');
  }

  const { data: claimed, error: claimError } = await admin.from('whatsapp_messages')
    .update({ status: 'sending', attempts: (message.attempts || 0) + 1, last_attempt_at: new Date(now()).toISOString(), error_code: null, error_message: null })
    .eq('id', message.id).eq('status', 'pending').is('wa_message_id', null).select('id').maybeSingle();
  if (claimError) return result(503, { ok: false, error: 'CLAIM_ERROR' });
  if (!claimed) return result(202, { ok: true, status: 'sending', already_being_sent: true });
  ownsClaim = true;

  let response: Response;
  let payload: any;
  try {
    response = await (options.fetch || fetch)(`https://graph.facebook.com/v21.0/${config.phone_number_id}/messages`, {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${config.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: thread.phone_number, type: 'text', text: { body: message.body, preview_url: false } }),
    });
    payload = await response.json().catch(() => ({}));
  } catch {
    // The provider may have accepted a request whose response was lost. No automatic retry.
    return fail('SEND_STATUS_UNKNOWN', 'Не удалось подтвердить отправку. Проверьте переписку перед повторной отправкой.', 502, 'SEND_STATUS_UNKNOWN');
  }
  if (!response.ok) {
    const code = String(payload?.error?.code || response.status);
    return fail(code, payload?.error?.message || 'WhatsApp отклонил отправку.', 502, code === '131047' ? 'CUSTOMER_WINDOW_CLOSED' : 'WA_SEND_FAILED');
  }
  const providerId = payload?.messages?.[0]?.id;
  if (typeof providerId !== 'string' || !providerId) {
    return fail('SEND_STATUS_UNKNOWN', 'WhatsApp не вернул подтверждение отправки. Проверьте переписку перед повтором.', 502, 'SEND_STATUS_UNKNOWN');
  }
  // Link the accepted provider ID first, regardless of a racing status transition.
  // The guarded second write can never overwrite a delivered/read/failed callback.
  const { data: linked, error: linkError } = await admin.from('whatsapp_messages')
    .update({ wa_message_id: providerId }).eq('id', message.id).is('wa_message_id', null)
    .select('id').maybeSingle();
  let sameProviderId = !!linked;
  if (!linkError && !linked) {
    const { data: current, error } = await admin.from('whatsapp_messages')
      .select('wa_message_id').eq('id', message.id).maybeSingle();
    sameProviderId = !error && current?.wa_message_id === providerId;
  }
  if (linkError || !sameProviderId) {
    console.error('[whatsapp send] accepted response could not be recorded', { messageId: message.id, providerId });
    return result(503, { ok: false, error: 'SEND_STATUS_UNKNOWN', details: 'WhatsApp принял сообщение, но статус не сохранён. Не отправляйте повторно.' });
  }
  const { error: saveError } = await admin.from('whatsapp_messages')
    .update({ status: 'sent', error_code: null, error_message: null })
    .eq('id', message.id).eq('wa_message_id', providerId).in('status', ['pending', 'sending']);
  if (saveError) {
    console.error('[whatsapp send] accepted status could not be recorded', { messageId: message.id });
  }
  const receiptWarning = await replayReceipts(admin, providerId);
  const syncWarning = await syncThread(admin, message.thread_id);
  // A failure webhook can arrive while the thread is being reconciled.
  const { data: final, error: finalError } = await admin.from('whatsapp_messages')
    .select('status,error_code,error_message').eq('id', message.id).maybeSingle();
  if (!finalError && final?.status === 'failed') return result(502, {
    ok: false, status: 'failed', error: final.error_code === '131047' ? 'CUSTOMER_WINDOW_CLOSED' : 'WA_SEND_FAILED',
    provider_code: final.error_code, details: final.error_message,
  });
  const warning = receiptWarning || syncWarning || (saveError ? 'DELIVERY_SYNC_PENDING' : null);
  return result(200, { ok: true, status: final?.status || 'sent', ...(warning ? { warning } : {}) });
}
