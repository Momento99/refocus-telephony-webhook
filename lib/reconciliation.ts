// /lib/reconciliation.ts
import getSupabase from "@/lib/supabaseClient";

/* ====================== Типы ====================== */

export type RecoRow = {
  branch_id: number;
  branch_name: string;
  expected_amount: number; // "Должно быть" (наличные минус расходы)
  manual_amount: number;   // Введено вручную (факт перевода наличных)
  diff: number;            // manual - expected
  status: "match" | "shortage" | "overpay";
};

export type OnlineRecoRow = {
  week_start: string;      // YYYY-MM-DD
  week_end: string;        // YYYY-MM-DD
  expected_amount: number; // "Должно быть" онлайн по POS (non_cash_payments)
  manual_amount: number;   // Факт по банку (что реально пришло на счёт, после комиссии)
  commission: number;      // Комиссия эквайринга за неделю
  diff: number;            // (manual + commission) - expected
  status: "match" | "shortage" | "overpay";
};

/* ====================== Утилиты недели ====================== */

export function getWeekStartMonday(d: Date): string {
  // неделя с понедельника; вернём YYYY-MM-DD
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (dt.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
  dt.setUTCDate(dt.getUTCDate() - day);
  return dt.toISOString().slice(0, 10);
}

/* ====================== Наличные (по филиалам) ====================== */

export async function fetchOverview(weekStartISO: string): Promise<RecoRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("reconciliation_overview", {
    p_week_start: weekStartISO,
  });
  if (error) throw error;

  return (data as any[]).map((r) => ({
    branch_id: Number(r.branch_id),
    branch_name: String(r.branch_name),
    expected_amount: Number(r.expected_amount || 0),
    manual_amount: Number(r.manual_amount || 0),
    diff: Number(r.diff || 0),
    status: (r.status as RecoRow["status"]) || "match",
  }));
}

export async function upsertManualAmount(params: {
  weekStartISO: string;
  branchId: number;
  amount: number;
  comment?: string | null;
}) {
  const sb = getSupabase();
  const { error } = await sb.rpc("reconciliation_set_manual", {
    p_week_start: params.weekStartISO,
    p_branch_id: params.branchId,
    p_amount: params.amount,
    p_comment: params.comment ?? null,
  });
  if (error) throw error;
}

/* ====================== Онлайн (по сети в целом) ====================== */

/**
 * Сводка по онлайн-платежам за неделю.
 * Берём одну строку из reconciliation_online_overview(p_week_start).
 * Если БД вернёт 0 строк (нет ни оплат, ни ручного ввода) —
 * возвращаем объект с нулями, чтобы фронт всё равно что-то показывал.
 */
export async function fetchOnlineOverview(
  weekStartISO: string
): Promise<OnlineRecoRow> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("reconciliation_online_overview", {
    p_week_start: weekStartISO,
  });
  if (error) throw error;

  const rows = (data as any[]) || [];

  if (!rows.length) {
    return {
      week_start: weekStartISO,
      week_end: weekStartISO, // формально понедельник, для пустой недели не критично
      expected_amount: 0,
      manual_amount: 0,
      commission: 0,
      diff: 0,
      status: "match",
    };
  }

  const r = rows[0];

  return {
    week_start: String(r.week_start),
    week_end: String(r.week_end),
    expected_amount: Number(r.expected_amount || 0),
    manual_amount: Number(r.manual_amount || 0),
    commission: Number(r.commission || 0),
    diff: Number(r.diff || 0),
    status: (r.status as OnlineRecoRow["status"]) || "match",
  };
}

/**
 * Сохраняем факт по онлайн-платежам за неделю:
 * - amountBank: сколько пришло на счёт (после комиссии)
 * - commission: комиссия эквайринга за неделю
 */
export async function upsertOnlineManual(params: {
  weekStartISO: string;
  amountBank: number;
  commission: number;
  comment?: string | null;
}) {
  const sb = getSupabase();
  const { error } = await sb.rpc("reconciliation_online_set_manual", {
    p_week_start: params.weekStartISO,
    p_amount_bank: params.amountBank,
    p_commission: params.commission,
    p_comment: params.comment ?? null,
  });
  if (error) throw error;
}
