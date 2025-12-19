'use client';

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0,
  }).format(Number(n || 0));

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

const statusOf = (
  nextISO: string | null,
): 'due' | 'soon' | 'later' | 'none' => {
  if (!nextISO) return 'none';
  const ts = Date.parse(nextISO);
  if (!Number.isFinite(ts)) return 'none';
  const now = Date.now();
  const soonTs = now + 30 * 24 * 3600 * 1000;
  if (ts <= now) return 'due';
  if (ts <= soonTs) return 'soon';
  return 'later';
};

/* ========= Small UI: светлый refocus-стиль ========= */

function GlassCard({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-3xl border border-sky-100/80 bg-white/92 backdrop-blur-2xl shadow-[0_22px_80px_rgba(15,23,42,0.22)] ${className}`}
    >
      {children}
    </div>
  );
}

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
  variant?: 'solid' | 'outline';
  type?: 'button' | 'submit';
}) {
  const base =
    'inline-flex items-center gap-2 px-3.5 py-2.5 rounded-2xl text-[13px] font-medium transition ' +
    'focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';
  const solid =
    'bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-400 text-slate-950 hover:from-sky-400 hover:via-cyan-400 hover:to-emerald-300';
  const outline =
    'border border-sky-300/70 bg-white/90 text-sky-700 hover:bg-sky-50';
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variant === 'solid' ? solid : outline}`}
    >
      {children}
    </button>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full px-3.5 py-2.5 rounded-2xl border border-sky-100 bg-white/95 backdrop-blur text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-sky-300 ${props.className || ''}`}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full px-3.5 py-2.5 rounded-2xl border border-sky-100 bg-white/95 backdrop-blur text-sm text-slate-900 outline-none focus:ring-2 focus:ring-sky-300 ${props.className || ''}`}
    />
  );
}

function Chip({
  active,
  onClick,
  children,
  tone = 'default',
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  tone?: 'default' | 'emerald' | 'amber' | 'slate';
}) {
  const base =
    'h-9 px-3 rounded-full text-[12px] font-semibold transition inline-flex items-center gap-1.5 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300';
  const map = {
    default:
      'text-slate-700 border border-slate-200 bg-white/90 hover:bg-slate-50',
    emerald:
      'text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100/80',
    amber:
      'text-amber-700 border border-amber-200 bg-amber-50 hover:bg-amber-100/80',
    slate:
      'text-slate-700 border border-slate-200 bg-slate-50 hover:bg-slate-100/80',
  } as const;
  const activeCls =
    'text-white bg-gradient-to-r from-sky-500 via-cyan-500 to-violet-500 shadow-[0_10px_30px_rgba(56,189,248,0.65)] border-transparent';

  return (
    <button
      onClick={onClick}
      className={`${base} ${active ? activeCls : map[tone]}`}
      type="button"
    >
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
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-600"
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
  const [sortKey, setSortKey] = useState<
    'last_order_at' | 'orders_count' | 'total_amount' | 'debt'
  >('last_order_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      setLoading(true);
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('customer_stats')
        .select('*');
      if (error) throw error;

      const normalized: StatRow[] = ((data as any[]) || []).map((r) => ({
        customer_id: r.customer_id,
        full_name: r.full_name ?? null,
        phone: r.phone ?? null,
        birthday: r.birthday ?? null,
        city: r.city ?? null,
        marketing_opt_in:
          typeof r.marketing_opt_in === 'boolean'
            ? r.marketing_opt_in
            : null,
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
    tRef.current = window.setTimeout(
      () => setQDebounced(qDeferred.trim().toLowerCase()),
      200,
    );
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
    const debt = filtered.reduce(
      (s, r) => s + Number(r.debt || 0),
      0,
    );
    const total = filtered.reduce(
      (s, r) => s + Number(r.total_amount || 0),
      0,
    );
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
    <div className="min-h-[100dvh] text-slate-900">
      <Toaster position="top-right" />

      <div className="mx-auto max-w-7xl px-6 py-6 space-y-4">
        {/* Шапка */}
        <GlassCard className="px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="inline-flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 via-cyan-400 to-emerald-400 text-slate-950 shadow-[0_16px_40px_rgba(56,189,248,0.7)]">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[18px] font-semibold tracking-tight">
                  Клиенты
                </div>
                <div className="text-[12px] text-slate-500">
                  База клиентов сети Refocus
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <GBtn variant="outline" onClick={load}>
                <RefreshCw className="h-4 w-4" />
                Обновить
              </GBtn>
            </div>
          </div>
        </GlassCard>

        {/* Фильтры */}
        <GlassCard className="px-6 py-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            <div className="md:col-span-4 relative">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск: ФИО, телефон"
                className="pl-10"
              />
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            </div>

            <div className="md:col-span-4">
              <div className="flex flex-wrap gap-1.5">
                <Chip
                  active={bucket === 'all'}
                  onClick={() => setBucket('all')}
                  tone="slate"
                >
                  <Filter className="h-3.5 w-3.5" />
                  Все
                </Chip>
                <Chip
                  active={bucket === 'due'}
                  onClick={() => setBucket('due')}
                  tone="emerald"
                >
                  <CalendarCheck2 className="h-3.5 w-3.5" />
                  Пора
                </Chip>
                <Chip
                  active={bucket === 'soon'}
                  onClick={() => setBucket('soon')}
                  tone="amber"
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  Скоро
                </Chip>
                <Chip
                  active={bucket === 'later'}
                  onClick={() => setBucket('later')}
                  tone="slate"
                >
                  <CalendarX2 className="h-3.5 w-3.5" />
                  Позже
                </Chip>
              </div>
            </div>

            <div className="md:col-span-3 flex gap-2">
              <Select
                value={sortKey}
                onChange={(e) =>
                  setSortKey(e.target.value as typeof sortKey)
                }
              >
                <option value="last_order_at">
                  По дате последней покупки
                </option>
                <option value="orders_count">
                  По количеству заказов
                </option>
                <option value="total_amount">По сумме</option>
                <option value="debt">По долгу</option>
              </Select>
              <Select
                value={sortDir}
                onChange={(e) =>
                  setSortDir(e.target.value as 'asc' | 'desc')
                }
              >
                <option value="desc">↓ убыв.</option>
                <option value="asc">↑ возр.</option>
              </Select>
            </div>

            <div className="md:col-span-1 flex justify-end">
              <GBtn
                variant="outline"
                onClick={() => {
                  setQ('');
                  setBucket('all');
                  setSortKey('last_order_at');
                  setSortDir('desc');
                }}
              >
                Сбросить
              </GBtn>
            </div>
          </div>
        </GlassCard>

        {/* Сводка */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <GlassCard className="px-6 h-24 flex items-center justify-between">
            <div className="inline-flex items-center gap-2 text-[12px] text-slate-500">
              <Users className="h-4 w-4 text-slate-400" />
              Всего клиентов
            </div>
            <div className="text-2xl font-extrabold tabular-nums bg-gradient-to-r from-sky-500 to-indigo-500 bg-clip-text text-transparent">
              {fmtNum(totals.cnt)}
            </div>
          </GlassCard>

          <GlassCard className="px-6 h-24 flex items-center justify-between">
            <div className="inline-flex items-center gap-2 text-[12px] text-slate-500">
              <TrendingUp className="h-4 w-4 text-slate-400" />
              Их общий оборот
            </div>
            <div className="text-2xl font-extrabold tabular-nums bg-gradient-to-r from-sky-500 to-indigo-500 bg-clip-text text-transparent">
              {fmtNum(totals.total)}
            </div>
          </GlassCard>

          <GlassCard className="px-6 h-24 flex items-center justify-between">
            <div className="inline-flex items-center gap-2 text-[12px] text-slate-500">
              <WalletMinimal className="h-4 w-4 text-slate-400" />
              Их общий долг
            </div>
            <div className="text-2xl font-extrabold tabular-nums bg-gradient-to-r from-sky-500 to-indigo-500 bg-clip-text text-transparent">
              {fmtNum(totals.debt)}
            </div>
          </GlassCard>
        </div>

        {/* Таблица */}
        <GlassCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full table-fixed text-[13px] text-slate-900">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-3.5 py-2 w-56 text-left text-[13px] font-semibold">
                    Клиент
                  </th>
                  <th className="px-3.5 py-2 w-40 text-left text-[13px] font-semibold">
                    Телефон
                  </th>
                  <th className="px-3.5 py-2 w-16 text-left text-[13px] font-semibold">
                    Заказы
                  </th>
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
                  <th className="px-3.5 py-2 w-40 text-left text-[13px] font-semibold">
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
                    <tr
                      key={`sk-${i}`}
                      className="border-t border-slate-100"
                    >
                      <td className="px-3.5 py-1.5" colSpan={9}>
                        <div className="h-4 w-full bg-slate-100 rounded animate-pulse" />
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
                            icon: (
                              <CalendarCheck2 className="h-3.5 w-3.5" />
                            ),
                            label: 'Пора',
                          }
                        : st === 'soon'
                        ? {
                            cls: 'bg-amber-50 text-amber-700 ring-amber-200',
                            icon: (
                              <CalendarClock className="h-3.5 w-3.5" />
                            ),
                            label: 'Скоро',
                          }
                        : st === 'later'
                        ? {
                            cls: 'bg-slate-50 text-slate-600 ring-slate-200',
                            icon: (
                              <CalendarX2 className="h-3.5 w-3.5" />
                            ),
                            label: 'Позже',
                          }
                        : {
                            cls: 'bg-slate-50 text-slate-400 ring-slate-200',
                            icon: (
                              <CalendarX2 className="h-3.5 w-3.5" />
                            ),
                            label: '—',
                          };

                    return (
                      <tr
                        key={r.customer_id}
                        className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                        onClick={() => router.push(href)}
                        role="button"
                        tabIndex={0}
                      >
                        <td
                          className="px-3.5 py-1.5 max-w-[280px] truncate"
                          title={r.full_name ?? ''}
                        >
                          {r.full_name || '—'}
                          {r.city ? (
                            <span className="ml-2 rounded-full bg-slate-50 border border-slate-200 text-slate-600 px-2 py-0.5 text-[11px]">
                              {r.city}
                            </span>
                          ) : null}
                        </td>

                        <td className="px-3.5 py-1.5">
                          {r.phone ? (
                            <a
                              className="text-sky-600 hover:text-sky-500 underline-offset-2 hover:underline"
                              href={`tel:${r.phone.replace(/\D/g, '')}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {r.phone}
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>

                        <td className="px-3.5 py-1.5 tabular-nums">
                          {r.orders_count}
                        </td>

                        <td className="px-3.5 py-1.5 text-right tabular-nums font-medium">
                          {fmtNum(r.total_amount)}
                        </td>

                        <td className="px-3.5 py-1.5 text-right tabular-nums font-medium">
                          {fmtNum(r.paid_amount)}
                        </td>

                        <td
                          className={`px-3.5 py-1.5 text-right tabular-nums ${
                            r.debt > 0
                              ? 'text-rose-600 font-semibold'
                              : 'text-slate-600'
                          }`}
                        >
                          {fmtNum(r.debt)}
                        </td>

                        <td className="px-3.5 py-1.5 whitespace-nowrap text-slate-700">
                          {fmtDate(r.last_order_at)}
                        </td>

                        <td className="px-3.5 py-1.5 whitespace-nowrap text-slate-700">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ring-1 ${badge.cls}`}
                          >
                            {badge.icon}
                            {fmtDate(r.next_check_at)}{' '}
                            {badge.label !== '—'
                              ? `• ${badge.label}`
                              : ''}
                          </span>
                        </td>

                        <td className="px-3.5 py-1.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {r.phone ? (
                              <a
                                href={`tel:${r.phone.replace(/\D/g, '')}`}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-2xl border border-sky-200 bg-white hover:bg-sky-50 transition"
                                title="Позвонить"
                              >
                                <Phone className="h-4 w-4 text-sky-500" />
                              </a>
                            ) : null}

                            <Link
                              href={href}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-gradient-to-tr from-sky-500 via-cyan-500 to-violet-500 hover:from-sky-400 hover:via-cyan-400 hover:to-violet-400 shadow-[0_10px_26px_rgba(56,189,248,0.65)] transition"
                              title="Открыть карточку клиента"
                            >
                              <ExternalLink className="h-4 w-4 text-slate-950" />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                {!loading && !filtered.length && (
                  <tr>
                    <td
                      className="px-3.5 py-10 text-center text-slate-500"
                      colSpan={9}
                    >
                      Ничего не найдено
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
