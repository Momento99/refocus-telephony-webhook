import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/api/admin/_requireOwner';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireOwner();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { data, error } = await getSupabaseAdmin().rpc('admin_roaming_staff');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data || [] }, { headers: { 'Cache-Control': 'private, no-store' } });
}
