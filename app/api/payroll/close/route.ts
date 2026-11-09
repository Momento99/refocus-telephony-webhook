// app/api/payroll/close/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BISHKEK_TZ = "Asia/Bishkek";

function parseMonth(value: string | null): { ym: string; firstDay: string } | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value ?? "");
  if (!match || Number(match[1]) === 0) return null;
  return { ym: `${match[1]}-${match[2]}`, firstDay: `${match[1]}-${match[2]}-01` };
}

function currentMonthInBishkek(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BISHKEK_TZ,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new Error("Не удалось определить текущий месяц Asia/Bishkek");
  return `${year}-${month}`;
}

export async function POST(req: NextRequest) {
  const authClient = getSupabaseServerClient();
  const { data: authData, error: authError } = await authClient.auth.getUser();
  const user = authData?.user;
  if (authError || !user) return NextResponse.json({ error: "auth" }, { status: 401 });
  if (String(user.app_metadata?.role || "seller") !== "owner") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const parsedMonth = parseMonth(new URL(req.url).searchParams.get("month"));
    if (!parsedMonth) {
      return NextResponse.json({ error: "month required (YYYY-MM)" }, { status: 400 });
    }
    if (parsedMonth.ym >= currentMonthInBishkek()) {
      return NextResponse.json(
        { error: "Можно закрыть только полностью завершённый месяц (Asia/Bishkek)" },
        { status: 409 },
      );
    }

    // Единственная транзакция в Postgres: lock → v5 finalize/assert →
    // INSERT…SELECT canonical snapshot. Тот же lock используется корректировками,
    // поэтому ни одна из них не может проскочить между расчётом и архивированием.
    const { data, error } = await authClient.rpc("fn_payroll_close_month_v5", {
      p_month: parsedMonth.firstDay,
    });
    if (error) {
      const status =
        error.code === "42501"
          ? 403
          : ["22004", "22023", "23514", "55000"].includes(error.code ?? "")
            ? 409
            : 500;
      return NextResponse.json(
        { error: `Месяц не закрыт: ${error.message}` },
        { status },
      );
    }

    return NextResponse.json(data ?? { ok: true, month: parsedMonth.firstDay });
  } catch (error) {
    console.error("POST /api/payroll/close failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка закрытия месяца" },
      { status: 500 },
    );
  }
}
