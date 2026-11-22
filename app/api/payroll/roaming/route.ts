import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/api/admin/_requireOwner';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireOwner();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const db = getSupabaseAdmin();
  const [staff, candidates] = await Promise.all([
    db.rpc('admin_roaming_staff'),
    db.from('employees').select('id,full_name,branch_id').eq('role', 'promoter').eq('is_active', true).order('full_name'),
  ]);
  const error = staff.error || candidates.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: staff.data || [], candidates: candidates.data || [] }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export async function POST(request: Request) {
  const gate = await requireOwner();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const body = await request.json().catch(() => null);
  const employeeId = body?.employeeId;
  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : '';
  if (!Number.isSafeInteger(employeeId) || employeeId <= 0 || fullName.length < 2 || fullName.length > 120) {
    return NextResponse.json({ error: 'Выберите промоутера и укажите его имя (2–120 символов)' }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin().rpc('owner_enroll_roaming_promoter', {
    p_employee_id: employeeId,
    p_full_name: fullName,
  });
  if (error) {
    const statusByCode: Record<string, number> = { '22023': 400, '42501': 403, '23505': 409, '55000': 409, P0002: 404 };
    return NextResponse.json({ error: error.message }, { status: statusByCode[error.code] ?? 500 });
  }
  return NextResponse.json({ row: data });
}
