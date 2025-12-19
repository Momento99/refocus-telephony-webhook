'use client';

import getSupabase from '@/lib/supabaseClient';

export type SessionRow = {
  user_id: string;          // uuid из Supabase Auth
  device_id: string;        // твой fingerprint / localStorage id
  user_agent: string;       // navigator.userAgent
  ip: string;               // из /api/security/heartbeat
  last_active: string;      // ISO
  updated_at: string;       // ISO
};

/**
 * Делает upsert в public.user_sessions с корректным Authorization:
 * Authorization: Bearer <user access_token>, а НЕ anon key.
 * anon key кладем только в header `apikey`.
 */
export async function upsertUserSession(row: SessionRow) {
  const supabase = getSupabase();

  // Берем текущую пользовательскую сессию
  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.access_token) {
    console.warn('[user_sessions] Нет пользовательской сессии. Нужен логин.');
    return { ok: false, status: 401 as const };
  }

  const accessToken = session.access_token;

  const url =
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/user_sessions` +
    `?on_conflict=user_id,device_id&select=force_logout`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, // anon KEY сюда
      'Authorization': `Bearer ${accessToken}`,             // ВАЖНО: user access_token
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(row),
  });

  let data: any = null;
  try { data = await res.json(); } catch { /* пусто */ }

  if (!res.ok) {
    console.error('[user_sessions] upsert failed', res.status, data);
  } else {
    console.debug('[user_sessions] upsert ok', data);
  }

  return { ok: res.ok, status: res.status, data };
}
