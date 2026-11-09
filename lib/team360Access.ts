const managerMetricFields = [
  'employee_id', 'full_name', 'role', 'is_active', 'branch_id', 'branch_name',
  'audio_chunks_count', 'audio_avg_score', 'audio_rude_count', 'audio_pushy_count',
  'wa_threads_count', 'wa_analyzed_count', 'wa_avg_score', 'wa_critical_count',
  'ig_threads_count', 'ig_analyzed_count', 'ig_avg_score', 'ig_critical_count',
  'orders_count', 'revenue_total', 'avg_check', 'frame_items_count', 'lens_items_count',
] as const;

export function managerTeamMetrics(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(managerMetricFields.map(field => [field, row[field]]));
}

export function teamPeriod(from: string | null | undefined, to: string | null | undefined) {
  const validDate = (value: string | null | undefined): value is string => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!validDate(from) || !validDate(to) || from > to) return null;
  const end = new Date(`${to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { from, to, fromIso: `${from}T00:00:00Z`, toIso: end.toISOString() };
}
