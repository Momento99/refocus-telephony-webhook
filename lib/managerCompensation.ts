export type ManagerCompensationRow = {
  employee_id: number;
  full_name: string;
  month: string;
  from: string;
  to: string;
  days_in_month: number;
  active_days: number;
  accrued_days: number;
  monthly_fixed: number;
  fixed_for_period: number;
  fixed_accrued: number;
  target_for_period: number;
  net_receipts: number;
  refunds: number;
  net_revenue: number;
  bonus_for_period: number;
  bonus_earned: number;
  provisional_bonus: number;
  total_accrued: number;
  projected_total: number;
  maximum_total: number;
  progress: number;
  closed: boolean;
};

export type ManagerCompensationResponse = {
  month: string;
  as_of_date: string;
  rows: ManagerCompensationRow[];
};
