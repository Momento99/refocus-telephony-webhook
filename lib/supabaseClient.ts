// lib/supabaseClient.ts
"use client";

/**
 * Фасад для старых импортов в client-компонентах.
 * НИКАКИХ next/headers здесь нет, значит файл безопасно импортировать из любого client-кода.
 * Для сервера всегда импортируй из /lib/supabaseServer (или server-only модулей).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getBrowserSupabase } from "./supabaseBrowser";

export default function getSupabase(): SupabaseClient {
  return getBrowserSupabase();
}

/**
 * Backward-compat:
 * Некоторые файлы у тебя импортируют так:
 *   import { supabase } from "@/lib/supabaseClient"
 * Поэтому даём named export `supabase`.
 *
 * Через Proxy делаем ленивую инициализацию:
 * env/клиент понадобятся только при первом реальном обращении.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getBrowserSupabase() as any)[prop];
  },
});

export { getBrowserSupabase };
