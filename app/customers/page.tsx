'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import getSupabase from '@/lib/supabaseClient';
import toast, { Toaster } from 'react-hot-toast';
import {
  RefreshCw,
  Users,
  TrendingUp,
  WalletMinimal,
  Search,
  Phone,
  CalendarClock,
  CalendarCheck2,
  CalendarX2,
  ArrowUpWideNarrow,
  ArrowDownWideNarrow,
  Filter,
  ExternalLink,
} from 'lucide-react';

/* ========= Types ========= */
type StatRow = {
  customer_id: number;
  full_name: string | null;
  phone: string | null;
  birthday: string | null;
  city: string | null;
  marketing_opt_in: boolean | null;
  orders_count: number;
  total_amount: number;
  paid_amount: number;
  debt: number;
  last_order_at: string | null; // ISO
  next_check_at: string | null; // ISO
};

type Bucket = 'all' | 'due' | 'soon' | 'later';

/* ========= Utils ========= */
const fmtNum = (n: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(n || 0));

const fmtDate = (val: string | null) => {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy} ${hh}:${mi}`;
};

const statusOf = (nextISO: string | null): 'due' | 'soon' | 'later' | 'none' => {
  if (!nextISO) return 'none';
  const ts = Date.parse(nextISO);
  if (!Number.isFinite(ts)) return 'none';
  const now = Date.now();
  const soonTs = now + 30 * 24 * 3600 * 1000;
  if (ts <= now) return 'due';
  if (ts <= soonTs) return 'soon';
  return 'later';
};

/* ========= Refocus UI (полуглассморфизм) ========= */

function GlassCard({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        'rounded-3xl',
        'bg-gradient-to-br from-white/95 via-white/85 to-sky-50/80',
        'ring-1 ring-sky-200/70',
        'shadow-[0_22px_70px_rgba(15,23,42,0.25)]',
        'backdrop-blur-xl',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}

const btnBase =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap ' +
  'rounded-xl px-4 py-2.5 text-sm font-medium transition ' +
  'focus:outline-none focus:ring-2 focus:ring-teal-300/70 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

const btnPrimary =
  btnBase +
  ' text-white bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 ' +
  'shadow-[0_14px_35px_rgba(56,189,248,0.40)] ' +
  'hover:from-teal-300 hover:via-cyan-300 hover:to-sky-300 active:from-teal-500 active:via-cyan-500 active:to-sky-500';

const btnGhost =
  btnBase +
  ' bg-white/85 ring-1 ring-teal-200 text-teal-700 ' +
  'shadow-[0_10px_28px_rgba(15,23,42,0.14)] hover:bg-white';

function GBtn({
  children,
  onClick,
  disabled,
  variant = 'primary',
  type = 'button',
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost';
  type?: 'button' | 'submit';
  className?: string;
}) {
  const cls = variant === 'primary' ? btnPrimary : btnGhost;
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${cls} ${className}`}>
      {children}
    </button>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        'w-full rounded-[14px] px-3.5 py-2.5',
        'bg-white/90 text-slate-900 placeholder:text-slate-400',
        'ring-1 ring-sky-200/80',
        'shadow-[0_14px_35px_rgba(15,23,42,0.14)]',
        'backdrop-blur',
        'outline-none focus:ring-2 focus:ring-cyan-400/80',
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
        'w-full rounded-[14px] px-3.5 py-2.5',
        'bg-white/90 text-slate-900',
        'ring-1 ring-sky-200/80',
        'shadow-[0_14px_35px_rgba(15,23,42,0.14)]',
        'backdrop-blur',
        'outline-none focus:ring-2 focus:ring-cyan-400/80',
        props.className || '',
      ].join(' ')}
    />
  );
}

function StatBox({
  icon,
  label,
  value,
  tone = 'sky',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'sky' | 'emerald' | 'amber' | 'rose';
}) {
  const toneMap = {
    sky: {
      bg: 'from-sky-50 via-white to-sky-50',
      ring: 'ring-sky-200/70',
      value: 'text-slate-900',
      badge: 'bg-sky-50 text-sky-700 ring-sky-200',
    },
    emerald: {
      bg: 'from-emerald-50 via-white to-emerald-50',
      ring: 'ring-emerald-200/70',
      value: 'text-slate-900',
      badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    },
    amber: {
      bg: 'from-amber-50 via-white to-amber-50',
      ring: 'ring-amber-200/70',
      value: 'text-slate-900',
      badge: 'bg-amber-50 text-amber-700 ring-amber-200',
    },
    rose: {
      bg: 'from-rose-50 via-white to-rose-50',
      ring: 'ring-rose-200/70',
      value: 'text-slate-900',
      badge: 'bg-rose-50 text-rose-700 ring-rose-200',
    },
  } as const;

  const t = toneMap[tone];

  return (
    <div
      className={[
        'rounded-2xl p-5',
        'bg-gradient-to-br',
        t.bg,
        'ring-1',
        t.ring,
        'shadow-[0_16px_45px_rgba(15,23,42,0.18)]',
        'backdrop-blur-xl',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-3">
        <div className={['inline-flex items-center gap-2 text-sm text-slate-700'].join(' ')}>
          <span className={['inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[12px] ring-1', t.badge].join(' ')}>
            {icon}
            {label}
          </span>
        </div>

        <div className={['text-[22px] font-semibold tabular-nums', t.value].join(' ')}>
          {value}
        </div>
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  tone = 'slate',
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  tone?: 'slate' | 'emerald' | 'amber';
}) {
  const base =
    'h-9 px-3 rounded-full text-[12px] font-semibold transition inline-flex items-center gap-1.5 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 ' +
    'shadow-[0_10px_28px_rgba(15,23,42,0.14)]';

  const inactive = {
    slate: 'bg-white/85 ring-1 ring-slate-200 text-slate-700 hover:bg-white',
    emerald: 'bg-emerald-50 ring-1 ring-emerald-200 text-emerald-700 hover:bg-emerald-100/80',
    amber: 'bg-amber-50 ring-1 ring-amber-200 text-amber-700 hover:bg-amber-100/80',
  } as const;

  const activeCls =
    'text-white ring-0 bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 ' +
    'shadow-[0_14px_35px_rgba(56,189,248,0.45)]';

  return (
    <button onClick={onClick} className={`${base} ${active ? activeCls : inactive[tone]}`} type="button">
      {children}
    </button>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = 'left',
  width,
}: {
  label: string;
  active?: boolean;
  dir?: 'asc' | 'desc';
  onClick?: () => void;
  align?: 'left' | 'right';
  width?: string;
}) {
  return (
    <th className={`px-3.5 py-2 ${width || ''}`} style={{ textAlign: align }}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-700 hover:text-slate-900 select-none"
      >
        {label}
        {active ? (
          dir === 'asc' ? (
            <ArrowUpWideNarrow className="h-3.5 w-3.5 text-slate-400" />
          ) : (
            <ArrowDownWideNarrow className="h-3.5 w-3.5 text-slate-400" />
          )
        ) : null}
      </button>
    </th>
  );
}

/* ========= Page ========= */
export default function CustomersPage() {
  const router = useRouter();

  const [rows, setRows] = useState<StatRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState('');
  const qDeferred = useDeferredValue(q);
  const [bucket, setBucket] = useState<Bucket>('all');
  const [sortKey, setSortKey] = useState<'last_order_at' | 'orders_count' | 'total_amount' | 'debt'>(
    'last_order_at',
  );
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      setLoading(true);
      const supabase = getSupabase();
      const { data, error } = await supabase.from('customer_stats').select('*');
      if (error) throw error;

      const normalized: StatRow[] = ((data as any[]) || []).map((r) => ({
        customer_id: r.customer_id,
        full_name: r.full_name ?? null,
        phone: r.phone ?? null,
        birthday: r.birthday ?? null,
        city: r.city ?? null,
        marketing_opt_in: typeof r.marketing_opt_in === 'boolean' ? r.marketing_opt_in : null,
        orders_count: Number(r.orders_count ?? 0),
        total_amount: Number(r.total_amount ?? 0),
        paid_amount: Number(r.paid_amount ?? 0),
        debt: Number(r.debt ?? r.debt_amount ?? 0),
        last_order_at: r.last_order_at ?? r.last_order_date ?? null,
        next_check_at: r.next_check_at ?? null,
      }));

      setRows(normalized);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }

  // дебаунс поиска
  const [qDebounced, setQDebounced] = useState('');
  const tRef = useRef<number | null>(null);
  useEffect(() => {
    if (tRef.current) window.clearTimeout(tRef.current);
    tRef.current = window.setTimeout(() => setQDebounced(qDeferred.trim().toLowerCase()), 200);
    return () => {
      if (tRef.current) window.clearTimeout(tRef.current);
    };
  }, [qDeferred]);

  const filtered = useMemo(() => {
    let arr = rows.slice();

    if (bucket !== 'all') {
      const now = Date.now();
      const soonTs = now + 30 * 24 * 3600 * 1000;
      arr = arr.filter((r) => {
        const nx = r.next_check_at ? Date.parse(r.next_check_at) : NaN;
        if (!Number.isFinite(nx)) return false;
        if (bucket === 'due') return nx <= now;
        if (bucket === 'soon') return nx > now && nx <= soonTs;
        return nx > soonTs;
      });
    }

    if (qDebounced) {
      const q = qDebounced;
      arr = arr.filter((r) => {
        const name = (r.full_name || '').toLowerCase();
        const phone = (r.phone || '').toLowerCase();
        return name.includes(q) || phone.includes(q);
      });
    }

    arr.sort((a: any, b: any) => {
      const key = sortKey;
      if (key === 'last_order_at') {
        const ta = a.last_order_at ? Date.parse(a.last_order_at) : 0;
        const tb = b.last_order_at ? Date.parse(b.last_order_at) : 0;
        return sortDir === 'asc' ? ta - tb : tb - ta;
      }
      const av = a[key] ?? 0;
      const bv = b[key] ?? 0;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return arr;
  }, [rows, qDebounced, bucket, sortKey, sortDir]);

  const totals = useMemo(() => {
    const cnt = filtered.length;
    const debt = filtered.reduce((s, r) => s + Number(r.debt || 0), 0);
    const total = filtered.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    return { cnt, debt, total };
  }, [filtered]);

  function toggleSort(k: typeof sortKey) {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
  }

  return (
    <div className="relative min-h-[100dvh] bg-transparent text-slate-900">
      <Toaster position="top-right" />

      <div className="mx-auto max-w-7xl px-5 pt-8 pb-10 space-y-5">
        {/* Шапка */}
        <GlassCard className="px-6 py-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_16px_40px_rgba(34,211,238,0.55)]">
                <Users className="h-5 w-5" />
              </div>

              <div>
                <div className="text-[30px] leading-[1.05] font-semibold tracking-tight text-slate-900 drop-shadow-[0_1px_0_rgba(34,211,238,0.35)]">
                  Клиенты
                </div>
                <div className="mt-0.5 text-[13px] text-slate-600/90">
                  База клиентов сети <span className="font-medium text-slate-900">Refocus</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <GBtn variant="ghost" onClick={load}>
                <RefreshCw className="h-4 w-4" />
                Обновить
              </GBtn>
            </div>
          </div>
        </GlassCard>

        {/* Фильтры */}
        <GlassCard className="px-6 py-5">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            <div className="md:col-span-4 relative sm:max-w-[24rem]">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск: ФИО, телефон"
                className="pl-10"
              />
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            </div>

            <div className="md:col-span-5">
              <div className="flex flex-wrap gap-2">
                <Chip active={bucket === 'all'} onClick={() => setBucket('all')} tone="slate">
                  <Filter className="h-3.5 w-3.5" />
                  Все
                </Chip>
                <Chip active={bucket === 'due'} onClick={() => setBucket('due')} tone="emerald">
                  <CalendarCheck2 className="h-3.5 w-3.5" />
                  Пора
                </Chip>
                <Chip active={bucket === 'soon'} onClick={() => setBucket('soon')} tone="amber">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Скоро
                </Chip>
                <Chip active={bucket === 'later'} onClick={() => setBucket('later')} tone="slate">
                  <CalendarX2 className="h-3.5 w-3.5" />
                  Позже
                </Chip>
              </div>
            </div>

            <div className="md:col-span-2 flex gap-2">
              <Select value={sortKey} onChange={(e) => setSortKey(e.target.value as typeof sortKey)}>
                <option value="last_order_at">По дате последней покупки</option>
                <option value="orders_count">По количеству заказов</option>
                <option value="total_amount">По сумме</option>
                <option value="debt">По долгу</option>
              </Select>
              <Select value={sortDir} onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}>
                <option value="desc">↓ убыв.</option>
                <option value="asc">↑ возр.</option>
              </Select>
            </div>

            <div className="md:col-span-1 flex justify-end">
              <GBtn
                variant="ghost"
                onClick={() => {
                  setQ('');
                  setBucket('all');
                  setSortKey('last_order_at');
                  setSortDir('desc');
                }}
                className="px-3.5"
              >
                Сбросить
              </GBtn>
            </div>
          </div>
        </GlassCard>

        {/* Сводка */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatBox
            tone="sky"
            icon={<Users className="h-4 w-4" />}
            label="Всего клиентов"
            value={fmtNum(totals.cnt)}
          />
          <StatBox
            tone="emerald"
            icon={<TrendingUp className="h-4 w-4" />}
            label="Их общий оборот"
            value={fmtNum(totals.total)}
          />
          <StatBox
            tone="rose"
            icon={<WalletMinimal className="h-4 w-4" />}
            label="Их общий долг"
            value={fmtNum(totals.debt)}
          />
        </div>

        {/* Таблица */}
        <GlassCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full table-fixed text-[13px] text-slate-900">
              <thead className="bg-gradient-to-b from-white to-slate-50 text-slate-700 border-b border-slate-200/70">
                <tr>
                  <th className="px-3.5 py-2 w-56 text-left text-[13px] font-semibold">Клиент</th>
                  <th className="px-3.5 py-2 w-40 text-left text-[13px] font-semibold">Телефон</th>
                  <th className="px-3.5 py-2 w-16 text-left text-[13px] font-semibold">Заказы</th>

                  <SortHeader
                    label="Сумма"
                    align="right"
                    onClick={() => toggleSort('total_amount')}
                    active={sortKey === 'total_amount'}
                    dir={sortDir}
                    width="w-24"
                  />

                  <th className="px-3.5 py-2 w-24 text-right text-[13px] font-semibold">
                    Оплачено
                  </th>

                  <SortHeader
                    label="Долг"
                    align="right"
                    onClick={() => toggleSort('debt')}
                    active={sortKey === 'debt'}
                    dir={sortDir}
                    width="w-24"
                  />

                  <SortHeader
                    label="Последняя покупка"
                    onClick={() => toggleSort('last_order_at')}
                    active={sortKey === 'last_order_at'}
                    dir={sortDir}
                    width="w-40"
                  />

                  <th className="px-3.5 py-2 w-44 text-left text-[13px] font-semibold">
                    Следующий контроль
                  </th>

                  <th className="px-3.5 py-2 w-28 text-right text-[13px] font-semibold">
                    Действия
                  </th>
                </tr>
              </thead>

              <tbody>
                {loading &&
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={`sk-${i}`} className="border-t border-slate-100/80">
                      <td className="px-3.5 py-2" colSpan={9}>
                        <div className="h-4 w-full rounded bg-slate-100/80 animate-pulse" />
                      </td>
                    </tr>
                  ))}

                {!loading &&
                  filtered.map((r) => {
                    const href = `/customers/${r.customer_id}`;
                    const st = statusOf(r.next_check_at);

                    const badge =
                      st === 'due'
                        ? {
                            cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
                            icon: <CalendarCheck2 className="h-3.5 w-3.5" />,
                            label: 'Пора',
                          }
                        : st === 'soon'
                        ? {
                            cls: 'bg-amber-50 text-amber-700 ring-amber-200',
                            icon: <CalendarClock className="h-3.5 w-3.5" />,
                            label: 'Скоро',
                          }
                        : st === 'later'
                        ? {
                            cls: 'bg-slate-50 text-slate-600 ring-slate-200',
                            icon: <CalendarX2 className="h-3.5 w-3.5" />,
                            label: 'Позже',
                          }
                        : {
                            cls: 'bg-slate-50 text-slate-400 ring-slate-200',
                            icon: <CalendarX2 className="h-3.5 w-3.5" />,
                            label: '—',
                          };

                    return (
                      <tr
                        key={r.customer_id}
                        className="border-t border-slate-100/80 hover:bg-sky-50/60 cursor-pointer"
                        onClick={() => router.push(href)}
                        role="button"
                        tabIndex={0}
                      >
                        <td className="px-3.5 py-2 max-w-[280px] truncate" title={r.full_name ?? ''}>
                          <span className="font-medium text-slate-900">{r.full_name || '—'}</span>
                          {r.city ? (
                            <span className="ml-2 rounded-full bg-white/80 ring-1 ring-slate-200 text-slate-600 px-2 py-0.5 text-[11px]">
                              {r.city}
                            </span>
                          ) : null}
                        </td>

                        <td className="px-3.5 py-2">
                          {r.phone ? (
                            <a
                              className="text-sky-700 hover:text-sky-600 underline-offset-2 hover:underline"
                              href={`tel:${r.phone.replace(/\D/g, '')}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {r.phone}
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>

                        <td className="px-3.5 py-2 tabular-nums">{r.orders_count}</td>

                        <td className="px-3.5 py-2 text-right tabular-nums font-semibold text-slate-900">
                          {fmtNum(r.total_amount)}
                        </td>

                        <td className="px-3.5 py-2 text-right tabular-nums font-medium text-slate-800">
                          {fmtNum(r.paid_amount)}
                        </td>

                        <td
                          className={`px-3.5 py-2 text-right tabular-nums ${
                            r.debt > 0 ? 'text-rose-600 font-semibold' : 'text-slate-600'
                          }`}
                        >
                          {fmtNum(r.debt)}
                        </td>

                        <td className="px-3.5 py-2 whitespace-nowrap text-slate-700">
                          {fmtDate(r.last_order_at)}
                        </td>

                        <td className="px-3.5 py-2 whitespace-nowrap text-slate-700">
                          <span
                            className={[
                              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ring-1',
                              badge.cls,
                            ].join(' ')}
                          >
                            {badge.icon}
                            {fmtDate(r.next_check_at)} {badge.label !== '—' ? `• ${badge.label}` : ''}
                          </span>
                        </td>

                        <td className="px-3.5 py-2 text-right">
                          <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                            {r.phone ? (
                              <a
                                href={`tel:${r.phone.replace(/\D/g, '')}`}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-white/85 ring-1 ring-sky-200 shadow-[0_10px_26px_rgba(15,23,42,0.14)] hover:bg-white transition"
                                title="Позвонить"
                              >
                                <Phone className="h-4 w-4 text-sky-700" />
                              </a>
                            ) : null}

                            <Link
                              href={href}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-tr from-teal-400 via-cyan-400 to-sky-400 shadow-[0_14px_35px_rgba(56,189,248,0.45)] hover:from-teal-300 hover:via-cyan-300 hover:to-sky-300 transition"
                              title="Открыть карточку клиента"
                            >
                              <ExternalLink className="h-4 w-4 text-white" />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                {!loading && !filtered.length && (
                  <tr>
                    <td className="px-3.5 py-12 text-center text-slate-600" colSpan={9}>
                      <div className="mx-auto max-w-md rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/85 ring-1 ring-sky-200/70 shadow-[0_22px_70px_rgba(15,23,42,0.18)] p-8">
                        Ничего не найдено
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
