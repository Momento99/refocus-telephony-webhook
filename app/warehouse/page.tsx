"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getBrowserSupabase } from "@/lib/supabaseBrowser";
import {
  Package,
  Users,
  Building2,
  ShoppingBag,
  Briefcase,
  Shirt,
  Sparkles,
  CheckCircle2,
  RefreshCw,
  X,
  ShoppingCart,
  ChevronRight,
} from "lucide-react";

type ConsumableKey = "bag" | "case" | "cloth" | "premium";
type StockMap = Record<ConsumableKey, number>;

type RpcRow = {
  location_id: string;
  location_name: string;
  accessory_type: ConsumableKey;
  accessory_sku_id: string;
  qty: number;
  last_fixed_at: string | null;
  last_fixed_by: string | null;
};

type LocationCard = {
  locationId: string;
  name: string;
  lastFixedAt: string | null;
  stock: StockMap;
};

const sb = getBrowserSupabase();

function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

function fmtTs(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Card(props: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cx(
        "rounded-2xl p-5 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]",
        props.className
      )}
    >
      {props.children}
    </div>
  );
}

function SoftPrimaryButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { iconLeft?: React.ReactNode }
) {
  const { className, iconLeft, children, ...rest } = props;
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
    >
      {iconLeft}
      {children}
    </button>
  );
}


function SoftGhostButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { iconLeft?: React.ReactNode }) {
  const { className, iconLeft, children, ...rest } = props;
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
    >
      {iconLeft}
      {children}
    </button>
  );
}

function QtyInput(props: {
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { value, onChange, placeholder, disabled } = props;

  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      value={Number.isFinite(value) ? value : 0}
      placeholder={placeholder ?? "0"}
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value;
        const n = raw === "" ? 0 : Number(raw);
        onChange(Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
      }}
      className={cx(
        "w-28 rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900",
        "ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70",
        "placeholder:text-slate-400",
        "disabled:opacity-60 disabled:cursor-not-allowed"
      )}
    />
  );
}

const UI_ITEMS: Array<{ key: ConsumableKey; label: string; Icon: any }> = [
  { key: "bag", label: "Пакеты", Icon: ShoppingBag },
  { key: "case", label: "Футляры", Icon: Briefcase },
  { key: "cloth", label: "Платочки", Icon: Shirt },
  { key: "premium", label: "Премиум-набор", Icon: Sparkles },
];

export default function WarehousePage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cards, setCards] = useState<LocationCard[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<LocationCard | null>(null);
  const [draft, setDraft] = useState<StockMap>({ bag: 0, case: 0, cloth: 0, premium: 0 });
  const [comment, setComment] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);

  const totals = useMemo(() => {
    const t: StockMap = { bag: 0, case: 0, cloth: 0, premium: 0 };
    for (const c of cards) {
      for (const k of Object.keys(t) as ConsumableKey[]) t[k] += c.stock[k] || 0;
    }
    return t;
  }, [cards]);

  async function load() {
    setLoading(true);
    setError(null);

    const { data, error: rpcErr } = await sb.rpc("warehouse_accessory_snapshot", {
      p_location_kind: "shop",
    });

    if (rpcErr) {
      setError(rpcErr.message);
      setCards([]);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as RpcRow[];

    if (rows.length === 0) {
      setCards([]);
      setLoading(false);
      return;
    }

    const byLoc = new Map<string, LocationCard>();

    for (const r of rows) {
      const cur =
        byLoc.get(r.location_id) ??
        ({
          locationId: r.location_id,
          name: r.location_name,
          lastFixedAt: r.last_fixed_at,
          stock: { bag: 0, case: 0, cloth: 0, premium: 0 },
        } as LocationCard);

      cur.lastFixedAt = r.last_fixed_at ?? cur.lastFixedAt;

      if (r.accessory_type in cur.stock) {
        cur.stock[r.accessory_type] = Number(r.qty ?? 0);
      }

      byLoc.set(r.location_id, cur);
    }

    setCards(Array.from(byLoc.values()));
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  function openFix(c: LocationCard) {
    setSelected(c);
    setDraft({ ...c.stock });
    setComment("");
    setModalError(null);
    setModalOpen(true);
  }

  function closeFix() {
    setModalOpen(false);
    setSelected(null);
    setModalError(null);
  }

  async function saveFix() {
    if (!selected) return;

    for (const k of Object.keys(draft) as ConsumableKey[]) {
      const v = draft[k];
      if (!Number.isFinite(v) || v < 0) {
        setModalError("Проверь значения — должны быть числа ≥ 0.");
        return;
      }
    }

    setBusy(true);
    setModalError(null);

    const { error: rpcErr } = await sb.rpc("warehouse_accessory_set_counts", {
      p_location_id: selected.locationId,
      p_counts: draft,
      p_comment: comment || null,
    });

    if (rpcErr) {
      setModalError(rpcErr.message);
      setBusy(false);
      return;
    }

    await load();
    setBusy(false);
    closeFix();
  }

  return (
    <div className="text-slate-50">
      {/* Header (бренд-стандарт) */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
            <Package className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-50">Склад расходников</div>
            <div className="mt-0.5 text-[12px] text-cyan-300/50">
              Филиал пересчитывает и фиксирует итоговые количества
            </div>
          </div>
        </div>

        <SoftGhostButton onClick={() => void load()} iconLeft={<RefreshCw className="h-4 w-4" />} disabled={loading}>
          Обновить
        </SoftGhostButton>
      </div>

      {/* Навигация по складским разделам */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          href="/warehouse/suppliers"
          className="group flex items-center gap-4 rounded-2xl px-5 py-4 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] transition hover:ring-cyan-300/40"
        >
          <div className="h-10 w-10 shrink-0 grid place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.28)]">
            <Users className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-slate-900">Поставщики</div>
            <div className="mt-0.5 text-xs text-slate-500">Контрагенты и условия поставок</div>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-cyan-500 transition-colors" />
        </Link>

        <Link
          href="/admin/lens-procurement"
          className="group flex items-center gap-4 rounded-2xl px-5 py-4 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] transition hover:ring-cyan-300/40"
        >
          <div className="h-10 w-10 shrink-0 grid place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.28)]">
            <ShoppingCart className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-slate-900">Закуп линз</div>
            <div className="mt-0.5 text-xs text-slate-500">Заказы и история закупок</div>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-cyan-500 transition-colors" />
        </Link>
      </div>

      {error ? (
        <div className="mb-5 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">
          {error}
        </div>
      ) : null}

      {!error && !loading && cards.length === 0 ? (
        <div className="mb-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 ring-1 ring-amber-200">
          Данных нет (либо нет доступа owner, либо нет shop-локаций в выборке).
        </div>
      ) : null}

      {/* Totals */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {UI_ITEMS.map((it) => (
          <div
            key={it.key}
            className="rounded-2xl p-4 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]"
          >
            <div className="flex items-center gap-2">
              <it.Icon className="h-4 w-4 text-cyan-600" />
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{it.label}</div>
            </div>
            <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">
              {totals[it.key]} <span className="text-slate-400 text-sm font-medium">шт</span>
            </div>
          </div>
        ))}
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {loading ? (
          <Card>
            <div className="text-sm text-slate-600">Загрузка…</div>
          </Card>
        ) : (
          cards.map((c) => (
            <Card key={c.locationId}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-cyan-600" />
                    <div className="truncate text-base font-semibold text-slate-900">{c.name}</div>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Последняя фиксация: {fmtTs(c.lastFixedAt)}
                  </div>
                </div>

                <SoftPrimaryButton
                  onClick={() => openFix(c)}
                  iconLeft={<CheckCircle2 className="h-4 w-4" />}
                >
                  Зафиксировать
                </SoftPrimaryButton>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2.5">
                {UI_ITEMS.map((it) => (
                  <div
                    key={it.key}
                    className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 bg-slate-50/60 ring-1 ring-sky-100"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-xl bg-white ring-1 ring-sky-100 grid place-items-center">
                        <it.Icon className="h-4 w-4 text-cyan-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-800">{it.label}</div>
                        <div className="text-[11px] text-slate-500">шт</div>
                      </div>
                    </div>

                    <div className="text-base font-semibold text-slate-900 tabular-nums">
                      {c.stock[it.key]} <span className="text-slate-400 text-sm font-medium">шт</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Modal */}
      {modalOpen && selected ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
          onClick={busy ? undefined : closeFix}
        >
          <div
            className="w-full max-w-[640px] rounded-3xl bg-white p-6 ring-1 ring-sky-100 shadow-[0_30px_80px_rgba(0,0,0,0.4)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.3)]">
                  <CheckCircle2 className="h-5 w-5 text-white" />
                </div>
                <div>
                  <div className="text-lg font-bold tracking-tight text-slate-900">
                    Фиксация остатков: {selected.name}
                  </div>
                  <div className="mt-0.5 text-[12px] text-slate-500">
                    Введите факт после пересчёта (абсолютные числа)
                  </div>
                </div>
              </div>

              <button
                onClick={closeFix}
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                aria-label="close"
                disabled={busy}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              {UI_ITEMS.map((it) => (
                <div
                  key={it.key}
                  className="rounded-xl px-4 py-3 bg-slate-50/60 ring-1 ring-sky-100"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <it.Icon className="h-4 w-4 text-cyan-600" />
                      <div className="text-sm font-medium text-slate-800">{it.label}</div>
                    </div>

                    <QtyInput
                      value={draft[it.key]}
                      onChange={(v) => setDraft((p) => ({ ...p, [it.key]: v }))}
                      disabled={busy}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Комментарий (необязательно)</div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 placeholder:text-slate-400 disabled:opacity-60"
                placeholder="Например: пересчёт за неделю"
                disabled={busy}
              />
            </div>

            {modalError ? (
              <div className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">
                {modalError}
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={closeFix}
                className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"
                disabled={busy}
              >
                Отмена
              </button>

              <SoftPrimaryButton onClick={() => void saveFix()} disabled={busy}>
                {busy ? "Сохранение…" : "Сохранить"}
              </SoftPrimaryButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}