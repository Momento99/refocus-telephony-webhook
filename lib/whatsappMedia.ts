import type { SupabaseClient } from '@supabase/supabase-js';

export const WHATSAPP_MEDIA_BUCKET = 'whatsapp-media';
// The deployed Storage plan accepts at most 50 MiB per object.
export const WHATSAPP_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
const GRAPH_BASE = 'https://graph.facebook.com/v21.0';
const MEDIA_ID = /^\d{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const WHATSAPP_MEDIA_TYPES = ['image', 'audio', 'video', 'document', 'sticker'] as const;

type MediaPayload = { id?: string; mime_type?: string };
export type IncomingMediaMessage = {
  type: string;
  image?: MediaPayload;
  audio?: MediaPayload;
  video?: MediaPayload;
  document?: MediaPayload;
  sticker?: MediaPayload;
};

export class WhatsappMediaError extends Error {
  constructor(public code: string, public status: number, public retryable: boolean, message: string) {
    super(message);
    this.name = 'WhatsappMediaError';
  }
}

export function normalizeWhatsappMime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Reject CRLF/HTML and preserve a valid Ogg Opus codec parameter for the audio element.
  const mime = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*(?:\s*;\s*codecs\s*=\s*"?[a-z0-9., -]+"?)?$/.test(mime)) return null;
  const base = mime.split(';')[0];
  if (['text/html', 'image/svg+xml', 'application/xhtml+xml', 'application/javascript', 'text/javascript'].includes(base)) return null;
  return mime;
}

export function incomingWhatsappMedia(message: IncomingMediaMessage): { media_url: string; media_mime_type: string | null } | null {
  if (!WHATSAPP_MEDIA_TYPES.includes(message.type as typeof WHATSAPP_MEDIA_TYPES[number])) return null;
  const media = message[message.type as keyof IncomingMediaMessage] as MediaPayload | undefined;
  if (!media?.id || !MEDIA_ID.test(media.id)) return null;
  return { media_url: `whatsapp-media:${media.id}`, media_mime_type: normalizeWhatsappMime(media.mime_type) };
}

export function parseWhatsappMediaReference(reference: string | null | undefined):
  { kind: 'meta'; mediaId: string } | { kind: 'storage'; path: string } | null {
  if (!reference) return null;
  const meta = /^whatsapp-media:(\d{1,64})$/.exec(reference);
  if (meta) return { kind: 'meta', mediaId: meta[1] };
  const stored = /^whatsapp-storage:(messages\/[0-9a-f-]{36}\/\d{1,64}\.[a-z0-9]{1,8})$/i.exec(reference);
  if (stored && UUID.test(stored[1].split('/')[1])) return { kind: 'storage', path: stored[1] };
  return null;
}

export function isTrustedWhatsappMediaUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      (url.hostname === 'lookaside.fbsbx.com' || url.hostname.endsWith('.fbsbx.com') || url.hostname.endsWith('.fbcdn.net'));
  } catch { return false; }
}

function extensionFor(mime: string): string {
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
    'audio/aac': 'aac', 'audio/amr': 'amr', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
    'video/mp4': 'mp4', 'video/3gpp': '3gp', 'application/pdf': 'pdf', 'text/plain': 'txt',
  };
  return extensions[mime.split(';')[0]] || 'bin';
}

async function readLimited(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > WHATSAPP_MEDIA_MAX_BYTES) {
    await response.body?.cancel();
    throw new WhatsappMediaError('MEDIA_TOO_LARGE', 413, false, 'Размер вложения превышает 50 МБ.');
  }
  if (!response.body) throw new WhatsappMediaError('MEDIA_FETCH_FAILED', 502, true, 'Не удалось получить вложение.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > WHATSAPP_MEDIA_MAX_BYTES) {
      await reader.cancel();
      throw new WhatsappMediaError('MEDIA_TOO_LARGE', 413, false, 'Размер вложения превышает 50 МБ.');
    }
    chunks.push(value);
  }
  if (!size) throw new WhatsappMediaError('MEDIA_FETCH_FAILED', 502, true, 'WhatsApp вернул пустое вложение.');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function fetchMetaFile(url: string, accessToken: string, fetcher: typeof fetch): Promise<Response> {
  const signal = AbortSignal.timeout(30000);
  let current = url;
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!isTrustedWhatsappMediaUrl(current)) throw new WhatsappMediaError('MEDIA_FETCH_FAILED', 502, true, 'WhatsApp вернул некорректный адрес вложения.');
    const response = await fetcher(current, {
      headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store', redirect: 'manual', signal,
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const target = response.headers.get('location');
    await response.body?.cancel();
    if (!target || redirects === 3) throw new WhatsappMediaError('MEDIA_FETCH_FAILED', 502, true, 'Не удалось загрузить вложение из WhatsApp.');
    current = new URL(target, current).toString();
    // Validate the next hop before forwarding the server credential.
  }
  throw new WhatsappMediaError('MEDIA_FETCH_FAILED', 502, true, 'Не удалось загрузить вложение из WhatsApp.');
}

export async function downloadWhatsappMedia(
  mediaId: string,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (!MEDIA_ID.test(mediaId)) throw new WhatsappMediaError('MEDIA_NOT_AVAILABLE', 410, false, 'Вложение недоступно.');
  const headers = { Authorization: `Bearer ${accessToken}` };
  const infoResponse = await fetcher(`${GRAPH_BASE}/${mediaId}`, {
    headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!infoResponse.ok) {
    // Never surface the provider response: it can contain URLs or credential context.
    const failure = await infoResponse.json().catch(() => null);
    if (infoResponse.status === 404 || (infoResponse.status === 400 && Number(failure?.error?.code) === 100)) {
      throw new WhatsappMediaError('MEDIA_NOT_AVAILABLE', 410, false, 'WhatsApp больше не хранит это вложение. Попросите клиента отправить его ещё раз.');
    }
    throw new WhatsappMediaError('MEDIA_FETCH_FAILED', 502, true, 'Не удалось получить вложение из WhatsApp. Повторите попытку.');
  }
  const info = await infoResponse.json().catch(() => null);
  if (!info || !isTrustedWhatsappMediaUrl(info.url)) {
    throw new WhatsappMediaError('MEDIA_FETCH_FAILED', 502, true, 'WhatsApp не вернул адрес вложения.');
  }
  if (Number(info.file_size) > WHATSAPP_MEDIA_MAX_BYTES) {
    throw new WhatsappMediaError('MEDIA_TOO_LARGE', 413, false, 'Размер вложения превышает 50 МБ.');
  }
  const fileResponse = await fetchMetaFile(info.url, accessToken, fetcher);
  if (!fileResponse.ok) throw new WhatsappMediaError('MEDIA_FETCH_FAILED', 502, true, 'Не удалось загрузить вложение. Повторите попытку.');
  const mimeType = normalizeWhatsappMime(info.mime_type) || normalizeWhatsappMime(fileResponse.headers.get('content-type'));
  if (!mimeType) {
    await fileResponse.body?.cancel();
    throw new WhatsappMediaError('MEDIA_UNSUPPORTED', 415, false, 'Формат вложения не поддерживается.');
  }
  return { bytes: await readLimited(fileResponse), mimeType };
}

async function ensurePrivateBucket(admin: SupabaseClient) {
  const existing = await admin.storage.getBucket(WHATSAPP_MEDIA_BUCKET);
  if (!existing.error) {
    if (existing.data.public) throw new WhatsappMediaError('MEDIA_STORAGE_UNSAFE', 503, true, 'Хранилище вложений недоступно.');
    return;
  }
  const made = await admin.storage.createBucket(WHATSAPP_MEDIA_BUCKET, {
    public: false, fileSizeLimit: WHATSAPP_MEDIA_MAX_BYTES,
  });
  if (!made.error) return;
  // Concurrent webhook workers may both try to create the bucket.
  const retry = await admin.storage.getBucket(WHATSAPP_MEDIA_BUCKET);
  if (retry.error || retry.data.public) throw new WhatsappMediaError('MEDIA_STORAGE_FAILED', 503, true, 'Не удалось сохранить вложение.');
}

export async function archiveWhatsappMedia(
  admin: SupabaseClient,
  message: { id: string; media_url: string | null; media_mime_type?: string | null },
  fetcher: typeof fetch = fetch,
): Promise<{ media_url: string; media_mime_type: string | null }> {
  const ref = parseWhatsappMediaReference(message.media_url);
  if (!ref || !UUID.test(message.id)) throw new WhatsappMediaError('MEDIA_NOT_AVAILABLE', 410, false, 'Это вложение не сохранилось. Попросите клиента отправить его ещё раз.');
  if (ref.kind === 'storage') return { media_url: message.media_url!, media_mime_type: message.media_mime_type || null };
  const { data: config, error } = await admin.from('whatsapp_api_config').select('access_token').eq('id', 1).maybeSingle();
  if (error || !config?.access_token) throw new WhatsappMediaError('MEDIA_CONFIG_MISSING', 503, true, 'Подключение WhatsApp временно недоступно.');
  const file = await downloadWhatsappMedia(ref.mediaId, config.access_token, fetcher);
  await ensurePrivateBucket(admin);
  const objectPath = `messages/${message.id}/${ref.mediaId}.${extensionFor(file.mimeType)}`;
  const uploaded = await admin.storage.from(WHATSAPP_MEDIA_BUCKET).upload(objectPath, file.bytes, {
    contentType: file.mimeType, upsert: true, cacheControl: '3600',
  });
  if (uploaded.error) {
    const status = Number((uploaded.error as { statusCode?: string | number; status?: number }).statusCode || (uploaded.error as { status?: number }).status);
    if (status === 413) throw new WhatsappMediaError('MEDIA_TOO_LARGE', 413, false, 'Размер вложения превышает 50 МБ.');
    if (status === 415) throw new WhatsappMediaError('MEDIA_UNSUPPORTED', 415, false, 'Формат вложения не поддерживается.');
    throw new WhatsappMediaError('MEDIA_STORAGE_FAILED', 503, true, 'Не удалось сохранить вложение.');
  }
  const fields = { media_url: `whatsapp-storage:${objectPath}`, media_mime_type: file.mimeType };
  const updated = await admin.from('whatsapp_messages').update(fields).eq('id', message.id).eq('media_url', message.media_url!);
  if (updated.error) throw new WhatsappMediaError('MEDIA_STORAGE_FAILED', 503, true, 'Не удалось сохранить вложение.');
  return fields;
}

/** Called only after the message and its Meta ID are durable. Permanent media
 * errors must not cause Meta to resend a poison payload forever. Temporary
 * fetch/storage failures still propagate so the webhook returns a retriable 503. */
export async function archiveWhatsappMediaAfterReceive(
  admin: SupabaseClient,
  message: { id: string; media_url: string | null; media_mime_type?: string | null },
  fetcher: typeof fetch = fetch,
): Promise<{ archived: boolean; permanentError?: string }> {
  try {
    await archiveWhatsappMedia(admin, message, fetcher);
    return { archived: true };
  } catch (error) {
    if (error instanceof WhatsappMediaError && !error.retryable) return { archived: false, permanentError: error.code };
    throw error;
  }
}

export async function openArchivedWhatsappMedia(
  admin: SupabaseClient,
  message: { id: string; media_url: string | null; media_mime_type?: string | null },
  range: string | null,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const stored = await archiveWhatsappMedia(admin, message, fetcher);
  const ref = parseWhatsappMediaReference(stored.media_url);
  if (ref?.kind !== 'storage') throw new WhatsappMediaError('MEDIA_NOT_AVAILABLE', 410, false, 'Вложение недоступно.');
  const signed = await admin.storage.from(WHATSAPP_MEDIA_BUCKET).createSignedUrl(ref.path, 60);
  if (signed.error || !signed.data?.signedUrl) throw new WhatsappMediaError('MEDIA_STORAGE_FAILED', 503, true, 'Не удалось открыть вложение.');
  const headers: Record<string, string> = {};
  if (range) {
    if (!/^bytes=\d*-\d*$/.test(range) || range === 'bytes=-') throw new WhatsappMediaError('MEDIA_RANGE_INVALID', 416, false, 'Некорректный диапазон вложения.');
    headers.Range = range;
  }
  // Stream storage bytes rather than embedding tokens or a permanent public URL in the POS.
  const response = await fetcher(signed.data.signedUrl, {
    headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  if (!response.ok && response.status !== 416) throw new WhatsappMediaError('MEDIA_FETCH_FAILED', 502, true, 'Не удалось загрузить сохранённое вложение.');
  const outHeaders = new Headers({
    'Content-Type': normalizeWhatsappMime(stored.media_mime_type) || 'application/octet-stream',
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes', 'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  for (const key of ['Content-Length', 'Content-Range']) {
    const value = response.headers.get(key); if (value) outHeaders.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers: outHeaders });
}
