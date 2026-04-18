"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

/** Браузерный клиент. Использовать ТОЛЬКО в client-компонентах. */
export function getBrowserSupabase(): SupabaseClient {
  // During SSR of client components, return a safe proxy.
  // No component should call methods during render — methods run inside effects/handlers,
  // which only execute in the browser, where the real client is created on hydration.
  if (typeof window === "undefined") {
    return new Proxy({} as SupabaseClient, {
      get(_target, prop) {
        throw new Error(
          `Supabase client method "${String(prop)}" вызван во время SSR. ` +
          `Используйте его внутри useEffect или обработчиков событий.`,
        );
      },
    });
  }

  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Нет ENV: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  browserClient = createBrowserClient(url, anon); // без cookies-опций
  return browserClient;
}

/* Алиас, чтобы старые импорты не падали */
export const getSupabaseBrowser = getBrowserSupabase;
