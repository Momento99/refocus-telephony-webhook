import 'server-only';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

export async function requireOwner(): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return { ok: false, status: 401, error: 'Не авторизован' };
  const role = (data.user.app_metadata as any)?.role;
  if (role !== 'owner') return { ok: false, status: 403, error: 'Недостаточно прав' };
  return { ok: true };
}
