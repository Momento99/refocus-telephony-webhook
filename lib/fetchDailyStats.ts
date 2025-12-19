// lib/fetchDailyStats.ts
import getSupabase from './supabaseClient';

export async function fetchDailyStats(fromISO: string, toISO: string, branches: string[]) {
  const supabase = getSupabase();

  let query = supabase
    .from('stats_daily')
    .select('day, branch_name, revenue, inflow, orders_count') // добавили orders_count
    .gte('day', fromISO)
    .lte('day', toISO);

  if (branches.length > 0) {
    query = query.in('branch_name', branches);
  }

  const { data, error } = await query.order('day', { ascending: true });

  if (error) {
    console.error('Ошибка загрузки статистики:', error.message);
    throw error;
  }

  return data || [];
}
