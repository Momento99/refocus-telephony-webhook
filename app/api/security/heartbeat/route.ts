import { NextRequest, NextResponse } from 'next/server';
import { requireCrmPermission } from '@/lib/crmAccessServer';

export async function GET(req: NextRequest) {
  const gate = await requireCrmPermission('orders');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    '::1';

  const ua = req.headers.get('user-agent') ?? 'unknown';

  return NextResponse.json({
    ip,
    ua,
    now: new Date().toISOString(),
  });
}
