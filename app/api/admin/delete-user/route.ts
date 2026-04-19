import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { requireOwner } from '../_requireOwner';

export async function POST(req: Request) {
  const gate = await requireOwner();
  if (!gate.ok) return Response.json({ ok: false, error: gate.error }, { status: gate.status });

  try {
    const body = await req.json().catch(() => ({}));
    const userId: string | undefined = body?.userId;
    if (!userId) return Response.json({ ok: false, error: 'userId обязателен' }, { status: 400 });

    const sb = getSupabaseServerClient();
    const { data: me } = await sb.auth.getUser();
    if (me?.user?.id === userId) {
      return Response.json({ ok: false, error: 'Нельзя удалить самого себя' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { data: target, error: getErr } = await admin.auth.admin.getUserById(userId);
    if (getErr || !target?.user) {
      return Response.json({ ok: false, error: getErr?.message || 'Пользователь не найден' }, { status: 404 });
    }

    if ((target.user.app_metadata as any)?.role === 'owner') {
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listErr) return Response.json({ ok: false, error: listErr.message }, { status: 500 });
      const owners = list.users.filter(u => (u.app_metadata as any)?.role === 'owner');
      if (owners.length <= 1) {
        return Response.json({ ok: false, error: 'Нельзя удалить единственного владельца' }, { status: 400 });
      }
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) return Response.json({ ok: false, error: delErr.message }, { status: 500 });

    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'Server error' }, { status: 500 });
  }
}
