// lib/supabaseClient.ts
"use client";

/**
 * Фасад для старых импортов в client-компонентах.
 * НИКАКИХ next/headers здесь нет, значит файл безопасно импортировать из любого client-кода.
 * Для сервера всегда импортируй из /lib/supabaseServer.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getBrowserSupabase } from "./supabaseBrowser";

/**
 * Старый API: default export function
 */
export default function getSupabase(): SupabaseClient {
  return getBrowserSupabase();
}

/**
 * Совместимость с импортами вида:
 *   import { supabase } from "@/lib/supabaseClient";
 *
 * Делаем ленивый Proxy, чтобы:
 * - не создавать клиент на этапе импорта
 * - не падать в SSR/пререндере, если вдруг кто-то случайно импортнул файл не там
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getBrowserSupabase() as any;
    return client[prop];
  },
}) as SupabaseClient;

export { getBrowserSupabase };
