// app/customers/[id]/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import getSupabase from '@/lib/supabaseClient';
import toast, { Toaster } from 'react-hot-toast';

/* ========= Types ========= */
type CustomerSummary = {
  customer_id: number;
  full_name: string | null;
  phone: string | null;
  orders_count: number | null;
  total_amount: number | null;
  paid_amount: number | null;
  debt: number | null;
  last_order_at: string | null;
  next_check_at?: string | null;
};

type OrderRow = {
  order_no: number;
  customer_id?: number;
  customer_name: string | null;
  customer_phone: string | null;
  branch_name: string | null;
  status: string | null;
  total_amount: number;
  paid_amount: number;
  debt: number;
  created_at: string;
  created_at_fmt?: string;
};

type PaymentRow = {
  id: number; // payments.id ИЛИ order_payments_view.payment_id (алиас)
  order_id: number; // payments.order_id ИЛИ order_payments_view.order_no (алиас)
  amount: number;
  method: string | null;
  created_at: string;
  created_at_fmt?: string;
};

type NoteRow = {
  id: number;
  customer_id: number;
  body: string;
  author: string | null;
  created_at: string;
};

/* ========= Utils ========= */
const fmtNum = (n?: number | null) =>
  typeof n === 'number'
    ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)
    : '—';

const fmtDateTime = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yy} ${hh}:${mi}`;
};

/* ========= UI helpers в стиле сверки выручки ========= */

const Card = ({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={`rounded-2xl border border-white/90 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.35)] backdrop-blur-xl ${className}`}
  >
    {children}
  </div>
);

const Chip = ({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) => {
  const base =
    'h-9 px-3 rounded-full text-[13px] font-semibold transition inline-flex items-center justify-center';
  const inactive =
    'text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 shadow-sm';
  const activeCls =
    'text-white bg-gradient-to-r from-sky-500 via-cyan-400 to-indigo-500 shadow-[0_8px_25px_rgba(59,130,246,0.55)]';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${active ? activeCls : inactive}`}
    >
      {children}
    </button>
  );
};

const Pill = ({
  tone = 'slate',
  children,
}: {
  tone?: 'slate' | 'green' | 'blue' | 'amber' | 'red';
  children: React.ReactNode;
}) => {
  const map: Record<string, string> = {
    slate: 'bg-slate-50 text-slate-700 border-slate-100',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    blue: 'bg-sky-50 text-sky-700 border-sky-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    red: 'bg-rose-50 text-rose-700 border-rose-100',
  };
  return (
    <span
      className={`px-2.5 py-1 rounded-full text-xs border ${map[tone]} inline-flex items-center gap-1`}
    >
      {children}
    </span>
  );
};

const ActionBtn = ({
  children,
  href,
}: {
  children: React.ReactNode;
  href: string;
}) => (
  <a
    href={href}
    className="h-9 px-3 inline-flex items-center justify-center rounded-full text-[13px] font-semibold text-white bg-gradient-to-r from-sky-500 via-cyan-400 to-indigo-500 shadow-[0_10px_30px_rgba(59,130,246,0.55)] hover:brightness-110 active:scale-[.97] transition"
  >
    {children}
  </a>
);

/* ========= Page ========= */
export default function CustomerPage() {
  const params = useParams<{ id: string }>();
  const customerId = Number(params.id);

  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [tab, setTab] = useState<'summary' | 'orders' | 'payments' | 'notes'>(
    'summary',
  );
  const [noteDraft, setNoteDraft] = useState('');

  useEffect(() => {
    if (!Number.isFinite(customerId) || !customerId) return;

    let ignore = false;

    async function load() {
      setLoading(true);
      try {
        const sb = getSupabase();

        /* 1) Сводка */
        let phone: string | null = null;
        let fullName: string | null = null;

        const { data: sRow, error: sErr } = await sb
          .from('customer_stats')
          .select('*')
          .eq('customer_id', customerId)
          .maybeSingle();

        if (sErr) {
          console.error('customer_stats:', sErr);
          toast.error('Не удалось загрузить карточку клиента');
        }

        if (sRow) {
          phone = (sRow as any).phone ?? null;
          fullName = (sRow as any).full_name ?? null;
        }

        if (!ignore) {
          setSummary((sRow || null) as any);
        }

        /* 2) Заказы: каскад из трёх вариантов */
        let orderList: OrderRow[] = [];
        const orderErrors: string[] = [];

        if (!ignore) {
          // 2.1 customer_orders_view по customer_id
          const q1 = await sb
            .from('customer_orders_view')
            .select('*')
            .eq('customer_id', customerId)
            .order('order_no', { ascending: false });

          if (q1.error) {
            orderErrors.push(`customer_orders_view: ${q1.error.message}`);
          } else if (q1.data) {
            orderList = q1.data as any;
          }

          // 2.2 orders_view по телефону
          if (!orderList.length && phone) {
            const q2 = await sb
              .from('orders_view')
              .select('*')
              .eq('customer_phone', phone)
              .order('order_no', { ascending: false });

            if (q2.error) {
              orderErrors.push(`orders_view.byPhone: ${q2.error.message}`);
            } else if (q2.data) {
              orderList = q2.data as any;
            }
          }

          // 2.3 orders_view по имени
          if (!orderList.length && fullName) {
            const q3 = await sb
              .from('orders_view')
              .select('*')
              .ilike('customer_name', `%${fullName}%`)
              .order('order_no', { ascending: false });

            if (q3.error) {
              orderErrors.push(`orders_view.byName: ${q3.error.message}`);
            } else if (q3.data) {
              orderList = q3.data as any;
            }
          }

          if (!ignore) {
            if (!orderList.length && orderErrors.length) {
              console.error('Orders cascade failed →', orderErrors);
            }
            setOrders(orderList);
          }
        }

        /* 3) Платежи */
        if (!ignore) {
          let rows: PaymentRow[] = [];
          const orderIds = orderList.map((o) => o.order_no);

          if (orderIds.length) {
            const r1 = await sb
              .from('payments')
              .select('id, order_id, amount, method, created_at')
              .in('order_id', orderIds)
              .order('id', { ascending: false });

            if (!r1.error && r1.data?.length) {
              rows = (r1.data as any).map((x: PaymentRow) => ({
                ...x,
                created_at_fmt: fmtDateTime(x.created_at),
              }));
            } else {
              const r2 = await sb
                .from('order_payments_view')
                .select(
                  'id:payment_id, order_id:order_no, amount, method, created_at, created_at_fmt',
                )
                .in('order_no', orderIds)
                .order('payment_id', { ascending: false });

              if (r2.error) {
                console.error('order_payments_view:', r2.error);
              } else if (r2.data) {
                rows = (r2.data as any).map((x: any) => ({
                  ...x,
                  created_at_fmt:
                    x.created_at_fmt || fmtDateTime(x.created_at),
                }));
              }
            }
          }

          if (!ignore) setPayments(rows);
        }

        /* 4) Заметки */
        if (!ignore) {
          const { data: nRows, error: nErr } = await sb
            .from('customer_notes')
            .select('*')
            .eq('customer_id', customerId)
            .order('id', { ascending: false });

          if (nErr) {
            console.error('customer_notes:', nErr);
          } else if (!ignore) {
            setNotes((nRows || []) as any);
          }
        }
      } catch (err: any) {
        console.error('CustomerPage load error:', err);
        if (!ignore) toast.error('Ошибка загрузки данных клиента');
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    load();

    return () => {
      ignore = true;
    };
  }, [customerId]);

  const totalPaid = useMemo(
    () =>
      typeof summary?.paid_amount === 'number'
        ? summary.paid_amount
        : payments.reduce((s, p) => s + p.amount, 0),
    [summary, payments],
  );

  /* ========= KPI ========= */
  const kpis = useMemo(() => {
    const ordersCount = summary?.orders_count ?? orders.length;
    const total =
      summary?.total_amount ??
      orders.reduce((s, r) => s + (r.total_amount || 0), 0);
    const avgCheck = ordersCount > 0 ? total / ordersCount : null;

    let avgIntervalDays: number | null = null;
    if (orders.length >= 2) {
      const dates = orders
        .map((o) => Date.parse(o.created_at))
        .filter((x) => Number.isFinite(x))
        .sort((a, b) => a - b);

      if (dates.length >= 2) {
        let sum = 0;
        for (let i = 1; i < dates.length; i++) sum += dates[i] - dates[i - 1];
        avgIntervalDays = Math.round(
          sum / (dates.length - 1) / 86400000,
        );
      }
    }

    let daysSince: number | null = null;
    const lastIso = summary?.last_order_at || orders[0]?.created_at;
    if (lastIso) {
      const diff = Date.now() - Date.parse(lastIso);
      if (Number.isFinite(diff)) {
        daysSince = Math.max(0, Math.floor(diff / 86400000));
      }
    }

    const percent = total > 0 ? Math.round((totalPaid / total) * 100) : null;

    return { avgCheck, avgIntervalDays, daysSince, percent };
  }, [summary, orders, totalPaid]);

  /* ========= UI ========= */
  return (
    // ВАЖНО: фон тут теперь ПРОЗРАЧНЫЙ, без прямоугольника
    <div className="min-h-screen text-slate-900">
      <Toaster position="top-right" />

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-4">
        {/* Шапка */}
        <Card className="p-4 md:p-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="min-w-0 flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-sky-500 via-cyan-400 to-indigo-500 ring-1 ring-sky-200/80 grid place-items-center shadow-[0_12px_35px_rgba(59,130,246,0.7)]">
                <span className="text-white font-semibold text-base">
                  {summary?.full_name?.[0]?.toUpperCase() || 'C'}
                </span>
              </div>
              <div className="min-w-0">
                <div className="text-[20px] md:text-[22px] font-semibold leading-tight bg-gradient-to-r from-sky-700 to-indigo-700 bg-clip-text text-transparent">
                  {summary?.full_name || 'Клиент'}
                </div>
                <div className="mt-1 text-[11px] tracking-[0.22em] uppercase text-slate-400">
                  Карточка клиента <span className="font-kiona">Refocus</span>
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {summary?.phone ? (
                    <a
                      className="text-sky-600 hover:text-sky-500 underline-offset-2 hover:underline"
                      href={`tel:${summary.phone.replace(/\D/g, '')}`}
                    >
                      {summary.phone}
                    </a>
                  ) : (
                    'Телефон не указан'
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 justify-start md:justify-end">
              <Pill tone="blue">
                {fmtNum(summary?.orders_count || 0)} заказ(ов)
              </Pill>
              <Pill tone="green">Оплачено: {fmtNum(totalPaid)}</Pill>
              <Pill tone={summary?.debt ? 'red' : 'slate'}>
                Долг: {fmtNum(summary?.debt ?? 0)}
              </Pill>
              {summary?.phone && (
                <ActionBtn
                  href={`https://wa.me/${summary.phone.replace(/\D/g, '')}`}
                >
                  WhatsApp
                </ActionBtn>
              )}
              <ActionBtn href={`/orders?customer=${customerId}`}>
                Все заказы
              </ActionBtn>
            </div>
          </div>
        </Card>

        {/* Верхняя сводка (плитки как на сверке) */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="px-5 h-24 flex items-center justify-between">
            <div className="text-[13px] text-slate-500">Оборот</div>
            <div className="text-2xl font-extrabold tabular-nums bg-gradient-to-r from-sky-600 to-indigo-600 bg-clip-text text-transparent">
              {fmtNum(summary?.total_amount ?? 0)}
            </div>
          </Card>
          <Card className="px-5 h-24 flex items-center justify-between">
            <div className="text-[13px] text-slate-500">Оплачено</div>
            <div className="text-2xl font-extrabold tabular-nums bg-gradient-to-r from-sky-600 to-indigo-600 bg-clip-text text-transparent">
              {fmtNum(totalPaid)}
            </div>
          </Card>
          <Card className="px-5 h-24 flex items-center justify-between">
            <div className="text-[13px] text-slate-500">Долг</div>
            <div
              className={`text-2xl font-extrabold tabular-nums ${
                (summary?.debt || 0) > 0
                  ? 'text-rose-600'
                  : 'bg-gradient-to-r from-sky-600 to-indigo-600 bg-clip-text text-transparent'
              }`}
            >
              {fmtNum(summary?.debt ?? 0)}
            </div>
          </Card>
          <Card className="px-5 h-24 flex items-center justify-between">
            <div className="text-[13px] text-slate-500">Последняя покупка</div>
            <div className="text-[15px] font-semibold text-slate-800 tabular-nums">
              {fmtDateTime(summary?.last_order_at)}
            </div>
          </Card>
        </div>

        {/* KPI-блок */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="px-5 h-24 flex items-center justify-between">
            <div className="text-[13px] text-slate-500">Средний чек</div>
            <div className="text-xl md:text-2xl font-extrabold tabular-nums text-slate-900">
              {kpis.avgCheck != null
                ? fmtNum(Math.round(kpis.avgCheck))
                : '—'}
            </div>
          </Card>
          <Card className="px-5 h-24 flex items-center justify-between">
            <div className="text-[13px] text-slate-500">
              Средний интервал, дн.
            </div>
            <div className="text-xl md:text-2xl font-extrabold tabular-nums text-slate-900">
              {kpis.avgIntervalDays != null
                ? fmtNum(kpis.avgIntervalDays)
                : '—'}
            </div>
          </Card>
          <Card className="px-5 h-24 flex items-center justify-between">
            <div className="text-[13px] text-slate-500">Дней с последней</div>
            <div className="text-xl md:text-2xl font-extrabold tabular-nums text-slate-900">
              {kpis.daysSince != null ? fmtNum(kpis.daysSince) : '—'}
            </div>
          </Card>
          <Card className="px-5 h-24 flex items-center justify-between">
            <div className="text-[13px] text-slate-500">% предоплаты</div>
            <div className="text-xl md:text-2xl font-extrabold tabular-nums text-slate-900">
              {kpis.percent != null ? `${kpis.percent}%` : '—'}
            </div>
          </Card>
        </div>

        {/* Табы */}
        <Card className="p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip active={tab === 'summary'} onClick={() => setTab('summary')}>
              Сводка
            </Chip>
            <Chip active={tab === 'orders'} onClick={() => setTab('orders')}>
              Заказы
            </Chip>
            <Chip
              active={tab === 'payments'}
              onClick={() => setTab('payments')}
            >
              Платежи
            </Chip>
            <Chip active={tab === 'notes'} onClick={() => setTab('notes')}>
              Заметки
            </Chip>
          </div>
        </Card>

        {/* Контент табов */}
        <div>
          {loading ? (
            <Card className="p-8 text-slate-500 text-sm">
              Загружаю данные клиента…
            </Card>
          ) : (
            <>
              {tab === 'summary' && (
                <Card className="p-5">
                  <div className="grid md:grid-cols-3 gap-4">
                    <div>
                      <div className="text-sm text-slate-500">
                        Следующий контроль
                      </div>
                      <div className="text-base font-medium text-slate-900">
                        {fmtDateTime(summary?.next_check_at ?? null)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-slate-500">Телефон</div>
                      <div className="text-base font-medium text-slate-900">
                        {summary?.phone ? (
                          <a
                            className="text-sky-600 hover:text-sky-500 underline-offset-2 hover:underline"
                            href={`tel:${summary.phone.replace(/\D/g, '')}`}
                          >
                            {summary.phone}
                          </a>
                        ) : (
                          '—'
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-slate-500">
                        Заказов всего
                      </div>
                      <div className="text-base font-medium tabular-nums text-slate-900">
                        {fmtNum(summary?.orders_count || 0)}
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              {tab === 'orders' && (
                <Card className="p-0 overflow-x-auto">
                  <table className="min-w-full table-fixed text-[14px]">
                    <thead className="bg-white/95 backdrop-blur">
                      <tr className="text-slate-500 text-xs uppercase tracking-wide">
                        <th className="px-4 py-3 w-28 text-left">№</th>
                        <th className="px-4 py-3 w-40 text-left">Филиал</th>
                        <th className="px-4 py-3 w-36 text-left">Статус</th>
                        <th className="px-4 py-3 w-24 text-right">Сумма</th>
                        <th className="px-4 py-3 w-24 text-right">
                          Оплачено
                        </th>
                        <th className="px-4 py-3 w-20 text-right">Долг</th>
                        <th className="px-4 py-3 w-44 text-left">Создан</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((r) => {
                        const s = (r.status || '').toUpperCase();
                        const tone: 'green' | 'amber' | 'slate' =
                          s === 'ВЫДАНО' || s === 'DELIVERED'
                            ? 'green'
                            : s === 'ГОТОВО' || s === 'READY'
                            ? 'amber'
                            : 'slate';
                        return (
                          <tr
                            key={r.order_no}
                            className="border-t border-slate-100 hover:bg-slate-50/70"
                          >
                            <td className="px-4 py-2.5 font-medium tabular-nums text-slate-900">
                              ORD-{String(r.order_no).padStart(5, '0')}
                            </td>
                            <td className="px-4 py-2.5 text-slate-800">
                              {r.branch_name ?? '—'}
                            </td>
                            <td className="px-4 py-2.5">
                              <Pill tone={tone}>{r.status ?? '—'}</Pill>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">
                              {fmtNum(r.total_amount)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">
                              {fmtNum(r.paid_amount)}
                            </td>
                            <td
                              className={`px-4 py-2.5 text-right tabular-nums ${
                                r.debt > 0
                                  ? 'text-rose-600 font-semibold'
                                  : 'text-slate-900'
                              }`}
                            >
                              {fmtNum(r.debt)}
                            </td>
                            <td className="px-4 py-2.5 text-slate-800">
                              {r.created_at_fmt || fmtDateTime(r.created_at)}
                            </td>
                          </tr>
                        );
                      })}
                      {!orders.length && (
                        <tr>
                          <td
                            className="px-4 py-8 text-slate-500 text-sm"
                            colSpan={7}
                          >
                            Заказов пока нет
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </Card>
              )}

              {tab === 'payments' && (
                <Card className="p-0 overflow-x-auto">
                  <table className="min-w-full table-fixed text-[14px]">
                    <thead className="bg-white/95 backdrop-blur">
                      <tr className="text-slate-500 text-xs uppercase tracking-wide">
                        <th className="px-4 py-3 w-20 text-left">ID</th>
                        <th className="px-4 py-3 w-28 text-left">Заказ</th>
                        <th className="px-4 py-3 w-24 text-right">Сумма</th>
                        <th className="px-4 py-3 w-40 text-left">Метод</th>
                        <th className="px-4 py-3 w-48 text-left">Дата</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr
                          key={p.id}
                          className="border-t border-slate-100 hover:bg-slate-50/70"
                        >
                          <td className="px-4 py-2.5 tabular-nums text-slate-900">
                            {p.id}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-slate-900">
                            ORD-{String(p.order_id).padStart(5, '0')}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">
                            {fmtNum(p.amount)}
                          </td>
                          <td className="px-4 py-2.5">
                            <Pill tone="blue">{p.method ?? '—'}</Pill>
                          </td>
                          <td className="px-4 py-2.5 text-slate-800">
                            {p.created_at_fmt || fmtDateTime(p.created_at)}
                          </td>
                        </tr>
                      ))}
                      {!payments.length && (
                        <tr>
                          <td
                            className="px-4 py-8 text-slate-500 text-sm"
                            colSpan={5}
                          >
                            Платежей пока нет
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </Card>
              )}

              {tab === 'notes' && (
                <Card className="p-5">
                  <div className="flex flex-col md:flex-row gap-3">
                    <textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Новая заметка…"
                      className="flex-1 rounded-xl border border-slate-200 bg-white text-slate-900 p-3 focus:outline-none focus:ring-2 focus:ring-sky-300 placeholder:text-slate-400"
                      rows={3}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const text = noteDraft.trim();
                        if (!text) return;
                        const sb = getSupabase();
                        const { error } = await sb
                          .from('customer_notes')
                          .insert({ customer_id: customerId, body: text });
                        if (error) {
                          toast.error(error.message);
                          return;
                        }
                        setNoteDraft('');
                        const { data } = await sb
                          .from('customer_notes')
                          .select('*')
                          .eq('customer_id', customerId)
                          .order('id', { ascending: false });
                        setNotes((data || []) as any);
                        toast.success('Заметка добавлена');
                      }}
                      className="px-5 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-sky-500 to-indigo-500 hover:brightness-110 active:scale-[.97] transition"
                    >
                      Добавить
                    </button>
                  </div>

                  <div className="mt-5 divide-y divide-slate-100">
                    {notes.map((n) => (
                      <div
                        key={n.id}
                        className="py-3 flex items-start justify-between gap-4"
                      >
                        <div>
                          <div className="text-sm text-slate-900 whitespace-pre-wrap">
                            {n.body}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {fmtDateTime(n.created_at)}
                            {n.author ? ` · ${n.author}` : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            const sb = getSupabase();
                            const { error } = await sb
                              .from('customer_notes')
                              .delete()
                              .eq('id', n.id);
                            if (error) {
                              toast.error(error.message);
                              return;
                            }
                            setNotes((prev) =>
                              prev.filter((x) => x.id !== n.id),
                            );
                            toast.success('Удалено');
                          }}
                          className="text-xs px-3 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        >
                          удалить
                        </button>
                      </div>
                    ))}
                    {!notes.length && (
                      <div className="py-8 text-slate-500 text-sm">
                        Заметок пока нет
                      </div>
                    )}
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
