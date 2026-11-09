import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/api/admin/_requireOwner';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const params = new URL(request.url).searchParams;
  const month = params.get('month') || '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 1) {
    return NextResponse.json({ error: 'Укажите месяц в формате ГГГГ-ММ' }, { status: 400 });
  }
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const employeeId = params.get('employeeId');
  const branchId = params.get('branchId');
  if ([employeeId, branchId].some(value => value !== null && (!/^\d+$/.test(value) || Number(value) < 1 || !Number.isSafeInteger(Number(value))))) {
    return NextResponse.json({ error: 'Некорректный сотрудник или филиал' }, { status: 400 });
  }
  const db = getSupabaseAdmin();
  let query = db.rpc('owner_payroll_daily_fixed', {
    p_from: month + '-01', p_to: month + '-' + String(lastDay).padStart(2, '0'),
  });
  if (employeeId) query = query.eq('employee_id', Number(employeeId));
  if (branchId) query = query.eq('branch_id', Number(branchId));
  let adjustments = db.from('v_payroll_adjustments_monthly')
    .select('employee_id,branch_id,month,adjustments_sum').eq('month', month + '-01');
  if (employeeId) adjustments = adjustments.eq('employee_id', Number(employeeId));
  if (branchId) adjustments = adjustments.eq('branch_id', Number(branchId));
  const [dailyResult, adjustmentResult, configResult, branchResult, employeeResult, profileResult] = await Promise.all([
    query.order('day', { ascending: true }), adjustments,
    db.from('payroll_config').select('*').limit(1).maybeSingle(),
    db.from('branches').select('id,name').order('id', { ascending: true }),
    db.from('employees').select('id,branch_id,full_name,role,hourly_rate,has_bonus,bonus_percent,is_active').order('id', { ascending: true }),
    db.from('employee_payroll_profiles').select('employee_id,bonus_per_order,active'),
  ]);
  const error = dailyResult.error || adjustmentResult.error || configResult.error
    || branchResult.error || employeeResult.error || profileResult.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    days: dailyResult.data || [], adjustments: adjustmentResult.data || [],
    cfg: configResult.data, branches: branchResult.data || [],
    employees: employeeResult.data || [], profiles: profileResult.data || [],
  }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
