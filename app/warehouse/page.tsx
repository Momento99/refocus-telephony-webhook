"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

const sb: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
);

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

function GlassCard(props: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cx(
        "rounded-2xl p-5 sm:p-6",
        "bg-gradient-to-br from-white via-slate-50 to-sky-50/85",
        "ring-1 ring-sky-200/80",
        "shadow-[0_22px_70px_rgba(15,23,42,0.25)]",
        "backdrop-blur-xl",
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
        "rounded-xl px-4 py-2 text-sm font-medium text-white",
        "bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400",
        "shadow-[0_18px_60px_rgba(34,211,238,0.35)]",
        "hover:brightness-[1.03] active:brightness-[0.97]",
        "focus:outline-none focus:ring-2 focus:ring-teal-300/70",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
    >
      <span className="inline-flex items-center gap-2">
        {iconLeft}
        {children}
      </span>
    </button>
  );
}


function SoftGhostButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { iconLeft?: React.ReactNode }) {
  const { className, iconLeft, children, ...rest } = props;
  return (
    <button
      {...rest}
      className={cx(
        "rounded-xl px-3.5 py-2 text-sm font-medium text-teal-700",
        "bg-white/85 hover:bg-white",
        "ring-1 ring-teal-200",
        "shadow-[0_16px_55px_rgba(15,23,42,0.18)]",
        "focus:outline-none focus:ring-2 focus:ring-cyan-300/60",
        "inline-flex items-center gap-2",
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
        "w-28 rounded-[14px] px-3 py-2 text-sm text-slate-900",
        "bg-white/90 ring-1 ring-sky-200/80",
        "focus:outline-none focus:ring-2 focus:ring-cyan-400/80",
        "shadow-[0_14px_45px_rgba(15,23,42,0.14)]",
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
    <div className="min-h-screen bg-transparent text-slate-900">
      <div className="mx-auto max-w-7xl px-5 pt-8 pb-10">
        {/* Header */}
        <GlassCard className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div
                className={cx(
                  "h-10 w-10 rounded-xl",
                  "bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400",
                  "shadow-[0_18px_60px_rgba(34,211,238,0.35)]",
                  "grid place-items-center"
                )}
              >
                <Package className="h-5 w-5 text-white" />
              </div>

              <div>
                <div className="text-[30px] font-semibold leading-tight">Склад расходников</div>
                <div className="text-xs text-slate-600/90">
                  Филиал пересчитывает и фиксирует итоговые количества (факт).
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <SoftGhostButton onClick={() => void load()} iconLeft={<RefreshCw className="h-4 w-4" />} disabled={loading}>
                Обновить
              </SoftGhostButton>
            </div>
          </div>
        </GlassCard>

        {/* Навигация по складским разделам */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link
            href="/warehouse/suppliers"
            className={cx(
              "group flex items-center gap-4 rounded-2xl px-5 py-4",
              "bg-gradient-to-br from-white via-slate-50 to-sky-50/85",
              "ring-1 ring-sky-200/80",
              "shadow-[0_18px_60px_rgba(15,23,42,0.18)]",
              "hover:-translate-y-0.5 transition-transform duration-150"
            )}
          >
            <div className={cx(
              "h-11 w-11 shrink-0 rounded-2xl grid place-items-center",
              "bg-gradient-to-br from-violet-500 to-indigo-500",
              "shadow-[0_12px_40px_rgba(109,40,217,0.35)]"
            )}>
              <Users className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-slate-900">Поставщики</div>
              <div className="mt-0.5 text-xs text-slate-500">Контрагенты и условия поставок</div>
            </div>
            <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
          </Link>

          <Link
            href="/admin/lens-procurement"
            className={cx(
              "group flex items-center gap-4 rounded-2xl px-5 py-4",
              "bg-gradient-to-br from-white via-slate-50 to-sky-50/85",
              "ring-1 ring-sky-200/80",
              "shadow-[0_18px_60px_rgba(15,23,42,0.18)]",
              "hover:-translate-y-0.5 transition-transform duration-150"
            )}
          >
            <div className={cx(
              "h-11 w-11 shrink-0 rounded-2xl grid place-items-center",
              "bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400",
              "shadow-[0_12px_40px_rgba(34,211,238,0.35)]"
            )}>
              <ShoppingCart className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-slate-900">Закуп линз</div>
              <div className="mt-0.5 text-xs text-slate-500">Заказы и история закупок</div>
            </div>
            <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
          </Link>
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">
            {error}
          </div>
        ) : null}

        {!error && !loading && cards.length === 0 ? (
          <div className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
            Данных нет (либо нет доступа owner, либо нет shop-локаций в выборке).
          </div>
        ) : null}

        {/* Totals */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {UI_ITEMS.map((it) => (
            <div
              key={it.key}
              className={cx(
                "rounded-2xl p-4",
                "bg-gradient-to-br from-white via-slate-50 to-sky-50/85",
                "ring-1 ring-sky-200/80",
                "shadow-[0_18px_60px_rgba(15,23,42,0.18)]"
              )}
            >
              <div className="flex items-center gap-2">
                <it.Icon className="h-4 w-4 text-sky-700/80" />
                <div className="text-xs text-slate-600">Всего</div>
              </div>
              <div className="mt-2 text-lg font-semibold tabular-nums">{totals[it.key]} шт</div>
            </div>
          ))}
        </div>

        {/* Cards */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {loading ? (
            <GlassCard>
              <div className="text-sm text-slate-600">Загрузка…</div>
            </GlassCard>
          ) : (
            cards.map((c) => (
              <GlassCard key={c.locationId}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-sky-700/80" />
                      <div className="truncate text-base font-semibold">{c.name}</div>
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

                <div className="mt-4 grid grid-cols-1 gap-3">
                  {UI_ITEMS.map((it) => (
                    <div
                      key={it.key}
                      className={cx(
                        "flex items-center justify-between gap-3 rounded-2xl px-4 py-3",
                        "bg-white/85 ring-1 ring-sky-200/80",
                        "shadow-[0_14px_45px_rgba(15,23,42,0.12)]"
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-xl bg-sky-50 ring-1 ring-sky-200/70 grid place-items-center">
                          <it.Icon className="h-4 w-4 text-sky-700/80" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-800">{it.label}</div>
                          <div className="text-[11px] text-slate-500">шт</div>
                        </div>
                      </div>

                      <div className="text-base font-semibold tabular-nums">
                        {c.stock[it.key]} <span className="text-slate-500 text-sm font-medium">шт</span>
                      </div>
                    </div>
                  ))}
                </div>
              </GlassCard>
            ))
          )}
        </div>

        {/* Modal */}
        {modalOpen && selected ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div
              className={cx(
                "w-full max-w-[640px] rounded-2xl bg-white/95",
                "ring-1 ring-sky-200",
                "shadow-[0_30px_120px_rgba(0,0,0,0.65)]",
                "backdrop-blur-xl"
              )}
            >
              <div className="flex items-start justify-between gap-4 p-5 sm:p-6">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-slate-900">
                    Фиксация остатков: {selected.name}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Вводишь факт после пересчёта (абсолютные числа).
                  </div>
                </div>

                <button
                  onClick={closeFix}
                  className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/60 disabled:opacity-60"
                  aria-label="close"
                  disabled={busy}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                <div className="grid grid-cols-1 gap-3">
                  {UI_ITEMS.map((it) => (
                    <div
                      key={it.key}
                      className={cx(
                        "rounded-2xl px-4 py-3",
                        "bg-white/85 ring-1 ring-sky-200/80",
                        "shadow-[0_14px_45px_rgba(15,23,42,0.12)]"
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <it.Icon className="h-4 w-4 text-sky-700/80" />
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
                  <div className="mb-1 text-[11px] text-slate-500">Комментарий (необязательно)</div>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={2}
                    className={cx(
                      "w-full rounded-[14px] px-3 py-2 text-sm text-slate-900",
                      "bg-white/90 ring-1 ring-sky-200/80",
                      "focus:outline-none focus:ring-2 focus:ring-cyan-400/80",
                      "shadow-[0_14px_45px_rgba(15,23,42,0.14)]",
                      "placeholder:text-slate-400",
                      "disabled:opacity-60 disabled:cursor-not-allowed"
                    )}
                    placeholder="Например: пересчёт за неделю"
                    disabled={busy}
                  />
                </div>

                {modalError ? (
                  <div className="mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">
                    {modalError}
                  </div>
                ) : null}

                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button
                    onClick={closeFix}
                    className={cx(
                      "rounded-xl px-3.5 py-2 text-sm font-medium text-teal-700",
                      "bg-white/85 hover:bg-white",
                      "ring-1 ring-teal-200",
                      "shadow-[0_16px_55px_rgba(15,23,42,0.18)]",
                      "focus:outline-none focus:ring-2 focus:ring-cyan-300/60",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
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
          </div>
        ) : null}
      </div>
    </div>
  );
}