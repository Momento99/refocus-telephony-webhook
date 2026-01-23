'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import getSupabase from '@/lib/supabaseClient';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toast } from 'react-hot-toast';
import {
  Search,
  RefreshCw,
  X,
  Phone,
  CreditCard,
  CheckCircle2,
  Building2,
  Filter,
  ChevronDown,
  ChevronUp,
  Archive,
  Trash2,
  Pencil,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';

/* ---------- Types ---------- */
// UI-методы (как в New Order)
type PayMethodUI = 'cash' | 'card' | 'qr';
// DB-методы (оставляем совместимость с текущей БД/RPC)
type PayMethodDB = 'cash' | 'pos' | 'transfer' | 'card' | 'qr';

type RawRow = {
  order_no: number;
  created_at?: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  branch_name: string | null;
  status: string;
  total_amount: number | null;
  paid_amount: number | null;
  debt: number | null;

  discount_type?: string | null;
  discount_percent?: number | null;
  discount_amount?: number | null;

  frame_amount?: number | null;
  lenses_amount?: number | null;
};

type Row = {
  id: number;
  order_no: number;
  created_at?: string | null;
  customer_name: string | null;
  phone: string | null;
  branch_name: string | null;
  status: string;
  status_ru: string;
  total_amount: number;
  paid_amount: number;
  debt_amount: number;

  frame_amount: number;
  lenses_amount: number;

  discount_type: 'none' | 'percent' | 'free-frame' | null;
  discount_percent: number;
  discount_amount: number;
  discount_ru: string | null;

  // NEW: штрихкоды оправы (если есть)
  frame_barcodes?: string[] | null;
};

type PaymentRow = {
  payment_id: number;
  order_no: number;
  amount: number;
  method: PayMethodDB;
  created_at: string;
  created_ts?: number;
};

/* ---------- Dictionaries ---------- */
const STATUS_RU: Record<string, string> = {
  NEW: 'НОВЫЙ',
  READY: 'ГОТОВО',
  DELIVERED: 'ВЫДАНО',
};
const FILTER_STATUSES: Array<keyof typeof STATUS_RU> = ['NEW', 'READY', 'DELIVERED'];

/* ---------- Pay method mapping ---------- */
const toUiMethod = (m: PayMethodDB | string | null | undefined): PayMethodUI => {
  const v = String(m || '').toLowerCase();
  if (v === 'cash') return 'cash';
  if (v === 'pos' || v === 'card') return 'card';
  // transfer/qr/unknown -> QR
  return 'qr';
};

// что отправляем в RPC (если в бэкенде пока ожидается старое)
const toDbMethod = (m: PayMethodUI): PayMethodDB => {
  if (m === 'cash') return 'cash';
  if (m === 'card') return 'pos';
  return 'transfer';
};

const PAY_LABEL: Record<PayMethodUI, string> = {
  cash: 'Наличные',
  card: 'Карта',
  qr: 'QR-код',
};

/* ---------- Formatters ---------- */
const KY_TZ = 'Asia/Bishkek';
const fmtNum = (n: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(n || 0));

function asUtcIfNaive(s: string): string {
  const hasTZ = /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(s);
  return hasTZ ? s : `${s}Z`;
}

function fmtDate(s?: string | null): string | null {
  if (!s) return null;
  const safe = asUtcIfNaive(s);
  const d = new Date(safe);
  if (isNaN(d.getTime())) return s;
  const dtf = new Intl.DateTimeFormat('ru-RU', {
    timeZone: KY_TZ,
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`;
}

/* ---------- UI helpers (Refocus style) ---------- */
function GlassCard({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  // Полуглассморфизм: светлый градиент + ring + сильная тень + blur
  return (
    <div
      className={[
        'rounded-3xl',
        'ring-1 ring-sky-200/80',
        'bg-gradient-to-br from-white/95 via-slate-50/90 to-sky-50/80',
        'backdrop-blur-xl',
        'shadow-[0_22px_70px_rgba(15,23,42,0.25)]',
        'text-slate-900',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}

const btnBase =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap select-none transition-all ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed active:translate-y-[0.5px]';

const SoftPrimary =
  btnBase +
  ' rounded-xl px-4 py-2.5 text-sm font-medium text-white ' +
  'bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 ' +
  'shadow-[0_14px_34px_rgba(34,211,238,0.35)] ' +
  'hover:from-teal-300 hover:via-cyan-300 hover:to-sky-300';

const SoftGhost =
  btnBase +
  ' rounded-xl px-3.5 py-2.5 text-sm font-medium text-teal-700 ' +
  'bg-white/85 ring-1 ring-teal-200 ' +
  'shadow-[0_10px_26px_rgba(15,23,42,0.12)] hover:bg-white';

const SoftNeutral =
  btnBase +
  ' rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 ' +
  'bg-white/90 ring-1 ring-slate-200 ' +
  'shadow-[0_10px_26px_rgba(15,23,42,0.10)] hover:bg-white';

function GBtn({
  children,
  onClick,
  disabled,
  variant = 'solid',
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'solid' | 'outline' | 'soft';
  type?: 'button' | 'submit';
}) {
  const cls = variant === 'solid' ? SoftPrimary : variant === 'soft' ? SoftNeutral : SoftGhost;
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        'w-full',
        'rounded-[14px]',
        'bg-white/90',
        'px-3.5 py-2.5',
        'text-sm text-slate-900 placeholder:text-slate-400',
        'ring-1 ring-sky-200/80',
        'shadow-[0_14px_40px_rgba(15,23,42,0.14)]',
        'outline-none',
        'focus:ring-2 focus:ring-cyan-400/80',
        props.className || '',
      ].join(' ')}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={[
        'w-full',
        'rounded-[14px]',
        'bg-white/90',
        'px-3.5 py-2.5',
        'text-sm text-slate-900',
        'ring-1 ring-sky-200/80',
        'shadow-[0_14px_40px_rgba(15,23,42,0.14)]',
        'outline-none',
        'focus:ring-2 focus:ring-cyan-400/80',
        props.className || '',
      ].join(' ')}
    />
  );
}

function StatusPill({ status, status_ru }: { status: string; status_ru?: string }) {
  const label = status_ru ?? STATUS_RU[status] ?? status;

  let ring = 'ring-slate-200';
  let bg = 'bg-white/85';
  let text = 'text-slate-700';
  let Icon = Sparkles;

  if (status === 'READY') {
    ring = 'ring-amber-200';
    bg = 'bg-amber-50/80';
    text = 'text-amber-800';
    Icon = AlertTriangle;
  }
  if (status === 'DELIVERED') {
    ring = 'ring-emerald-200';
    bg = 'bg-emerald-50/80';
    text = 'text-emerald-800';
    Icon = CheckCircle2;
  }
  if (status === 'NEW') {
    ring = 'ring-sky-200';
    bg = 'bg-sky-50/85';
    text = 'text-sky-800';
    Icon = Sparkles;
  }

  return (
    <span
      className={[
        'inline-flex items-center gap-1.5',
        'rounded-full px-2.5 py-1',
        'text-[12px] font-semibold',
        'ring-1',
        ring,
        bg,
        text,
      ].join(' ')}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function LegendChip({
  kind,
  label,
}: {
  kind: 'ok' | 'warn' | 'bad';
  label: string;
}) {
  const cfg =
    kind === 'ok'
      ? {
          ring: 'ring-emerald-200',
          bg: 'bg-emerald-50/80',
          text: 'text-emerald-800',
          Icon: CheckCircle2,
        }
      : kind === 'warn'
        ? {
            ring: 'ring-amber-200',
            bg: 'bg-amber-50/80',
            text: 'text-amber-800',
            Icon: AlertTriangle,
          }
        : {
            ring: 'ring-rose-200',
            bg: 'bg-rose-50/80',
            text: 'text-rose-800',
            Icon: AlertTriangle,
          };

  const Icon = cfg.Icon;

  return (
    <span
      className={[
        'inline-flex items-center gap-1.5',
        'rounded-full px-2.5 py-1',
        'text-[11px] font-semibold',
        'ring-1',
        cfg.ring,
        cfg.bg,
        cfg.text,
      ].join(' ')}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function StatBox({
  label,
  value,
  tone = 'money',
}: {
  label: string;
  value: string;
  tone?: 'money' | 'ok' | 'warn' | 'bad';
}) {
  const toneCfg =
    tone === 'ok'
      ? { bg: 'from-emerald-50 via-white to-emerald-50', ring: 'ring-emerald-200' }
      : tone === 'warn'
        ? { bg: 'from-amber-50 via-white to-amber-50', ring: 'ring-amber-200' }
        : tone === 'bad'
          ? { bg: 'from-rose-50 via-white to-rose-50', ring: 'ring-rose-200' }
          : { bg: 'from-sky-50 via-white to-sky-50', ring: 'ring-sky-200' };

  return (
    <div
      className={[
        'rounded-2xl p-5',
        'bg-gradient-to-br',
        toneCfg.bg,
        'ring-1',
        toneCfg.ring,
        'shadow-[0_16px_50px_rgba(15,23,42,0.16)]',
        'backdrop-blur-xl',
        'flex items-center justify-between gap-4',
      ].join(' ')}
    >
      <div className="text-sm text-slate-700">{label}</div>
      <div className="text-[22px] font-semibold text-slate-900 tabular-nums">{value}</div>
    </div>
  );
}

const Th = ({
  label,
  onClick,
  active,
  dir,
  align = 'left',
  width,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  dir?: 'asc' | 'desc';
  align?: 'left' | 'right';
  width?: string;
}) => (
  <th className={`px-3.5 py-2 ${width || ''}`} style={{ textAlign: align }}>
    {onClick ? (
      <button
        onClick={onClick}
        className="inline-flex items-center gap-1 select-none text-[12px] font-semibold text-slate-700 hover:text-slate-900"
      >
        {label}
        {active ? (
          dir === 'asc' ? (
            <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
          )
        ) : null}
      </button>
    ) : (
      <span className="text-[12px] font-semibold text-slate-700">{label}</span>
    )}
  </th>
);

/* ---------- Кнопки-«пилюли» (Refocus) ---------- */
const pillBase =
  'h-8 px-3 inline-flex items-center justify-center rounded-full text-[12px] font-semibold tracking-wide ' +
  'transition-all select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 ' +
  'disabled:opacity-60 disabled:cursor-not-allowed shadow-[0_10px_26px_rgba(15,23,42,0.14)] ' +
  'hover:shadow-[0_18px_40px_rgba(15,23,42,0.18)] active:scale-[.99]';

const payBtn =
  pillBase +
  ' text-white bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 hover:from-teal-300 hover:via-cyan-300 hover:to-sky-300';

const softDeleteBtn =
  pillBase + ' bg-white/90 ring-1 ring-amber-200 text-amber-800 hover:bg-amber-50/70';
const hardDeleteBtn =
  pillBase + ' bg-white/90 ring-1 ring-rose-200 text-rose-700 hover:bg-rose-50/70';

/* ---------- Normalize ---------- */
function normalize(raw: RawRow): Row {
  const total = Number(raw.total_amount || 0);
  const paid = Number(raw.paid_amount || 0);
  const debt = Number(raw.debt ?? Math.max(total - paid, 0));
  const status = String(raw.status || 'NEW').toUpperCase();

  const rawType = (raw.discount_type ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace('_', '-');
  let dtype: Row['discount_type'] = 'none';
  if (rawType === 'percent') dtype = 'percent';
  else if (rawType === 'free-frame' || rawType === 'freeframe' || rawType === 'free')
    dtype = 'free-frame';

  const dperc = Number(raw.discount_percent ?? 0);
  const damt = Number(raw.discount_amount ?? 0);

  let discount_ru: string | null = null;
  if (dtype === 'free-frame') discount_ru = 'оправа бесплатно';
  else if (dtype === 'percent' && dperc > 0) discount_ru = `− ${dperc}%`;
  else if (damt > 0) discount_ru = `− ${fmtNum(damt)} с`;

  const frame_amount = Number(raw.frame_amount ?? 0);
  const lenses_amount = Number(raw.lenses_amount ?? 0);

  return {
    id: raw.order_no,
    order_no: raw.order_no,
    created_at: fmtDate(raw.created_at) ?? null,
    customer_name: raw.customer_name ?? null,
    phone: raw.customer_phone ?? null,
    branch_name: raw.branch_name ?? null,
    status,
    status_ru: STATUS_RU[status] ?? status,
    total_amount: total,
    paid_amount: paid,
    debt_amount: debt,

    frame_amount,
    lenses_amount,

    discount_type: dtype,
    discount_percent: dperc,
    discount_amount: damt,
    discount_ru,

    frame_barcodes: null,
  };
}

/* ---------- Mobile Cards ---------- */
function MobileCards({
  rows,
  onOpen,
  onPay,
}: {
  rows: Row[];
  onOpen: (id: number) => void;
  onPay: (r: Row) => void;
}) {
  if (!rows.length)
    return (
      <GlassCard className="p-6 text-center">
        <div className="text-slate-700 font-medium">Пусто</div>
        <div className="mt-1 text-sm text-slate-500">Измени фильтры или добавь заказ.</div>
      </GlassCard>
    );

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div
          key={r.order_no}
          className={[
            'rounded-2xl p-4',
            'bg-gradient-to-br from-white/95 via-slate-50/90 to-sky-50/80',
            'ring-1 ring-sky-200/80',
            'shadow-[0_22px_70px_rgba(15,23,42,0.20)]',
            'backdrop-blur-xl',
          ].join(' ')}
        >
          <div className="flex items-start justify-between gap-3">
            <button onClick={() => onOpen(r.order_no)} className="text-left">
              <div className="font-semibold leading-tight text-slate-900">
                {r.customer_name ?? '—'}
              </div>
              <div className="text-[12px] text-slate-600/90 mt-0.5">
                <span className="font-medium text-slate-900">{r.created_at ?? '—'}</span>
                <span className="mx-1.5 text-slate-400">•</span>
                {r.branch_name ?? '—'}
              </div>
            </button>
            <StatusPill status={r.status} status_ru={r.status_ru} />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-white/85 ring-1 ring-slate-200 p-3 shadow-[0_12px_30px_rgba(15,23,42,0.10)]">
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Сумма</div>
              <div className="mt-0.5 font-semibold text-slate-900 tabular-nums">
                {fmtNum(r.total_amount)}
              </div>
            </div>
            <div className="rounded-2xl bg-white/85 ring-1 ring-slate-200 p-3 shadow-[0_12px_30px_rgba(15,23,42,0.10)]">
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Оплачено</div>
              <div className="mt-0.5 font-semibold text-slate-900 tabular-nums">
                {fmtNum(r.paid_amount)}
              </div>
            </div>
            <div className="rounded-2xl bg-white/85 ring-1 ring-slate-200 p-3 shadow-[0_12px_30px_rgba(15,23,42,0.10)]">
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Долг</div>
              <div
                className={[
                  'mt-0.5 font-semibold tabular-nums',
                  r.debt_amount > 0 ? 'text-rose-700' : 'text-emerald-700',
                ].join(' ')}
              >
                {fmtNum(r.debt_amount)}
              </div>
            </div>
          </div>

          {r.discount_ru && (
            <div className="mt-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ring-1 ring-amber-200 bg-amber-50/80 text-amber-800 text-[11px] font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" />
                Скидка: {r.discount_ru}
              </span>
            </div>
          )}

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button onClick={() => onPay(r)} disabled={r.status === 'DELIVERED'} className={payBtn}>
              <CreditCard className="h-4 w-4" />
              Оплата
            </button>
            <a
              href={r.phone ? `tel:${r.phone.replace(/\D/g, '')}` : '#'}
              className={[
                'h-8 col-span-2',
                'rounded-full',
                'bg-white/85 ring-1 ring-sky-200/80',
                'shadow-[0_12px_30px_rgba(15,23,42,0.10)]',
                'flex items-center justify-center gap-2',
                'text-sm font-medium text-slate-800',
                'hover:bg-white',
              ].join(' ')}
            >
              <Phone className="h-4 w-4" />
              Звонок
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Portal ---------- */
function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

/* ---------- Page ---------- */
export default function OrdersPage() {
  const sbRef = useRef<SupabaseClient | null>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [branchFilter, setBranchFilter] = useState<string>('ALL');
  const [sortKey, setSortKey] =
    useState<'order_no' | 'created_at' | 'total_amount' | 'paid_amount' | 'debt_amount'>(
      'order_no',
    );
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [qDebounced, setQDebounced] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim().toLowerCase()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    sbRef.current = getSupabase();
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    const sb = sbRef.current;
    if (!sb) return;
    setLoading(true);
    const { data, error } = await sb.from('orders_view').select('*').order('order_no', {
      ascending: false,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    setRows(((data as RawRow[]) ?? []).map(normalize));
  }

  // Realtime
  const [selectedId, setSelectedId] = useState<number | null>(null);
  useEffect(() => {
    const sb = sbRef.current;
    if (!sb) return;
    const channel = sb
      .channel('orders-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        load();
        if (selectedId) {
          loadOne(selectedId);
          loadPayments(selectedId);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_payments' }, () => {
        if (selectedId) {
          loadOne(selectedId);
          loadPayments(selectedId);
        }
        load();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        if (selectedId) {
          loadOne(selectedId);
          loadPayments(selectedId);
        }
        load();
      });
    channel.subscribe();
    return () => {
      sb.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const uniqueBranches = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.branch_name && s.add(r.branch_name));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    let arr = rows.slice();
    if (statusFilter !== 'ALL') arr = arr.filter((r) => r.status === statusFilter);
    if (branchFilter !== 'ALL') arr = arr.filter((r) => r.branch_name === branchFilter);
    if (qDebounced) {
      arr = arr.filter((r) => {
        const name = (r.customer_name || '').toLowerCase();
        const ord = String(r.order_no).toLowerCase();
        const phone = (r.phone || '').toLowerCase();
        return name.includes(qDebounced) || ord.includes(qDebounced) || phone.includes(qDebounced);
      });
    }
    arr.sort((a: any, b: any) => {
      const key = sortKey;

      if (key === 'created_at') {
        const pa = a.created_at ?? '';
        const pb = b.created_at ?? '';
        const norm = (s: string) =>
          s
            ? `${s.slice(6, 8)}${s.slice(3, 5)}${s.slice(0, 2)}${s.slice(9, 11)}${s.slice(
                12,
                14,
              )}`
            : '';
        const fa = norm(pa);
        const fb = norm(pb);
        if (fa < fb) return sortDir === 'asc' ? -1 : 1;
        if (fa > fb) return sortDir === 'asc' ? 1 : -1;
        return 0;
      }

      const av = (a as any)[key] ?? '';
      const bv = (b as any)[key] ?? '';
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [rows, qDebounced, statusFilter, branchFilter, sortKey, sortDir]);

  const totals = useMemo(() => {
    const total = filtered.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const paid = filtered.reduce((s, r) => s + Number(r.paid_amount || 0), 0);
    const debt = filtered.reduce((s, r) => s + Number(r.debt_amount || 0), 0);
    return { total, paid, debt };
  }, [filtered]);

  function toggleSort(key: typeof sortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  /* ---------- Actions ---------- */
  async function reloadAround(id: number) {
    await Promise.all([load(), loadOne(id), loadPayments(id)]);
  }

  async function softDeleteOrder(id: number) {
    const sb = sbRef.current;
    if (!sb) return;

    const reason = window.prompt('Причина мягкого удаления (опционально):', '') || null;

    try {
      const { error } = await sb.rpc('admin_soft_delete_order', {
        p_order_id: id,
        p_reason: reason,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success('Заказ мягко удалён (скрыт из кассы)');

      await load();

      setDetail((d) => (d && d.order_no === id ? null : d));
      if (selectedId === id) {
        handleCloseDetails();
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Ошибка при мягком удалении заказа');
    }
  }

  async function hardDeleteOrder(id: number) {
    const sb = sbRef.current;
    if (!sb) return;

    const ok = window.confirm(
      'Удалить заказ НАВСЕГДА?\n\n' +
        'Это жёсткое удаление:\n' +
        '— заказ и все связанные данные будут удалены без возврата.\n' +
        '— если есть оплаты / возвраты / отгрузки / движения склада — операция может быть запрещена.',
    );
    if (!ok) return;

    try {
      const { error } = await sb.rpc('hard_delete_order', {
        p_order_id: id,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success('Заказ полностью удалён');
      await load();

      setDetail((d) => (d && d.order_no === id ? null : d));
      if (selectedId === id) {
        handleCloseDetails();
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Ошибка при жёстком удалении заказа');
    }
  }

  /* ---------- Details + Payments ---------- */
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Row | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);

  function handleCloseDetails() {
    setOpen(false);
    setSelectedId(null);
    setDetail(null);
    setPayments([]);
    setPaymentsLoading(false);
  }

  async function openDetails(id: number) {
    setSelectedId(id);
    setOpen(true);
    setDetail(null);
    await loadOne(id);
    await loadPayments(id);
  }

  async function loadOne(id: number) {
    const sb = sbRef.current;
    if (!sb) return;

    const { data, error } = await sb.from('orders_view').select('*').eq('order_no', id).single();

    if (error) {
      toast.error(error.message);
      return;
    }

    let base = normalize(data as RawRow);

    // Берём * чтобы не гадать по колонкам (нужны потенциальные barcode_id / meta и т.п.)
    const { data: items, error: itemsError } = await sb
      .from('order_items')
      .select('*')
      .eq('order_id', id);

    if (itemsError) {
      console.error(itemsError.message);
    } else if (items) {
      let frame = 0;
      let lenses = 0;

      const directBarcodes = new Set<string>();
      const barcodeIds = new Set<string>();

      const tryAddBarcodeStr = (v: any) => {
        if (typeof v === 'string') {
          const s = v.trim();
          if (s) directBarcodes.add(s);
        }
      };

      const tryAddBarcodeId = (v: any) => {
        if (v === null || v === undefined) return;
        if (typeof v === 'string') {
          const s = v.trim();
          if (s) barcodeIds.add(s);
          return;
        }
        // на всякий случай, если id не строка
        if (typeof v === 'number') barcodeIds.add(String(v));
      };

      (items as any[]).forEach((it) => {
        const itemType = (it.item_type ?? '').toString().toLowerCase();
        const hasLensType =
          it.lens_type !== null &&
          it.lens_type !== undefined &&
          String(it.lens_type).trim() !== '';

        const qty = Number(it.qty ?? 1);
        const price = Number(it.price ?? 0);
        const amount = qty * price;

        if (hasLensType || itemType.includes('lens') || itemType.includes('линз')) {
          lenses += amount;
        } else if (itemType.includes('frame') || itemType.includes('оправ')) {
          frame += amount;
        }

        // Баркод имеет смысл искать только у "оправных" позиций
        const isFrameLike =
          !hasLensType &&
          (itemType.includes('frame') ||
            itemType.includes('оправ') ||
            Object.keys(it || {}).some((k) => {
              const lk = k.toLowerCase();
              return lk.includes('frame') && lk.includes('barcode');
            }));

        if (!isFrameLike) return;

        // 1) Если баркод хранится строкой прямо в order_items
        for (const k of Object.keys(it || {})) {
          const lk = k.toLowerCase();
          const v = (it as any)[k];

          // прямой баркод
          if (
            lk === 'barcode' ||
            lk === 'frame_barcode' ||
            lk === 'framebarcode' ||
            lk.endsWith('_barcode')
          ) {
            tryAddBarcodeStr(v);
          }

          // id на frame_barcodes
          if (
            lk === 'barcode_id' ||
            lk === 'frame_barcode_id' ||
            (lk.includes('barcode') && lk.endsWith('_id'))
          ) {
            tryAddBarcodeId(v);
          }

          // json/meta варианты
          if (lk === 'meta' && v && typeof v === 'object') {
            const mv: any = v;
            if (mv?.barcode) tryAddBarcodeStr(mv.barcode);
            if (mv?.frame_barcode) tryAddBarcodeStr(mv.frame_barcode);
            if (mv?.frameBarcode) tryAddBarcodeStr(mv.frameBarcode);
            if (mv?.barcode_id) tryAddBarcodeId(mv.barcode_id);
            if (mv?.frame_barcode_id) tryAddBarcodeId(mv.frame_barcode_id);
          }
        }
      });

      let frameBarcodes = Array.from(directBarcodes).filter(Boolean);

      // 2) Если есть только barcode_id — добираем из frame_barcodes
      if (!frameBarcodes.length && barcodeIds.size) {
        const ids = Array.from(barcodeIds);
        const { data: fb, error: fbErr } = await sb
          .from('frame_barcodes')
          .select('id,barcode')
          .in('id', ids);

        if (fbErr) {
          console.error(fbErr.message);
        } else if (fb && Array.isArray(fb)) {
          frameBarcodes = (fb as any[])
            .map((x) => (x?.barcode ? String(x.barcode).trim() : ''))
            .filter(Boolean);
        }
      }

      base = {
        ...base,
        frame_amount: frame,
        lenses_amount: lenses,
        frame_barcodes: frameBarcodes.length ? frameBarcodes : null,
      };
    }

    setDetail(base);
  }

  async function loadPayments(orderId: number) {
    const sb = sbRef.current;
    if (!sb) return;
    setPaymentsLoading(true);
    const { data, error } = await sb
      .from('order_payments_view')
      .select('*')
      .eq('order_no', orderId)
      .order('payment_id', { ascending: false });
    if (error) {
      toast.error(error.message);
      setPaymentsLoading(false);
      return;
    }
    const rows = ((data as PaymentRow[]) || []).map((p) => ({
      ...p,
      created_at: fmtDate(p.created_at) ?? p.created_at,
    }));
    setPayments(rows);
    setPaymentsLoading(false);
  }

  /* ---------- Pay modal ---------- */
  const [payOpen, setPayOpen] = useState(false);
  const [paySum, setPaySum] = useState<string>('');
  const [payOrder, setPayOrder] = useState<Row | null>(null);
  const [payMethod, setPayMethod] = useState<PayMethodUI>('cash');
  const [payLoading, setPayLoading] = useState(false);

  function openPayModal(r: Row) {
    setPayOrder(r);
    setPaySum('');
    setPayMethod('cash');
    setPayOpen(true);
  }

  async function submitPayment() {
    const sb = sbRef.current;
    if (!sb || !payOrder) return;

    let val = parseFloat(String(paySum).replace(',', '.'));
    if (!Number.isFinite(val) || val <= 0) return toast.error('Введите корректную сумму');

    const debtNow = Math.max(
      payOrder.debt_amount ?? Math.max(payOrder.total_amount - payOrder.paid_amount, 0),
      0,
    );
    if (val > debtNow) val = debtNow;

    setPayLoading(true);
    const { data, error } = await sb.rpc('add_payment', {
      p_order_id: payOrder.order_no,
      p_amount: val,
      p_method: toDbMethod(payMethod),
    });
    setPayLoading(false);

    if (error) return toast.error(error.message);

    toast.success(`Оплата: ${fmtNum(val)}`);
    setPayOpen(false);

    await load();

    const fresh = await sb.from('orders_view').select('*').eq('order_no', payOrder.order_no).single();
    if (!fresh.error && fresh.data) {
      const norm = normalize(fresh.data as RawRow);
      setRows((prev) => prev.map((r) => (r.order_no === norm.order_no ? norm : r)));
      setPayOrder(norm);
      setDetail((d) => (d && d.order_no === norm.order_no ? norm : d));
    }
    await loadPayments(payOrder.order_no);

    const leftFromRpc = Number(
      (Array.isArray(data) ? (data as any)[0]?.debt : (data as any)?.debt) ?? NaN,
    );
    const left = Number.isFinite(leftFromRpc)
      ? leftFromRpc
      : fresh.data
        ? normalize(fresh.data as RawRow).debt_amount
        : debtNow - val;

    if (left <= 0) {
      const ord = fresh.data ? normalize(fresh.data as RawRow) : payOrder;
      if (ord.status !== 'DELIVERED') {
        await reloadAround(payOrder.order_no);
      }
    }
  }

  /* ---------- Edit payment method modal ---------- */
  const [editPayOpen, setEditPayOpen] = useState(false);
  const [editPayment, setEditPayment] = useState<PaymentRow | null>(null);
  const [editMethod, setEditMethod] = useState<PayMethodUI>('cash');
  const [editReason, setEditReason] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  function openEditPaymentMethod(p: PaymentRow) {
    setEditPayment(p);
    setEditMethod(toUiMethod(p.method));
    setEditReason('');
    setEditPayOpen(true);
  }

  async function submitEditPaymentMethod() {
    const sb = sbRef.current;
    if (!sb || !editPayment) return;

    setEditLoading(true);
    const { error } = await sb.rpc('admin_update_payment_method', {
      p_payment_id: editPayment.payment_id,
      p_method: toDbMethod(editMethod),
      p_reason: editReason.trim() || null,
    });
    setEditLoading(false);

    if (error) return toast.error(error.message);

    toast.success('Метод оплаты обновлён');
    setEditPayOpen(false);

    await reloadAround(editPayment.order_no);
  }

  const debtTone: 'ok' | 'bad' = totals.debt > 0 ? 'bad' : 'ok';

  return (
    <div className="relative min-h-[100dvh] text-slate-900">
      <div className="mx-auto max-w-7xl px-5 pt-8 pb-10 space-y-4">
        {/* Header */}
        <GlassCard className="px-6 py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3.5">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_18px_46px_rgba(34,211,238,0.45)]">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[30px] leading-[1.05] font-semibold tracking-tight text-slate-900 drop-shadow-[0_10px_30px_rgba(34,211,238,0.18)]">
                  Заказы
                </div>
                <div className="mt-1 text-[13px] text-slate-600/90">
                  Интерфейс для оплат и админских действий •{' '}
                  <span className="font-medium text-slate-900">
                    всего: {filtered.length}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <GBtn variant="soft" onClick={load}>
                <RefreshCw className="h-4 w-4" />
                Обновить
              </GBtn>
              <GBtn
                variant="outline"
                onClick={() => {
                  setQ('');
                  setStatusFilter('ALL');
                  setBranchFilter('ALL');
                }}
              >
                <Filter className="h-4 w-4" />
                Сбросить фильтры
              </GBtn>
            </div>
          </div>
        </GlassCard>

        {/* Filters + Legend */}
        <GlassCard className="px-6 py-5">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            <div className="md:col-span-5 relative sm:w-96">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск: № заказа, ФИО, телефон"
                className="pl-10"
              />
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            </div>

            <div className="md:col-span-3">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="ALL">Все статусы</option>
                {FILTER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_RU[s]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="md:col-span-3">
              <Select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
                <option value="ALL">Все филиалы</option>
                {uniqueBranches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </div>

            <div className="md:col-span-1 flex justify-end">
              <GBtn
                variant="outline"
                onClick={() => {
                  setQ('');
                  setStatusFilter('ALL');
                  setBranchFilter('ALL');
                }}
              >
                <Filter className="h-4 w-4" />
                Сброс
              </GBtn>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="text-[12px] text-slate-600/90">Легенда:</div>
            <LegendChip kind="ok" label="Выдано / ОК" />
            <LegendChip kind="warn" label="Готово / внимание" />
            <LegendChip kind="bad" label="Есть долг" />
          </div>
        </GlassCard>

        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatBox label="Итого" value={fmtNum(totals.total)} tone="money" />
          <StatBox label="Оплачено" value={fmtNum(totals.paid)} tone="ok" />
          <StatBox label="Долг" value={fmtNum(totals.debt)} tone={debtTone} />
        </div>

        {/* Mobile */}
        <div className="md:hidden">
          <MobileCards rows={filtered} onOpen={openDetails} onPay={openPayModal} />
        </div>

        {/* Table */}
        <div className="hidden md:block">
          <GlassCard className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full table-fixed text-[13px] text-slate-900">
                <thead className="bg-white/70 backdrop-blur border-b border-sky-100">
                  <tr className="text-left">
                    <Th
                      label="Создан"
                      onClick={() => toggleSort('created_at')}
                      active={sortKey === 'created_at'}
                      dir={sortDir}
                      width="w-32"
                    />
                    <Th label="Клиент" width="w-36" />
                    <Th label="Телефон" width="w-32" />
                    <Th label="Филиал" width="w-24" />
                    <Th label="Статус" width="w-24" />
                    <Th
                      align="right"
                      label="Сумма"
                      onClick={() => toggleSort('total_amount')}
                      active={sortKey === 'total_amount'}
                      dir={sortDir}
                      width="w-24"
                    />
                    <Th
                      align="right"
                      label="Оплачено"
                      onClick={() => toggleSort('paid_amount')}
                      active={sortKey === 'paid_amount'}
                      dir={sortDir}
                      width="w-24"
                    />
                    <Th
                      align="right"
                      label="Долг"
                      onClick={() => toggleSort('debt_amount')}
                      active={sortKey === 'debt_amount'}
                      dir={sortDir}
                      width="w-24"
                    />
                    <Th align="right" label="Скидка" width="w-20" />
                    <Th label="Действия" width="w-[220px]" align="right" />
                  </tr>
                </thead>

                <tbody className="align-middle bg-white/40">
                  {loading &&
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={`skel-${i}`} className="border-t border-sky-100/60">
                        <td className="px-3.5 py-3" colSpan={11}>
                          <div className="h-6 w-full bg-slate-100/80 rounded-xl animate-pulse" />
                        </td>
                      </tr>
                    ))}

                  {!loading &&
                    filtered.map((r) => (
                      <tr
                        key={r.order_no}
                        className="border-t border-sky-100/60 hover:bg-white/70 transition-colors cursor-pointer"
                      >
                        <td
                          className="px-3.5 py-3 w-32 whitespace-nowrap text-slate-700"
                          onClick={() => openDetails(r.order_no)}
                        >
                          {r.created_at ?? '—'}
                        </td>
                        <td
                          className="px-3.5 py-3 w-36 max-w-[9rem] truncate text-slate-900 font-medium"
                          onClick={() => openDetails(r.order_no)}
                          title={r.customer_name ?? ''}
                        >
                          {r.customer_name ?? '—'}
                        </td>
                        <td className="px-3.5 py-3 w-32 truncate">
                          {r.phone ? (
                            <a
                              className="inline-flex items-center gap-1.5 text-teal-700 hover:underline font-medium"
                              href={`tel:${r.phone.replace(/\D/g, '')}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Phone className="h-3.5 w-3.5" />
                              {r.phone}
                            </a>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td
                          className="px-3.5 py-3 w-24 truncate text-slate-800"
                          title={r.branch_name ?? ''}
                          onClick={() => openDetails(r.order_no)}
                        >
                          {r.branch_name ?? '—'}
                        </td>
                        <td className="px-3.5 py-3 w-24" onClick={() => openDetails(r.order_no)}>
                          <StatusPill status={r.status} status_ru={r.status_ru} />
                        </td>

                        <td className="px-3.5 py-3 w-24 text-right tabular-nums font-semibold text-slate-900">
                          {fmtNum(r.total_amount)}
                        </td>
                        <td className="px-3.5 py-3 w-24 text-right tabular-nums font-semibold text-slate-900">
                          {fmtNum(r.paid_amount)}
                        </td>
                        <td
                          className={[
                            'px-3.5 py-3 w-24 text-right tabular-nums font-semibold',
                            r.debt_amount > 0 ? 'text-rose-700' : 'text-emerald-700',
                          ].join(' ')}
                        >
                          {fmtNum(r.debt_amount)}
                        </td>

                        <td className="px-3.5 py-3 w-20 text-right">
                          {r.discount_ru ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full ring-1 ring-amber-200 bg-amber-50/80 text-amber-800 text-[12px] font-semibold">
                              {r.discount_ru}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        <td className="px-3.5 py-3 w-[220px]">
                          <div
                            className="flex justify-end gap-1.5 flex-nowrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button className={softDeleteBtn} onClick={() => softDeleteOrder(r.order_no)}>
                              <Archive className="h-4 w-4" />
                              Скрыть
                            </button>
                            <button className={hardDeleteBtn} onClick={() => hardDeleteOrder(r.order_no)}>
                              <Trash2 className="h-4 w-4" />
                              Удалить
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}

                  {!loading && !filtered.length && (
                    <tr>
                      <td colSpan={11} className="px-3.5 py-12 text-center">
                        <div className="inline-block rounded-3xl bg-gradient-to-br from-white/95 via-slate-50/90 to-sky-50/80 ring-1 ring-sky-200/80 px-8 py-6 shadow-[0_22px_70px_rgba(15,23,42,0.16)]">
                          <div className="text-slate-800 font-semibold">Ничего не найдено</div>
                          <div className="mt-1 text-sm text-slate-500">
                            Измени фильтры или добавь заказ.
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </div>

        {/* Детали */}
        <DetailsDrawer
          open={open}
          onClose={handleCloseDetails}
          detail={detail}
          payments={payments}
          paymentsLoading={paymentsLoading}
          onSoftDelete={() => selectedId && softDeleteOrder(selectedId)}
          onHardDelete={() => selectedId && hardDeleteOrder(selectedId)}
          onEditPaymentMethod={openEditPaymentMethod}
        />

        {/* Pay modal */}
        <PayModal
          open={payOpen}
          onClose={() => setPayOpen(false)}
          order={payOrder}
          sum={paySum}
          setSum={setPaySum}
          method={payMethod}
          setMethod={setPayMethod}
          loading={payLoading}
          onSubmit={submitPayment}
        />

        {/* Edit payment method modal */}
        <EditPaymentMethodModal
          open={editPayOpen}
          onClose={() => setEditPayOpen(false)}
          payment={editPayment}
          method={editMethod}
          setMethod={setEditMethod}
          reason={editReason}
          setReason={setEditReason}
          loading={editLoading}
          onSubmit={submitEditPaymentMethod}
        />
      </div>
    </div>
  );
}

/* ---------- Drawer ---------- */
function DetailsDrawer({
  open,
  onClose,
  detail,
  payments,
  paymentsLoading,
  onSoftDelete,
  onHardDelete,
  onEditPaymentMethod,
}: {
  open: boolean;
  onClose: () => void;
  detail: Row | null;
  payments: PaymentRow[];
  paymentsLoading: boolean;
  onSoftDelete: () => void;
  onHardDelete: () => void;
  onEditPaymentMethod: (p: PaymentRow) => void;
}) {
  if (!open) return null;

  const orderCode =
    detail &&
    `ORD-${new Date().getFullYear().toString().slice(2)}-${String(detail.order_no).padStart(5, '0')}`;

  const frameBarcodeText =
    detail?.frame_barcodes && detail.frame_barcodes.length ? detail.frame_barcodes.join(', ') : null;

  return (
    <Portal>
      <div className="fixed inset-0 z-[70]">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />

        <div className="absolute right-0 top-0 h-full w-full sm:w-[480px] overflow-y-auto">
          <div className="h-full bg-gradient-to-b from-white/92 via-slate-50/90 to-sky-50/70 backdrop-blur-2xl ring-1 ring-sky-200/70 shadow-[0_30px_120px_rgba(0,0,0,0.35)]">
            <div className="p-5 border-b border-sky-100/70 bg-white/70 backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_18px_46px_rgba(34,211,238,0.40)]">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[18px] font-semibold text-slate-900">Детали заказа</div>
                    <div className="text-[12px] text-slate-600/90">
                      {orderCode ? (
                        <>
                          <span className="font-medium text-slate-900">{orderCode}</span>
                          <span className="mx-1.5 text-slate-400">•</span>
                          {detail?.created_at ?? '—'}
                        </>
                      ) : (
                        'Загрузка…'
                      )}
                    </div>
                  </div>
                </div>

                <button onClick={onClose} className={SoftGhost}>
                  <X className="h-4 w-4" />
                  Закрыть
                </button>
              </div>
            </div>

            <div className="p-5 space-y-3">
              {!detail && <div className="text-slate-600">Загрузка…</div>}

              {detail && (
                <>
                  <GlassCard className="p-4">
                    <div className="text-[11px] text-slate-500 uppercase tracking-wide">Номер</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">{orderCode}</div>
                    <div className="mt-1 text-[12px] text-slate-600/90">
                      Создан:{' '}
                      <span className="font-medium text-slate-900">{detail.created_at ?? '—'}</span>
                    </div>

                    {/* NEW: barcode */}
                    {frameBarcodeText && (
                      <div className="mt-3 rounded-2xl bg-white/85 ring-1 ring-sky-200/70 p-3 shadow-[0_12px_30px_rgba(15,23,42,0.10)]">
                        <div className="text-[11px] text-slate-500 uppercase tracking-wide">
                          Штрихкод оправы
                        </div>
                        <div className="mt-0.5 font-semibold text-slate-900 tabular-nums font-mono">
                          {frameBarcodeText}
                        </div>
                      </div>
                    )}
                  </GlassCard>

                  <div className="grid grid-cols-2 gap-3">
                    <GlassCard className="p-4">
                      <div className="text-[11px] text-slate-500 uppercase tracking-wide">Клиент</div>
                      <div className="mt-1 text-sm font-medium text-slate-900">
                        {detail.customer_name ?? '—'}
                      </div>
                    </GlassCard>

                    <GlassCard className="p-4">
                      <div className="text-[11px] text-slate-500 uppercase tracking-wide">Телефон</div>
                      <div className="mt-1 text-sm font-medium text-slate-900">{detail.phone ?? '—'}</div>
                    </GlassCard>

                    <GlassCard className="p-4">
                      <div className="text-[11px] text-slate-500 uppercase tracking-wide">Филиал</div>
                      <div className="mt-1 text-sm font-medium text-slate-900">
                        {detail.branch_name ?? '—'}
                      </div>
                    </GlassCard>

                    <GlassCard className="p-4">
                      <div className="text-[11px] text-slate-500 uppercase tracking-wide">Статус</div>
                      <div className="mt-2">
                        <StatusPill status={detail.status} status_ru={detail.status_ru} />
                      </div>
                    </GlassCard>
                  </div>

                  <GlassCard className="p-4">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-2xl bg-white/85 ring-1 ring-slate-200 p-3 shadow-[0_12px_30px_rgba(15,23,42,0.10)]">
                        <div className="text-[11px] text-slate-500 uppercase tracking-wide">Сумма</div>
                        <div className="mt-0.5 font-semibold text-slate-900 tabular-nums">
                          {fmtNum(detail.total_amount)}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-white/85 ring-1 ring-slate-200 p-3 shadow-[0_12px_30px_rgba(15,23,42,0.10)]">
                        <div className="text-[11px] text-slate-500 uppercase tracking-wide">Оплачено</div>
                        <div className="mt-0.5 font-semibold text-slate-900 tabular-nums">
                          {fmtNum(detail.paid_amount)}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-white/85 ring-1 ring-slate-200 p-3 shadow-[0_12px_30px_rgba(15,23,42,0.10)]">
                        <div className="text-[11px] text-slate-500 uppercase tracking-wide">Долг</div>
                        <div
                          className={[
                            'mt-0.5 font-semibold tabular-nums',
                            detail.debt_amount > 0 ? 'text-rose-700' : 'text-emerald-700',
                          ].join(' ')}
                        >
                          {fmtNum(detail.debt_amount)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="text-[11px] text-slate-500 uppercase tracking-wide">Скидка</div>
                      <div className="mt-1 text-sm font-medium text-slate-900">
                        {detail.discount_ru ?? '—'}
                      </div>
                    </div>
                  </GlassCard>

                  {/* Состав суммы: оправа / линзы */}
                  <GlassCard className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-slate-800">Состав заказа</div>
                      <div className="text-[11px] text-slate-500">оправа / линзы</div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-2xl bg-white/85 ring-1 ring-sky-200/70 p-3 shadow-[0_12px_30px_rgba(15,23,42,0.10)]">
                        <div className="text-[11px] text-slate-500 uppercase tracking-wide">Оправа</div>
                        <div className="mt-0.5 font-semibold text-slate-900 tabular-nums">
                          {fmtNum(detail.frame_amount)}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-white/85 ring-1 ring-sky-200/70 p-3 shadow-[0_12px_30px_rgba(15,23,42,0.10)]">
                        <div className="text-[11px] text-slate-500 uppercase tracking-wide">Линзы</div>
                        <div className="mt-0.5 font-semibold text-slate-900 tabular-nums">
                          {fmtNum(detail.lenses_amount)}
                        </div>
                      </div>
                    </div>
                  </GlassCard>

                  <GlassCard className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-slate-800">Действия</div>
                      <div className="text-[11px] text-slate-500">админ</div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button className={`${softDeleteBtn} w-full`} onClick={onSoftDelete}>
                        <Archive className="h-4 w-4" />
                        Скрыть заказ
                      </button>
                      <button className={`${hardDeleteBtn} w-full`} onClick={onHardDelete}>
                        <Trash2 className="h-4 w-4" />
                        Удалить навсегда
                      </button>
                    </div>
                  </GlassCard>

                  <GlassCard className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-slate-800">История оплат</div>
                      <div className="text-[11px] text-slate-500">payments</div>
                    </div>

                    <div className="mt-3">
                      {paymentsLoading && <div className="text-sm text-slate-600">Загрузка…</div>}
                      {!paymentsLoading && !payments?.length && (
                        <div className="text-sm text-slate-600">Ещё нет оплат</div>
                      )}
                      {!paymentsLoading && !!payments?.length && (
                        <div className="space-y-2">
                          {payments.map((p) => (
                            <div
                              key={p.payment_id}
                              className="rounded-2xl bg-white/85 ring-1 ring-slate-200 p-3 shadow-[0_12px_30px_rgba(15,23,42,0.10)]"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center                                gap-2">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <div className="text-sm font-semibold text-slate-900 tabular-nums">
                                        {fmtNum(p.amount)} с
                                      </div>
                                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-slate-200 bg-white/80 text-slate-700">
                                        {PAY_LABEL[toUiMethod(p.method)]}
                                      </span>
                                    </div>
                                    <div className="mt-0.5 text-[11px] text-slate-600">
                                      {p.created_at}
                                    </div>
                                  </div>

                                  <button
                                    className={SoftGhost}
                                    onClick={() => onEditPaymentMethod(p)}
                                    title="Изменить метод оплаты"
                                  >
                                    <Pencil className="h-4 w-4" />
                                    Изменить
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </GlassCard>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}

/* ---------- Pay modal ---------- */
function PayModal({
  open,
  onClose,
  order,
  sum,
  setSum,
  method,
  setMethod,
  loading,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  order: Row | null;
  sum: string;
  setSum: (v: string) => void;
  method: PayMethodUI;
  setMethod: (m: PayMethodUI) => void;
  loading: boolean;
  onSubmit: () => void;
}) {
  if (!open) return null;

  const debtNow = order
    ? Math.max(order.debt_amount ?? Math.max(order.total_amount - order.paid_amount, 0), 0)
    : 0;

  const orderCode =
    order &&
    `ORD-${new Date().getFullYear().toString().slice(2)}-${String(order.order_no).padStart(5, '0')}`;

  const methodBtn = (active: boolean) =>
    [
      pillBase,
      active
        ? 'text-white bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400'
        : 'bg-white/90 ring-1 ring-slate-200 text-slate-800 hover:bg-white',
    ].join(' ');

  return (
    <Portal>
      <div className="fixed inset-0 z-[90]">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />

        <div className="absolute inset-0 grid place-items-center p-4">
          <GlassCard className="w-full max-w-md p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-slate-900">Оплата</div>
                <div className="mt-1 text-[12px] text-slate-600/90">
                  {orderCode ? (
                    <>
                      <span className="font-medium text-slate-900">{orderCode}</span>
                      <span className="mx-1.5 text-slate-400">•</span>
                      долг: <span className="font-semibold text-rose-700">{fmtNum(debtNow)}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </div>
              </div>

              <button onClick={onClose} className={SoftGhost}>
                <X className="h-4 w-4" />
                Закрыть
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <div className="text-[11px] text-slate-500 uppercase tracking-wide">Сумма оплаты</div>
                <Input
                  value={sum}
                  onChange={(e) => setSum(e.target.value)}
                  inputMode="decimal"
                  placeholder={`до ${fmtNum(debtNow)}`}
                  className="mt-2"
                />
                <div className="mt-1 text-[11px] text-slate-500">
                  Если введёшь больше долга — система возьмёт максимум по долгу.
                </div>
              </div>

              <div>
                <div className="text-[11px] text-slate-500 uppercase tracking-wide">Метод</div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <button type="button" className={methodBtn(method === 'cash')} onClick={() => setMethod('cash')}>
                    <CreditCard className="h-4 w-4 opacity-90" />
                    Наличные
                  </button>
                  <button type="button" className={methodBtn(method === 'card')} onClick={() => setMethod('card')}>
                    <CreditCard className="h-4 w-4 opacity-90" />
                    Карта
                  </button>
                  <button type="button" className={methodBtn(method === 'qr')} onClick={() => setMethod('qr')}>
                    <CreditCard className="h-4 w-4 opacity-90" />
                    QR
                  </button>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <GBtn variant="outline" onClick={onClose} disabled={loading}>
                  Отмена
                </GBtn>
                <GBtn onClick={onSubmit} disabled={loading || !order}>
                  <CheckCircle2 className="h-4 w-4" />
                  {loading ? 'Сохраняю…' : 'Подтвердить'}
                </GBtn>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>
    </Portal>
  );
}

/* ---------- Edit payment method modal ---------- */
function EditPaymentMethodModal({
  open,
  onClose,
  payment,
  method,
  setMethod,
  reason,
  setReason,
  loading,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  payment: PaymentRow | null;
  method: PayMethodUI;
  setMethod: (m: PayMethodUI) => void;
  reason: string;
  setReason: (v: string) => void;
  loading: boolean;
  onSubmit: () => void;
}) {
  if (!open) return null;

  const methodBtn = (active: boolean) =>
    [
      pillBase,
      active
        ? 'text-white bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400'
        : 'bg-white/90 ring-1 ring-slate-200 text-slate-800 hover:bg-white',
    ].join(' ');

  return (
    <Portal>
      <div className="fixed inset-0 z-[95]">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />

        <div className="absolute inset-0 grid place-items-center p-4">
          <GlassCard className="w-full max-w-md p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-slate-900">Метод оплаты</div>
                <div className="mt-1 text-[12px] text-slate-600/90">
                  {payment ? (
                    <>
                      платеж #{payment.payment_id}
                      <span className="mx-1.5 text-slate-400">•</span>
                      {fmtNum(payment.amount)} с
                    </>
                  ) : (
                    '—'
                  )}
                </div>
              </div>

              <button onClick={onClose} className={SoftGhost}>
                <X className="h-4 w-4" />
                Закрыть
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <div className="text-[11px] text-slate-500 uppercase tracking-wide">Новый метод</div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <button type="button" className={methodBtn(method === 'cash')} onClick={() => setMethod('cash')}>
                    Наличные
                  </button>
                  <button type="button" className={methodBtn(method === 'card')} onClick={() => setMethod('card')}>
                    Карта
                  </button>
                  <button type="button" className={methodBtn(method === 'qr')} onClick={() => setMethod('qr')}>
                    QR
                  </button>
                </div>
              </div>

              <div>
                <div className="text-[11px] text-slate-500 uppercase tracking-wide">Причина (обязательно для аудита)</div>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Например: клиент оплатил картой, кассир ошибся и выбрал наличные"
                  className={[
                    'mt-2 w-full',
                    'rounded-[14px] bg-white/90 px-3.5 py-2.5',
                    'text-sm text-slate-900 placeholder:text-slate-400',
                    'ring-1 ring-sky-200/80 shadow-[0_14px_40px_rgba(15,23,42,0.14)]',
                    'outline-none focus:ring-2 focus:ring-cyan-400/80',
                    'min-h-[92px] resize-none',
                  ].join(' ')}
                />
                {!reason.trim() && (
                  <div className="mt-1 text-[11px] text-amber-700 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Лучше указать кратко причину, чтобы потом не было вопросов по аудиту.
                  </div>
                )}
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <GBtn variant="outline" onClick={onClose} disabled={loading}>
                  Отмена
                </GBtn>
                <GBtn onClick={onSubmit} disabled={loading || !payment}>
                  <CheckCircle2 className="h-4 w-4" />
                  {loading ? 'Сохраняю…' : 'Сохранить'}
                </GBtn>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>
    </Portal>
  );
}
