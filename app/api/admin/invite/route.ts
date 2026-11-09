import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { normalizeCrmRole } from '@/lib/crmAccess';
import { requireOwner } from '../_requireOwner';

async function findUserByEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < perPage) return null;
  }
}

function inviteRedirect(req: Request): string {
  let origin = new URL(req.url).origin;
  const configuredSite = process.env.NEXT_PUBLIC_SITE_URL;
  if (configuredSite) {
    const configured = new URL(configuredSite);
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname);
    if (configured.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && configured.protocol === 'http:')) {
      if (process.env.NODE_ENV !== 'production' || !isLocal) origin = configured.origin;
    }
  }
  return new URL('/auth/callback', origin).toString();
}

export async function POST(req: Request) {
  const gate = await requireOwner();
  if (!gate.ok) return Response.json({ ok: false, error: gate.error }, { status: gate.status });

  try {
    const body: { email?: unknown; role?: unknown } | null = await req.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = body?.role === undefined ? 'seller' : normalizeCrmRole(body.role);
    const redirectTo = inviteRedirect(req);

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return Response.json({ ok: false, error: 'Некорректный email' }, { status: 400 });
    }
    if (!role) {
      return Response.json({ ok: false, error: 'Некорректная роль (owner|manager|seller)' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const existing = await findUserByEmail(admin, email);
    const ownerPreserved = existing?.app_metadata?.role === 'owner';
    const effectiveRole = ownerPreserved ? 'owner' : role;

    const attributes = {
      role: effectiveRole === 'manager' ? 'crm_manager' : 'authenticated',
      app_metadata: { ...(existing?.app_metadata ?? {}), role: effectiveRole },
    };
    let user: User;
    if (existing) {
      const { data, error } = await admin.auth.admin.updateUserById(existing.id, attributes);
      if (error || !data.user) throw error ?? new Error('Не удалось обновить доступ');
      user = data.user;
    } else {
      const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: false, ...attributes });
      if (error || !data.user) throw error ?? new Error('Не удалось создать пользователя');
      user = data.user;
    }

    if (existing && (ownerPreserved || existing.email_confirmed_at || existing.invited_at)) {
      return Response.json({ ok: true, userId: user.id, role: effectiveRole, invited: false, ownerPreserved });
    }

    try {
      const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (error) throw error;
    } catch (error: unknown) {
      const inviteError = error instanceof Error ? error.message : 'Ошибка отправки приглашения';
      if (existing) {
        return Response.json({
          ok: false, userId: user.id, accessUpdated: true, invited: false,
          error: `Доступ обновлён, но приглашение не отправлено: ${inviteError}`,
        }, { status: 502 });
      }
      try {
        const { error: cleanupError } = await admin.auth.admin.deleteUser(user.id);
        if (cleanupError) throw cleanupError;
      } catch (cleanupError: unknown) {
        return Response.json({
          ok: false, userId: user.id, userCreated: true, invited: false, cleanupFailed: true,
          error: `Приглашение не отправлено: ${inviteError}. Не удалось удалить созданный аккаунт: ${cleanupError instanceof Error ? cleanupError.message : 'Ошибка удаления'}`,
        }, { status: 502 });
      }
      return Response.json({ ok: false, invited: false, error: inviteError }, { status: 502 });
    }

    return Response.json({ ok: true, userId: user.id, role: effectiveRole, invited: true });
  } catch (error: unknown) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 });
  }
}
