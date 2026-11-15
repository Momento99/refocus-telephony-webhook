import type { SupabaseClient } from '@supabase/supabase-js';
import { reconcileWhatsappThread } from './whatsappThreadState';
export { reconcileWhatsappThread } from './whatsappThreadState';

export type WhatsappDeliveryStatus = {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp?: string;
  errors?: Array<{
    code?: number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
  }>;
};

const PREVIOUS_STATUSES: Record<WhatsappDeliveryStatus['status'], string[]> = {
  sent: ['pending', 'sending', 'sent'],
  failed: ['pending', 'sending', 'sent', 'failed'],
  delivered: ['pending', 'sending', 'sent', 'failed', 'delivered'],
  read: ['pending', 'sending', 'sent', 'failed', 'delivered', 'read'],
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

type DeliveryPatch = ReturnType<typeof whatsappDeliveryPatch>;
type DeliveryReceipt = DeliveryPatch & { wa_message_id: string; provider_timestamp: string | null };
const RECEIPT_PRIORITY: Record<WhatsappDeliveryStatus['status'], number> = { sent: 0, failed: 1, delivered: 2, read: 3 };
let receiptSchemaWarningLogged = false;

function receiptSchemaUnavailable(error: { code?: string; message?: string }): boolean {
  if (!['42P01', 'PGRST205', 'PGRST204', 'PGRST202'].includes(error.code || '')) return false;
  if (!receiptSchemaWarningLogged) {
    console.warn('[whatsapp delivery] receipt migration is not available; using existing delivery path');
    receiptSchemaWarningLogged = true;
  }
  return true;
}

export async function persistWhatsappDeliveryReceipt(admin: SupabaseClient, event: WhatsappDeliveryStatus): Promise<boolean> {
  const seconds = event.timestamp == null ? NaN : Number(event.timestamp);
  const providerTime = Number.isFinite(seconds) && seconds > 0 && seconds < 253402300800
    ? new Date(seconds * 1000).toISOString() : null;
  const { error } = await admin.from('whatsapp_delivery_receipts').upsert({
    wa_message_id: event.id,
    ...whatsappDeliveryPatch(event),
    provider_timestamp: providerTime,
    received_at: new Date().toISOString(),
  }, { onConflict: 'wa_message_id,status' });
  if (error) {
    if (receiptSchemaUnavailable(error)) return false;
    throw new Error(`Persist WhatsApp delivery receipt: ${error.message}`);
  }
  return true;
}

async function applyDeliveryPatch(admin: SupabaseClient, providerId: string, patch: DeliveryPatch) {
  // A delayed 'sent' must never replace 'failed', 'delivered', or 'read'.
  const { error } = await admin.from('whatsapp_messages')
    .update(patch).eq('wa_message_id', providerId)
    .in('status', PREVIOUS_STATUSES[patch.status]);
  if (error) throw new Error(`Save WhatsApp delivery: ${error.message}`);

  // Re-read even for duplicate/older events to retry a previously failed queue update.
  const { data: message, error: readError } = await admin.from('whatsapp_messages')
    .select('id,thread_id').eq('wa_message_id', providerId).maybeSingle();
  if (readError) throw new Error(`Find WhatsApp delivery: ${readError.message}`);
  // The same WABA can send non-retail messages without a whatsapp_messages row.
  if (message) {
    await reconcileWhatsappQueue(admin, message.id);
    if (message.thread_id) await reconcileWhatsappThread(admin, message.thread_id);
  }
}

export async function applyWhatsappDeliveryStatus(admin: SupabaseClient, event: WhatsappDeliveryStatus) {
  if (!Object.hasOwn(RECEIPT_PRIORITY, event.status)) return;
  // Persist first, including unknown IDs (e.g. a callback that beat the send HTTP response).
  // Franchise IDs contain no retail message row; they remain metadata only until retention cleanup.
  await persistWhatsappDeliveryReceipt(admin, event);
  await applyDeliveryPatch(admin, event.id, whatsappDeliveryPatch(event));
}

/** Called after wa_message_id is committed, including API, template and retry paths. */
export async function replayWhatsappDeliveryReceipts(admin: SupabaseClient, providerId: string): Promise<boolean> {
  const { data, error } = await admin.from('whatsapp_delivery_receipts')
    .select('wa_message_id,status,provider_timestamp,error_code,error_message')
    .eq('wa_message_id', providerId).limit(4);
  if (error) {
    if (receiptSchemaUnavailable(error)) return false;
    throw new Error(`Read WhatsApp delivery receipts: ${error.message}`);
  }
  const receipts = ((data || []) as DeliveryReceipt[]).filter(r => Object.hasOwn(RECEIPT_PRIORITY, r.status))
    .sort((a, b) => RECEIPT_PRIORITY[a.status] - RECEIPT_PRIORITY[b.status]);
  const receipt = receipts.at(-1);
  if (!receipt) return false;
  // Apply the strongest recorded receipt; later 'failed' must not downgrade delivered/read.
  await applyDeliveryPatch(admin, providerId, {
    status: receipt.status, error_code: receipt.status === 'failed' ? receipt.error_code : null,
    error_message: receipt.status === 'failed' ? receipt.error_message : null,
  });
  return true;
}

export async function pruneWhatsappDeliveryReceipts(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin.rpc('whatsapp_prune_delivery_receipts', { p_limit: 500 });
  if (error) {
    if (receiptSchemaUnavailable(error)) return 0;
    throw new Error(`Prune WhatsApp delivery receipts: ${error.message}`);
  }
  return typeof data === 'number' ? data : 0;
}
