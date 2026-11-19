import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { RoleT } from "@/app/settings/payroll/usePayrollMonthly";
import { requireOwner } from "@/app/api/admin/_requireOwner";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH body: частичное обновление
export async function PATCH(req: Request, { params }: RouteContext) {
  const auth = await requireOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return NextResponse.json({ error: "Некорректный сотрудник" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const supa = getSupabaseAdmin();

  // делим на поля employees и employee_payroll_profiles
  const updEmp: any = {};
  const updProf: any = {};

  if (body.fullName !== undefined) updEmp.full_name = String(body.fullName).trim();
  if (body.role !== undefined) updEmp.role = String(body.role) as RoleT;
  if (body.branchId !== undefined) updEmp.branch_id = Number(body.branchId);

  if (body.hourlyRate !== undefined) updProf.hourly_rate = Number(body.hourlyRate);
  if (body.hasBonus !== undefined) updProf.has_bonus = !!body.hasBonus;
  if (body.bonusPercent !== undefined) updProf.bonus_percent = Number(body.bonusPercent);
  if (body.branchId !== undefined) updProf.branch_id = Number(body.branchId);

  if (Object.keys(updEmp).length) {
    const { error } = await supa.from("employees").update(updEmp).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (Object.keys(updProf).length) {
    // гарантируем наличие профиля
    const { data: exists } = await supa
      .from("employee_payroll_profiles")
      .select("employee_id")
      .eq("employee_id", id)
      .eq("active", true)
      .maybeSingle();

    if (exists) {
      const { error } = await supa
        .from("employee_payroll_profiles")
        .update(updProf)
        .eq("employee_id", id)
        .eq("active", true);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      const ins = { employee_id: id, active: true, has_bonus: true, bonus_percent: 10, hourly_rate: 120, ...updProf };
      const { error } = await supa.from("employee_payroll_profiles").insert(ins);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const auth = await requireOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return NextResponse.json({ error: "Некорректный сотрудник" }, { status: 400 });
  }
  const { error } = await getSupabaseAdmin().rpc("app_archive_employee", { p_employee_id: id });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: error.code === "P0002" ? 404 : 500 });
  }

  return NextResponse.json({ ok: true });
}
