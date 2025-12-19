"use client";

import { useCallback, useEffect, useState } from "react";

/** ===== Типы API-пейлоада ===== */
export type Role = "seller" | "promoter" | "master" | "owner";

export type ApiCfg = {
  id: number;
  daily_turnover_target: number;
  daily_bonus_each: number;
  social_fund_monthly: number;
  income_tax_monthly: number;
  updated_at: string;
};

export type ApiBranch = { id: number; name: string };
export type ApiEmployee = {
  id: number;
  fullName: string;
  role: Role;
  branchId: number;
  hourlyRate: number;
  hoursWorked: number;
  hasBonus: boolean;
  bonusPercent: number;
  active: boolean;
};

export type ApiPayload = {
  cfg: ApiCfg;
  branches: ApiBranch[];
  employees: ApiEmployee[];
  month: string; // YYYY-MM
};

function errText(e: any) {
  if (!e) return "Неизвестная ошибка";
  if (typeof e === "string") return e;
  if (e.message) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

function validMonth(m: string) {
  return /^\d{4}-\d{2}$/.test(m);
}

export function usePayrollData(month: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [data, setData]     = useState<ApiPayload | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number>(0);

  const fetchOnce = useCallback(async (signal?: AbortSignal) => {
    const m = String(month || "").trim();

    if (!validMonth(m)) {
      setData(null);
      setError("Неверный формат параметра month. Ожидается YYYY-MM.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const qs = new URLSearchParams({ month: m });
      const res = await fetch(`/api/payroll/data?${qs.toString()}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal,
        headers: { Accept: "application/json" },
      });

      if (signal?.aborted) return;

      if (!res.ok) {
        // попробуем вытащить серверное сообщение об ошибке
        let msg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) msg = String(body.error);
        } catch { /* игнор */ }
        throw new Error(msg);
      }

      const json: ApiPayload = await res.json();
      if (signal?.aborted) return;

      setData(json);
      setLastUpdated(Date.now());
    } catch (e: any) {
      if (signal?.aborted) return;
      setError(errText(e));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    const ac = new AbortController();
    let alive = true;

    (async () => {
      await fetchOnce(ac.signal);
      if (!alive) return;
    })();

    return () => {
      alive = false;
      ac.abort();
    };
  }, [fetchOnce]);

  // Ручное обновление
  const refresh = useCallback(async () => {
    const ac = new AbortController();
    await fetchOnce(ac.signal);
    return () => ac.abort();
  }, [fetchOnce]);

  return { loading, error, data, refresh, lastUpdated };
}
