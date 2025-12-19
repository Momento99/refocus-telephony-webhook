import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.ip ??
    '::1';

  const ua = req.headers.get('user-agent') ?? 'unknown';

  return NextResponse.json({
    ip,
    ua,
    now: new Date().toISOString(),
  });
}
