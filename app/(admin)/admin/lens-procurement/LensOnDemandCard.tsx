"use client";

/**
 * Блок «Под заказ» — линзы, которых нет в наличии; заказываются у поставщика
 * только когда клиент их заказал на кассе (асферика, хамелеон зелёный/синий/
 * фиолетовый, контроль миопии, поликарбонат HMC 1.59).
 *
 * Показывает «Нужно заказать» (v_lens_ondemand_pending). Кнопка «Заказано»
 * вызывает RPC lens_ondemand_order_group → создаёт настоящую партию закупки
 * (in_transit), поэтому позиция появляется во вкладке «В пути» у этого вида
 * линзы (как обычный заказ) и в списке партий. Дальше «В пути»/«Получено»
 * ведутся существующей системой партий.
 *
 * Excel (для поставщика) делегируется родительской странице. Событие
 * lens-ondemand-changed гасит счётчик-бейдж в навигации.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getBrowserSupabase } from "@/lib/supabaseBrowser";
import {
  PackageSearch, Download, Check, RefreshCw, ChevronDown, ChevronUp,
  Loader2, AlertTriangle, Store, Truck,
} from "lucide-react";

type PendingRow = {
  order_item_id: number;
  order_id: number;
  order_no: string | null;
  branch_id: number | null;
  branch_name: string | null;
  branch_code: string | null;
  status: string;
  created_at: string;
  customer_first_name: string | null;
  customer_last_name: string | null;
  family: string;
  family_label: string;
  coating: string | null;
  refractive_index: number | null;
  lens_type: string | null;
  lens_code: string | null;
  eye: string | null;
  sph: number | null;
  qty: number;
  price: number | null;
};

type Diopter = { sph: number; qty: number };
type Group = {
  family: string;
  family_label: string;
  coating: string | null;
  totalQty: number;
  orderItemIds: number[];
  byDiopter: Diopter[];
  branches: string[];
  orderNos: string[];
};

function fmtSph(v: number): string {
  const n = Number(v) || 0;
  if (n > 0) return `+${n.toFixed(2)}`;
  if (n < 0) return `−${Math.abs(n).toFixed(2)}`;
  return "0.00";
}

function groupRows(rows: PendingRow[]): Group[] {
  const map = new Map<string, Group & { _byD: Map<number, { sph: number; qty: number; ids: number[] }> }>();
  for (const r of rows) {
    let g = map.get(r.family);
    if (!g) {
      g = {
        family: r.family,
        family_label: r.family_label,
        coating: r.coating,
        totalQty: 0,
        orderItemIds: [],
        byDiopter: [],
        branches: [],
        orderNos: [],
        _byD: new Map(),
      };
      map.set(r.family, g);
    }
    const s = Number(r.sph ?? 0);
    g.totalQty += r.qty;
    g.orderItemIds.push(r.order_item_id);
    let e = g._byD.get(s);
    if (!e) {
      e = { sph: s, qty: 0, ids: [] };
      g._byD.set(s, e);
    }
    e.qty += r.qty;
    e.ids.push(r.order_item_id);
    if (r.branch_name && !g.branches.includes(r.branch_name)) g.branches.push(r.branch_name);
    if (r.order_no && !g.orderNos.includes(r.order_no)) g.orderNos.push(r.order_no);
  }
  for (const g of map.values()) {
    g.byDiopter = [...g._byD.values()].map((d) => ({ sph: d.sph, qty: d.qty })).sort((a, b) => a.sph - b.sph);
  }
  return [...map.values()].sort((a, b) => a.family_label.localeCompare(b.family_label, "ru"));
}

function GroupCard({ g, children }: { g: Group; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-amber-200/70 bg-amber-50/40 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">{g.family_label}</span>
            {g.coating && (
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200">
                {g.coating}
              </span>
            )}
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-800 ring-1 ring-amber-300/50">
              {g.totalQty} шт
            </span>
          </div>
          {g.branches.length > 0 && (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
              <Store className="h-3 w-3" />
              <span className="truncate">
                {g.branches.join(", ")} · {g.orderNos.length} {g.orderNos.length === 1 ? "заказ" : "заказа(ов)"}
              </span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{children}</div>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl ring-1 ring-amber-200/60">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-white/70 text-slate-500">
              <th className="px-3 py-1.5 text-left font-medium">Диоптрия (SPH)</th>
              <th className="px-3 py-1.5 text-right font-medium">Кол-во</th>
            </tr>
          </thead>
          <tbody>
            {g.byDiopter.map((d) => (
              <tr key={d.sph} className="border-t border-amber-200/40 bg-white/40">
                <td className="px-3 py-1.5 font-mono text-slate-800">{fmtSph(d.sph)}</td>
                <td className="px-3 py-1.5 text-right font-semibold text-slate-900">{d.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LensOnDemandCard({
  onExportGroup,
  onExportAll,
}: {
  onExportGroup: (family: string, rows: { sph: number; qty: number }[]) => void | Promise<void>;
  onExportAll: (
    groups: { family: string; byDiopter: { sph: number; qty: number }[]; totalQty: number }[],
  ) => void | Promise<void>;
}) {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const sb = getBrowserSupabase();
      const { data, error } = await sb.rpc("lens_ondemand_pending_list");
      if (error) throw error;
      setRows(
        ((data as PendingRow[]) ?? []).map((r) => ({
          ...r,
          qty: Number(r.qty) || 0,
          sph: r.sph == null ? 0 : Number(r.sph),
        })),
      );
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => groupRows(rows), [rows]);
  const total = useMemo(() => rows.reduce((a, r) => a + r.qty, 0), [rows]);

  async function markOrdered(g: Group) {
    if (
      !window.confirm(
        `Заказать у поставщика: ${g.family_label} — ${g.totalQty} шт?\n\n` +
          `Создастся партия закупки, и позиция появится во вкладке «В пути» у этого вида линзы.`,
      )
    )
      return;
    setBusyKey(g.family);
    setErr(null);
    try {
      const sb = getBrowserSupabase();
      const { error } = await sb.rpc("lens_ondemand_order_group", {
        p_order_item_ids: g.orderItemIds,
        p_family: g.family,
        p_items: g.byDiopter.map((d) => ({ sph: d.sph, qty: d.qty })),
        p_comment: `Под заказ клиента: ${g.orderNos.join(", ")}`,
      });
      if (error) {
        setErr(error.message);
        return;
      }
      window.dispatchEvent(new CustomEvent("lens-ondemand-changed"));
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="mt-5 rounded-[20px] bg-white/95 ring-1 ring-amber-200/80 shadow-[0_18px_45px_rgba(15,23,42,0.10)]">
      {/* Header */}
      <div className="flex w-full items-center gap-3 px-5 py-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 via-orange-400 to-amber-500 shadow-[0_0_24px_rgba(245,158,11,0.35)]">
            <PackageSearch className="h-5 w-5 text-white" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold text-slate-900">Под заказ — нужно закупить</span>
            <span className="block text-[11px] text-slate-500">
              Редкие линзы из заказов клиентов. «Заказано» → партия уходит во вкладку «В пути»
            </span>
          </span>
        </button>
        {total > 0 && (
          <span className="flex h-6 min-w-[24px] items-center justify-center rounded-full bg-amber-500 px-2 text-[12px] font-bold text-white shadow-[0_0_8px_rgba(245,158,11,0.45)]">
            {total}
          </span>
        )}
        <button
          type="button"
          onClick={() => load()}
          className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-slate-700"
          title="Обновить"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
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
        <div className="px-5 pb-5">
          {err && (
            <div className="mb-3 inline-flex items-start gap-2 rounded-2xl bg-rose-500/10 px-4 py-3 ring-1 ring-rose-300/40">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-rose-500" />
              <div className="text-sm text-rose-700 whitespace-pre-line">{err}</div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 rounded-2xl bg-slate-100/70 px-4 py-6 text-sm text-slate-600 ring-1 ring-slate-200">
              <Loader2 className="h-4 w-4 animate-spin" /> Загружаю список…
            </div>
          ) : groups.length === 0 ? (
            <div className="flex items-center gap-2 rounded-2xl bg-emerald-500/5 px-4 py-6 text-sm text-emerald-800 ring-1 ring-emerald-300/40">
              <Check className="h-4 w-4 text-emerald-600" /> Всё заказано — закупать сейчас нечего.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[12px] text-slate-500">
                  Видов: <span className="font-semibold text-slate-700">{groups.length}</span> · всего{" "}
                  <span className="font-semibold text-slate-700">{total}</span> шт
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onExportAll(
                      groups.map((g) => ({
                        family: g.family,
                        byDiopter: g.byDiopter.map((d) => ({ sph: d.sph, qty: d.qty })),
                        totalQty: g.totalQty,
                      })),
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_8px_22px_rgba(245,158,11,0.30)] transition hover:brightness-105 active:scale-[0.98]"
                  title="Все виды в одном Excel-файле"
                >
                  <Download className="h-3.5 w-3.5" />
                  Скачать всё одним файлом
                </button>
              </div>

              {groups.map((g) => (
                <GroupCard key={g.family} g={g}>
                  <button
                    type="button"
                    onClick={() => onExportGroup(g.family, g.byDiopter.map((d) => ({ sph: d.sph, qty: d.qty })))}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-[0.98]"
                    title="Скачать Excel по этому виду"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Excel
                  </button>
                  <button
                    type="button"
                    disabled={busyKey === g.family}
                    onClick={() => markOrdered(g)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_8px_22px_rgba(34,211,238,0.30)] transition hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
                    title="Заказал у поставщика — создать партию и перевести в «В пути»"
                  >
                    {busyKey === g.family ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Заказано
                  </button>
                </GroupCard>
              ))}

              <div className="flex items-start gap-1.5 rounded-xl bg-sky-500/5 px-3 py-2 text-[11px] text-sky-800 ring-1 ring-sky-200/70">
                <Truck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  После «Заказано» позиция уходит в партию и видна во вкладке <b>«В пути»</b> у этого вида линзы
                  (локация — Сокулук) и в списке партий. Там же отмечается «Получено».
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
