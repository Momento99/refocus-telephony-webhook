// app/api/payroll/monthly/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOwner } from "@/app/api/admin/_requireOwner";

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
  management_fixed: number;
  management_bonus: number;
  management_total: number;
};

type CanonicalRow = {
  employee_id: number;
  branch_id: number;
  month: string;
  hours_total: number | string | null;
  hour_pay_total: number | string | null;
  bonus_total: number | string | null;
  penalties_total: number | string | null;
  social_fund_total: number | string | null;
  income_tax_total: number | string | null;
  plan_premium_total: number | string | null;
  adjustments_sum: number | string | null;
  net_total: number | string | null;
  manual_adjustments: number | string | null;
  management_fixed: number | string | null;
  management_bonus: number | string | null;
  management_total: number | string | null;
};

function ymToDate(ym: string) {
  // '2025-10' -> '2025-10-01'
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym);
  if (!m) throw new Error("month must be YYYY-MM");
  return `${m[1]}-${m[2]}-01`;
}

export async function GET(req: Request) {
  const auth = await requireOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(req.url);
    const monthYM = searchParams.get("month");
    if (!monthYM) throw new Error("missing month=YYYY-MM");
    const monthDate = ymToDate(monthYM);

    const supa = getSupabaseAdmin();
    const { data, error } = await supa
      .from("v_payroll_monthly_canonical_v5")
      .select(
        [
          "employee_id",
          "branch_id",
          "month",
          "hours_total",
          "hour_pay_total",
          "bonus_total",
          "penalties_total",
          "social_fund_total",
          "income_tax_total",
          "plan_premium_total",
          "adjustments_sum",
          "net_total",
          "manual_adjustments",
          "management_fixed",
          "management_bonus",
          "management_total",
        ].join(",")
      )
      .eq("month", monthDate);

    if (error) throw error;

    const rows: Row[] = ((data ?? []) as unknown as CanonicalRow[]).map((row) => {
      const hours = Number(row.hours_total ?? 0);
      const base = Number(row.hour_pay_total ?? 0);
      const salesBonus = Number(row.bonus_total ?? 0);
      const planBonus =
        Number(row.plan_premium_total ?? 0) +
        Math.max(0, Number(row.adjustments_sum ?? 0) - Number(row.manual_adjustments ?? 0));
      const manualAdjustment = Number(row.manual_adjustments ?? 0);
      const managementBonus = Number(row.management_bonus ?? 0);
      const totalBonus = salesBonus + planBonus + manualAdjustment + managementBonus;
      const gross =
        Number(row.net_total ?? 0) +
        Number(row.penalties_total ?? 0) +
        Number(row.social_fund_total ?? 0) +
        Number(row.income_tax_total ?? 0);
      return {
        employee_id: Number(row.employee_id),
        branch_id: Number(row.branch_id),
        month: String(row.month),
        hours_worked: hours,
        hourly_rate: hours > 0 ? base / hours : 0,
        base_from_hours: base,
        bonus_from_sales: salesBonus,
        daily_bonus: planBonus + manualAdjustment + managementBonus,
        bonus_total: totalBonus,
        gross_total: gross,
        social_fund: Number(row.social_fund_total ?? 0),
        income_tax: Number(row.income_tax_total ?? 0),
        net_total: Number(row.net_total ?? 0),
        management_fixed: Number(row.management_fixed ?? 0),
        management_bonus: managementBonus,
        management_total: Number(row.management_total ?? 0),
      };
    });
    return NextResponse.json({ month: monthYM, rows });
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message ?? e) },
      { status: 400 }
    );
  }
}
