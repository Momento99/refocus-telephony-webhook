// app/api/zadarma/webrtc-key/route.ts
import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = 'https://api.zadarma.com';
const PATH = '/v1/webrtc/get_key/';

function toQS(params: Record<string, string>) {
  const sp = new URLSearchParams();
  // стабильный порядок (на будущее)
  for (const k of Object.keys(params).sort()) sp.set(k, params[k]);
  return sp.toString();
}

function hmacB64(secret: string, payload: string) {
  return crypto.createHmac('sha1', secret).update(payload).digest('base64');
}

function makeAuthHeader(userKey: string, secret: string, payload: string) {
  return `${userKey}:${hmacB64(secret, payload)}`;
}

function extractKey(data: any): string | null {
  return (
    data?.key ??
    data?.result?.key ??
    data?.response?.key ??
    data?.data?.key ??
    null
  );
}

function looksLikeAuthError(data: any, status: number) {
  const msg = String(data?.message || data?.error || data?.description || '').toLowerCase();
  return status === 401 || status === 403 || msg.includes('auth') || msg.includes('sign') || msg.includes('signature');
}

async function callZadarma(
  userKey: string,
  secret: string,
  qs: string,
  payloadBuilders: Array<(qs: string) => string>
) {
  const url = `${API_BASE}${PATH}?${qs}`;

  let lastStatus = 0;
  let lastRaw: any = null;

  for (const buildPayload of payloadBuilders) {
    const payload = buildPayload(qs);
    const auth = makeAuthHeader(userKey, secret, payload);

    const r = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: auth,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    lastStatus = r.status;

    const text = await r.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw_text: text };
    }
    lastRaw = data;

    if (r.ok) return { ok: true as const, data };

    // если это НЕ похоже на Auth-проблему — дальше пробовать другие подписи смысла мало
    if (!looksLikeAuthError(data, r.status)) {
      return { ok: false as const, status: r.status, data };
    }
    // иначе пробуем следующий вариант подписи
  }

  return { ok: false as const, status: lastStatus || 500, data: lastRaw };
}

export async function GET(req: Request) {
  try {
    // ключ/секрет — строго серверные env
    const userKey = process.env.ZADARMA_API_KEY || '';
    const secret = process.env.ZADARMA_API_SECRET || '';

    // SIP можно отдавать фронту (для виджета), но секреты — никогда
    const sip = process.env.ZADARMA_SIP || process.env.NEXT_PUBLIC_ZADARMA_SIP || '';

    if (!userKey || !secret) {
      return NextResponse.json(
        { error: 'Missing env: ZADARMA_API_KEY / ZADARMA_API_SECRET' },
        { status: 500 }
      );
    }

    const url = new URL(req.url);
    const debug = url.searchParams.get('debug') === '1';

    // большинство ответов Zadarma умеет формат json
    const qs = toQS({ format: 'json' });

    // Zadarma в разных примерах встречается с разными “строками подписи”.
    // Поэтому пробуем несколько вариантов. Первый — самый частый (HMAC от querystring).
    const payloadBuilders: Array<(qs: string) => string> = [
      (q) => q,                                // v1: только querystring
      (q) => `GET\n${PATH}\n${q}`,              // v2: метод + path + qs
      (q) => `GET\n${API_BASE.replace('https://', '')}\n${PATH}\n${q}`, // v3: с хостом
      (q) => `GET${PATH}?${q}`,                 // v4: "GET/path?qs"
    ];

    const result = await callZadarma(userKey, secret, qs, payloadBuilders);

    if (!result.ok) {
      return NextResponse.json(
        {
          error: `Zadarma HTTP ${result.status}`,
          raw: debug ? result.data : undefined, // raw показываем только если debug=1
        },
        { status: 500 }
      );
    }

    const key = extractKey(result.data);
    if (!key) {
      return NextResponse.json(
        {
          error: 'Zadarma response does not contain key',
          raw: debug ? result.data : undefined,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ key, sip });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
