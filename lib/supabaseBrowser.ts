"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

function isManagerRequest(headers: Headers): boolean {
  const token = headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.app_metadata?.role === 'manager';
  } catch {
    return false;
  }
}

async function crmFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const rpcName = url.pathname.match(/^\/rest\/v1\/rpc\/([a-zA-Z0-9_]+)$/)?.[1];
  if (rpcName && isManagerRequest(request.headers)) {
    return fetch(new URL(`/api/manager/rpc/${rpcName}`, window.location.origin), {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: request.headers.get('authorization')!,
        Accept: request.headers.get('accept') || 'application/json',
      },
      body: request.method === 'POST' ? await request.text() : undefined,
      credentials: 'same-origin',
      signal: request.signal,
    });
  }
  return fetch(request);
}

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

  // /auth/callback captures and clears auth URL parameters before client initialization.
  browserClient = createBrowserClient(url, anon, { global: { fetch: crmFetch } });
  return browserClient;
}

/* Алиас, чтобы старые импорты не падали */
export const getSupabaseBrowser = getBrowserSupabase;
