import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Серверный Supabase-клиент.
 * Использовать ТОЛЬКО в server components / server actions / layout.
 * Никакого импорта в клиентские компоненты.
 */
export function getSupabaseServerClient(): SupabaseClient {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error('Нет ENV: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  return createServerClient(url, anon, {
    cookies: {
      getAll: async () => (await cookies()).getAll(),
      setAll: async cookieValues => {
        try {
          const store = await cookies();
          for (const { name, value, options } of cookieValues) store.set(name, value, options);
        } catch {
          // Server Components receive refreshed cookies from middleware.
        }
      },
    },
  });
}
