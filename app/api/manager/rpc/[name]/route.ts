import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireCrmPermission } from '@/lib/crmAccessServer';
import { getManagerRpcPermission, getManagerRpcTarget } from '@/lib/crmManagerRpc';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  const permission = getManagerRpcPermission(name);
  if (!permission) return NextResponse.json({ message: 'Недостаточно прав', code: '42501' }, { status: 403 });
  const gate = await requireCrmPermission(permission);
  if (!gate.ok) return NextResponse.json({ message: gate.error, code: '42501' }, { status: gate.status });
  if (gate.role !== 'manager' && gate.role !== 'owner') {
    return NextResponse.json({ message: 'Недостаточно прав', code: '42501' }, { status: 403 });
  }
  let args: Record<string, unknown>;
  try {
    args = await request.json();
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid body');
  } catch {
    return NextResponse.json({ message: 'Некорректный запрос', code: '22023' }, { status: 400 });
  }
  const target = gate.role === 'manager' ? getManagerRpcTarget(name) : name;
  if (target !== name) {
    args = { ...args, p_manager_user_id: gate.user.id };
    if (name.startsWith('pos_')) {
      for (const field of ['p_employee_id', 'p_pos_session_id', 'p_client_uuid']) {
        if (field in args) args[field] = null;
      }
    }
  }
  const rpc = getSupabaseAdmin().rpc(target, args);
  const { data, error } = await (request.headers.get('accept') === 'application/vnd.pgrst.object+json' ? rpc.single() : rpc);
  if (error) return NextResponse.json({ message: error.message, code: error.code }, { status: 400 });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
}
