// lib/supabaseAdmin.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

declare global {
  // чтобы не ругался TS из-за расширения globalThis
  // и чтобы клиент переживал hot-reload в dev
  // eslint-disable-next-line no-var
  var __supabaseAdmin__: SupabaseClient | undefined;
}

export function getSupabaseAdmin(): SupabaseClient {
  if (globalThis.__supabaseAdmin__) return globalThis.__supabaseAdmin__;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('ENV NEXT_PUBLIC_SUPABASE_URL is missing');
  if (!serviceKey) throw new Error('ENV SUPABASE_SERVICE_ROLE_KEY is missing');

  const client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  globalThis.__supabaseAdmin__ = client;
  return client;
}
