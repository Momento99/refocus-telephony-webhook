import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const ALLOWED_ROLES = new Set(["seller", "promoter", "master"]);

// body: { branchId, role? }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const bId = Number(body.branchId);
  if (!bId) return NextResponse.json({ error: "branchId required" }, { status: 400 });

  const role = ALLOWED_ROLES.has(String(body.role)) ? String(body.role) : "seller";

  const supa = getSupabaseAdmin();

  // создаём «пустого» сотрудника
  const { data: emp, error: eErr } = await supa
    .from("employees")
    .insert({
      full_name: "Новый сотрудник",
      role,
      branch_id: bId,
      is_active: true,
    })
    .select("id")
    .single();

  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 });

  // профиль оплаты. Мастер — на чистой сделке (150 сом/заказ), поэтому без
  // почасового оклада и без бонуса от оборота.
  const isMaster = role === "master";
  const { error: pErr } = await supa.from("employee_payroll_profiles").insert({
    employee_id: emp.id,
    branch_id: bId,
    hourly_rate: isMaster ? 0 : 120,
    has_bonus: isMaster ? false : true,
    bonus_percent: isMaster ? 0 : 10,
    active: true,
  });

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  return NextResponse.json({ id: emp.id });
}
