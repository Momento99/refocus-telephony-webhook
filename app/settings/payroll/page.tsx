"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  usePayrollMonthly,
  dbRoleToUi,
  uiRoleToDb,
  type RoleT,
} from "./usePayrollMonthly";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Wallet, Building2, KeyRound, User2, Plus, X, BarChart2 } from "lucide-react";
import PenaltiesTab from "./PenaltiesTab";

/* ---------- Supabase клиент (для модалки + профили) ---------- */
const sb: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
  { auth: { persistSession: false } }
);

/* ---------- типы для PIN + логинов ---------- */
type BranchPinMap = Record<number, string>;

type CredRow = {
  cred_id: number;
  employee_id: number;
  full_name: string;
  branch_id: number | null;
  login: string | null;
  is_active: boolean;
  pin_plain: string | null;
};

/* ---------- утилы ---------- */
function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
function fmt(n?: number) {
  return Math.round(n ?? 0).toLocaleString("ru-RU");
}
function fmtHM(hours?: number) {
  const totalMin = Math.max(0, Math.round((hours ?? 0) * 60));
  const h = Math.trunc(totalMin / 60);
  const m = totalMin % 60;
  return `${h} ч ${m} мин`;
}
function num(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
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

function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

type WeekRange = {
  key: string;
  label: string;
  start: string; // включительно
  endExclusive: string; // НЕ включительно
};

/** Недели месяца как сегменты внутри месяца */
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

/** Возвращает ключ недели, содержащей сегодняшний день, или "__full__" */
function getCurrentWeekKey(month: string): string {
  const today = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const todayYMD = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
  const weeks = getWeeksForMonth(month);
  const found = weeks.find((w) => w.start <= todayYMD && todayYMD < w.endExclusive);
  return found?.key ?? "__full__";
}

/* ---------- общий стиль контролов ---------- */
const inputCls = cx(
  "h-9 w-full rounded-2xl bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400",
  "ring-1 ring-sky-200 shadow-sm",
  "focus:outline-none focus:ring-2 focus:ring-cyan-400/70"
);
const selectCls = cx(
  "h-9 rounded-2xl bg-white px-2 text-sm text-slate-900",
  "ring-1 ring-sky-200 shadow-sm",
  "focus:outline-none focus:ring-2 focus:ring-cyan-400/70"
);

/* ---------- типы канонических RPC ---------- */
type PeriodCanonicalRow = {
  employee_id: number;
  full_name: string;
  branch_id: number;
  days_count: number;
  total_hours: number;
  total_hour_pay: number;
  total_paid_sum: number;
  total_bonus: number;
  total_penalties: number;
  total_social_fund: number;
  total_income_tax: number;
  net_total: number;
};

type DailyCanonicalRow = {
  employee_id: number;
  full_name: string;
  branch_id: number;
  day: string;
  hours: number;
  hourly_rate: number;
  hour_pay: number;
  paid_sum: number;
  bonus_percent: number;
  bonus: number;
  penalties: number;
  social_fund_day: number;
  income_tax_day: number;
  net_day: number;
};

function rowsToNetMap(rows: PeriodCanonicalRow[] | null | undefined) {
  const m = new Map<string, number>();
  for (const r of rows ?? []) {
    const key = `${Number(r.employee_id)}:${Number(r.branch_id)}`;
    m.set(key, num(r.net_total));
  }
  return m;
}

function rowsToAdjMap(rows: any[] | null | undefined) {
  const m = new Map<string, number>();
  for (const r of rows ?? []) {
    const key = `${Number(r.employee_id)}:${Number(r.branch_id)}`;
    m.set(key, num(r.adjustments_sum));
  }
  return m;
}

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
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200",
        v ? "bg-gradient-to-r from-teal-400 to-sky-400" : "bg-slate-300"
      )}
      aria-pressed={v}
      title={v ? "Бонусы включены" : "Бонусы выключены"}
    >
      {busy ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/50 border-t-white" />
        </span>
      ) : (
        <span
          className={cx(
            "h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200",
            v ? "translate-x-[17px]" : "translate-x-[1px]"
          )}
        />
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
        "bg-gradient-to-br from-white via-slate-50 to-sky-50/85",
        "ring-1 ring-sky-200/80 backdrop-blur-xl",
        "shadow-[0_22px_70px_rgba(15,23,42,0.60)] text-slate-900"
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

const AUTO_PLAN = {
  version: "monthly-plan-v2",
  historyMonths: 6,
  quantile: 0.7,
  gMinBase: 0.06,
  gMaxBase: 0.18,
  gMinFloor: 0.03,
  gMinCeil: 0.1,
  gMaxFloor: 0.1,
  gMaxCeil: 0.25,
  trendWeightMin: 0.25,
  trendWeightMax: 0.35,
  trendClampMin: -0.15,
  trendClampMax: 0.2,
  anchorTypicalWeightLow: 0.7,
  anchorTypicalWeightMid: 0.55,
  typicalFloorFactor: 0.25,
  volatilitySoftCap: 0.25,
  volatilityHardCap: 0.5,
  roundStep: 1000,
  bonusStep: 1000,
  bonusMinAbs: 2000,
  bonusMinRate: 0.008,
  bonusMaxRate: 0.02,
};

const BONUS_TIERS: Array<{ upTo: number; rate: number }> = [
  { upTo: 300_000, rate: 0.012 },
  { upTo: 600_000, rate: 0.0125 },
  { upTo: 1_000_000, rate: 0.013 },
  { upTo: 2_000_000, rate: 0.0135 },
  { upTo: 3_000_000, rate: 0.014 },
  { upTo: 5_000_000, rate: 0.0145 },
  { upTo: Infinity, rate: 0.015 },
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
  const [tab, setTab] = useState<"payroll" | "penalties">("payroll");

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

  // выбор недели — по умолчанию текущая неделя
  const [weekKey, setWeekKey] = useState<string>(() => {
    const d = new Date();
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return getCurrentWeekKey(m);
  });
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

  /* показываем актуальные значения конфигурации (только payroll_config id=1) */
  const [cfgLocal, setCfgLocal] = useState<typeof cfg | null>(null);
  useEffect(() => {
    setCfgLocal(cfg ?? null);
  }, [cfg]);

  /* ===== Переход на месячную премию СТРОГО с 2026-02 ===== */
  const SWITCH_MONTH = "2026-02";
  const isMonthlyPlanMode = useMemo(() => month >= SWITCH_MONTH, [month]);

  const monthStart = useMemo(() => getMonthRange(month).start, [month]);
  const monthEndExcl = useMemo(() => getMonthRange(month).end, [month]);
  const monthEndInclusive = useMemo(() => shiftYmd(monthEndExcl, -1), [monthEndExcl]);

  /* Показываем только активных */
  const visibleEmployees = useMemo(
    () => employees.filter(isEmpActive),
    [employees]
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

  /* ===== PIN'ы филиалов + логины сотрудников ===== */
  const [branchPins, setBranchPins] = useState<BranchPinMap>({});
  const [pinInputs, setPinInputs] = useState<BranchPinMap>({});
  const [creds, setCreds] = useState<CredRow[]>([]);
  const [pinBusy, setPinBusy] = useState<number | null>(null);
  // которые строки с кредами раскрыты (employee_id)
  const [openCredEmpId, setOpenCredEmpId] = useState<number | null>(null);
  // форма создания логина: per-employee
  const [credForm, setCredForm] = useState<Record<number, { login: string; pin: string }>>({});

  function genPin4() {
    let s = "";
    for (let i = 0; i < 4; i++) s += Math.floor(Math.random() * 10);
    return s;
  }

  useEffect(() => {
    void loadBranchPins();
    void loadCreds();
  }, []);

  async function loadBranchPins() {
    const { data, error } = await sb.from("branches").select("id,pos_pin").order("id");
    if (error) return;
    const map: BranchPinMap = {};
    const inputs: BranchPinMap = {};
    for (const r of data ?? []) {
      map[r.id] = (r.pos_pin ?? "").toString();
      inputs[r.id] = (r.pos_pin ?? "").toString();
    }
    setBranchPins(map);
    setPinInputs(inputs);
  }

  async function loadCreds() {
    const { data, error } = await sb
      .from("v_employee_credentials_admin")
      .select("cred_id,employee_id,full_name,branch_id,login,is_active,pin_plain")
      .order("employee_id");
    if (!error) setCreds((data ?? []) as CredRow[]);
  }

  async function saveBranchPin(branchId: number) {
    const val = (pinInputs[branchId] ?? "").trim();
    if (!/^\d{4,8}$/.test(val)) {
      alert("PIN должен быть 4–8 цифр");
      return;
    }
    setPinBusy(branchId);
    const { error } = await sb.from("branches").update({ pos_pin: val }).eq("id", branchId);
    setPinBusy(null);
    if (error) { alert(error.message); return; }
    setBranchPins((p) => ({ ...p, [branchId]: val }));
  }

  async function clearBranchPin(branchId: number) {
    if (!confirm("Очистить PIN этого филиала?")) return;
    setPinBusy(branchId);
    const { error } = await sb.from("branches").update({ pos_pin: null }).eq("id", branchId);
    setPinBusy(null);
    if (error) { alert(error.message); return; }
    setBranchPins((p) => ({ ...p, [branchId]: "" }));
    setPinInputs((p) => ({ ...p, [branchId]: "" }));
  }

  async function createEmpCred(employeeId: number) {
    const form = credForm[employeeId] ?? { login: "", pin: "" };
    const l = form.login.trim().toLowerCase();
    if (l.length < 2 || l.length > 40) { alert("Логин 2–40 символов"); return; }
    const p = form.pin.trim();
    if (!/^\d{4}$/.test(p)) { alert("PIN строго 4 цифры"); return; }

    const res = await sb.rpc("app_set_employee_login_pin", {
      p_employee_id: employeeId,
      p_login: l,
      p_pin: p,
    });
    if (res.error) { alert(res.error.message); return; }
    const r = Array.isArray(res.data) ? res.data[0] : res.data;
    if (r?.error) {
      const map: Record<string, string> = { employee_not_found: "Сотрудник не найден", login_taken: "Такой логин занят" };
      alert(map[r.error] ?? r.error);
      return;
    }
    setCredForm((f) => ({ ...f, [employeeId]: { login: "", pin: "" } }));
    await loadCreds();
  }

  async function removeEmpCred(row: CredRow) {
    if (!confirm(`Удалить логин и PIN для «${row.full_name}»?`)) return;
    const now = new Date().toISOString();
    const { error: e1 } = await sb.from("employees").update({ login: null, pin_hash: null, updated_at: now } as any).eq("id", row.employee_id);
    if (e1) { alert(e1.message); return; }
    const { error: e2 } = await sb.from("employee_credentials").update({ login: null, pin_plain: null, pin_sha256: null, is_active: false, updated_at: now } as any).eq("id", row.cred_id);
    if (e2) { alert(e2.message); return; }
    await loadCreds();
  }

  /* ===== Канонические карты по периоду ===== */
  const [weekPeriodMap, setWeekPeriodMap] = useState<Map<string, number> | null>(null);
  const [weekLoading, setWeekLoading] = useState(false);

  const [monthPeriodMap, setMonthPeriodMap] = useState<Map<string, number> | null>(null);
  const [monthAdjMap, setMonthAdjMap] = useState<Map<string, number>>(new Map());
  const [monthLoading, setMonthLoading] = useState(false);

  useEffect(() => {
    if (visibleEmployees.length === 0) {
      setMonthPeriodMap(new Map());
      setMonthAdjMap(new Map());
      setMonthLoading(false);
      return;
    }

    let cancelled = false;

    async function loadMonthCanonical() {
      setMonthLoading(true);
      try {
        const { data: periodRows, error: periodErr } = await sb.rpc(
          "payroll_period_canonical",
          {
            p_from: monthStart,
            p_to: monthEndInclusive,
            p_branch_id: null,
            p_employee_id: null,
          }
        );

        if (periodErr) throw periodErr;

        const { data: adjRows, error: adjErr } = await sb
          .from("v_payroll_adjustments_monthly_with_plan")
          .select("employee_id,branch_id,adjustments_sum")
          .eq("month", monthStart);

        if (adjErr) throw adjErr;

        if (cancelled) return;

        setMonthPeriodMap(rowsToNetMap((periodRows ?? []) as PeriodCanonicalRow[]));
        setMonthAdjMap(rowsToAdjMap(adjRows ?? []));
      } catch (err: any) {
        console.error("loadMonthCanonical error", err);
        if (!cancelled) {
          setMonthPeriodMap(new Map());
          setMonthAdjMap(new Map());
        }
      } finally {
        if (!cancelled) setMonthLoading(false);
      }
    }

    loadMonthCanonical();

    return () => {
      cancelled = true;
    };
  }, [monthStart, monthEndInclusive, visibleEmployees]);

  useEffect(() => {
    if (!activeWeek) {
      setWeekPeriodMap(null);
      setWeekLoading(false);
      return;
    }
    if (visibleEmployees.length === 0) {
      setWeekPeriodMap(new Map());
      return;
    }

    let cancelled = false;

    async function loadWeekCanonical() {
      setWeekLoading(true);
      try {
        const weekEndInclusive = shiftYmd(activeWeek.endExclusive, -1);

        const { data, error } = await sb.rpc("payroll_period_canonical", {
          p_from: activeWeek.start,
          p_to: weekEndInclusive,
          p_branch_id: null,
          p_employee_id: null,
        });

        if (error) throw error;
        if (cancelled) return;

        setWeekPeriodMap(rowsToNetMap((data ?? []) as PeriodCanonicalRow[]));
      } catch (err: any) {
        console.error("loadWeekCanonical error", err);
        if (!cancelled) {
          alert(
            `Не удалось загрузить данные за неделю: ${
              err?.message || err?.error_description || String(err)
            }`
          );
          setWeekPeriodMap(new Map());
        }
      } finally {
        if (!cancelled) setWeekLoading(false);
      }
    }

    loadWeekCanonical();

    return () => {
      cancelled = true;
    };
  }, [activeWeek, visibleEmployees]);

  const getMonthNet = (e: any) => {
    const key = `${e.id}:${e.branchId}`;
    return (monthPeriodMap?.get(key) ?? 0) + (monthAdjMap.get(key) ?? 0);
  };

  const getWeekNet = (e: any) => {
    const key = `${e.id}:${e.branchId}`;
    return weekPeriodMap?.get(key) ?? 0;
  };

  const getNet = (e: any) => {
    if (activeWeek) return getWeekNet(e);
    return getMonthNet(e);
  };

  const totalNet = useMemo(
    () => visibleEmployees.reduce((s, e) => s + getNet(e), 0),
    [visibleEmployees, weekPeriodMap, monthPeriodMap, monthAdjMap, activeWeek]
  );

  const totalNetMonth = useMemo(() => {
    return visibleEmployees.reduce((s, e) => s + getMonthNet(e), 0);
  }, [visibleEmployees, monthPeriodMap, monthAdjMap]);

  /* Итог к выплате по каждому филиалу */
  const branchTotals = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of branches) m.set(b.id, 0);
    for (const e of visibleEmployees) {
      m.set(e.branchId, (m.get(e.branchId) ?? 0) + getNet(e));
    }
    return m;
  }, [branches, visibleEmployees, weekPeriodMap, monthPeriodMap, monthAdjMap, activeWeek]);

  /* ===== Детализация по дням (модалка) ===== */
  const [dailyMeta, setDailyMeta] = useState<null | {
    id: number;
    name: string;
    branchId: number;
    netPeriod: number;
    netMonth: number;
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

  const adjForThisView = useMemo(() => (activeWeek ? 0 : dailyAdj), [activeWeek, dailyAdj]);
  const dailyNetWithAdj = useMemo(() => dailyNetSum + adjForThisView, [dailyNetSum, adjForThisView]);

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
      const rangeStart = activeWeek ? activeWeek.start : monthStart;
      const rangeEndInclusive = activeWeek
        ? shiftYmd(activeWeek.endExclusive, -1)
        : monthEndInclusive;

      const { data: rows, error } = await sb.rpc("payroll_daily_canonical", {
        p_from: rangeStart,
        p_to: rangeEndInclusive,
        p_branch_id: e.branchId,
        p_employee_id: e.id,
      });

      if (error) throw error;

      const daily = ((rows ?? []) as DailyCanonicalRow[])
        .slice()
        .sort((a, b) => String(a.day).localeCompare(String(b.day)))
        .map((r) => ({
          ...r,
          plan_premium: 0,
        }));

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

      setDailyRows(daily);
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

  type BranchPremium = {
    turnover_sum: number;
    plan_premium_each: number;
  };

  const [branchPlans, setBranchPlans] = useState<Map<number, BranchPlan>>(new Map());
  const [branchPremiumMap, setBranchPremiumMap] = useState<Map<number, BranchPremium>>(new Map());
  const [histTurnoverByBranch, setHistTurnoverByBranch] = useState<Map<number, number[]>>(new Map());
  const [histMonthsKeys, setHistMonthsKeys] = useState<string[]>([]);
  const [histLoaded, setHistLoaded] = useState(false);
  const [planBusyBranchId, setPlanBusyBranchId] = useState<number | null>(null);

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

  async function selectBranchPlansWithFallback(monthStartDate: string) {
    const monthCols = ["month", "plan_month", "month_start"];

    for (const col of monthCols) {
      const { data, error } = await sb
        .from(BRANCH_PLAN_TABLE)
        .select("*")
        // @ts-ignore
        .eq(col, monthStartDate);

      if (!error) return { rows: data ?? [], monthCol: col };
      if (String((error as any)?.code) === "42703") continue;
      throw error;
    }

    return { rows: [], monthCol: "month" };
  }

  function suggestPlan(branchId: number) {
    const hist = histTurnoverByBranch.get(branchId) ?? [];
    const histPos = hist.filter((x) => x > 0);
    const prev = hist.length ? hist[hist.length - 1] : 0;

    if (histPos.length < 1) {
      return {
        target: 0,
        bonus: 0,
        debug: { usedFallback: false, reason: "no_history", prev, hist },
      };
    }

    const med = median(histPos);
    const q70 = quantile(histPos, AUTO_PLAN.quantile);
    const typical = Math.max(med, q70);

    const prev2 = histPos.length >= 3 ? histPos.slice(-3, -1) : histPos.slice(-2, -1);
    const prevAvg = prev2.length ? mean(prev2) : typical || prev;

    let trendPct = prevAvg > 0 ? (prev - prevAvg) / prevAvg : 0;
    trendPct = clamp(trendPct, AUTO_PLAN.trendClampMin, AUTO_PLAN.trendClampMax);

    const vol = mean(histPos) > 0 ? stdev(histPos) / Math.max(1, mean(histPos)) : 0;
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

    if (volClamped > AUTO_PLAN.volatilitySoftCap) {
      const denom = Math.max(1e-9, AUTO_PLAN.volatilityHardCap - AUTO_PLAN.volatilitySoftCap);
      const k = clamp(1 - (volClamped - AUTO_PLAN.volatilitySoftCap) / denom, 0.6, 1);
      gMax = gMax * k;
      gMin = gMin * clamp(k + 0.1, 0.75, 1);
    }
    gMin = clamp(gMin, AUTO_PLAN.gMinFloor, AUTO_PLAN.gMinCeil);
    gMax = clamp(gMax, Math.max(gMin, AUTO_PLAN.gMaxFloor), AUTO_PLAN.gMaxCeil);

    let anchor = prev;
    if (typical > 0) {
      if (prev <= typical * 0.8) {
        anchor =
          AUTO_PLAN.anchorTypicalWeightLow * typical +
          (1 - AUTO_PLAN.anchorTypicalWeightLow) * prev;
      } else if (prev < typical) {
        anchor =
          AUTO_PLAN.anchorTypicalWeightMid * typical +
          (1 - AUTO_PLAN.anchorTypicalWeightMid) * prev;
      } else {
        anchor = prev;
      }
    }

    const targetRaw = anchor * (1 + gMin);
    const upperRef = Math.max(prev, typical);
    let capUpper = upperRef * (1 + gMax);

    let capLower = Math.max(
      prev * (1 + gMin),
      typical * (1 + gMin * AUTO_PLAN.typicalFloorFactor)
    );
    if (capLower > capUpper) capUpper = capLower;

    const targetCapped = clamp(targetRaw, capLower, capUpper);

    const target = Math.max(0, Math.trunc(roundUpTo(targetCapped, AUTO_PLAN.roundStep)));

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
  }, [isMonthlyPlanMode, histLoaded, branches, histTurnoverByBranch, month]);

  function getBranchPlanEffective(branchId: number): BranchPlan {
    const bp = branchPlans.get(branchId);
    if (bp) {
      return {
        monthly_turnover_target: Math.max(0, Math.trunc(bp.monthly_turnover_target ?? 0)),
        monthly_bonus_each: Math.max(0, Math.trunc(bp.monthly_bonus_each ?? 0)),
        mode: bp.mode ?? "manual",
        auto_params: bp.auto_params ?? null,
        updated_at: bp.updated_at,
      };
    }

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
      monthly_turnover_target: 0,
      monthly_bonus_each: 0,
      mode: "not_set",
      auto_params: null,
      updated_at: undefined,
    };
  }

  useEffect(() => {
    if (!isMonthlyPlanMode) {
      setBranchPlans(new Map());
      setBranchPremiumMap(new Map());
      setHistTurnoverByBranch(new Map());
      setHistMonthsKeys([]);
      setHistLoaded(false);
      return;
    }
    if (!monthStart) return;

    let cancelled = false;

    async function loadPlansPremiumsAndHistory() {
      const keys: string[] = [];
      for (let i = AUTO_PLAN.historyMonths; i >= 1; i--) {
        keys.push(shiftMonthKey(month, -i));
      }

      let planMap = new Map<number, BranchPlan>();
      try {
        const { rows } = await selectBranchPlansWithFallback(monthStart);
        for (const r of (rows ?? []) as any[]) {
          const branchId = Number(r.branch_id ?? r.branchId ?? 0);
          if (!branchId) continue;

          planMap.set(branchId, {
            monthly_turnover_target: Number(r.monthly_turnover_target ?? 0),
            monthly_bonus_each: Number(r.monthly_bonus_each ?? 0),
            mode: r.mode ?? "manual",
            auto_params: r.auto_params ?? null,
            updated_at: r.updated_at ?? null,
          });
        }
      } catch (e: any) {
        console.error("load branch plans error:", extractErrMsg(e));
        planMap = new Map();
      }

      let premMap = new Map<number, BranchPremium>();
      try {
        const { data: premRows, error: premErr } = await sb
          .from("v_payroll_plan_premium_monthly_branch")
          .select("branch_id,turnover_sum,plan_premium_each")
          .eq("month", monthStart);

        if (premErr) throw premErr;

        for (const r of (premRows ?? []) as any[]) {
          const bid = Number(r.branch_id ?? 0);
          if (!bid) continue;
          premMap.set(bid, {
            turnover_sum: Number(r.turnover_sum ?? 0),
            plan_premium_each: Number(r.plan_premium_each ?? 0),
          });
        }
      } catch (e: any) {
        console.error("load branch premium error:", extractErrMsg(e));
        premMap = new Map();
      }

      // ИСТОРИЯ: берём именно дневную выручку филиала
      let histOk = false;
      let histMap = new Map<number, number[]>();
      try {
        const histStart = shiftMonthStart(monthStart, -AUTO_PLAN.historyMonths);
        const histEnd = monthStart;

        const { data: days, error: errDays } = await sb
          .from("v_payroll_branch_turnover_daily")
          .select("branch_id,day,turnover")
          .gte("day", histStart)
          .lt("day", histEnd);

        if (errDays) throw errDays;

        const sumByBranchMonth = new Map<string, number>();
        const branchIdsSeen = new Set<number>();

        for (const r of (days ?? []) as any[]) {
          const bid = Number(r.branch_id ?? 0);
          if (!bid) continue;
          branchIdsSeen.add(bid);

          const dayStr = String(r.day ?? "").slice(0, 10);
          const mk = dayStr.length >= 7 ? dayStr.slice(0, 7) : "";
          if (!mk) continue;

          const t = num(r.turnover);
          const k = `${bid}:${mk}`;
          sumByBranchMonth.set(k, (sumByBranchMonth.get(k) ?? 0) + t);
        }

        const branchIds = branches.length
          ? branches.map((b) => b.id)
          : Array.from(branchIdsSeen);

        for (const bid of branchIds) {
          const arr = keys.map((k) => sumByBranchMonth.get(`${bid}:${k}`) ?? 0);
          histMap.set(bid, arr);
        }

        histOk = true;
      } catch (e: any) {
        console.error("load history error:", extractErrMsg(e));
        histOk = false;
        histMap = new Map();
      }

      if (cancelled) return;

      setBranchPlans(planMap);
      setBranchPremiumMap(premMap);
      setHistMonthsKeys(keys);
      setHistTurnoverByBranch(histMap);
      setHistLoaded(histOk);
    }

    loadPlansPremiumsAndHistory();

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
      if (!s.target || s.target <= 0) {
        alert("Недостаточно истории по выручке, чтобы посчитать авто-план. Поставь план вручную.");
        return;
      }

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

  return (
    <div className="relative min-h-[100dvh] bg-transparent text-slate-50">
      {/* фоновые свечения */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/2 h-72 w-[900px] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[80px]" />
        <div className="absolute top-64 left-10 h-64 w-64 rounded-full bg-sky-500/10 blur-[70px]" />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-emerald-500/10 blur-[80px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-5 pt-8 pb-10">
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

        <div className="mb-4">
          <HeaderCard>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 shadow-[0_0_32px_rgba(34,211,238,0.35)] ring-1 ring-white/25">
                  <Wallet className="h-5 w-5 text-white" />
                </div>
                <div className="space-y-1">
                  <div className="text-[30px] leading-none font-semibold tracking-tight text-slate-900">
                    Зарплаты и посещаемость
                  </div>
                  <div className="text-[12px] text-slate-500">
                    Выплаты по филиалам •{" "}
                    <span className="font-medium text-slate-700">{periodLabel}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="text-slate-500">Месяц</span>
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

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="text-slate-500">Неделя</span>
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

                {(weekLoading || monthLoading) && (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-400" />
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

        {/* ===== Tab switcher ===== */}
        <div className="mb-5 flex gap-1 rounded-2xl bg-white/90 p-1 ring-1 ring-sky-200/80 shadow-[0_8px_30px_rgba(15,23,42,0.12)] backdrop-blur-xl w-fit">
          <button
            onClick={() => setTab("payroll")}
            className={cx(
              "rounded-xl px-5 py-2 text-sm font-medium transition-all",
              tab === "payroll"
                ? "bg-gradient-to-r from-cyan-400 to-sky-400 text-slate-900 shadow-[0_4px_16px_rgba(34,211,238,0.30)]"
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-100/70"
            )}
          >
            Зарплаты
          </button>
          <button
            onClick={() => setTab("penalties")}
            className={cx(
              "rounded-xl px-5 py-2 text-sm font-medium transition-all",
              tab === "penalties"
                ? "bg-gradient-to-r from-cyan-400 to-sky-400 text-slate-900 shadow-[0_4px_16px_rgba(34,211,238,0.30)]"
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-100/70"
            )}
          >
            Штрафы и графики
          </button>
        </div>

        {/* ===== Вкладка «Штрафы и графики» ===== */}
        {tab === "penalties" && <PenaltiesTab />}

        {/* ===== Вкладка «Зарплаты» (всё что было ниже) ===== */}
        {tab === "payroll" && (
        <>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

              {!isMonthlyPlanMode ? (
                <>
                  <div className="text-slate-700">Порог выручки/день</div>
                  <NumberCell
                    value={cfgLocal?.daily_turnover_target ?? 0}
                    onCommit={async (v) => {
                      const vv = Math.max(0, Math.trunc(v));
                      setCfgLocal((c) => (c ? ({ ...c, daily_turnover_target: vv } as any) : c));
                      await updateConfig({ daily_turnover_target: vv } as any);
                      await mutate();
                    }}
                    suffix="сом"
                  />

                  <div className="text-slate-700">Премия за день</div>
                  <NumberCell
                    value={cfgLocal?.daily_bonus_each ?? 0}
                    onCommit={async (v) => {
                      const vv = Math.max(0, Math.trunc(v));
                      setCfgLocal((c) => (c ? ({ ...c, daily_bonus_each: vv } as any) : c));
                      await updateConfig({ daily_bonus_each: vv } as any);
                      await mutate();
                    }}
                    suffix="сом"
                  />
                </>
              ) : (
                <div className="col-span-2 mt-1 text-[12px] text-slate-600">
                  С <span className="font-semibold text-slate-900">2026-02</span> план и премия задаются{" "}
                  <span className="font-semibold text-slate-900">по каждому филиалу</span> ниже.
                  Глобальный месячный fallback убран из этой страницы.
                </div>
              )}
            </div>

            <p className="mt-3 text-xs text-slate-500">
              Бонус считается от <span className="font-semibold">ОПЛАЧЕННЫХ</span> заказов сотрудника
              по данным <span className="font-semibold">payments</span>.
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
            const prevTurnover = histArr.length ? histArr[histArr.length - 1] : 0;
            const med6 = histArr.filter((x) => x > 0).length
              ? Math.trunc(median(histArr.filter((x) => x > 0)))
              : 0;

            const canAuto = isMonthlyPlanMode && histLoaded && prevTurnover > 0;

            const prem = branchPremiumMap.get(b.id);
            const turnover = prem?.turnover_sum ?? 0;
            const planTarget = effectivePlan?.monthly_turnover_target ?? 0;
            const pct = planTarget > 0 ? Math.min(100, Math.round((turnover / planTarget) * 100)) : 0;
            const premiumEach = prem?.plan_premium_each ?? 0;
            const leftToHit = Math.max(0, planTarget - turnover);

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

                {/* PIN кассы + доступ сотрудников */}
                <div className="mb-4 rounded-2xl bg-slate-50/80 ring-1 ring-slate-200 px-4 py-3">
                  {/* Строка: PIN кассы */}
                  <div className="flex flex-wrap items-center gap-2">
                    <KeyRound className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                    <span className="text-[12px] font-semibold text-slate-700">PIN кассы:</span>
                    <input
                      value={pinInputs[b.id] ?? ""}
                      onChange={(e) => setPinInputs((p) => ({ ...p, [b.id]: e.target.value.replace(/\D/g, "") }))}
                      inputMode="numeric"
                      maxLength={8}
                      placeholder="не задан"
                      className="h-7 w-24 rounded-lg border border-sky-200 bg-white px-2.5 text-[12px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
                    />
                    <button
                      className="h-7 rounded-lg px-2.5 text-[11px] font-medium text-teal-700 bg-white ring-1 ring-teal-200 hover:bg-teal-50"
                      onClick={() => setPinInputs((p) => ({ ...p, [b.id]: genPin4() }))}
                    >
                      Генерировать
                    </button>
                    {(pinInputs[b.id] ?? "") && (
                      <button
                        className="h-7 rounded-lg px-2.5 text-[11px] font-medium text-white bg-gradient-to-r from-teal-400 to-sky-400 hover:brightness-110 disabled:opacity-60"
                        disabled={pinBusy === b.id}
                        onClick={() => saveBranchPin(b.id)}
                      >
                        {pinBusy === b.id ? "…" : "Сохранить"}
                      </button>
                    )}
                    {(branchPins[b.id] ?? "") && (
                      <button
                        className="h-7 rounded-lg px-2.5 text-[11px] font-medium text-rose-700 bg-white ring-1 ring-rose-200 hover:bg-rose-50 disabled:opacity-60"
                        disabled={pinBusy === b.id}
                        onClick={() => clearBranchPin(b.id)}
                      >
                        Очистить
                      </button>
                    )}
                    <span className="ml-auto text-[11px] text-slate-500">
                      {(branchPins[b.id] ?? "")
                        ? <>текущий: <span className="font-mono font-semibold text-slate-700">{branchPins[b.id]}</span></>
                        : <span className="text-slate-400">не задан</span>
                      }
                    </span>
                  </div>

                  {/* Разделитель + доступ сотрудников */}
                  <div className="mt-2.5 pt-2.5 border-t border-slate-200 flex flex-wrap items-center gap-2">
                    <User2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="text-[11px] font-semibold text-slate-600">Доступ в смену:</span>

                    {list.map((emp: any) => {
                      const empCred = creds.find((c) => c.employee_id === emp.id && c.is_active);
                      const credOpen = openCredEmpId === emp.id;
                      const form = credForm[emp.id] ?? { login: "", pin: "" };
                      const firstName = String(emp.fullName ?? "").split(" ")[0];

                      if (empCred) {
                        return (
                          <span key={emp.id} className="inline-flex items-center gap-1.5 rounded-xl bg-white ring-1 ring-slate-200 px-2.5 py-1 text-[11px]">
                            <span className="font-semibold text-slate-800">{firstName}</span>
                            <span className="text-slate-300">·</span>
                            <span className="font-mono text-slate-500">{empCred.login}</span>
                            <span className="text-slate-300">/</span>
                            <span className="font-mono font-bold text-sky-700">{empCred.pin_plain ?? "—"}</span>
                            <button
                              onClick={() => removeEmpCred(empCred)}
                              title="Удалить доступ"
                              className="ml-0.5 text-slate-300 hover:text-rose-500 transition-colors"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        );
                      }

                      return (
                        <div key={emp.id} className="inline-flex items-center gap-1">
                          {credOpen ? (
                            <>
                              <span className="text-[11px] text-slate-500 shrink-0">{firstName}:</span>
                              <input
                                value={form.login}
                                onChange={(ev) => setCredForm((f) => ({ ...f, [emp.id]: { ...form, login: ev.target.value } }))}
                                placeholder="логин"
                                className="h-7 w-24 rounded-lg border border-sky-200 bg-white px-2 text-[11px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/60"
                              />
                              <input
                                value={form.pin}
                                onChange={(ev) => setCredForm((f) => ({ ...f, [emp.id]: { ...form, pin: ev.target.value.replace(/\D/g, "").slice(0, 4) } }))}
                                placeholder="PIN"
                                inputMode="numeric"
                                maxLength={4}
                                className="h-7 w-14 rounded-lg border border-sky-200 bg-white px-2 text-[11px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/60"
                              />
                              <button
                                className="h-7 rounded-lg px-1.5 text-[10px] text-teal-700 ring-1 ring-teal-200 hover:bg-teal-50"
                                onClick={() => setCredForm((f) => ({ ...f, [emp.id]: { ...form, pin: genPin4() } }))}
                              >PIN</button>
                              <button
                                className="h-7 inline-flex items-center gap-0.5 rounded-lg bg-gradient-to-r from-cyan-400 to-sky-400 px-2 text-[11px] font-medium text-slate-900 hover:brightness-110"
                                onClick={() => createEmpCred(emp.id)}
                              >
                                <Plus className="h-3 w-3" /> Создать
                              </button>
                              <button
                                className="h-7 px-1 text-slate-400 hover:text-slate-600"
                                onClick={() => setOpenCredEmpId(null)}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setOpenCredEmpId((prev) => prev === emp.id ? null : emp.id)}
                              title={`Добавить доступ для ${emp.fullName}`}
                              className="inline-flex items-center gap-1 rounded-xl border border-dashed border-slate-300 px-2.5 py-1 text-[11px] text-slate-400 hover:border-sky-400 hover:text-sky-600 transition-colors"
                            >
                              <Plus className="h-3 w-3" />
                              <span>{firstName}</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* План месяца по филиалу */}
                {isMonthlyPlanMode ? (
                  <div className="mb-4 rounded-2xl bg-sky-50/60 ring-1 ring-sky-200/60 px-4 py-3">
                    {/* Строка 1: статистика + кнопка Авто */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        План
                      </span>
                      {prevTurnover > 0 && (
                        <span className="text-[11px] text-slate-500">
                          прошл.:{" "}
                          <span className="font-semibold tabular-nums text-slate-700">
                            {fmt(prevTurnover)}
                          </span>{" "}сом
                        </span>
                      )}
                      <span className="text-[11px] text-slate-500">
                        факт:{" "}
                        <span className="font-semibold tabular-nums text-slate-800">
                          {fmt(turnover)}
                        </span>{" "}сом
                      </span>
                      {planTarget > 0 && (
                        <span className={cx(
                          "inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-bold tabular-nums",
                          pct >= 100
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-sky-100 text-sky-700"
                        )}>
                          {pct}%
                        </span>
                      )}
                      {premiumEach > 0 ? (
                        <span className="text-[11px] font-semibold text-emerald-600">
                          +{fmt(premiumEach)} сом/чел
                        </span>
                      ) : planTarget > 0 ? (
                        <span className="text-[11px] text-slate-400">
                          до плана: {fmt(leftToHit)} сом
                        </span>
                      ) : null}
                      {med6 > 0 && (
                        <span className="text-[10px] text-slate-400 ml-1">
                          • медиана 6м: {fmt(med6)}
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-2">
                        {planBusyBranchId === b.id && (
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-400" />
                        )}
                        <GhostBtn
                          disabled={!canAuto || planBusyBranchId === b.id}
                          onClick={() => applyAutoPlan(b.id)}
                        >
                          Авто
                        </GhostBtn>
                      </div>
                    </div>

                    {/* Прогресс-бар */}
                    {planTarget > 0 && (
                      <div className="mb-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}

                    {/* Строка 2: редактируемые поля */}
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-500 shrink-0">Порог</span>
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
                          className="w-[130px]"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-500 shrink-0">Бонус/чел</span>
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
                          className="w-[110px]"
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Таблица сотрудников */}
                <div className="overflow-x-auto">
                  <table className="w-full table-auto border-separate border-spacing-y-3">
                    <colgroup>
                      <col className="w-[190px]" />
                      <col className="w-[120px]" />
                      <col className="w-[100px]" />
                      <col className="w-[150px]" />
                      <col className="w-[120px]" />
                      <col className="w-[160px]" />
                    </colgroup>

                    <thead>
                      <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="text-left px-2">Сотрудник</th>
                        <th className="text-left px-2">Роль</th>
                        <th className="text-right px-2">Ставка/ч</th>
                        <th className="text-center px-2">Бонус</th>
                        <th className="text-right px-2">
                          К выплате{" "}
                          {activeWeek ? (
                            <span className="text-[10px] text-slate-400">(нед)</span>
                          ) : (
                            <span className="text-[10px] text-slate-400">(мес)</span>
                          )}
                        </th>
                        <th className="text-right px-2"></th>
                      </tr>
                    </thead>

                    <tbody>
                      {list.map((e: any) => {
                        const roleUi = dbRoleToUi(e.role) as Exclude<RoleT, "owner">;
                        const netPeriod = getNet(e);
                        const netMonth = getMonthNet(e);

                        return (
                          <tr key={e.id} className="align-middle">
                            <td className={rowTdFirst}>
                              <TextCell
                                value={e.fullName}
                                onCommit={async (v) => {
                                  await updateEmployee(e.id, { fullName: v });
                                  await mutate();
                                }}
                                className="w-[180px]"
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
                                className={cx(selectCls, "h-9 w-[112px]")}
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
                                className="w-[88px]"
                                step={5}
                                suffix="сом"
                              />
                            </td>

                            {/* Бонус: toggle + % в одной ячейке */}
                            <td className={cx(rowTdBase, "text-center")}>
                              <div className="flex items-center justify-center gap-2">
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
                                  className="w-[68px]"
                                  step={1}
                                  suffix="%"
                                />
                              </div>
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
                              <div className="flex justify-end items-center gap-1.5">
                                <button
                                  title="Детали по дням"
                                  onClick={() => openDaily({ id: e.id, fullName: e.fullName, branchId: b.id, netPeriod, netMonth })}
                                  className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[12px] font-medium text-teal-700 bg-white ring-1 ring-teal-200 hover:bg-teal-50 transition-colors"
                                >
                                  <BarChart2 className="h-3.5 w-3.5" />
                                  <span>Детали</span>
                                </button>
                                <button
                                  title={`Удалить ${e.fullName}`}
                                  onClick={async () => {
                                    if (!confirm(`Удалить сотрудника «${e.fullName}»?`)) return;
                                    try {
                                      await removeEmployee(e.id);
                                      await mutate();
                                    } catch (err: any) {
                                      alert(`Не удалось удалить: ${err?.message || err?.error_description || String(err)}`);
                                    }
                                  }}
                                  className="inline-flex items-center rounded-xl p-2 text-rose-400 bg-white ring-1 ring-rose-200 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex items-center justify-end">
                  <div className="text-sm text-slate-700">
                    Итого по филиалу:{" "}
                    <span className="font-semibold text-teal-700 tabular-nums">
                      {fmt((byBranch.get(b.id) ?? []).reduce((s, e: any) => s + getNet(e), 0))} сом
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
                  <div className="py-10 text-center text-sm text-slate-600">Загрузка…</div>
                ) : !hasDailyRows ? (
                  <div className="py-10 text-center text-sm text-slate-600">
                    Данных по дням за выбранный период нет.
                    {hasAdj ? (
                      <div className="mt-2 text-xs text-slate-500">
                        Есть корректировки месяца (включая премию за план).
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
                    </colgroup>

                    <thead>
                      <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="text-left px-2">День</th>
                        <th className="text-right px-2">Часы</th>
                        <th className="text-right px-2">Часовка</th>
                        <th className="text-right px-2">Оплачено</th>
                        <th className="text-right px-2">Бонус</th>
                        <th className="text-right px-2">Штрафы</th>
                        <th className="text-right px-2">Налоги</th>
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
                            {fmt(r.paid_sum)}
                          </td>
                          <td className={cx(rowTdBase, "text-right text-sm text-slate-800")}>
                            {fmt(r.bonus)}
                          </td>
                          <td className={cx(rowTdBase, "text-right text-sm text-slate-800")}>
                            {fmt(r.penalties)}
                          </td>
                          <td className={cx(rowTdBase, "text-right text-sm text-slate-800")}>
                            {fmt(num(r.social_fund_day) + num(r.income_tax_day))}
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
                      {activeWeek ? "Итого по дням за неделю: " : "Итого по дням (без корректировок): "}
                    </span>
                    <span className="font-semibold text-teal-700 tabular-nums">
                      {fmt(dailyNetSum)} сом
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-600">Корректировки месяца (включая премию за план): </span>
                    <span className="font-semibold text-teal-700 tabular-nums">
                      {fmt(dailyAdj)} сом
                    </span>
                    {activeWeek ? (
                      <span className="ml-2 text-xs text-slate-500">(не добавляются к итогу недели)</span>
                    ) : null}
                  </div>

                  <div>
                    <span className="text-slate-600">
                      {activeWeek ? "К выплате за неделю (как в списке): " : "Итого за месяц (как в списке): "}
                    </span>
                    <span className="font-semibold text-teal-700 tabular-nums">
                      {fmt(dailyMeta.netPeriod)} сом
                    </span>
                    {activeWeek ? (
                      <span className="ml-2 text-xs text-slate-500">• За месяц: {fmt(dailyMeta.netMonth)} сом</span>
                    ) : null}
                  </div>

                  {!activeWeek ? (
                    <div>
                      <span className="text-slate-600">Итого по дням + корректировки (для сверки): </span>
                      <span className="font-semibold text-teal-700 tabular-nums">
                        {fmt(dailyNetWithAdj)} сом
                      </span>
                    </div>
                  ) : null}

                  {isMonthlyPlanMode ? (
                    <div className="pt-1 text-xs text-slate-500">
                      С 2026-02 месячная премия приходит через «корректировки месяца», в недельный итог не добавляется.
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* закрываем фрагмент и условие вкладки «Зарплаты» */}
        </>
        )}

        <footer className="mt-8 text-center text-xs text-sky-200/80">
          Редактор зарплат REFOCUS. Источник расчёта: payroll_daily_canonical / payroll_period_canonical.
        </footer>
      </div>
    </div>
  );
}