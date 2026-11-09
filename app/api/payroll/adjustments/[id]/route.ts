// app/api/payroll/adjustments/[id]/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOwner } from "@/app/api/admin/_requireOwner";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireOwner();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  const db = getSupabaseAdmin();
  const { error } = await db.from("payroll_adjustments").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
