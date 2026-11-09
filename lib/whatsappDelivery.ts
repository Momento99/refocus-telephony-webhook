import type { SupabaseClient } from '@supabase/supabase-js';

export type WhatsappDeliveryStatus = {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  errors?: Array<{
    code?: number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
  }>;
};

const PREVIOUS_STATUSES: Record<WhatsappDeliveryStatus['status'], string[]> = {
  sent: ['pending', 'sent'],
  failed: ['pending', 'sent', 'failed'],
  delivered: ['pending', 'sent', 'failed', 'delivered'],
  read: ['pending', 'sent', 'failed', 'delivered', 'read'],
};

export function orderReadySkipReason(
  order: { status: string; is_deleted: boolean | null; ready_at: string | null; delivered_at: string | null } | null,
  queuedAt: string,
  now = Date.now(),
): string | null {
  if (!order) return 'order_ready_order_missing';
  if (order.is_deleted) return 'order_ready_order_deleted';
  if (order.delivered_at || order.status === 'DELIVERED') return 'order_ready_already_delivered';
  if (order.status !== 'READY') return 'order_ready_order_not_ready';
  const readyAt = Date.parse(order.ready_at ?? '');
  const createdAt = Date.parse(queuedAt);
  if (!Number.isFinite(readyAt) || !Number.isFinite(createdAt)) return 'order_ready_missing_timestamp';
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  if (readyAt <= cutoff || createdAt <= cutoff) return 'order_ready_older_than_seven_days';
  return null;
}

export function whatsappDeliveryPatch(event: WhatsappDeliveryStatus) {
  const error = event.status === 'failed' ? event.errors?.[0] : undefined;
  const detail = error?.error_data?.details;
  const title = error?.title || error?.message;
  return {
    status: event.status,
    error_code: error?.code == null ? null : String(error.code),
    error_message: event.status === 'failed'
      ? [...new Set([title, detail].filter(Boolean))].join(': ') || 'WhatsApp delivery failed'
      : null,
  };
}

/** Also called after the scheduler links a message: its webhook may have arrived first. */
export async function reconcileWhatsappQueue(admin: SupabaseClient, messageId: string) {
  const { data: message, error } = await admin.from('whatsapp_messages')
    .select('status,error_code,error_message').eq('id', messageId).maybeSingle();
  if (error) throw new Error(`Read WhatsApp delivery: ${error.message}`);
  if (!message || !['failed', 'delivered', 'read'].includes(message.status)) return;

  // A delivery failure is terminal here. Retrying unpaid/old orders must be explicit.
  const failed = message.status === 'failed';
  let query = admin.from('whatsapp_followup_queue').update({
    status: failed ? 'failed' : 'sent',
    error_message: failed
      ? `WhatsApp delivery ${message.error_code || 'failed'}: ${message.error_message || 'Delivery failed'}`
      : null,
  }).eq('sent_message_id', messageId);

  if (failed) query = query.in('status', ['sent', 'failed']);
  else query = query.eq('status', 'failed').like('error_message', 'WhatsApp delivery %');

  const { error: queueError } = await query;
  if (queueError) throw new Error(`Save WhatsApp queue delivery: ${queueError.message}`);
}

export async function applyWhatsappDeliveryStatus(admin: SupabaseClient, event: WhatsappDeliveryStatus) {
  // A delayed 'sent' must never replace 'failed', 'delivered', or 'read'.
  const { error } = await admin.from('whatsapp_messages')
    .update(whatsappDeliveryPatch(event)).eq('wa_message_id', event.id)
    .in('status', PREVIOUS_STATUSES[event.status]);
  if (error) throw new Error(`Save WhatsApp delivery: ${error.message}`);

  // Re-read even for duplicate/older events to retry a previously failed queue update.
  const { data: message, error: readError } = await admin.from('whatsapp_messages')
    .select('id').eq('wa_message_id', event.id).maybeSingle();
  if (readError) throw new Error(`Find WhatsApp delivery: ${readError.message}`);
  // The same WABA can send non-retail messages without a whatsapp_messages row.
  if (message) await reconcileWhatsappQueue(admin, message.id);
}
