import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildQuery(params: Record<string, string>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) sp.set(k, v);
  return sp.toString();
}

/**
 * ВНИМАНИЕ:
 * Это шаблон подписания. Если у тебя уже есть рабочая подпись для других методов Zadarma — используй её.
 * Если API вернёт "Auth failed" — значит подпись/строка подписи должна быть другой (по их документации).
 */
function makeAuthHeader(userKey: string, secret: string, queryString: string) {
  const signature = crypto.createHmac('sha1', secret).update(queryString).digest('base64');
  return `${userKey}:${signature}`;
}

export async function GET() {
  try {
    const userKey = process.env.ZADARMA_API_KEY || '';
    const secret = process.env.ZADARMA_API_SECRET || '';
    const sip = process.env.NEXT_PUBLIC_ZADARMA_SIP || process.env.ZADARMA_SIP || '';

    if (!userKey || !secret) {
      return NextResponse.json(
        { error: 'Missing env: ZADARMA_API_KEY / ZADARMA_API_SECRET' },
        { status: 500 }
      );
    }

    // Обычно Zadarma принимает format=json
    const qs = buildQuery({ format: 'json' });
    const auth = makeAuthHeader(userKey, secret, qs);

    const url = `https://api.zadarma.com/v1/webrtc/get_key/?${qs}`;
    const r = await fetch(url, {
      headers: {
        Authorization: auth,
      },
      cache: 'no-store',
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return NextResponse.json(
        { error: data?.message || data?.error || `Zadarma HTTP ${r.status}`, raw: data },
        { status: 500 }
      );
    }

    // В ответе обычно есть поле с ключом. Если у тебя поле называется иначе — поправь тут.
    const key = data?.key || data?.result?.key;

    if (!key) {
      return NextResponse.json(
        { error: 'Zadarma response does not contain key', raw: data },
        { status: 500 }
      );
    }

    return NextResponse.json({ key, sip });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
