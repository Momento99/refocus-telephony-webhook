export type PayrollFinancialDay = {
  day: string;
  branch_id: number;
  hours: number;
  hour_pay: number;
  bonus: number;
  penalties: number;
  net_day: number;
  management_day?: number;
};

export async function fetchPayrollFinancialSummary(
  from: string,
  to: string,
  branchIds: number[] | null,
): Promise<PayrollFinancialDay[]> {
  const response = await fetch('/api/manager/rpc/crm_manager_payroll_by_day', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify({ p_from: from, p_to: to, p_branch_ids: branchIds }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Не удалось загрузить расходы на персонал');
  if (!Array.isArray(data)) throw new Error('Некорректный ответ расчёта расходов на персонал');
  return data as PayrollFinancialDay[];
}
