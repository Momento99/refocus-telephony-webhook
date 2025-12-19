// app/api/admin/remove-user/route.ts
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId: string | undefined = body?.userId ?? body?.user_id;
    const branchId: number | undefined = body?.branchId ?? body?.branch_id;

    if (!userId || !branchId) {
      return Response.json(
        { ok: false, error: 'userId и branchId обязательны', received: body },
        { status: 400 }
      );
    }

    const admin = getSupabaseAdmin();

    // 1) Сначала пытаемся через твою защищённую SQL-функцию
    //    (должна внутри не позволять удалить последнего owner'а)
    let rpcOk = true;
    const { error: rpcErr } = await admin.rpc('remove_user_from_branch', {
      p_user_id: userId,
      p_branch_id: branchId,
    });

    if (rpcErr) rpcOk = false;

    if (!rpcOk) {
      // 2) Запасной простой вариант (без защиты от "последнего владельца"):
      const { error: delErr } = await admin
        .from('user_branch_roles')
        .delete()
        .eq('user_id', userId)
        .eq('branch_id', branchId);

      if (delErr) {
        return Response.json(
          { ok: false, error: delErr.message || rpcErr?.message || 'Не удалось удалить пользователя из филиала' },
          { status: 500 }
        );
      }
    }

    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'Server error' }, { status: 500 });
  }
}
