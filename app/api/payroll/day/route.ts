// app/api/payroll/day/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// YYYY-MM-DD в таймзоне Asia/Bishkek по умолчанию «сегодня»
function todayBishkek(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // 25.10.2025
  const [d, m, y] = fmt.split(".");
  return `${y}-${m}-${d}`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const employeeId = Number(searchParams.get("employeeId"));
  const branchId = Number(searchParams.get("branchId") || 0);
  const date = (searchParams.get("date") || todayBishkek()).slice(0, 10); // 'YYYY-MM-DD'

  if (!employeeId) {
    return NextResponse.json({ error: "employeeId required" }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  let q = db
    .from("v_payroll_daily")
    .select(
      "day, branch_id, hours, hour_pay, branch_turnover, bonus, penalties, social_fund_day, income_tax_day, plan_premium, net_day"
    )
    .eq("employee_id", employeeId)
    .eq("day", date)
    .limit(1);

  if (branchId) q = q.eq("branch_id", branchId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row =
    data?.[0] ??
    ({
      day: date,
      branch_id: branchId || null,
      hours: 0,
      hour_pay: 0,
      branch_turnover: 0,
      bonus: 0,
      penalties: 0,
      social_fund_day: 0,
      income_tax_day: 0,
      plan_premium: 0,
      net_day: 0,
    } as const);

  return NextResponse.json({ ok: true, employeeId, branchId: branchId || null, ...row });
}
