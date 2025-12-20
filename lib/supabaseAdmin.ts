// lib/supabaseAdmin.ts
import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

declare global {
  // eslint-disable-next-line no-var
  var __supabaseAdmin__: SupabaseClient | undefined;
}

function resolveAdminEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("ENV SUPABASE_URL (или NEXT_PUBLIC_SUPABASE_URL) is missing");
  if (!serviceKey) throw new Error("ENV SUPABASE_SERVICE_ROLE_KEY is missing");

  return { url, serviceKey };
}

export function getSupabaseAdmin(): SupabaseClient {
  if (globalThis.__supabaseAdmin__) return globalThis.__supabaseAdmin__;

  const { url, serviceKey } = resolveAdminEnv();

  const client = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  globalThis.__supabaseAdmin__ = client;
  return client;
}

/**
 * Совместимость с импортами вида:
 *   import { supabaseAdmin } from "@/lib/supabaseAdmin";
 *   import supabaseAdmin from "@/lib/supabaseAdmin";
 *
 * Делаем ленивый Proxy, чтобы не валиться на этапе импорта.
 */
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseAdmin() as any;
    return client[prop];
  },
}) as SupabaseClient;

export default supabaseAdmin;
