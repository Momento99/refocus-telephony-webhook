import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// body: { branchId }
export async function POST(req: Request) {
  const { branchId } = await req.json().catch(() => ({}));
  const bId = Number(branchId);
  if (!bId) return NextResponse.json({ error: "branchId required" }, { status: 400 });

  const supa = getSupabaseAdmin();

  // создаём «пустого» сотрудника
  const { data: emp, error: eErr } = await supa
    .from("employees")
    .insert({
      full_name: "Новый сотрудник",
      role: "seller",
      branch_id: bId,
      is_active: true,
    })
    .select("id")
    .single();

  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 });

  // профиль оплаты
  const { error: pErr } = await supa.from("employee_payroll_profiles").insert({
    employee_id: emp.id,
    branch_id: bId,
    hourly_rate: 120,
    has_bonus: true,
    bonus_percent: 10,
    active: true,
  });

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  return NextResponse.json({ id: emp.id });
}
