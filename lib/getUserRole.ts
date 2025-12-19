// /lib/getUserRole.ts
import type { User } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "./supabaseServer";

export type Role = "seller" | "manager" | "owner";

/** Текущий пользователь (SSR) */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

/** Роль пользователя из app_metadata.role, по умолчанию "seller" */
export async function getUserRole(): Promise<Role> {
  const user = await getCurrentUser();
  const role = (user?.app_metadata?.role as Role) || "seller";
  return role;
}
