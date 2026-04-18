// /middleware.ts
// Защита отключена: никакие редиректы и проверки ролей не выполняются.
// При этом оставляем корректную прокидку cookies для Supabase (refresh токенов),
// чтобы авторизация не "отваливалась" при SSR/refresh.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  // ОБЯЗАТЕЛЬНО создаём ответ заранее, чтобы прокидывать set/remove cookie
  const res = NextResponse.next();

  // Инициализируем Supabase так же, как было — только без проверок и редиректов
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          res.cookies.set(name, value, options);
        },
        remove(name: string, options: any) {
          res.cookies.delete({ name, ...options });
        },
      },
    }
  );

  // Читаем сессию из cookies (без сетевого запроса) — достаточно для обновления токенов.
  // getSession() работает локально, getUser() делает запрос к Supabase (~500-1000мс).
  try {
    await supabase.auth.getSession();
  } catch {
    // ничего не делаем — доступ не ограничиваем
  }

  return res;
}

// Не трогаем служебные пути и статику
export const config = {
  matcher: [
    "/((?!_next|api|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map)).*)",
  ],
};
