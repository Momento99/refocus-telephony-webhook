// app/settings/attendance/pins/PinsClient.tsx
"use client";

import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import getSupabase from "@/lib/supabaseClient";
import { toast } from "react-hot-toast";
import {
  Shield,
  RefreshCcw,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  User2,
  Lock,
  Search,
  CheckCircle2,
  XCircle,
} from "lucide-react";

/* ---------------- types ---------------- */

type BranchRow = { id: number; name: string; pos_pin: string | null };

type CredRow = {
  cred_id: number;
  employee_id: number;
  full_name: string;
  branch_id: number | null;
  branch_name: string | null;
  login: string | null;
  is_active: boolean;
  updated_at: string | null;
  pin_sha256: string | null;
  pin_plain: string | null;
};

type EmployeeOpt = {
  id: number;
  full_name: string;
  branch_id: number | null;
  branch_name: string | null;
};

/* ---------------- UI helpers ---------------- */

function GlassCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "rounded-3xl border border-sky-200 " +
        "bg-gradient-to-br from-white via-slate-50 to-sky-50/85 " +
        "shadow-[0_22px_60px_rgba(15,23,42,0.55)] text-slate-900 backdrop-blur-xl " +
        className
      }
    >
      {children}
    </div>
  );
}

const baseBtn =
  "inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs md:text-[13px] font-medium " +
  "transition focus:outline-none focus:ring-2 focus:ring-cyan-400/60 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";

const btnSolid =
  baseBtn +
  " text-slate-900 bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-500 " +
  "hover:brightness-110 shadow-[0_0_16px_rgba(56,189,248,0.45)]";

const btnOutline =
  baseBtn +
  " border border-sky-200 text-slate-800 bg-white/90 hover:bg-sky-50";

const btnDanger =
  baseBtn +
  " text-white bg-gradient-to-r from-rose-500 to-amber-500 hover:brightness-110 " +
  "shadow-[0_0_18px_rgba(248,113,113,0.45)]";

function GBtn(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "solid" | "outline" | "danger";
  }
) {
  const { variant = "solid", className = "", ...rest } = props;
  const cls =
    variant === "solid" ? btnSolid : variant === "danger" ? btnDanger : btnOutline;
  return <button {...rest} className={`${cls} ${className}`} />;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={
        "w-full px-3.5 py-2.5 rounded-xl border bg-white/90 " +
        "border-sky-200 text-sm text-slate-900 placeholder:text-slate-400 " +
        "outline-none focus:ring-2 focus:ring-cyan-400/60 focus:border-cyan-400 shadow-sm " +
        (props.className || "")
      }
    />
  );
}

const Pill = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <span
    className={
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ring-1 " +
      (ok
        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
        : "bg-slate-100 text-slate-600 ring-slate-300")
    }
  >
    {ok ? (
      <CheckCircle2 className="h-3.5 w-3.5" />
    ) : (
      <XCircle className="h-3.5 w-3.5" />
    )}
    {children}
  </span>
);

/* ---------------- helpers ---------------- */

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ---------------- page ---------------- */

export default function PinsClient() {
  const sbRef = useRef<SupabaseClient | null>(null);

  const [loading, setLoading] = useState(false);

  // branches
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [pins, setPins] = useState<Record<number, string>>({});

  // employees for selector
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [empId, setEmpId] = useState<number | "">("");

  // creds grid
  const [creds, setCreds] = useState<CredRow[]>([]);
  const [query, setQuery] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);

  // create form
  const [login, setLogin] = useState("");
  const [pin, setPin] = useState("");

  useEffect(() => {
    sbRef.current = getSupabase();
    void reloadAll();
  }, []);

  async function reloadAll() {
    setLoading(true);
    try {
      await Promise.all([loadBranches(), loadEmployees(), loadCreds()]);
    } finally {
      setLoading(false);
    }
  }

  /* ---------- loaders ---------- */

  async function loadBranches() {
    const sb = sbRef.current!;
    const { data, error } = await sb
      .from("branches")
      .select("id,name,pos_pin")
      .order("id", { ascending: true });

    if (error) {
      toast.error(error.message || "Не удалось загрузить филиалы");
      return;
    }
    const list = (data ?? []) as BranchRow[];
    setBranches(list);

    const map: Record<number, string> = {};
    list.forEach((b) => (map[b.id] = (b.pos_pin ?? "").toString()));
    setPins(map);
  }

  async function loadEmployees() {
    const sb = sbRef.current!;
    const { data, error } = await sb
      .from("employees")
      .select("id, full_name, branch_id")
      .eq("is_active", true)
      .order("full_name", { ascending: true });

    if (error) {
      toast.error(error.message || "Не удалось загрузить сотрудников");
      return;
    }

    const rows = (data ?? []).map(
      (r: any): EmployeeOpt => ({
        id: r.id,
        full_name: r.full_name,
        branch_id: r.branch_id ?? null,
        branch_name: null,
      })
    );
    setEmployees(rows);
    if (rows.length && empId === "") setEmpId(rows[0].id);
  }

  async function loadCreds() {
    const sb = sbRef.current!;
    const { data, error } = await sb
      .from("v_employee_credentials_admin")
      .select(
        "cred_id,employee_id,full_name,branch_id,branch_name,login,is_active,updated_at,pin_sha256,pin_plain"
      )
      .order("employee_id", { ascending: true })
      .order("cred_id", { ascending: true });

    if (error) {
      toast.error(error.message || "Не удалось загрузить логины");
      return;
    }
    setCreds((data ?? []) as CredRow[]);
  }

  /* ---------- helpers ---------- */

  function setPinLocally(id: number, v: string) {
    setPins((prev) => ({ ...prev, [id]: v.replace(/\s+/g, "") }));
  }
  function genPin(len = 4) {
    const L = Math.max(4, Math.min(8, len));
    let s = "";
    for (let i = 0; i < L; i++) s += Math.floor(Math.random() * 10);
    return s;
  }

  const filteredCreds = useMemo(() => {
    let arr = creds;
    if (onlyActive) arr = arr.filter((c) => c.is_active);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      arr = arr.filter(
        (c) =>
          c.full_name.toLowerCase().includes(q) ||
          (c.login ?? "").toLowerCase().includes(q) ||
          (c.branch_name ?? "").toLowerCase().includes(q)
      );
    }
    return arr;
  }, [creds, onlyActive, query]);

  /* ---------- mutations: branches pins ---------- */

  async function saveBranchPin(id: number) {
    const sb = sbRef.current!;
    const val = (pins[id] ?? "").trim();
    if (!/^\d{4,8}$/.test(val)) {
      toast.error("PIN должен быть 4–8 цифр");
      return;
    }
    const { error } = await sb.from("branches").update({ pos_pin: val }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("PIN филиала сохранён");
  }

  async function clearBranchPin(id: number) {
    const sb = sbRef.current!;
    const { error } = await sb.from("branches").update({ pos_pin: null }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPins((p) => ({ ...p, [id]: "" }));
    toast.success("PIN филиала очищен");
  }

  /* ---------- mutations: employee creds & employee ---------- */

  // Создать логин + PIN через серверный RPC
  async function createLogin() {
    const sb = sbRef.current!;
    if (!empId || typeof empId !== "number") {
      toast.error("Выбери сотрудника");
      return;
    }

    const l = login.trim().toLowerCase();
    if (l.length < 2 || l.length > 40) {
      toast.error("Логин 2–40 символов");
      return;
    }

    const p = pin.trim();
    if (!/^\d{4}$/.test(p)) {
      toast.error("PIN строго 4 цифры");
      return;
    }

    setLoading(true);
    try {
      const res = await sb.rpc("app_set_employee_login_pin", {
        p_employee_id: empId,
        p_login: l,
        p_pin: p,
      });

      if (res.error) {
        toast.error(res.error.message || "Ошибка сохранения PIN");
        return;
      }

      const r = Array.isArray(res.data) ? res.data[0] : res.data;
      if (r?.error) {
        const map: Record<string, string> = {
          employee_not_found: "Сотрудник не найден",
          login_taken: "Такой логин уже используется",
        };
        toast.error(map[r.error] || r.error);
        return;
      }

      toast.success("Логин и PIN сохранены");
      setLogin("");
      setPin("");
      await Promise.all([loadCreds(), loadEmployees()]);
    } finally {
      setLoading(false);
    }
  }

  // Жёсткое удаление логина + PIN
  async function removeLoginAndPin(row: CredRow) {
    const sb = sbRef.current!;
    const ok = confirm(
      `Удалить логин и PIN для «${row.full_name}»? Сотрудник не сможет войти, пока вы не создадите новый логин.`
    );
    if (!ok) return;

    setLoading(true);
    try {
      const now = new Date().toISOString();

      // 1) чистим employees (источник истины для входа)
      const { error: e1 } = await sb
        .from("employees")
        .update({ login: null, pin_hash: null, updated_at: now } as any)
        .eq("id", row.employee_id);
      if (e1) throw e1;

      // 2) чистим витрину employee_credentials
      const { error: e2 } = await sb
        .from("employee_credentials")
        .update(
          {
            login: null,
            pin_plain: null,
            pin_sha256: null,
            is_active: false,
            updated_at: now,
          } as any
        )
        .eq("id", row.cred_id);
      if (e2) throw e2;

      await loadCreds();
      toast.success("Логин и PIN удалены");
    } catch (err: any) {
      console.error(err);
      toast.error(
        "Не удалось удалить логин: " +
          (err?.message || err?.error_description || "ошибка")
      );
    } finally {
      setLoading(false);
    }
  }

  /* ---------------- render ---------------- */

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6 text-slate-50">
      {/* header */}
      <GlassCard className="px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/40">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="text-lg md:text-xl font-semibold tracking-wide text-slate-900">
                Доступы: PIN’ы филиалов и логины сотрудников
              </div>
              <div className="text-[11px] md:text-xs text-slate-500">
                Здесь настраиваешь, кто вообще может войти в «Мою смену» и на каких
                аппаратах.
              </div>
            </div>
          </div>
          <GBtn variant="outline" onClick={reloadAll} disabled={loading}>
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Обновить
          </GBtn>
        </div>
      </GlassCard>

      {/* branch pins */}
      <GlassCard className="overflow-hidden">
        <div className="px-5 pt-4 pb-3 text-[15px] font-semibold text-slate-900">
          PIN’ы филиалов (вход кассы)
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full table-fixed text-[13px]">
            <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
              <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5 w-16 text-left">ID</th>
                <th className="px-4 py-2.5 w-64 text-left">Филиал</th>
                <th className="px-4 py-2.5 text-left">PIN (4–8 цифр)</th>
                <th className="px-4 py-2.5 w-[280px] text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr
                  key={b.id}
                  className="border-t border-slate-200 hover:bg-sky-50"
                >
                  <td className="px-4 py-3 tabular-nums text-slate-700">{b.id}</td>
                  <td className="px-4 py-3 text-slate-900">{b.name}</td>
                  <td className="px-4 py-3">
                    <Input
                      value={pins[b.id] ?? ""}
                      onChange={(e) =>
                        setPinLocally(b.id, e.target.value.replace(/\D/g, ""))
                      }
                      inputMode="numeric"
                      placeholder="не задан"
                      maxLength={8}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <GBtn
                        variant="outline"
                        onClick={() => setPinLocally(b.id, genPin(4))}
                      >
                        Сгенерировать
                      </GBtn>
                      <GBtn variant="danger" onClick={() => clearBranchPin(b.id)}>
                        Очистить
                      </GBtn>
                      <GBtn variant="solid" onClick={() => saveBranchPin(b.id)}>
                        Сохранить
                      </GBtn>
                    </div>
                  </td>
                </tr>
              ))}
              {!branches.length && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    Филиалы не найдены
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 pb-4 text-[11px] text-slate-500">
          Это PIN именно устройства кассы. Чтобы полностью запретить вход с
          аппарата филиала, очисти PIN филиала.
        </div>
      </GlassCard>

      {/* employee logins */}
      <GlassCard className="overflow-hidden">
        <div className="px-5 pt-4 pb-2 flex items-center justify-between gap-3">
          <div className="text-[15px] font-semibold text-slate-900">
            Логины сотрудников (вход в «Мою смену»)
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                className="pl-8 w-64"
                placeholder="Поиск по имени/логину"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <GBtn variant="outline" onClick={() => setOnlyActive((v) => !v)}>
              {onlyActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {onlyActive ? "Только активные" : "Все"}
            </GBtn>
          </div>
        </div>

        {/* create row */}
        <div className="px-5 pb-3 pt-3 grid gap-3 md:grid-cols-[280px,1fr,180px,auto] items-center">
          <div className="relative">
            <User2 className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <select
              className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-sky-200 bg-white/90 text-sm text-slate-900 focus:ring-2 focus:ring-cyan-400/60 focus:border-cyan-400 shadow-sm"
              value={empId === "" ? "" : String(empId)}
              onChange={(e) =>
                setEmpId(e.target.value ? Number(e.target.value) : "")
              }
            >
              <option value="">— выбери сотрудника —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                  {e.branch_id ? ` (фил. ${e.branch_id})` : ""}
                </option>
              ))}
            </select>
          </div>

          <Input
            placeholder="Логин"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                className="pl-9"
                placeholder="PIN (4 цифры)"
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                inputMode="numeric"
                maxLength={4}
              />
            </div>
            <GBtn variant="outline" onClick={() => setPin(genPin(4))}>
              PIN
            </GBtn>
          </div>

          <GBtn onClick={createLogin} disabled={loading}>
            <Plus className="h-4 w-4" /> Создать
          </GBtn>
        </div>

        {/* grid */}
        <div className="px-5 pb-4 overflow-x-auto">
          <table className="min-w-full table-fixed text-[13px]">
            <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
              <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2.5 w-14 text-left">ID</th>
                <th className="px-3 py-2.5 w-64 text-left">Сотрудник</th>
                <th className="px-3 py-2.5 w-40 text-left">Филиал</th>
                <th className="px-3 py-2.5 text-left">Логин</th>
                <th className="px-3 py-2.5 w-24 text-left">PIN</th>
                <th className="px-3 py-2.5 w-40 text-left">Статус</th>
                <th className="px-3 py-2.5 w-[260px] text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {filteredCreds.map((r) => (
                <tr
                  key={r.cred_id}
                  className="border-t border-slate-200 hover:bg-sky-50"
                >
                  <td className="px-3 py-2.5 tabular-nums text-slate-700">
                    {r.cred_id}
                  </td>
                  <td className="px-3 py-2.5 text-slate-900">{r.full_name}</td>
                  <td className="px-3 py-2.5 text-slate-700">
                    {r.branch_id
                      ? `${r.branch_name ?? "Филиал"} (фил. ${r.branch_id})`
                      : "—"}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-slate-900">
                    {r.login ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-800">
                    {r.pin_plain ?? "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <Pill ok={r.is_active}>
                      {r.is_active ? "Активен" : "Выключен"}
                    </Pill>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      <GBtn
                        variant="danger"
                        onClick={() => removeLoginAndPin(r)}
                        disabled={loading}
                      >
                        <Trash2 className="h-4 w-4" />
                        Удалить логин и PIN
                      </GBtn>
                    </div>
                  </td>
                </tr>
              ))}
              {!filteredCreds.length && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    Логинов не найдено
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-5 pb-4 text-[11px] text-slate-500 space-y-1">
          <div>
            «Создать» записывает логин и PIN в источник истины (employees.login +
            pin_hash), затем синхронизирует витрину (employee_credentials). При
            сбое RPC срабатывает JS-fallback.
          </div>
          <div>
            «Удалить логин и PIN» полностью чистит входные данные сотрудника. Чтобы
            вернуть доступ, нужно заново создать логин и PIN.
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
