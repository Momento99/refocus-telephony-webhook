import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { canAccessCrmPage, getCrmApiPermission, hasCrmPermission, normalizeCrmRole } from '@/lib/crmAccess';
import { getManagerRpcPermission } from '@/lib/crmManagerRpc';

const PUBLIC_PAGES = new Set(['/login', '/auth/callback']);
const PUBLIC_FILES = new Set([
  '/favicon.ico', '/robots.txt', '/sitemap.xml', '/file.svg', '/globe.svg',
  '/next.svg', '/vercel.svg', '/window.svg', '/qz-public.pem', '/refocus-watcher.bat',
]);
const PUBLIC_ASSET_PATH = /^\/(?:brand|fonts|franchise|franchise-schemas|geo|pos)\/.+\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|woff|woff2|ttf|otf|mp4|webm|pdf|json)$/i;
const WEBHOOKS = new Set(['/api/whatsapp/webhook', '/api/instagram/webhook', '/api/telephony/zadarma']);
// Installed POS clients trigger delivery of an already queued message by UUID.
const LEGACY_POS_SEND_ROUTES = new Set(['/api/whatsapp/send', '/api/instagram/send']);
const MACHINE_ROUTES: Record<string, string[]> = {
  '/api/cron/weekly-recap': ['CRON_SECRET'],
  '/api/cron/weather-sync': ['CRON_SECRET'],
  '/api/admin/whatsapp/enqueue-aftercare': ['WHATSAPP_CRON_SECRET', 'CRON_SECRET'],
  '/api/admin/whatsapp/analyze-weekly': ['WHATSAPP_CRON_SECRET', 'CRON_SECRET'],
  '/api/admin/whatsapp/analyze-daily': ['WHATSAPP_CRON_SECRET', 'CRON_SECRET'],
  '/api/admin/whatsapp/analyze': ['CRON_SECRET'],
  '/api/admin/whatsapp/scheduler': ['WHATSAPP_CRON_SECRET', 'CRON_SECRET'],
  '/api/admin/instagram/analyze-weekly': ['WHATSAPP_CRON_SECRET', 'CRON_SECRET'],
  '/api/admin/instagram/analyze-daily': ['WHATSAPP_CRON_SECRET', 'CRON_SECRET'],
  '/api/admin/instagram/analyze': ['CRON_SECRET'],
  '/api/admin/franchise/reminder-dispatcher': ['WHATSAPP_CRON_SECRET', 'CRON_SECRET'],
  '/api/admin/franchise/stale-detector': ['WHATSAPP_CRON_SECRET', 'CRON_SECRET'],
  '/api/admin/franchise/whatsapp-sender': ['WHATSAPP_CRON_SECRET', 'CRON_SECRET'],
  '/api/admin/mobile/sync-stores': ['WHATSAPP_CRON_SECRET', 'CRON_SECRET'],
  '/api/admin/notifications/dispatch': ['NOTIFICATIONS_CRON_SECRET'],
  '/api/admin/notifications/checkup-cron': ['NOTIFICATIONS_CRON_SECRET'],
};

function hasMachineCredential(request: NextRequest): boolean {
  return (MACHINE_ROUTES[request.nextUrl.pathname] || []).some(name => {
    const secret = process.env[name];
    return Boolean(secret && (
      request.headers.get('authorization') === 'Bearer ' + secret ||
      request.headers.get('x-cron-secret') === secret ||
      request.nextUrl.searchParams.get('secret') === secret
    ));
  });
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname.replace(/\/+$/, '') || '/';
  if (PUBLIC_FILES.has(pathname) || PUBLIC_ASSET_PATH.test(pathname) || pathname === '/pos/login' || pathname === '/pos/customer' || WEBHOOKS.has(pathname) || hasMachineCredential(request)) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: cookies => {
          for (const { name, value } of cookies) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookies) response.cookies.set(name, value, options);
        },
      },
    }
  );
  const authorization = request.headers.get('authorization');
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const { data, error } = await supabase.auth.getUser(token);
  const user = error ? null : data.user;
  const role = user ? normalizeCrmRole(user.app_metadata?.role) || 'seller' : null;
  const finish = (result: NextResponse) => {
    for (const cookie of response.cookies.getAll()) result.cookies.set(cookie);
    result.headers.set('Cache-Control', 'private, no-store');
    return result;
  };

  if (PUBLIC_PAGES.has(pathname)) return response;
  if (pathname.startsWith('/api/')) {
    if (!user && LEGACY_POS_SEND_ROUTES.has(pathname) && ['POST', 'OPTIONS'].includes(request.method)) return response;
    if (!user) return finish(NextResponse.json({ error: 'Не авторизован' }, { status: 401 }));
    if (role === 'owner') return response;
    const rpcName = pathname.match(/^\/api\/manager\/rpc\/([a-zA-Z0-9_]+)$/)?.[1];
    if (rpcName && role !== 'manager') {
      return finish(NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 }));
    }
    const permission = rpcName && request.method === 'POST'
      ? getManagerRpcPermission(rpcName) : getCrmApiPermission(pathname, request.method);
    if (!permission || !hasCrmPermission(role, permission)) {
      return finish(NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 }));
    }
    return response;
  }
  if (!user) {
    const login = new URL('/login', request.url);
    if (pathname !== '/') login.searchParams.set('redirect', pathname + request.nextUrl.search);
    return finish(NextResponse.redirect(login));
  }
  if (pathname === '/' || !canAccessCrmPage(role, pathname)) {
    return finish(NextResponse.redirect(new URL('/orders', request.url)));
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
