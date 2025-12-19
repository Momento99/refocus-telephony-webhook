// app/api/payroll/daily/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function range(monthYYYYMM: string) {
  const [y, m] = monthYYYYMM.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const s = start.toISOString().slice(0, 10);
  const e = end.toISOString().slice(0, 10);
  return { s, e };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const employeeId = Number(searchParams.get("employeeId"));
  const branchId = Number(searchParams.get("branchId") || 0);
  const month = searchParams.get("month"); // 'YYYY-MM'
  if (!employeeId || !month) {
    return NextResponse.json({ error: "employeeId and month required" }, { status: 400 });
  }
  const { s, e } = range(month);

  const db = getSupabaseAdmin();
  let q = db
    .from("v_payroll_daily")
    .select(
      "day, hours, hour_pay, branch_turnover, bonus, penalties, social_fund_day, income_tax_day, plan_premium, net_day, branch_id"
    )
    .eq("employee_id", employeeId)
    .gte("day", s)
    .lt("day", e)
    .order("day", { ascending: true });

  if (branchId) q = q.eq("branch_id", branchId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ employeeId, month: `${s}`, days: data ?? [] });
}
