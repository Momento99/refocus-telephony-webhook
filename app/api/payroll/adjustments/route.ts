// app/api/payroll/adjustments/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  const body = await req.json();
  const {
    employeeId,
    branchId,
    month,     // "YYYY-MM"
    amount,    // + премия, - штраф
    reason = "",
    kind = "other", // 'bonus' | 'fine' | 'premium' | 'other'
  } = body || {};

  if (!employeeId || !branchId || !month || !amount) {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  const period = `${month}-01`;
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("payroll_adjustments")
    .insert({
      employee_id: Number(employeeId),
      branch_id: Number(branchId),
      period,
      amount: Number(amount),
      reason: String(reason),
      kind: String(kind),
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, row: data });
}
