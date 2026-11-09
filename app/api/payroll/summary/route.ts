// app/api/payroll/summary/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOwner } from "@/app/api/admin/_requireOwner";

function firstDay(monthYYYYMM: string): string | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(monthYYYYMM);
  return match && Number(match[1]) > 0 ? `${match[1]}-${match[2]}-01` : null;
}

export async function GET(req: Request) {
  const auth = await requireOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month");
  const period = month ? firstDay(month) : null;
  if (!period) return NextResponse.json({ error: "month required (YYYY-MM)" }, { status: 400 });

  const db = getSupabaseAdmin();

  const { data: mrows, error: mErr } = await db
    .from("v_payroll_monthly_canonical_v5")
    .select("branch_id,net_total,adjustments_sum")
    .eq("month", period);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const sumByBranch = new Map<number, { net_sum: number; adjustments_sum: number }>();
  for (const r of mrows ?? []) {
    const branchId = Number(r.branch_id);
    const prev = sumByBranch.get(branchId) ?? { net_sum: 0, adjustments_sum: 0 };
    const adjustments = Number(r.adjustments_sum || 0);
    prev.net_sum += Number(r.net_total || 0) - adjustments;
    prev.adjustments_sum += adjustments;
    sumByBranch.set(branchId, prev);
  }

  const items = Array.from(sumByBranch.entries()).map(([branchId, v]) => ({
    branchId,
    net_sum: v.net_sum,
    adjustments_sum: v.adjustments_sum,
    net_total: v.net_sum + v.adjustments_sum,
  }));

  return NextResponse.json({ month: period, items });
}
