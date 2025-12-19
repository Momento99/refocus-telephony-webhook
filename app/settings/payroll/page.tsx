"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  usePayrollMonthly,
  dbRoleToUi,
  uiRoleToDb,
  type RoleT,
} from "./usePayrollMonthly";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Wallet, Building2 } from "lucide-react";

/* ---------- Supabase клиент (для модалки + профили) ---------- */
const sb: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
  { auth: { persistSession: false } }
);

/* ---------- утилы ---------- */
function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
function fmt(n?: number) {
  return (n ?? 0).toLocaleString("ru-RU");
}
function fmtHM(hours?: number) {
  const totalMin = Math.max(0, Math.round((hours ?? 0) * 60));
  const h = Math.trunc(totalMin / 60);
  const m = totalMin % 60;
  return `${h} ч ${m} мин`;
}
/* Считаем сотрудника активным, если нет явного false в is_active/active */
function isEmpActive(e: any) {
  if (e?.is_active === false) return false;
  if (e?.active === false) return false;
  return true;
}

const MONTHS_RU = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

function parseMonthStr(month: string): { year: number; monthIndex: number } {
  const mOk = /^\d{4}-\d{2}$/.test(month);
  if (!mOk) {
    const d = new Date();
    return { year: d.getFullYear(), monthIndex: d.getMonth() };
  }
  const [yStr, mStr] = month.split("-");
  const year = Number(yStr);
  const monthIndex = Math.min(
    11,
    Math.max(0, Number(mStr) - 1 || new Date().getMonth())
  );
  return { year, monthIndex };
}

function formatMonthRu(month: string): string {
  const { year, monthIndex } = parseMonthStr(month);
  const name = MONTHS_RU[monthIndex] ?? month;
  return `${name} ${year}`;
}

/** Диапазон месяца по строке "YYYY-MM" */
function getMonthRange(month: string): { start: string; end: string } {
  const mOk = /^\d{4}-\d{2}$/.test(month);
  const base = mOk
    ? month
    : (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
          2,
          "0"
        )}`;
      })();

  const [yStr, mStr] = base.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const pad = (n: number) => String(n).padStart(2, "0");

  const start = `${y}-${mStr}-01`;
  const next = new Date(y, m, 1); // 1-е число следующего месяца
  const end = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(
    next.getDate()
  )}`;

  return { start, end };
}

type WeekRange = {
  key: string;
  label: string;
  start: string; // включительно
  endExclusive: string; // НЕ включительно
};

/** Недели месяца: [1–7], [8–14], [15–21], [22–28], [29–конец] */
function getWeeksForMonth(month: string): WeekRange[] {
  const { start, end } = getMonthRange(month); // start = YYYY-MM-01, end = 1-е след. месяца
  const [yStr, mStr] = start.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const lastDay = new Date(y, m, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");

  const weeks: WeekRange[] = [];
  let from = 1;
  let idx = 1;

  while (from <= lastDay) {
    const to = Math.min(from + 6, lastDay);
    const startStr = `${yStr}-${mStr}-${pad(from)}`;

    let endExclusive: string;
    if (to === lastDay) {
      endExclusive = end; // уже посчитали как начало следующего месяца
    } else {
      const nextDay = to + 1;
      endExclusive = `${yStr}-${mStr}-${pad(nextDay)}`;
    }

    const label = `${idx}-я неделя (${pad(from)}.${mStr}–${pad(to)}.${mStr})`;
    weeks.push({
      key: `${month}-w${idx}`,
      label,
      start: startStr,
      endExclusive,
    });

    from = to + 1;
    idx++;
  }

  return weeks;
}

/* ---------- общий стиль контролов ---------- */
const inputCls = cx(
  "h-9 w-full rounded-2xl bg-white/90 px-3 text-sm text-slate-900 placeholder:text-slate-400",
  "ring-1 ring-sky-200/80 shadow-[0_14px_40px_rgba(15,23,42,0.18)] backdrop-blur",
  "focus:outline-none focus:ring-2 focus:ring-cyan-400/80"
);
const selectCls = cx(
  "h-9 rounded-2xl bg-white/90 px-2 text-sm text-slate-900",
  "ring-1 ring-sky-200/80 shadow-[0_14px_40px_rgba(15,23,42,0.18)] backdrop-blur",
  "focus:outline-none focus:ring-2 focus:ring-cyan-400/80"
);

/* ---------- элементы управления ---------- */
function TextCell({
  value,
  onCommit,
  className,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => Promise<void> | void;
  className?: string;
  placeholder?: string;
}) {
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);

  useEffect(() => setV(value), [value]);

  async function commit(newV: string) {
    if (newV === value) return;
    setBusy(true);
    try {
      await onCommit(newV.trim());
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="relative">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => commit(v)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setV(value);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder}
        className={cx(inputCls, className)}
      />
      {busy && (
        <span className="absolute right-2 top-2 h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-400" />
      )}
    </div>
  );
}

function NumberCell({
  value,
  onCommit,
  className,
  min = 0,
  step = 1,
  readOnly = false,
  suffix,
}: {
  value: number;
  onCommit: (v: number) => Promise<void> | void;
  className?: string;
  min?: number;
  step?: number;
  readOnly?: boolean;
  suffix?: string;
}) {
  const norm = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  const [v, setV] = useState<number>(norm(value));
  const [busy, setBusy] = useState(false);

  useEffect(() => setV(norm(value)), [value]);

  async function commit(newV: number) {
    const vv = norm(newV);
    if (vv === norm(value)) return;
    setBusy(true);
    try {
      await onCommit(vv);
    } finally {
      setBusy(false);
    }
  }

  if (readOnly) {
    return (
      <div className={cx("h-9 px-1 text-right text-sm leading-9 text-slate-900", className)}>
        {fmt(value)}
        {suffix ? ` ${suffix}` : ""}
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="number"
        min={min}
        step={step}
        value={v}
        onChange={(e) => setV(norm(e.target.value))}
        onBlur={() => commit(v)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setV(norm(value));
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        className={cx(
          inputCls,
          "pr-9 text-right tabular-nums",
          className
        )}
      />
      {busy && (
        <span className="absolute right-2 top-2 h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-400" />
      )}
      {suffix ? (
        <span className="pointer-events-none absolute right-3 top-1.5 text-xs text-slate-500">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

function Switch({
  checked,
  onCommit,
}: {
  checked: boolean;
  onCommit: (v: boolean) => Promise<void> | void;
}) {
  const [v, setV] = useState(checked);
  const [busy, setBusy] = useState(false);

  useEffect(() => setV(checked), [checked]);

  async function toggle() {
    const prev = v;
    const next = !prev;
    setV(next);
    setBusy(true);
    try {
      await onCommit(next);
    } catch {
      setV(prev);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={cx(
        "relative h-6 w-10 rounded-full transition-colors ring-1 ring-white/30 shadow-[0_10px_30px_rgba(15,23,42,0.18)]",
        v ? "bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400" : "bg-slate-300"
      )}
      aria-pressed={v}
      title={v ? "Бонусы включены" : "Бонусы выключены"}
    >
      <span
        className={cx(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
          v ? "left-[18px]" : "left-0.5"
        )}
      />
      {busy && (
        <span className="absolute -right-6 top-0.5 h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-400" />
      )}
    </button>
  );
}

/* ---------- карточки / кнопки ---------- */
function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "rounded-3xl p-5 sm:p-6",
        "bg-gradient-to-br from-white via-slate-50 to-sky-50/85",
        "ring-1 ring-sky-200/80 backdrop-blur-xl",
        "shadow-[0_22px_70px_rgba(15,23,42,0.60)] text-slate-900",
        className
      )}
    >
      {children}
    </div>
  );
}

function HeaderCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cx(
        "rounded-3xl p-5 sm:p-6",
        "bg-white/5 ring-1 ring-white/10 backdrop-blur-2xl",
        "shadow-[0_22px_70px_rgba(0,0,0,0.55)]"
      )}
    >
      {children}
    </div>
  );
}

function PrimaryBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={cx(
        "rounded-xl px-4 py-2 text-sm font-medium text-white",
        "bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400",
        "shadow-[0_16px_44px_rgba(34,211,238,0.35)] hover:brightness-110 active:brightness-95 active:scale-[0.99]",
        "focus:outline-none focus:ring-2 focus:ring-teal-300/70",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        className
      )}
    />
  );
}

function GhostBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={cx(
        "rounded-xl px-3.5 py-2 text-sm font-medium",
        "bg-white/85 hover:bg-white text-teal-700",
        "ring-1 ring-teal-200 shadow-[0_14px_40px_rgba(15,23,42,0.18)]",
        "focus:outline-none focus:ring-2 focus:ring-teal-300/70",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        className
      )}
    />
  );
}

function DangerBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={cx(
        "rounded-xl px-4 py-2 text-sm font-medium text-rose-700",
        "bg-white/90 hover:bg-rose-50",
        "ring-1 ring-rose-200 shadow-[0_14px_40px_rgba(15,23,42,0.18)]",
        "focus:outline-none focus:ring-2 focus:ring-rose-300/70",
        className
      )}
    />
  );
}

/* ===========================================
   СТРАНИЦА
=========================================== */
export default function Page() {
  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const { year, monthIndex } = useMemo(() => parseMonthStr(month), [month]);
  const years = useMemo(() => {
    const cur = new Date().getFullYear();
    return [cur - 1, cur, cur + 1];
  }, []);

  function handleMonthChange(nextYear: number, nextMonthIndex: number) {
    const mm = String(nextMonthIndex + 1).padStart(2, "0");
    setMonth(`${nextYear}-${mm}`);
    setWeekKey("__full__");
  }

  // выбор недели
  const [weekKey, setWeekKey] = useState<string>("__full__");
  const weeks = useMemo(() => getWeeksForMonth(month), [month]);
  const activeWeek = useMemo(
    () => weeks.find((w) => w.key === weekKey) ?? null,
    [weeks, weekKey]
  );

  const {
    data,
    isLoading,
    errorText,
    mutate,
    updateConfig,
    addBranch,
    renameBranch,
    removeBranch,
    addEmployee,
    updateEmployee,
    removeEmployee,
  } = usePayrollMonthly(month);

  const branches = data?.branches ?? [];
  const employees = data?.employees ?? [];
  const cfg = data?.cfg;

  /* показываем актуальные значения конфигурации, без нулей */
  const [cfgLocal, setCfgLocal] = useState<typeof cfg | null>(null);
  useEffect(() => {
    setCfgLocal(cfg ?? null);
  }, [cfg]);

  /* ===== Weekly data from v_payroll_daily_fixed ===== */
  const [weekNetMap, setWeekNetMap] = useState<Map<string, number> | null>(null);
  const [weekLoading, setWeekLoading] = useState(false);

  useEffect(() => {
    if (!activeWeek) {
      setWeekNetMap(null);
      setWeekLoading(false);
      return;
    }

    let cancelled = false;

    async function loadWeek() {
      setWeekLoading(true);
      try {
        const { data, error } = await sb
          .from("v_payroll_daily_fixed")
          .select("employee_id,branch_id,day,net_day")
          .gte("day", activeWeek.start)
          .lt("day", activeWeek.endExclusive);

        if (error) throw error;

        const m = new Map<string, number>();
        for (const r of (data ?? []) as any[]) {
          const key = `${r.employee_id}:${r.branch_id}`;
          const v = r.net_day == null ? 0 : Number(r.net_day);
          m.set(key, (m.get(key) ?? 0) + v);
        }

        if (!cancelled) setWeekNetMap(m);
      } catch (err: any) {
        console.error("loadWeek error", err);
        if (!cancelled) {
          alert(
            `Не удалось загрузить данные за неделю: ${
              err?.message || err?.error_description || String(err)
            }`
          );
          setWeekNetMap(new Map());
        }
      } finally {
        if (!cancelled) setWeekLoading(false);
      }
    }

    loadWeek();

    return () => {
      cancelled = true;
    };
  }, [activeWeek]);

  /* Показываем только активных */
  const visibleEmployees = useMemo(
    () => employees.filter(isEmpActive),
    [employees]
  );

  /* Итоги «к выплате»: по месяцу e.net, по неделе — net_day */
  const getNet = (e: any) => {
    if (activeWeek && weekNetMap) {
      const key = `${e.id}:${e.branchId}`;
      const v = weekNetMap.get(key);
      return v ?? 0;
    }
    return e.net ?? 0;
  };

  const totalNet = useMemo(
    () => visibleEmployees.reduce((s, e) => s + getNet(e), 0),
    [visibleEmployees, weekNetMap, activeWeek]
  );

  const totalNetMonth = useMemo(
    () => visibleEmployees.reduce((s, e) => s + (e.net ?? 0), 0),
    [visibleEmployees]
  );

  /* Сотрудники по филиалам */
  const byBranch = useMemo(() => {
    const m = new Map<number, typeof employees>();
    for (const e of visibleEmployees) {
      const list = m.get(e.branchId) ?? [];
      list.push(e);
      m.set(e.branchId, list);
    }
    return m;
  }, [visibleEmployees]);

  /* Итог к выплате по каждому филиалу */
  const branchTotals = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of branches) m.set(b.id, 0);
    for (const e of visibleEmployees) {
      m.set(e.branchId, (m.get(e.branchId) ?? 0) + getNet(e));
    }
    return m;
  }, [branches, visibleEmployees, weekNetMap, activeWeek]);

  /* ===== Детализация по дням (модалка) ===== */
  const [dailyMeta, setDailyMeta] = useState<null | {
    id: number;
    name: string;
    branchId: number;
    net: number;
  }>(null);
  const [dailyRows, setDailyRows] = useState<any[] | null>(null);
  const [dailyBusy, setDailyBusy] = useState(false);
  const [dailyAdj, setDailyAdj] = useState<number>(0);

  const dailyNetSum = useMemo(
    () =>
      dailyRows?.reduce(
        (s: number, r: any) => s + (r.net_day == null ? 0 : Number(r.net_day)),
        0
      ) ?? 0,
    [dailyRows]
  );
  const dailyNetWithAdj = useMemo(() => dailyNetSum + dailyAdj, [dailyNetSum, dailyAdj]);

  async function openDaily(e: {
    id: number;
    fullName: string;
    branchId: number;
    net: number;
  }) {
    setDailyMeta({
      id: e.id,
      name: e.fullName,
      branchId: e.branchId,
      net: e.net,
    });
    setDailyRows(null);
    setDailyAdj(0);
    setDailyBusy(true);

    try {
      const { start: monthStart, end: monthEnd } = getMonthRange(month);

      const rangeStart = activeWeek ? activeWeek.start : monthStart;
      const rangeEnd = activeWeek ? activeWeek.endExclusive : monthEnd;

      const { data: days, error: errDays } = await sb
        .from("v_payroll_daily_fixed")
        .select(
          "day,hours,hour_pay,turnover,bonus,penalties,social_fund_day,income_tax_day,plan_premium,net_day"
        )
        .eq("employee_id", e.id)
        .eq("branch_id", e.branchId)
        .gte("day", rangeStart)
        .lt("day", rangeEnd)
        .order("day", { ascending: true });

      if (errDays) throw errDays;
      const rawDays = (days ?? []) as any[];

      const { data: adjRow, error: errAdj } = await sb
        .from("v_payroll_adjustments_monthly")
        .select("adjustments_sum")
        .eq("employee_id", e.id)
        .eq("branch_id", e.branchId)
        .eq("month", monthStart)
        .maybeSingle();

      if (errAdj) throw errAdj;

      const adj =
        adjRow && adjRow.adjustments_sum != null ? Number(adjRow.adjustments_sum) : 0;

      if (rawDays.length === 0 && Math.round(adj) === 0) {
        setDailyRows([]);
        setDailyAdj(0);
        return;
      }

      setDailyRows(rawDays);
      setDailyAdj(adj);
    } catch (err: any) {
      console.error("openDaily error", err);
      alert(
        `Не удалось загрузить детализацию дня: ${
          err?.message || err?.error_description || String(err)
        }`
      );
    } finally {
      setDailyBusy(false);
    }
  }

  function closeDaily() {
    setDailyMeta(null);
    setDailyRows(null);
    setDailyAdj(0);
    setDailyBusy(false);
  }

  /* ===== Сохранение профиля сотрудника (employee_payroll_profiles) через UPSERT ===== */
  function extractErrMsg(err: any): string {
    if (!err) return "Неизвестная ошибка";
    if (typeof err === "string") return err;
    if ((err as any).message) return (err as any).message;
    if ((err as any).error_description) return (err as any).error_description;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  async function persistProfileChange(opts: {
    employeeId: number;
    branchId: number;
    hourlyRate?: number;
    hasBonus?: boolean;
    bonusPercent?: number;
  }) {
    const { employeeId, branchId, hourlyRate, hasBonus, bonusPercent } = opts;

    const payload: any = {
      employee_id: employeeId,
      branch_id: branchId,
      active: true,
      updated_at: new Date().toISOString(),
    };
    if (typeof hourlyRate === "number")
      payload.hourly_rate = Math.max(0, Math.trunc(hourlyRate));
    if (typeof hasBonus === "boolean") payload.has_bonus = hasBonus;
    if (typeof bonusPercent === "number")
      payload.bonus_percent = Math.max(0, Math.trunc(bonusPercent));

    try {
      const { error } = await sb
        .from("employee_payroll_profiles")
        .upsert(payload, { onConflict: "employee_id,branch_id" });

      if (error) {
        console.error("persistProfileChange error", error);
        alert("Не удалось сохранить профиль сотрудника: " + extractErrMsg(error));
      }
    } catch (err) {
      console.error("persistProfileChange error", err);
      alert("Не удалось сохранить профиль сотрудника: " + extractErrMsg(err));
    }
  }

  const periodLabel = activeWeek ? activeWeek.label : formatMonthRu(month);

  const rowTdBase = cx(
    "bg-white/92 backdrop-blur",
    "border-y border-sky-100/80",
    "px-3 py-3"
  );
  const rowTdFirst = cx(rowTdBase, "border-l rounded-l-2xl");
  const rowTdLast = cx(rowTdBase, "border-r rounded-r-2xl");

  return (
    <div className="relative min-h-[100dvh] bg-transparent text-slate-50">
      {/* фоновые свечения */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/2 h-72 w-[900px] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[80px]" />
        <div className="absolute top-64 left-10 h-64 w-64 rounded-full bg-sky-500/10 blur-[70px]" />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-emerald-500/10 blur-[80px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-5 pt-8 pb-10">
        {/* БАННЕР ОШИБКИ */}
        {errorText ? (
          <div
            className={cx(
              "mb-4 rounded-3xl p-4 sm:p-5",
              "bg-gradient-to-br from-white via-rose-50 to-amber-50/80",
              "ring-1 ring-rose-200/80",
              "shadow-[0_22px_70px_rgba(0,0,0,0.35)]",
              "text-slate-900"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="pr-3">
                <div className="font-semibold">Не удалось загрузить зарплаты</div>
                <div className="mt-0.5 text-sm text-slate-700">{errorText}</div>
              </div>
              <PrimaryBtn onClick={() => mutate()} title="Повторить">
                Повторить
              </PrimaryBtn>
            </div>
          </div>
        ) : null}

        {/* Header */}
        <div className="mb-4">
          <HeaderCard>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 shadow-[0_0_32px_rgba(34,211,238,0.35)] ring-1 ring-white/25">
                  <Wallet className="h-5 w-5 text-white" />
                </div>
                <div className="space-y-1">
                  <div className="text-[30px] leading-none font-semibold tracking-tight text-slate-50 drop-shadow-[0_10px_30px_rgba(34,211,238,0.20)]">
                    Зарплаты
                  </div>
                  <div className="text-[12px] text-sky-200/90">
                    Еженедельные выплаты по филиалам •{" "}
                    <span className="font-medium text-sky-50">{periodLabel}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <span className="text-sky-200/90">Месяц</span>
                  <select
                    value={monthIndex}
                    onChange={(e) => handleMonthChange(year, Number(e.target.value))}
                    className={selectCls}
                  >
                    {MONTHS_RU.map((name, idx) => (
                      <option key={idx} value={idx}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={year}
                    onChange={(e) => handleMonthChange(Number(e.target.value), monthIndex)}
                    className={selectCls}
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <span className="text-sky-200/90">Неделя</span>
                  <select
                    value={weekKey}
                    onChange={(e) => setWeekKey(e.target.value)}
                    className={selectCls}
                  >
                    <option value="__full__">Весь месяц</option>
                    {weeks.map((w) => (
                      <option key={w.key} value={w.key}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                </label>

                {weekLoading && (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-cyan-300" />
                )}

                <PrimaryBtn
                  onClick={async () => {
                    const name = prompt("Название филиала");
                    if (!name) return;
                    try {
                      await addBranch(name);
                      await mutate();
                    } catch (e: any) {
                      alert(`Ошибка: ${e.message}`);
                    }
                  }}
                >
                  + Филиал
                </PrimaryBtn>
              </div>
            </div>
          </HeaderCard>
        </div>

        {/* KPI + Конфигурация */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Карточка «К выплате» + список филиалов */}
          <Card>
            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
                <span className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-sky-100 via-white to-sky-50 ring-1 ring-sky-200/70">
                  <Building2 className="h-4 w-4 text-sky-700" />
                </span>
                К выплате
              </div>
              <div className="text-[11px] text-slate-500">
                {activeWeek ? "за выбранную неделю" : "за месяц"}
              </div>
            </div>

            <div className="mt-2 flex items-baseline gap-3">
              <div className="text-3xl font-semibold text-teal-700 tabular-nums">
                {fmt(totalNet)} сом
              </div>
            </div>

            {activeWeek && (
              <div className="mt-1 text-xs text-slate-600">
                За месяц:{" "}
                <span className="font-medium text-teal-700">{fmt(totalNetMonth)} сом</span>
              </div>
            )}

            <div className="mt-4 rounded-3xl bg-white/90 ring-1 ring-sky-200/80 p-4 shadow-[0_18px_55px_rgba(15,23,42,0.20)]">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                По филиалам
              </div>
              <ul className="space-y-1.5 text-sm">
                {branches.map((b) => (
                  <li key={b.id} className="flex items-center justify-between">
                    <span className="text-slate-800">{b.name}</span>
                    <span className="font-semibold text-teal-700 tabular-nums">
                      {fmt(branchTotals.get(b.id) ?? 0)} сом
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          {/* Настройки расчёта */}
          <Card>
            <div className="mb-2 text-sm font-semibold text-slate-900">Настройки расчёта</div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <div className="text-slate-700">Подоходный (мес.)</div>
              <NumberCell
                value={cfgLocal?.income_tax_monthly ?? 0}
                onCommit={async (v) => {
                  const vv = Math.max(0, Math.trunc(v));
                  setCfgLocal((c) => (c ? { ...c, income_tax_monthly: vv } : c));
                  await updateConfig({ income_tax_monthly: vv });
                  await mutate();
                }}
                suffix="сом"
              />

              <div className="text-slate-700">Соцфонд (мес.)</div>
              <NumberCell
                value={cfgLocal?.social_fund_monthly ?? 0}
                onCommit={async (v) => {
                  const vv = Math.max(0, Math.trunc(v));
                  setCfgLocal((c) => (c ? { ...c, social_fund_monthly: vv } : c));
                  await updateConfig({ social_fund_monthly: vv });
                  await mutate();
                }}
                suffix="сом"
              />

              <div className="text-slate-700">Порог выручки/день</div>
              <NumberCell
                value={cfgLocal?.daily_turnover_target ?? 0}
                onCommit={async (v) => {
                  const vv = Math.max(0, Math.trunc(v));
                  setCfgLocal((c) => (c ? { ...c, daily_turnover_target: vv } : c));
                  await updateConfig({ daily_turnover_target: vv });
                  await mutate();
                }}
                suffix="сом"
              />

              <div className="text-slate-700">Премия за день</div>
              <NumberCell
                value={cfgLocal?.daily_bonus_each ?? 0}
                onCommit={async (v) => {
                  const vv = Math.max(0, Math.trunc(v));
                  setCfgLocal((c) => (c ? { ...c, daily_bonus_each: vv } : c));
                  await updateConfig({ daily_bonus_each: vv });
                  await mutate();
                }}
                suffix="сом"
              />
            </div>

            <p className="mt-3 text-xs text-slate-500">
              Эти параметры читаются терминалом и участвуют в расчёте «new order».
            </p>
          </Card>
        </div>

        {/* Список филиалов */}
        {isLoading ? (
          <Card className="mt-6">
            <div className="flex items-center gap-3 text-slate-700">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-400" />
              Гружу данные…
            </div>
          </Card>
        ) : (
          branches.map((b) => {
            const list = (byBranch.get(b.id) ?? []).slice();
            return (
              <Card key={b.id} className="mt-6">
                {/* Заголовок филиала */}
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                      ID {b.id}
                    </span>
                    <TextCell
                      value={b.name}
                      onCommit={async (v) => {
                        if (!v.trim() || v.trim() === b.name) return;
                        await renameBranch(b.id, v.trim());
                        await mutate();
                      }}
                      className="w-64"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <PrimaryBtn
                      onClick={async () => {
                        try {
                          await addEmployee({
                            branchId: b.id,
                            fullName: "Новый сотрудник",
                            role: "seller",
                            hourlyRate: 120,
                            hasBonus: true,
                            bonusPercent: 10,
                          });
                          await mutate();
                        } catch (e: any) {
                          alert(`Ошибка: ${e.message}`);
                        }
                      }}
                    >
                      + Сотрудник
                    </PrimaryBtn>
                    <DangerBtn
                      onClick={async () => {
                        if (!confirm(`Удалить филиал «${b.name}»?`)) return;
                        try {
                          await removeBranch(b.id);
                          await mutate();
                        } catch (e: any) {
                          alert(`Не удалось удалить: ${e.message}`);
                        }
                      }}
                    >
                      Удалить филиал
                    </DangerBtn>
                  </div>
                </div>

                {/* Таблица сотрудников */}
                <div className="overflow-x-auto">
                  <table className="w-full table-auto border-separate border-spacing-y-3">
                    <colgroup>
                      <col className="w-[280px]" />
                      <col className="w-[160px]" />
                      <col className="w-[120px]" />
                      <col className="w-[110px]" />
                      <col className="w-[120px]" />
                      <col className="w-[140px]" />
                      <col className="w-[220px]" />
                    </colgroup>

                    <thead>
                      <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="text-left px-2">Сотрудник</th>
                        <th className="text-left px-2">Роль</th>
                        <th className="text-right px-2">Ставка/ч</th>
                        <th className="text-center px-2">Бонус</th>
                        <th className="text-right px-2">Бонус %</th>
                        <th className="text-right px-2">
                          К выплате{" "}
                          {activeWeek ? (
                            <span className="text-[10px] text-slate-400">(неделя)</span>
                          ) : (
                            <span className="text-[10px] text-slate-400">(месяц)</span>
                          )}
                        </th>
                        <th className="text-right px-2">Действия</th>
                      </tr>
                    </thead>

                    <tbody>
                      {list.map((e: any) => {
                        const roleUi = dbRoleToUi(e.role) as Exclude<RoleT, "owner">;
                        const netFromDb = getNet(e);

                        return (
                          <tr key={e.id} className="align-middle">
                            <td className={rowTdFirst}>
                              <TextCell
                                value={e.fullName}
                                onCommit={async (v) => {
                                  await updateEmployee(e.id, { fullName: v });
                                  await mutate();
                                }}
                                className="w-[270px]"
                              />
                            </td>

                            <td className={rowTdBase}>
                              <select
                                value={roleUi}
                                onChange={async (ev) => {
                                  const val = ev.target.value as RoleT;
                                  await updateEmployee(e.id, { role: uiRoleToDb(val) });
                                  await mutate();
                                }}
                                className={cx(selectCls, "h-9 w-[150px]")}
                              >
                                <option value="seller">Продавец</option>
                                <option value="promoter">Промоутер</option>
                                <option value="master">Мастер</option>
                              </select>
                            </td>

                            <td className={cx(rowTdBase, "text-right")}>
                              <NumberCell
                                value={e.hourlyRate ?? 0}
                                onCommit={async (v) => {
                                  await updateEmployee(e.id, { hourlyRate: v });
                                  await persistProfileChange({
                                    employeeId: e.id,
                                    branchId: b.id,
                                    hourlyRate: v,
                                    hasBonus: e.hasBonus ?? false,
                                    bonusPercent: e.bonusPercent ?? 0,
                                  });
                                  await mutate();
                                }}
                                className="w-[120px]"
                                step={5}
                                suffix="сом"
                              />
                            </td>

                            <td className={cx(rowTdBase, "text-center")}>
                              <div className="flex items-center justify-center">
                                <Switch
                                  checked={!!e.hasBonus}
                                  onCommit={async (v) => {
                                    await updateEmployee(e.id, { hasBonus: v });
                                    await persistProfileChange({
                                      employeeId: e.id,
                                      branchId: b.id,
                                      hourlyRate: e.hourlyRate ?? 0,
                                      hasBonus: v,
                                      bonusPercent: e.bonusPercent ?? 0,
                                    });
                                    await mutate();
                                  }}
                                />
                              </div>
                            </td>

                            <td className={cx(rowTdBase, "text-right")}>
                              <NumberCell
                                value={e.bonusPercent ?? 0}
                                onCommit={async (v) => {
                                  await updateEmployee(e.id, { bonusPercent: v });
                                  await persistProfileChange({
                                    employeeId: e.id,
                                    branchId: b.id,
                                    hourlyRate: e.hourlyRate ?? 0,
                                    hasBonus: e.hasBonus ?? false,
                                    bonusPercent: v,
                                  });
                                  await mutate();
                                }}
                                className="w-[120px]"
                                step={1}
                                suffix="%"
                              />
                            </td>

                            <td className={cx(rowTdBase, "text-right font-semibold text-teal-700 tabular-nums")}>
                              {fmt(netFromDb)}
                            </td>

                            <td className={cx(rowTdLast, "text-right")}>
                              <div className="flex justify-end gap-2">
                                <GhostBtn
                                  onClick={() =>
                                    openDaily({
                                      id: e.id,
                                      fullName: e.fullName,
                                      branchId: b.id,
                                      net: netFromDb,
                                    })
                                  }
                                  title="Показать детализацию по дням за период"
                                >
                                  Детали
                                </GhostBtn>

                                <DangerBtn
                                  onClick={async () => {
                                    if (!confirm(`Удалить сотрудника «${e.fullName}»?`)) return;
                                    try {
                                      await removeEmployee(e.id);
                                      await mutate();
                                    } catch (err: any) {
                                      alert(
                                        `Не удалось удалить: ${
                                          err?.message || err?.error_description || String(err)
                                        }`
                                      );
                                    }
                                  }}
                                >
                                  Удалить
                                </DangerBtn>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Итого по филиалу */}
                <div className="mt-4 flex items-center justify-end">
                  <div className="text-sm text-slate-700">
                    Итого по филиалу:{" "}
                    <span className="font-semibold text-teal-700 tabular-nums">
                      {fmt(
                        (byBranch.get(b.id) ?? []).reduce(
                          (s, e: any) => s + getNet(e),
                          0
                        )
                      )}{" "}
                      сом
                    </span>
                  </div>
                </div>
              </Card>
            );
          })
        )}

        {/* Модалка «Детали по дням» */}
        {dailyMeta && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onKeyDown={(e) => e.key === "Escape" && closeDaily()}
          >
            <div className="max-h-[90vh] w-[980px] overflow-hidden rounded-3xl bg-white/95 ring-1 ring-sky-200 shadow-[0_30px_120px_rgba(0,0,0,0.65)] backdrop-blur-2xl">
              <div className="flex items-center justify-between border-b border-sky-200 px-4 py-3 bg-gradient-to-r from-sky-50 via-white to-sky-50/80">
                <div className="text-sm">
                  <div className="font-semibold text-slate-900">{dailyMeta.name}</div>
                  <div className="text-xs text-slate-500">
                    Детализация за {activeWeek ? activeWeek.label : formatMonthRu(month)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {dailyBusy || dailyRows === null ? (
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-400" />
                  ) : null}
                  <GhostBtn onClick={closeDaily}>Закрыть</GhostBtn>
                </div>
              </div>

              <div className="max-h-[70vh] overflow-auto px-4 py-3">
                {!dailyRows?.length ? (
                  <div className="py-10 text-center text-sm text-slate-600">
                    Данных за выбранный период нет.
                  </div>
                ) : (
                  <table className="min-w-full table-fixed border-separate border-spacing-y-3">
                    <colgroup>
                      <col className="w-[110px]" />
                      <col className="w-[110px]" />
                      <col className="w-[110px]" />
                      <col className="w-[110px]" />
                      <col className="w-[110px]" />
                      <col className="w-[110px]" />
                      <col className="w-[110px]" />
                      <col className="w-[110px]" />
                      <col className="w-[110px]" />
                    </colgroup>

                    <thead>
                      <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="text-left px-2">День</th>
                        <th className="text-right px-2">Часы</th>
                        <th className="text-right px-2">Часовка</th>
                        <th className="text-right px-2">Бонус</th>
                        <th className="text-right px-2">Штрафы</th>
                        <th className="text-right px-2">Соцфонд</th>
                        <th className="text-right px-2">Подоходный</th>
                        <th className="text-right px-2">Премия</th>
                        <th className="text-right px-2">Итог дня</th>
                      </tr>
                    </thead>

                    <tbody>
                      {dailyRows.map((r: any) => (
                        <tr key={r.day}>
                          <td className={rowTdFirst}>
                            <span className="text-sm text-slate-800">{r.day}</span>
                          </td>
                          <td className={cx(rowTdBase, "text-right text-sm text-slate-800")}>
                            {fmtHM(r.hours)}
                          </td>
                          <td className={cx(rowTdBase, "text-right text-sm text-slate-800")}>
                            {fmt(r.hour_pay)}
                          </td>
                          <td className={cx(rowTdBase, "text-right text-sm text-slate-800")}>
                            {fmt(r.bonus)}
                          </td>
                          <td className={cx(rowTdBase, "text-right text-sm text-slate-800")}>
                            {fmt(r.penalties)}
                          </td>
                          <td className={cx(rowTdBase, "text-right text-sm text-slate-800")}>
                            {fmt(r.social_fund_day)}
                          </td>
                          <td className={cx(rowTdBase, "text-right text-sm text-slate-800")}>
                            {fmt(r.income_tax_day)}
                          </td>
                          <td className={cx(rowTdBase, "text-right text-sm text-slate-800")}>
                            {fmt(r.plan_premium)}
                          </td>
                          <td
                            className={cx(
                              rowTdLast,
                              "text-right text-sm font-semibold tabular-nums",
                              r.net_day < 0 ? "text-rose-600" : "text-teal-700"
                            )}
                          >
                            {fmt(r.net_day)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {dailyRows?.length ? (
                <div className="border-t border-sky-200 px-4 py-3 text-right text-sm space-y-1 bg-gradient-to-r from-sky-50 via-white to-sky-50/80">
                  <div>
                    <span className="text-slate-600">Итого по дням (без корректировок): </span>
                    <span className="font-semibold text-teal-700 tabular-nums">
                      {fmt(dailyNetSum)} сом
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-600">Корректировки месяца: </span>
                    <span className="font-semibold text-teal-700 tabular-nums">
                      {fmt(dailyAdj)} сом
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-600">Итого за период (как в таблице): </span>
                    <span className="font-semibold text-teal-700 tabular-nums">
                      {fmt(dailyNetWithAdj)} сом
                    </span>
                    {typeof dailyMeta?.net === "number" ? (
                      <span className="ml-2 text-xs text-slate-500">
                        • К выплате в списке сейчас: {fmt(dailyMeta.net)} сом
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        <footer className="mt-8 text-center text-xs text-sky-200/80">
          Редактор зарплат REFOCUS. Данные тянутся из Supabase, расчёт по дням и неделям.
        </footer>
      </div>
    </div>
  );
}
