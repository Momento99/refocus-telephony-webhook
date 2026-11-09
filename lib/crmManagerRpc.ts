import type { CrmPermission } from './crmAccess';

// Only explicitly reviewed operations may use the privileged server client.
export const MANAGER_RPC_PERMISSIONS: Record<string, CrmPermission> = {
  crm_manager_payroll_by_day: 'finance',
  admin_period_by_branch: 'statistics',
  admin_payments_breakdown: 'statistics',
  admin_status_counts: 'statistics',
  admin_revenue_inflow_by_day: 'statistics',
  admin_heatmap_dow_hour: 'statistics',
  admin_check_histogram: 'statistics',
  admin_refunds_by_day: 'statistics',
  admin_new_vs_returning: 'statistics',
  admin_avg_interval_days: 'statistics',
  admin_avg_median_check: 'statistics',
  admin_age_orders_by_year: 'statistics',
  admin_lens_structure: 'statistics',
  admin_net_profit_by_day: 'finance',
  stats_orders_by_10min: 'statistics',
  fn_finance_summary_todate_v2: 'finance',
  reconciliation_overview_v2: 'reconciliation',
  reconciliation_set_manual_v2: 'reconciliation',
  reconciliation_online_overview: 'reconciliation',
  reconciliation_online_set_manual: 'reconciliation',
  reconciliation_fix_transfer: 'reconciliation',
  reconciliation_fix_history: 'reconciliation',
  add_payment: 'orders',
  admin_update_payment_method: 'orders',
  admin_soft_delete_order: 'orders',
  pos_order_refund_balance_v2: 'orders',
  pos_order_cancel_v2: 'orders',
  pos_order_cash_refund_v2: 'orders',
  pos_refund_settle_v2: 'orders',
  pos_warranty_adjustment: 'orders',
  warehouse_accessory_snapshot: 'warehouse',
  warehouse_accessory_set_counts: 'warehouse',
};

export function getManagerRpcPermission(name: string): CrmPermission | null {
  return Object.prototype.hasOwnProperty.call(MANAGER_RPC_PERMISSIONS, name)
    ? MANAGER_RPC_PERMISSIONS[name] : null;
}

const MANAGER_WRITE_RPC_NAMES = new Set([
  'add_payment', 'admin_update_payment_method', 'admin_soft_delete_order',
  'reconciliation_set_manual_v2', 'reconciliation_online_set_manual',
  'reconciliation_fix_transfer', 'pos_order_cancel_v2',
  'pos_order_cash_refund_v2', 'pos_refund_settle_v2', 'pos_warranty_adjustment',
]);

export function getManagerRpcTarget(name: string): string {
  if (name === 'warehouse_accessory_set_counts') return 'crm_manager_warehouse_set_counts';
  return MANAGER_WRITE_RPC_NAMES.has(name) ? 'crm_manager_' + name : name;
}
