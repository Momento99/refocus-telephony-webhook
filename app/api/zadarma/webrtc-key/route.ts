// app/api/zadarma/webrtc-key/route.ts
import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildQuery(params: Record<string, string>) {
  // Zadarma обычно ожидает детерминированный порядок параметров
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && String(v).length > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  const sp = new URLSearchParams();
  for (const [k, v] of entries) sp.set(k, v);
  return sp.toString(); // важно: URLSearchParams кодирует пробелы как '+', как в PHP http_build_query
}

// Вариант подписи как в примерах Zadarma:
// signature = base64( hmac_sha1( method + paramsStr + md5(paramsStr) ) )
// В PHP это выглядит как base64_encode(hash_hmac('sha1', ..., secret))
function makeAuthHeader(apiKey: string, apiSecret: string, methodPath: string, paramsStr: string) {
  const md5 = crypto.createHash('md5').update(paramsStr).digest('hex');
  const payload = `${methodPath}${paramsStr}${md5}`;

  // Важно: в PHP base64_encode применяется к строке, которую вернул hash_hmac (обычно hex-строка).
  // Поэтому делаем digest('hex') и base64 от ASCII-строки hex.
  const hmacHex = crypto.createHmac('sha1', apiSecret).update(payload).digest('hex');
  const signature = Buffer.from(hmacHex, 'utf8').toString('base64');

  return `${apiKey}:${signature}`;
}

async function callZadarmaGetKey(apiKey: string, apiSecret: string, sipLogin: string) {
  // Попробуем оба варианта пути (с / на конце и без) — у некоторых методов это критично.
  const paths = ['/v1/webrtc/get_key/', '/v1/webrtc/get_key'];

  const qs = buildQuery({
    format: 'json',
    sip: sipLogin, // SIP login внутреннего номера (например 542691-100)
  });

  let last: any = null;

  for (const methodPath of paths) {
    const auth = makeAuthHeader(apiKey, apiSecret, methodPath, qs);
    const url = `https://api.zadarma.com${methodPath}?${qs}`;

    const r = await fetch(url, {
      headers: {
        Authorization: auth,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const text = await r.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw_text: text };
    }

    if (r.ok) return { ok: true, status: r.status, data, tried: methodPath };

    last = { ok: false, status: r.status, data, tried: methodPath };

    // Если это НЕ 401, нет смысла пробовать другой path
    if (r.status !== 401) break;
  }

  return last ?? { ok: false, status: 0, data: null, tried: null };
}

export async function GET() {
  try {
    const apiKey = process.env.ZADARMA_API_KEY || '';
    const apiSecret = process.env.ZADARMA_API_SECRET || '';

    const sip =
      process.env.NEXT_PUBLIC_ZADARMA_SIP ||
      process.env.ZADARMA_SIP ||
      '';

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { error: 'Missing env: ZADARMA_API_KEY / ZADARMA_API_SECRET' },
        { status: 500 }
      );
    }

    if (!sip) {
      return NextResponse.json(
        { error: 'Missing env: ZADARMA_SIP (or NEXT_PUBLIC_ZADARMA_SIP)' },
        { status: 500 }
      );
    }

    const res = await callZadarmaGetKey(apiKey, apiSecret, sip);

    if (!res?.ok) {
      return NextResponse.json(
        {
          error: 'Auth failed for Zadarma get_key',
          last_status: res?.status,
          last_tried: res?.tried,
          last_raw: res?.data,
        },
        { status: 500 }
      );
    }

    // В ответах Zadarma часто key лежит в data.key, иногда глубже
    const key =
      res?.data?.key ??
      res?.data?.result?.key ??
      res?.data?.data?.key ??
      null;

    if (!key) {
      return NextResponse.json(
        { error: 'Zadarma response does not contain key', raw: res?.data },
        { status: 500 }
      );
    }

    return NextResponse.json({ key, sip });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
