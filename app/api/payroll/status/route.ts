// app/api/payroll/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

function monthBounds(month: string): { start: string; end: string } | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match || Number(match[1]) === 0) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const next = new Date(Date.UTC(year, monthIndex + 1, 1));
  return {
    start: `${match[1]}-${match[2]}-01`,
    end: next.toISOString().slice(0, 10),
  };
}

export async function GET(req: NextRequest) {
  const authClient = getSupabaseServerClient();
  const { data: authData, error: authError } = await authClient.auth.getUser();
  const user = authData?.user;
  if (authError || !user) return NextResponse.json({ error: "auth" }, { status: 401 });
  if (String(user.app_metadata?.role || "seller") !== "owner") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month");
  const bounds = month ? monthBounds(month) : null;
  if (!bounds) {
    return NextResponse.json({ error: "month required (YYYY-MM)" }, { status: 400 });
  }

  const { start, end } = bounds;
  const supabase = getSupabaseAdmin();

  const { count, error } = await supabase
    .from("payroll_entries")
    .select("id", { count: "exact", head: true })
    .gte("period", start)
    .lt("period", end);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rowCount = count ?? 0;
  return NextResponse.json({ closed: rowCount > 0, count: rowCount });
}
