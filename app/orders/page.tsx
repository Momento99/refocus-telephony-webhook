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

/* ---------- UI helpers ---------- */
function GlassCard({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  // тот же стеклянный стиль, что на «Сверке»
  return (
    <div
      className={`rounded-3xl border border-sky-100/80 bg-white/92 backdrop-blur-2xl shadow-[0_22px_80px_rgba(15,23,42,0.22)] ${className}`}
    >
      {children}
    </div>
  );
}

const baseBtn =
  'px-3.5 py-2.5 rounded-2xl text-[14px] transition focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap inline-flex items-center gap-2';
const blueGradBtn = `${baseBtn} text-slate-950 bg-gradient-to-r from-sky-500 via-cyan-500 to-indigo-500 hover:from-sky-400 hover:via-cyan-400 hover:to-indigo-400`;
const outlineBtn = `${baseBtn} border border-sky-300/70 bg-white/90 text-sky-700 hover:bg-sky-50`;
const softBtn = `${baseBtn} bg-white border border-slate-200 hover:bg-slate-50`;

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
  const cls = variant === 'solid' ? blueGradBtn : variant === 'soft' ? softBtn : outlineBtn;
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
      className={`w-full px-3.5 py-2.5 rounded-2xl border border-sky-100 bg-white/95 backdrop-blur text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-sky-300 ${
        props.className || ''
      }`}
    />
  );
}
function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full px-3.5 py-2.5 rounded-2xl border border-sky-100 bg-white/95 backdrop-blur text-sm text-slate-900 outline-none focus:ring-2 focus:ring-sky-300 ${
        props.className || ''
      }`}
    />
  );
}

function StatusPill({ status, status_ru }: { status: string; status_ru?: string }) {
  const label = status_ru ?? STATUS_RU[status] ?? status;
  let cls = 'bg-slate-50 text-slate-700 border-slate-200';
  if (status === 'READY') cls = 'bg-amber-50 text-amber-700 border-amber-200';
  if (status === 'DELIVERED') cls = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'NEW') cls = 'bg-indigo-50 text-indigo-700 border-indigo-200';
  return <span className={`px-2.5 py-1 rounded-2xl text-xs border ${cls}`}>{label}</span>;
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
        className="inline-flex items-center gap-1 select-none text-[13px] font-semibold text-slate-700"
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
      <span className="text-[13px] font-semibold text-slate-700">{label}</span>
    )}
  </th>
);

/* ---------- Кнопки-«пилюли» ---------- */
const pillBase =
  'h-8 px-3 inline-flex items-center justify-center rounded-full text-[12px] font-semibold tracking-wide transition-all select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-300 disabled:opacity-60 disabled:cursor-not-allowed shadow-[0_1px_4px_rgba(15,23,42,0.16)] hover:shadow-[0_8px_20px_rgba(15,23,42,0.22)] active:scale-[.99]';

const payBtn = `${pillBase} text-slate-950 bg-[linear-gradient(90deg,#4F46E5_0%,#38BDF8_55%,#34D399_100%)]`;

// мягкие пилюли под общий стиль
const softDeleteBtn = `${pillBase} bg-white/95 border border-amber-300 text-amber-700 hover:bg-amber-50`;
const hardDeleteBtn = `${pillBase} bg-white/95 border border-rose-300 text-rose-600 hover:bg-rose-50`;

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
      <div className="p-6 text-center text-slate-400">
        Пусто. Измени фильтры или добавь заказ.
      </div>
    );
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div
          key={r.order_no}
          className="rounded-3xl border border-sky-100/80 bg-white/92 backdrop-blur p-3 shadow-[0_18px_55px_rgba(15,23,42,0.25)]"
        >
          <div className="flex items-center justify-between">
            <button onClick={() => onOpen(r.order_no)} className="text-left">
              <div className="font-semibold leading-tight text-slate-900">
                {r.customer_name ?? '—'}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {r.created_at ?? '—'} • {r.branch_name ?? '—'}
              </div>
            </button>
            <StatusPill status={r.status} status_ru={r.status_ru} />
          </div>

          <div className="mt-2 grid grid-cols-3 gap-2 text-sm text-slate-900">
            <div>
              <div className="text-xs text-slate-500">Сумма</div>
              <div className="font-medium">{fmtNum(r.total_amount)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Оплачено</div>
              <div className="font-medium">{fmtNum(r.paid_amount)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Долг</div>
              <div
                className={`font-medium ${
                  r.debt_amount > 0 ? 'text-rose-600' : 'text-emerald-600'
                }`}
              >
                {fmtNum(r.debt_amount)}
              </div>
            </div>
          </div>

          {r.discount_ru && (
            <div className="mt-1">
              <span className="inline-block px-2 py-0.5 rounded-lg border text-[11px] bg-amber-50 border-amber-200 text-amber-700">
                Скидка: {r.discount_ru}
              </span>
            </div>
          )}

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button onClick={() => onPay(r)} disabled={r.status === 'DELIVERED'} className={payBtn}>
              <CreditCard className="h-4 w-4 mr-1" />
              Оплата
            </button>
            <a
              href={r.phone ? `tel:${r.phone.replace(/\D/g, '')}` : '#'}
              className="h-8 rounded-full border border-sky-200 bg-white/95 flex items-center justify-center text-sm col-span-2 text-slate-800 hover:bg-sky-50"
            >
              <Phone className="h-4 w-4 mr-1" />
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
  }, []);

  async function load() {
    const sb = sbRef.current;
    if (!sb) return;
    setLoading(true);
    const { data, error } = await sb
      .from('orders_view')
      .select('*')
      .order('order_no', {
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

    const { data: items, error: itemsError } = await sb
      .from('order_items')
      .select('item_type,lens_type,qty,price')
      .eq('order_id', id);

    if (itemsError) {
      console.error(itemsError.message);
    } else if (items) {
      let frame = 0;
      let lenses = 0;

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
      });

      base = {
        ...base,
        frame_amount: frame,
        lenses_amount: lenses,
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

  return (
    <div className="relative min-h-[100dvh] text-slate-900">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-4">
        {/* Заголовок + тулбар */}
        <GlassCard className="px-6 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 via-cyan-400 to-violet-500 text-slate-950 shadow-[0_16px_40px_rgba(56,189,248,0.7)]">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[18px] font-semibold tracking-tight">Заказы</div>
                <div className="text-[12px] text-slate-500">
                  Интерфейс для оплат и админских чисток.
                </div>
              </div>
            </div>
            <div className="flex flex-col items-start gap-2 md:flex-row md:items-center md:gap-3 md:justify-end">
              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                <GBtn variant="outline" onClick={load}>
                  <RefreshCw className="h-4 w-4" /> Обновить
                </GBtn>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Фильтры */}
        <GlassCard className="px-6 py-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            <div className="md:col-span-5 relative">
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
                <Filter className="h-4 w-4" /> Сбросить
              </GBtn>
            </div>
          </div>
        </GlassCard>

        {/* Сводка */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <GlassCard className="px-6 h-24 flex items-center justify-between">
            <div className="inline-flex items-center gap-2 text-[12px] text-slate-500">Итого</div>
            <div className="text-2xl font-extrabold tabular-nums bg-gradient-to-r from-sky-500 to-indigo-500 bg-clip-text text-transparent">
              {fmtNum(totals.total)}
            </div>
          </GlassCard>
          <GlassCard className="px-6 h-24 flex items-center justify-between">
            <div className="inline-flex items-center gap-2 text-[12px] text-slate-500">Оплачено</div>
            <div className="text-2xl font-extrabold tabular-nums bg-gradient-to-r from-sky-500 to-indigo-500 bg-clip-text text-transparent">
              {fmtNum(totals.paid)}
            </div>
          </GlassCard>
          <GlassCard className="px-6 h-24 flex items-center justify-between">
            <div className="inline-flex items-center gap-2 text-[12px] text-slate-500">Долг</div>
            <div className="text-2xl font-extrabold tabular-nums bg-gradient-to-r from-sky-500 to-indigo-500 bg-clip-text text-transparent">
              {fmtNum(totals.debt)}
            </div>
          </GlassCard>
        </div>

        {/* Мобилка */}
        <div className="md:hidden">
          <MobileCards rows={filtered} onOpen={openDetails} onPay={openPayModal} />
        </div>

        {/* Таблица */}
        <div className="hidden md:block">
          <GlassCard className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full table-fixed text-[13px] text-slate-900">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
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
                    <Th label="Статус" width="w-20" />
                    <Th
                      align="right"
                      label="Сумма"
                      onClick={() => toggleSort('total_amount')}
                      active={sortKey === 'total_amount'}
                      dir={sortDir}
                      width="w-20"
                    />
                    <Th
                      align="right"
                      label="Оплачено"
                      onClick={() => toggleSort('paid_amount')}
                      active={sortKey === 'paid_amount'}
                      dir={sortDir}
                      width="w-20"
                    />
                    <Th
                      align="right"
                      label="Долг"
                      onClick={() => toggleSort('debt_amount')}
                      active={sortKey === 'debt_amount'}
                      dir={sortDir}
                      width="w-20"
                    />
                    <Th align="right" label="Скидка" width="w-16" />
                    <Th label="Действия" width="w-[210px]" align="right" />
                  </tr>
                </thead>
                <tbody className="align-middle">
                  {loading &&
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={`skel-${i}`} className="border-t border-slate-100">
                        <td className="px-3.5 py-2" colSpan={11}>
                          <div className="h-5 w-full bg-slate-100 rounded animate-pulse" />
                        </td>
                      </tr>
                    ))}

                  {!loading &&
                    filtered.map((r) => (
                      <tr
                        key={r.order_no}
                        className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                      >
                        <td
                          className="px-3.5 py-2 w-32 whitespace-nowrap text-slate-700"
                          onClick={() => openDetails(r.order_no)}
                        >
                          {r.created_at ?? '—'}
                        </td>
                        <td
                          className="px-3.5 py-2 w-36 max-w-[9rem] truncate text-slate-800"
                          onClick={() => openDetails(r.order_no)}
                          title={r.customer_name ?? ''}
                        >
                          {r.customer_name ?? '—'}
                        </td>
                        <td className="px-3.5 py-2 w-32 truncate">
                          {r.phone ? (
                            <a
                              className="text-sky-700 hover:underline inline-flex items-center gap-1"
                              href={`tel:${r.phone.replace(/\D/g, '')}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Phone className="h-3.5 w-3.5" />
                              {r.phone}
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td
                          className="px-3.5 py-2 w-24 truncate text-slate-800"
                          title={r.branch_name ?? ''}
                          onClick={() => openDetails(r.order_no)}
                        >
                          {r.branch_name ?? '—'}
                        </td>
                        <td className="px-3.5 py-2 w-20" onClick={() => openDetails(r.order_no)}>
                          <StatusPill status={r.status} status_ru={r.status_ru} />
                        </td>

                        <td className="px-3.5 py-2 w-20 text-right tabular-nums font-medium text-slate-800">
                          {fmtNum(r.total_amount)}
                        </td>
                        <td className="px-3.5 py-2 w-20 text-right tabular-nums font-medium text-slate-800">
                          {fmtNum(r.paid_amount)}
                        </td>
                        <td
                          className={`px-3.5 py-2 w-20 text-right tabular-nums ${
                            r.debt_amount > 0 ? 'text-rose-600 font-semibold' : 'text-slate-600'
                          }`}
                        >
                          {fmtNum(r.debt_amount)}
                        </td>

                        <td className="px-3.5 py-2 w-16 text-right">
                          {r.discount_ru ? (
                            <span className="inline-block px-2 py-0.5 rounded-lg border text-[12px] bg-amber-50 border-amber-200 text-amber-700">
                              {r.discount_ru}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>

                        <td className="px-3.5 py-2 w-[210px]">
                          <div
                            className="flex justify-end gap-1.5 flex-nowrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              className={softDeleteBtn}
                              onClick={() => softDeleteOrder(r.order_no)}
                            >
                              <Archive className="h-4 w-4 mr-1" />
                              Скрыть
                            </button>
                            <button
                              className={hardDeleteBtn}
                              onClick={() => hardDeleteOrder(r.order_no)}
                            >
                              <Trash2 className="h-4 w-4 mr-1" />
                              Удалить
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}

                  {!loading && !filtered.length && (
                    <tr>
                      <td colSpan={11} className="px-3.5 py-10 text-center text-slate-500">
                        Пусто. Измени фильтры или добавь заказ.
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
  return (
    <Portal>
      <div className="fixed inset-0 z-[70]">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="absolute right-0 top-0 h-full w-full sm:w-[460px] bg-white/90 backdrop-blur-md shadow-2xl border-l border-white/60 overflow-y-auto transition-transform duration-300 translate-x-0">
          <div className="p-4 flex items-center justify-between border-b border-white/60 bg-gradient-to-r from-sky-600 to-indigo-600 text-white">
            <div className="font-semibold">Детали заказа</div>
            <button
              className="bg-white/90 text-slate-800 px-3 py-2 rounded-lg hover:bg-white inline-flex items-center gap-2"
              onClick={onClose}
            >
              <X className="h-4 w-4" /> Закрыть
            </button>
          </div>
          <div className="p-4 space-y-3">
            {!detail && <div className="text-slate-500">Загрузка…</div>}
            {detail && (
              <>
                <GlassCard className="p-3 bg-white">
                  <div className="text-xs text-slate-500">Номер</div>
                  <div className="text-lg font-semibold text-slate-900">
                    {`ORD-${new Date().getFullYear().toString().slice(2)}-${String(
                      detail.order_no,
                    ).padStart(5, '0')}`}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Создан: {detail.created_at ?? '—'}
                  </div>
                </GlassCard>

                <div className="grid grid-cols-2 gap-3">
                  <GlassCard className="p-3 bg-white">
                    <div className="text-xs text-slate-500">Клиент</div>
                    <div className="text-sm text-slate-800">{detail.customer_name ?? '—'}</div>
                  </GlassCard>
                  <GlassCard className="p-3 bg-white">
                    <div className="text-xs text-slate-500">Телефон</div>
                    <div className="text-sm text-slate-800">{detail.phone ?? '—'}</div>
                  </GlassCard>
                  <GlassCard className="p-3 bg-white">
                    <div className="text-xs text-slate-500">Филиал</div>
                    <div className="text-sm text-slate-800">{detail.branch_name ?? '—'}</div>
                  </GlassCard>
                  <GlassCard className="p-3 bg-white">
                    <div className="text-xs text-slate-500">Статус</div>
                    <div className="mt-1">
                      <StatusPill status={detail.status} status_ru={detail.status_ru} />
                    </div>
                  </GlassCard>
                </div>

                <GlassCard className="p-3 bg-white">
                  <div className="grid grid-cols-3 gap-2 text-sm text-slate-800">
                    <div>
                      <div className="text-xs text-slate-500">Сумма</div>
                      <div className="font-medium">{fmtNum(detail.total_amount)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Оплачено</div>
                      <div className="font-medium">{fmtNum(detail.paid_amount)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Долг</div>
                      <div
                        className={`font-medium ${
                          detail.debt_amount > 0 ? 'text-red-600' : 'text-slate-800'
                        }`}
                      >
                        {fmtNum(detail.debt_amount)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-slate-800">
                    <div className="text-xs text-slate-500">Скидка</div>
                    <div>{detail.discount_ru ?? '—'}</div>
                  </div>
                </GlassCard>

                {/* Состав суммы: оправа / линзы */}
                <GlassCard className="p-3 bg-white">
                  <div className="text-xs text-slate-500 mb-2">Состав заказа</div>
                  <div className="grid grid-cols-2 gap-2 text-sm text-slate-800">
                    <div>
                      <div className="text-xs text-slate-500">Оправа</div>
                      <div className="font-medium">{fmtNum(detail.frame_amount)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Линзы</div>
                      <div className="font-medium">{fmtNum(detail.lenses_amount)}</div>
                    </div>
                  </div>
                </GlassCard>

                <GlassCard className="p-3 bg-white space-y-2">
                  <div className="text-sm font-medium text-slate-800">Действия</div>
                  <div className="flex flex-wrap gap-1.5">
                    <button className={`${softDeleteBtn} w-[150px]`} onClick={onSoftDelete}>
                      <Archive className="h-4 w-4 mr-1" /> Скрыть заказ
                    </button>
                    <button className={`${hardDeleteBtn} w-[180px]`} onClick={onHardDelete}>
                      <Trash2 className="h-4 w-4 mr-1" /> Удалить навсегда
                    </button>
                  </div>
                </GlassCard>

                <GlassCard className="p-3 bg-white">
                  <div className="text-sm font-medium mb-2 text-slate-800">История оплат</div>
                  {paymentsLoading && <div className="text-sm text-slate-500">Загрузка…</div>}
                  {!paymentsLoading && !payments?.length && (
                    <div className="text-sm text-slate-500">Ещё нет оплат</div>
                  )}
                  {!paymentsLoading && !!payments?.length && (
                    <div className="space-y-2">
                      {payments.map((p) => (
                        <div
                          key={p.payment_id}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-lg border text-xs bg-white/70 text-slate-800 border-slate-200">
                              {PAY_LABEL[toUiMethod(p.method)]}
                            </span>

                            <button
                              className="px-2 py-0.5 rounded-lg border text-xs bg-white/70 text-slate-700 border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1"
                              onClick={() => onEditPaymentMethod(p)}
                              title="Изменить метод оплаты"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Изменить
                            </button>

                            <span className="text-slate-600">{p.created_at}</span>
                          </div>
                          <div className="font-medium text-slate-800">{fmtNum(p.amount)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </GlassCard>
              </>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

/* ---------- Pay Modal ---------- */
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
  setMethod: (v: PayMethodUI) => void;
  loading: boolean;
  onSubmit: () => void;
}) {
  if (!open) return null;

  const parseVal = (s: string) => {
    const v = parseFloat(String(s).replace(',', '.'));
    return Number.isFinite(v) ? v : 0;
  };

  const add = (n: number) => {
    const next = parseVal(sum) + n;
    setSum(String(next));
  };

  const fillDebt = () => {
    const val = order ? Math.max(Number(order.debt_amount || 0), 0) : 0;
    setSum(String(val));
  };

  const fillToFull = () => {
    const val = order
      ? Math.max(Number(order.total_amount || 0) - Number(order.paid_amount || 0), 0)
      : 0;
    setSum(String(val));
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[100]">
        <div className="absolute inset-0 bg-black/35" onClick={onClose} />
        <div className="absolute left-1/2 top-1/2 w-[92%] max-w-md -translate-x-1/2 -translate-y-1/2">
          <div className="rounded-3xl overflow-hidden shadow-[0_24px_72px_rgba(2,6,23,0.25)] border border-white/60 bg-white/90 backdrop-blur-2xl">
            <div className="px-4 py-3 bg-gradient-to-r from-sky-600 to-indigo-600 text-white">
              <div className="text-[18px] font-semibold">Оплата</div>
              <div className="text-sm opacity-90">
                {order
                  ? `Заказ ORD-${new Date().getFullYear().toString().slice(2)}-${String(
                      order.order_no,
                    ).padStart(5, '0')}`
                  : '—'}
              </div>
            </div>

            <div className="p-4">
              <div className="grid grid-cols-3 gap-2 mb-3 text-sm">
                <div className="p-2 rounded-2xl border border-white/60 bg-white/80 text-slate-800">
                  Сумма: <b>{order ? fmtNum(order.total_amount) : '—'}</b>
                </div>
                <div className="p-2 rounded-2xl border border-white/60 bg-white/80 text-slate-800">
                  Оплачено: <b>{order ? fmtNum(order.paid_amount) : '—'}</b>
                </div>
                <div className="p-2 rounded-2xl border border-white/60 bg-white/80 text-slate-800">
                  Долг:{' '}
                  <b className={order && order.debt_amount > 0 ? 'text-red-600' : ''}>
                    {order ? fmtNum(order.debt_amount) : '—'}
                  </b>
                </div>
              </div>

              {order?.discount_ru && (
                <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg inline-flex items-center gap-1">
                  <CreditCard className="h-3.5 w-3.5" /> Скидка по заказу: {order.discount_ru}
                </div>
              )}

              <div className="mb-3">
                <Input
                  inputMode="numeric"
                  placeholder="Сумма, сом"
                  value={sum}
                  onChange={(e) => setSum(e.target.value.replace(',', '.'))}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 hover:bg-slate-50"
                    onClick={() => add(500)}
                  >
                    +500
                  </button>
                  <button
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 hover:bg-slate-50"
                    onClick={() => add(1000)}
                  >
                    +1000
                  </button>
                  <button
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 hover:bg-slate-50"
                    onClick={fillDebt}
                  >
                    Весь долг
                  </button>
                  <button
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 hover:bg-slate-50"
                    onClick={fillToFull}
                  >
                    До полной
                  </button>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm mb-1">Метод оплаты</label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PayMethodUI)}
                  className="w-full px-3.5 py-2.5 rounded-2xl border border-slate-300 bg-white/90 focus:ring-2 focus:ring-sky-200 text-sm text-slate-900"
                >
                  <option value="cash">Наличные</option>
                  <option value="card">Карта</option>
                  <option value="qr">QR-код</option>
                </select>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  className="px-4 py-3 rounded-2xl border border-slate-300 bg-white/95 hover:bg-white text-[15px] inline-flex items-center gap-2"
                  onClick={onClose}
                  disabled={loading}
                >
                  <X className="h-4 w-4" /> Отмена
                </button>
                <button
                  className="px-5 py-3 rounded-2xl text-[15px] font-semibold bg-gradient-to-r from-sky-600 to-indigo-600 text-white hover:from-sky-500 hover:to-indigo-500 disabled:opacity-50 inline-flex items-center gap-2"
                  onClick={onSubmit}
                  disabled={loading || !order}
                >
                  {loading ? (
                    'Обработка…'
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" /> Подтвердить оплату
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}

/* ---------- Edit Payment Method Modal ---------- */
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
  setMethod: (v: PayMethodUI) => void;
  reason: string;
  setReason: (v: string) => void;
  loading: boolean;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-[110]">
        <div className="absolute inset-0 bg-black/35" onClick={onClose} />
        <div className="absolute left-1/2 top-1/2 w-[92%] max-w-md -translate-x-1/2 -translate-y-1/2">
          <div className="rounded-3xl overflow-hidden shadow-[0_24px_72px_rgba(2,6,23,0.25)] border border-white/60 bg-white/90 backdrop-blur-2xl">
            <div className="px-4 py-3 bg-gradient-to-r from-sky-600 to-indigo-600 text-white">
              <div className="text-[18px] font-semibold">Изменить метод оплаты</div>
              <div className="text-sm opacity-90">
                {payment ? `Payment #${payment.payment_id} • Заказ #${payment.order_no}` : '—'}
              </div>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-sm mb-1">Новый метод</label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PayMethodUI)}
                  className="w-full px-3.5 py-2.5 rounded-2xl border border-slate-300 bg-white/90 focus:ring-2 focus:ring-sky-200 text-sm text-slate-900"
                >
                  <option value="cash">Наличные</option>
                  <option value="card">Карта</option>
                  <option value="qr">QR-код</option>
                </select>
              </div>

              <div>
                <label className="block text-sm mb-1">Причина (опционально)</label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Например: продавец ошибся при выборе метода"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  className="px-4 py-3 rounded-2xl border border-slate-300 bg-white/95 hover:bg-white text-[15px] inline-flex items-center gap-2"
                  onClick={onClose}
                  disabled={loading}
                >
                  <X className="h-4 w-4" /> Отмена
                </button>

                <button
                  className="px-5 py-3 rounded-2xl text-[15px] font-semibold bg-gradient-to-r from-sky-600 to-indigo-600 text-white hover:from-sky-500 hover:to-indigo-500 disabled:opacity-50 inline-flex items-center gap-2"
                  onClick={onSubmit}
                  disabled={loading || !payment}
                >
                  {loading ? (
                    'Обработка…'
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" /> Сохранить
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
