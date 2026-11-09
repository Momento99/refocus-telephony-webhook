import type { SupabaseClient } from '@supabase/supabase-js';

export type PayrollFinancialDay = {
  day: string;
  branch_id: number;
  hours: number;
  hour_pay: number;
  bonus: number;
  penalties: number;
  net_day: number;
};

export async function fetchPayrollFinancialSummary(
  client: SupabaseClient,
  from: string,
  to: string,
  branchIds: number[] | null,
): Promise<PayrollFinancialDay[]> {
  const { data, error } = await client.rpc('crm_manager_payroll_by_day', {
    p_from: from,
    p_to: to,
    p_branch_ids: branchIds,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as PayrollFinancialDay[];
}
