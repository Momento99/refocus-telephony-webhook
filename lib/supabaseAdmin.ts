// lib/supabaseAdmin.ts
import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

declare global {
  // eslint-disable-next-line no-var
  var __supabaseAdmin__: SupabaseClient | undefined;
}

export function getSupabaseAdmin(): SupabaseClient {
  if (globalThis.__supabaseAdmin__) return globalThis.__supabaseAdmin__;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("ENV NEXT_PUBLIC_SUPABASE_URL is missing");
  if (!serviceKey) throw new Error("ENV SUPABASE_SERVICE_ROLE_KEY is missing");

  const client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  globalThis.__supabaseAdmin__ = client;
  return client;
}

/**
 * Backward-compat:
 * 1) import { supabaseAdmin } from "@/lib/supabaseAdmin"
 * 2) import supabaseAdmin from "@/lib/supabaseAdmin"
 *
 * Proxy делает ленивую инициализацию (env читается только при использовании).
 */
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabaseAdmin() as any)[prop];
  },
});

export default supabaseAdmin;
