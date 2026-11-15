import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { authorizeWhatsappMedia, canReadWhatsappMedia, whatsappMediaCors } from '@/lib/whatsappMediaAuth';
import { openArchivedWhatsappMedia, WhatsappMediaError, WHATSAPP_MEDIA_TYPES } from '@/lib/whatsappMedia';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function jsonError(status: number, error: string, message: string): Response {
  const response = Response.json({ ok: false, error, message }, { status });
  whatsappMediaCors(response.headers);
  return response;
}

export function OPTIONS() {
  const response = new Response(null, { status: 204 });
  whatsappMediaCors(response.headers);
  return response;
}

export async function GET(request: Request) {
  try {
    const admin = getSupabaseAdmin();
    const access = await authorizeWhatsappMedia(request, admin);
    if (!access.ok) return jsonError(access.status, access.error, access.message);
    const id = new URL(request.url).searchParams.get('message_id') || '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return jsonError(400, 'BAD_MESSAGE_ID', 'Вложение не найдено.');
    }
    const { data: message, error } = await admin.from('whatsapp_messages')
      .select('id,thread_id,direction,message_type,media_url,media_mime_type,thread:whatsapp_threads!inner(branch_id)')
      .eq('id', id).maybeSingle();
    if (error) return jsonError(503, 'MEDIA_FETCH_FAILED', 'Не удалось открыть вложение. Повторите попытку.');
    if (!message) return jsonError(404, 'MEDIA_NOT_FOUND', 'Вложение не найдено.');
    const thread = Array.isArray(message.thread) ? message.thread[0] : message.thread;
    if (!thread || !canReadWhatsappMedia(access.actor, thread.branch_id)) {
      return jsonError(403, 'ACCESS_DENIED', 'Нет доступа к этому диалогу.');
    }
    if (message.direction !== 'inbound' || !WHATSAPP_MEDIA_TYPES.includes(message.message_type as typeof WHATSAPP_MEDIA_TYPES[number])) {
      return jsonError(404, 'MEDIA_NOT_FOUND', 'Вложение не найдено.');
    }
    if (!message.media_url) {
      return jsonError(410, 'MEDIA_NOT_AVAILABLE', 'Это вложение получено до обновления и не сохранилось. Попросите клиента отправить его ещё раз.');
    }
    const response = await openArchivedWhatsappMedia(admin, message, request.headers.get('range'));
    whatsappMediaCors(response.headers);
    return response;
  } catch (error) {
    if (error instanceof WhatsappMediaError) return jsonError(error.status, error.code, error.message);
    // Avoid propagating signed storage URLs or Meta access tokens from fetch errors.
    console.error('[whatsapp media] request failed');
    return jsonError(503, 'MEDIA_FETCH_FAILED', 'Не удалось загрузить вложение. Повторите попытку.');
  }
}
