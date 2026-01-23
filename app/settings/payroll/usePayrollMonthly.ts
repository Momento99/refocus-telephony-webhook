// usePayrollMonthly.ts
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabaseBrowser";

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
  hoursWorked?: number;
  accrued?: number;
  net?: number; // К ВЫПЛАТЕ за месяц
  adjustments?: number;
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
};

/** Локальный диапазон месяца: [start; end) */
function monthRangeLocal(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d1 = new Date(y, m - 1, 1);
  const d2 = new Date(y, m, 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const toYYYYMMDD = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { start: toYYYYMMDD(d1), end: toYYYYMMDD(d2) };
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

    const { start, end } = monthRangeLocal(month);

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

      const employeesDict = (eRows || []).map((r: any) => ({
        id: Number(r.id),
        branchId: Number(r.branch_id),
        fullName: String(r.full_name ?? ""),
        role: (r.role as RoleDb) ?? "seller",
        hourlyRate: n0(r.hourly_rate),
        hasBonus: !!r.has_bonus,
        bonusPercent: n0(r.bonus_percent),
        is_active: r.is_active ?? true,
      }));

      const activeIds = employeesDict.map((e) => e.id).filter(Boolean);
      const branchIds = Array.from(
        new Set(employeesDict.map((e) => e.branchId).filter(Boolean))
      );

      // 4) Дни за месяц — ВАЖНО: берём фикс-вьюху, где с 2026-02 plan_premium=0 по дням
      // (а месячная премия приходит через v_payroll_adjustments_monthly).
      let dQuery = sb
        .from("v_payroll_daily_fixed")
        .select(
          "employee_id, branch_id, day, hours, hour_pay, bonus, penalties, social_fund_day, income_tax_day, plan_premium, net_day"
        )
        .gte("day", start)
        .lt("day", end);
      if (activeIds.length) dQuery = dQuery.in("employee_id", activeIds);
      if (branchIds.length) dQuery = dQuery.in("branch_id", branchIds);
      const { data: dRows, error: dErr } = await dQuery;
      if (dErr) throw dErr;

      // 5) Месячные корректировки (сюда же у тебя попадает месячная премия с 2026-02)
      let aQuery = sb
        .from("v_payroll_adjustments_monthly")
        .select("employee_id, branch_id, month, adjustments_sum")
        .eq("month", start);
      if (activeIds.length) aQuery = aQuery.in("employee_id", activeIds);
      if (branchIds.length) aQuery = aQuery.in("branch_id", branchIds);
      const { data: aRows, error: aErr } = await aQuery;
      if (aErr) throw aErr;

      // 6) v_payroll_monthly — если эта вьюха уже учитывает корректировки, берём её.
      // Если не учитывает (часто так бывает), берём computed = sum(net_day)+adjustments.
      let mQuery = sb
        .from("v_payroll_monthly")
        .select("employee_id, branch_id, month, net_total")
        .eq("month", start);
      if (activeIds.length) mQuery = mQuery.in("employee_id", activeIds);
      if (branchIds.length) mQuery = mQuery.in("branch_id", branchIds);
      const { data: mRows, error: mErr } = await mQuery;
      if (mErr) throw mErr;

      // ── Агрегаты по дням: ключ — eid:bid
      type Agg = { hours: number; accrued: number; netDaySum: number };
      const byEmpBranch = new Map<string, Agg>();
      const keyOf = (eid: number, bid: number) => `${eid}:${bid}`;

      for (const r of dRows || []) {
        const eid = Number((r as any).employee_id);
        const bid = Number((r as any).branch_id);
        const key = keyOf(eid, bid);
        const acc = byEmpBranch.get(key) || { hours: 0, accrued: 0, netDaySum: 0 };

        acc.hours += n0((r as any).hours);
        // начислено по дням (информативно)
        acc.accrued +=
          n0((r as any).hour_pay) +
          n0((r as any).bonus) +
          n0((r as any).plan_premium) -
          n0((r as any).penalties);

        // net_day уже включает налоги/соцфонд/премии дня (для месяцев < 2026-02)
        acc.netDaySum += n0((r as any).net_day);

        byEmpBranch.set(key, acc);
      }

      // Корректировки (в т.ч. месячная премия с 2026-02)
      const adjByEmpBranch = new Map<string, number>();
      for (const r of aRows || []) {
        const eid = Number((r as any).employee_id);
        const bid = Number((r as any).branch_id);
        adjByEmpBranch.set(keyOf(eid, bid), n0((r as any).adjustments_sum));
      }

      // Нетто из месячной вьюхи
      const netByEmpBranch = new Map<string, number>();
      for (const r of mRows || []) {
        const eid = Number((r as any).employee_id);
        const bid = Number((r as any).branch_id);
        netByEmpBranch.set(keyOf(eid, bid), n0((r as any).net_total));
      }

      const employees: Employee[] = employeesDict.map((e) => {
        const key = keyOf(e.id, e.branchId);
        const agg = byEmpBranch.get(key) || { hours: 0, accrued: 0, netDaySum: 0 };
        const adj = adjByEmpBranch.get(key) || 0;

        const computedNet = Math.round(agg.netDaySum + adj);
        const netFromView =
          netByEmpBranch.has(key) ? netByEmpBranch.get(key)! : null;

        // Защита от ситуации, когда v_payroll_monthly НЕ учитывает adjustments:
        // если отличается заметно — берём computed.
        let netFinal = 0;
        if (typeof netFromView === "number") {
          const diff = Math.abs(Math.round(netFromView) - computedNet);
          netFinal = diff <= 1 ? netFromView : computedNet;
        } else {
          netFinal = computedNet;
        }

        return {
          ...e,
          hoursWorked: agg.hours,
          accrued: Math.round(agg.accrued + adj),
          net: netFinal,
          adjustments: Math.round(adj),
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
      const { start, end } = monthRangeLocal(month);

      const { data: rows, error } = await sb
        .from("v_payroll_daily_fixed")
        .select("*")
        .eq("employee_id", employeeId)
        .eq("branch_id", branchId)
        .gte("day", start)
        .lt("day", end)
        .order("day", { ascending: true });

      if (error) throw error;
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
      const { error } = await sb.from("employees").delete().eq("id", id);
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
