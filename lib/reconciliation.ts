// /lib/reconciliation.ts
import getSupabase from "@/lib/supabaseClient";

/* ====================== Типы ====================== */

export type RecoRow = {
  branch_id: number;
  branch_name: string;
  week_start: string;
  week_end: string;
  cash_sales: number;       // Положительные наличные платежи
  cash_refunds: number;     // Возвраты наличными (положительная сумма для вычитания)
  cash_expenses: number;    // Расходы филиала из кассы
  cash_to_handover: number; // cash_sales - cash_refunds - cash_expenses
  deposit_fee: number;      // Комиссия за внесение наличных
  expected_amount: number;  // cash_to_handover - deposit_fee (ожидается на счёте)
  manual_amount: number;    // Фактически поступило на счёт после комиссии
  has_manual: boolean;      // Отличает настоящий ноль от ещё не внесённого факта
  diff: number;            // manual - expected
  status: "pending" | "match" | "shortage" | "overpay";
  non_cash_sales: number;
  non_cash_refunds: number;
  non_cash_payments: number;
};

export type OnlineRecoRow = {
  week_start: string;      // YYYY-MM-DD
  week_end: string;        // YYYY-MM-DD
  expected_amount: number; // "Должно быть" онлайн по POS (non_cash_payments)
  manual_amount: number;   // Факт по банку (что реально пришло на счёт, после комиссии)
  commission: number;      // Комиссия эквайринга за период
  diff: number;            // (manual + commission) - expected
  status: "pending" | "match" | "shortage" | "overpay";
};

/* ====================== Утилиты периода сверки ====================== */

const RECONCILIATION_TRANSITION_START = "2026-08-10";
const RECONCILIATION_TRANSITION_END = "2026-08-15";
const RECONCILIATION_SUNDAY_CUTOVER = "2026-08-16";

function parseISODateUTC(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysISO(iso: string, days: number): string {
  const date = parseISODateUTC(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getReconciliationPeriodStart(d: Date): string {
  // Глобальная страница сверки следует бизнес-дате Бишкека, а не timezone
  // браузера. На сервере сами операции распределяются по timezone филиала.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const getPart = (type: "year" | "month" | "day") =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  const dt = new Date(Date.UTC(getPart("year"), getPart("month") - 1, getPart("day")));
  const localISO = dt.toISOString().slice(0, 10);

  if (localISO < RECONCILIATION_TRANSITION_START) {
    const day = (dt.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
    dt.setUTCDate(dt.getUTCDate() - day);
    return dt.toISOString().slice(0, 10);
  }

  if (localISO < RECONCILIATION_SUNDAY_CUTOVER) {
    return RECONCILIATION_TRANSITION_START;
  }

  dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay()); // Sun=0 ... Sat=6
  return dt.toISOString().slice(0, 10);
}

export function getReconciliationPeriodEnd(periodStartISO: string): string {
  if (periodStartISO === RECONCILIATION_TRANSITION_START) {
    return RECONCILIATION_TRANSITION_END;
  }
  return addDaysISO(periodStartISO, 6);
}

export function shiftReconciliationPeriodISO(
  periodStartISO: string,
  periods: number,
): string {
  let result = periodStartISO;
  const direction = Math.sign(periods);

  for (let index = 0; index < Math.abs(periods); index += 1) {
    if (direction > 0 && result === RECONCILIATION_TRANSITION_START) {
      result = RECONCILIATION_SUNDAY_CUTOVER;
    } else if (direction < 0 && result === RECONCILIATION_SUNDAY_CUTOVER) {
      result = RECONCILIATION_TRANSITION_START;
    } else {
      result = addDaysISO(result, direction * 7);
    }
  }

  return result;
}

/* ====================== Наличные (по филиалам) ====================== */

export async function fetchOverview(weekStartISO: string): Promise<RecoRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("reconciliation_overview_v2", {
    p_week_start: weekStartISO,
  });
  if (error) throw error;

  return ((data as any[]) || []).map((r) => {
    const hasManual = Boolean(r.has_manual);
    const status = String(r.status || "");
    const normalizedStatus: RecoRow["status"] = !hasManual
      ? "pending"
      : status === "match" || status === "shortage" || status === "overpay"
        ? status
        : "match";

    return {
      branch_id: Number(r.branch_id),
      branch_name: String(r.branch_name),
      week_start: String(r.week_start || weekStartISO),
      week_end: String(r.week_end || weekStartISO),
      cash_sales: Number(r.cash_sales || 0),
      cash_refunds: Number(r.cash_refunds || 0),
      cash_expenses: Number(r.cash_expenses || 0),
      cash_to_handover: Number(r.cash_to_handover || 0),
      deposit_fee: Number(r.deposit_fee || 0),
      expected_amount: Number(r.expected_amount || 0),
      manual_amount: Number(r.manual_amount || 0),
      has_manual: hasManual,
      diff: Number(r.diff || 0),
      status: normalizedStatus,
      non_cash_sales: Number(r.non_cash_sales || 0),
      non_cash_refunds: Number(r.non_cash_refunds || 0),
      non_cash_payments: Number(r.non_cash_payments || 0),
    };
  });
}

export async function upsertManualAmount(params: {
  weekStartISO: string;
  branchId: number;
  amount: number;
  depositFee: number;
  comment?: string | null;
}) {
  const sb = getSupabase();
  const { error } = await sb.rpc("reconciliation_set_manual_v2", {
    p_week_start: params.weekStartISO,
    p_branch_id: params.branchId,
    p_amount: params.amount,
    p_deposit_fee: params.depositFee,
    p_comment: params.comment ?? null,
  });
  if (error) throw error;
}

/* ====================== Онлайн (по сети в целом) ====================== */

/**
 * Сводка по онлайн-платежам за выбранный период сверки.
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
      week_end: getReconciliationPeriodEnd(weekStartISO),
      expected_amount: 0,
      manual_amount: 0,
      commission: 0,
      diff: 0,
      status: "pending",
    };
  }

  const r = rows[0];
  const rawStatus = String(r.status || "pending");
  const status: OnlineRecoRow["status"] =
    rawStatus === "match" || rawStatus === "shortage" || rawStatus === "overpay"
      ? rawStatus
      : "pending";

  return {
    week_start: String(r.week_start),
    week_end: String(r.week_end),
    expected_amount: Number(r.expected_amount || 0),
    manual_amount: Number(r.manual_amount || 0),
    commission: Number(r.commission || 0),
    diff: Number(r.diff || 0),
    status,
  };
}

/**
 * Сохраняем факт по онлайн-платежам за период:
 * - amountBank: сколько пришло на счёт (после комиссии)
 * - commission: комиссия эквайринга за период
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
