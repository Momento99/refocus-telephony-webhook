"use client";

/**
 * Фасад для старых импортов в client-компонентах.
 * НИКАКИХ next/headers здесь нет, значит файл безопасно импортировать из любого client-кода.
 * Для сервера всегда импортируй из /lib/supabaseServer.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getBrowserSupabase } from "./supabaseBrowser";

export default function getSupabase(): SupabaseClient {
  return getBrowserSupabase();
}

export { getBrowserSupabase };
