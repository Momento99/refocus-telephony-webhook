export type Role = 'owner' | 'manager' | 'seller';

export type CrmPermission =
  | 'orders'
  | 'warehouse'
  | 'reconciliation'
  | 'statistics'
  | 'finance'
  | 'team360'
  | 'hqMaterials'
  | 'brandbook'
  | 'mobileApp'
  | 'employeeCalendar';

const PAGE_PERMISSIONS: Record<string, CrmPermission> = {
  '/orders': 'orders',
  '/new-order': 'orders',
  '/print/receipt': 'orders',
  '/warehouse': 'warehouse',
  '/finance/reconciliation': 'reconciliation',
  '/finance/overview': 'finance',
  '/admin/stats': 'statistics',
  '/admin/team': 'team360',
  '/admin/franchise-hq': 'hqMaterials',
  '/admin/brandbook': 'brandbook',
  '/admin/mobile-app': 'mobileApp',
  '/admin/employee-calendar': 'employeeCalendar',
};

const API_PERMISSIONS: Record<string, Partial<Record<string, CrmPermission>>> = {
  '/api/dashboard': { GET: 'statistics', POST: 'statistics' },
  '/api/dashboard/branches': { GET: 'statistics' },
  '/api/admin/mobile/overview': { GET: 'mobileApp' },
  '/api/admin/mobile/sync-stores': { POST: 'mobileApp' },
  '/api/admin/notifications': { GET: 'mobileApp', POST: 'mobileApp' },
  '/api/admin/notifications/dispatch': { POST: 'mobileApp' },
  '/api/brandbook/export-pdf': { POST: 'brandbook' },
  '/api/franchise-hq/export-pdf': { POST: 'hqMaterials' },
  '/api/security/heartbeat': { GET: 'orders' },
};

export function normalizeCrmRole(value: unknown): Role | null {
  return value === 'owner' || value === 'manager' || value === 'seller' ? value : null;
}

export function hasCrmPermission(role: string | null | undefined, permission: CrmPermission): boolean {
  if (role === 'owner' || role === 'manager') return true;
  return role === 'seller' && permission === 'orders';
}

function normalizedPath(pathname: string): string {
  try {
    const decoded = decodeURIComponent(pathname).replace(/\/+$/, '');
    if (/[\u0000-\u0020\u007f]/.test(decoded) || decoded.includes('\\') || decoded.includes('//') || /(^|\/)\.{1,2}(\/|$)/.test(decoded)) return '';
    return decoded || '/';
  } catch {
    return '';
  }
}

export function canAccessCrmPage(role: string | null | undefined, pathname: string): boolean {
  const path = normalizedPath(pathname);
  if (!path) return false;
  if (role === 'owner') return true;
  const permission = PAGE_PERMISSIONS[path] || (/^\/receipt\/[^/]+$/.test(path) ? 'orders' : undefined);
  return Boolean(permission && hasCrmPermission(role, permission));
}

export function getCrmApiPermission(pathname: string, method: string): CrmPermission | null {
  const path = normalizedPath(pathname);
  if (path === '/api/admin/team' && method === 'GET') return 'team360';
  if (/^\/api\/admin\/team\/\d+$/.test(path) && method === 'GET') return 'team360';
  return API_PERMISSIONS[path]?.[method.toUpperCase()] || null;
}

export function safeCrmRedirect(value: string | null | undefined, role: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\u0000-\u0020\u007f]/.test(value)) return '/orders';
  try {
    const target = new URL(value, 'https://crm.invalid');
    if (target.origin !== 'https://crm.invalid' || !canAccessCrmPage(role, target.pathname)) return '/orders';
    return target.pathname + target.search + target.hash;
  } catch {
    return '/orders';
  }
}
