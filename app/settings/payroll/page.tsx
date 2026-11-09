"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  usePayrollMonthly,
  dbRoleToUi,
  uiRoleToDb,
  type RoleT,
} from "./usePayrollMonthly";
import { Wallet, Building2, KeyRound, User2, Plus, X, BarChart2, Copy, Settings2, ChevronDown } from "lucide-react";
import PenaltiesTab from "./PenaltiesTab";
import DisciplinesTab from "./DisciplinesTab";
import ManagementTab from "./ManagementTab";
import { getBrowserSupabase } from "@/lib/supabaseBrowser";
import toast from "react-hot-toast";

/* ---------- Supabase клиент (с сессией пользователя — нужен для UPDATE под RLS) ---------- */
const sb = getBrowserSupabase();

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
  return (n ?? 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
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

/* ---------- кто оплачивает работу мастера ----------
   Мастер собирает пары для всей сети, поэтому его зарплата делится между двумя
   плательщиками пропорционально числу заказов филиалов за тот же день
   (источник — v_master_pay_by_branch_day). */
const MASTER_PAYERS: { key: string; label: string; branchIds: number[] }[] = [
  { key: "mom", label: "Мама", branchIds: [1, 2, 3] },
  { key: "boss", label: "Болот", branchIds: [4, 5] },
];

/* ---------- время смены (вход–выход) в таймзоне филиала ---------- */
const BISHKEK_TZ = "Asia/Bishkek";
const PAYROLL_V5_START = "2026-08";
function isoHasTZ(s: string) {
  return /Z$|[+-]\d{2}:\d{2}$/.test(String(s).trim());
}
/** Naive timestamp в этой БД = UTC (так пишется ended_at); started_at идёт с офсетом. */
function toLocalDate(iso?: string | null): Date | null {
  if (!iso) return null;
  let s = String(iso).trim();
  const tz = isoHasTZ(s);
  if (s.includes(" ") && !s.includes("T")) s = s.replace(" ", "T");
  const d = tz ? new Date(s) : new Date(s + "Z");
  return isNaN(d.getTime()) ? null : d;
}
function bishkekHMfromDate(d: Date): string {
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: BISHKEK_TZ });
}
function bishkekDayAuto(iso?: string | null): string {
  const d = toLocalDate(iso);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BISHKEK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
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

/** Недели месяца — настоящие ПН–ВС, БЕЗ обрезки по границе месяца.
 *  В список месяца попадает каждая неделя, которая пересекает этот месяц,
 *  поэтому пограничная неделя (напр. 29.06–05.07) видна и в июне, и в июле. */
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

  // Понедельник недели, в которую попадает 1-е число месяца.
  // JS: 0=вс,1=пн,…6=сб → (dow + 6) % 7 = сколько дней назад до понедельника.
  const firstMonday = addDays(monthStart, -((monthStart.getDay() + 6) % 7));

  const weeks: WeekRange[] = [];
  let idx = 1;
  let cursor = new Date(firstMonday);

  // Берём каждую неделю, чей понедельник раньше конца месяца, —
  // так последняя неделя входит целиком, даже с «хвостом» в следующем месяце.
  while (cursor < monthEndExcl) {
    const start = new Date(cursor);
    const endExcl = addDays(start, 7); // ровно 7 дней ПН→ПН, без обрезки
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
    const key = String(Number(r.employee_id));
    m.set(key, (m.get(key) || 0) + num(r.net_total));
  }
  return m;
}

function rowsToAdjMap(rows: any[] | null | undefined) {
  const m = new Map<string, number>();
  for (const r of rows ?? []) {
    const key = String(Number(r.employee_id));
    m.set(key, (m.get(key) || 0) + num(r.adjustments_sum));
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
        className={cx(inputCls, suffix ? "pr-9" : "pr-3", "text-right tabular-nums", className)}
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

// Switch (тумблер бонуса) удалён: бонус 0 = выключен, отдельный переключатель не нужен.

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
        "rounded-2xl p-5 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] text-slate-900",
        className
      )}
    >
      {children}
    </div>
  );
}

function HeaderCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-5 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] text-slate-900">
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
        "inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white",
        "shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400",
        "focus:outline-none focus:ring-2 focus:ring-cyan-300/70",
        "disabled:opacity-50 disabled:cursor-not-allowed",
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
        "inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-slate-700",
        "ring-1 ring-slate-200 transition hover:bg-slate-50",
        "focus:outline-none focus:ring-2 focus:ring-cyan-300/70",
        "disabled:opacity-50 disabled:cursor-not-allowed",
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
        "inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-rose-700",
        "ring-1 ring-rose-200 transition hover:bg-rose-50",
        "focus:outline-none focus:ring-2 focus:ring-rose-300/70",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
    />
  );
}

/* ---------- План филиала: серверная модель Payroll v5 ---------- */
// Расчёт/экономика живут в Postgres; UI читает v_payroll_plan_progress_v5.
// Создание и фиксация выполняются только для будущего месяца через freeze RPC.
// Клиентская формула удалена — браузер никогда не пересчитывает финансовый факт.
const BRANCH_PLAN_TABLE = "payroll_branch_plans";
const HISTORY_MONTHS_FOR_DISPLAY = 6;

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


function median(arr: number[]) {
  const a = arr.slice().sort((x, y) => x - y);
  const n = a.length;
  if (!n) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/* ===========================================
   СТРАНИЦА
=========================================== */
export default function Page() {
  const [tab, setTab] = useState<"payroll" | "penalties" | "disciplines" | "management">("payroll");

  const [month, setMonth] = useState<string>(() => {
    return currentBusinessMonthKey();
  });

  const { year, monthIndex } = useMemo(() => parseMonthStr(month), [month]);
  const years = useMemo(() => {
    const cur = parseMonthStr(currentBusinessMonthKey()).year;
    return [cur - 1, cur, cur + 1];
  }, []);

  function handleMonthChange(nextYear: number, nextMonthIndex: number) {
    const mm = String(nextMonthIndex + 1).padStart(2, "0");
    setMonth(`${nextYear}-${mm}`);
    setWeekKey("__full__");
  }

  // выбор недели — по умолчанию текущая неделя
  const [weekKey, setWeekKey] = useState<string>(() => {
    return getCurrentWeekKey(currentBusinessMonthKey());
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
  // подтверждение удаления (защита от случайного клика)
  const [confirmDel, setConfirmDel] = useState<
    null | { kind: "branch" | "employee"; id: number; name: string }
  >(null);
  const [delBusy, setDelBusy] = useState(false);

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
    // Прямой UPDATE employee_credentials из браузера молча блокируется RLS
    // (нет политики для authenticated), а login/pin_* там NOT NULL. Поэтому
    // снятие доступа делаем через SECURITY DEFINER RPC (удаляет кред целиком).
    const { error } = await sb.rpc("app_remove_employee_login", {
      p_employee_id: row.employee_id,
    });
    if (error) { alert(error.message); return; }
    await loadCreds();
  }

  /* ===== Канонические карты по периоду ===== */
  const [weekPeriodMap, setWeekPeriodMap] = useState<Map<string, number> | null>(null);
  const [weekLoading, setWeekLoading] = useState(false);

  // Инкремент после отмены штрафа на вкладке «Штрафы» — форсирует перезагрузку
  // недельных и месячных сумм «К выплате» без перезагрузки страницы.
  const [payrollRefreshTick, setPayrollRefreshTick] = useState(0);

  const [monthPeriodMap, setMonthPeriodMap] = useState<Map<string, number> | null>(null);
  const [monthAdjMap, setMonthAdjMap] = useState<Map<string, number>>(new Map());
  const [monthLoading, setMonthLoading] = useState(false);

  // Бонус за возврат долгов (система «Должники», Беловодск): сумма 10%-начислений
  // по сотруднику за период. Ключ карты — employee_id. Втекает в «К выплате».
  const [weekDebtMap, setWeekDebtMap] = useState<Map<number, number>>(new Map());
  const [monthDebtMap, setMonthDebtMap] = useState<Map<number, number>>(new Map());

  // Еженедельные удержания (недостача и т.п.): сумма по сотруднику за период.
  // Ключ карты — employee_id. Вычитается из «К выплате» (неделя + месяц).
  const [weekDeductMap, setWeekDeductMap] = useState<Map<number, number>>(new Map());
  const [monthDeductMap, setMonthDeductMap] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    if (employees.length === 0) {
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
  }, [monthStart, monthEndInclusive, employees, payrollRefreshTick]);

  useEffect(() => {
    if (!activeWeek) {
      setWeekPeriodMap(null);
      setWeekLoading(false);
      return;
    }
    if (employees.length === 0) {
      setWeekPeriodMap(new Map());
      return;
    }

    let cancelled = false;

    async function loadWeekCanonical() {
      setWeekLoading(true);
      try {
        const weekEndInclusive = shiftYmd(activeWeek!.endExclusive, -1);

        const { data, error } = await sb.rpc("payroll_period_canonical", {
          p_from: activeWeek!.start,
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
  }, [activeWeek, employees, payrollRefreshTick]);

  /* ===== Бонус за возврат долгов (debt_collection_payout) ===== */
  // Bishkek = UTC+6 без переходов, границы периода строим с офсетом +06:00.
  async function fetchDebtBonusMap(
    startYmd: string,
    endExclusiveYmd: string
  ): Promise<Map<number, number>> {
    const m = new Map<number, number>();
    try {
      const { data, error } = await sb
        .from("debt_collection_payout")
        .select("employee_id,bonus_amount")
        .gte("collected_at", `${startYmd}T00:00:00+06:00`)
        .lt("collected_at", `${endExclusiveYmd}T00:00:00+06:00`);
      if (error) throw error;
      for (const r of (data ?? []) as any[]) {
        const id = Number(r.employee_id);
        m.set(id, (m.get(id) ?? 0) + num(r.bonus_amount));
      }
    } catch (err) {
      console.error("fetchDebtBonusMap error", err);
    }
    return m;
  }

  useEffect(() => {
    let cancelled = false;
    fetchDebtBonusMap(monthStart, monthEndExcl).then((m) => {
      if (!cancelled) setMonthDebtMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, [monthStart, monthEndExcl]);

  useEffect(() => {
    if (!activeWeek) {
      setWeekDebtMap(new Map());
      return;
    }
    let cancelled = false;
    fetchDebtBonusMap(activeWeek.start, activeWeek.endExclusive).then((m) => {
      if (!cancelled) setWeekDebtMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, [activeWeek]);

  /* ===== Еженедельные удержания (payroll_weekly_deductions) ===== */
  async function fetchDeductMap(
    startYmd: string,
    endExclusiveYmd: string
  ): Promise<Map<number, number>> {
    const m = new Map<number, number>();
    try {
      const { data, error } = await sb
        .from("payroll_weekly_deductions")
        .select("employee_id,amount")
        .gte("week_start", startYmd)
        .lt("week_start", endExclusiveYmd);
      if (error) throw error;
      for (const r of (data ?? []) as any[]) {
        const id = Number(r.employee_id);
        m.set(id, (m.get(id) ?? 0) + num(r.amount));
      }
    } catch (err) {
      console.error("fetchDeductMap error", err);
    }
    return m;
  }

  useEffect(() => {
    let cancelled = false;
    fetchDeductMap(monthStart, monthEndExcl).then((m) => {
      if (!cancelled) setMonthDeductMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, [monthStart, monthEndExcl]);

  useEffect(() => {
    if (!activeWeek) {
      setWeekDeductMap(new Map());
      return;
    }
    let cancelled = false;
    fetchDeductMap(activeWeek.start, activeWeek.endExclusive).then((m) => {
      if (!cancelled) setWeekDeductMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, [activeWeek]);

  const getMonthNet = (e: any) => {
    const key = String(e.id);
    const monthlyNet = e.net ?? (
      (monthPeriodMap?.get(key) ?? 0) +
      (monthAdjMap.get(key) ?? 0) +
      (e.managementTotal ?? 0)
    );
    return (
      monthlyNet +
      (monthDebtMap.get(e.id) ?? 0) -
      (monthDeductMap.get(e.id) ?? 0)
    );
  };

  const getWeekNet = (e: any) => {
    const key = String(e.id);
    return (
      (weekPeriodMap?.get(key) ?? 0) +
      (weekDebtMap.get(e.id) ?? 0) -
      (weekDeductMap.get(e.id) ?? 0)
    );
  };

  const getNet = (e: any) => {
    if (activeWeek) return getWeekNet(e);
    return getMonthNet(e);
  };

  const totalNet = useMemo(
    () => visibleEmployees.reduce((s, e) => s + getNet(e), 0),
    [visibleEmployees, weekPeriodMap, monthPeriodMap, monthAdjMap, weekDebtMap, monthDebtMap, weekDeductMap, monthDeductMap, activeWeek]
  );

  const totalNetMonth = useMemo(() => {
    return visibleEmployees.reduce((s, e) => s + getMonthNet(e), 0);
  }, [visibleEmployees, monthPeriodMap, monthAdjMap, monthDebtMap, monthDeductMap]);

  /* Итог к выплате по каждому филиалу */
  const branchTotals = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of branches) m.set(b.id, 0);
    for (const e of visibleEmployees) {
      m.set(e.branchId, (m.get(e.branchId) ?? 0) + getNet(e));
    }
    return m;
  }, [branches, visibleEmployees, weekPeriodMap, monthPeriodMap, monthAdjMap, weekDebtMap, monthDebtMap, weekDeductMap, monthDeductMap, activeWeek]);

  /* ===== Детализация по дням (модалка) ===== */
  const [dailyMeta, setDailyMeta] = useState<null | {
    id: number;
    name: string;
    branchId: number;
    netPeriod: number;
    netMonth: number;
    role: string;
    managementTotal: number;
  }>(null);
  const [dailyRows, setDailyRows] = useState<any[] | null>(null);
  const [dailyBusy, setDailyBusy] = useState(false);
  const [dailyAdj, setDailyAdj] = useState<number>(0);
  // Бонус за возврат долгов за выбранный период (для строки в модалке «Детали»).
  const [dailyDebtBonus, setDailyDebtBonus] = useState<number>(0);
  const [dailyDebtRows, setDailyDebtRows] = useState<{ order_no: string; bonus: number }[]>([]);
  // Еженедельное удержание за выбранный период + полный график недель (для «Деталей»).
  const [dailyDeduct, setDailyDeduct] = useState<number>(0);
  const [dailyDeductPlan, setDailyDeductPlan] = useState<
    { week_start: string; amount: number; reason: string | null }[]
  >([]);
  // Мастер: раскладка «кто сколько платит» по филиалам за выбранный период.
  const [dailyMasterSplit, setDailyMasterSplit] = useState<
    { branchId: number; pairs: number; amount: number }[]
  >([]);

  async function openDaily(e: {
    id: number;
    fullName: string;
    branchId: number;
    netPeriod: number;
    netMonth: number;
    role: string;
    managementTotal: number;
  }) {
    setDailyMeta({
      id: e.id,
      name: e.fullName,
      branchId: e.branchId,
      netPeriod: e.netPeriod,
      netMonth: e.netMonth,
      role: e.role,
      managementTotal: e.managementTotal,
    });
    setDailyRows(null);
    setDailyAdj(0);
    setDailyDebtBonus(0);
    setDailyDebtRows([]);
    setDailyDeduct(0);
    setDailyDeductPlan([]);
    setDailyMasterSplit([]);
    setDailyBusy(true);

    try {
      const rangeStart = activeWeek ? activeWeek.start : monthStart;
      const rangeEndInclusive = activeWeek
        ? shiftYmd(activeWeek.endExclusive, -1)
        : monthEndInclusive;

      const { data: rows, error } = await sb.rpc("payroll_daily_canonical", {
        p_from: rangeStart,
        p_to: rangeEndInclusive,
        p_branch_id: null,
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

      // Время смены (вход–выход) по дням — из attendance_sessions
      try {
        const { data: sessRows } = await sb
          .from("attendance_sessions")
          .select("started_at, ended_at, branch_id")
          .eq("employee_id", e.id)
          .gte("started_at", `${shiftYmd(rangeStart, -1)}T00:00:00`)
          .lte("started_at", `${shiftYmd(rangeEndInclusive, 1)}T23:59:59`)
          .order("started_at", { ascending: true });

        const shiftByDay = new Map<string, { inAt: Date | null; outAt: Date | null }>();
        for (const s of (sessRows ?? []) as any[]) {
          if (!s.started_at) continue;
          const day = bishkekDayAuto(s.ended_at ?? s.started_at);
          if (!day) continue;
          const dayKey = `${day}:${Number(s.branch_id)}`;
          const inAt = toLocalDate(s.started_at);
          const outAt = s.ended_at ? toLocalDate(s.ended_at) : null;
          const cur = shiftByDay.get(dayKey) ?? { inAt: null, outAt: null };
          if (inAt && (!cur.inAt || inAt < cur.inAt)) cur.inAt = inAt;
          if (outAt && (!cur.outAt || outAt > cur.outAt)) cur.outAt = outAt;
          shiftByDay.set(dayKey, cur);
        }
        for (const r of daily) {
          const sh = shiftByDay.get(`${String((r as any).day)}:${Number(r.branch_id)}`);
          (r as any).shift_in = sh?.inAt ? bishkekHMfromDate(sh.inAt) : null;
          (r as any).shift_out = sh?.outAt ? bishkekHMfromDate(sh.outAt) : null;
        }
      } catch {
        // время смены не критично — пропускаем
      }

      // Мастер: подтягиваем «собрал / в системе» по дням для сверки.
      if (e.role === "master") {
        try {
          const { data: logRows } = await sb
            .from("v_master_shift_log")
            .select("work_date, pairs_made, system_count")
            .eq("employee_id", e.id)
            .gte("work_date", rangeStart)
            .lte("work_date", rangeEndInclusive);
          const byDay = new Map<string, { pairs: number; sys: number | null }>();
          for (const lr of (logRows ?? []) as any[]) {
            byDay.set(String(lr.work_date), {
              pairs: Number(lr.pairs_made ?? 0),
              sys: lr.system_count == null ? null : Number(lr.system_count),
            });
          }
          for (const r of daily as any[]) {
            const lg = byDay.get(String((r as any).day));
            (r as any).pairs_made = lg ? lg.pairs : null;
            (r as any).system_count = lg ? lg.sys : null;
          }
        } catch {
          // сверка не критична — пропускаем
        }

        // Раскладка «кто сколько платит»: пары мастера разносятся по филиалам
        // пропорционально их заказам за тот же день.
        try {
          const { data: splitRows } = await sb
            .from("v_master_pay_by_branch_day")
            .select("branch_id, pairs, net_day")
            .eq("employee_id", e.id)
            .gte("day", rangeStart)
            .lte("day", rangeEndInclusive);

          const byBranch = new Map<number, { pairs: number; amount: number }>();
          for (const sr of (splitRows ?? []) as any[]) {
            const bid = Number(sr.branch_id);
            if (!Number.isFinite(bid)) continue;
            const cur = byBranch.get(bid) ?? { pairs: 0, amount: 0 };
            cur.pairs += num(sr.pairs);
            cur.amount += num(sr.net_day);
            byBranch.set(bid, cur);
          }
          setDailyMasterSplit(
            [...byBranch.entries()]
              .map(([branchId, v]) => ({ branchId, ...v }))
              .sort((a, b) => a.branchId - b.branchId)
          );
        } catch {
          // раскладка не критична — пропускаем
        }
      }

      const { data: adjustmentRows, error: errAdj } = await sb
        .from("v_payroll_adjustments_monthly_with_plan")
        .select("adjustments_sum")
        .eq("employee_id", e.id)
        .eq("month", monthStart);

      if (errAdj) throw errAdj;

      const adj = (adjustmentRows || []).reduce((sum, row) => sum + num(row.adjustments_sum), 0);

      setDailyRows(daily);
      setDailyAdj(adj);

      // Бонус за возврат долгов (Беловодск): сумма за период + разбивка по заказам.
      setDailyDebtBonus((activeWeek ? weekDebtMap : monthDebtMap).get(e.id) ?? 0);
      try {
        const dbStart = activeWeek ? activeWeek.start : monthStart;
        const dbEnd = activeWeek ? activeWeek.endExclusive : monthEndExcl;
        const { data: payoutRows } = await sb
          .from("debt_collection_payout")
          .select("bonus_amount, orders(order_no)")
          .eq("employee_id", e.id)
          .gte("collected_at", `${dbStart}T00:00:00+06:00`)
          .lt("collected_at", `${dbEnd}T00:00:00+06:00`);
        setDailyDebtRows(
          ((payoutRows ?? []) as any[]).map((r) => ({
            order_no: r.orders?.order_no ?? "—",
            bonus: num(r.bonus_amount),
          }))
        );
      } catch {
        setDailyDebtRows([]);
      }

      // Еженедельное удержание (недостача): сумма за период + весь график недель.
      setDailyDeduct((activeWeek ? weekDeductMap : monthDeductMap).get(e.id) ?? 0);
      try {
        const { data: dedRows } = await sb
          .from("payroll_weekly_deductions")
          .select("week_start, amount, reason")
          .eq("employee_id", e.id)
          .eq("branch_id", e.branchId)
          .order("week_start", { ascending: true });
        setDailyDeductPlan(
          ((dedRows ?? []) as any[]).map((r) => ({
            week_start: String(r.week_start),
            amount: num(r.amount),
            reason: r.reason ?? null,
          }))
        );
      } catch {
        setDailyDeductPlan([]);
      }
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
    setDailyDebtBonus(0);
    setDailyDebtRows([]);
    setDailyDeduct(0);
    setDailyDeductPlan([]);
    setDailyMasterSplit([]);
    setDailyBusy(false);
  }

  /* ===== Расчётный листок картинкой (минималистичная детализация для продавца) ===== */
  function buildDailyImage(): { canvas: HTMLCanvasElement; fileName: string } | null {
    if (!dailyMeta || !dailyRows || dailyRows.length === 0) return null;

    const isPromoter = dailyMeta.role === "promoter";
    const period = periodLabel;
    const branchName = branches.find((b) => b.id === dailyMeta.branchId)?.name ?? "";

    const fmtHMshort = (hours?: number) => {
      const totalMin = Math.max(0, Math.round((hours ?? 0) * 60));
      const h = Math.trunc(totalMin / 60);
      const m = totalMin % 60;
      return `${h}ч ${String(m).padStart(2, "0")}м`;
    };
    const fmtDay = (d: string) => {
      const p = String(d).split("-");
      return p.length === 3 ? `${p[2]}.${p[1]}` : String(d);
    };

    const COL_SLATE = "#1e293b";
    const COL_ROSE = "#e11d48";
    const COL_CYAN = "#0e7490";

    type Col = {
      title: string;
      w: number;
      align: "left" | "right";
      get: (r: any) => string;
      color?: (r: any) => string;
    };
    const cols: Col[] = [
      { title: "Дата", w: 78, align: "left", get: (r) => fmtDay(r.day) },
      {
        title: "Смена",
        w: 110,
        align: "left",
        get: (r) => (r.shift_in ? `${r.shift_in} – ${r.shift_out ?? "…"}` : "—"),
      },
      { title: "Часы", w: 82, align: "right", get: (r) => fmtHMshort(r.hours) },
      { title: "Часовка", w: 86, align: "right", get: (r) => fmt(r.hour_pay) },
      { title: "Бонус", w: 80, align: "right", get: (r) => fmt(r.bonus) },
      {
        title: "Штраф",
        w: 84,
        align: "right",
        get: (r) => (isPromoter ? "—" : num(r.penalties) > 0 ? fmt(r.penalties) : "—"),
        color: (r) => (!isPromoter && num(r.penalties) > 0 ? COL_ROSE : COL_SLATE),
      },
      {
        title: "Налоги",
        w: 74,
        align: "right",
        get: (r) => (isPromoter ? "—" : fmt(num(r.social_fund_day) + num(r.income_tax_day))),
      },
      {
        title: "Итог",
        w: 96,
        align: "right",
        get: (r) => fmt(r.net_day),
        color: (r) => (num(r.net_day) < 0 ? COL_ROSE : COL_CYAN),
      },
    ];

    const padX = 28;
    const tableW = cols.reduce((s, c) => s + c.w, 0);
    const W = tableW + padX * 2;

    // В копию выводим только одну итоговую цифру — ровно как в модалке
    // («К выплате за неделю/месяц»), без промежуточных строк по дням и корректировок.
    const foot: { label: string; value: string; strong?: boolean }[] = [
      {
        label: activeWeek ? "К выплате за неделю" : "К выплате за месяц",
        value: `${fmt(dailyMeta.netPeriod)} сом`,
        strong: true,
      },
    ];
    if (dailyMeta.branchId === 2 && dailyDebtBonus > 0) {
      foot.push({
        label: "в т.ч. бонус за возврат долгов (10%)",
        value: `+${fmt(dailyDebtBonus)} сом`,
      });
    }
    if (dailyDeduct > 0) {
      foot.push({
        label: "в т.ч. удержание за недостачу",
        value: `−${fmt(dailyDeduct)} сом`,
      });
    }

    const yTop = 22;
    const titleH = 62;
    const headH = 34;
    const rowH = 30;
    const divGap = 18;
    const H = yTop + titleH + headH + dailyRows.length * rowH + divGap + foot.length * 26 + 30;

    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(scale, scale);
    ctx.textBaseline = "middle";

    const FONT = "'Segoe UI', Roboto, Arial, sans-serif";

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    let y = yTop;

    // Заголовок
    ctx.textAlign = "left";
    ctx.fillStyle = "#0f172a";
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText(dailyMeta.name, padX, y + 16);
    ctx.fillStyle = "#64748b";
    ctx.font = `400 13px ${FONT}`;
    ctx.fillText([branchName, period].filter(Boolean).join(" · "), padX, y + 42);
    y += titleH;

    // Шапка таблицы
    const colX: number[] = [];
    {
      let x = padX;
      for (const c of cols) {
        colX.push(x);
        x += c.w;
      }
    }
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(padX, y, tableW, headH);
    ctx.fillStyle = "#64748b";
    ctx.font = `600 12px ${FONT}`;
    cols.forEach((c, i) => {
      ctx.textAlign = c.align;
      ctx.fillText(c.title, c.align === "left" ? colX[i] + 10 : colX[i] + c.w - 10, y + headH / 2);
    });
    y += headH;

    // Строки
    ctx.font = `400 13px ${FONT}`;
    dailyRows.forEach((r: any, idx: number) => {
      if (idx % 2 === 1) {
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(padX, y, tableW, rowH);
      }
      cols.forEach((c, i) => {
        ctx.fillStyle = c.color ? c.color(r) : COL_SLATE;
        ctx.textAlign = c.align;
        ctx.fillText(c.get(r), c.align === "left" ? colX[i] + 10 : colX[i] + c.w - 10, y + rowH / 2);
      });
      y += rowH;
    });

    // Разделитель
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, Math.round(y) + 0.5);
    ctx.lineTo(padX + tableW, Math.round(y) + 0.5);
    ctx.stroke();
    y += divGap;

    // Итоги
    foot.forEach((f) => {
      ctx.textAlign = "left";
      ctx.fillStyle = f.strong ? "#0f172a" : "#475569";
      ctx.font = `${f.strong ? 700 : 400} ${f.strong ? 15 : 13}px ${FONT}`;
      ctx.fillText(f.label + ":", padX, y + 12);
      ctx.textAlign = "right";
      ctx.fillStyle = f.strong ? "#0e7490" : "#0f172a";
      ctx.font = `700 ${f.strong ? 16 : 13}px ${FONT}`;
      ctx.fillText(f.value, padX + tableW, y + 12);
      y += 26;
    });

    ctx.textAlign = "right";
    ctx.fillStyle = "#94a3b8";
    ctx.font = `400 10px ${FONT}`;
    ctx.fillText("Refocus", padX + tableW, H - 12);

    const fileName = `Зарплата ${dailyMeta.name} — ${period}.png`.replace(/[\\/:*?"<>|]+/g, "_");
    return { canvas, fileName };
  }

  async function copyDailyImage() {
    const built = buildDailyImage();
    if (!built) return;
    const { canvas, fileName } = built;

    const canCopy =
      typeof window !== "undefined" &&
      typeof (window as any).ClipboardItem !== "undefined" &&
      !!navigator.clipboard?.write;

    if (canCopy) {
      try {
        const blobPromise = new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png")
        );
        await navigator.clipboard.write([
          new (window as any).ClipboardItem({ "image/png": blobPromise }),
        ]);
        toast.success("Скопировано — вставьте в чат (Ctrl+V)");
        return;
      } catch {
        // не удалось скопировать — упадём в скачивание ниже
      }
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, "image/png");
    toast("Копирование не поддерживается — файл скачан");
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
    bonusPerOrder?: number;
  }) {
    const { employeeId, branchId, hourlyRate, hasBonus, bonusPercent, bonusPerOrder } =
      opts;

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
    // Промоутеры: фикс. бонус (сом) за заказ филиала в смене.
    if (typeof bonusPerOrder === "number")
      payload.bonus_per_order = Math.max(0, Math.trunc(bonusPerOrder));

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

  // Удержания (недостача): итоги для блока в «Деталях».
  // «Осталось» считаем относительно текущей реальной недели (не от выбранной вкладки).
  const currentWeekStart = (() => {
    const t = new Date();
    const monday = new Date(t);
    monday.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
  })();
  const deductTotal = dailyDeductPlan.reduce((s, x) => s + x.amount, 0);
  const deductApplied = dailyDeductPlan
    .filter((x) => x.week_start <= currentWeekStart)
    .reduce((s, x) => s + x.amount, 0);
  const deductRemaining = Math.max(0, deductTotal - deductApplied);
  const dmFromYmd = (ymd: string) => {
    const p = ymd.split("-");
    return p.length === 3 ? `${p[2]}.${p[1]}` : ymd;
  };

  const rowTdBase = cx(
    "bg-white/92 backdrop-blur",
    "border-y border-sky-100/80",
    "px-3 py-3"
  );
  const rowTdFirst = cx(rowTdBase, "border-l rounded-l-2xl");
  const rowTdLast = cx(rowTdBase, "border-r rounded-r-2xl");

  const hasDailyRows = (dailyRows?.length ?? 0) > 0;
  const hasAdj = Math.round(dailyAdj) !== 0;
  const showDailyFooter = dailyRows !== null && (hasDailyRows || hasAdj || dailyDebtBonus > 0 || dailyDeduct > 0);

  /* ===== Планы по филиалам (месяц >= 2026-02) ===== */
  type BranchPlan = {
    monthly_turnover_target: number;
    monthly_bonus_each: number;
    mode?: string;
    auto_params?: any;
    updated_at?: string | null;
    formula_version?: string | null;
    status?: string | null;
    locked_at?: string | null;
    forecast_target?: number;
    economic_target?: number;
    break_even_target?: number;
    bonus_start_target?: number;
    target_margin_rate?: number;
    target_profit?: number;
    eligible_seller_count?: number;
    estimated_economics?: Record<string, unknown> | null;
    payout_multiplier?: number;
    projected_branch_payout?: number;
    is_estimated?: boolean;
    estimate_reasons?: string[];
    is_v5?: boolean;
    source_reason?: string | null;
    review_required?: boolean;
    review_status?: string | null;
    review_reasons?: string[];
    is_active?: boolean;
    observed_month_count?: number;
    recent_observed_max?: number;
    target_to_recent_max_ratio?: number;
    volatility_cv?: number;
    approval_mode?: string | null;
    approval_note?: string | null;
    approved_at?: string | null;
  };

  type BranchPremium = {
    turnover_sum: number;
    net_sales?: number;
    gross_sales?: number;
    refunds_sum?: number;
    plan_premium_each: number;
    payout_multiplier?: number;
    achievement_ratio?: number;
    is_provisional?: boolean;
  };

  const [branchPlans, setBranchPlans] = useState<Map<number, BranchPlan>>(new Map());
  const [branchPremiumMap, setBranchPremiumMap] = useState<Map<number, BranchPremium>>(new Map());
  const [histTurnoverByBranch, setHistTurnoverByBranch] = useState<Map<number, number[]>>(new Map());
  const [histMonthsKeys, setHistMonthsKeys] = useState<string[]>([]);
  const [histLoaded, setHistLoaded] = useState(false);
  const [planBusyBranchId, setPlanBusyBranchId] = useState<number | null>(null);
  const [planRefreshTick, setPlanRefreshTick] = useState(0);
  const [planDialog, setPlanDialog] = useState<
    | { kind: "auto"; branchId: number; branchName: string }
    | {
        kind: "manual";
        branchId: number;
        branchName: string;
        target: string;
        bonus: string;
        reason: string;
      }
    | {
        kind: "approve";
        branchId: number;
        branchName: string;
        target: string;
        bonus: string;
        originalTarget: number;
        originalBonus: number;
        allowAdjust: boolean;
        reason: string;
        reviewReasons: string[];
      }
    | null
  >(null);
  const businessMonth = useMemo(() => currentBusinessMonthKey(), []);
  const nextBusinessMonth = useMemo(() => shiftMonthKey(businessMonth, 1), [businessMonth]);
  const isFuturePlanMonth = month > businessMonth;
  const isCurrentPlanMonth = month === businessMonth;
  const isNextPlanMonth = month === nextBusinessMonth;
  const isV5PlanMonth = month >= PAYROLL_V5_START;

  useEffect(() => {
    setPlanDialog(null);
  }, [month]);

  function planIsLocked(plan?: BranchPlan | null): boolean {
    const status = String(plan?.status ?? "").toLowerCase();
    return Boolean(
      plan?.locked_at ||
        plan?.mode === "auto_locked" ||
        ["locked", "frozen", "final", "closed"].includes(status)
    );
  }

  function planIsReadOnly(plan?: BranchPlan | null): boolean {
    return !isFuturePlanMonth || planIsLocked(plan);
  }

  // ✅ Канон: колонка месяца — `month` (date), PK (branch_id, month).
  // Hack с тремя именами колонки удалён после миграции payroll_phase1.
  async function upsertBranchPlanWithFallback(payloadBase: any) {
    const { error } = await sb
      .from(BRANCH_PLAN_TABLE)
      .upsert(payloadBase, { onConflict: "branch_id,month" });
    if (error) throw error;
  }

  async function selectBranchPlansWithFallback(monthStartDate: string) {
    const { data, error } = await sb
      .from(BRANCH_PLAN_TABLE)
      .select("*")
      .eq("month", monthStartDate);
    if (error) throw error;
    return { rows: data ?? [], monthCol: "month" };
  }

  // Клиентской формулы нет: расчёт v5, экономика и payout multiplier приходят
  // из серверных plan/progress объектов, одинаковых для CRM и POS.

  // Источник правды — v5 plan/progress; payroll_branch_plans остаётся только
  // read-fallback до полной публикации v5. Отсутствующий текущий/прошлый план
  // браузер не создаёт задним числом.
  function getBranchPlanEffective(branchId: number): BranchPlan {
    const bp = branchPlans.get(branchId);
    if (bp) {
      return {
        monthly_turnover_target: Math.max(0, Math.trunc(bp.monthly_turnover_target ?? 0)),
        monthly_bonus_each: Math.max(0, Math.trunc(bp.monthly_bonus_each ?? 0)),
        mode: bp.mode ?? "manual",
        auto_params: bp.auto_params ?? null,
        updated_at: bp.updated_at,
        formula_version: bp.formula_version ?? bp.auto_params?.version ?? null,
        status: bp.status ?? null,
        locked_at: bp.locked_at ?? null,
        forecast_target: optionalNum(bp.forecast_target),
        economic_target: optionalNum(bp.economic_target),
        break_even_target: optionalNum(bp.break_even_target),
        bonus_start_target: optionalNum(bp.bonus_start_target),
        target_margin_rate: optionalNum(bp.target_margin_rate),
        target_profit: optionalNum(bp.target_profit),
        eligible_seller_count: optionalNum(bp.eligible_seller_count),
        estimated_economics: bp.estimated_economics ?? null,
        payout_multiplier: optionalNum(bp.payout_multiplier),
        projected_branch_payout: optionalNum(bp.projected_branch_payout),
        is_estimated: bp.is_estimated,
        estimate_reasons: bp.estimate_reasons ?? [],
        is_v5: bp.is_v5 ?? false,
        source_reason: bp.source_reason ?? null,
        review_required: bp.review_required,
        review_status: bp.review_status ?? null,
        review_reasons: bp.review_reasons ?? [],
        is_active: bp.is_active,
        observed_month_count: optionalNum(bp.observed_month_count),
        recent_observed_max: optionalNum(bp.recent_observed_max),
        target_to_recent_max_ratio: optionalNum(bp.target_to_recent_max_ratio),
        volatility_cv: optionalNum(bp.volatility_cv),
        approval_mode: bp.approval_mode ?? null,
        approval_note: bp.approval_note ?? null,
        approved_at: bp.approved_at ?? null,
      };
    }
    return {
      monthly_turnover_target: 0,
      monthly_bonus_each: 0,
      mode: "pending",
      auto_params: null,
      updated_at: undefined,
      formula_version: null,
      status: "pending",
      locked_at: null,
      estimated_economics: null,
      estimate_reasons: [],
      is_v5: false,
      review_reasons: [],
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
      for (let i = HISTORY_MONTHS_FOR_DISPLAY; i >= 1; i--) {
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
            formula_version: r.formula_version ?? r.auto_params?.version ?? null,
            status: r.status ?? null,
            locked_at: r.locked_at ?? null,
            forecast_target: optionalNum(r.forecast_target),
            economic_target: optionalNum(r.economic_target),
            break_even_target: optionalNum(r.break_even_target),
            bonus_start_target: optionalNum(r.bonus_start_target),
            target_margin_rate: optionalNum(r.target_margin_rate),
            target_profit: optionalNum(r.target_profit),
            eligible_seller_count: optionalNum(r.eligible_seller_count),
            estimated_economics:
              r.estimated_economics && typeof r.estimated_economics === "object"
                ? r.estimated_economics
                : null,
            payout_multiplier: optionalNum(r.payout_multiplier),
            is_v5: false,
          });
        }
      } catch (e: any) {
        console.error("load branch plans error:", extractErrMsg(e));
        planMap = new Map();
      }

      let premMap = new Map<number, BranchPremium>();

      // v5 — основной read-контракт. Таблица добавляет экономические детали,
      // progress view — фактические net sales и плавный multiplier. Если v5 ещё
      // не опубликован, ниже остаётся безопасный legacy fallback.
      try {
        const { data: v5PlanRows, error: v5PlanErr } = await sb
          .from("payroll_branch_plans_v5")
          .select("*")
          .eq("month", monthStart);

        if (!v5PlanErr) {
          for (const r of (v5PlanRows ?? []) as any[]) {
            const bid = Number(r.branch_id ?? 0);
            if (!bid) continue;
            const previous = planMap.get(bid);
            const target =
              optionalNum(r.monthly_target ?? r.target ?? r.monthly_turnover_target) ??
              previous?.monthly_turnover_target ??
              0;
            const bonus =
              optionalNum(r.bonus_each_full ?? r.monthly_bonus_each) ??
              previous?.monthly_bonus_each ??
              0;
            const reasons = r.estimate_reasons ?? r.estimated_economics?.reasons;
            planMap.set(bid, {
              ...previous,
              monthly_turnover_target: target,
              monthly_bonus_each: bonus,
              mode: r.source_mode ?? r.mode ?? previous?.mode ?? "auto",
              auto_params: r.snapshot_inputs ?? r.auto_params ?? previous?.auto_params ?? null,
              updated_at: r.frozen_at ?? r.updated_at ?? previous?.updated_at,
              formula_version:
                r.formula_version ?? previous?.formula_version ?? "payroll-v5",
              status:
                r.status ?? (r.is_frozen || r.frozen_at ? "frozen" : "provisional"),
              locked_at: r.locked_at ?? r.frozen_at ?? previous?.locked_at ?? null,
              forecast_target: optionalNum(r.weighted_forecast ?? r.forecast_target),
              economic_target: optionalNum(r.economic_target ?? r.economic_floor),
              break_even_target: optionalNum(r.break_even ?? r.break_even_target),
              bonus_start_target: optionalNum(r.bonus_start_target ?? r.start_threshold),
              target_margin_rate: optionalNum(
                r.contribution_margin_used ?? r.target_margin_rate
              ),
              target_profit:
                optionalNum(r.target_profit) ??
                (optionalNum(r.contribution_margin_used) !== undefined &&
                optionalNum(r.fixed_cost_used) !== undefined
                  ? target * Number(r.contribution_margin_used) -
                    Number(r.fixed_cost_used) -
                    (optionalNum(r.eligible_seller_count) ?? 0) * bonus
                  : undefined),
              eligible_seller_count: optionalNum(
                r.eligible_seller_count ?? r.eligible_sellers
              ),
              estimated_economics:
                r.estimated_economics && typeof r.estimated_economics === "object"
                  ? r.estimated_economics
                  : null,
              payout_multiplier: optionalNum(r.payout_multiplier),
              projected_branch_payout: optionalNum(r.projected_branch_payout),
              is_estimated:
                typeof r.is_estimated === "boolean" ? r.is_estimated : undefined,
              estimate_reasons: Array.isArray(reasons) ? reasons.map(String) : [],
              is_v5: true,
              source_reason: r.source_reason ?? null,
            });
          }
        } else if (!/does not exist|schema cache/i.test(extractErrMsg(v5PlanErr))) {
          console.warn("load payroll_branch_plans_v5 failed:", extractErrMsg(v5PlanErr));
        }

        const { data: progressRows, error: progressErr } = await sb
          .from("v_payroll_plan_progress_admin_v5")
          .select("*")
          .eq("month", monthStart);

        if (!progressErr) {
          for (const r of (progressRows ?? []) as any[]) {
            const bid = Number(r.branch_id ?? 0);
            if (!bid) continue;
            const previous = planMap.get(bid);
            const target = optionalNum(r.target) ?? previous?.monthly_turnover_target ?? 0;
            const reasons = Array.isArray(r.estimate_reasons)
              ? r.estimate_reasons.map(String)
              : previous?.estimate_reasons ?? [];
            const isActive = r.is_active !== false;
            const reviewReasons = Array.isArray(r.review_reasons)
              ? r.review_reasons.map(String)
              : previous?.review_reasons ?? [];
            planMap.set(bid, {
              ...previous,
              monthly_turnover_target: target,
              monthly_bonus_each:
                optionalNum(r.bonus_each_full) ?? previous?.monthly_bonus_each ?? 0,
              mode: previous?.mode ?? "auto",
              formula_version:
                r.formula_version ?? previous?.formula_version ?? "payroll-v5",
              status:
                r.review_status ??
                (r.is_frozen ? "frozen" : previous?.status ?? "provisional"),
              locked_at: previous?.locked_at ?? null,
              economic_target:
                optionalNum(r.economic_floor) ?? previous?.economic_target,
              forecast_target:
                optionalNum(r.weighted_forecast) ?? previous?.forecast_target,
              break_even_target:
                optionalNum(r.break_even) ?? previous?.break_even_target,
              bonus_start_target:
                optionalNum(r.start_threshold) ?? previous?.bonus_start_target,
              target_margin_rate:
                optionalNum(r.contribution_margin_used) ?? previous?.target_margin_rate,
              target_profit:
                optionalNum(r.target_profit) ??
                (optionalNum(r.contribution_margin_used) !== undefined &&
                optionalNum(r.fixed_cost_used) !== undefined
                  ? target * Number(r.contribution_margin_used) -
                    Number(r.fixed_cost_used) -
                    (optionalNum(r.eligible_seller_count ?? r.eligible_sellers) ?? 0) *
                      (optionalNum(r.bonus_each_full) ?? 0)
                  : previous?.target_profit),
              eligible_seller_count:
                optionalNum(r.eligible_seller_count ?? r.eligible_sellers) ??
                previous?.eligible_seller_count,
              payout_multiplier: isActive
                ? optionalNum(r.payout_multiplier) ?? previous?.payout_multiplier
                : 0,
              projected_branch_payout:
                optionalNum(
                  r.projected_branch_payout_at_full_service ?? r.projected_branch_payout
                ) ??
                previous?.projected_branch_payout,
              is_estimated:
                typeof r.is_estimated === "boolean"
                  ? r.is_estimated
                  : previous?.is_estimated,
              estimate_reasons: reasons,
              estimated_economics: previous?.estimated_economics ?? null,
              is_v5: true,
              source_reason: r.source_reason ?? previous?.source_reason ?? null,
              review_required:
                typeof r.review_required === "boolean"
                  ? r.review_required
                  : previous?.review_required,
              review_status: r.review_status ?? previous?.review_status ?? null,
              review_reasons: reviewReasons,
              is_active: isActive,
              observed_month_count:
                optionalNum(r.observed_month_count) ?? previous?.observed_month_count,
              recent_observed_max:
                optionalNum(r.recent_observed_max) ?? previous?.recent_observed_max,
              target_to_recent_max_ratio:
                optionalNum(r.target_to_recent_max_ratio) ??
                previous?.target_to_recent_max_ratio,
              volatility_cv: optionalNum(r.volatility_cv) ?? previous?.volatility_cv,
              approval_mode: r.approval_mode ?? previous?.approval_mode ?? null,
              approval_note: r.approval_note ?? previous?.approval_note ?? null,
              approved_at: r.approved_at ?? previous?.approved_at ?? null,
            });

            premMap.set(bid, {
              turnover_sum: optionalNum(r.qualified_net_sales) ?? 0,
              net_sales: optionalNum(r.qualified_net_sales),
              plan_premium_each: isActive
                ? (optionalNum(r.bonus_each_full) ?? 0) *
                  (optionalNum(r.payout_multiplier) ?? 0)
                : 0,
              payout_multiplier: isActive ? optionalNum(r.payout_multiplier) : 0,
              achievement_ratio: optionalNum(r.achievement_ratio),
              is_provisional: !isActive || !Boolean(r.is_frozen),
            });
          }
        } else if (!/does not exist|schema cache/i.test(extractErrMsg(progressErr))) {
          console.warn("load v_payroll_plan_progress_admin_v5 failed:", extractErrMsg(progressErr));
        }

        // До фиксации владелец видит серверный preview ровно для текущего/
        // следующего месяца. Preview ничего не записывает и не попадает на POS.
        const needsPreview = branches.some((branch) => !planMap.get(branch.id)?.is_v5);
        if (
          needsPreview &&
          isV5PlanMonth &&
          (isCurrentPlanMonth || isNextPlanMonth)
        ) {
          const { data: previewRows, error: previewErr } = await sb
            .from("v_payroll_plan_preview_v5")
            .select("*")
            .eq("month", monthStart);
          if (previewErr) {
            if (!/does not exist|schema cache/i.test(extractErrMsg(previewErr))) {
              console.warn("load v_payroll_plan_preview_v5 failed:", extractErrMsg(previewErr));
            }
          } else {
            for (const r of (previewRows ?? []) as any[]) {
              const bid = Number(r.branch_id ?? 0);
              const existing = planMap.get(bid);
              if (!bid || r.already_frozen || (existing?.is_v5 && planIsLocked(existing))) continue;
              const target = optionalNum(r.monthly_target) ?? 0;
              const bonus = optionalNum(r.bonus_each_full) ?? 0;
              const margin = optionalNum(r.contribution_margin_used);
              const fixed = optionalNum(r.fixed_cost_used);
              const sellerCount = optionalNum(r.eligible_seller_count) ?? 0;
              planMap.set(bid, {
                monthly_turnover_target: target,
                monthly_bonus_each: bonus,
                mode: r.source_mode ?? "auto",
                auto_params: r.snapshot_inputs ?? null,
                formula_version: r.formula_version ?? "v5.0-2026-09",
                status: "preview",
                locked_at: null,
                forecast_target: optionalNum(r.weighted_forecast),
                economic_target: optionalNum(r.economic_floor),
                break_even_target: optionalNum(r.break_even),
                bonus_start_target: optionalNum(r.start_threshold),
                target_margin_rate: margin,
                target_profit:
                  margin !== undefined && fixed !== undefined
                    ? target * margin - fixed - sellerCount * bonus
                    : undefined,
                eligible_seller_count: sellerCount,
                payout_multiplier: 0,
                projected_branch_payout: 0,
                is_estimated: r.is_estimated === true,
                estimate_reasons: Array.isArray(r.estimate_reasons)
                  ? r.estimate_reasons.map(String)
                  : [],
                is_v5: true,
              });
            }
          }
        }

        const { data: qualifiedRows, error: qualifiedErr } = await sb
          .from("v_payroll_qualified_sales_monthly_v5")
          .select("*")
          .eq("month", monthStart);
        if (!qualifiedErr) {
          for (const r of (qualifiedRows ?? []) as any[]) {
            const bid = Number(r.branch_id ?? 0);
            if (!bid) continue;
            const previous = premMap.get(bid) ?? {
              turnover_sum: 0,
              plan_premium_each: 0,
            };
            const net = optionalNum(
              r.qualified_net_sales ?? r.net_sales ?? r.turnover_sum
            );
            premMap.set(bid, {
              ...previous,
              turnover_sum: net ?? previous.turnover_sum,
              net_sales: net ?? previous.net_sales,
              gross_sales:
                optionalNum(
                  r.qualified_gross_sales ?? r.gross_sales ?? r.positive_sales
                ) ?? previous.gross_sales,
              refunds_sum:
                optionalNum(
                  r.refunds_sum ?? r.refund_sum ?? r.refunds ?? r.refund_amount
                ) ?? previous.refunds_sum,
            });
          }
        }
      } catch (e: any) {
        console.warn("load payroll v5 compatibility data failed:", extractErrMsg(e));
      }

      try {
        const { data: premRows, error: premErr } = await sb
          .from("v_payroll_plan_premium_monthly_branch")
          .select("*")
          .eq("month", monthStart);

        if (premErr) throw premErr;

        for (const r of (premRows ?? []) as any[]) {
          const bid = Number(r.branch_id ?? 0);
          if (!bid) continue;
          if (premMap.has(bid)) continue;
          const turnoverSum = optionalNum(r.turnover_sum ?? r.turnover) ?? 0;
          premMap.set(bid, {
            turnover_sum: turnoverSum,
            net_sales: optionalNum(r.net_sales),
            gross_sales: optionalNum(r.gross_sales ?? r.positive_sales),
            refunds_sum: optionalNum(
              r.refunds_sum ?? r.refund_sum ?? r.refunds ?? r.refund_amount
            ),
            plan_premium_each:
              optionalNum(
                r.plan_premium_each ??
                  r.current_bonus_each ??
                  r.provisional_bonus_each
              ) ?? 0,
            payout_multiplier: optionalNum(r.payout_multiplier),
            achievement_ratio: optionalNum(r.achievement_ratio),
            is_provisional:
              typeof r.is_provisional === "boolean" ? r.is_provisional : undefined,
          });
        }
      } catch (e: any) {
        console.error("load branch premium error:", extractErrMsg(e));
      }

      // ИСТОРИЯ: берём именно дневную выручку филиала
      let histOk = false;
      let histMap = new Map<number, number[]>();
      try {
        const histStart = shiftMonthStart(monthStart, -HISTORY_MONTHS_FOR_DISPLAY);
        const histEnd = monthStart;

        let days: any[] = [];
        const { data: v5Days, error: v5DaysErr } = await sb
          .from("v_payroll_qualified_sales_daily_v5")
          .select("*")
          .gte("day", histStart)
          .lt("day", histEnd);

        if (!v5DaysErr) {
          days = v5Days ?? [];
        } else {
          const { data: legacyDays, error: legacyDaysErr } = await sb
            .from("v_payroll_branch_turnover_daily")
            .select("branch_id,day,turnover")
            .gte("day", histStart)
            .lt("day", histEnd);
          if (legacyDaysErr) throw legacyDaysErr;
          days = legacyDays ?? [];
        }

        const sumByBranchMonth = new Map<string, number>();
        const branchIdsSeen = new Set<number>();

        for (const r of (days ?? []) as any[]) {
          const bid = Number(r.branch_id ?? 0);
          if (!bid) continue;
          branchIdsSeen.add(bid);

          const dayStr = String(r.day ?? "").slice(0, 10);
          const mk = dayStr.length >= 7 ? dayStr.slice(0, 7) : "";
          if (!mk) continue;

          const t = num(r.qualified_net_sales ?? r.net_sales ?? r.turnover);
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
  }, [
    isMonthlyPlanMode,
    isFuturePlanMonth,
    isCurrentPlanMonth,
    isNextPlanMonth,
    isV5PlanMonth,
    monthStart,
    month,
    branches,
    planRefreshTick,
  ]);

  async function saveBranchPlan(branchId: number, patch: Partial<BranchPlan>) {
    const current = getBranchPlanEffective(branchId);

    const next: BranchPlan = {
      ...current,
      ...patch,
    };

    const payloadBase: any = {
      branch_id: branchId,
      month: monthStart,
      monthly_turnover_target: Math.max(0, Math.trunc(next.monthly_turnover_target ?? 0)),
      monthly_bonus_each: Math.max(0, Math.trunc(next.monthly_bonus_each ?? 0)),
      mode: next.mode ?? "manual",
      auto_params: next.auto_params ?? {},
      updated_at: new Date().toISOString(),
    };

    if (isV5PlanMonth || current.is_v5) {
      throw new Error(
        "План v5 фиксируется одной операцией. Используйте «Настроить вручную» и подтвердите цель, бонус и причину вместе."
      );
    }
    if (planIsReadOnly(current)) {
      throw new Error("Текущий, прошлый или зафиксированный план доступен только для чтения.");
    }
    await upsertBranchPlanWithFallback(payloadBase);

    setBranchPlans((m) => {
      const nm = new Map(m);
      nm.set(branchId, next);
      return nm;
    });
    setPlanRefreshTick((tick) => tick + 1);
  }

  function openManualPlanDialog(branchId: number, branchName: string) {
    const current = getBranchPlanEffective(branchId);
    setPlanDialog({
      kind: "manual",
      branchId,
      branchName,
      target: String(Math.max(0, Math.trunc(current.monthly_turnover_target))),
      bonus: String(Math.max(0, Math.trunc(current.monthly_bonus_each))),
      reason: "",
    });
  }

  function openPlanReviewDialog(branchId: number, branchName: string) {
    const current = getBranchPlanEffective(branchId);
    const target = Math.max(0, Math.trunc(current.monthly_turnover_target));
    const bonus = Math.max(0, Math.trunc(current.monthly_bonus_each));
    setPlanDialog({
      kind: "approve",
      branchId,
      branchName,
      target: String(target),
      bonus: String(bonus),
      originalTarget: target,
      originalBonus: bonus,
      allowAdjust: isCurrentPlanMonth || isNextPlanMonth,
      reason: "",
      reviewReasons: current.review_reasons ?? [],
    });
  }

  // v5: одна серверная операция одновременно фиксирует формулу, цель, бонус
  // и roster продавцов. Повторный вызов возвращает тот же неизменяемый план.
  async function applyAutoPlan(branchId: number) {
    setPlanBusyBranchId(branchId);
    try {
      const current = getBranchPlanEffective(branchId);
      if (!isNextPlanMonth || planIsLocked(current)) {
        throw new Error(
          "Зафиксировать можно только следующий незаблокированный месяц."
        );
      }

      const { error: freezeErr } = await sb.rpc("fn_payroll_freeze_plan_v5", {
        p_branch_id: branchId,
        p_month: monthStart,
        p_reason: "Зафиксировано владельцем на странице Payroll",
      });
      if (freezeErr) throw freezeErr;

      await mutate();
      setPlanRefreshTick((tick) => tick + 1);
      setPlanDialog(null);
      toast.success("План рассчитан и зафиксирован");
    } catch (e: any) {
      toast.error(`Не удалось зафиксировать план: ${extractErrMsg(e)}`);
    } finally {
      setPlanBusyBranchId(null);
    }
  }

  async function applyManualPlan() {
    if (!planDialog || planDialog.kind !== "manual") return;
    const current = getBranchPlanEffective(planDialog.branchId);
    const target = Math.trunc(Number(planDialog.target));
    const bonus = Math.trunc(Number(planDialog.bonus));
    const reason = planDialog.reason.trim();
    if (!Number.isFinite(target) || target <= 0) {
      toast.error("Укажите положительную цель продаж");
      return;
    }
    if (!Number.isFinite(bonus) || bonus < 0) {
      toast.error("Бонус не может быть отрицательным");
      return;
    }
    if (reason.length < 12) {
      toast.error("Укажите понятную причину не короче 12 символов");
      return;
    }
    if (!isV5PlanMonth || (!isCurrentPlanMonth && !isNextPlanMonth)) {
      toast.error("Изменять план можно только для текущего или следующего месяца");
      return;
    }

    const shouldCorrectPublishedPlan = isCurrentPlanMonth || planIsLocked(current);
    setPlanBusyBranchId(planDialog.branchId);
    try {
      const { error } = shouldCorrectPublishedPlan
        ? await sb.rpc("fn_payroll_correct_effective_plan_v5", {
            p_branch_id: planDialog.branchId,
            p_month: monthStart,
            p_effective_target: target,
            p_effective_bonus_each: bonus,
            p_correction_note: reason,
          })
        : await sb.rpc("fn_payroll_override_plan_v5", {
            p_branch_id: planDialog.branchId,
            p_month: monthStart,
            p_monthly_turnover_target: target,
            p_monthly_bonus_each: bonus,
            p_reason: reason,
          });
      if (error) throw error;
      await mutate();
      setPlanRefreshTick((tick) => tick + 1);
      setPlanDialog(null);
      toast.success(shouldCorrectPublishedPlan ? "План скорректирован" : "План установлен");
    } catch (e: any) {
      toast.error(`Не удалось зафиксировать ручной план: ${extractErrMsg(e)}`);
    } finally {
      setPlanBusyBranchId(null);
    }
  }

  async function approveReviewedPlan() {
    if (!planDialog || planDialog.kind !== "approve") return;
    const target = Math.trunc(Number(planDialog.target));
    const bonus = Math.trunc(Number(planDialog.bonus));
    const reason = planDialog.reason.trim();
    if (!Number.isFinite(target) || target <= 0) {
      toast.error("Укажите положительную цель чистых продаж");
      return;
    }
    if (!Number.isFinite(bonus) || bonus < 0) {
      toast.error("Бонус не может быть отрицательным");
      return;
    }
    if (reason.length < 12) {
      toast.error("Напишите причину решения не короче 12 символов");
      return;
    }
    const changed =
      target !== planDialog.originalTarget || bonus !== planDialog.originalBonus;
    if (changed && !planDialog.allowAdjust) {
      toast.error("В завершённом месяце можно принять только исходный замороженный план");
      return;
    }

    setPlanBusyBranchId(planDialog.branchId);
    try {
      const unchanged = !changed;
      const { error } = unchanged
        ? await sb.rpc("fn_payroll_approve_plan_v5", {
            p_branch_id: planDialog.branchId,
            p_month: monthStart,
            p_approval_note: reason,
          })
        : await sb.rpc("fn_payroll_correct_effective_plan_v5", {
            p_branch_id: planDialog.branchId,
            p_month: monthStart,
            p_effective_target: target,
            p_effective_bonus_each: bonus,
            p_correction_note: reason,
          });
      if (error) throw error;

      await mutate();
      setPlanRefreshTick((tick) => tick + 1);
      setPlanDialog(null);
      toast.success(
        unchanged
          ? "План проверен и опубликован"
          : "Скорректированный план проверен и опубликован"
      );
    } catch (e: any) {
      toast.error(`Не удалось опубликовать план: ${extractErrMsg(e)}`);
    } finally {
      setPlanBusyBranchId(null);
    }
  }

  return (
    <div className="relative min-h-[100dvh] bg-transparent text-slate-50">
      {/* фоновые свечения */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 left-1/2 h-72 w-[900px] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[80px]" />
        <div className="absolute top-64 left-10 h-64 w-64 rounded-full bg-sky-500/10 blur-[70px]" />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-emerald-500/10 blur-[80px]" />
      </div>

      {planDialog ? (
        <div
          className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="payroll-plan-dialog-title"
        >
          <div className="w-full max-w-lg rounded-3xl bg-white p-5 text-slate-900 shadow-2xl ring-1 ring-cyan-200/70">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div id="payroll-plan-dialog-title" className="text-lg font-bold">
                  {planDialog.kind === "auto"
                    ? "Зафиксировать расчёт"
                    : planDialog.kind === "approve"
                    ? "Проверить и опубликовать план"
                    : "Изменить план"}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {planDialog.branchName} · {formatMonthRu(month)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPlanDialog(null)}
                disabled={planBusyBranchId === planDialog.branchId}
                className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                aria-label="Закрыть"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {planDialog.kind === "auto" ? (
              <div className="mt-5">
                <div className="rounded-2xl bg-cyan-50 p-4 text-sm text-cyan-950 ring-1 ring-cyan-200">
                  Будут навсегда сохранены показанный серверный расчёт и список действующих
                  продавцов. После фиксации план нельзя пересчитать задним числом.
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <GhostBtn
                    type="button"
                    onClick={() => setPlanDialog(null)}
                    disabled={planBusyBranchId === planDialog.branchId}
                  >
                    Отмена
                  </GhostBtn>
                  <PrimaryBtn
                    type="button"
                    onClick={() => applyAutoPlan(planDialog.branchId)}
                    disabled={planBusyBranchId === planDialog.branchId}
                  >
                    Зафиксировать
                  </PrimaryBtn>
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                {planDialog.kind === "approve" ? (
                  <div className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-950 ring-1 ring-rose-200">
                    <div className="font-semibold">
                      Автоматическая публикация остановлена защитной проверкой
                    </div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-rose-800">
                      {planDialog.reviewReasons.map((reason) => (
                        <li key={reason}>{payrollReviewReasonLabel(reason)}</li>
                      ))}
                    </ul>
                    <div className="mt-2 text-xs text-rose-800">
                      До вашего решения этот план не виден кассе, не начисляет премию и блокирует
                      окончательное закрытие месяца.
                    </div>
                  </div>
                ) : null}
                <div>
                  <label className="space-y-1.5 text-sm font-medium text-slate-700">
                    <span>План продаж, сом</span>
                    <input
                      inputMode="numeric"
                      readOnly={
                        planDialog.kind === "approve" && !planDialog.allowAdjust
                      }
                      value={planDialog.target}
                      onChange={(event) =>
                        setPlanDialog({
                          ...planDialog,
                          target: event.target.value.replace(/[^\d]/g, ""),
                        })
                      }
                      className={cx(
                        "h-11 w-full rounded-xl px-3 text-slate-900 ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-cyan-400",
                        planDialog.kind === "approve" && !planDialog.allowAdjust
                          ? "bg-slate-100 text-slate-500"
                          : "bg-white"
                      )}
                    />
                  </label>
                </div>
                {planDialog.kind === "approve" && !planDialog.allowAdjust ? (
                  <div className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
                    Месяц уже завершён: можно только принять исходные замороженные условия.
                    Менять цель или бонус задним числом нельзя.
                  </div>
                ) : null}
                <label className="block space-y-1.5 text-sm font-medium text-slate-700">
                  <span>
                    {planDialog.kind === "approve"
                      ? "Основание для публикации"
                      : "Причина изменения"}
                  </span>
                  <textarea
                    value={planDialog.reason}
                    onChange={(event) =>
                      setPlanDialog({ ...planDialog, reason: event.target.value })
                    }
                    rows={3}
                    placeholder={
                      planDialog.kind === "approve"
                        ? "Например: цель подтверждена руководителем филиала"
                        : "Например: скорректировали план после изменения графика"
                    }
                    className="w-full resize-none rounded-xl bg-white px-3 py-2.5 text-slate-900 ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-cyan-400"
                  />
                </label>
                <div className="rounded-2xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
                  База отклонит цель ниже экономического минимума или слишком дорогой бонус.
                  Принятый план и причина попадут в неизменяемый аудит.
                </div>
                <div className="flex justify-end gap-2">
                  <GhostBtn
                    type="button"
                    onClick={() => setPlanDialog(null)}
                    disabled={planBusyBranchId === planDialog.branchId}
                  >
                    Отмена
                  </GhostBtn>
                  <PrimaryBtn
                    type="button"
                    onClick={
                      planDialog.kind === "approve"
                        ? approveReviewedPlan
                        : applyManualPlan
                    }
                    disabled={planBusyBranchId === planDialog.branchId}
                  >
                    {planDialog.kind === "approve"
                      ? "Проверить и опубликовать"
                      : "Сохранить план"}
                  </PrimaryBtn>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className="relative">
        {errorText ? (
          <div className="mb-4 rounded-2xl p-4 bg-white ring-1 ring-rose-200 shadow-[0_8px_30px_rgba(15,23,42,0.45)] text-slate-900">
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

        {/* Header (бренд-стандарт) */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
              <Wallet className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold tracking-tight text-slate-50">
                Зарплаты и посещаемость
              </div>
              <div className="mt-0.5 text-[12px] text-cyan-300/50">
                Выплаты по филиалам · {periodLabel}
              </div>
            </div>
          </div>
        </div>

        <div className="mb-4">
          <HeaderCard>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              {/* Период */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Период</span>
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
                <span className="ml-1 text-[12px] text-slate-500">Неделя</span>
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
                {(weekLoading || monthLoading) && (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-400" />
                )}
              </div>

              <div className="hidden h-6 w-px bg-slate-200 lg:block" />

              {/* Удержания / мес */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Удержания / мес</span>
                <label className="flex items-center gap-1.5 text-sm text-slate-700">
                  <span className="text-slate-500">Подоходный</span>
                  <NumberCell
                    value={cfgLocal?.income_tax_monthly ?? 0}
                    onCommit={async (v) => {
                      const vv = Math.max(0, Math.trunc(v));
                      setCfgLocal((c) => (c ? ({ ...c, income_tax_monthly: vv } as any) : c));
                      await updateConfig({ income_tax_monthly: vv } as any);
                      await mutate();
                    }}
                    className="w-[96px]"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-sm text-slate-700">
                  <span className="text-slate-500">Соцфонд</span>
                  <NumberCell
                    value={cfgLocal?.social_fund_monthly ?? 0}
                    onCommit={async (v) => {
                      const vv = Math.max(0, Math.trunc(v));
                      setCfgLocal((c) => (c ? ({ ...c, social_fund_monthly: vv } as any) : c));
                      await updateConfig({ social_fund_monthly: vv } as any);
                      await mutate();
                    }}
                    className="w-[96px]"
                  />
                </label>
              </div>

              <div className="ml-auto">
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
        <div className="mb-5 overflow-x-auto">
        <div className="flex gap-1 rounded-2xl bg-white p-1 ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] w-fit">
          <button
            onClick={() => setTab("payroll")}
            className={cx(
              "rounded-xl px-5 py-2 text-sm font-semibold transition",
              tab === "payroll"
                ? "bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.25)]"
                : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
            )}
          >
            Зарплаты
          </button>
          <button
            onClick={() => setTab("penalties")}
            className={cx(
              "rounded-xl px-5 py-2 text-sm font-semibold transition",
              tab === "penalties"
                ? "bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.25)]"
                : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
            )}
          >
            Штрафы и графики
          </button>
          <button
            onClick={() => setTab("disciplines")}
            className={cx(
              "rounded-xl px-5 py-2 text-sm font-semibold transition",
              tab === "disciplines"
                ? "bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.25)]"
                : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
            )}
          >
            Дисциплинарные взыскания
          </button>
          <button
            onClick={() => setTab("management")}
            className={cx(
              "min-h-11 whitespace-nowrap rounded-xl px-5 py-2 text-sm font-semibold transition",
              tab === "management"
                ? "bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.25)]"
                : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
            )}
          >
            Управляющая
          </button>
        </div>
        </div>

        {/* ===== Вкладка «Штрафы и графики» ===== */}
        {tab === "penalties" && (
          <PenaltiesTab onChanged={() => setPayrollRefreshTick((t) => t + 1)} />
        )}

        {/* ===== Вкладка «Дисциплинарные взыскания» ===== */}
        {tab === "disciplines" && <DisciplinesTab />}
        {tab === "management" && <ManagementTab month={month} branches={branches} employees={employees.map(employee => ({
          id: employee.id, hours: employee.hoursWorked || 0,
          shiftNet: getMonthNet(employee) - (employee.managementTotal || 0),
        }))} />}

        {/* ===== Вкладка «Зарплаты» (всё что было ниже) ===== */}
        {tab === "payroll" && (
        <>
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
            const isPendingReview =
              effectivePlan?.review_required === true && effectivePlan?.is_active === false;
            const canAdjustPlan =
              isMonthlyPlanMode &&
              isV5PlanMonth &&
              (isCurrentPlanMonth || isNextPlanMonth);

            const prem = branchPremiumMap.get(b.id);
            const legacyTurnover = prem?.turnover_sum ?? 0;
            const netSales = prem?.net_sales ?? legacyTurnover;
            const planTarget = effectivePlan?.monthly_turnover_target ?? 0;
            const rawAchievement = prem?.achievement_ratio;
            const pct =
              rawAchievement !== undefined
                ? Math.round((rawAchievement > 10 ? rawAchievement : rawAchievement * 100) * 10) /
                  10
                : planTarget > 0
                ? Math.round((netSales / planTarget) * 1000) / 10
                : 0;
            const progressBarPct = Math.max(0, Math.min(100, pct));

            return (
              <Card key={b.id} className="mt-6">
                {/* Заголовок филиала */}
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                      ID {b.id}
                    </span>
                    <span className="text-xl font-bold tracking-tight text-slate-900">{b.name}</span>
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
                    <button
                      onClick={() => setConfirmDel({ kind: "branch", id: b.id, name: b.name })}
                      title={`Удалить филиал «${b.name}»`}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-300 ring-1 ring-slate-200 transition hover:bg-rose-50 hover:text-rose-600 hover:ring-rose-200"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Настройки филиала: PIN + доступ + план (сворачиваемо) */}
                <details className="group mb-4 overflow-hidden rounded-2xl bg-slate-50/80 ring-1 ring-slate-200">
                  <summary className="flex cursor-pointer list-none select-none items-center gap-2 px-4 py-2.5 text-[12px] font-semibold text-slate-600 [&::-webkit-details-marker]:hidden">
                    <Settings2 className="h-3.5 w-3.5 text-slate-400" />
                    Настройки филиала
                    <span className="font-normal text-slate-400">
                      {isMonthlyPlanMode && planTarget > 0
                        ? ` · план ${fmt(planTarget)} сом · выполнено ${fmtPct(pct)}`
                        : " · план не задан"}
                    </span>
                    <ChevronDown className="ml-auto h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="flex flex-col border-t border-slate-200">
                  <details className="order-2 border-t border-slate-200">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[11px] font-medium text-slate-500 [&::-webkit-details-marker]:hidden">
                    Дополнительно: PIN и доступ
                    <ChevronDown className="ml-auto h-3.5 w-3.5 text-slate-400" />
                  </summary>
                  <div className="space-y-4 px-4 pb-4">
                  {/* PIN филиала (действует и на кассу, и на touch-экран) */}
                  <div>
                    <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      <KeyRound className="h-3 w-3" />
                      PIN филиала
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={pinInputs[b.id] ?? ""}
                      onChange={(e) => setPinInputs((p) => ({ ...p, [b.id]: e.target.value.replace(/\D/g, "") }))}
                      inputMode="numeric"
                      maxLength={8}
                      placeholder="не задан"
                      className="h-7 w-24 rounded-lg ring-1 ring-sky-200 bg-white px-2.5 text-[12px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
                    />
                    <button
                      className="h-7 rounded-lg px-2.5 text-[11px] font-medium text-slate-700 bg-white ring-1 ring-slate-200 hover:bg-slate-50"
                      onClick={() => setPinInputs((p) => ({ ...p, [b.id]: genPin4() }))}
                    >
                      Генерировать
                    </button>
                    {(pinInputs[b.id] ?? "") && (
                      <button
                        className="h-7 rounded-lg px-2.5 text-[11px] font-semibold text-white bg-cyan-500 hover:bg-cyan-400 transition disabled:opacity-50"
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
                    {(branchPins[b.id] ?? "") && (pinInputs[b.id] ?? "") !== (branchPins[b.id] ?? "") && (
                      <span className="ml-auto text-[11px] text-slate-400">
                        сохранён: <span className="font-mono font-semibold text-slate-600">{branchPins[b.id]}</span>
                      </span>
                    )}
                    </div>
                  </div>

                  {/* Доступ сотрудников в смену */}
                  <div>
                    <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      <User2 className="h-3 w-3" />
                      Доступ в смену
                    </div>
                    <div className="flex flex-wrap items-center gap-2">

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
                                className="h-7 w-24 rounded-lg ring-1 ring-sky-200 bg-white px-2 text-[11px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/60"
                              />
                              <input
                                value={form.pin}
                                onChange={(ev) => setCredForm((f) => ({ ...f, [emp.id]: { ...form, pin: ev.target.value.replace(/\D/g, "").slice(0, 4) } }))}
                                placeholder="PIN"
                                inputMode="numeric"
                                maxLength={4}
                                className="h-7 w-14 rounded-lg ring-1 ring-sky-200 bg-white px-2 text-[11px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/60"
                              />
                              <button
                                className="h-7 rounded-lg px-1.5 text-[10px] text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                                onClick={() => setCredForm((f) => ({ ...f, [emp.id]: { ...form, pin: genPin4() } }))}
                              >PIN</button>
                              <button
                                className="h-7 inline-flex items-center gap-0.5 rounded-lg bg-cyan-500 px-2 text-[11px] font-semibold text-white hover:bg-cyan-400 transition"
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
                </div>
                </details>

                {/* Главные настройки плана филиала */}
                {isMonthlyPlanMode ? (
                  <div className="order-1 px-4 py-4">
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-stretch">
                      <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          План месяца
                        </div>
                        <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                          {planTarget > 0 ? `${fmt(planTarget)} сом` : "Не задан"}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-cyan-50 px-4 py-3 ring-1 ring-cyan-200">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-cyan-700/70">
                          Выполнение
                        </div>
                        <div className="mt-1 text-2xl font-bold tabular-nums text-cyan-800">
                          {planTarget > 0 ? fmtPct(pct) : "—"}
                        </div>
                      </div>

                      <div className="flex items-center sm:pl-1">
                        <GhostBtn
                          disabled={!canAdjustPlan || planBusyBranchId === b.id}
                          onClick={() =>
                            isPendingReview
                              ? openPlanReviewDialog(b.id, b.name)
                              : openManualPlanDialog(b.id, b.name)
                          }
                          title={
                            canAdjustPlan
                              ? "Изменить план текущего или следующего месяца"
                              : "Изменение доступно только для текущего или следующего месяца"
                          }
                        >
                          {planBusyBranchId === b.id ? "Сохраняю…" : "Изменить план"}
                        </GhostBtn>
                      </div>
                    </div>

                    {planTarget > 0 ? (
                      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                        <div
                          className={cx(
                            "h-full rounded-full transition-all",
                            pct >= 100 ? "bg-emerald-500" : "bg-cyan-500"
                          )}
                          style={{ width: `${progressBarPct}%` }}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
                </div>
                </details>
                {/* Таблица сотрудников */}
                <div className="overflow-x-auto">
                  <table className="w-full table-auto border-separate border-spacing-y-2">
                    <colgroup>
                      <col />
                      <col className="w-[116px]" />
                      <col className="w-[96px]" />
                      <col className="w-[96px]" />
                      <col className="w-[120px]" />
                      <col className="w-[104px]" />
                    </colgroup>

                    {/* Шапка убрана — колонки понятны без подписей */}
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
                                className="w-full max-w-[240px]"
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
                                className={cx(
                                  selectCls,
                                  "h-9 w-[112px]",
                                  roleUi === "promoter"
                                    ? "bg-emerald-50 ring-emerald-200 text-emerald-700 font-semibold"
                                    : ""
                                )}
                              >
                                <option value="seller">Продавец</option>
                                <option value="promoter">Промоутер</option>
                                <option value="master">Мастер</option>
                              </select>
                            </td>

                            <td className={cx(rowTdBase, "text-right")}>
                              {roleUi === "master" ? (
                                <NumberCell
                                  value={cfgLocal?.master_piece_rate ?? 150}
                                  onCommit={async (v) => {
                                    const vv = Math.max(0, Math.trunc(v));
                                    setCfgLocal((c) => (c ? ({ ...c, master_piece_rate: vv } as any) : c));
                                    await updateConfig({ master_piece_rate: vv } as any);
                                    await mutate();
                                  }}
                                  className="w-[72px]"
                                  step={10}
                                />
                              ) : (
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
                                  className="w-[72px]"
                                  step={5}
                                />
                              )}
                            </td>

                            {/* Бонус: продавец — % оборота; промоутер — сом/заказ; мастер — без бонуса */}
                            <td className={cx(rowTdBase, "text-right")}>
                              {roleUi === "master" ? null : roleUi === "promoter" ? (
                                <NumberCell
                                  value={e.bonusPerOrder ?? 0}
                                  onCommit={async (v) => {
                                    await persistProfileChange({
                                      employeeId: e.id,
                                      branchId: b.id,
                                      bonusPerOrder: v,
                                    });
                                    await mutate();
                                  }}
                                  className="w-[72px]"
                                  step={10}
                                />
                              ) : (
                                <NumberCell
                                  value={e.bonusPercent ?? 0}
                                  onCommit={async (v) => {
                                    await updateEmployee(e.id, { bonusPercent: v, hasBonus: v > 0 });
                                    await persistProfileChange({
                                      employeeId: e.id,
                                      branchId: b.id,
                                      hourlyRate: e.hourlyRate ?? 0,
                                      hasBonus: v > 0,
                                      bonusPercent: v,
                                    });
                                    await mutate();
                                  }}
                                  className="w-[72px]"
                                  step={1}
                                />
                              )}
                            </td>

                            <td className={cx(rowTdBase, "text-right")}>
                              {netPeriod > 0 ? (
                                <span className="text-[15px] font-bold tabular-nums text-cyan-700">
                                  {fmt(netPeriod)}
                                </span>
                              ) : (
                                <span
                                  className="inline-flex flex-col items-end leading-none"
                                  title="Нет смен за период"
                                >
                                  <span className="text-base text-slate-300">—</span>
                                  <span className="mt-0.5 text-[10px] text-slate-400">нет смен</span>
                                </span>
                              )}
                            </td>

                            <td className={cx(rowTdLast, "text-right")}>
                              <div className="flex justify-end items-center gap-1.5">
                                <button
                                  title="Детали по дням"
                                  onClick={() => openDaily({ id: e.id, fullName: e.fullName, branchId: b.id, netPeriod, netMonth, role: e.role, managementTotal: e.managementTotal || 0 })}
                                  className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[12px] font-medium text-slate-700 bg-white ring-1 ring-slate-200 hover:bg-slate-50 transition"
                                >
                                  <BarChart2 className="h-3.5 w-3.5" />
                                  <span>Детали</span>
                                </button>
                                <button
                                  title={`Удалить ${e.fullName}`}
                                  onClick={() => setConfirmDel({ kind: "employee", id: e.id, name: e.fullName })}
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

                <div className="mt-3 flex items-center justify-between rounded-2xl bg-cyan-50/70 px-4 py-3 ring-1 ring-cyan-100">
                  <span className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                    Итого по филиалу
                  </span>
                  <span className="text-lg font-bold tabular-nums text-cyan-700">
                    {fmt((byBranch.get(b.id) ?? []).reduce((s, e: any) => s + getNet(e), 0))}{" "}
                    <span className="text-sm font-semibold text-slate-400">сом</span>
                  </span>
                </div>
              </Card>
            );
          })
        )}

        {/* Подтверждение удаления (защита от случайного клика) */}
        {confirmDel && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
            onClick={() => !delBusy && setConfirmDel(null)}
          >
            <div
              className="w-full max-w-md rounded-3xl bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.4)] ring-1 ring-sky-100"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-5 flex items-start gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-rose-500 shadow-[0_4px_16px_rgba(244,63,94,0.3)]">
                  <X className="h-5 w-5 text-white" />
                </div>
                <div>
                  <div className="text-lg font-bold tracking-tight text-slate-900">
                    {confirmDel.kind === "branch" ? "Удалить филиал?" : "Удалить сотрудника?"}
                  </div>
                  <div className="text-[12px] text-slate-500">
                    «{confirmDel.name}» — действие необратимо
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => setConfirmDel(null)}
                  disabled={delBusy}
                >
                  Отмена
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(244,63,94,0.28)] transition hover:bg-rose-400 disabled:opacity-50"
                  disabled={delBusy}
                  onClick={async () => {
                    setDelBusy(true);
                    try {
                      if (confirmDel.kind === "branch") await removeBranch(confirmDel.id);
                      else await removeEmployee(confirmDel.id);
                      await mutate();
                      setConfirmDel(null);
                    } catch (err: any) {
                      alert(`Не удалось удалить: ${err?.message || err?.error_description || String(err)}`);
                    } finally {
                      setDelBusy(false);
                    }
                  }}
                >
                  {delBusy ? "Удаляю…" : "Удалить"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Модалка «Детали по дням» */}
        {dailyMeta && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onKeyDown={(e) => e.key === "Escape" && closeDaily()}
            tabIndex={-1}
          >
            <div className="max-h-[90vh] w-full max-w-[980px] overflow-hidden rounded-3xl bg-white/95 ring-1 ring-sky-200 shadow-[0_30px_120px_rgba(0,0,0,0.65)] backdrop-blur-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 bg-slate-50/80">
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
                  <button
                    onClick={() => void copyDailyImage()}
                    disabled={!hasDailyRows}
                    title="Скопировать картинку — потом вставьте в чат (Ctrl+V)"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500 px-3.5 py-2 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-300/70 disabled:opacity-50"
                  >
                    <Copy className="h-4 w-4" />
                    Копировать
                  </button>
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
                  dailyMeta?.role === "master" ? (
                  <table className="min-w-full table-fixed text-sm">
                    <colgroup>
                      <col className="w-[110px]" />
                      <col className="w-[150px]" />
                      <col className="w-[130px]" />
                      <col className="w-[130px]" />
                      <col className="w-[120px]" />
                    </colgroup>

                    <thead className="sticky top-0 z-10">
                      <tr className="bg-slate-100 text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="rounded-l-lg px-3 py-2 text-left">День</th>
                        <th className="px-3 py-2 text-left">Смена</th>
                        <th className="px-3 py-2 text-right">Собрал</th>
                        <th className="px-3 py-2 text-right">В системе</th>
                        <th className="rounded-r-lg px-3 py-2 text-right">К оплате</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">
                      {dailyRows.map((r: any, idx: number) => {
                        const pairs = r.pairs_made == null ? null : Number(r.pairs_made);
                        const sys = r.system_count == null ? null : Number(r.system_count);
                        const diverges = pairs != null && sys != null && pairs !== sys;
                        return (
                        <tr key={`${r.day}:${r.branch_id}`} className={idx % 2 === 1 ? "bg-slate-50/70" : "bg-white"}>
                          <td className="px-3 py-2 text-slate-800">{r.day}
                            {Number(r.branch_id) !== dailyMeta.branchId && <div className="mt-0.5 text-xs text-slate-500">{branches.find(branch => branch.id === Number(r.branch_id))?.name || `Филиал ${r.branch_id}`}</div>}
                          </td>
                          <td className={cx("px-3 py-2 tabular-nums", r.shift_in ? "text-slate-700" : "text-slate-300")}>
                            {r.shift_in ? `${r.shift_in} – ${r.shift_out ?? "…"}` : "—"}
                          </td>
                          <td className={cx("px-3 py-2 text-right font-semibold tabular-nums", diverges ? "text-amber-600" : "text-slate-800")}>
                            {pairs == null ? "—" : pairs}
                          </td>
                          <td className={cx("px-3 py-2 text-right tabular-nums", diverges ? "text-amber-600" : "text-slate-400")} title="Заказов с линзами в системе за этот день (партия 13:00→13:00)">
                            {sys == null ? "—" : sys}
                          </td>
                          <td className={cx("px-3 py-2 text-right font-semibold tabular-nums", r.net_day < 0 ? "text-rose-600" : "text-cyan-700")}>
                            {fmt(r.net_day)}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  ) : (
                  <table className="min-w-full table-fixed text-sm">
                    <colgroup>
                      <col className="w-[92px]" />
                      <col className="w-[140px]" />
                      <col className="w-[96px]" />
                      <col className="w-[104px]" />
                      <col className="w-[96px]" />
                      <col className="w-[96px]" />
                      <col className="w-[96px]" />
                      <col className="w-[110px]" />
                    </colgroup>

                    <thead className="sticky top-0 z-10">
                      <tr className="bg-slate-100 text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="rounded-l-lg px-3 py-2 text-left">День</th>
                        <th className="px-3 py-2 text-left">Смена</th>
                        <th className="px-3 py-2 text-right">Часы</th>
                        <th className="px-3 py-2 text-right">Часовка</th>
                        <th className="px-3 py-2 text-right">Бонус</th>
                        <th className="px-3 py-2 text-right">Штрафы</th>
                        <th className="px-3 py-2 text-right">Налоги</th>
                        <th className="rounded-r-lg px-3 py-2 text-right">Итог дня</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">
                      {dailyRows.map((r: any, idx: number) => {
                        const isPromoter = dailyMeta?.role === "promoter";
                        const hasPenalty = !isPromoter && num(r.penalties) > 0;
                        return (
                        <tr key={`${r.day}:${r.branch_id}`} className={idx % 2 === 1 ? "bg-slate-50/70" : "bg-white"}>
                          <td className="px-3 py-2 text-slate-800">{r.day}
                            {Number(r.branch_id) !== dailyMeta.branchId && <div className="mt-0.5 text-xs text-slate-500">{branches.find(branch => branch.id === Number(r.branch_id))?.name || `Филиал ${r.branch_id}`}</div>}
                          </td>
                          <td className={cx("px-3 py-2 tabular-nums", r.shift_in ? "text-slate-700" : "text-slate-300")}>
                            {r.shift_in ? `${r.shift_in} – ${r.shift_out ?? "…"}` : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-800">{fmtHM(r.hours)}</td>
                          <td className="px-3 py-2 text-right text-slate-800">{fmt(r.hour_pay)}</td>
                          <td className="px-3 py-2 text-right text-slate-800">{fmt(r.bonus)}</td>
                          <td className={cx("px-3 py-2 text-right", isPromoter ? "text-slate-300" : hasPenalty ? "text-rose-600 font-medium" : "text-slate-800")}>
                            {isPromoter ? "—" : fmt(r.penalties)}
                          </td>
                          <td className={cx("px-3 py-2 text-right", isPromoter ? "text-slate-300" : "text-slate-800")}>
                            {isPromoter ? "—" : fmt(num(r.social_fund_day) + num(r.income_tax_day))}
                          </td>
                          <td className={cx("px-3 py-2 text-right font-semibold tabular-nums", r.net_day < 0 ? "text-rose-600" : "text-cyan-700")}>
                            {fmt(r.net_day)}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  )
                )}
              </div>

              {!activeWeek && dailyMeta.managementTotal > 0 && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-cyan-100 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
                <span>Доплата и премия за управление сетью</span>
                <span className="font-semibold tabular-nums">{fmt(dailyMeta.managementTotal)} сом</span>
              </div>}
              {showDailyFooter ? (
                <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/80">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-slate-600">
                      {activeWeek ? "К выплате за неделю" : "К выплате за месяц"}
                    </span>
                    <span className="text-xl font-bold tabular-nums text-cyan-700">
                      {fmt(dailyMeta.netPeriod)} сом
                    </span>
                  </div>
                </div>
              ) : null}

              {dailyMeta.role === "master" && dailyMasterSplit.length > 0 ? (
                <div className="border-t border-slate-100 px-4 py-3 bg-sky-50/60">
                  <div className="text-sm font-medium text-sky-900">Кто оплачивает</div>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {MASTER_PAYERS.map((p) => {
                      const rows = dailyMasterSplit.filter((s) =>
                        p.branchIds.includes(s.branchId)
                      );
                      const amount = rows.reduce((a, s) => a + s.amount, 0);
                      const pairs = rows.reduce((a, s) => a + s.pairs, 0);
                      return (
                        <div
                          key={p.key}
                          className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-sky-200"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-sm font-semibold text-slate-900">{p.label}</span>
                            <span className="text-lg font-bold tabular-nums text-sky-700">
                              {fmt(amount)} сом
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {pairs.toFixed(1).replace(".", ",")} пары ·{" "}
                            {rows
                              .map(
                                (s) =>
                                  `${branches.find((b) => b.id === s.branchId)?.name ?? s.branchId}: ${fmt(s.amount)}`
                              )
                              .join(" · ") || "нет заказов"}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-2 text-[11px] text-sky-800/70">
                    Пары мастера делятся между филиалами пропорционально их заказам за тот же
                    день. Сумма обеих долей равна «К выплате» выше.
                  </div>
                </div>
              ) : null}

              {dailyMeta.branchId === 2 && dailyDebtBonus > 0 ? (
                <div className="border-t border-slate-100 px-4 py-3 bg-emerald-50/60">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-emerald-800">
                      Бонус за возврат долгов (10%){activeWeek ? " за неделю" : " за месяц"}
                    </span>
                    <span className="text-lg font-bold tabular-nums text-emerald-700">
                      +{fmt(dailyDebtBonus)} сом
                    </span>
                  </div>
                  {dailyDebtRows.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {dailyDebtRows.map((d, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200"
                        >
                          {d.order_no}: +{fmt(d.bonus)}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-1.5 text-[11px] text-emerald-700/70">
                    Уже включено в сумму «К выплате» выше.
                  </div>
                </div>
              ) : null}

              {dailyDeductPlan.length > 0 && (deductRemaining > 0 || dailyDeduct > 0) ? (
                <div className="border-t border-slate-100 px-4 py-3 bg-rose-50/60">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-rose-800">
                      Удержание за недостачу{activeWeek ? " за неделю" : " за месяц"}
                    </span>
                    <span className="text-lg font-bold tabular-nums text-rose-700">
                      {dailyDeduct > 0 ? "−" : ""}{fmt(dailyDeduct)} сом
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {dailyDeductPlan.map((d, i) => {
                      const isCur = activeWeek
                        ? d.week_start === activeWeek.start
                        : d.week_start === currentWeekStart;
                      return (
                        <span
                          key={i}
                          className={cx(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                            isCur
                              ? "bg-rose-600 text-white ring-rose-600"
                              : "bg-white text-rose-700 ring-rose-200"
                          )}
                        >
                          {dmFromYmd(d.week_start)}: −{fmt(d.amount)}
                        </span>
                      );
                    })}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-rose-700/80">
                    <span>
                      Всего: {fmt(deductTotal)} сом · осталось: {fmt(deductRemaining)} сом
                    </span>
                    <span>Уже вычтено из «К выплате» выше.</span>
                  </div>
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

function currentBusinessMonthKey(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BISHKEK_TZ,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return year && month ? `${year}-${month}` : new Date().toISOString().slice(0, 7);
}

function optionalNum(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function fmtPct(value: number): string {
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
}

function payrollReviewReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    assessment_missing: "Не удалось подтвердить полноту автоматической проверки.",
    invalid_three_month_snapshot: "Снимок истории за три месяца неполный или повреждён.",
    incomplete_three_month_history: "Нет полной истории продаж за три месяца.",
    coldstart_model: "План рассчитан по модели нового филиала, а не по полной истории.",
    no_positive_recent_baseline: "В недавней истории нет положительной базы продаж.",
    target_above_125pct_recent_max:
      "Цель выше 125% максимальной фактической выручки последних месяцев.",
    high_recent_sales_volatility: "Продажи последних месяцев слишком нестабильны.",
    turnaround_economic_gap:
      "Экономически необходимая цель заметно выше недавних продаж филиала.",
  };
  return labels[reason] ?? `Требуется ручная проверка: ${reason}.`;
}

function fmtLockedAt(value?: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("ru-RU", {
    timeZone: BISHKEK_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
