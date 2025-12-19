// app/api/payroll/monthly/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type Row = {
  employee_id: number;
  branch_id: number;
  month: string; // date в БД, но вернём строкой
  hours_worked: number;
  hourly_rate: number;
  base_from_hours: number;
  bonus_from_sales: number;
  daily_bonus: number;
  bonus_total: number;
  gross_total: number;
  social_fund: number;
  income_tax: number;
  net_total: number;
};

function ymToDate(ym: string) {
  // '2025-10' -> '2025-10-01'
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) throw new Error("month must be YYYY-MM");
  return `${m[1]}-${m[2]}-01`;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const monthYM = searchParams.get("month");
    if (!monthYM) throw new Error("missing month=YYYY-MM");
    const monthDate = ymToDate(monthYM);

    const supa = getSupabaseAdmin();
    const { data, error } = await supa
      .from("v_payroll_monthly")
      .select(
        [
          "employee_id",
          "branch_id",
          "month",
          "hours_worked",
          "hourly_rate",
          "base_from_hours",
          "bonus_from_sales",
          "daily_bonus",
          "bonus_total",
          "gross_total",
          "social_fund",
          "income_tax",
          "net_total",
        ].join(",")
      )
      .eq("month", monthDate);

    if (error) throw error;

    const rows: Row[] = (data ?? []) as any;
    return NextResponse.json({ month: monthYM, rows });
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message ?? e) },
      { status: 400 }
    );
  }
}
