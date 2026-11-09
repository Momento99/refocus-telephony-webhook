import 'server-only';
import { getCurrentUser } from '@/lib/getUserRole';
import { hasCrmPermission, normalizeCrmRole, type CrmPermission } from '@/lib/crmAccess';

export async function requireCrmPermission(permission: CrmPermission) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, status: 401, error: 'Не авторизован' };
  const role = normalizeCrmRole(user.app_metadata?.role) || 'seller';
  if (!hasCrmPermission(role, permission)) {
    return { ok: false as const, status: 403, error: 'Недостаточно прав' };
  }
  return { ok: true as const, user, role };
}
