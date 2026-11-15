import type { SupabaseClient } from '@supabase/supabase-js';
import type { WhatsappSendConfig } from './whatsappSend';

export type WhatsappFollowupItem = {
  id: string; customer_id: number; order_id: number; branch_id: number; phone_number: string;
  scenario: string; template_name: string; template_language: string;
  template_variables: Record<string, string> | null; attempts: number; created_at: string;
};
export type WhatsappFollowupOutcome = { state: 'sent' | 'retry' | 'failed' | 'skipped' | 'uncertain'; messageId?: string };

/** Expire ambiguous sends without retransmission, even when there are no new queued templates. */
export async function expireStaleWhatsappFollowups(admin: SupabaseClient, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - 5 * 60 * 1000).toISOString();
  const { data, error } = await admin.from('whatsapp_followup_queue').select('id,last_attempt_at')
    .eq('status', 'sending')
    .or(`last_attempt_at.lt.${cutoff},and(last_attempt_at.is.null,created_at.lt.${cutoff})`)
    .order('last_attempt_at', { nullsFirst: true }).limit(100);
  if (error) throw new Error(`Read stale WhatsApp followups: ${error.message}`);
  let changed = 0;
  for (const item of data || []) {
    let update = admin.from('whatsapp_followup_queue')
      .update({ status: 'failed', error_message: 'Send outcome unknown after worker timeout; verify provider history before retrying' })
      .eq('id', item.id).eq('status', 'sending');
    update = item.last_attempt_at == null ? update.is('last_attempt_at', null) : update.eq('last_attempt_at', item.last_attempt_at);
    const { data: updated, error: updateError } = await update.select('id').maybeSingle();
    if (updateError) throw new Error(`Expire stale WhatsApp followup: ${updateError.message}`);
    if (updated) changed++;
  }
  return changed;
}

/** A single provider attempt guarded by status, attempt number and its own claim timestamp. */
export async function sendPendingWhatsappFollowup(
  admin: SupabaseClient,
  item: WhatsappFollowupItem,
  config: WhatsappSendConfig,
  options: {
    recordAccepted: (item: WhatsappFollowupItem, providerId: string) => Promise<string | null>;
    fetch?: typeof fetch;
    now?: () => number;
  },
): Promise<WhatsappFollowupOutcome> {
  if (!config.is_active || !config.phone_number_id || !config.access_token) return { state: 'skipped' };
  const now = options.now || Date.now;
  if ((item.attempts || 0) >= 3) {
    const { error } = await admin.from('whatsapp_followup_queue')
      .update({ status: 'failed', error_message: 'Maximum template send attempts reached' })
      .eq('id', item.id).eq('status', 'pending').eq('attempts', item.attempts);
    if (error) throw new Error(`Stop exhausted WhatsApp followup: ${error.message}`);
    return { state: 'failed' };
  }
  const attempt = (item.attempts || 0) + 1;
  const claimedAt = new Date(now()).toISOString();
  const { data: claim, error: claimError } = await admin.from('whatsapp_followup_queue').update({
    status: 'sending', attempts: attempt, last_attempt_at: claimedAt, error_message: null,
  }).eq('id', item.id).eq('status', 'pending').eq('attempts', item.attempts || 0).is('accepted_wa_message_id', null)
    .select('id').maybeSingle();
  if (claimError) throw new Error(`Claim WhatsApp followup: ${claimError.message}`);
  if (!claim) return { state: 'skipped' };

  const save = async (patch: Record<string, unknown>) => {
    const { data, error } = await admin.from('whatsapp_followup_queue').update(patch)
      .eq('id', item.id).eq('status', 'sending').eq('attempts', attempt).eq('last_attempt_at', claimedAt)
      .select('id').maybeSingle();
    if (error) throw new Error(`Save WhatsApp followup outcome: ${error.message}`);
    return !!data;
  };
  const uncertain = async (detail: string): Promise<WhatsappFollowupOutcome> => {
    await save({ status: 'failed', error_message: detail });
    return { state: 'uncertain' };
  };

  const vars = item.template_variables || {};
  const parameters = Object.keys(vars).sort((a, b) => Number(a) - Number(b))
    .map(key => ({ type: 'text', text: String(vars[key] ?? '') }));
  let response: Response;
  let payload: any;
  try {
    response = await (options.fetch || fetch)(`https://graph.facebook.com/v21.0/${config.phone_number_id}/messages`, {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${config.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: item.phone_number, type: 'template', template: {
        name: item.template_name, language: { code: item.template_language || 'ru' },
        components: parameters.length ? [{ type: 'body', parameters }] : [],
      } }),
    });
    payload = await response.json().catch(() => ({}));
  } catch {
    return uncertain('Send outcome unknown after network error; verify provider history before retrying');
  }
  if (!response.ok) {
    // Only an explicit client-error rejection is eligible for a bounded retry.
    // A timeout, malformed response or server failure could hide an accepted message.
    if (response.status >= 500 || !payload?.error || typeof payload.error !== 'object') {
      return uncertain(`Send outcome unknown after HTTP ${response.status}; verify provider history before retrying`);
    }
    const retry = attempt < 3;
    await save({ status: retry ? 'pending' : 'failed',
      error_message: `${response.status} ${payload.error.code || ''} ${payload.error.message || 'WhatsApp rejected template'}`.slice(0, 1000),
      ...(retry ? { scheduled_at: new Date(now() + 5 * 60 * 1000).toISOString() } : {}),
    });
    return { state: retry ? 'retry' : 'failed' };
  }
  const providerId = payload?.messages?.[0]?.id;
  if (typeof providerId !== 'string' || !providerId) {
    return uncertain('Send outcome unknown: provider returned no message ID; verify before retrying');
  }
  // Save the irreversible external acceptance before any local thread bookkeeping.
  const acceptedSaved = await save({ accepted_wa_message_id: providerId, sent_at: new Date(now()).toISOString() });
  if (!acceptedSaved) {
    // A stale-row cleanup can race a very late response. Preserve the accepted ID
    // for this exact attempt without changing a newer attempt/status.
    const { error } = await admin.from('whatsapp_followup_queue')
      .update({ accepted_wa_message_id: providerId, error_message: 'Provider accepted message after claim changed; verify before retrying' })
      .eq('id', item.id).eq('attempts', attempt).eq('last_attempt_at', claimedAt).is('accepted_wa_message_id', null);
    if (error) throw new Error(`Save late accepted WhatsApp ID: ${error.message}`);
    return { state: 'uncertain' };
  }
  let messageId: string | null = null;
  try { messageId = await options.recordAccepted(item, providerId); }
  catch (error) { console.error('[wa followup] accepted message bookkeeping failed', { queueId: item.id, error: String(error) }); }
  if (!messageId) {
    await save({ status: 'failed', error_message: 'Provider accepted message; local message recording failed; verify before retrying' });
    return { state: 'uncertain' };
  }
  const saved = await save({ status: 'sent', sent_message_id: messageId, error_message: null });
  return saved ? { state: 'sent', messageId } : { state: 'uncertain', messageId };
}
