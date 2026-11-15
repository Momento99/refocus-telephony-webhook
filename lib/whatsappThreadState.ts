import type { SupabaseClient } from '@supabase/supabase-js';
import { isCustomerAcknowledgementOrPositiveClosure, isCustomerGreeting, isWhatsappFarewellMessage } from './farewellDetect';

export type WhatsappStateMessage = {
  id: string;
  direction: string;
  message_type: string;
  body: string | null;
  status: string | null;
  created_at: string;
};
export type WhatsappThreadSnapshot = {
  id: string;
  status: string;
  updated_at: string;
  last_message_at: string | null;
  last_customer_message_at: string | null;
  first_customer_message_at: string | null;
  first_seller_response_at: string | null;
  farewell_sent_at: string | null;
  closed_at: string | null;
};
export const WHATSAPP_AUTO_WELCOME =
  'Здравствуйте! 👋 Спасибо, что написали в Refocus. Мы свяжемся с вами в ближайшее время ✨';

export function isWhatsappTransferNotice(body: string | null): boolean {
  return /^Секунду, вас сейчас подключит оператор из филиала .+ 🙂$/u.test(body?.trim() || '');
}

export function isWhatsappInboundAcknowledgement(message: WhatsappStateMessage): boolean {
  return ['text', 'reaction'].includes(message.message_type) && isCustomerAcknowledgementOrPositiveClosure(message.body);
}

export function isWhatsappHumanResponse(message: WhatsappStateMessage, welcome = WHATSAPP_AUTO_WELCOME): boolean {
  return message.direction === 'outbound'
    && message.message_type === 'text'
    && !!message.body?.trim()
    && message.body.trim() !== welcome.trim()
    && !isWhatsappTransferNotice(message.body)
    && ['sent', 'delivered', 'read'].includes(message.status || '');
}

/** A failed attempt/automatic notice never resolves a question. */
export function deriveWhatsappThreadState(
  thread: WhatsappThreadSnapshot,
  messages: WhatsappStateMessage[],
  welcome = WHATSAPP_AUTO_WELCOME,
  now = Date.now(),
) {
  const ordered = [...messages].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
  let firstCustomer: string | null = null;
  let firstResponse: string | null = null;
  let pending: WhatsappStateMessage | null = null;
  let farewell: string | null = null;
  for (const message of ordered) {
    if (message.direction === 'inbound') {
      firstCustomer ||= message.created_at;
      const ack = isWhatsappInboundAcknowledgement(message);
      if (farewell && ack) continue;
      if (pending && thread.status === 'closed' && thread.closed_at
        && Date.parse(pending.created_at) <= Date.parse(thread.closed_at)
        && Date.parse(message.created_at) > Date.parse(thread.closed_at)) pending = null;
      // A final “спасибо” in the same unanswered burst must not hide the preceding
      // complaint. A media caption is not evidence that the attachment is an ACK.
      const replaceableGreeting = pending?.message_type === 'text' && isCustomerGreeting(pending.body);
      if (pending && !isWhatsappInboundAcknowledgement(pending) && !replaceableGreeting) continue;
      pending = message;
      farewell = null;
    } else if (isWhatsappHumanResponse(message, welcome)) {
      const isFarewell = isWhatsappFarewellMessage(message.body);
      if (isFarewell && pending && !isWhatsappInboundAcknowledgement(pending)) continue;
      if (firstCustomer) firstResponse ||= message.created_at;
      pending = null;
      farewell = isFarewell ? message.created_at : null;
    }
  }
  // Manual close is deliberate. Only a new inbound after closure may reopen it.
  const closed = thread.status === 'closed'
    && (!pending || !thread.closed_at || Date.parse(pending.created_at) <= Date.parse(thread.closed_at));
  const latest = ordered.at(-1)?.created_at || thread.last_message_at;
  return {
    first_customer_message_at: firstCustomer,
    first_seller_response_at: firstResponse,
    last_customer_message_at: pending?.created_at || null,
    farewell_sent_at: farewell,
    last_message_at: latest,
    status: closed ? 'closed' : pending ? 'waiting_seller' : 'waiting_customer',
    sla_breached: !closed && !!pending && now - Date.parse(pending.created_at) >= 20 * 60 * 1000,
    ...(firstCustomer ? { hidden_until_reply: false } : {}),
  };
}

const THREAD_FIELDS = 'id,status,updated_at,last_message_at,last_customer_message_at,first_customer_message_at,first_seller_response_at,farewell_sent_at,closed_at';
const MESSAGE_FIELDS = 'id,direction,message_type,body,status,created_at';

/** Optimistic compare-and-set protects newer inbound and user actions from late callbacks. */
export async function reconcileWhatsappThread(admin: SupabaseClient, threadId: string): Promise<void> {
  const { data: config, error: configError } = await admin.from('whatsapp_api_config')
    .select('auto_welcome_text').eq('id', 1).maybeSingle();
  if (configError) throw new Error(`Read WhatsApp welcome: ${configError.message}`);
  const welcome = config?.auto_welcome_text || WHATSAPP_AUTO_WELCOME;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: thread, error: threadError } = await admin.from('whatsapp_threads')
      .select(THREAD_FIELDS).eq('id', threadId).maybeSingle();
    if (threadError) throw new Error(`Read WhatsApp thread: ${threadError.message}`);
    if (!thread) return;
    const messages: WhatsappStateMessage[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from('whatsapp_messages').select(MESSAGE_FIELDS)
        .eq('thread_id', threadId).order('created_at').order('id').range(from, from + 999);
      if (error) throw new Error(`Read WhatsApp thread messages: ${error.message}`);
      messages.push(...(data || []) as WhatsappStateMessage[]);
      if (!data || data.length < 1000) break;
    }
    const patch = deriveWhatsappThreadState(thread as WhatsappThreadSnapshot, messages, welcome);
    let query = admin.from('whatsapp_threads').update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', threadId).eq('updated_at', thread.updated_at).eq('status', thread.status);
    for (const key of ['last_message_at', 'last_customer_message_at', 'farewell_sent_at', 'closed_at'] as const) {
      query = thread[key] == null ? query.is(key, null) : query.eq(key, thread[key]);
    }
    const { data: updated, error: updateError } = await query.select('id').maybeSingle();
    if (updateError) throw new Error(`Save WhatsApp thread state: ${updateError.message}`);
    if (updated) return;
  }
  throw new Error('WhatsApp thread changed during reconciliation; retry required');
}
