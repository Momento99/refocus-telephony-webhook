// /middleware.ts
// Роут-гвард с корректной прокидкой куков (req + res),
// плюс диагностические логи. Если сессии нет — отправляем на /login.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Разрешения по ролям
const ACCESS: Record<string, Array<"seller" | "manager" | "owner">> = {
  "/admin/stats": ["manager", "owner"],
  "/payroll": ["owner"],
  "/settings": ["owner"],
};

export async function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const pathname = url.pathname;

  // Если путь не защищён — пропускаем сразу
  const protectedKey = Object.keys(ACCESS).find(k => pathname.startsWith(k));
  if (!protectedKey) return NextResponse.next();

  // ОБЯЗАТЕЛЬНО создаём ответ заранее, чтобы прокидывать set/remove cookie
  const res = NextResponse.next();

  // Корректная инициализация Supabase в middleware
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        // два метода ниже НУЖНЫ, иначе иногда теряется сессия при рефреше токена
        set(name: string, value: string, options: any) {
          res.cookies.set(name, value, options);
        },
        remove(name: string, options: any) {
          res.cookies.delete({ name, ...options });
        },
      },
    }
  );

  const { data: { user }, error } = await supabase.auth.getUser();

  // Если вообще нет пользователя — отправляем на логин
  if (!user) {
    console.log("[MIDDLEWARE] anon access -> redirect to /login",
      "| PATH:", pathname,
      "| ERROR:", error?.message ?? "none");
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Достаём роль из app_metadata; по умолчанию seller
  const role = (user.app_metadata?.role as "seller" | "manager" | "owner") || "seller";

  // Диагностический лог
  console.log("[MIDDLEWARE]",
    "PATH:", pathname,
    "| EMAIL:", user.email,
    "| ROLE:", role);

  // Проверка доступа
  const allowed = ACCESS[protectedKey];
  if (!allowed.includes(role)) {
    url.pathname = "/orders";
    return NextResponse.redirect(url);
  }

  // Владеем доступом — отдаем ответ (важно вернуть res, чтобы set/remove cookies применились)
  return res;
}

// Не трогаем служебные пути и статику
export const config = {
  matcher: [
    '/((?!_next|api|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map)).*)',
  ],
};
