import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  const body = await req.json().catch(() => ({}));
  const name = (body?.name || "").toString().trim();

  if (!id || !name) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const supa = getSupabaseAdmin();
  const { error } = await supa.from("branches").update({ name }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const supa = getSupabaseAdmin();

  // мягко: сначала отвяжем сотрудников этого филиала (если надо)
  await supa.from("employee_payroll_profiles").update({ active: false }).eq("branch_id", id);
  await supa.from("employees").update({ branch_id: null }).eq("branch_id", id);

  const { error } = await supa.from("branches").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
