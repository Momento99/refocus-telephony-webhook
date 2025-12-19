import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
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

  // В Next 15 cookies() нужно вызывать асинхронно.
  // Поэтому внутри методов cookies мы дергаем (await cookies()) каждый раз.
  return createServerClient(url, anon, {
    cookies: {
      // get/set/remove могут быть async — @supabase/ssr это поддерживает
      get: async (name: string) => {
        const store = await cookies();
        return store.get(name)?.value;
      },
      set: async (name: string, value: string, options: CookieOptions) => {
        const store = await cookies();
        store.set({ name, value, ...options });
      },
      remove: async (name: string, options: CookieOptions) => {
        const store = await cookies();
        store.delete({ name, ...options });
      },
    },
  });
}
