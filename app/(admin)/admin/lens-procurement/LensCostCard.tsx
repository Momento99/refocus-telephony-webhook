"use client";

/**
 * Блок «Себестоимость и цены» — компактно: за одну линзу по видам.
 * Себестоимость одна на сеть (lens_catalog, landed). Цена продажи и маржа —
 * по выбранному ФИЛИАЛУ (v_lens_prices_resolved: Токмок ≠ остальные).
 * RPC lens_cost_overview(branch_id). Только владелец.
 */

import { useCallback, useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabaseBrowser";
import { Coins, ChevronDown, ChevronUp, Loader2, AlertTriangle } from "lucide-react";

type CostRow = {
  id: string;
  name: string;
  category: string;
  display_index: string | null;
  cost_piece: number | null;
  price_piece_from: number | null;
  price_piece_to: number | null;
  margin_pct: number | null;
};
type Branch = { id: number; name: string };

function nf(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString("ru-RU");
}

export default function LensCostCard() {
  const [rows, setRows] = useState<CostRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const loadBranches = useCallback(async () => {
    try {
      const sb = getBrowserSupabase();
      const { data } = await sb.from("branches").select("id,name").eq("is_hidden", false).order("id");
      const list = ((data as Branch[]) ?? []).map((b) => ({ id: Number(b.id), name: b.name }));
      setBranches(list);
      if (list.length && !list.some((b) => b.id === branchId)) setBranchId(list[0].id);
    } catch {
      /* ignore */
    }
  }, [branchId]);

  const loadCosts = useCallback(async (bid: number) => {
    setLoading(true);
    setErr(null);
    try {
      const sb = getBrowserSupabase();
      const { data, error } = await sb.rpc("lens_cost_overview", { p_branch_id: bid });
      if (error) throw error;
      setRows(
        ((data as CostRow[]) ?? []).map((r) => ({
          ...r,
          cost_piece: r.cost_piece == null ? null : Number(r.cost_piece),
          price_piece_from: r.price_piece_from == null ? null : Number(r.price_piece_from),
          price_piece_to: r.price_piece_to == null ? null : Number(r.price_piece_to),
          margin_pct: r.margin_pct == null ? null : Number(r.margin_pct),
        })),
      );
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ленивая загрузка при первом раскрытии
  useEffect(() => {
    if (open && !ready) {
      setReady(true);
      void loadBranches();
    }
  }, [open, ready, loadBranches]);

  useEffect(() => {
    if (ready) void loadCosts(branchId);
  }, [ready, branchId, loadCosts]);

  const priceCell = (r: CostRow): string => {
    if (r.price_piece_from == null) return "—";
    if (r.price_piece_to && r.price_piece_to !== r.price_piece_from)
      return `${nf(r.price_piece_from)}–${nf(r.price_piece_to)}`;
    return nf(r.price_piece_from);
  };

  return (
    <div className="mt-5 rounded-[20px] bg-white/95 ring-1 ring-slate-200 shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
      <div className="flex w-full items-center gap-3 px-5 py-3.5">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 via-teal-400 to-cyan-400 shadow-[0_0_18px_rgba(16,185,129,0.28)]">
            <Coins className="h-4.5 w-4.5 text-white" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-slate-900">Себестоимость и цены</span>
            <span className="block text-[11px] text-slate-500">За одну линзу. Цена продажи — по филиалу</span>
          </span>
        </button>

        {open && branches.length > 0 && (
          <select
            value={branchId}
            onChange={(e) => setBranchId(Number(e.target.value))}
            className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-300"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-50 hover:text-slate-700"
          title={open ? "Свернуть" : "Развернуть"}
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {open && (
        <div className="px-4 pb-4">
          {err && (
            <div className="mb-2 inline-flex items-start gap-2 rounded-xl bg-rose-500/10 px-3 py-2 ring-1 ring-rose-300/40">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-rose-500" />
              <div className="text-xs text-rose-700 whitespace-pre-line">{err}</div>
            </div>
          )}

          {loading && !rows.length ? (
            <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500 ring-1 ring-slate-200">
              <Loader2 className="h-4 w-4 animate-spin" /> Загружаю…
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-1.5 text-left font-semibold">Вид</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Себест.</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Продажа</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Маржа</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id} className={i % 2 ? "bg-slate-50/40" : "bg-white"}>
                      <td className="px-3 py-1 text-slate-800">
                        <span className="font-medium">{r.name}</span>
                        {r.display_index && <span className="ml-1.5 text-[10px] text-slate-400">{r.display_index}</span>}
                      </td>
                      <td className="px-3 py-1 text-right font-semibold text-slate-900 tabular-nums">{nf(r.cost_piece)}</td>
                      <td className="px-3 py-1 text-right text-slate-600 tabular-nums">{priceCell(r)}</td>
                      <td className="px-3 py-1 text-right tabular-nums">
                        <span
                          className={
                            r.margin_pct == null
                              ? "text-slate-300"
                              : r.margin_pct >= 60
                              ? "font-semibold text-emerald-600"
                              : r.margin_pct >= 30
                              ? "font-semibold text-amber-600"
                              : "font-semibold text-rose-500"
                          }
                        >
                          {r.margin_pct == null ? "—" : `${nf(r.margin_pct)}%`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-2 px-1 text-[10px] text-slate-400">
            Себест. = FOB + доставка + карго, за линзу. Цена продажи редактируется на «Цены на линзы».
          </div>
        </div>
      )}
    </div>
  );
}
