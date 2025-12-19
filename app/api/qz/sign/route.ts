// app/api/qz/sign/route.ts
import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function readPrivateKey(): string {
  // читаем ключ из /secure/qz-private-pk8.pem
  const p = path.join(process.cwd(), 'secure', 'qz-private-pk8.pem');
  return fs.readFileSync(p, 'utf8');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const data: unknown = (body as any).data;
    if (typeof data !== 'string' || !data.length) {
      return new Response(JSON.stringify({ error: 'Bad payload' }), { status: 400 });
    }

    const privateKey = readPrivateKey();

    const signer = crypto.createSign('sha512');
    signer.update(data);
    signer.end();

    const signature = signer.sign(privateKey, 'base64');

    return new Response(JSON.stringify({ signature }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'sign failed' }), { status: 500 });
  }
}
