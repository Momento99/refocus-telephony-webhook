"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  usePayrollMonthly,
  dbRoleToUi,
  uiRoleToDb,
  type RoleT,
} from "./usePayrollMonthly";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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

/** Недели месяца как календарные недели ПН–ВС, но внутри границ месяца (обрезаем по месяцу) */
function getWeeksForMonth(month: string): WeekRange[] {
  const { year, monthIndex } = parseMonthStr(month);

  const pad2 = (n: number) => String(n).padStart(2, "0");

  const dateToYMD = (d: Date) => {
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    return `${y}-${m}-${day}`;
  };

  const dateToDM = (d: Date) => `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`;

  const addDays = (d: Date, days: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
  };

  const monthStart = new Date(year, monthIndex, 1);
  const monthEndExcl = new Date(year, monthIndex + 1, 1);

  const weeks: WeekRange[] = [];
  let idx = 1;
  let cursor = new Date(monthStart);

  while (cursor < monthEndExcl) {
    const start = new Date(cursor);

    // JS: 0=вс,1=пн,...6=сб
    const dow = start.getDay();

    // до ближайшего понедельника (конец недели exclusive)
    let daysToNextMon = (8 - dow) % 7;
    if (daysToNextMon === 0) daysToNextMon = 7;

    let endExcl = addDays(start, daysToNextMon);
    if (endExcl > monthEndExcl) endExcl = new Date(monthEndExcl);

    const endIncl = addDays(endExcl, -1);

    weeks.push({
      key: `${month}-w${idx}`,
      label: `${idx}-я неделя (${dateToDM(start)}–${dateToDM(endIncl)})`,
      start: dateToYMD(start),
      endExclusive: dateToYMD(endExcl),
    });

    cursor = endExcl;
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
      <div
        className={cx(
          "h-9 px-1 text-right text-sm leading-9 text-slate-900",
          className
        )}
      >
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
        className={cx(inputCls, "pr-9 text-right tabular-nums", className)}
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
        v
          ? "bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400"
          : "bg-slate-300"
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

/* ---------- Авто-план по филиалам ---------- */
const BRANCH_PLAN_TABLE = "payroll_branch_plans";

/**
 * ВАЖНО:
 * - Округление порога и премии — ДО 1000 (порог округляем ВВЕРХ, премию — до ближайшей 1000)
 * - Порог берём не “тупо прошлый месяц”, а из истории + тренд + защита от сезонных провалов
 * - Премия растёт вместе с порогом и также имеет “ускорение” (чуть растущий % по мере роста порога)
 */
const AUTO_PLAN = {
  version: "monthly-plan-v2",
  historyMonths: 6, // история (без текущего месяца): -6..-1
  quantile: 0.7, // “нормально хороший” уровень
  // рост порога: базовые рамки + динамика от тренда, затем защита от волатильности
  gMinBase: 0.06,
  gMaxBase: 0.18,
  gMinFloor: 0.03,
  gMinCeil: 0.10,
  gMaxFloor: 0.10,
  gMaxCeil: 0.25,
  trendWeightMin: 0.25,
  trendWeightMax: 0.35,
  trendClampMin: -0.15,
  trendClampMax: 0.20,
  // если прошлый месяц сильно просел от “типичного”, подтягиваем якорь к типичному
  anchorTypicalWeightLow: 0.70, // когда prev <= 80% typical
  anchorTypicalWeightMid: 0.55, // когда prev между 80..100% typical
  typicalFloorFactor: 0.25, // часть gMin, чтобы не “уронить” план далеко ниже typical
  // волатильность: если месяцы сильно скачут — режем gMax
  volatilitySoftCap: 0.25,
  volatilityHardCap: 0.50,
  // округления
  roundStep: 1000, // порог округление вверх до 1000
  bonusStep: 1000, // премия округление до 1000
  // премия: динамический “ускоряющийся” процент (по порогу)
  bonusMinAbs: 2000,
  bonusMinRate: 0.008, // минимум ~0.8% (для маленьких планов не стало “копейки”)
  bonusMaxRate: 0.020, // максимум 2.0% (защита от разгона)
};

// чем больше порог — тем выше % премии (плавно)
const BONUS_TIERS: Array<{ upTo: number; rate: number }> = [
  { upTo: 300_000, rate: 0.0120 },
  { upTo: 600_000, rate: 0.0125 },
  { upTo: 1_000_000, rate: 0.0130 },
  { upTo: 2_000_000, rate: 0.0135 },
  { upTo: 3_000_000, rate: 0.0140 },
  { upTo: 5_000_000, rate: 0.0145 },
  { upTo: Infinity, rate: 0.0150 },
];

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}
function roundTo(n: number, step: number) {
  if (step <= 0) return Math.round(n);
  return Math.round(n / step) * step;
}
function roundUpTo(n: number, step: number) {
  if (step <= 0) return Math.ceil(n);
  return Math.ceil(n / step) * step;
}
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function shiftMonthKey(month: string, delta: number): string {
  const { year, monthIndex } = parseMonthStr(month);
  const d = new Date(year, monthIndex + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function shiftMonthStart(monthStart: string, delta: number): string {
  // monthStart: YYYY-MM-01
  const [y, m] = monthStart.split("-").map((x) => Number(x));
  const d = new Date(y, (m || 1) - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
}
function mean(arr: number[]) {
  const n = arr.length;
  if (!n) return 0;
  return arr.reduce((s, x) => s + x, 0) / n;
}
function stdev(arr: number[]) {
  const n = arr.length;
  if (n < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) * (x - m), 0) / (n - 1);
  return Math.sqrt(v);
}
function median(arr: number[]) {
  const a = arr.slice().sort((x, y) => x - y);
  const n = a.length;
  if (!n) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
function quantile(arr: number[], q: number) {
  const a = arr.slice().sort((x, y) => x - y);
  const n = a.length;
  if (!n) return 0;
  const pos = (n - 1) * clamp(q, 0, 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return a[lo];
  const t = pos - lo;
  return a[lo] * (1 - t) + a[hi] * t;
}
function bonusRateForTarget(target: number) {
  const t = Math.max(0, target);
  for (const tier of BONUS_TIERS) {
    if (t <= tier.upTo) return tier.rate;
  }
  return BONUS_TIERS[BONUS_TIERS.length - 1]?.rate ?? 0.013;
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

  /* показываем актуальные значения конфигурации */
  const [cfgLocal, setCfgLocal] = useState<typeof cfg | null>(null);

  // 1) сначала — то, что дал хук
  useEffect(() => {
    setCfgLocal(cfg ?? null);
  }, [cfg]);

  // 2) затем — дополнительный "probe" из payroll_config: select('*') автоматически подтянет новые поля после миграции
  useEffect(() => {
    let cancelled = false;

    async function probePayrollConfig() {
      try {
        const { start: monthStart } = getMonthRange(month);

        const { data: row, error } = await sb
          .from("payroll_config")
          .select("*")
          .eq("month", monthStart)
          .maybeSingle();

        if (error) throw error;

        if (!cancelled && row) {
          setCfgLocal((prev) => {
            const p: any = prev ?? {};
            const r: any = row ?? {};
            return { ...p, ...r } as any;
          });
        }
      } catch (e) {
        console.warn("probe payroll_config failed:", e);
      }
    }

    probePayrollConfig();

    return () => {
      cancelled = true;
    };
  }, [month]);

  /* ===== Переход на месячную премию СТРОГО с 2026-02 ===== */
  const SWITCH_MONTH = "2026-02";
  const isMonthlyPlanMode = useMemo(() => month >= SWITCH_MONTH, [month]);

  const hasMonthlyCfgFields = useMemo(() => {
    const c: any = cfgLocal ?? null;
    if (!c) return false;
    return (
      Object.prototype.hasOwnProperty.call(c, "monthly_turnover_target") ||
      Object.prototype.hasOwnProperty.call(c, "monthly_bonus_each")
    );
  }, [cfgLocal]);

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

  /* Итоги «к выплате»: по месяцу e.net (уже с месячными корректировками), по неделе — сумма net_day (без месячных корректировок) */
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
  }, [visibleEmployees, employees]);

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
    netPeriod: number; // как в списке (неделя/месяц)
    netMonth: number; // всегда месячный итог (как в списке при "весь месяц")
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

  // корректировки месяца применяются к итогу МЕСЯЦА; если выбранная неделя — не добавляем их к итогу за неделю
  const adjForThisView = useMemo(
    () => (activeWeek ? 0 : dailyAdj),
    [activeWeek, dailyAdj]
  );
  const dailyNetWithAdj = useMemo(
    () => dailyNetSum + adjForThisView,
    [dailyNetSum, adjForThisView]
  );

  async function openDaily(e: {
    id: number;
    fullName: string;
    branchId: number;
    netPeriod: number;
    netMonth: number;
  }) {
    setDailyMeta({
      id: e.id,
      name: e.fullName,
      branchId: e.branchId,
      netPeriod: e.netPeriod,
      netMonth: e.netMonth,
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

      // корректировки за МЕСЯЦ (включая месячную премию с 2026-02)
      const { data: adjRow, error: errAdj } = await sb
        .from("v_payroll_adjustments_monthly_with_plan")
        .select("adjustments_sum")
        .eq("employee_id", e.id)
        .eq("branch_id", e.branchId)
        .eq("month", monthStart)
        .maybeSingle();

      if (errAdj) throw errAdj;

      const adj =
        adjRow && (adjRow as any).adjustments_sum != null
          ? Number((adjRow as any).adjustments_sum)
          : 0;

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

  // модалка: показывать футер даже если дней нет, но есть корректировки
  const hasDailyRows = (dailyRows?.length ?? 0) > 0;
  const hasAdj = Math.round(dailyAdj) !== 0;
  const showDailyFooter = dailyRows !== null && (hasDailyRows || hasAdj);

  /* ===== Планы по филиалам (месяц >= 2026-02) ===== */
  type BranchPlan = {
    monthly_turnover_target: number;
    monthly_bonus_each: number;
    mode?: string;
    auto_params?: any;
    updated_at?: string;
  };

  const [branchPlans, setBranchPlans] = useState<Map<number, BranchPlan>>(new Map());
  const [prevTurnoverMap, setPrevTurnoverMap] = useState<Map<number, number>>(new Map());
  const [histTurnoverByBranch, setHistTurnoverByBranch] = useState<Map<number, number[]>>(
    new Map()
  );
  const [histMonthsKeys, setHistMonthsKeys] = useState<string[]>([]);
  const [histLoaded, setHistLoaded] = useState(false);
  const [planBusyBranchId, setPlanBusyBranchId] = useState<number | null>(null);

  const monthStart = useMemo(() => getMonthRange(month).start, [month]);

  async function selectBranchPlansWithFallback(monthStartDate: string) {
    const monthCols = ["month", "plan_month", "month_start"];
    for (const col of monthCols) {
      const { data, error } = await sb
        .from(BRANCH_PLAN_TABLE)
        .select("*")
        // @ts-ignore
        .eq(col, monthStartDate);

      if (!error) return { data: data ?? [], monthCol: col };
      if (String((error as any)?.code) === "42703") continue;
      // другие ошибки — выходим сразу
      throw error;
    }
    return { data: [], monthCol: "month" };
  }

  async function upsertBranchPlanWithFallback(payloadBase: any) {
    const monthCols = ["month", "plan_month", "month_start"];
    const conflictCols = ["branch_id,month", "branch_id,plan_month", "branch_id,month_start"];

    for (let i = 0; i < monthCols.length; i++) {
      const monthCol = monthCols[i];
      const onConflict = conflictCols[i];

      const payload = { ...payloadBase };
      if (monthCol !== "month") {
        payload[monthCol] = payload.month;
        delete payload.month;
      }

      const { error } = await sb
        .from(BRANCH_PLAN_TABLE)
        .upsert(payload, { onConflict });

      if (!error) return;
      if (String((error as any)?.code) === "42703") continue;
      throw error;
    }
  }

  // “умная” формула плана и премии (не сохраняет — только предлагает)
  function suggestPlan(branchId: number) {
    const fallbackTarget = Number((cfgLocal as any)?.monthly_turnover_target ?? 0);
    const fallbackBonus = Number((cfgLocal as any)?.monthly_bonus_each ?? 0);

    const hist = histTurnoverByBranch.get(branchId) ?? [];
    const prev = hist.length ? hist[hist.length - 1] : 0;

    // если данных нет — показываем fallback
    const histPos = hist.filter((x) => x > 0);
    if (prev <= 0 || histPos.length < 1) {
      return {
        target: Math.max(0, Math.trunc(fallbackTarget)),
        bonus: Math.max(0, Math.trunc(fallbackBonus)),
        debug: { usedFallback: true, prev, hist },
      };
    }

    const med = median(histPos);
    const q70 = quantile(histPos, AUTO_PLAN.quantile);
    const typical = Math.max(med, q70);

    // тренд: сравним prev с средним 1–2 месяцев перед ним (если есть)
    const prev2 = histPos.length >= 3 ? histPos.slice(-3, -1) : histPos.slice(-2, -1);
    const prevAvg = prev2.length ? mean(prev2) : typical || prev;

    let trendPct = prevAvg > 0 ? (prev - prevAvg) / prevAvg : 0;
    trendPct = clamp(trendPct, AUTO_PLAN.trendClampMin, AUTO_PLAN.trendClampMax);

    const vol =
      mean(histPos) > 0 ? stdev(histPos) / Math.max(1, mean(histPos)) : 0;
    const volClamped = clamp(vol, 0, 1);

    let gMin = clamp(
      AUTO_PLAN.gMinBase + trendPct * AUTO_PLAN.trendWeightMin,
      AUTO_PLAN.gMinFloor,
      AUTO_PLAN.gMinCeil
    );
    let gMax = clamp(
      AUTO_PLAN.gMaxBase + trendPct * AUTO_PLAN.trendWeightMax,
      AUTO_PLAN.gMaxFloor,
      AUTO_PLAN.gMaxCeil
    );

    // волатильность: если сильно скачет — режем gMax (и чуть gMin)
    if (volClamped > AUTO_PLAN.volatilitySoftCap) {
      const denom = Math.max(
        1e-9,
        AUTO_PLAN.volatilityHardCap - AUTO_PLAN.volatilitySoftCap
      );
      const k = clamp(
        1 - (volClamped - AUTO_PLAN.volatilitySoftCap) / denom,
        0.6,
        1
      );
      gMax = gMax * k;
      gMin = gMin * clamp(k + 0.1, 0.75, 1);
    }
    gMin = clamp(gMin, AUTO_PLAN.gMinFloor, AUTO_PLAN.gMinCeil);
    gMax = clamp(gMax, Math.max(gMin, AUTO_PLAN.gMaxFloor), AUTO_PLAN.gMaxCeil);

    // якорь: если prev сильно ниже typical — тянем ближе к typical (защита от сезонных/разовых провалов)
    let anchor = prev;
    if (typical > 0) {
      if (prev <= typical * 0.8) {
        anchor = AUTO_PLAN.anchorTypicalWeightLow * typical + (1 - AUTO_PLAN.anchorTypicalWeightLow) * prev;
      } else if (prev < typical) {
        anchor = AUTO_PLAN.anchorTypicalWeightMid * typical + (1 - AUTO_PLAN.anchorTypicalWeightMid) * prev;
      } else {
        anchor = prev;
      }
    }

    // целевой порог: anchor + рост, но с рамками относительно max(prev, typical)
    const targetRaw = anchor * (1 + gMin);
    const upperRef = Math.max(prev, typical);
    let capUpper = upperRef * (1 + gMax);

    // нижняя граница: не ниже prev*(1+gMin) и не сильно ниже “типичного”
    let capLower = Math.max(prev * (1 + gMin), typical * (1 + gMin * AUTO_PLAN.typicalFloorFactor));
    if (capLower > capUpper) capUpper = capLower;

    const targetCapped = clamp(targetRaw, capLower, capUpper);

    // округление порога: ВВЕРХ до 1000
    const target = Math.max(0, Math.trunc(roundUpTo(targetCapped, AUTO_PLAN.roundStep)));

    // премия: % зависит от порога (ускорение) + границы по min/maxRate
    const rateTier = bonusRateForTarget(target);
    const bonusRaw = target * rateTier;
    const bonusMin = Math.max(AUTO_PLAN.bonusMinAbs, target * AUTO_PLAN.bonusMinRate);
    const bonusMax = target * AUTO_PLAN.bonusMaxRate;
    const bonus = Math.max(
      0,
      Math.trunc(roundTo(clamp(bonusRaw, bonusMin, bonusMax), AUTO_PLAN.bonusStep))
    );

    return {
      target,
      bonus,
      debug: {
        version: AUTO_PLAN.version,
        hist_months: histMonthsKeys,
        hist_turnover: hist,
        prev,
        typical,
        med,
        q70,
        prevAvg,
        trendPct,
        volatility: volClamped,
        gMin,
        gMax,
        anchor,
        targetRaw,
        capLower,
        capUpper,
        targetCapped,
        rateTier,
        bonusRaw,
        bonusMin,
        bonusMax,
      },
    };
  }

  const suggestedByBranch = useMemo(() => {
    const m = new Map<number, { target: number; bonus: number; debug: any }>();
    if (!isMonthlyPlanMode || !histLoaded) return m;
    for (const b of branches) {
      const s = suggestPlan(b.id);
      m.set(b.id, s);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMonthlyPlanMode, histLoaded, branches, histTurnoverByBranch, cfgLocal, month]);

  function getBranchPlanEffective(branchId: number): BranchPlan {
    const bp = branchPlans.get(branchId);
    const fallbackTarget = Number((cfgLocal as any)?.monthly_turnover_target ?? 0);
    const fallbackBonus = Number((cfgLocal as any)?.monthly_bonus_each ?? 0);

    if (bp) {
      return {
        monthly_turnover_target: bp.monthly_turnover_target ?? fallbackTarget,
        monthly_bonus_each: bp.monthly_bonus_each ?? fallbackBonus,
        mode: bp.mode ?? "manual",
        auto_params: bp.auto_params ?? null,
        updated_at: bp.updated_at,
      };
    }

    // если план не задан — показываем “умную рекомендацию” (не сохраняем)
    const s = suggestedByBranch.get(branchId);
    if (s && s.target > 0) {
      return {
        monthly_turnover_target: s.target,
        monthly_bonus_each: s.bonus,
        mode: "suggested",
        auto_params: s.debug ?? null,
        updated_at: undefined,
      };
    }

    return {
      monthly_turnover_target: Math.max(0, Math.trunc(fallbackTarget)),
      monthly_bonus_each: Math.max(0, Math.trunc(fallbackBonus)),
      mode: "fallback",
      auto_params: null,
      updated_at: undefined,
    };
  }

  // загрузка планов по филиалам за выбранный месяц + история выручек (-6..-1) по филиалам
  useEffect(() => {
    if (!isMonthlyPlanMode) {
      setBranchPlans(new Map());
      setPrevTurnoverMap(new Map());
      setHistTurnoverByBranch(new Map());
      setHistMonthsKeys([]);
      setHistLoaded(false);
      return;
    }
    if (!monthStart) return;

    let cancelled = false;

    async function loadPlansAndHistory() {
      try {
        // 0) ключи месяцев истории
        const keys: string[] = [];
        for (let i = AUTO_PLAN.historyMonths; i >= 1; i--) {
          keys.push(shiftMonthKey(month, -i));
        }

        // 1) планы
        const { data: planRows } = await selectBranchPlansWithFallback(monthStart);

        const planMap = new Map<number, BranchPlan>();
        for (const r of (planRows ?? []) as any[]) {
          const branchId = Number(r.branch_id ?? r.branchId ?? 0);
          if (!branchId) continue;
          planMap.set(branchId, {
            monthly_turnover_target: Number(
              r.monthly_turnover_target ?? r.turnover_target ?? r.target ?? 0
            ),
            monthly_bonus_each: Number(
              r.monthly_bonus_each ?? r.bonus_each ?? r.bonus ?? 0
            ),
            mode: r.mode ?? "manual",
            auto_params: r.auto_params ?? null,
            updated_at: r.updated_at ?? null,
          });
        }

        // 2) история выручки: суммируем turnover из v_payroll_daily_fixed за диапазон (-H..-1)
        const histStart = shiftMonthStart(monthStart, -AUTO_PLAN.historyMonths);
        const histEnd = monthStart;

        const { data: days, error: errDays } = await sb
          .from("v_payroll_daily_fixed")
          .select("branch_id,day,turnover")
          .gte("day", histStart)
          .lt("day", histEnd);

        if (errDays) throw errDays;

        // суммируем по (branch, YYYY-MM)
        const sumByBranchMonth = new Map<string, number>();
        const branchIdsSeen = new Set<number>();

        for (const r of (days ?? []) as any[]) {
          const bid = Number(r.branch_id ?? 0);
          if (!bid) continue;
          branchIdsSeen.add(bid);
          const dayStr = String(r.day ?? "");
          const mk = dayStr.length >= 7 ? dayStr.slice(0, 7) : "";
          if (!mk) continue;
          const t = r.turnover == null ? 0 : Number(r.turnover);
          const k = `${bid}:${mk}`;
          sumByBranchMonth.set(k, (sumByBranchMonth.get(k) ?? 0) + t);
        }

        const histMap = new Map<number, number[]>();
        const prevMap = new Map<number, number>();

        const branchIds = branches.length
          ? branches.map((b) => b.id)
          : Array.from(branchIdsSeen);

        for (const bid of branchIds) {
          const arr = keys.map((k) => sumByBranchMonth.get(`${bid}:${k}`) ?? 0);
          histMap.set(bid, arr);
          prevMap.set(bid, arr.length ? arr[arr.length - 1] : 0);
        }

        if (!cancelled) {
          setBranchPlans(planMap);
          setHistMonthsKeys(keys);
          setHistTurnoverByBranch(histMap);
          setPrevTurnoverMap(prevMap);
          setHistLoaded(true);
        }
      } catch (e: any) {
        console.error("loadPlansAndHistory error", e);
        if (!cancelled) {
          setBranchPlans(new Map());
          setPrevTurnoverMap(new Map());
          setHistTurnoverByBranch(new Map());
          setHistMonthsKeys([]);
          setHistLoaded(false);
        }
      }
    }

    loadPlansAndHistory();

    return () => {
      cancelled = true;
    };
  }, [isMonthlyPlanMode, monthStart, month, branches]);

  async function saveBranchPlan(branchId: number, patch: Partial<BranchPlan>) {
    const current = getBranchPlanEffective(branchId);

    const next: BranchPlan = {
      ...current,
      ...patch,
    };

    // локально
    setBranchPlans((m) => {
      const nm = new Map(m);
      nm.set(branchId, next);
      return nm;
    });

    const payloadBase: any = {
      branch_id: branchId,
      month: monthStart,
      monthly_turnover_target: Math.max(0, Math.trunc(next.monthly_turnover_target ?? 0)),
      monthly_bonus_each: Math.max(0, Math.trunc(next.monthly_bonus_each ?? 0)),
      mode: next.mode ?? "manual",
      auto_params: next.auto_params ?? {},
      updated_at: new Date().toISOString(),
    };

    await upsertBranchPlanWithFallback(payloadBase);
  }

  async function applyAutoPlan(branchId: number) {
    setPlanBusyBranchId(branchId);
    try {
      const s = suggestPlan(branchId);

      await saveBranchPlan(branchId, {
        monthly_turnover_target: s.target,
        monthly_bonus_each: s.bonus,
        mode: "auto",
        auto_params: {
          ...s.debug,
          applied_at: new Date().toISOString(),
        },
      });
      await mutate();
    } catch (e: any) {
      alert(`Не удалось применить авто-план: ${extractErrMsg(e)}`);
    } finally {
      setPlanBusyBranchId(null);
    }
  }

  const periodLabel2 = activeWeek ? activeWeek.label : formatMonthRu(month);

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
                    <span className="font-medium text-sky-50">{periodLabel2}</span>
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
                  setCfgLocal((c) => (c ? ({ ...c, income_tax_monthly: vv } as any) : c));
                  await updateConfig({ income_tax_monthly: vv } as any);
                  await mutate();
                }}
                suffix="сом"
              />

              <div className="text-slate-700">Соцфонд (мес.)</div>
              <NumberCell
                value={cfgLocal?.social_fund_monthly ?? 0}
                onCommit={async (v) => {
                  const vv = Math.max(0, Math.trunc(v));
                  setCfgLocal((c) => (c ? ({ ...c, social_fund_monthly: vv } as any) : c));
                  await updateConfig({ social_fund_monthly: vv } as any);
                  await mutate();
                }}
                suffix="сом"
              />

              <div className="text-slate-700">
                {isMonthlyPlanMode ? "Порог выручки/месяц (глобальный fallback)" : "Порог выручки/день"}
              </div>
              <NumberCell
                value={
                  isMonthlyPlanMode
                    ? ((cfgLocal as any)?.monthly_turnover_target ?? 0)
                    : (cfgLocal?.daily_turnover_target ?? 0)
                }
                readOnly={isMonthlyPlanMode && !hasMonthlyCfgFields}
                onCommit={async (v) => {
                  const vv = Math.max(0, Math.trunc(v));

                  if (isMonthlyPlanMode) {
                    setCfgLocal((c) =>
                      c ? ({ ...(c as any), monthly_turnover_target: vv } as any) : c
                    );
                    await updateConfig({ monthly_turnover_target: vv } as any);
                  } else {
                    setCfgLocal((c) => (c ? ({ ...c, daily_turnover_target: vv } as any) : c));
                    await updateConfig({ daily_turnover_target: vv } as any);
                  }

                  await mutate();
                }}
                suffix="сом"
              />

              <div className="text-slate-700">
                {isMonthlyPlanMode ? "Премия за месяц (глобальный fallback)" : "Премия за день"}
              </div>
              <NumberCell
                value={
                  isMonthlyPlanMode
                    ? ((cfgLocal as any)?.monthly_bonus_each ?? 0)
                    : (cfgLocal?.daily_bonus_each ?? 0)
                }
                readOnly={isMonthlyPlanMode && !hasMonthlyCfgFields}
                onCommit={async (v) => {
                  const vv = Math.max(0, Math.trunc(v));

                  if (isMonthlyPlanMode) {
                    setCfgLocal((c) =>
                      c ? ({ ...(c as any), monthly_bonus_each: vv } as any) : c
                    );
                    await updateConfig({ monthly_bonus_each: vv } as any);
                  } else {
                    setCfgLocal((c) => (c ? ({ ...c, daily_bonus_each: vv } as any) : c));
                    await updateConfig({ daily_bonus_each: vv } as any);
                  }

                  await mutate();
                }}
                suffix="сом"
              />

              {isMonthlyPlanMode && !hasMonthlyCfgFields ? (
                <div className="col-span-2 -mt-1 text-[11px] text-amber-700">
                  Поля «месячного плана» появятся после миграции БД
                  (payroll_config.monthly_*). Сейчас режим только чтение.
                </div>
              ) : null}
            </div>

            <p className="mt-3 text-xs text-slate-500">
              {!isMonthlyPlanMode
                ? "До 2026-02 действует дневной план (порог/премия за день)."
                : "С 2026-02 план — месячный. В этой странице можно задать план по каждому филиалу (таблица payroll_branch_plans)."}
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
            const effectivePlan = isMonthlyPlanMode ? getBranchPlanEffective(b.id) : null;

            const histArr = histTurnoverByBranch.get(b.id) ?? [];
            const prevTurnover = histArr.length ? histArr[histArr.length - 1] : (prevTurnoverMap.get(b.id) ?? 0);
            const med6 = histArr.filter((x) => x > 0).length ? Math.trunc(median(histArr.filter((x) => x > 0))) : 0;

            const canAuto = isMonthlyPlanMode && histLoaded && prevTurnover > 0;

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

                {/* План месяца по филиалу */}
                {isMonthlyPlanMode ? (
                  <div className="mb-4 rounded-3xl bg-white/90 ring-1 ring-sky-200/80 p-4 shadow-[0_18px_55px_rgba(15,23,42,0.16)]">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-slate-800">
                          План месяца (филиал)
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          Прошлый месяц:{" "}
                          <span className="font-semibold text-teal-700 tabular-nums">
                            {fmt(prevTurnover)} сом
                          </span>
                          {med6 > 0 ? (
                            <span className="ml-2 text-[10px] text-slate-400">
                              • медиана(6м): {fmt(med6)}
                            </span>
                          ) : null}
                          {effectivePlan?.mode ? (
                            <span className="ml-2 text-[10px] text-slate-400">
                              • mode: {effectivePlan.mode}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {planBusyBranchId === b.id ? (
                          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-400" />
                        ) : null}

                        <GhostBtn
                          disabled={!canAuto || planBusyBranchId === b.id}
                          onClick={() => applyAutoPlan(b.id)}
                          title="Рассчитать и сохранить порог + премию по умной формуле (история 6 мес, тренд, округление до 1000)"
                        >
                          Авто
                        </GhostBtn>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                          Порог выручки / месяц
                        </div>
                        <NumberCell
                          value={effectivePlan?.monthly_turnover_target ?? 0}
                          onCommit={async (v) => {
                            try {
                              await saveBranchPlan(b.id, {
                                monthly_turnover_target: Math.max(0, Math.trunc(v)),
                                mode: "manual",
                              });
                              await mutate();
                            } catch (e: any) {
                              alert(`Не удалось сохранить план: ${extractErrMsg(e)}`);
                            }
                          }}
                          suffix="сом"
                        />
                      </div>

                      <div>
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                          Премия / месяц
                        </div>
                        <NumberCell
                          value={effectivePlan?.monthly_bonus_each ?? 0}
                          onCommit={async (v) => {
                            try {
                              await saveBranchPlan(b.id, {
                                monthly_bonus_each: Math.max(0, Math.trunc(v)),
                                mode: "manual",
                              });
                              await mutate();
                            } catch (e: any) {
                              alert(`Не удалось сохранить план: ${extractErrMsg(e)}`);
                            }
                          }}
                          suffix="сом"
                        />
                      </div>
                    </div>

                    <div className="mt-2 text-[11px] text-slate-500">
                      Формула (v2): история {AUTO_PLAN.historyMonths} мес → typical (median/q{Math.round(AUTO_PLAN.quantile * 100)}), тренд, защита от просадок, порог округление ↑ до 1 000; премия = target × % (ступени {Math.round(BONUS_TIERS[0].rate * 1000) / 10}%…{Math.round(BONUS_TIERS[BONUS_TIERS.length - 1].rate * 1000) / 10}%), округление до 1 000.
                    </div>
                  </div>
                ) : null}

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
                        const netPeriod = getNet(e);
                        const netMonth = e.net ?? 0;

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

                            <td
                              className={cx(
                                rowTdBase,
                                "text-right font-semibold text-teal-700 tabular-nums"
                              )}
                            >
                              {fmt(netPeriod)}
                            </td>

                            <td className={cx(rowTdLast, "text-right")}>
                              <div className="flex justify-end gap-2">
                                <GhostBtn
                                  onClick={() =>
                                    openDaily({
                                      id: e.id,
                                      fullName: e.fullName,
                                      branchId: b.id,
                                      netPeriod,
                                      netMonth,
                                    })
                                  }
                                  title="Показать детализацию по дням за период"
                                >
                                  Детали
                                </GhostBtn>

                                <DangerBtn
                                  onClick={async () => {
                                    if (!confirm(`Удалить сотрудника «${e.fullName}»?`))
                                      return;
                                    try {
                                      await removeEmployee(e.id);
                                      await mutate();
                                    } catch (err: any) {
                                      alert(
                                        `Не удалось удалить: ${
                                          err?.message ||
                                          err?.error_description ||
                                          String(err)
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
            tabIndex={-1}
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
                {dailyRows === null ? (
                  <div className="py-10 text-center text-sm text-slate-600">
                    Загрузка…
                  </div>
                ) : !hasDailyRows ? (
                  <div className="py-10 text-center text-sm text-slate-600">
                    Данных по дням за выбранный период нет.
                    {hasAdj ? (
                      <div className="mt-2 text-xs text-slate-500">
                        Есть корректировки месяца (включая месячную премию с 2026-02).
                      </div>
                    ) : null}
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
                        <th className="text-right px-2">Премия (день)</th>
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

              {showDailyFooter ? (
                <div className="border-t border-sky-200 px-4 py-3 text-right text-sm space-y-1 bg-gradient-to-r from-sky-50 via-white to-sky-50/80">
                  <div>
                    <span className="text-slate-600">
                      {activeWeek
                        ? "Итого по дням за неделю: "
                        : "Итого по дням (без корректировок): "}
                    </span>
                    <span className="font-semibold text-teal-700 tabular-nums">
                      {fmt(dailyNetSum)} сом
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-600">
                      Корректировки месяца (включая премию за месяц):{" "}
                    </span>
                    <span className="font-semibold text-teal-700 tabular-nums">
                      {fmt(dailyAdj)} сом
                    </span>
                    {activeWeek ? (
                      <span className="ml-2 text-xs text-slate-500">
                        (не добавляются к итогу недели)
                      </span>
                    ) : null}
                  </div>

                  <div>
                    <span className="text-slate-600">
                      {activeWeek
                        ? "К выплате за неделю (как в списке): "
                        : "Итого за месяц (как в списке): "}
                    </span>
                    <span className="font-semibold text-teal-700 tabular-nums">
                      {fmt(dailyMeta.netPeriod)} сом
                    </span>
                    {activeWeek ? (
                      <span className="ml-2 text-xs text-slate-500">
                        • За месяц: {fmt(dailyMeta.netMonth)} сом
                      </span>
                    ) : null}
                  </div>

                  {!activeWeek ? (
                    <div>
                      <span className="text-slate-600">
                        Итого по дням + корректировки (для сверки):{" "}
                      </span>
                      <span className="font-semibold text-teal-700 tabular-nums">
                        {fmt(dailyNetWithAdj)} сом
                      </span>
                    </div>
                  ) : null}

                  {isMonthlyPlanMode ? (
                    <div className="pt-1 text-xs text-slate-500">
                      С 2026-02 месячная премия приходит через «корректировки месяца», дневная премия по дням = 0.
                    </div>
                  ) : null}
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
