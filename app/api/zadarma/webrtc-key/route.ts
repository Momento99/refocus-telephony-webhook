// app/api/zadarma/webrtc-key/route.ts
import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ZadarmaJson = Record<string, any>;

function buildSortedQuery(params: Record<string, string>) {
  const keys = Object.keys(params).sort();
  const sp = new URLSearchParams();
  for (const k of keys) sp.set(k, params[k]);
  return sp.toString();
}

function hmacSha1Base64(secret: string, payload: string) {
  return crypto.createHmac('sha1', secret).update(payload).digest('base64');
}

function md5Hex(payload: string) {
  return crypto.createHash('md5').update(payload).digest('hex');
}

function isAuthFail(r: Response, data: any) {
  const msg =
    String(data?.message ?? data?.error ?? data?.status ?? '').toLowerCase();
  return r.status === 401 || msg.includes('auth') || msg.includes('unauthorized');
}

async function fetchJson(r: Response): Promise<ZadarmaJson> {
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function GET() {
  try {
    const userKey = process.env.ZADARMA_API_KEY || '';
    const secret = process.env.ZADARMA_API_SECRET || '';
    const sip =
      process.env.ZADARMA_SIP ||
      process.env.NEXT_PUBLIC_ZADARMA_SIP ||
      '';

    if (!userKey || !secret) {
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

    // В Zadarma этот метод принимает sip + format
    const params = {
      format: 'json',
      sip: sip,
    };

    const qs = buildSortedQuery(params);
    const path = '/v1/webrtc/get_key/';
    const url = `https://api.zadarma.com${path}?${qs}`;

    // Пробуем несколько вариантов подписи (встречаются разные у Zadarma SDK/примеров)
    const variants: Array<{ name: string; payload: string }> = [
      { name: 'qs', payload: qs },
      { name: 'path+qs', payload: `${path}?${qs}` },
      { name: 'GET+path+qs', payload: `GET${path}?${qs}` },
      { name: 'md5(qs)', payload: md5Hex(qs) },
      { name: 'md5(path+qs)', payload: md5Hex(`${path}?${qs}`) },
    ];

    let last: { status: number; data: any; used: string } | null = null;

    for (const v of variants) {
      const signature = hmacSha1Base64(secret, v.payload);
      const auth = `${userKey}:${signature}`;

      const r = await fetch(url, {
        headers: { Authorization: auth },
        cache: 'no-store',
      });

      const data = await fetchJson(r);
      last = { status: r.status, data, used: v.name };

      // Успешный ответ
      if (r.ok) {
        const key = data?.key ?? data?.result?.key ?? data?.data?.key;
        if (!key) {
          return NextResponse.json(
            { error: 'Zadarma response does not contain key', raw: data },
            { status: 500 }
          );
        }

        return NextResponse.json(
          { key, sip },
          {
            status: 200,
            headers: {
              'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            },
          }
        );
      }

      // Если это не “Auth failed”, то дальше перебирать подписи бессмысленно
      if (!isAuthFail(r, data)) {
        return NextResponse.json(
          {
            error: `Zadarma HTTP ${r.status}`,
            hint: 'Non-auth error; check params/sip/account settings.',
            raw: data,
            tried: v.name,
          },
          { status: 500 }
        );
      }
      // иначе продолжаем — пробуем следующую подпись
    }

    return NextResponse.json(
      {
        error: 'Auth failed for all signature variants',
        last_tried: last?.used,
        last_status: last?.status,
        last_raw: last?.data,
      },
      { status: 500 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
