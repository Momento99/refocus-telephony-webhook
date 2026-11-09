import { NextResponse } from 'next/server';
import { requireCrmPermission } from '@/lib/crmAccessServer';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const gate = await requireCrmPermission('managerPlan');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const month = new URL(request.url).searchParams.get('month') || '';
  if (!/^(20\d{2})-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: 'Укажите месяц в формате ГГГГ-ММ' }, { status: 400 });
  }
  const { data, error } = await getSupabaseAdmin().rpc('get_manager_compensation', {
    p_month: month + '-01',
    p_auth_user_id: gate.role === 'owner' ? null : gate.user.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
}
