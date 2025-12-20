import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function md5hex(input: string) {
  return crypto.createHash('md5').update(input).digest('hex');
}

function buildSortedQuery(params: Record<string, string>) {
  const keys = Object.keys(params).sort((a, b) => a.localeCompare(b));
  return keys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k] ?? '')}`)
    .join('&');
}

/**
 * Zadarma API auth:
 * signature = base64( hmac_sha1( method + paramsStr + md5(paramsStr), secret ) )
 * Authorization: <API_KEY>:<signature>
 */
function makeAuthHeader(apiKey: string, apiSecret: string, methodPath: string, paramsStr: string) {
  const payload = `${methodPath}${paramsStr}${md5hex(paramsStr)}`;
  const signature = crypto.createHmac('sha1', apiSecret).update(payload).digest('base64');
  return `${apiKey}:${signature}`;
}

export async function GET() {
  try {
    const apiKey = (process.env.ZADARMA_API_KEY || '').trim();
    const apiSecret = (process.env.ZADARMA_API_SECRET || '').trim();

    // SIP можно хранить как публичный (для фронта) или как серверный.
    const sip =
      (process.env.NEXT_PUBLIC_ZADARMA_SIP || process.env.ZADARMA_SIP || '').trim();

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

    const methodPath = '/v1/webrtc/get_key/';

    // По докам у get_key обязательный параметр sip
    const paramsStr = buildSortedQuery({ format: 'json', sip });

    const url = `https://api.zadarma.com${methodPath}?${paramsStr}`;
    const authorization = makeAuthHeader(apiKey, apiSecret, methodPath, paramsStr);

    const r = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    // Zadarma иногда возвращает не-JSON на ошибках
    const text = await r.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    if (!r.ok) {
      return NextResponse.json(
        {
          error: `Zadarma HTTP ${r.status}`,
          raw: data ?? text,
          tried: { methodPath, paramsStr },
        },
        { status: 500 }
      );
    }

    if (!data || data.status !== 'success' || !data.key) {
      return NextResponse.json(
        { error: 'Unexpected Zadarma response', raw: data ?? text },
        { status: 500 }
      );
    }

    return NextResponse.json({ key: data.key, sip });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
