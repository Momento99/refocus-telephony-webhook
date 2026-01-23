// app/settings/warehouse/page.tsx
'use client';

import Link from 'next/link';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createBrowserClient } from '@supabase/ssr';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  History,
  Info,
  MoreHorizontal,
  Package,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Truck,
  Warehouse,
  X,
  BarChart3,
  LayoutDashboard,
  Grid3X3,
  List,
  Dot,
} from 'lucide-react';

/* ───────────────── Supabase ───────────────── */
function getSb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!url || !anon) throw new Error('Нет ENV: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return createBrowserClient(url, anon);
}

/* ───────────────── Utils ───────────────── */
function cls(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(' ');
}
function nInt(v: string) {
  const x = parseInt(v, 10);
  return Number.isFinite(x) ? x : NaN;
}
function fmt(n: number) {
  const x = Number(n ?? 0);
  return Number.isFinite(x) ? String(x) : '0';
}
function clampNum(v: any, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}
function formatDateTime(dt: string | null | undefined) {
  if (!dt) return '—';
  const d = new Date(dt);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function formatTimeOnly(dt: Date | null | undefined) {
  if (!dt) return '—';
  return dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
function formatDateOnly(dt: string | null | undefined) {
  if (!dt) return '—';
  const d = new Date(dt);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
function pctProgress(current: number, target: number) {
  const c = Math.max(0, Number(current) || 0);
  const t = Math.max(0, Number(target) || 0);
  if (t <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((c / t) * 100)));
}
function needToOrder(current: number, inTransit: number, target: number) {
  const c = Math.max(0, Number(current) || 0);
  const it = Math.max(0, Number(inTransit) || 0);
  const t = Math.max(0, Number(target) || 0);
  return Math.max(0, t - c - it);
}
function sum(nums: number[]) {
  return nums.reduce((a, b) => a + (Number(b) || 0), 0);
}
function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
function dayKeyISO(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}
function parseISO(s: string | null | undefined) {
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

/* ───────────────── Style system (Refocus glass) ───────────────── */
const UI = {
  shell: 'min-h-screen bg-transparent text-slate-900 relative overflow-x-hidden',
  glowWrap: 'pointer-events-none absolute inset-0 -z-10 overflow-hidden',
  glowA:
    'absolute -top-32 -left-40 h-[520px] w-[520px] rounded-full bg-gradient-to-br from-teal-400/25 via-cyan-400/20 to-sky-400/15 blur-3xl',
  glowB:
    'absolute -bottom-40 -right-48 h-[620px] w-[620px] rounded-full bg-gradient-to-tr from-sky-400/20 via-cyan-400/18 to-emerald-400/14 blur-3xl',
  glowC:
    'absolute top-1/3 left-1/2 -translate-x-1/2 h-[420px] w-[860px] rounded-full bg-gradient-to-r from-white/0 via-sky-300/10 to-white/0 blur-2xl',

  container: 'relative mx-auto w-full max-w-7xl px-5 pt-8 pb-10',

  headerWrap:
    'rounded-3xl bg-white/70 backdrop-blur-xl ring-1 ring-sky-200/70 shadow-[0_22px_70px_rgba(15,23,42,0.18)]',
  headerInner: 'p-5 sm:p-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between',

  badge:
    'h-11 w-11 rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 grid place-items-center text-white shadow-[0_14px_40px_rgba(34,211,238,0.35)] ring-1 ring-white/40',
  h1: 'text-[30px] sm:text-[34px] font-semibold tracking-tight text-slate-900 drop-shadow-[0_10px_24px_rgba(34,211,238,0.18)]',
  sub: 'text-[12px] sm:text-[13px] text-slate-600/90',
  subStrong: 'text-slate-900 font-medium',

  tabsWrap:
    'inline-flex items-center gap-1 rounded-2xl bg-white/75 ring-1 ring-sky-200/70 p-1 shadow-[0_12px_30px_rgba(15,23,42,0.10)] backdrop-blur',
  tabBtn:
    'px-3.5 py-2 text-[13px] font-semibold rounded-xl transition select-none',
  tabActive:
    'bg-gradient-to-br from-white via-slate-50 to-sky-50 ring-1 ring-sky-200/70 text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.10)]',
  tabIdle: 'text-slate-600 hover:text-slate-900 hover:bg-white/60',

  // buttons
  btnBase:
    'inline-flex select-none items-center justify-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium transition active:translate-y-[0.5px] disabled:opacity-60 disabled:cursor-not-allowed',
  btnPrimary:
    'text-white bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-teal-300/70 shadow-[0_14px_34px_rgba(34,211,238,0.24)]',
  btnGhost:
    'bg-white/85 hover:bg-white text-teal-700 ring-1 ring-teal-200/80 focus:outline-none focus:ring-2 focus:ring-cyan-300/70 shadow-[0_10px_24px_rgba(15,23,42,0.10)]',
  btnSoft:
    'bg-white/85 hover:bg-white text-slate-800 ring-1 ring-sky-200/80 focus:outline-none focus:ring-2 focus:ring-cyan-300/60 shadow-[0_10px_24px_rgba(15,23,42,0.10)]',
  btnDanger:
    'bg-gradient-to-r from-rose-500 to-red-500 text-white hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-rose-300/70 shadow-[0_14px_34px_rgba(244,63,94,0.22)]',
  btnLink:
    'bg-transparent text-slate-700 hover:text-slate-900',

  // inputs
  input:
    'w-full rounded-[14px] bg-white/90 ring-1 ring-sky-200/80 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-[0_14px_34px_rgba(15,23,42,0.10)] focus:outline-none focus:ring-2 focus:ring-cyan-400/80',
  textarea:
    'w-full rounded-[14px] bg-white/90 ring-1 ring-sky-200/80 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-[0_14px_34px_rgba(15,23,42,0.10)] focus:outline-none focus:ring-2 focus:ring-cyan-400/80',

  // sections / cards
  section:
    'rounded-3xl p-5 sm:p-6 bg-gradient-to-br from-white via-slate-50 to-sky-50/85 ring-1 ring-sky-200/70 shadow-[0_22px_70px_rgba(15,23,42,0.20)] backdrop-blur-xl',
  sectionDanger:
    'rounded-3xl p-5 sm:p-6 bg-gradient-to-br from-white via-rose-50 to-amber-50/85 ring-1 ring-rose-200/70 shadow-[0_22px_70px_rgba(15,23,42,0.20)] backdrop-blur-xl',

  sectionHead: 'flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between',
  sectionTitle: 'text-sm font-semibold text-slate-800 flex items-center gap-2',
  sectionHint: 'text-[12px] text-slate-500',

  iconPillBase: 'h-9 w-9 rounded-2xl grid place-items-center ring-1 ring-white/50 shadow-[0_14px_34px_rgba(15,23,42,0.16)]',
  iconPillSky: 'bg-gradient-to-br from-sky-50 via-white to-sky-50 ring-sky-200/70 text-sky-700',
  iconPillTeal: 'bg-gradient-to-br from-emerald-50 via-white to-cyan-50 ring-emerald-200/70 text-emerald-700',
  iconPillAmber: 'bg-gradient-to-br from-amber-50 via-white to-amber-50 ring-amber-200/70 text-amber-800',
  iconPillRose: 'bg-gradient-to-br from-rose-50 via-white to-rose-50 ring-rose-200/70 text-rose-700',

  // StatBox (KPI)
  statBase:
    'rounded-2xl p-4 ring-1 shadow-[0_14px_34px_rgba(15,23,42,0.12)] backdrop-blur-xl transition',
  statSky: 'bg-gradient-to-br from-sky-50 via-white to-sky-50 ring-sky-200/70',
  statOk: 'bg-gradient-to-br from-emerald-50 via-white to-emerald-50 ring-emerald-200/70',
  statWarn: 'bg-gradient-to-br from-amber-50 via-white to-amber-50 ring-amber-200/70',
  statBad: 'bg-gradient-to-br from-red-50 via-white to-rose-50 ring-rose-200/70',
  statK: 'text-[12px] text-slate-600',
  statV: 'mt-1 text-[22px] font-semibold text-slate-900 tabular-nums',
  statS: 'mt-1 text-[11px] text-slate-500',

  // chips / statuses
  chip:
    'inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1',
  chipOk: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  chipWarn: 'bg-amber-50 text-amber-800 ring-amber-200',
  chipBad: 'bg-rose-50 text-rose-700 ring-rose-200',
  chipInfo: 'bg-sky-50 text-sky-700 ring-sky-200',
  chipNeutral: 'bg-slate-50 text-slate-700 ring-slate-200',

  // table
  tableWrap:
    'rounded-3xl overflow-hidden bg-white/70 backdrop-blur-xl ring-1 ring-sky-200/70 shadow-[0_22px_70px_rgba(15,23,42,0.18)]',
  table: 'w-full text-sm',
  th:
    'text-left text-[11px] font-semibold tracking-wide text-slate-600 uppercase px-3 py-2 bg-white/70 border-b border-sky-200/60',
  td: 'px-3 py-2 border-b border-slate-200/60 align-middle',
  trHover: 'hover:bg-sky-50/40',

  tiny: 'text-[11px] text-slate-500',
  subtle: 'text-[12px] text-slate-600',
  kbd: 'px-1.5 py-0.5 rounded bg-white/90 ring-1 ring-slate-200 text-[12px] font-semibold',
};

/* ───────────────── Domain types ───────────────── */
type LocationRow = { id: string; name: string; kind: 'warehouse' | 'shop' };

type ConsumableSku = {
  code: string;
  name_ru: string;
  is_active: boolean;
  sort_order: number;
};

type VBalanceRow = {
  location_id: string;
  location_name: string;
  location_kind: 'warehouse' | 'shop';
  sku_code: string;
  sku_name_ru: string;
  qty: number;
};

type InTransitRow = {
  location_id: string;
  sku_code: string;
  qty: number;
};

type PoStatus = 'draft' | 'ordered' | 'in_transit' | 'received' | 'canceled';

type PurchaseItem = {
  id?: string;
  sku_type: string; // sku_code
  qty: number;
  unit_price?: number | null;
  currency?: string | null;
};

type PurchaseOrder = {
  id: string;
  created_at: string;
  status: PoStatus;
  to_location_id: string;
  title?: string | null;
  comment?: string | null;
  eta_date?: string | null;
  ordered_at?: string | null;
  received_at?: string | null;
  received_to_location_id?: string | null;
  inv_purchase_order_items?: PurchaseItem[];
};

/* ───────────────── Constants ───────────────── */
const SETTINGS_KEY = 'refocus.consumables.v2';
const DEFAULT_TARGET = 500;

// если страница поставщиков у тебя по другому пути — поменяй только это:
const SUPPLIERS_PAGE = '/warehouse/suppliers';

/* ───────────────── Small UI bits ───────────────── */
function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cls('relative w-full', className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
      <input
        className={cls(UI.input, 'pl-10')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Поиск…'}
      />
    </div>
  );
}

function Chip({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
  children: ReactNode;
}) {
  const c =
    tone === 'ok'
      ? UI.chipOk
      : tone === 'warn'
        ? UI.chipWarn
        : tone === 'bad'
          ? UI.chipBad
          : tone === 'info'
            ? UI.chipInfo
            : UI.chipNeutral;
  return <span className={cls(UI.chip, c)}>{children}</span>;
}

function LegendChip({
  tone,
  icon,
  children,
}: {
  tone: 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={cls(
        UI.chip,
        tone === 'ok'
          ? UI.chipOk
          : tone === 'warn'
            ? UI.chipWarn
            : tone === 'bad'
              ? UI.chipBad
              : tone === 'info'
                ? UI.chipInfo
                : UI.chipNeutral,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  const c =
    tone === 'ok'
      ? 'bg-emerald-500'
      : tone === 'warn'
        ? 'bg-amber-500'
        : tone === 'bad'
          ? 'bg-rose-500'
          : 'bg-slate-400';
  return <span className={cls('inline-block h-2 w-2 rounded-full', c)} />;
}

function StatBox({
  tone,
  title,
  value,
  sub,
  icon,
  active,
  onClick,
}: {
  tone: 'sky' | 'ok' | 'warn' | 'bad';
  title: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  const bg = tone === 'ok' ? UI.statOk : tone === 'warn' ? UI.statWarn : tone === 'bad' ? UI.statBad : UI.statSky;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cls(
        UI.statBase,
        bg,
        'text-left w-[240px] sm:w-[260px] shrink-0',
        onClick && 'hover:brightness-[1.02]',
        active && 'ring-2 ring-cyan-400/70 shadow-[0_18px_46px_rgba(34,211,238,0.22)]',
      )}
      disabled={!onClick}
    >
      <div className="flex items-center justify-between gap-3">
        <div className={UI.statK}>{title}</div>
        {icon ? <div className="text-slate-700">{icon}</div> : null}
      </div>
      <div className={UI.statV}>{value}</div>
      {sub ? <div className={UI.statS}>{sub}</div> : null}
    </button>
  );
}

function ProgressBar({
  valuePct,
  showPct = true,
  heightClass = 'h-2',
}: {
  valuePct: number;
  showPct?: boolean;
  heightClass?: string;
}) {
  const v = Math.max(0, Math.min(150, Math.round(valuePct || 0)));
  const w = Math.max(0, Math.min(100, v));
  return (
    <div className="mt-2">
      <div className={cls('rounded-full bg-slate-200/80 overflow-hidden', heightClass)}>
        <div
          className={cls('rounded-full bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-400', heightClass)}
          style={{ width: `${w}%` }}
        />
      </div>
      {showPct ? (
        <div className="mt-1 text-right text-[11px] text-slate-500 tabular-nums">{v}%</div>
      ) : null}
    </div>
  );
}

function MiniProgress({ valuePct }: { valuePct: number }) {
  const v = clamp(Math.round(valuePct || 0), 0, 100);
  return (
    <div className="mt-1">
      <div className="h-[2px] rounded-full bg-slate-200/80 overflow-hidden">
        <div
          className="h-[2px] rounded-full bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-400"
          style={{ width: `${v}%` }}
        />
      </div>
    </div>
  );
}

function EscToClose({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return null;
}

/* ───────────────── Settings helpers ───────────────── */
type Targets = Record<string /*locId*/, Record<string /*sku_code*/, number>>;

function ensureBaseDefaults(base: any) {
  const out = base && typeof base === 'object' ? { ...base } : {};
  out.version = 2;
  const t = out.location_targets && typeof out.location_targets === 'object' ? out.location_targets : {};
  out.location_targets = t;
  return out;
}

function normalizeTargets(input: any, locIds: string[], skuCodes: string[]): Targets {
  const raw = input?.location_targets;
  const out: Targets = {};
  for (const locId of locIds) {
    const row = raw?.[locId] && typeof raw?.[locId] === 'object' ? raw[locId] : {};
    const m: Record<string, number> = {};
    for (const code of skuCodes) {
      const v = row?.[code];
      const n = clampNum(v, NaN);
      m[code] = Number.isFinite(n) ? Math.max(0, Math.round(n)) : DEFAULT_TARGET;
    }
    out[locId] = m;
  }
  return out;
}

/* ───────────────── Purchase modal ───────────────── */
function PurchaseCreateModal({
  open,
  locations,
  skus,
  defaultLocationId,
  onClose,
  onCreate,
  busy,
}: {
  open: boolean;
  locations: LocationRow[];
  skus: ConsumableSku[];
  defaultLocationId: string | null;
  onClose: () => void;
  onCreate: (payload: {
    to_location_id: string;
    status: PoStatus;
    eta_date: string | null;
    comment: string | null;
    qty: Record<string, number>;
  }) => Promise<void>;
  busy: boolean;
}) {
  const [toLoc, setToLoc] = useState<string>('');
  const [status, setStatus] = useState<PoStatus>('in_transit');
  const [eta, setEta] = useState<string>('');
  const [comment, setComment] = useState<string>('');
  const [q, setQ] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setToLoc(defaultLocationId ?? (locations[0]?.id ?? ''));
    setStatus('in_transit');
    setEta('');
    setComment('');
    const init: Record<string, string> = {};
    for (const s of skus) init[s.code] = '';
    setQ(init);
  }, [open, defaultLocationId, locations, skus]);

  if (!open) return null;

  const locOptions = locations.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  function parseQty(code: string) {
    const x = nInt(q[code] ?? '');
    return Number.isFinite(x) && x > 0 ? x : 0;
  }

  async function submit() {
    if (!toLoc) return;
    const qtyObj: Record<string, number> = {};
    for (const s of skus) qtyObj[s.code] = parseQty(s.code);

    const sumQty = Object.values(qtyObj).reduce((a, b) => a + (b || 0), 0);
    if (sumQty <= 0) return;

    await onCreate({
      to_location_id: toLoc,
      status,
      eta_date: eta ? eta : null,
      comment: comment.trim() ? comment.trim() : null,
      qty: qtyObj,
    });
  }

  return (
    <div className="fixed inset-0 z-[260]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div
        className={cls(
          'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(1040px,calc(100%-24px))]',
          'rounded-2xl bg-white/95 ring-1 ring-sky-200/70 shadow-[0_30px_120px_rgba(0,0,0,0.65)] backdrop-blur-xl',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 sm:p-5 border-b border-slate-200/70 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className={cls(UI.iconPillBase, UI.iconPillTeal)}>
                <Truck className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500">Закупки</div>
                <div className="text-[18px] font-semibold text-slate-900">Добавить “в пути”</div>
                <div className={cls(UI.subtle, 'mt-1')}>
                  После “Получено” всё придёт в <span className={UI.subStrong}>Центральный склад</span>.
                </div>
              </div>
            </div>
          </div>

          <button className={cls(UI.btnBase, UI.btnGhost)} onClick={busy ? undefined : onClose}>
            <X className="h-4 w-4" />
            Закрыть
          </button>
        </div>

        <div className="p-4 sm:p-5 grid gap-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="grid gap-1">
              <div className={UI.tiny}>Куда (для заметки)</div>
              <select className={UI.input} value={toLoc} onChange={(e) => setToLoc(e.target.value)}>
                {locOptions.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} {l.kind === 'warehouse' ? '(склад)' : '(филиал)'}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <div className={UI.tiny}>Статус</div>
              <select className={UI.input} value={status} onChange={(e) => setStatus(e.target.value as PoStatus)}>
                <option value="ordered">Заказано</option>
                <option value="in_transit">В пути</option>
                <option value="draft">Черновик</option>
              </select>
            </div>
            <div className="grid gap-1">
              <div className={UI.tiny}>ETA (дата)</div>
              <input className={UI.input} type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
            </div>
          </div>

          <div className={cls(UI.tableWrap)}>
            <div className="p-4 border-b border-slate-200/70">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Количество</div>
                  <div className={UI.tiny}>Заполни только то, что реально в этой закупке.</div>
                </div>
                <LegendChip tone="info" icon={<Sparkles className="h-3.5 w-3.5" />}>
                  Быстрый ввод
                </LegendChip>
              </div>
            </div>

            <div className="p-4 grid gap-3 md:grid-cols-3">
              {skus.map((s) => (
                <div key={s.code} className="grid gap-1">
                  <div className={UI.tiny}>{s.name_ru}</div>
                  <input
                    className={UI.input}
                    inputMode="numeric"
                    value={q[s.code] ?? ''}
                    onChange={(e) => setQ((p) => ({ ...p, [s.code]: e.target.value }))}
                    placeholder="0"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-1">
            <div className={UI.tiny}>Комментарий</div>
            <textarea className={UI.textarea} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        </div>

        <div className="p-4 sm:p-5 border-t border-slate-200/70 flex items-center justify-end gap-2">
          <button className={cls(UI.btnBase, UI.btnSoft)} onClick={busy ? undefined : onClose}>
            Отмена
          </button>
          <button className={cls(UI.btnBase, UI.btnPrimary)} onClick={busy ? undefined : submit} disabled={busy}>
            <Plus className="h-4 w-4" />
            {busy ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>

        <EscToClose onClose={busy ? () => {} : onClose} />
      </div>
    </div>
  );
}

/* ───────────────── Purchases menu ───────────────── */
function RowMenu({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="absolute right-0 top-full mt-2 z-[40]">
      <div className="rounded-2xl bg-white/95 ring-1 ring-sky-200/70 shadow-[0_22px_70px_rgba(15,23,42,0.20)] overflow-hidden min-w-[200px] backdrop-blur-xl">
        {children}
      </div>
      <div className="fixed inset-0 z-[-1]" onClick={onClose} />
    </div>
  );
}

function MenuItem({
  tone = 'normal',
  onClick,
  children,
}: {
  tone?: 'normal' | 'danger';
  onClick: () => void;
  children: ReactNode;
}) {
  const c = tone === 'danger' ? 'text-rose-700 hover:bg-rose-50' : 'text-slate-800 hover:bg-sky-50/60';
  return (
    <button
      type="button"
      className={cls('w-full text-left px-3 py-2 text-[13px] font-semibold', c)}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ───────────────── Branch Drawer (Control panel) ───────────────── */
type DrawerRowFilter = 'need' | 'all' | 'critical';

function BranchEditorDrawer({
  open,
  loc,
  central,
  skus,

  getCurrent,
  getInTransit,
  getTarget,
  setTarget,

  isTargetDirty,
  centralAvailable,

  onTransferFromCentral,
  onSetFact,

  showToast,
  onClose,
  initialFocusSku,
  onFocusConsumed,
}: {
  open: boolean;
  loc: LocationRow | null;
  central: LocationRow | null;
  skus: ConsumableSku[];

  getCurrent: (sku: string) => number;
  getInTransit: (sku: string) => number;
  getTarget: (sku: string) => number;
  setTarget: (sku: string, nextTarget: number) => void;

  isTargetDirty: (sku: string) => boolean;
  centralAvailable: (sku: string) => number;

  onTransferFromCentral: (sku: string, qty: number, comment?: string) => Promise<void>;
  onSetFact: (sku: string, factQty: number, comment?: string) => Promise<void>;

  showToast: (s: string) => void;
  onClose: () => void;

  initialFocusSku: string | null;
  onFocusConsumed: () => void;
}) {
  const [comment, setComment] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [shipQty, setShipQty] = useState<Record<string, string>>({});
  const [factQty, setFactQty] = useState<Record<string, string>>({});

  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'ship' | 'fact'>('ship');
  const [filter, setFilter] = useState<DrawerRowFilter>('need');

  const tableRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setComment('');
    setBusyKey(null);
    setQ('');
    setTab('ship');
    setFilter('need');
    const initShip: Record<string, string> = {};
    const initFact: Record<string, string> = {};
    for (const s of skus) {
      initShip[s.code] = '';
      initFact[s.code] = '';
    }
    setShipQty(initShip);
    setFactQty(initFact);
  }, [open, loc?.id, skus]);

  const rowsAll = useMemo(() => {
    return skus.map((s) => {
      const current = getCurrent(s.code);
      const inTransit = getInTransit(s.code);
      const target = getTarget(s.code);
      const need = needToOrder(current, inTransit, target);

      const pctNow = pctProgress(current, target);
      const pctWithTransit = pctProgress(current + inTransit, target);

      const critical = target > 0 && need > 0 && pctWithTransit < 20;
      const warn = target > 0 && need > 0 && !critical;

      const tone: 'bad' | 'warn' | 'ok' | 'neutral' =
        target <= 0 ? 'neutral' : critical ? 'bad' : warn ? 'warn' : 'ok';

      return {
        ...s,
        current,
        inTransit,
        target,
        need,
        pctNow,
        pctWithTransit,
        tone,
        critical,
        warn,
        dirty: isTargetDirty(s.code),
      };
    });
  }, [skus, getCurrent, getInTransit, getTarget, isTargetDirty]);

  const rows = useMemo(() => {
    const query = (q || '').trim().toLowerCase();
    const filtered = !query
      ? rowsAll
      : rowsAll.filter(
          (r) =>
            (r.name_ru || '').toLowerCase().includes(query) ||
            (r.code || '').toLowerCase().includes(query),
        );

    const afterFilter =
      filter === 'all'
        ? filtered
        : filter === 'critical'
          ? filtered.filter((r) => r.critical)
          : filtered.filter((r) => r.target > 0 && r.need > 0);

    const sorted = afterFilter.slice().sort((a, b) => {
      if (b.critical !== a.critical) return Number(b.critical) - Number(a.critical);
      if (b.need !== a.need) return b.need - a.need;
      return (a.sort_order ?? 100) - (b.sort_order ?? 100);
    });

    return sorted;
  }, [rowsAll, q, filter]);

  const needCount = useMemo(() => rowsAll.filter((r) => r.target > 0 && r.need > 0).length, [rowsAll]);
  const totalNeed = useMemo(() => sum(rowsAll.map((r) => (r.target > 0 ? r.need : 0))), [rowsAll]);
  const totalInTransit = useMemo(() => sum(rowsAll.map((r) => r.inTransit || 0)), [rowsAll]);

  const top10Need = useMemo(() => {
    return rowsAll
      .filter((r) => r.target > 0 && r.need > 0)
      .slice()
      .sort((a, b) => b.need - a.need)
      .slice(0, 10);
  }, [rowsAll]);

  function fillShipmentByNeed() {
    if (!central) {
      showToast('Нет центрального склада');
      return;
    }
    const next: Record<string, string> = { ...(shipQty || {}) };
    for (const r of rowsAll) {
      if (r.target <= 0) continue;
      if (r.need <= 0) continue;
      const avail = Math.max(0, centralAvailable(r.code));
      const v = Math.max(0, Math.min(r.need, avail));
      if (v > 0) next[r.code] = String(v);
    }
    setShipQty(next);
    showToast('Отгрузка заполнена по need (с учётом остатка центрального)');
  }

  async function runTransfer(code: string) {
    const qty = nInt(shipQty[code] ?? '');
    if (!Number.isFinite(qty) || qty <= 0) {
      showToast('Количество должно быть > 0');
      return;
    }
    if (!central) {
      showToast('Нет центрального склада');
      return;
    }

    const key = `ship:${code}`;
    try {
      setBusyKey(key);
      await onTransferFromCentral(code, qty, comment);
      setShipQty((p) => ({ ...p, [code]: '' }));
      showToast('Перемещение учтено');
    } catch (e: any) {
      showToast(e?.message ?? 'Ошибка операции');
    } finally {
      setBusyKey((x) => (x === key ? null : x));
    }
  }

  async function runSetFact(code: string) {
    const qty = nInt(factQty[code] ?? '');
    if (!Number.isFinite(qty) || qty < 0) {
      showToast('Факт должен быть ≥ 0');
      return;
    }

    const key = `fact:${code}`;
    try {
      setBusyKey(key);
      await onSetFact(code, qty, comment);
      setFactQty((p) => ({ ...p, [code]: '' }));
      showToast('Факт обновлён');
    } catch (e: any) {
      showToast(e?.message ?? 'Ошибка операции');
    } finally {
      setBusyKey((x) => (x === key ? null : x));
    }
  }

  // focus sku (from heatmap click)
  useEffect(() => {
    if (!open) return;
    if (!initialFocusSku) return;
    const id = `sku-row-${initialFocusSku}`;
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      onFocusConsumed();
    } else {
      // fallback: scroll table to top
      tableRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      onFocusConsumed();
    }
  }, [open, initialFocusSku, onFocusConsumed]);

  if (!open || !loc) return null;

  return (
    <div className="fixed inset-0 z-[240]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div
        className={cls(
          'absolute inset-y-0 right-0 w-full max-w-[1100px]',
          'bg-white/92 backdrop-blur-xl ring-1 ring-sky-200/70 shadow-[0_30px_120px_rgba(0,0,0,0.65)]',
          'flex flex-col',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-slate-200/70">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className={UI.badge}>
                  <Package className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] text-slate-500">Пульт филиала</div>
                  <div className="text-[18px] font-semibold text-slate-900 truncate">{loc.name}</div>
                  <div className={cls(UI.subtle, 'mt-1')}>
                    <span className={UI.subStrong}>цели</span> • <span className={UI.subStrong}>отгрузка</span> •{' '}
                    <span className={UI.subStrong}>факт</span>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {needCount > 0 ? (
                  <Chip tone="warn">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Недостача позиций: {needCount}
                  </Chip>
                ) : (
                  <Chip tone="ok">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Всё в норме
                  </Chip>
                )}
                {!central ? (
                  <Chip tone="bad">Центральный склад не найден</Chip>
                ) : (
                  <Chip tone="neutral">Источник: {central.name}</Chip>
                )}
              </div>
            </div>

            <button className={cls(UI.btnBase, UI.btnGhost)} onClick={onClose} title="Закрыть">
              <X className="h-4 w-4" />
              Закрыть
            </button>
          </div>

          {/* Mini analytics */}
          <div className="mt-5 grid gap-3 lg:grid-cols-12">
            <div className="lg:col-span-8 grid gap-3 sm:grid-cols-3">
              <div className={cls(UI.statBase, UI.statWarn)}>
                <div className={UI.statK}>Недостача позиций</div>
                <div className={UI.statV}>{needCount}</div>
                <div className={UI.statS}>SKU где need &gt; 0</div>
              </div>
              <div className={cls(UI.statBase, UI.statSky)}>
                <div className={UI.statK}>Всего нужно</div>
                <div className={UI.statV}>{totalNeed > 0 ? `+${fmt(totalNeed)}` : '0'}</div>
                <div className={UI.statS}>target - current - inTransit</div>
              </div>
              <div className={cls(UI.statBase, totalInTransit > 0 ? UI.statWarn : UI.statOk)}>
                <div className={UI.statK}>В пути</div>
                <div className={UI.statV}>{fmt(totalInTransit)}</div>
                <div className={UI.statS}>в эту локацию</div>
              </div>
            </div>

            <div className="lg:col-span-4 rounded-2xl bg-white/85 ring-1 ring-sky-200/70 shadow-[0_14px_34px_rgba(15,23,42,0.10)] backdrop-blur-xl p-4">
              <div className="flex items-center justify-between">
                <div className="text-[12px] font-semibold text-slate-800">Top-10 SKU по need</div>
                <BarChart3 className="h-4 w-4 text-slate-500" />
              </div>
              <div className="mt-3 grid gap-2">
                {top10Need.length === 0 ? (
                  <div className="text-[12px] text-slate-500">Нет недостачи.</div>
                ) : (
                  top10Need.map((r) => {
                    const maxNeed = Math.max(1, top10Need[0]?.need || 1);
                    const w = Math.round((r.need / maxNeed) * 100);
                    return (
                      <button
                        key={r.code}
                        type="button"
                        className="text-left group"
                        onClick={() => {
                          const el = document.getElementById(`sku-row-${r.code}`);
                          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }}
                      >
                        <div className="flex items-center justify-between gap-2 text-[12px]">
                          <div className="min-w-0 truncate">
                            <span className="font-semibold text-slate-900 group-hover:underline">{r.name_ru}</span>{' '}
                            <span className="text-slate-400">{r.code}</span>
                          </div>
                          <div className="tabular-nums font-semibold text-amber-800">+{fmt(r.need)}</div>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-slate-200/70 overflow-hidden">
                          <div
                            className="h-2 rounded-full bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400"
                            style={{ width: `${w}%` }}
                          />
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="mt-5 grid gap-4">
            <div className="grid gap-2 lg:grid-cols-2">
              <div className="grid gap-1">
                <div className={UI.tiny}>Поиск по позициям</div>
                <SearchInput value={q} onChange={setQ} placeholder="Например: наклейки, пакеты, cloth…" />
              </div>
              <div className="grid gap-1">
                <div className={UI.tiny}>Комментарий (общий, необязательно)</div>
                <input value={comment} onChange={(e) => setComment(e.target.value)} className={UI.input} />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className={UI.tabsWrap}>
                <button
                  type="button"
                  className={cls(UI.tabBtn, tab === 'ship' ? UI.tabActive : UI.tabIdle)}
                  onClick={() => setTab('ship')}
                >
                  Пополнить
                </button>
                <button
                  type="button"
                  className={cls(UI.tabBtn, tab === 'fact' ? UI.tabActive : UI.tabIdle)}
                  onClick={() => setTab('fact')}
                >
                  Факт
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={cls(UI.btnBase, UI.btnSoft, 'px-3 py-2')}
                  onClick={() => setFilter('need')}
                >
                  {filter === 'need' ? <CheckCircle2 className="h-4 w-4" /> : <Dot className="h-4 w-4" />}
                  Только need
                </button>
                <button
                  type="button"
                  className={cls(UI.btnBase, UI.btnSoft, 'px-3 py-2')}
                  onClick={() => setFilter('critical')}
                >
                  {filter === 'critical' ? <AlertTriangle className="h-4 w-4" /> : <Dot className="h-4 w-4" />}
                  Только критично
                </button>
                <button
                  type="button"
                  className={cls(UI.btnBase, UI.btnSoft, 'px-3 py-2')}
                  onClick={() => setFilter('all')}
                >
                  {filter === 'all' ? <Grid3X3 className="h-4 w-4" /> : <Dot className="h-4 w-4" />}
                  Показать норму
                </button>

                {tab === 'ship' && (
                  <button
                    type="button"
                    className={cls(UI.btnBase, UI.btnGhost, 'px-3 py-2')}
                    onClick={fillShipmentByNeed}
                    disabled={!central}
                    title="Автоподставит min(need, остаток центрального)"
                  >
                    <Sparkles className="h-4 w-4" />
                    Заполнить отгрузку по need
                  </button>
                )}
              </div>
            </div>

            {tab === 'ship' ? (
              <div className={UI.tiny}>
                Перемещение: <span className={UI.subStrong}>Центральный → {loc.name}</span>. Enter в поле “Отгрузить”
                тоже работает.
              </div>
            ) : (
              <div className={UI.tiny}>“Факт” — установить точный остаток (дельта посчитается автоматически).</div>
            )}
          </div>
        </div>

        {/* Body */}
        <div ref={tableRef as any} className="flex-1 overflow-y-auto p-5 sm:p-6">
          <div className={UI.tableWrap}>
            <table className={UI.table}>
              <thead>
                <tr>
                  <th className={UI.th}>Позиция</th>
                  <th className={cls(UI.th, 'w-[90px]')}>Тек.</th>
                  <th className={cls(UI.th, 'w-[130px]')}>Цель</th>
                  <th className={cls(UI.th, 'w-[90px]')}>В пути</th>
                  <th className={cls(UI.th, 'w-[170px]')}>Нужно</th>
                  {tab === 'ship' ? (
                    <>
                      <th className={cls(UI.th, 'w-[140px]')}>Отгрузить</th>
                      <th className={cls(UI.th, 'w-[140px]')}></th>
                    </>
                  ) : (
                    <>
                      <th className={cls(UI.th, 'w-[140px]')}>Факт</th>
                      <th className={cls(UI.th, 'w-[140px]')}></th>
                    </>
                  )}
                </tr>
              </thead>

              <tbody>
                {rows.map((r) => {
                  const toneDot = r.tone === 'bad' ? 'bad' : r.tone === 'warn' ? 'warn' : r.tone === 'ok' ? 'ok' : 'neutral';
                  const isBusy = busyKey === (tab === 'ship' ? `ship:${r.code}` : `fact:${r.code}`);

                  const focusRing = initialFocusSku === r.code ? 'ring-2 ring-cyan-400/70' : '';

                  return (
                    <tr
                      key={r.code}
                      id={`sku-row-${r.code}`}
                      className={cls(UI.trHover, focusRing)}
                    >
                      <td className={UI.td}>
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="pt-1">
                            <StatusDot tone={toneDot} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-900 truncate">{r.name_ru}</div>
                                <div className="text-[11px] text-slate-500 truncate">{r.code}</div>
                              </div>
                              <div className="shrink-0 flex items-center gap-2">
                                {r.critical ? (
                                  <Chip tone="bad">
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                    Критично
                                  </Chip>
                                ) : r.warn ? (
                                  <Chip tone="warn">
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                    Низко
                                  </Chip>
                                ) : r.target > 0 ? (
                                  <Chip tone="ok">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Ок
                                  </Chip>
                                ) : (
                                  <Chip tone="neutral">—</Chip>
                                )}

                                {r.dirty ? (
                                  <Chip tone="info">
                                    <CircleDashed className="h-3.5 w-3.5" />
                                    • не сохранено
                                  </Chip>
                                ) : null}
                              </div>
                            </div>

                            {r.target > 0 ? <ProgressBar valuePct={r.pctNow} /> : null}
                          </div>
                        </div>
                      </td>

                      <td className={cls(UI.td, 'tabular-nums font-semibold')}>{fmt(r.current)}</td>

                      <td className={UI.td}>
                        <input
                          className={cls(
                            UI.input,
                            'h-9 py-1.5 text-[13px]',
                            r.dirty && 'ring-2 ring-cyan-400/70',
                          )}
                          type="number"
                          min={0}
                          step={10}
                          value={String(r.target)}
                          onChange={(e) => setTarget(r.code, Number(e.target.value))}
                        />
                      </td>

                      <td className={cls(UI.td, 'tabular-nums')}>{fmt(r.inTransit)}</td>

                      <td className={UI.td}>
                        {r.target > 0 ? (
                          r.need > 0 ? (
                            <div>
                              <div className="flex items-center justify-between">
                                <span className="tabular-nums font-semibold text-amber-800">+{fmt(r.need)}</span>
                                <span className="text-[11px] text-slate-500 tabular-nums">
                                  {fmt(r.pctWithTransit)}%
                                </span>
                              </div>
                              <MiniProgress valuePct={r.pctWithTransit} />
                            </div>
                          ) : (
                            <div>
                              <div className="flex items-center justify-between">
                                <span className="text-emerald-700 font-semibold">Ок</span>
                                <span className="text-[11px] text-slate-500 tabular-nums">{fmt(r.pctWithTransit)}%</span>
                              </div>
                              <MiniProgress valuePct={r.pctWithTransit} />
                            </div>
                          )
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {tab === 'ship' ? (
                        <>
                          <td className={UI.td}>
                            <input
                              className={cls(UI.input, 'h-9 py-1.5 text-[13px]')}
                              inputMode="numeric"
                              placeholder="0"
                              value={shipQty[r.code] ?? ''}
                              onChange={(e) => setShipQty((p) => ({ ...p, [r.code]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') runTransfer(r.code);
                              }}
                            />
                            {central ? (
                              <div className="mt-1 text-[11px] text-slate-500">
                                Остаток центрального: <span className="tabular-nums font-semibold">{fmt(centralAvailable(r.code))}</span>
                              </div>
                            ) : null}
                          </td>
                          <td className={UI.td}>
                            <button
                              className={cls(UI.btnBase, UI.btnPrimary, 'w-full')}
                              onClick={() => runTransfer(r.code)}
                              disabled={isBusy || !central}
                              title={central ? 'Центральный → филиал' : 'Нет центрального склада'}
                            >
                              {isBusy ? '...' : 'Провести'}
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className={UI.td}>
                            <input
                              className={cls(UI.input, 'h-9 py-1.5 text-[13px]')}
                              inputMode="numeric"
                              placeholder="0"
                              value={factQty[r.code] ?? ''}
                              onChange={(e) => setFactQty((p) => ({ ...p, [r.code]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') runSetFact(r.code);
                              }}
                            />
                          </td>
                          <td className={UI.td}>
                            <button
                              className={cls(UI.btnBase, UI.btnGhost, 'w-full')}
                              onClick={() => runSetFact(r.code)}
                              disabled={isBusy}
                            >
                              {isBusy ? '...' : 'Установить'}
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}

                {rows.length === 0 && (
                  <tr>
                    <td className={cls(UI.td, 'py-8')} colSpan={7}>
                      <div className="text-sm text-slate-700">Ничего не найдено (проверь фильтр/поиск).</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {!central && tab === 'ship' && (
            <div className="mt-4 rounded-2xl bg-gradient-to-br from-white via-rose-50 to-amber-50/85 ring-1 ring-rose-200/70 p-4 text-sm text-rose-800 shadow-[0_22px_70px_rgba(15,23,42,0.18)] backdrop-blur-xl">
              Нельзя делать “Пополнить”, пока не найден центральный склад.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 sm:p-6 border-t border-slate-200/70 flex items-center justify-end gap-2">
          <button className={cls(UI.btnBase, UI.btnSoft)} onClick={onClose}>
            Закрыть
          </button>
        </div>

        <EscToClose onClose={onClose} />
      </div>
    </div>
  );
}

/* ───────────────── Overview visuals (no deps) ───────────────── */
function Sparkline({
  points,
}: {
  points: number[];
}) {
  const w = 360;
  const h = 90;
  const pad = 8;
  const maxV = Math.max(1, ...points.map((x) => Number(x) || 0));
  const minV = Math.min(0, ...points.map((x) => Number(x) || 0));
  const span = Math.max(1, maxV - minV);

  const step = points.length <= 1 ? 0 : (w - pad * 2) / (points.length - 1);

  const coords = points.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (h - pad * 2) * (1 - ((Number(v) || 0) - minV) / span);
    return `${x},${y}`;
  });

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[90px]">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        points={coords.join(' ')}
        className="text-slate-700"
      />
      <line x1="0" y1={h - 1} x2={w} y2={h - 1} stroke="rgba(148,163,184,0.35)" strokeWidth="1" />
    </svg>
  );
}

function Donut({
  segments,
  onPick,
}: {
  segments: { key: PoStatus; label: string; value: number; color: string }[];
  onPick: (k: PoStatus | 'all') => void;
}) {
  const total = Math.max(1, sum(segments.map((s) => s.value)));
  let acc = 0;
  const stops = segments
    .map((s) => {
      const a0 = acc;
      const a1 = acc + (s.value / total) * 100;
      acc = a1;
      return `${s.color} ${a0.toFixed(2)}% ${a1.toFixed(2)}%`;
    })
    .join(', ');

  return (
    <div className="flex items-center gap-4">
      <div
        className="h-[120px] w-[120px] rounded-full"
        style={{
          background: `conic-gradient(${stops})`,
        }}
        title="Статусы закупок"
      >
        <div className="h-full w-full grid place-items-center">
          <div className="h-[78px] w-[78px] rounded-full bg-white/90 ring-1 ring-sky-200/70 shadow-[0_14px_34px_rgba(15,23,42,0.10)] backdrop-blur" />
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold text-slate-800">Клик по статусу → фильтр закупок</div>
        <div className="mt-2 grid gap-2">
          <button
            type="button"
            className={cls(UI.btnBase, UI.btnSoft, 'justify-between px-3 py-2')}
            onClick={() => onPick('all')}
          >
            <span className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />
              Все
            </span>
            <span className="tabular-nums font-semibold">{fmt(total)}</span>
          </button>
          {segments.map((s) => (
            <button
              key={s.key}
              type="button"
              className={cls(UI.btnBase, UI.btnSoft, 'justify-between px-3 py-2')}
              onClick={() => onPick(s.key)}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                <span className="truncate">{s.label}</span>
              </span>
              <span className="tabular-nums font-semibold">{fmt(s.value)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────────── Page ───────────────── */
type TabKey = 'overview' | 'branches' | 'purchases' | 'central';
type KpiFilter = 'none' | 'critical' | 'shortage' | 'need' | 'in_transit' | 'coverage_low';

type UiEvent = {
  id: string;
  ts: string; // ISO
  label: string;
  kind: 'po' | 'transfer' | 'fact';
  poId?: string;
  branchId?: string;
};

export default function WarehousePage() {
  const sb = useMemo(getSb, []);

  /* auth */
  const [userId, setUserId] = useState<string | null>(null);

  /* data */
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [skus, setSkus] = useState<ConsumableSku[]>([]);
  const [balances, setBalances] = useState<VBalanceRow[]>([]);
  const [inTransitRows, setInTransitRows] = useState<InTransitRow[]>([]);
  const [purchases, setPurchases] = useState<PurchaseOrder[]>([]);

  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  /* settings */
  const [targets, setTargets] = useState<Record<string, Record<string, number>>>({});
  const baseSettingsRef = useRef<any>(null);

  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsErr, setSettingsErr] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  const savedTargetsRef = useRef<Record<string, Record<string, number>>>({}); // to show dirty rings

  /* toast */
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((s: string) => {
    setToast(s);
    window.setTimeout(() => setToast(null), 1600);
  }, []);

  /* ui */
  const [tab, setTab] = useState<TabKey>('overview');
  const [kpiFilter, setKpiFilter] = useState<KpiFilter>('none');

  const [branchSearch, setBranchSearch] = useState('');
  const [onlyNeedBranches, setOnlyNeedBranches] = useState(true);
  const [branchStatusChip, setBranchStatusChip] = useState<'all' | 'critical' | 'low' | 'ok'>('all');
  const [withInTransitOnly, setWithInTransitOnly] = useState(false);
  const [branchLayout, setBranchLayout] = useState<'cards' | 'table'>('cards');

  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [expandedPoId, setExpandedPoId] = useState<string | null>(null);
  const [poMenuId, setPoMenuId] = useState<string | null>(null);
  const [purchaseStatusFilter, setPurchaseStatusFilter] = useState<PoStatus | 'all'>('all');

  const [centralMode, setCentralMode] = useState<'logistics' | 'coverage'>('logistics');

  /* branch editor */
  const [branchEditorId, setBranchEditorId] = useState<string | null>(null);
  const [branchFocusSku, setBranchFocusSku] = useState<string | null>(null);

  /* purchase modal */
  const [poOpen, setPoOpen] = useState(false);
  const [poBusy, setPoBusy] = useState(false);

  /* info modal */
  const [helpOpen, setHelpOpen] = useState(false);

  /* timeline */
  const [sessionEvents, setSessionEvents] = useState<UiEvent[]>([]);

  /* RPC names */
  const RPC_TRANSFER = 'inv_consumable_transfer';
  const RPC_ADJUST = 'inv_consumable_adjustment';
  const RPC_RECEIVE = 'inv_purchase_order_receive_to_central';

  /* ───────────── derived: central + branches + maps ───────────── */
  const warehouses = useMemo(() => locations.filter((l) => l.kind === 'warehouse'), [locations]);

  const centralLoc = useMemo(() => {
    const byName =
      warehouses.find((l) => l.name.toLowerCase().includes('централь')) ??
      warehouses.find((l) => l.name.toLowerCase().includes('central')) ??
      warehouses.find((l) => l.name.toLowerCase().includes('main'));
    return byName ?? warehouses[0] ?? null;
  }, [warehouses]);

  const shopLocsAll = useMemo(() => {
    return locations
      .filter((l) => l.kind === 'shop')
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [locations]);

  const skuList = useMemo(
    () => skus.filter((s) => s.is_active).slice().sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100)),
    [skus],
  );
  const skuCodes = useMemo(() => skuList.map((s) => s.code), [skuList]);

  const qtyMap = useMemo(() => {
    const m = new Map<string, number>(); // key: sku|locId
    for (const r of balances) {
      const key = `${r.sku_code}|${r.location_id}`;
      const add = Number.isFinite(Number(r.qty)) ? Number(r.qty) : 0;
      m.set(key, (m.get(key) ?? 0) + add);
    }
    return m;
  }, [balances]);

  const inTransitMap = useMemo(() => {
    const m = new Map<string, number>(); // key: sku|locId
    for (const r of inTransitRows) {
      const code = String(r.sku_code || '');
      const locId = String(r.location_id || '');
      if (!code || !locId) continue;
      const key = `${code}|${locId}`;
      const add = Number.isFinite(Number(r.qty)) ? Number(r.qty) : 0;
      m.set(key, (m.get(key) ?? 0) + add);
    }
    return m;
  }, [inTransitRows]);

  const cellQty = useCallback((sku: string, locId: string) => qtyMap.get(`${sku}|${locId}`) ?? 0, [qtyMap]);
  const cellInTransit = useCallback((sku: string, locId: string) => inTransitMap.get(`${sku}|${locId}`) ?? 0, [inTransitMap]);

  const branchEditorLoc = useMemo(() => {
    if (!branchEditorId) return null;
    return shopLocsAll.find((x) => x.id === branchEditorId) ?? null;
  }, [branchEditorId, shopLocsAll]);

  const getTarget = useCallback(
    (locId: string, sku: string) => {
      const v = targets?.[locId]?.[sku];
      const n = clampNum(v, NaN);
      if (Number.isFinite(n)) return Math.max(0, Math.round(n));
      return DEFAULT_TARGET;
    },
    [targets],
  );

  const isTargetDirtyFor = useCallback(
    (locId: string, sku: string) => {
      const cur = Math.max(0, Math.round(clampNum(targets?.[locId]?.[sku], DEFAULT_TARGET)));
      const saved = Math.max(0, Math.round(clampNum(savedTargetsRef.current?.[locId]?.[sku], DEFAULT_TARGET)));
      return cur !== saved;
    },
    [targets],
  );

  // SKU total need across network (for heatmap and central coverage)
  const skuNeedTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const sku of skuCodes) {
      let total = 0;
      for (const b of shopLocsAll) {
        const cur = cellQty(sku, b.id);
        const it = cellInTransit(sku, b.id);
        const tgt = getTarget(b.id, sku);
        const need = needToOrder(cur, it, tgt);
        if (tgt > 0 && need > 0) total += need;
      }
      m.set(sku, total);
    }
    return m;
  }, [skuCodes, shopLocsAll, cellQty, cellInTransit, getTarget]);

  const topHeatSkus = useMemo(() => {
    const items = skuList.map((s) => ({ ...s, totalNeed: skuNeedTotals.get(s.code) ?? 0 }));
    items.sort((a, b) => (b.totalNeed - a.totalNeed) || (a.sort_order ?? 100) - (b.sort_order ?? 100));
    return items.slice(0, 15);
  }, [skuList, skuNeedTotals]);

  // Branch metrics for Control Tower
  const branchesMetricsAll = useMemo(() => {
    const q = branchSearch.trim().toLowerCase();
    const base = !q ? shopLocsAll : shopLocsAll.filter((l) => (l.name || '').toLowerCase().includes(q));

    return base.map((loc) => {
      let needPositions = 0;
      let totalNeed = 0;
      let totalInTransit = 0;

      let criticalPositions = 0; // coverage < 20% (with transit)
      let normPositions = 0;
      let targetCells = 0;

      let sumTarget = 0;
      let sumCovered = 0;

      for (const sku of skuCodes) {
        const cur = cellQty(sku, loc.id);
        const it = cellInTransit(sku, loc.id);
        const tgt = getTarget(loc.id, sku);

        totalInTransit += it;

        if (tgt > 0) {
          targetCells += 1;
          const pctWithTransit = pctProgress(cur + it, tgt);
          if (needToOrder(cur, it, tgt) <= 0) normPositions += 1;
          if (needToOrder(cur, it, tgt) > 0 && pctWithTransit < 20) criticalPositions += 1;

          sumTarget += tgt;
          sumCovered += Math.min(tgt, cur + it);
        }

        const need = needToOrder(cur, it, tgt);
        if (tgt > 0 && need > 0) {
          needPositions += 1;
          totalNeed += need;
        }
      }

      const coveragePct = targetCells > 0 ? Math.round((normPositions / targetCells) * 100) : 0;
      const coverageAgg = sumTarget > 0 ? Math.round((sumCovered / sumTarget) * 100) : 0;

      const status: 'ok' | 'low' | 'critical' =
        needPositions === 0 ? 'ok' : criticalPositions > 0 ? 'critical' : 'low';

      return { loc, needPositions, totalNeed, totalInTransit, criticalPositions, coveragePct, coverageAgg, status };
    });
  }, [shopLocsAll, branchSearch, skuCodes, cellQty, cellInTransit, getTarget]);

  // KPI global
  const kpi = useMemo(() => {
    const totalTargetCells = shopLocsAll.length * skuCodes.length;
    let normCells = 0;
    let criticalCells = 0;

    let branchesWithNeed = 0;
    let totalNeed = 0;

    for (const b of branchesMetricsAll) {
      if (b.needPositions > 0) branchesWithNeed += 1;
      totalNeed += b.totalNeed;
    }

    for (const b of shopLocsAll) {
      for (const sku of skuCodes) {
        const tgt = getTarget(b.id, sku);
        if (tgt <= 0) continue;
        const cur = cellQty(sku, b.id);
        const it = cellInTransit(sku, b.id);
        const need = needToOrder(cur, it, tgt);
        const pctWithTransit = pctProgress(cur + it, tgt);
        if (need <= 0) normCells += 1;
        if (need > 0 && pctWithTransit < 20) criticalCells += 1;
      }
    }

    const coverage = totalTargetCells > 0 ? Math.round((normCells / totalTargetCells) * 100) : 0;

    return { totalTargetCells, normCells, criticalCells, branchesWithNeed, totalNeed, coverage };
  }, [shopLocsAll, skuCodes, branchesMetricsAll, cellQty, cellInTransit, getTarget]);

  const branchesFiltered = useMemo(() => {
    let rows = branchesMetricsAll.slice();

    // KPI quick filter
    if (kpiFilter === 'critical') rows = rows.filter((r) => r.status === 'critical');
    if (kpiFilter === 'shortage') rows = rows.filter((r) => r.needPositions > 0);
    if (kpiFilter === 'in_transit') rows = rows.filter((r) => r.totalInTransit > 0);
    if (kpiFilter === 'coverage_low') rows = rows.filter((r) => r.coveragePct < 70);
    if (kpiFilter === 'need') rows = rows.filter((r) => r.totalNeed > 0);

    // Branch tab chips
    if (branchStatusChip === 'critical') rows = rows.filter((r) => r.status === 'critical');
    if (branchStatusChip === 'low') rows = rows.filter((r) => r.status === 'low');
    if (branchStatusChip === 'ok') rows = rows.filter((r) => r.status === 'ok');

    if (withInTransitOnly) rows = rows.filter((r) => r.totalInTransit > 0);

    if (onlyNeedBranches) rows = rows.filter((r) => r.needPositions > 0);

    rows.sort((a, b) => {
      if (b.status !== a.status) {
        const rank = (s: typeof a.status) => (s === 'critical' ? 2 : s === 'low' ? 1 : 0);
        return rank(b.status) - rank(a.status);
      }
      if (b.totalNeed !== a.totalNeed) return b.totalNeed - a.totalNeed;
      if (b.needPositions !== a.needPositions) return b.needPositions - a.needPositions;
      return a.loc.name.localeCompare(b.loc.name, 'ru');
    });

    return rows;
  }, [branchesMetricsAll, kpiFilter, branchStatusChip, withInTransitOnly, onlyNeedBranches]);

  const centralRows = useMemo(() => {
    if (!centralLoc) return [];
    const rowsAll = skuList.map((s) => {
      const q = cellQty(s.code, centralLoc.id);
      const it = cellInTransit(s.code, centralLoc.id);
      return { ...s, qty: q, inTransit: it, sum: q + it };
    });

    rowsAll.sort((a, b) => (b.inTransit - a.inTransit) || (b.sum - a.sum) || (a.sort_order ?? 100) - (b.sort_order ?? 100));
    return rowsAll;
  }, [centralLoc, skuList, cellQty, cellInTransit]);

  const centralInTransitTotal = useMemo(() => {
    return centralRows.reduce((sum2, r) => sum2 + (r.inTransit || 0), 0);
  }, [centralRows]);

  const centralAvailable = useCallback(
    (sku: string) => {
      if (!centralLoc) return 0;
      return Math.max(0, cellQty(sku, centralLoc.id));
    },
    [centralLoc, cellQty],
  );

  const locName = useCallback(
    (id: string) => {
      const l = locations.find((x) => x.id === id);
      return l?.name ?? '—';
    },
    [locations],
  );

  function statusBadge(s: PoStatus) {
    const meta =
      s === 'received'
        ? { label: 'Получено', tone: 'ok' as const }
        : s === 'in_transit'
          ? { label: 'В пути', tone: 'info' as const }
          : s === 'ordered'
            ? { label: 'Заказано', tone: 'warn' as const }
            : s === 'canceled'
              ? { label: 'Отменено', tone: 'bad' as const }
              : { label: 'Черновик', tone: 'neutral' as const };

    return <Chip tone={meta.tone}>{meta.label}</Chip>;
  }

  /* ───────────── purchases + donut + line ───────────── */
  const poTotals = useMemo(() => {
    return purchases.map((po) => {
      const items = po.inv_purchase_order_items ?? [];
      const totalQty = sum(items.map((i) => i.qty || 0));
      return { ...po, totalQty, itemsCount: items.length };
    });
  }, [purchases]);

  const poStatusCounts = useMemo(() => {
    const m: Record<PoStatus, number> = { draft: 0, ordered: 0, in_transit: 0, received: 0, canceled: 0 };
    for (const po of purchases) m[po.status] = (m[po.status] ?? 0) + 1;
    return m;
  }, [purchases]);

  const donutSegments = useMemo(() => {
    return [
      { key: 'draft' as const, label: 'Черновик', value: poStatusCounts.draft, color: '#94a3b8' },
      { key: 'ordered' as const, label: 'Заказано', value: poStatusCounts.ordered, color: '#f59e0b' },
      { key: 'in_transit' as const, label: 'В пути', value: poStatusCounts.in_transit, color: '#22d3ee' },
      { key: 'received' as const, label: 'Получено', value: poStatusCounts.received, color: '#34d399' },
      { key: 'canceled' as const, label: 'Отменено', value: poStatusCounts.canceled, color: '#fb7185' },
    ];
  }, [poStatusCounts]);

  const purchasesFiltered = useMemo(() => {
    const q = purchaseSearch.trim().toLowerCase();

    let rows = poTotals.slice();

    if (purchaseStatusFilter !== 'all') rows = rows.filter((po) => po.status === purchaseStatusFilter);

    if (q) {
      rows = rows.filter((po) => {
        const title = (po.title || '').toLowerCase();
        const cmt = (po.comment || '').toLowerCase();
        return title.includes(q) || cmt.includes(q) || (po.id || '').toLowerCase().includes(q);
      });
    }

    return rows;
  }, [poTotals, purchaseSearch, purchaseStatusFilter]);

  // In-transit trend (approx by PO created_at / received_at)
  const inTransitTrend = useMemo(() => {
    const days = 21;
    const today = new Date();
    const out: { label: string; value: number }[] = [];

    const poRanges = poTotals.map((po) => {
      const start = parseISO(po.created_at) ?? new Date();
      const end = parseISO(po.received_at || null); // null => still open
      const qty = po.totalQty || 0;
      const activeStatuses: PoStatus[] = ['ordered', 'in_transit', 'draft'];
      const isCounted = activeStatuses.includes(po.status) || (!!po.received_at && po.status === 'received');
      return { id: po.id, start, end, qty, isCounted };
    });

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dk = dayKeyISO(d);
      let v = 0;

      for (const r of poRanges) {
        if (!r.isCounted) continue;
        const sKey = dayKeyISO(r.start);
        const eKey = r.end ? dayKeyISO(r.end) : null;

        const started = sKey <= dk;
        const notEnded = !eKey || dk < eKey; // treat received day as already arrived (step down)
        if (started && notEnded) v += r.qty;
      }

      out.push({ label: dk.slice(5), value: v });
    }

    return out;
  }, [poTotals]);

  const inTransitTrendPoints = useMemo(() => inTransitTrend.map((x) => x.value), [inTransitTrend]);

  /* ───────────── timeline events ───────────── */
  const derivedEvents = useMemo(() => {
    const ev: UiEvent[] = [];

    for (const po of poTotals) {
      ev.push({
        id: `po:create:${po.id}`,
        ts: po.created_at,
        label: `PO #${po.id.slice(0, 6)} создан • ${po.title || 'без названия'}`,
        kind: 'po',
        poId: po.id,
      });

      if (po.ordered_at) {
        ev.push({
          id: `po:ordered:${po.id}`,
          ts: po.ordered_at,
          label: `PO #${po.id.slice(0, 6)} отмечен как “заказано/в пути”`,
          kind: 'po',
          poId: po.id,
        });
      }

      if (po.received_at) {
        ev.push({
          id: `po:received:${po.id}`,
          ts: po.received_at,
          label: `PO #${po.id.slice(0, 6)} получен → приход на центральный`,
          kind: 'po',
          poId: po.id,
        });
      }
    }

    ev.push(...sessionEvents);

    ev.sort((a, b) => (a.ts < b.ts ? 1 : -1));
    return ev.slice(0, 10);
  }, [poTotals, sessionEvents]);

  /* ───────────── operations (RPC) ───────────── */
  async function doTransfer(fromId: string, toId: string, sku: string, qty: number, comment?: string) {
    const { error } = await sb.rpc(
      RPC_TRANSFER,
      { p_from_location_id: fromId, p_to_location_id: toId, p_sku_code: sku, p_qty: qty, p_comment: (comment || '').trim() || null } as any,
    );
    if (error) throw error;
  }

  async function doAdjustment(locationId: string, sku: string, factQty: number, comment?: string) {
    const { error } = await sb.rpc(
      RPC_ADJUST,
      { p_location_id: locationId, p_sku_code: sku, p_fact_qty: factQty, p_comment: (comment || '').trim() || null } as any,
    );
    if (error) throw error;
  }

  async function doReceiveToCentral(poId: string, comment?: string) {
    if (!centralLoc) throw new Error('Нет центрального склада');
    const { error } = await sb.rpc(
      RPC_RECEIVE,
      { p_po_id: poId, p_central_location_id: centralLoc.id, p_comment: (comment || '').trim() || null } as any,
    );
    if (error) throw error;
  }

  async function loadAll() {
    setErr(null);

    const [authRes, locRes, skuRes, balRes, itRes, poRes] = await Promise.all([
      sb.auth.getUser(),
      sb.from('locations').select('id,name,kind').order('kind').order('name'),
      sb.from('inv_consumable_skus').select('code,name_ru,is_active,sort_order').order('sort_order').limit(2000),
      sb.from('v_consumable_balances').select('*').limit(20000),
      sb.from('v_consumable_in_transit').select('*').limit(20000),
      sb
        .from('inv_purchase_orders')
        .select(
          `
          id, created_at, status, to_location_id, title, comment, eta_date, ordered_at, received_at, received_to_location_id,
          inv_purchase_order_items ( id, sku_type, qty, unit_price, currency )
        `,
        )
        .order('created_at', { ascending: false })
        .limit(30),
    ]);

    setUserId(authRes.data?.user?.id ?? null);

    if (locRes.error) throw locRes.error;
    if (skuRes.error) throw skuRes.error;
    if (balRes.error) throw balRes.error;
    if (itRes.error) throw itRes.error;
    if (poRes.error) throw poRes.error;

    setLocations((locRes.data ?? []) as any);
    setSkus((skuRes.data ?? []) as any);
    setBalances((balRes.data ?? []) as any);
    setInTransitRows((itRes.data ?? []) as any);
    setPurchases((poRes.data ?? []) as any);

    setLastUpdatedAt(new Date());
  }

  /* ───────────── targets save/load ───────────── */
  function saveSettingsSoon() {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveSettingsNow().catch(() => {});
    }, 650);
  }

  const setTargetForLoc = useCallback((locId: string, sku: string, nextTarget: number) => {
    const value = Math.max(0, Math.round(clampNum(nextTarget, 0)));
    setTargets((prev) => {
      const baseRow = prev?.[locId] ?? {};
      return { ...(prev ?? {}), [locId]: { ...baseRow, [sku]: value } };
    });
    saveSettingsSoon();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applySettings(obj: any, locIds: string[], skuCodes2: string[]) {
    const base = ensureBaseDefaults(obj);
    baseSettingsRef.current = base;
    const norm = normalizeTargets(base, locIds, skuCodes2);
    setTargets(norm);
    savedTargetsRef.current = norm;
  }

  async function loadSettings(locIds: string[], skuCodes2: string[]) {
    setSettingsErr(null);

    // 1) DB
    try {
      const { data, error } = await sb.from('app_settings').select('key,value_json,value').eq('key', SETTINGS_KEY).maybeSingle();
      if (error) throw error;

      const raw: any = (data as any)?.value_json ?? (data as any)?.value ?? null;
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        applySettings(parsed, locIds, skuCodes2);
      } else {
        baseSettingsRef.current = ensureBaseDefaults(null);
        const norm = normalizeTargets(baseSettingsRef.current, locIds, skuCodes2);
        setTargets(norm);
        savedTargetsRef.current = norm;
      }
      return;
    } catch {
      // ignore
    }

    // 2) localStorage
    try {
      const raw = localStorage.getItem(`wh.settings.${SETTINGS_KEY}`);
      if (raw) applySettings(JSON.parse(raw), locIds, skuCodes2);
      else {
        baseSettingsRef.current = ensureBaseDefaults(null);
        const norm = normalizeTargets(baseSettingsRef.current, locIds, skuCodes2);
        setTargets(norm);
        savedTargetsRef.current = norm;
      }
    } catch {
      baseSettingsRef.current = ensureBaseDefaults(null);
      const norm = normalizeTargets(baseSettingsRef.current, locIds, skuCodes2);
      setTargets(norm);
      savedTargetsRef.current = norm;
    }
  }

  async function saveSettingsNow() {
    setSettingsErr(null);
    setSettingsBusy(true);

    const base = ensureBaseDefaults(baseSettingsRef.current);
    const locIds = shopLocsAll.map((s) => s.id);

    const out: Record<string, Record<string, number>> = {};
    for (const locId of locIds) {
      const row = targets?.[locId] ?? {};
      const m: Record<string, number> = {};
      for (const sku of skuCodes) m[sku] = Math.max(0, Math.round(clampNum(row[sku], DEFAULT_TARGET)));
      out[locId] = m;
    }

    const payload = { ...base, location_targets: out };
    baseSettingsRef.current = payload;

    try {
      const { error } = await sb.from('app_settings').upsert({ key: SETTINGS_KEY, value_json: payload } as any, { onConflict: 'key' } as any);
      if (error) throw error;
      savedTargetsRef.current = out;
      return;
    } catch (e1: any) {
      try {
        const { error } = await sb.from('app_settings').upsert({ key: SETTINGS_KEY, value: JSON.stringify(payload) } as any, { onConflict: 'key' } as any);
        if (error) throw error;
        savedTargetsRef.current = out;
        return;
      } catch (e2: any) {
        try {
          localStorage.setItem(`wh.settings.${SETTINGS_KEY}`, JSON.stringify(payload));
          setSettingsErr(`Не удалось сохранить в БД (сохранено локально): ${e2?.message ?? e1?.message ?? 'ошибка'}`);
        } catch (e3: any) {
          setSettingsErr(e3?.message ?? 'Не удалось сохранить настройки');
        }
      }
    } finally {
      setSettingsBusy(false);
    }
  }

  /* ───────────── purchases ops ───────────── */
  async function createPurchase(payload: {
    to_location_id: string;
    status: PoStatus;
    eta_date: string | null;
    comment: string | null;
    qty: Record<string, number>;
  }) {
    setPoBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const titleParts: string[] = [];

      for (const s of skuList) {
        const q2 = payload.qty[s.code] || 0;
        if (q2 > 0) titleParts.push(`${s.name_ru} ${q2}`);
      }
      const title = titleParts.length ? titleParts.join(' • ') : null;

      const orderedAt = payload.status === 'ordered' || payload.status === 'in_transit' ? nowIso : null;

      const { data: poRow, error: poErr } = await sb
        .from('inv_purchase_orders')
        .insert({
          to_location_id: payload.to_location_id,
          status: payload.status,
          eta_date: payload.eta_date,
          comment: payload.comment,
          title,
          ordered_at: orderedAt,
        } as any)
        .select('id')
        .single();

      if (poErr) throw poErr;
      const poId = (poRow as any)?.id as string;
      if (!poId) throw new Error('Не удалось создать закупку');

      const items = skuList
        .map((s) => ({ sku_type: s.code, qty: payload.qty[s.code] || 0 }))
        .filter((x) => x.qty > 0)
        .map((x) => ({ po_id: poId, sku_type: x.sku_type, qty: x.qty }));

      if (items.length) {
        const { error: itErr } = await sb.from('inv_purchase_order_items').insert(items as any);
        if (itErr) throw itErr;
      }

      setSessionEvents((prev) => [
        {
          id: `sess:po:create:${poId}:${Date.now()}`,
          ts: nowIso,
          label: `PO #${poId.slice(0, 6)} создан (через “Добавить в пути”)`,
          kind: 'po',
          poId,
        },
        ...prev,
      ]);

      showToast('Закупка добавлена');
      setPoOpen(false);
      await loadAll();
    } finally {
      setPoBusy(false);
    }
  }

  async function setPurchaseStatus(poId: string, next: PoStatus) {
    try {
      const patch: any = { status: next };
      const nowIso = new Date().toISOString();
      if (next === 'in_transit' || next === 'ordered') patch.ordered_at = nowIso;

      const { error } = await sb.from('inv_purchase_orders').update(patch).eq('id', poId);
      if (error) throw error;

      setSessionEvents((prev) => [
        {
          id: `sess:po:status:${poId}:${Date.now()}`,
          ts: nowIso,
          label: `PO #${poId.slice(0, 6)} статус → ${next}`,
          kind: 'po',
          poId,
        },
        ...prev,
      ]);

      showToast('Статус обновлён');
      await loadAll();
    } catch (e: any) {
      showToast(e?.message ?? 'Ошибка обновления');
    }
  }

  async function receivePurchase(poId: string) {
    try {
      const nowIso = new Date().toISOString();
      await doReceiveToCentral(poId, 'Получено через склад расходников');

      setSessionEvents((prev) => [
        {
          id: `sess:po:received:${poId}:${Date.now()}`,
          ts: nowIso,
          label: `PO #${poId.slice(0, 6)} получен → приход на центральный`,
          kind: 'po',
          poId,
        },
        ...prev,
      ]);

      showToast('Поступление на центральный склад');
      await loadAll();
    } catch (e: any) {
      showToast(e?.message ?? 'Ошибка “Получено”');
    }
  }

  /* ───────────── mount ───────────── */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        await loadAll();
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? 'Ошибка загрузки');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // как только знаем локации+sku — подгружаем targets (один раз)
  const didInitSettings = useRef(false);
  useEffect(() => {
    if (didInitSettings.current) return;
    if (shopLocsAll.length === 0) return;
    if (skuCodes.length === 0) return;
    didInitSettings.current = true;
    loadSettings(shopLocsAll.map((s) => s.id), skuCodes).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopLocsAll.length, skuCodes.length]);

  /* ───────────── KPI click behavior ───────────── */
  const toggleKpi = useCallback((k: KpiFilter) => {
    setKpiFilter((prev) => (prev === k ? 'none' : k));
  }, []);

  /* ───────────── Overview: bar chart data ───────────── */
  const overviewBars = useMemo(() => {
    const rows = branchesMetricsAll
      .slice()
      .sort((a, b) => (b.totalNeed - a.totalNeed) || (b.needPositions - a.needPositions) || a.loc.name.localeCompare(b.loc.name, 'ru'))
      .slice(0, 10);
    const maxNeed = Math.max(1, ...rows.map((r) => r.totalNeed || 0));
    return { rows, maxNeed };
  }, [branchesMetricsAll]);

  const overviewTop3 = useMemo(() => {
    const rows = branchesMetricsAll
      .filter((r) => r.needPositions > 0)
      .slice()
      .sort((a, b) => (b.totalNeed - a.totalNeed) || (b.needPositions - a.needPositions))
      .slice(0, 3);
    return rows;
  }, [branchesMetricsAll]);

  /* ───────────── Heatmap ───────────── */
  const heatmapRows = useMemo(() => {
    const skus2 = topHeatSkus;
    const branches = shopLocsAll;

    return branches.map((b) => {
      const cells = skus2.map((s) => {
        const cur = cellQty(s.code, b.id);
        const it = cellInTransit(s.code, b.id);
        const tgt = getTarget(b.id, s.code);
        const pct = tgt > 0 ? pctProgress(cur + it, tgt) : 0;
        const need = needToOrder(cur, it, tgt);

        let tone: 'bad' | 'warn' | 'ok' | 'neutral' = 'neutral';
        if (tgt <= 0) tone = 'neutral';
        else if (need > 0 && pct < 20) tone = 'bad';
        else if (need > 0 && pct < 70) tone = 'warn';
        else tone = 'ok';

        return { sku: s, pct, need, tone };
      });

      return { branch: b, cells };
    });
  }, [topHeatSkus, shopLocsAll, cellQty, cellInTransit, getTarget]);

  /* ───────────── Central coverage table ───────────── */
  const centralCoverageTop = useMemo(() => {
    const items = skuList
      .map((s) => {
        const totalNeed = skuNeedTotals.get(s.code) ?? 0;
        const onHand = centralLoc ? cellQty(s.code, centralLoc.id) : 0;
        const it = centralLoc ? cellInTransit(s.code, centralLoc.id) : 0;
        return { ...s, totalNeed, onHand, inTransit: it };
      })
      .filter((x) => x.totalNeed > 0)
      .sort((a, b) => (b.totalNeed - a.totalNeed) || (a.sort_order ?? 100) - (b.sort_order ?? 100))
      .slice(0, 15);

    const maxNeed = Math.max(1, ...items.map((x) => x.totalNeed));
    return { items, maxNeed };
  }, [skuList, skuNeedTotals, centralLoc, cellQty, cellInTransit]);

  const [skuWaitListOpen, setSkuWaitListOpen] = useState(false);
  const [skuWaitSku, setSkuWaitSku] = useState<ConsumableSku | null>(null);

  const skuWaitBranches = useMemo(() => {
    if (!skuWaitSku) return [];
    const sku = skuWaitSku.code;
    const rows = branchesMetricsAll
      .map((b) => {
        const cur = cellQty(sku, b.loc.id);
        const it = cellInTransit(sku, b.loc.id);
        const tgt = getTarget(b.loc.id, sku);
        const need = needToOrder(cur, it, tgt);
        return { branch: b.loc, need, inTransit: it, cur, tgt };
      })
      .filter((x) => x.tgt > 0 && x.need > 0)
      .sort((a, b) => b.need - a.need);
    return rows;
  }, [skuWaitSku, branchesMetricsAll, cellQty, cellInTransit, getTarget]);



     /* ───────────────── Render ───────────────── */
  return (
    <div className={UI.shell}>
      <div className={UI.glowWrap}>
        <div className={UI.glowA} />
        <div className={UI.glowB} />
        <div className={UI.glowC} />
      </div>

      <div className={UI.container}>


        {/* Header */}
        <div className={UI.headerWrap}>
          <div className={UI.headerInner}>
            <div className="min-w-0 flex items-start gap-4">
              <div className={UI.badge}>
                <Warehouse className="h-5 w-5" />
              </div>

              <div className="min-w-0">
                <div className={UI.h1}>Склад расходников</div>
                <div className={cls(UI.sub, 'mt-2 flex flex-wrap items-center gap-2')}>
                  <span>Центральный → филиалы • Закупки → приход на склад</span>
                  <span className="text-slate-400">•</span>
                  <span className={cls(UI.subStrong, 'tabular-nums')}>
                    обновлено {lastUpdatedAt ? formatTimeOnly(lastUpdatedAt) : '—'}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {settingsBusy ? (
                    <LegendChip tone="info" icon={<CircleDashed className="h-3.5 w-3.5 animate-spin" />}>
                      Сохранение целей…
                    </LegendChip>
                  ) : settingsErr ? (
                    <LegendChip tone="bad" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
                      Ошибка сохранения
                    </LegendChip>
                  ) : (
                    <LegendChip tone="ok" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
                      Цели: сохранено
                    </LegendChip>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:items-end">
              <div className="flex flex-wrap items-center gap-2 justify-start lg:justify-end">
                <button
                  className={cls(UI.btnBase, UI.btnPrimary)}
                  onClick={() => setPoOpen(true)}
                  disabled={!userId || (skuList?.length ?? 0) === 0}
                >
                  <Plus className="h-4 w-4" />
                  Добавить в пути
                </button>

                <button
                  className={cls(UI.btnBase, UI.btnGhost)}
                  onClick={() => loadAll().catch((e) => setErr(e?.message ?? 'Ошибка'))}
                >
                  <RefreshCw className="h-4 w-4" />
                  Обновить
                </button>

                <Link href={SUPPLIERS_PAGE} className={cls(UI.btnBase, UI.btnSoft)} title="Открыть поставщиков">
                  Поставщики
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="flex flex-wrap items-center gap-2 justify-start lg:justify-end">
                <div className={UI.tabsWrap}>
                  <button
                    type="button"
                    className={cls(UI.tabBtn, tab === 'overview' ? UI.tabActive : UI.tabIdle)}
                    onClick={() => setTab('overview')}
                  >
                    <LayoutDashboard className="h-4 w-4" />
                    Обзор
                  </button>
                  <button
                    type="button"
                    className={cls(UI.tabBtn, tab === 'branches' ? UI.tabActive : UI.tabIdle)}
                    onClick={() => setTab('branches')}
                  >
                    Филиалы
                  </button>
                  <button
                    type="button"
                    className={cls(UI.tabBtn, tab === 'purchases' ? UI.tabActive : UI.tabIdle)}
                    onClick={() => setTab('purchases')}
                  >
                    Закупки
                  </button>
                  <button
                    type="button"
                    className={cls(UI.tabBtn, tab === 'central' ? UI.tabActive : UI.tabIdle)}
                    onClick={() => setTab('central')}
                  >
                    Центральный
                  </button>
                </div>

                <button
                  type="button"
                  className={cls(UI.btnBase, UI.btnSoft, 'px-3.5')}
                  onClick={() => setHelpOpen(true)}
                >
                  <Info className="h-4 w-4" />
                  Что делает “Получено”
                </button>
              </div>
            </div>
          </div>

          {/* messages */}
          <div className="px-5 sm:px-6 pb-5 sm:pb-6">
            {!userId && (
              <div className="rounded-2xl bg-gradient-to-br from-white via-rose-50 to-amber-50/85 ring-1 ring-rose-200/70 px-4 py-3 text-sm text-rose-800 shadow-[0_22px_70px_rgba(15,23,42,0.18)] backdrop-blur-xl">
                Вы не авторизованы. Войдите в систему.
              </div>
            )}
            {err && (
              <div className="mt-3 rounded-2xl bg-gradient-to-br from-white via-amber-50 to-amber-50/85 ring-1 ring-amber-200/70 px-4 py-3 text-sm text-amber-800 shadow-[0_22px_70px_rgba(15,23,42,0.18)] backdrop-blur-xl">
                {err}
              </div>
            )}
            {settingsErr && (
              <div className="mt-3 rounded-2xl bg-gradient-to-br from-white via-amber-50 to-amber-50/85 ring-1 ring-amber-200/70 px-4 py-3 text-sm text-amber-800 shadow-[0_22px_70px_rgba(15,23,42,0.18)] backdrop-blur-xl">
                {settingsErr}
              </div>
            )}
            {loading && <div className="mt-3 text-sm text-slate-600">Загрузка…</div>}

            {/* KPI strip */}
            <div className="mt-5 overflow-x-auto">
              <div className="flex gap-3 pb-1">
                <StatBox
                  tone="bad"
                  title="Критично"
                  value={kpi.criticalCells}
                  sub="позиций &lt; 20% покрытия"
                  icon={<AlertTriangle className="h-4 w-4" />}
                  active={kpiFilter === 'critical'}
                  onClick={() => toggleKpi('critical')}
                />
                <StatBox
                  tone="warn"
                  title="Недостача"
                  value={kpi.branchesWithNeed}
                  sub="филиалов с need&gt;0"
                  icon={<AlertTriangle className="h-4 w-4" />}
                  active={kpiFilter === 'shortage'}
                  onClick={() => toggleKpi('shortage')}
                />
                <StatBox
                  tone="sky"
                  title="Всего нужно"
                  value={kpi.totalNeed > 0 ? `+${fmt(kpi.totalNeed)}` : '0'}
                  sub="по всем филиалам"
                  icon={<Package className="h-4 w-4" />}
                  active={kpiFilter === 'need'}
                  onClick={() => toggleKpi('need')}
                />
                <StatBox
                  tone={centralInTransitTotal > 0 ? 'warn' : 'sky'}
                  title="В пути на центральный"
                  value={fmt(centralInTransitTotal)}
                  sub={centralLoc ? `локация: ${centralLoc.name}` : 'центральный не найден'}
                  icon={<Truck className="h-4 w-4" />}
                  active={kpiFilter === 'in_transit'}
                  onClick={() => toggleKpi('in_transit')}
                />
                <StatBox
                  tone={kpi.coverage >= 80 ? 'ok' : kpi.coverage >= 50 ? 'warn' : 'bad'}
                  title="Покрытие"
                  value={`${fmt(kpi.coverage)}%`}
                  sub="% позиций в норме"
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  active={kpiFilter === 'coverage_low'}
                  onClick={() => toggleKpi('coverage_low')}
                />
                <StatBox
                  tone={settingsErr ? 'bad' : settingsBusy ? 'warn' : 'ok'}
                  title="Сохранение целей"
                  value={settingsErr ? 'Ошибка' : settingsBusy ? 'Сохр…' : 'Ок'}
                  sub={settingsErr ? 'см. сообщение выше' : settingsBusy ? 'в процессе' : 'в БД'}
                  icon={settingsErr ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                />
              </div>
            </div>

            {kpiFilter !== 'none' && (
              <div className="mt-3 text-[12px] text-slate-600">
                Фильтр KPI активен: <span className={UI.kbd}>{kpiFilter}</span> (клик по KPI ещё раз — снять).
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="mt-6 grid gap-6">
          {/* TAB: Overview */}
          {tab === 'overview' && (
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Left: where it burns */}
              <div className={UI.section}>
                <div className={UI.sectionHead}>
                  <div className="min-w-0">
                    <div className={UI.sectionTitle}>
                      <span className={cls(UI.iconPillBase, UI.iconPillAmber)}>
                        <BarChart3 className="h-4 w-4" />
                      </span>
                      Где горит
                    </div>
                    <div className={UI.sectionHint}>Недостача по филиалам (клик по строке → открыть пульт филиала).</div>
                  </div>
                </div>

                {/* Bar chart */}
                <div className="mt-5 grid gap-2">
                  {(overviewBars?.rows ?? []).map((r) => {
                    const denom = Math.max(1, overviewBars?.maxNeed ?? 1);
                    const w = Math.round((Math.max(0, r.totalNeed) / denom) * 100);
                    const halo =
                      r.status === 'critical'
                        ? 'ring-2 ring-rose-300/70'
                        : r.status === 'low'
                          ? 'ring-2 ring-amber-300/70'
                          : '';
                    return (
                      <button
                        key={r.loc.id}
                        type="button"
                        className={cls(
                          'text-left rounded-2xl bg-white/80 ring-1 ring-sky-200/70 shadow-[0_12px_30px_rgba(15,23,42,0.10)] backdrop-blur p-4 hover:brightness-[1.02]',
                          halo,
                        )}
                        onClick={() => {
                          setBranchEditorId(r.loc.id);
                          setBranchFocusSku(null);
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 truncate">{r.loc.name}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              {r.status === 'critical' ? (
                                <Chip tone="bad">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  Критично
                                </Chip>
                              ) : r.status === 'low' ? (
                                <Chip tone="warn">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  Недостача
                                </Chip>
                              ) : (
                                <Chip tone="ok">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Ок
                                </Chip>
                              )}
                              <Chip tone="neutral">need: {fmt(r.needPositions)} поз.</Chip>
                              <Chip tone="neutral">в пути: {fmt(r.totalInTransit)}</Chip>
                            </div>
                          </div>

                          <div className="tabular-nums text-right">
                            <div className="text-[11px] text-slate-500">Всего нужно</div>
                            <div className="text-[20px] font-semibold text-slate-900">
                              {r.totalNeed > 0 ? `+${fmt(r.totalNeed)}` : '0'}
                            </div>
                          </div>
                        </div>

                        <div className="mt-3">
                          <div className="h-3 rounded-full bg-slate-200/70 overflow-hidden">
                            <div
                              className="h-3 rounded-full bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400"
                              style={{ width: `${clamp(w, 0, 100)}%` }}
                            />
                          </div>
                          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                            <span>Недостача: {fmt(r.needPositions)} поз.</span>
                            <span className="tabular-nums">в пути: {fmt(r.totalInTransit)}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 pt-5 border-t border-slate-200/70">
                  <div className="text-[12px] font-semibold text-slate-800">Топ-3 филиала (быстрый доступ)</div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {(overviewTop3 ?? []).length === 0 ? (
                      <div className="text-[12px] text-slate-500">Сейчас недостачи нет.</div>
                    ) : (
                      (overviewTop3 ?? []).map((r) => (
                        <button
                          key={r.loc.id}
                          type="button"
                          className={cls(
                            'rounded-2xl bg-white/85 ring-1 ring-sky-200/70 shadow-[0_12px_30px_rgba(15,23,42,0.10)] backdrop-blur p-4 text-left hover:brightness-[1.02]',
                          )}
                          onClick={() => {
                            setBranchEditorId(r.loc.id);
                            setBranchFocusSku(null);
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900 truncate">{r.loc.name}</div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Chip tone={r.status === 'critical' ? 'bad' : r.status === 'low' ? 'warn' : 'ok'}>
                                  {r.status === 'critical' ? (
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                  ) : r.status === 'low' ? (
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                  ) : (
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                  )}
                                  {r.status === 'critical' ? 'Критично' : r.status === 'low' ? 'Недостача' : 'Ок'}
                                </Chip>
                                <Chip tone="neutral">need: {fmt(r.needPositions)}</Chip>
                              </div>
                            </div>
                            <div className="tabular-nums text-right">
                              <div className="text-[11px] text-slate-500">Всего</div>
                              <div className="text-[18px] font-semibold text-slate-900">
                                {r.totalNeed > 0 ? `+${fmt(r.totalNeed)}` : '0'}
                              </div>
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Right: heatmap */}
              <div className={UI.section}>
                <div className={UI.sectionHead}>
                  <div className="min-w-0">
                    <div className={UI.sectionTitle}>
                      <span className={cls(UI.iconPillBase, UI.iconPillSky)}>
                        <Grid3X3 className="h-4 w-4" />
                      </span>
                      Теплокарта SKU × филиалы
                    </div>
                    <div className={UI.sectionHint}>
                      15 самых “горячих” SKU по сети. Клик по ячейке → открыть пульт филиала с фокусом SKU.
                    </div>
                  </div>
                </div>

                <div className="mt-5 overflow-x-auto">
                  <div className="min-w-[920px]">
                    <div
                      className="grid"
                      style={{ gridTemplateColumns: `240px repeat(${topHeatSkus?.length ?? 0}, 1fr)` }}
                    >
                      {/* header */}
                      <div className="px-3 py-2 text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
                        Филиал
                      </div>
                      {(topHeatSkus ?? []).map((s) => (
                        <div key={s.code} className="px-2 py-2 text-[11px] font-semibold text-slate-600 text-center">
                          <div className="truncate" title={s.name_ru}>
                            {s.name_ru}
                          </div>
                          <div className="text-[10px] text-slate-400">{s.code}</div>
                        </div>
                      ))}

                      {/* rows */}
                      {(heatmapRows ?? []).map((r) => (
                        <Fragment key={r.branch.id}>
                          <div className="px-3 py-2 border-t border-slate-200/60">
                            <div className="font-semibold text-slate-900 truncate">{r.branch.name}</div>
                            <div className="text-[11px] text-slate-500">клик по ячейке → пульт</div>
                          </div>

                          {r.cells.map((c) => {
                            const bg =
                              c.tone === 'bad'
                                ? 'bg-rose-100 ring-rose-200'
                                : c.tone === 'warn'
                                  ? 'bg-amber-100 ring-amber-200'
                                  : c.tone === 'ok'
                                    ? 'bg-emerald-100 ring-emerald-200'
                                    : 'bg-slate-100 ring-slate-200';
                            const text =
                              c.tone === 'bad'
                                ? 'text-rose-900'
                                : c.tone === 'warn'
                                  ? 'text-amber-900'
                                  : c.tone === 'ok'
                                    ? 'text-emerald-900'
                                    : 'text-slate-700';

                            const tip = `${r.branch.name} • ${c.sku.name_ru}\nПокрытие (с путём): ${fmt(
                              c.pct,
                            )}%\nНужно: +${fmt(c.need)}`;

                            return (
                              <button
                                key={`${r.branch.id}|${c.sku.code}`}
                                type="button"
                                className={cls('px-2 py-2 border-t border-slate-200/60 text-center', 'rounded-none')}
                                title={tip}
                                onClick={() => {
                                  setBranchEditorId(r.branch.id);
                                  setBranchFocusSku(c.sku.code);
                                }}
                              >
                                <div className={cls('mx-auto w-full max-w-[54px] rounded-xl ring-1', bg, 'py-2')}>
                                  <div className={cls('text-[12px] font-semibold tabular-nums', text)}>
                                    {c.pct > 0 ? `${fmt(c.pct)}%` : '—'}
                                  </div>
                                  <div className="text-[10px] text-slate-500 tabular-nums">
                                    {c.need > 0 ? `+${fmt(c.need)}` : 'ok'}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </Fragment>
                      ))}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
                      <LegendChip tone="bad">
                        <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
                        критично (&lt;20%)
                      </LegendChip>
                      <LegendChip tone="warn">
                        <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                        низко (20–69%)
                      </LegendChip>
                      <LegendChip tone="ok">
                        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                        ок (≥70%)
                      </LegendChip>
                      <LegendChip tone="neutral">
                        <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />
                        цель = 0
                      </LegendChip>
                    </div>
                  </div>
                </div>
              </div>

              {/* Purchases + trend */}
              <div className={UI.section}>
                <div className={UI.sectionHead}>
                  <div className="min-w-0">
                    <div className={UI.sectionTitle}>
                      <span className={cls(UI.iconPillBase, UI.iconPillTeal)}>
                        <Truck className="h-4 w-4" />
                      </span>
                      Закупки и поток “в пути”
                    </div>
                    <div className={UI.sectionHint}>Клик по статусу фильтрует вкладку “Закупки”.</div>
                  </div>
                </div>

                <div className="mt-5 grid gap-5 lg:grid-cols-2">
                  <Donut
                    segments={donutSegments}
                    onPick={(k) => {
                      setTab('purchases');
                      setPurchaseStatusFilter(k);
                    }}
                  />

                  <div className="rounded-2xl bg-white/85 ring-1 ring-sky-200/70 shadow-[0_14px_34px_rgba(15,23,42,0.10)] backdrop-blur p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-slate-800">В пути (последние 21 день)</div>
                        <div className="text-[11px] text-slate-500">
                          приблизительно по открытым PO (draft/ordered/in_transit)
                        </div>
                      </div>
                      <History className="h-4 w-4 text-slate-500" />
                    </div>
                    <div className="mt-3 text-slate-700">
                      <Sparkline points={inTransitTrendPoints} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Timeline */}
              <div className={UI.section}>
                <div className={UI.sectionHead}>
                  <div className="min-w-0">
                    <div className={UI.sectionTitle}>
                      <span className={cls(UI.iconPillBase, UI.iconPillSky)}>
                        <History className="h-4 w-4" />
                      </span>
                      Последние события
                    </div>
                    <div className={UI.sectionHint}>10 последних событий (PO + действия в сессии).</div>
                  </div>
                </div>

                <div className="mt-5 grid gap-2">
                  {(derivedEvents?.length ?? 0) === 0 ? (
                    <div className="text-sm text-slate-600">Пока нет событий.</div>
                  ) : (
                    (derivedEvents ?? []).map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        className={cls(
                          'text-left rounded-2xl bg-white/85 ring-1 ring-sky-200/70 shadow-[0_12px_30px_rgba(15,23,42,0.10)] backdrop-blur p-4 hover:brightness-[1.02]',
                        )}
                        onClick={() => {
                          if (e.kind === 'po' && e.poId) {
                            setTab('purchases');
                            setExpandedPoId(e.poId);
                          } else if (e.kind === 'transfer' && e.branchId) {
                            setTab('branches');
                            setBranchEditorId(e.branchId);
                          } else if (e.kind === 'fact' && e.branchId) {
                            setTab('branches');
                            setBranchEditorId(e.branchId);
                          }
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[12px] text-slate-500 tabular-nums">{formatDateTime(e.ts)}</div>
                            <div className="mt-1 font-semibold text-slate-900">{e.label}</div>
                          </div>
                          <div className="shrink-0">
                            <ChevronRight className="h-4 w-4 text-slate-400" />
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB: Branches */}
          {tab === 'branches' && (
            <div className="grid gap-6">
              <div className={UI.section}>
                <div className={UI.sectionHead}>
                  <div className="min-w-0">
                    <div className={UI.sectionTitle}>
                      <span className={cls(UI.iconPillBase, UI.iconPillAmber)}>
                        <LayoutDashboard className="h-4 w-4" />
                      </span>
                      Филиалы
                    </div>
                    <div className={UI.sectionHint}>Клик по карточке → пульт филиала (цели/отгрузка/факт).</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className={UI.tabsWrap}>
                      <button
                        type="button"
                        className={cls(UI.tabBtn, branchLayout === 'cards' ? UI.tabActive : UI.tabIdle)}
                        onClick={() => setBranchLayout('cards')}
                        title="Карточки"
                      >
                        <LayoutDashboard className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className={cls(UI.tabBtn, branchLayout === 'table' ? UI.tabActive : UI.tabIdle)}
                        onClick={() => setBranchLayout('table')}
                        title="Таблица"
                      >
                        <List className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 lg:grid-cols-12">
                  <div className="lg:col-span-5">
                    <SearchInput value={branchSearch} onChange={setBranchSearch} placeholder="Поиск филиала…" />
                  </div>

                  <div className="lg:col-span-7 flex flex-wrap items-center gap-2 justify-start lg:justify-end">
                    <button
                      type="button"
                      className={cls(UI.btnBase, UI.btnSoft, 'px-3 py-2')}
                      onClick={() => setBranchStatusChip('all')}
                    >
                      {branchStatusChip === 'all' ? <CheckCircle2 className="h-4 w-4" /> : <Dot className="h-4 w-4" />}
                      Все
                    </button>
                    <button
                      type="button"
                      className={cls(UI.btnBase, UI.btnSoft, 'px-3 py-2')}
                      onClick={() => setBranchStatusChip('critical')}
                    >
                      {branchStatusChip === 'critical' ? (
                        <AlertTriangle className="h-4 w-4" />
                      ) : (
                        <Dot className="h-4 w-4" />
                      )}
                      Критично
                    </button>
                    <button
                      type="button"
                      className={cls(UI.btnBase, UI.btnSoft, 'px-3 py-2')}
                      onClick={() => setBranchStatusChip('low')}
                    >
                      {branchStatusChip === 'low' ? <AlertTriangle className="h-4 w-4" /> : <Dot className="h-4 w-4" />}
                      Недостача
                    </button>
                    <button
                      type="button"
                      className={cls(UI.btnBase, UI.btnSoft, 'px-3 py-2')}
                      onClick={() => setBranchStatusChip('ok')}
                    >
                      {branchStatusChip === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <Dot className="h-4 w-4" />}
                      Ок
                    </button>

                    <button
                      type="button"
                      className={cls(UI.btnBase, UI.btnGhost, 'px-3 py-2')}
                      onClick={() => setOnlyNeedBranches((p) => !p)}
                      title="Показывать только филиалы с need>0"
                    >
                      {onlyNeedBranches ? <CheckCircle2 className="h-4 w-4" /> : <Dot className="h-4 w-4" />}
                      Только need
                    </button>

                    <button
                      type="button"
                      className={cls(UI.btnBase, UI.btnGhost, 'px-3 py-2')}
                      onClick={() => setWithInTransitOnly((p) => !p)}
                      title="Только филиалы, где есть “в пути”"
                    >
                      {withInTransitOnly ? <Truck className="h-4 w-4" /> : <Dot className="h-4 w-4" />}
                      Только “в пути”
                    </button>
                  </div>
                </div>
              </div>

              {branchLayout === 'cards' ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {(branchesFiltered ?? []).map((b) => {
                    const tone = b.status === 'critical' ? 'bad' : b.status === 'low' ? 'warn' : 'ok';
                    const halo =
                      b.status === 'critical'
                        ? 'ring-2 ring-rose-300/70'
                        : b.status === 'low'
                          ? 'ring-2 ring-amber-300/70'
                          : '';
                    return (
                      <button
                        key={b.loc.id}
                        type="button"
                        className={cls(
                          'text-left rounded-3xl bg-white/75 ring-1 ring-sky-200/70 shadow-[0_22px_70px_rgba(15,23,42,0.18)] backdrop-blur p-5 hover:brightness-[1.02]',
                          halo,
                        )}
                        onClick={() => {
                          setBranchEditorId(b.loc.id);
                          setBranchFocusSku(null);
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[11px] text-slate-500">Филиал</div>
                            <div className="mt-1 text-[16px] font-semibold text-slate-900 truncate">{b.loc.name}</div>

                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <Chip tone={tone}>
                                {tone === 'bad' || tone === 'warn' ? (
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                ) : (
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                )}
                                {b.status === 'critical' ? 'Критично' : b.status === 'low' ? 'Недостача' : 'Ок'}
                              </Chip>
                              <Chip tone="neutral">need: {fmt(b.needPositions)}</Chip>
                              <Chip tone="neutral">в пути: {fmt(b.totalInTransit)}</Chip>
                            </div>
                          </div>

                          <div className="tabular-nums text-right">
                            <div className="text-[11px] text-slate-500">Всего нужно</div>
                            <div className="text-[20px] font-semibold text-slate-900">
                              {b.totalNeed > 0 ? `+${fmt(b.totalNeed)}` : '0'}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className={cls(UI.statBase, UI.statSky, 'p-3')}>
                            <div className={UI.statK}>Покрытие (позиции)</div>
                            <div className="mt-1 text-[18px] font-semibold text-slate-900 tabular-nums">
                              {fmt(b.coveragePct)}%
                            </div>
                            <div className={UI.statS}>норма / целей</div>
                          </div>
                          <div className={cls(UI.statBase, UI.statSky, 'p-3')}>
                            <div className={UI.statK}>Покрытие (объём)</div>
                            <div className="mt-1 text-[18px] font-semibold text-slate-900 tabular-nums">
                              {fmt(b.coverageAgg)}%
                            </div>
                            <div className={UI.statS}>min(target, cur+it)</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {(branchesFiltered ?? []).length === 0 && (
                    <div className="text-sm text-slate-600">Нет филиалов по текущему фильтру.</div>
                  )}
                </div>
              ) : (
                <div className={UI.tableWrap}>
                  <table className={UI.table}>
                    <thead>
                      <tr>
                        <th className={UI.th}>Филиал</th>
                        <th className={cls(UI.th, 'w-[110px]')}>Статус</th>
                        <th className={cls(UI.th, 'w-[110px]')}>need поз.</th>
                        <th className={cls(UI.th, 'w-[130px]')}>Всего нужно</th>
                        <th className={cls(UI.th, 'w-[110px]')}>В пути</th>
                        <th className={cls(UI.th, 'w-[120px]')}>Покрытие</th>
                        <th className={cls(UI.th, 'w-[120px]')}>Покр. объём</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(branchesFiltered ?? []).map((b) => (
                        <tr
                          key={b.loc.id}
                          className={cls(UI.trHover, 'cursor-pointer')}
                          onClick={() => {
                            setBranchEditorId(b.loc.id);
                            setBranchFocusSku(null);
                          }}
                        >
                          <td className={UI.td}>
                            <div className="font-semibold text-slate-900">{b.loc.name}</div>
                          </td>
                          <td className={UI.td}>
                            <Chip tone={b.status === 'critical' ? 'bad' : b.status === 'low' ? 'warn' : 'ok'}>
                              {b.status === 'critical' ? 'Критично' : b.status === 'low' ? 'Недостача' : 'Ок'}
                            </Chip>
                          </td>
                          <td className={cls(UI.td, 'tabular-nums')}>{fmt(b.needPositions)}</td>
                          <td className={cls(UI.td, 'tabular-nums font-semibold')}>
                            {b.totalNeed > 0 ? `+${fmt(b.totalNeed)}` : '0'}
                          </td>
                          <td className={cls(UI.td, 'tabular-nums')}>{fmt(b.totalInTransit)}</td>
                          <td className={cls(UI.td, 'tabular-nums')}>{fmt(b.coveragePct)}%</td>
                          <td className={cls(UI.td, 'tabular-nums')}>{fmt(b.coverageAgg)}%</td>
                        </tr>
                      ))}
                      {(branchesFiltered ?? []).length === 0 && (
                        <tr>
                          <td className={cls(UI.td, 'py-8')} colSpan={7}>
                            <div className="text-sm text-slate-700">Нет строк по текущему фильтру.</div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB: Purchases */}
          {tab === 'purchases' && (
            <div className="grid gap-6">
              <div className={UI.section}>
                <div className={UI.sectionHead}>
                  <div className="min-w-0">
                    <div className={UI.sectionTitle}>
                      <span className={cls(UI.iconPillBase, UI.iconPillTeal)}>
                        <Truck className="h-4 w-4" />
                      </span>
                      Закупки
                    </div>
                    <div className={UI.sectionHint}>
                      “Получено” делает приход на центральный склад (RPC) и помечает PO как received.
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button className={cls(UI.btnBase, UI.btnPrimary)} onClick={() => setPoOpen(true)} disabled={!userId}>
                      <Plus className="h-4 w-4" />
                      Добавить в пути
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-12">
                  <div className="lg:col-span-7">
                    <SearchInput value={purchaseSearch} onChange={setPurchaseSearch} placeholder="Поиск PO (текст/ID)…" />
                  </div>
                  <div className="lg:col-span-5">
                    <div className="rounded-2xl bg-white/85 ring-1 ring-sky-200/70 shadow-[0_14px_34px_rgba(15,23,42,0.10)] backdrop-blur p-3">
                      <Donut
                        segments={donutSegments}
                        onPick={(k) => {
                          setPurchaseStatusFilter(k);
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <Chip tone="neutral">
                    Фильтр: <span className="ml-1 tabular-nums font-semibold">{purchaseStatusFilter}</span>
                  </Chip>
                  <Chip tone="neutral">
                    Всего: <span className="ml-1 tabular-nums font-semibold">{fmt((purchasesFiltered ?? []).length)}</span>
                  </Chip>
                </div>
              </div>

              <div className="grid gap-3">
                {(purchasesFiltered ?? []).map((po) => {
                  const isOpen = expandedPoId === po.id;
                  const canReceive = po.status !== 'received' && po.status !== 'canceled';
                  const toName = locName(po.to_location_id);

                  return (
                    <div
                      key={po.id}
                      className="relative rounded-3xl bg-white/75 ring-1 ring-sky-200/70 shadow-[0_22px_70px_rgba(15,23,42,0.18)] backdrop-blur overflow-hidden"
                    >
                      <button
                        type="button"
                        className="w-full text-left p-5 sm:p-6"
                        onClick={() => setExpandedPoId((p) => (p === po.id ? null : po.id))}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-[12px] text-slate-500 tabular-nums">{formatDateTime(po.created_at)}</div>
                              {statusBadge(po.status)}
                              <Chip tone="neutral">to: {toName}</Chip>
                              <Chip tone="neutral">qty: {fmt((po as any).totalQty ?? 0)}</Chip>
                              <Chip tone="neutral">items: {fmt((po as any).itemsCount ?? 0)}</Chip>
                            </div>

                            <div className="mt-2 text-[16px] font-semibold text-slate-900">
                              {po.title || `PO #${po.id.slice(0, 8)}`}
                            </div>

                            {po.comment ? <div className="mt-1 text-[12px] text-slate-600 line-clamp-2">{po.comment}</div> : null}
                          </div>

                          <div className="shrink-0 flex items-center gap-2">
                            <button
                              type="button"
                              className={cls(UI.btnBase, UI.btnSoft, 'px-3 py-2')}
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard?.writeText(po.id).catch(() => {});
                                showToast('ID скопирован');
                              }}
                              title="Скопировать ID"
                            >
                              <span className="text-[12px] font-semibold tabular-nums">#{po.id.slice(0, 6)}</span>
                            </button>

                            <div className="relative">
                              <button
                                type="button"
                                className={cls(UI.btnBase, UI.btnGhost, 'px-3 py-2')}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPoMenuId((p) => (p === po.id ? null : po.id));
                                }}
                                title="Действия"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </button>

                              <RowMenu open={poMenuId === po.id} onClose={() => setPoMenuId(null)}>
                                <MenuItem
                                  onClick={() => {
                                    setPoMenuId(null);
                                    setPurchaseStatus(po.id, 'draft');
                                  }}
                                >
                                  Черновик
                                </MenuItem>
                                <MenuItem
                                  onClick={() => {
                                    setPoMenuId(null);
                                    setPurchaseStatus(po.id, 'ordered');
                                  }}
                                >
                                  Заказано
                                </MenuItem>
                                <MenuItem
                                  onClick={() => {
                                    setPoMenuId(null);
                                    setPurchaseStatus(po.id, 'in_transit');
                                  }}
                                >
                                  В пути
                                </MenuItem>
                                <MenuItem
                                  onClick={() => {
                                    setPoMenuId(null);
                                    setExpandedPoId(po.id);
                                    receivePurchase(po.id);
                                  }}
                                >
                                  Получено → на центральный
                                </MenuItem>
                                <MenuItem
                                  tone="danger"
                                  onClick={() => {
                                    setPoMenuId(null);
                                    setPurchaseStatus(po.id, 'canceled');
                                  }}
                                >
                                  Отменить
                                </MenuItem>
                              </RowMenu>
                            </div>

                            <ChevronDown className={cls('h-4 w-4 text-slate-400 transition', isOpen && 'rotate-180')} />
                          </div>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="border-t border-slate-200/70 px-5 sm:px-6 py-5">
                          <div className="grid gap-3 lg:grid-cols-12">
                            <div className="lg:col-span-8">
                              <div className="text-[12px] font-semibold text-slate-800">Позиции</div>

                              <div className="mt-3 overflow-x-auto">
                                <div className="min-w-[720px]">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr>
                                        <th className={UI.th}>SKU</th>
                                        <th className={cls(UI.th, 'w-[120px]')}>Кол-во</th>
                                        <th className={cls(UI.th, 'w-[140px]')}>Цена</th>
                                        <th className={cls(UI.th, 'w-[120px]')}>Валюта</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(po.inv_purchase_order_items ?? []).map((it) => {
                                        const skuName =
                                          (skuList ?? []).find((s) => s.code === it.sku_type)?.name_ru || it.sku_type;
                                        return (
                                          <tr key={it.id ?? `${po.id}:${it.sku_type}`}>
                                            <td className={UI.td}>
                                              <div className="font-semibold text-slate-900">{skuName}</div>
                                              <div className="text-[11px] text-slate-500">{it.sku_type}</div>
                                            </td>
                                            <td className={cls(UI.td, 'tabular-nums font-semibold')}>{fmt(it.qty)}</td>
                                            <td className={cls(UI.td, 'tabular-nums')}>
                                              {it.unit_price != null ? fmt(it.unit_price) : '—'}
                                            </td>
                                            <td className={UI.td}>{it.currency || '—'}</td>
                                          </tr>
                                        );
                                      })}
                                      {(po.inv_purchase_order_items ?? []).length === 0 && (
                                        <tr>
                                          <td className={cls(UI.td, 'py-6')} colSpan={4}>
                                            <div className="text-sm text-slate-600">Нет позиций.</div>
                                          </td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </div>

                            <div className="lg:col-span-4">
                              <div className="rounded-2xl bg-white/85 ring-1 ring-sky-200/70 shadow-[0_14px_34px_rgba(15,23,42,0.10)] backdrop-blur p-4">
                                <div className="text-[12px] font-semibold text-slate-800">Даты</div>
                                <div className="mt-2 grid gap-2 text-[12px] text-slate-700">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-slate-500">Создан</span>
                                    <span className="tabular-nums">{formatDateTime(po.created_at)}</span>
                                  </div>
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-slate-500">Заказан</span>
                                    <span className="tabular-nums">{formatDateTime(po.ordered_at ?? null)}</span>
                                  </div>
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-slate-500">ETA</span>
                                    <span className="tabular-nums">{formatDateOnly(po.eta_date ?? null)}</span>
                                  </div>
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-slate-500">Получен</span>
                                    <span className="tabular-nums">{formatDateTime(po.received_at ?? null)}</span>
                                  </div>
                                </div>

                                <div className="mt-4 grid gap-2">
                                  <button
                                    type="button"
                                    className={cls(UI.btnBase, UI.btnPrimary)}
                                    onClick={() => receivePurchase(po.id)}
                                    disabled={!canReceive}
                                  >
                                    {poBusy ? '...' : 'Получено → на центральный'}
                                  </button>
                                  <button
                                    type="button"
                                    className={cls(UI.btnBase, UI.btnSoft)}
                                    onClick={() => setPurchaseStatus(po.id, 'in_transit')}
                                    disabled={po.status === 'in_transit' || poBusy}
                                  >
                                    Отметить “в пути”
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {(purchasesFiltered ?? []).length === 0 && (
                  <div className="text-sm text-slate-600">Нет закупок по текущему фильтру.</div>
                )}
              </div>
            </div>
          )}

          {/* TAB: Central */}
          {tab === 'central' && (
            <div className="grid gap-6">
              <div className={UI.section}>
                <div className={UI.sectionHead}>
                  <div className="min-w-0">
                    <div className={UI.sectionTitle}>
                      <span className={cls(UI.iconPillBase, UI.iconPillTeal)}>
                        <Warehouse className="h-4 w-4" />
                      </span>
                      Центральный склад
                    </div>
                    <div className={UI.sectionHint}>
                      Остатки центрального и “в пути”. В режиме “Покрытие” — чем закрывать нужды филиалов.
                    </div>
                  </div>

                  <div className={UI.tabsWrap}>
                    <button
                      type="button"
                      className={cls(UI.tabBtn, centralMode === 'logistics' ? UI.tabActive : UI.tabIdle)}
                      onClick={() => setCentralMode('logistics')}
                    >
                      Логистика
                    </button>
                    <button
                      type="button"
                      className={cls(UI.tabBtn, centralMode === 'coverage' ? UI.tabActive : UI.tabIdle)}
                      onClick={() => setCentralMode('coverage')}
                    >
                      Покрытие
                    </button>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <Chip tone="neutral">
                    Локация: <span className="ml-1 font-semibold">{centralLoc?.name ?? '—'}</span>
                  </Chip>
                  <Chip tone="neutral">
                    В пути на центральный:{' '}
                    <span className="ml-1 tabular-nums font-semibold">{fmt(centralInTransitTotal)}</span>
                  </Chip>
                </div>
              </div>

              {centralMode === 'logistics' ? (
                <div className={UI.tableWrap}>
                  <table className={UI.table}>
                    <thead>
                      <tr>
                        <th className={UI.th}>SKU</th>
                        <th className={cls(UI.th, 'w-[120px]')}>Остаток</th>
                        <th className={cls(UI.th, 'w-[120px]')}>В пути</th>
                        <th className={cls(UI.th, 'w-[120px]')}>Сумма</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(centralRows ?? []).map((r) => (
                        <tr key={r.code} className={UI.trHover}>
                          <td className={UI.td}>
                            <div className="font-semibold text-slate-900">{r.name_ru}</div>
                            <div className="text-[11px] text-slate-500">{r.code}</div>
                          </td>
                          <td className={cls(UI.td, 'tabular-nums font-semibold')}>{fmt(r.qty)}</td>
                          <td className={cls(UI.td, 'tabular-nums')}>{fmt(r.inTransit)}</td>
                          <td className={cls(UI.td, 'tabular-nums font-semibold')}>{fmt(r.sum)}</td>
                        </tr>
                      ))}
                      {(centralRows ?? []).length === 0 && (
                        <tr>
                          <td className={cls(UI.td, 'py-8')} colSpan={4}>
                            <div className="text-sm text-slate-600">Нет данных по центральному складу.</div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={UI.section}>
                  <div className={UI.sectionHead}>
                    <div className="min-w-0">
                      <div className={UI.sectionTitle}>
                        <span className={cls(UI.iconPillBase, UI.iconPillAmber)}>
                          <BarChart3 className="h-4 w-4" />
                        </span>
                        Покрытие нужд филиалов (top-15)
                      </div>
                      <div className={UI.sectionHint}>
                        totalNeed — суммарная need по филиалам. Клик → кто ждёт этот SKU.
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-2">
                    {((centralCoverageTop?.items ?? []).length === 0) ? (
                      <div className="text-sm text-slate-600">Сейчас по сети нет need.</div>
                    ) : (
                      (centralCoverageTop?.items ?? []).map((s) => {
                        const cover = Math.min(1, (s.onHand + s.inTransit) / Math.max(1, s.totalNeed));
                        const pct = Math.round(cover * 100);
                        const denom = Math.max(1, centralCoverageTop?.maxNeed ?? 1);
                        const w = Math.round((s.totalNeed / denom) * 100);

                        return (
                          <button
                            key={s.code}
                            type="button"
                            className="text-left rounded-2xl bg-white/85 ring-1 ring-sky-200/70 shadow-[0_12px_30px_rgba(15,23,42,0.10)] backdrop-blur p-4 hover:brightness-[1.02]"
                            onClick={() => {
                              setSkuWaitSku(s);
                              setSkuWaitListOpen(true);
                            }}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-900 truncate">{s.name_ru}</div>
                                <div className="text-[11px] text-slate-500">{s.code}</div>

                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <Chip tone="warn">need: +{fmt(s.totalNeed)}</Chip>
                                  <Chip tone="neutral">на складе: {fmt(s.onHand)}</Chip>
                                  <Chip tone="neutral">в пути: {fmt(s.inTransit)}</Chip>
                                </div>
                              </div>

                              <div className="tabular-nums text-right">
                                <div className="text-[11px] text-slate-500">Покрытие</div>
                                <div className="text-[20px] font-semibold text-slate-900">{fmt(pct)}%</div>
                              </div>
                            </div>

                            <div className="mt-3 grid gap-2">
                              <div className="h-3 rounded-full bg-slate-200/70 overflow-hidden">
                                <div
                                  className="h-3 rounded-full bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-400"
                                  style={{ width: `${clamp(pct, 0, 100)}%` }}
                                />
                              </div>

                              <div className="h-2 rounded-full bg-slate-200/50 overflow-hidden">
                                <div
                                  className="h-2 rounded-full bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400"
                                  style={{ width: `${clamp(w, 0, 100)}%` }}
                                />
                              </div>
                              <div className="text-[11px] text-slate-500">
                                Нижняя полоса — относительная “горячесть” need по сети.
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Branch editor drawer */}
      <BranchEditorDrawer
        open={!!branchEditorId}
        loc={branchEditorLoc}
        central={centralLoc}
        skus={skuList}
        getCurrent={(sku) => (branchEditorLoc ? cellQty(sku, branchEditorLoc.id) : 0)}
        getInTransit={(sku) => (branchEditorLoc ? cellInTransit(sku, branchEditorLoc.id) : 0)}
        getTarget={(sku) => (branchEditorLoc ? getTarget(branchEditorLoc.id, sku) : DEFAULT_TARGET)}
        setTarget={(sku, nextTarget) => {
          if (!branchEditorLoc) return;
          setTargetForLoc(branchEditorLoc.id, sku, nextTarget);
        }}
        isTargetDirty={(sku) => (branchEditorLoc ? isTargetDirtyFor(branchEditorLoc.id, sku) : false)}
        centralAvailable={centralAvailable}
        onTransferFromCentral={async (sku, qty, comment) => {
          if (!centralLoc) throw new Error('Нет центрального склада');
          if (!branchEditorLoc) throw new Error('Филиал не выбран');
          const nowIso = new Date().toISOString();

          await doTransfer(centralLoc.id, branchEditorLoc.id, sku, qty, comment);

          setSessionEvents((prev) => [
            {
              id: `sess:transfer:${branchEditorLoc.id}:${sku}:${Date.now()}`,
              ts: nowIso,
              label: `Перемещение ${sku} ×${qty} • ${centralLoc.name} → ${branchEditorLoc.name}`,
              kind: 'transfer',
              branchId: branchEditorLoc.id,
            },
            ...prev,
          ]);

          await loadAll();
        }}
        onSetFact={async (sku, factQty, comment) => {
          if (!branchEditorLoc) throw new Error('Филиал не выбран');
          const nowIso = new Date().toISOString();

          await doAdjustment(branchEditorLoc.id, sku, factQty, comment);

          setSessionEvents((prev) => [
            {
              id: `sess:fact:${branchEditorLoc.id}:${sku}:${Date.now()}`,
              ts: nowIso,
              label: `Факт ${branchEditorLoc.name}: ${sku} = ${factQty}`,
              kind: 'fact',
              branchId: branchEditorLoc.id,
            },
            ...prev,
          ]);

          await loadAll();
        }}
        showToast={showToast}
        onClose={() => {
          setBranchEditorId(null);
          setBranchFocusSku(null);
        }}
        initialFocusSku={branchFocusSku}
        onFocusConsumed={() => setBranchFocusSku(null)}
      />

      {/* Purchase create modal */}
      <PurchaseCreateModal
        open={poOpen}
        locations={shopLocsAll}
        skus={skuList}
        defaultLocationId={shopLocsAll?.[0]?.id ?? null}
        onClose={() => (poBusy ? null : setPoOpen(false))}
        onCreate={createPurchase}
        busy={poBusy}
      />

      {/* Help modal */}
      {helpOpen && (
        <div className="fixed inset-0 z-[250]">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setHelpOpen(false)} />
          <div
            className={cls(
              'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(920px,calc(100%-24px))]',
              'rounded-2xl bg-white/95 ring-1 ring-sky-200/70 shadow-[0_30px_120px_rgba(0,0,0,0.65)] backdrop-blur-xl',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 sm:p-5 border-b border-slate-200/70 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={cls(UI.iconPillBase, UI.iconPillSky)}>
                  <Info className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Справка</div>
                  <div className="text-[18px] font-semibold text-slate-900">Что делает “Получено”</div>
                </div>
              </div>

              <button className={cls(UI.btnBase, UI.btnGhost)} onClick={() => setHelpOpen(false)}>
                <X className="h-4 w-4" />
                Закрыть
              </button>
            </div>

            <div className="p-4 sm:p-5 grid gap-3 text-sm text-slate-700">
              <div className="rounded-2xl bg-white/85 ring-1 ring-sky-200/70 p-4">
                <div className="font-semibold text-slate-900">Сценарий</div>
                <ul className="mt-2 list-disc pl-5 space-y-1">
                  <li>
                    Нажатие “Получено” вызывает RPC: <span className={UI.kbd}>{RPC_RECEIVE}</span>.
                  </li>
                  <li>
                    RPC делает приход позиций закупки на <span className="font-semibold">центральный склад</span>.
                  </li>
                  <li>
                    После успеха PO помечается как <span className="font-semibold">received</span>.
                  </li>
                </ul>
              </div>

              <div className="rounded-2xl bg-gradient-to-br from-white via-sky-50 to-sky-50/70 ring-1 ring-sky-200/70 p-4">
                <div className="font-semibold text-slate-900">Важно</div>
                <div className="mt-2 text-slate-700">
                  Если центральный склад не найден, “Получено” не выполнится. Проверь локации типа{' '}
                  <span className={UI.kbd}>warehouse</span> и имя “Центральный”.
                </div>
              </div>
            </div>

            <div className="p-4 sm:p-5 border-t border-slate-200/70 flex items-center justify-end gap-2">
              <button className={cls(UI.btnBase, UI.btnSoft)} onClick={() => setHelpOpen(false)}>
                Понял
              </button>
            </div>

            <EscToClose onClose={() => setHelpOpen(false)} />
          </div>
        </div>
      )}

      {/* SKU waitlist modal */}
      {skuWaitListOpen && skuWaitSku && (
        <div className="fixed inset-0 z-[255]">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSkuWaitListOpen(false)} />
          <div
            className={cls(
              'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(980px,calc(100%-24px))]',
              'rounded-2xl bg-white/95 ring-1 ring-sky-200/70 shadow-[0_30px_120px_rgba(0,0,0,0.65)] backdrop-blur-xl',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 sm:p-5 border-b border-slate-200/70 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500">Очередь по SKU</div>
                <div className="text-[18px] font-semibold text-slate-900 truncate">{skuWaitSku.name_ru}</div>
                <div className="mt-1 text-[12px] text-slate-600">
                  {skuWaitSku.code} • need по филиалам (с учётом in_transit)
                </div>
              </div>
              <button className={cls(UI.btnBase, UI.btnGhost)} onClick={() => setSkuWaitListOpen(false)}>
                <X className="h-4 w-4" />
                Закрыть
              </button>
            </div>

            <div className="p-4 sm:p-5">
              <div className={UI.tableWrap}>
                <table className={UI.table}>
                  <thead>
                    <tr>
                      <th className={UI.th}>Филиал</th>
                      <th className={cls(UI.th, 'w-[120px]')}>Тек.</th>
                      <th className={cls(UI.th, 'w-[120px]')}>В пути</th>
                      <th className={cls(UI.th, 'w-[120px]')}>Цель</th>
                      <th className={cls(UI.th, 'w-[140px]')}>Нужно</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(skuWaitBranches ?? []).map((r) => (
                      <tr
                        key={r.branch.id}
                        className={cls(UI.trHover, 'cursor-pointer')}
                        onClick={() => {
                          setSkuWaitListOpen(false);
                          setSkuWaitSku(null);
                          setBranchEditorId(r.branch.id);
                          setBranchFocusSku(skuWaitSku.code);
                        }}
                      >
                        <td className={UI.td}>
                          <div className="font-semibold text-slate-900">{r.branch.name}</div>
                        </td>
                        <td className={cls(UI.td, 'tabular-nums')}>{fmt(r.cur)}</td>
                        <td className={cls(UI.td, 'tabular-nums')}>{fmt(r.inTransit)}</td>
                        <td className={cls(UI.td, 'tabular-nums')}>{fmt(r.tgt)}</td>
                        <td className={cls(UI.td, 'tabular-nums font-semibold text-amber-800')}>+{fmt(r.need)}</td>
                      </tr>
                    ))}
                    {(skuWaitBranches ?? []).length === 0 && (
                      <tr>
                        <td className={cls(UI.td, 'py-8')} colSpan={5}>
                          <div className="text-sm text-slate-600">Нет очереди (need=0).</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-4 sm:p-5 border-t border-slate-200/70 flex items-center justify-end gap-2">
              <button
                className={cls(UI.btnBase, UI.btnSoft)}
                onClick={() => {
                  setSkuWaitListOpen(false);
                  setSkuWaitSku(null);
                }}
              >
                Закрыть
              </button>
            </div>

            <EscToClose
              onClose={() => {
                setSkuWaitListOpen(false);
                setSkuWaitSku(null);
              }}
            />
          </div>
        </div>
      )}

                  {/* toast */}
      {toast ? (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[300]">
          <div className="rounded-2xl bg-slate-900/90 text-white px-4 py-2 text-[13px] font-semibold shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
            {toast}
          </div>
        </div>
      ) : null}
    </div>
  );
}
