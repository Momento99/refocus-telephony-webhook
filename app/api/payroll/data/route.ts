// app/api/payroll/data/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOwner } from "@/app/api/admin/_requireOwner";

type CanonicalMonthlyRow = {
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
};

function firstDay(monthYYYYMM: string): string | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(monthYYYYMM);
  return match && Number(match[1]) > 0 ? `${match[1]}-${match[2]}-01` : null;
}

export async function GET(req: Request) {
  const auth = await requireOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month"); // 'YYYY-MM'
  const period = month ? firstDay(month) : null;
  if (!period) {
    return NextResponse.json({ error: "month is required (YYYY-MM)" }, { status: 400 });
  }

  const db = getSupabaseAdmin();

  // 1) Конфиг и филиалы
  const [{ data: cfg, error: cfgErr }, { data: branches, error: brErr }] = await Promise.all([
    db.from("payroll_config").select("*").eq("id", 1).single(),
    db.from("branches").select("id,name").order("id", { ascending: true }),
  ]);
  if (cfgErr) return NextResponse.json({ error: cfgErr.message }, { status: 500 });
  if (brErr) return NextResponse.json({ error: brErr.message }, { status: 500 });

  // 2) Месячные расчёты (готовая вьюха)
  const { data: monthlyRows, error: mErr } = await db
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
      ].join(", ")
    )
    .eq("month", period);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const canonicalRows = (monthlyRows ?? []) as unknown as CanonicalMonthlyRow[];
  const empIds = Array.from(new Set(canonicalRows.map((row) => Number(row.employee_id))));

  // 3) Карточки сотрудников и их профили оплаты
  const [{ data: empList, error: eErr }, { data: profList, error: pErr }] = await Promise.all([
    db.from("employees")
      .select("id, full_name, role, branch_id, is_active")
      .in("id", empIds.length ? empIds : [-1]),
    db.from("employee_payroll_profiles")
      .select("employee_id, hourly_rate, has_bonus, bonus_percent, active")
      .in("employee_id", empIds.length ? empIds : [-1])
      .eq("active", true),
  ]);
  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 });
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const empById = new Map((empList ?? []).map(e => [e.id, e]));
  const profByEmp = new Map((profList ?? []).map(p => [p.employee_id, p]));

  // 4) Собираем «employees» из единой месячной витрины.
  const employees = canonicalRows.map((r) => {
    const employeeId = Number(r.employee_id);
    const emp = empById.get(employeeId);
    const prof = profByEmp.get(employeeId);
    const adjustments = Number(r.adjustments_sum || 0);
    const baseFromHours = Number(r.hour_pay_total || 0);
    const bonusFromSales = Number(r.bonus_total || 0);
    const dailyBonus =
      Number(r.plan_premium_total || 0) +
      Math.max(0, adjustments - Number(r.manual_adjustments || 0));
    const accrued =
      baseFromHours + bonusFromSales + dailyBonus + Number(r.manual_adjustments || 0);

    return {
      id: employeeId,
      fullName: emp?.full_name ?? `ID ${employeeId}`,
      role: emp?.role ?? "seller",
      branchId: emp?.branch_id ?? r.branch_id,

      hoursWorked: Number(r.hours_total || 0),
      baseFromHours,
      bonusFromSales,
      dailyBonus,
      penaltiesMonth: Number(r.penalties_total || 0),
      socialFund: Number(r.social_fund_total || 0),
      incomeTax: Number(r.income_tax_total || 0),

      accrued,
      net: Number(r.net_total || 0),
      adjustments,

      // поля профиля для редактирования в UI
      hourlyRate: Number(prof?.hourly_rate ?? 0),
      hasBonus: !!prof?.has_bonus,
      bonusPercent: Number(prof?.bonus_percent ?? 0),
    };
  });

  return NextResponse.json({
    cfg,
    branches,
    employees,
    month: period,
  });
}
