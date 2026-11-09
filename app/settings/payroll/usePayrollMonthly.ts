// usePayrollMonthly.ts
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabaseBrowser";
import type { ManagerCompensationResponse } from "@/lib/managerCompensation";

/** ===== Типы ===== */
export type RoleDb = "seller" | "promoter" | "master";
export type RoleT = "seller" | "promoter" | "master" | "owner";

export function dbRoleToUi(v: string): RoleT {
  if (v === "seller" || v === "promoter" || v === "master") return v;
  return "seller";
}
export function uiRoleToDb(v: RoleT): RoleDb {
  if (v === "owner") return "seller";
  return v as RoleDb;
}

type Branch = { id: number; name: string };
type Employee = {
  id: number;
  branchId: number;
  fullName: string;
  role: RoleDb;
  hourlyRate: number;
  hasBonus: boolean;
  bonusPercent: number;
  /** Промоутеры: фикс. бонус (сом) за заказ филиала в смене. null = бонус по проценту. */
  bonusPerOrder?: number | null;
  hoursWorked?: number;
  accrued?: number;
  net?: number; // К ВЫПЛАТЕ за месяц
  adjustments?: number;
  managementTotal?: number;
  is_active?: boolean;
};

type Cfg = {
  id: number;
  social_fund_monthly: number;
  income_tax_monthly: number;

  // старое (до 2026-02)
  daily_turnover_target: number;
  daily_bonus_each: number;

  // новое (с 2026-02)
  monthly_turnover_target?: number;
  monthly_bonus_each?: number;

  // сдельная ставка мастера (сом за один заказ)
  master_piece_rate?: number;
};

function monthRangeLocal(ym: string) {
  const [year, monthNumber] = ym.split("-").map(Number);
  const format = (value: Date) => {
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${value.getFullYear()}-${month}-${day}`;
  };
  return {
    start: format(new Date(year, monthNumber - 1, 1)),
    end: format(new Date(year, monthNumber, 1)),
  };
}

function toMsg(err: any) {
  if (!err) return "Неизвестная ошибка";
  if (typeof err === "string") return err;
  if (err.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function n0(x: any) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

async function fetchFixedPayroll(month: string, employeeId?: number, branchId?: number): Promise<{ days: any[]; adjustments: any[] }> {
  const params = new URLSearchParams({ month });
  if (employeeId) params.set("employeeId", String(employeeId));
  if (branchId) params.set("branchId", String(branchId));
  const response = await fetch("/api/payroll/fixed?" + params, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось загрузить расчёт зарплаты");
  return data;
}

export function usePayrollMonthly(month: string) {
  const SWITCH_MONTH = "2026-02"; // с 01.02.2026 включаем месячный план (логика в БД)
  const isMonthlyPlanMode = month >= SWITCH_MONTH;

  // supabase только после монтирования
  const [sb, setSb] = useState<ReturnType<typeof getBrowserSupabase> | null>(
    null
  );
  useEffect(() => {
    setSb(getBrowserSupabase());
  }, []);

  const [data, setData] = useState<{
    branches: Branch[];
    employees: Employee[];
    cfg?: Cfg;
  }>({
    branches: [],
    employees: [],
    cfg: undefined,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!sb) return;
    setIsLoading(true);
    setErrorText(null);

    try {
      // 1) Конфиг
      const { data: cfgRow, error: cfgErr } = await sb
        .from("payroll_config")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (cfgErr) throw cfgErr;

      // 2) Филиалы
      const { data: bRows, error: bErr } = await sb
        .from("branches")
        .select("id, name")
        .order("id", { ascending: true });
      if (bErr) throw bErr;

      // 3) Сотрудники (справочник)
      const { data: eRows, error: eErr } = await sb
        .from("employees")
        .select(
          "id, branch_id, full_name, role, hourly_rate, has_bonus, bonus_percent, is_active"
        )
        .order("id", { ascending: true });
      if (eErr) throw eErr;

      // 3b) Профили оплаты — берём bonus_per_order (фикс. бонус промоутера за заказ).
      const { data: pRows, error: pErr } = await sb
        .from("employee_payroll_profiles")
        .select("employee_id, bonus_per_order, active");
      if (pErr) throw pErr;
      const bonusPerOrderByEmp = new Map<number, number | null>();
      for (const r of pRows || []) {
        if (r && (r as any).active === false) continue;
        const eid = Number((r as any).employee_id);
        const v = (r as any).bonus_per_order;
        bonusPerOrderByEmp.set(eid, v === null || v === undefined ? null : Number(v));
      }

      const employeesDict = (eRows || []).map((r: any) => ({
        id: Number(r.id),
        branchId: Number(r.branch_id),
        fullName: String(r.full_name ?? ""),
        role: (r.role as RoleDb) ?? "seller",
        hourlyRate: n0(r.hourly_rate),
        hasBonus: !!r.has_bonus,
        bonusPercent: n0(r.bonus_percent),
        bonusPerOrder: bonusPerOrderByEmp.has(Number(r.id))
          ? bonusPerOrderByEmp.get(Number(r.id))!
          : null,
        is_active: r.is_active ?? true,
      }));

      // 4) Фиксированный расчёт за выбранный месяц, где с 2026-02 plan_premium=0 по дням
      // (а месячная премия приходит через v_payroll_adjustments_monthly).
      const { days: dRows, adjustments: aRows } = await fetchFixedPayroll(month);

      // Доплата приходит из того же расчёта, который видит управляющая.
      const managementResponse = await fetch("/api/manager/compensation?month=" + month, { cache: "no-store" });
      const managementData = await managementResponse.json();
      if (!managementResponse.ok) throw new Error(managementData.error || "Не удалось загрузить управленческую доплату");

      // Месячная выплата сотрудника объединяет смены во всех филиалах.
      type Agg = { hours: number; accrued: number; netDaySum: number };
      const byEmployee = new Map<number, Agg>();

      for (const r of dRows || []) {
        const eid = Number((r as any).employee_id);
        const acc = byEmployee.get(eid) || { hours: 0, accrued: 0, netDaySum: 0 };

        acc.hours += n0((r as any).hours);
        // начислено по дням (информативно)
        acc.accrued +=
          n0((r as any).hour_pay) +
          n0((r as any).bonus) +
          n0((r as any).plan_premium) -
          n0((r as any).penalties);

        // net_day уже включает налоги/соцфонд/премии дня (для месяцев < 2026-02)
        acc.netDaySum += n0((r as any).net_day);

        byEmployee.set(eid, acc);
      }

      // Корректировки (в т.ч. месячная премия с 2026-02)
      const adjustmentsByEmployee = new Map<number, number>();
      for (const r of aRows || []) {
        const eid = Number((r as any).employee_id);
        adjustmentsByEmployee.set(eid, (adjustmentsByEmployee.get(eid) || 0) + n0((r as any).adjustments_sum));
      }

      const managementByEmployee = new Map<number, number>();
      for (const row of (managementData as ManagerCompensationResponse).rows) {
        managementByEmployee.set(Number(row.employee_id), n0(row.total_accrued));
      }

      const employees: Employee[] = employeesDict.map((e) => {
        const agg = byEmployee.get(e.id) || { hours: 0, accrued: 0, netDaySum: 0 };
        const adj = adjustmentsByEmployee.get(e.id) || 0;
        const management = managementByEmployee.get(e.id) || 0;

        const computedNet = Math.round((agg.netDaySum + adj + management) * 100) / 100;

        return {
          ...e,
          hoursWorked: agg.hours,
          accrued: Math.round((agg.accrued + adj + management) * 100) / 100,
          net: computedNet,
          adjustments: Math.round(adj * 100) / 100,
          managementTotal: management,
        };
      });

      const branches: Branch[] = (bRows || []).map((b: any) => ({
        id: Number(b.id),
        name: String(b.name ?? ""),
      }));

      setData({ branches, employees, cfg: cfgRow as any });
    } catch (err: any) {
      console.error("[payroll] load failed:", err);
      setErrorText(toMsg(err));
      setData({ branches: [], employees: [], cfg: undefined });
    } finally {
      setIsLoading(false);
    }
  }, [sb, month]);

  useEffect(() => {
    if (sb) reload();
  }, [sb, reload]);

  const fetchDaily = useCallback(
    async ({
      employeeId,
      branchId,
      month,
    }: {
      employeeId: number;
      branchId: number;
      month: string;
    }) => {
      if (!sb) throw new Error("supabase not ready");
      const { days: rows } = await fetchFixedPayroll(month, employeeId, branchId);
      return { days: rows || [] };
    },
    [sb]
  );

  /** ===== Настройки расчёта ===== */
  const updateConfig = useCallback(
    async (patch: Partial<Cfg>) => {
      if (!sb) throw new Error("supabase not ready");
      const id = data.cfg?.id ?? 1;

      // важно: не ломаем старые месяцы — фронт сам решает, какие поля редактировать
      const next: any = { id, ...(data.cfg || {}), ...(patch || {}) };

      const { error } = await sb
        .from("payroll_config")
        .upsert(next, { onConflict: "id" })
        .select()
        .single();

      if (error) throw error;
      await reload();
    },
    [sb, data.cfg, reload]
  );

  /** ===== CRUD ===== */
  const addBranch = useCallback(
    async (name: string) => {
      if (!sb) throw new Error("supabase not ready");
      const { error } = await sb.from("branches").insert([{ name }]);
      if (error) throw error;
    },
    [sb]
  );

  const renameBranch = useCallback(
    async (id: number, name: string) => {
      if (!sb) throw new Error("supabase not ready");
      const { error } = await sb.from("branches").update({ name }).eq("id", id);
      if (error) throw error;
    },
    [sb]
  );

  const removeBranch = useCallback(
    async (id: number) => {
      if (!sb) throw new Error("supabase not ready");
      const { error } = await sb.from("branches").delete().eq("id", id);
      if (error) throw error;
    },
    [sb]
  );

  const addEmployee = useCallback(
    async (e: {
      branchId: number;
      fullName: string;
      role: RoleDb;
      hourlyRate: number;
      hasBonus: boolean;
      bonusPercent: number;
    }) => {
      if (!sb) throw new Error("supabase not ready");
      const { error } = await sb.from("employees").insert([
        {
          branch_id: e.branchId,
          full_name: e.fullName,
          role: e.role,
          hourly_rate: e.hourlyRate,
          has_bonus: e.hasBonus,
          bonus_percent: e.bonusPercent,
        },
      ]);
      if (error) throw error;
    },
    [sb]
  );

  const updateEmployee = useCallback(
    async (
      id: number,
      patch: Partial<{
        fullName: string;
        role: RoleDb;
        hourlyRate: number;
        hasBonus: boolean;
        bonusPercent: number;
      }>
    ) => {
      if (!sb) throw new Error("supabase not ready");
      const body: any = {};
      if (patch.fullName !== undefined) body.full_name = patch.fullName;
      if (patch.role !== undefined) body.role = patch.role;
      if (patch.hourlyRate !== undefined) body.hourly_rate = patch.hourlyRate;
      if (patch.hasBonus !== undefined) body.has_bonus = patch.hasBonus;
      if (patch.bonusPercent !== undefined)
        body.bonus_percent = patch.bonusPercent;

      const { error } = await sb.from("employees").update(body).eq("id", id);
      if (error) throw error;
    },
    [sb]
  );

  const removeEmployee = useCallback(
    async (id: number) => {
      if (!sb) throw new Error("supabase not ready");
      // Мягкое удаление. Сотрудника с историей (смены, платежи, focus-события,
      // зарплата) жёстко удалить нельзя — на employees ссылается ~20 таблиц с
      // ON DELETE NO ACTION/RESTRICT, БД заблокирует DELETE. RPC прячет
      // сотрудника (is_active=false) и освобождает логин, история сохраняется.
      const { error } = await sb.rpc("app_archive_employee", {
        p_employee_id: id,
      });
      if (error) throw error;
    },
    [sb]
  );

  const addAdjustment = useCallback(
    async (p: {
      employeeId: number;
      branchId: number;
      month: string;
      amount: number;
      reason: string;
      kind: "premium" | "fine" | "other";
    }) => {
      if (!sb) throw new Error("supabase not ready");
      const { start } = monthRangeLocal(p.month);
      const { error } = await sb.from("payroll_adjustments").insert([
        {
          employee_id: p.employeeId,
          branch_id: p.branchId,
          period: start, // первое число месяца
          amount: p.amount,
          reason: p.reason,
          kind: p.kind,
        },
      ]);
      if (error) throw error;
    },
    [sb]
  );

  return {
    data,
    isLoading,
    errorText,
    mutate: reload,
    fetchDaily,
    updateConfig,
    addBranch,
    renameBranch,
    removeBranch,
    addEmployee,
    updateEmployee,
    removeEmployee,
    addAdjustment,
    // если нужно где-то в UI:
    isMonthlyPlanMode,
  };
}
