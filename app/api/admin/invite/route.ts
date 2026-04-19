import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireOwner } from '../_requireOwner';

type Role = 'owner' | 'manager' | 'seller';
const ROLES: Role[] = ['owner', 'manager', 'seller'];

export async function POST(req: Request) {
  const gate = await requireOwner();
  if (!gate.ok) return Response.json({ ok: false, error: gate.error }, { status: gate.status });

  try {
    const body = await req.json().catch(() => ({}));
    const email: string | undefined = body?.email?.trim().toLowerCase();
    const role: Role = ROLES.includes(body?.role) ? body.role : 'seller';
    const redirectTo: string =
      body?.redirectTo ?? `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/auth/callback`;

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return Response.json({ ok: false, error: 'Некорректный email' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    let userId: string | null = null;
    const { data: inviteData, error: inviteErr } =
      await admin.auth.admin.inviteUserByEmail(email, { redirectTo });

    if (!inviteErr && inviteData?.user?.id) {
      userId = inviteData.user.id;
    } else {
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listErr) return Response.json({ ok: false, error: listErr.message }, { status: 500 });
      const found = list.users.find(u => u.email?.toLowerCase() === email);
      if (found) userId = found.id;
    }

    if (!userId) {
      return Response.json({ ok: false, error: inviteErr?.message || 'Не удалось пригласить' }, { status: 500 });
    }

    const { data: target } = await admin.auth.admin.getUserById(userId);
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: { ...(target?.user?.app_metadata ?? {}), role },
    });
    if (updErr) return Response.json({ ok: false, error: updErr.message }, { status: 500 });

    return Response.json({ ok: true, userId, invited: !inviteErr });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'Server error' }, { status: 500 });
  }
}
