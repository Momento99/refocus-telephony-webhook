// app/api/payroll/summary/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function firstDay(monthYYYYMM: string) {
  const [y, m] = monthYYYYMM.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month");
  if (!month) return NextResponse.json({ error: "month required" }, { status: 400 });
  const period = firstDay(month);

  const db = getSupabaseAdmin();

  const [{ data: mrows, error: mErr }, { data: arows, error: aErr }] = await Promise.all([
    db.from("v_payroll_monthly_calc")
      .select("branch_id, net_without_adjustments")
      .eq("month", period),
    db.from("v_payroll_adjustments_monthly")
      .select("branch_id, adjustments_sum")
      .eq("month", period),
  ]);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });

  const sumByBranch = new Map<number, { net_sum: number; adjustments_sum: number }>();
  for (const r of mrows ?? []) {
    const prev = sumByBranch.get(r.branch_id) ?? { net_sum: 0, adjustments_sum: 0 };
    prev.net_sum += Number(r.net_without_adjustments || 0);
    sumByBranch.set(r.branch_id, prev);
  }
  for (const r of arows ?? []) {
    const prev = sumByBranch.get(r.branch_id) ?? { net_sum: 0, adjustments_sum: 0 };
    prev.adjustments_sum += Number(r.adjustments_sum || 0);
    sumByBranch.set(r.branch_id, prev);
  }

  const items = Array.from(sumByBranch.entries()).map(([branchId, v]) => ({
    branchId,
    net_sum: v.net_sum,
    adjustments_sum: v.adjustments_sum,
    net_total: v.net_sum + v.adjustments_sum,
  }));

  return NextResponse.json({ month: period, items });
}
