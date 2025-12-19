// app/api/admin/change-role/route.ts
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

type Role = 'owner' | 'manager' | 'seller' | 'master';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId: string | undefined = body?.userId ?? body?.user_id;
    const branchId: number | undefined = body?.branchId ?? body?.branch_id;
    const role: Role | undefined = body?.role;

    if (!userId || !branchId || !role) {
      return Response.json(
        { ok: false, error: 'userId, branchId и role обязательны', received: body },
        { status: 400 }
      );
    }

    const admin = getSupabaseAdmin();

    // 1) Пробуем твою безопасную функцию (если есть)
    const { error: rpcErr } = await admin.rpc('set_user_role', {
      p_user_id: userId,
      p_branch_id: branchId,
      p_role: role,
    });

    if (rpcErr) {
      // 2) Запасной вариант — обычный upsert
      const { error: upsertErr } = await admin
        .from('user_branch_roles')
        .upsert({ user_id: userId, branch_id: branchId, role }, { onConflict: 'user_id,branch_id' });

      if (upsertErr) {
        return Response.json(
          { ok: false, error: upsertErr.message || rpcErr.message || 'Не удалось обновить роль' },
          { status: 500 }
        );
      }
    }

    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'Server error' }, { status: 500 });
  }
}
