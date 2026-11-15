import type { SupabaseClient } from '@supabase/supabase-js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type WhatsappMediaActor = { owner: true } | { owner: false; employeeId: number; branchId: number };
export type WhatsappMediaAccess =
  { ok: true; actor: WhatsappMediaActor } |
  { ok: false; status: number; error: string; message: string };

export async function authorizeWhatsappMedia(request: Request, admin: SupabaseClient): Promise<WhatsappMediaAccess> {
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer) {
    const { data, error } = await admin.auth.getUser(bearer);
    if (!error && data.user?.app_metadata?.role === 'owner') return { ok: true, actor: { owner: true } };
  }
  const sessionId = request.headers.get('x-pos-session-id')?.trim() || '';
  const clientUuid = request.headers.get('x-pos-client-uuid')?.trim() || '';
  const terminalCode = request.headers.get('x-terminal-code')?.trim() || '';
  if ((!/^[1-9]\d{0,17}$/.test(sessionId) && !UUID.test(sessionId)) || !UUID.test(clientUuid) ||
      !terminalCode || terminalCode.length > 128) {
    return { ok: false, status: 401, error: 'AUTH_REQUIRED', message: 'Откройте смену на кассе, чтобы посмотреть вложение.' };
  }
  const result = await admin.rpc('whatsapp_authorize_pos', {
    p_pos_session_id: sessionId, p_client_uuid: clientUuid, p_terminal_code: terminalCode,
  });
  if (result.error) {
    const denied = result.error.code === '42501' || result.error.code === '22P02';
    return denied
      ? { ok: false, status: 401, error: 'AUTH_REQUIRED', message: 'Войдите в кассу по личному PIN ещё раз, чтобы открыть вложение.' }
      : { ok: false, status: 503, error: 'MEDIA_ACCESS_UNAVAILABLE', message: 'Вложения временно недоступны. Повторите попытку позже.' };
  }
  const actor = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!Number.isSafeInteger(Number(actor?.employee_id)) || Number(actor?.employee_id) <= 0 ||
      !Number.isSafeInteger(Number(actor?.branch_id)) || Number(actor?.branch_id) <= 0) {
    return { ok: false, status: 403, error: 'ACCESS_DENIED', message: 'Нет доступа к вложению.' };
  }
  return { ok: true, actor: { owner: false, employeeId: Number(actor.employee_id), branchId: Number(actor.branch_id) } };
}

export function canReadWhatsappMedia(actor: WhatsappMediaActor, threadBranchId: number | null): boolean {
  return actor.owner || threadBranchId == null || actor.branchId === threadBranchId;
}

export function whatsappMediaCors(headers: Headers): void {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, X-Pos-Session-Id, X-Pos-Client-Uuid, X-Terminal-Code, Range');
  headers.set('Access-Control-Expose-Headers', 'Content-Type, Content-Length, Content-Range, Accept-Ranges');
  headers.set('Cache-Control', 'private, no-store');
}
