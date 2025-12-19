// app/api/payroll/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function monthBounds(month: string) {
  // month = "YYYY-MM"
  const start = `${month}-01`;
  const d = new Date(start);
  d.setMonth(d.getMonth() + 1);
  const end = d.toISOString().slice(0, 10); // первый день следующего месяца
  return { start, end };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month");
  if (!month) {
    return NextResponse.json({ error: "month required" }, { status: 400 });
  }

  const { start, end } = monthBounds(month);
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("payroll_entries")
    .select("id", { count: "exact", head: true })
    .gte("period", start)
    .lt("period", end);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const closed = (data?.length ?? 0) > 0;
  return NextResponse.json({ closed, count: data?.length ?? 0 });
}
