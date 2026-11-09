// app/api/payroll/adjustments/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOwner } from "@/app/api/admin/_requireOwner";

export async function POST(req: Request) {
  const auth = await requireOwner();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await req.json();
  const {
    employeeId,
    branchId,
    month,     // "YYYY-MM"
    amount,    // + премия, - штраф
    reason = "",
    kind = "other", // 'bonus' | 'fine' | 'premium' | 'other'
  } = body || {};

  const employeeIdNum = Number(employeeId);
  const branchIdNum = Number(branchId);
  const amountNum = Number(amount);
  if (
    !Number.isSafeInteger(employeeIdNum) || employeeIdNum <= 0 ||
    !Number.isSafeInteger(branchIdNum) || branchIdNum <= 0 ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month ?? "")) ||
    !Number.isFinite(amountNum) || amountNum === 0
  ) {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  const period = `${month}-01`;
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("payroll_adjustments")
    .insert({
      employee_id: employeeIdNum,
      branch_id: branchIdNum,
      period,
      amount: amountNum,
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
