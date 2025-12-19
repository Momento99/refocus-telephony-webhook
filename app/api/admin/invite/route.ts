// app/api/admin/invite/route.ts
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

type Role = 'owner' | 'manager' | 'seller' | 'master';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email: string | undefined = body?.email;
    const branchId: number | undefined = body?.branchId ?? body?.branch_id;
    const role: Role | undefined = body?.role;
    const redirectTo: string | undefined =
      body?.redirectTo ?? `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/auth/callback`;

    if (!email || !branchId || !role) {
      return Response.json(
        { ok: false, error: 'email, branchId и role обязательны', received: body },
        { status: 400 }
      );
    }

    const admin = getSupabaseAdmin();

    // 1) Пытаемся отправить приглашение
    let invitedUserId: string | null = null;
    const { data: inviteData, error: inviteErr } =
      await admin.auth.admin.inviteUserByEmail(email, { redirectTo });

    if (!inviteErr && inviteData?.user?.id) {
      invitedUserId = inviteData.user.id;
    } else {
      // Пользователь мог уже существовать. Попробуем найти его по email.
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listErr) {
        // Ничего страшного — роль проставим позже, когда человек зайдёт, если не нашли id
      } else {
        const found = list.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
        if (found) invitedUserId = found.id;
      }
    }

    // 2) Проставляем роль сразу, если нашли user_id (если нет — можно будет повторить после первого входа)
    if (invitedUserId) {
      // сначала пробуем твою SQL-функцию `set_user_role`
      const { error: rpcErr } = await admin.rpc('set_user_role', {
        p_user_id: invitedUserId,
        p_branch_id: branchId,
        p_role: role,
      });

      if (rpcErr) {
        // запасной план: upsert напрямую
        const { error: upsertErr } = await admin
          .from('user_branch_roles')
          .upsert({ user_id: invitedUserId, branch_id: branchId, role }, { onConflict: 'user_id,branch_id' });

        if (upsertErr) {
          return Response.json(
            { ok: false, error: upsertErr.message || 'Не удалось присвоить роль' },
            { status: 500 }
          );
        }
      }
    }

    return Response.json({
      ok: true,
      invited: !inviteErr,
      userId: invitedUserId,
      note: invitedUserId
        ? 'Приглашение отправлено (или пользователь найден), роль проставлена'
        : 'Письмо отправлено, но user_id не найден — роль проставится, когда пользователь войдёт',
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'Server error' }, { status: 500 });
  }
}
