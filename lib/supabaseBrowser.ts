"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

/** Браузерный клиент. Использовать ТОЛЬКО в client-компонентах. */
export function getBrowserSupabase(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error('getBrowserSupabase() доступен только в client-компонентах ("use client").');
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
