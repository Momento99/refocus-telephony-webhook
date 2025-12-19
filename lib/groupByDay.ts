// lib/groupByDay.ts

type Row = { day: string; branch_name: string; revenue: number; inflow: number };

export function groupByDay(rows: Row[]) {
  const byDay: Record<string, { day: string; revenue: number; inflow: number }> = {};

  for (const r of rows) {
    if (!byDay[r.day]) {
      byDay[r.day] = { day: r.day, revenue: 0, inflow: 0 };
    }
    byDay[r.day].revenue += r.revenue;
    byDay[r.day].inflow += r.inflow;
  }

  return Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day));
}
