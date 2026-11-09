// /lib/getUserRole.ts
import type { User } from "@supabase/supabase-js";
import { cache } from 'react';
import { headers } from 'next/headers';
import { getSupabaseServerClient } from "./supabaseServer";
import { normalizeCrmRole, type Role } from './crmAccess';

export type { Role } from './crmAccess';

/** Пользователь, проверенный Supabase Auth для текущего запроса. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = getSupabaseServerClient();
  const authorization = (await headers()).get('authorization');
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const { data, error } = await supabase.auth.getUser(token);
  if (error) return null;
  return data.user ?? null;
});

/** Гость не имеет роли, пользователи без CRM-роли получают права продавца. */
export async function getUserRole(): Promise<Role | null> {
  const user = await getCurrentUser();
  return user ? normalizeCrmRole(user.app_metadata?.role) || 'seller' : null;
}
