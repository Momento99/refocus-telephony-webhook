// app/api/payroll/close/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month"); // "YYYY-MM"
  if (!month) return NextResponse.json({ error: "month required" }, { status: 400 });

  const supabase = getSupabaseAdmin();

  // Берём рассчитанные строки из v_payroll_monthly
  const { data: rows, error: vErr } = await supabase
    .from("v_payroll_monthly")
    .select("employee_id, branch_id, month, base_from_hours, bonus_total")
    .eq("month", `${month}-01`);

  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "Нет данных для закрытия месяца" }, { status: 400 });
  }

  const payload = rows.map((r) => ({
    employee_id: r.employee_id,
    branch_id: r.branch_id,
    period: r.month,                 // date: YYYY-MM-01
    base_salary: r.base_from_hours ?? 0,
    bonus: r.bonus_total ?? 0,
  }));

  // В БД желательно иметь уникальный индекс:
  // create unique index if not exists payroll_entries_emp_period_uidx on payroll_entries(employee_id, period);
  const { error: insErr } = await supabase
    .from("payroll_entries")
    .upsert(payload, { onConflict: "employee_id,period" });

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, inserted: payload.length });
}
