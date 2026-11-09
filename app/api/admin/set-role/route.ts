import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { normalizeCrmRole } from '@/lib/crmAccess';
import { requireOwner } from '../_requireOwner';

export async function POST(req: Request) {
  const gate = await requireOwner();
  if (!gate.ok) return Response.json({ ok: false, error: gate.error }, { status: gate.status });

  try {
    const body: { userId?: unknown; role?: unknown } | null = await req.json().catch(() => null);
    const userId = typeof body?.userId === 'string' ? body.userId : '';
    const role = normalizeCrmRole(body?.role);

    if (!userId || !role) {
      return Response.json({ ok: false, error: 'userId и role обязательны (owner|manager|seller)' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { data: target, error: getErr } = await admin.auth.admin.getUserById(userId);
    if (getErr || !target?.user) {
      return Response.json({ ok: false, error: getErr?.message || 'Пользователь не найден' }, { status: 404 });
    }

    if (role !== 'owner' && target.user.app_metadata?.role === 'owner') {
      let owners = 0;
      const perPage = 1000;
      for (let page = 1; owners < 2; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
        if (error) throw error;
        owners += data.users.filter((user) => user.app_metadata?.role === 'owner').length;
        if (data.users.length < perPage) break;
      }
      if (owners <= 1) {
        return Response.json({ ok: false, error: 'Нельзя понизить единственного владельца' }, { status: 400 });
      }
    }

    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      role: role === 'manager' ? 'crm_manager' : 'authenticated',
      app_metadata: { ...(target.user.app_metadata ?? {}), role },
    });
    if (updErr) return Response.json({ ok: false, error: updErr.message }, { status: 500 });

    return Response.json({ ok: true });
  } catch (error: unknown) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 });
  }
}
