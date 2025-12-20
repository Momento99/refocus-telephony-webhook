// app/api/telephony/zadarma/route.ts
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EVENTS_TABLE = 'telephony_events';
const CALLS_TABLE = 'telephony_calls';

// !!! Проверь и поправь под свои внутренние номера
const EXT_TO_BRANCH: Record<string, string> = {
  '101': 'Сокулук',
  '102': 'Беловодск',
  '103': 'Кара-Балта',
  '104': 'Кант',
  '105': 'Токмок',
};

function b64HmacSha1(payload: string, secret: string) {
  // Zadarma docs (PHP): base64_encode(hash_hmac('sha1', payload, secret))
  // PHP hash_hmac без raw_output => возвращает HEX строку, её и base64-ят.
  const hex = crypto.createHmac('sha1', secret).update(payload).digest('hex');
  return Buffer.from(hex, 'utf8').toString('base64');
}



function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a || '');
  const bb = Buffer.from(b || '');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function parseForm(bodyText: string) {
  const sp = new URLSearchParams(bodyText);
  const obj: Record<string, any> = {};
  for (const [k, v] of sp.entries()) obj[k] = v;
  return obj;
}

function normalizeCallStart(value: any): string | null {
  const s0 = String(value ?? '').trim();
  if (!s0) return null;

  // unix timestamp (sec/ms)
  if (/^\d+$/.test(s0)) {
    const n = Number(s0);
    if (!Number.isFinite(n)) return null;
    const ms = s0.length >= 13 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Zadarma часто шлёт "YYYY-MM-DD HH:mm:ss" без таймзоны.
  // По твоему кейсу это локальное время Бишкек. Принудительно считаем как +06:00.
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(s0)) {
    const isoLike = s0.replace(' ', 'T') + '+06:00';
    const d = new Date(isoLike);
    return Number.isNaN(d.getTime()) ? s0 : d.toISOString();
  }

  // если вдруг пришло "YYYY-MM-DD HH:mm"
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(s0)) {
    const isoLike = s0.replace(' ', 'T') + ':00+06:00';
    const d = new Date(isoLike);
    return Number.isNaN(d.getTime()) ? s0 : d.toISOString();
  }

  // ISO / прочее
  const d = new Date(s0);
  if (!Number.isNaN(d.getTime())) return d.toISOString();

  return s0;
}


function clean(v: any): string | null {
  const s = String(v ?? '').trim();
  return s ? s : null;
}

function inferDirection(event: string): 'in' | 'out' | null {
  if (!event) return null;
  if (event.startsWith('NOTIFY_OUT')) return 'out';
  if (event.startsWith('NOTIFY_')) return 'in';
  return null;
}

function inferStatus(event: string): string | null {
  switch (event) {
    case 'NOTIFY_START':
    case 'NOTIFY_OUT_START':
      return 'start';
    case 'NOTIFY_ANSWER':
      return 'answer';
    case 'NOTIFY_END':
    case 'NOTIFY_OUT_END':
      return 'end';
    default:
      return event ? event.toLowerCase() : null;
  }
}

function inferBranch(destination: string | null, internal: string | null): string | null {
  const key = (destination || internal || '').trim();
  return key ? EXT_TO_BRANCH[key] ?? null : null;
}

function computeExpectedSignature(event: string, data: Record<string, any>, apiSecret: string) {
  // подпись считаем от СЫРОГО data.call_start (как пришло)
  switch (event) {
    case 'NOTIFY_START':
    case 'NOTIFY_INTERNAL':
    case 'NOTIFY_END':
    case 'NOTIFY_IVR':
      return b64HmacSha1(`${data.caller_id || ''}${data.called_did || ''}${data.call_start || ''}`, apiSecret);

    case 'NOTIFY_ANSWER':
      return b64HmacSha1(`${data.caller_id || ''}${data.destination || ''}${data.call_start || ''}`, apiSecret);

    case 'NOTIFY_OUT_START':
    case 'NOTIFY_OUT_END':
      return b64HmacSha1(`${data.internal || ''}${data.destination || ''}${data.call_start || ''}`, apiSecret);

    case 'NOTIFY_RECORD':
      return b64HmacSha1(`${data.pbx_call_id || ''}${data.call_id_with_rec || ''}`, apiSecret);

    case 'CALL_TRACKING':
    case 'SMS':
      return b64HmacSha1(`${data.result || ''}`, apiSecret);

    default:
      return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const echo = url.searchParams.get('zd_echo');
  if (echo) return new Response(echo, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return new Response('OK', { status: 200 });
}

export async function POST(req: Request) {
  const apiSecret = process.env.ZADARMA_API_SECRET || '';
  if (!apiSecret) return new Response('Missing ZADARMA_API_SECRET', { status: 500 });

  const signatureHeader =
  (req.headers.get('Signature') || req.headers.get('signature') || '').trim();


  const contentType = req.headers.get('content-type') || '';
  let data: Record<string, any> = {};

  if (contentType.includes('application/json')) {
    data = (await req.json()) || {};
  } else {
    const bodyText = await req.text();
    data = parseForm(bodyText);
  }

  const event = String(data.event || '');
  const expected = computeExpectedSignature(event, data, apiSecret);
  const signature_ok = expected ? safeEqual(signatureHeader, expected) : null;

  const callStartIso = normalizeCallStart(data.call_start);

  const pbx_call_id = clean(data.pbx_call_id) || clean(data.call_id); // на всякий
  const caller_id = clean(data.caller_id);
  const called_did = clean(data.called_did);
  const destination = clean(data.destination);
  const internal = clean(data.internal);

  const direction = inferDirection(event);
  const status = inferStatus(event);
  const branch = inferBranch(destination, internal);

  const supabase = getSupabaseAdmin();

  // 1) пишем событие в telephony_events
  const eventRow = {
    provider: 'zadarma',
    event: event || null,
    pbx_call_id,
    call_start: callStartIso,
    caller_id,
    called_did,
    destination,
    internal,
    duration: data.duration ? Number(data.duration) : null,
    disposition: clean(data.disposition),
    status_code: clean(data.status_code),
    is_recorded: data.is_recorded ? String(data.is_recorded) === '1' : null,
    call_id_with_rec: clean(data.call_id_with_rec),
    signature_ok,
    payload: data, // jsonb
    received_at: new Date().toISOString(),
    processed: false,
    error: null,
  };

  const { data: inserted, error: insErr } = await supabase
    .from(EVENTS_TABLE)
    .insert(eventRow as any)
    .select('id')
    .single();

  if (insErr) {
    return new Response(`DB insert error: ${insErr.message}`, { status: 500 });
  }

  // 2) upsert агрегированной записи telephony_calls
  // если pbx_call_id отсутствует — просто оставим событие, но агрегировать нечего
  if (pbx_call_id) {
    const from_number =
      direction === 'in' ? caller_id : direction === 'out' ? internal : null;

    const to_number =
      direction === 'in' ? (called_did || destination) : direction === 'out' ? destination : null;

    const callRow = {
      provider: 'zadarma',
      pbx_call_id,
      call_id: pbx_call_id, // пока так, потом можно заменить если Zadarma даст отдельный call_id
      call_id_with_rec: clean(data.call_id_with_rec),
      event: event || null,
      event_type: event || null,
      direction,
      status,
      caller_id,
      called_did,
      internal,
      destination,
      from_number,
      to_number,
      branch,
      call_start: callStartIso,
      duration: data.duration ? Number(data.duration) : null,
      disposition: clean(data.disposition),
      status_code: clean(data.status_code),
      is_recorded: data.is_recorded ? String(data.is_recorded) === '1' : null,
      signature_ok,
      last_event_at: new Date().toISOString(),
      payload: data,
      updated_at: new Date().toISOString(),
    };

    const { error: upErr } = await supabase
      .from(CALLS_TABLE)
      .upsert(callRow as any, { onConflict: 'pbx_call_id' });

    if (upErr) {
      await supabase
        .from(EVENTS_TABLE)
        .update({ error: `telephony_calls upsert error: ${upErr.message}`, processed: false })
        .eq('id', inserted.id);

      return new Response(`telephony_calls upsert error: ${upErr.message}`, { status: 500 });
    }

    await supabase
      .from(EVENTS_TABLE)
      .update({ processed: true, error: null })
      .eq('id', inserted.id);
  }

  return new Response('OK', { status: 200 });
}
