// app/api/payroll/data/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function firstDay(monthYYYYMM: string) {
  const [y, m] = monthYYYYMM.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10); // 'YYYY-MM-01'
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month"); // 'YYYY-MM'
  if (!month) return NextResponse.json({ error: "month is required" }, { status: 400 });
  const period = firstDay(month);

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
    .from("v_payroll_monthly_calc")
    .select(
      [
        "employee_id",
        "branch_id",
        "month",
        "hours_worked",
        "base_from_hours",
        "bonus_from_sales",
        "daily_bonus",
        "penalties_month",
        "social_fund_month",
        "income_tax_month",
        "net_without_adjustments",
      ].join(", ")
    )
    .eq("month", period);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const empIds = Array.from(new Set((monthlyRows ?? []).map(r => r.employee_id)));

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

  // 4) Корректировки за месяц
  const { data: adjRows, error: aErr } = await db
    .from("v_payroll_adjustments_monthly")
    .select("employee_id, branch_id, month, adjustments_sum")
    .eq("month", period);
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  const adjByEmp = new Map((adjRows ?? []).map(r => [r.employee_id, Number(r.adjustments_sum || 0)]));

  // 5) Собираем «employees» для фронта
  const employees = (monthlyRows ?? []).map(r => {
    const emp = empById.get(r.employee_id);
    const prof = profByEmp.get(r.employee_id);
    const adjustments = adjByEmp.get(r.employee_id) ?? 0;

    const accrued =
      Number(r.base_from_hours || 0) +
      Number(r.bonus_from_sales || 0) +
      Number(r.daily_bonus || 0);

    return {
      id: r.employee_id,
      fullName: emp?.full_name ?? `ID ${r.employee_id}`,
      role: emp?.role ?? "seller",
      branchId: emp?.branch_id ?? r.branch_id,

      hoursWorked: Number(r.hours_worked || 0),
      baseFromHours: Number(r.base_from_hours || 0),
      bonusFromSales: Number(r.bonus_from_sales || 0),
      dailyBonus: Number(r.daily_bonus || 0),
      penaltiesMonth: Number(r.penalties_month || 0),
      socialFund: Number(r.social_fund_month || 0),
      incomeTax: Number(r.income_tax_month || 0),

      accrued,
      net: Number(r.net_without_adjustments || 0) + adjustments,
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
