'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';

/* ===========================
   Покупательский экран — POS
   Источник: Supabase Realtime
   Филиал: Кант (branch_id=4)
=========================== */

type Stage = 'idle' | 'confirm' | 'pay_qr' | 'pay_card' | 'done' | 'error' | 'refund';

type OrderRow = {
  id: number;
  branch_id: number;
  status: string;             // order_status_t
  total: number | null;       // итог по заказу
  prepaid: number | null;     // аванс (если ведётся отдельно)
  paid_amount: number | null; // оплачено суммарно
  discount: number | null;
  total_amount: number | null;
  created_at?: string | null;
};

type OrderItemRow = {
  id: number;
  order_id: number;
  item_type: string;            // USER-DEFINED
  product_id: number | null;
  eye: string | null;           // USER-DEFINED
  lens_type: string | null;     // text
  sph: number | null;
  cyl: number | null;
  ax: number | null;
  pd_snapshot: number | null;
  qty: number;
  price: number;                // за единицу
};

const BRANCH_ID = 4;

/* ===== Градиенты ===== */
const GRADIENT_BRAND = 'bg-gradient-to-r from-[#1A284E] via-[#2C4BA5] to-[#4F9DF6]';
const GRADIENT_PRICE = 'bg-clip-text text-transparent bg-gradient-to-r from-[#2C4BA5] via-[#0BB783] to-[#00E3A1]';

/* ===== Маппинг статусов orders → экранов ===== */
const STATUS_TO_STAGE: Record<string, Stage> = {
  NEW: 'confirm',
  CANCELLED: 'refund',
  DELIVERED: 'done',
  READY: 'done',
  AT_BRANCH: 'done',
  TO_LAB: 'done',
  IN_LAB: 'done',
  IN_TRANSIT: 'done',
  UNCLAIMED: 'done',
};

export default function CustomerScreen() {
  const params = useSearchParams();
  const terminal = params.get('terminal') || 'TERMINAL-001';
  const dev = params.get('dev') === '1';

  const [online, setOnline] = useState(true);
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [stage, setStage] = useState<Stage>(params.get('stage') as Stage || 'idle');
  const [qrSeconds, setQrSeconds] = useState(120);

  /* Сеть */
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  /* Подписка: последний NEW заказ филиала + payments */
  useEffect(() => {
    const supabase = getBrowserSupabase();

    // первичная загрузка последнего NEW
    supabase
      .from('orders')
      .select('*')
      .eq('branch_id', BRANCH_ID)
      .in('status', ['NEW'])
      .order('id', { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (error) console.error(error);
        if (data && data[0]) {
          const row = data[0] as OrderRow;
          setOrder(row);
          setStage(STATUS_TO_STAGE[row.status] || 'done');
        } else {
          setOrder(null);
          setStage('idle');
        }
      });

    // Realtime по ORDERS
    // Realtime по ORDERS
    const chOrders = supabase
      .channel(`orders-branch-${BRANCH_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `branch_id=eq.${BRANCH_ID}` },
        async (payload) => {
          // аккуратно приводим и узко используем одно значение
          const next = (payload.new ?? payload.old) as Partial<OrderRow> | null;
          if (!next || next.branch_id !== BRANCH_ID) return;

          const status = (next.status ?? 'NEW') as keyof typeof STATUS_TO_STAGE;

          // обновляем текущий заказ и стадию
          setOrder(next as OrderRow);
          setStage(STATUS_TO_STAGE[status] ?? 'done');

          // если активный заказ перестал быть NEW — подгружаем свежий NEW
          if (status !== 'NEW') {
            const { data } = await supabase
              .from('orders')
              .select('*')
              .eq('branch_id', BRANCH_ID)
              .eq('status', 'NEW')
              .order('id', { ascending: false })
              .limit(1);

            if (data && data[0]) {
              const newest = data[0] as OrderRow;
              setOrder(newest);
              setStage(STATUS_TO_STAGE[newest.status] ?? 'done');
            }
          }
        }
      )
      .subscribe();


    // Realtime по PAYMENTS: подтягиваем обновлённый заказ
    const chPayments = supabase
      .channel(`payments-branch-${BRANCH_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments' },
        async payload => {
          const p = payload.new as { order_id?: number } | null;
          if (!p?.order_id) return;

          const { data, error } = await supabase
            .from('orders')
            .select('*')
            .eq('id', p.order_id)
            .limit(1)
            .maybeSingle();

          if (error || !data) return;
          if (data.branch_id !== BRANCH_ID) return;

          setOrder(data as OrderRow);
          setStage(STATUS_TO_STAGE[data.status] || 'done');
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(chOrders);
      supabase.removeChannel(chPayments);
    };
  }, []);

  /* Когда меняется активный заказ — грузим его позиции и подписываемся на них */
  useEffect(() => {
    const supabase = getBrowserSupabase();
    let chItems: ReturnType<typeof supabase.channel> | null = null;

    async function loadItems(orderId: number) {
      const { data, error } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', orderId)
        .order('id', { ascending: true });
      if (error) {
        console.error('order_items error:', error);
        setItems([]);
        return;
      }
      setItems((data || []) as OrderItemRow[]);
    }

    if (order?.id) {
      loadItems(order.id);

      // Realtime только для строк этого заказа
      chItems = supabase
        .channel(`order-items-${order.id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'order_items', filter: `order_id=eq.${order.id}` },
          () => loadItems(order.id)
        )
        .subscribe();
    } else {
      setItems([]);
    }

    return () => {
      if (chItems) getBrowserSupabase().removeChannel(chItems);
    };
  }, [order?.id]);

  /* Таймер QR */
  useEffect(() => {
    if (stage !== 'pay_qr') return;
    setQrSeconds(120);
    const id = setInterval(() => {
      setQrSeconds(s => {
        if (s <= 1) {
          clearInterval(id);
          setStage('confirm');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [stage]);

  /* Расчёт сумм */
  const subtotal = order?.total_amount ?? order?.total ?? 0;
  const discount = order?.discount ?? 0;
  const total = order?.total ?? Math.max(subtotal - discount, 0);
  const paidBefore = Math.max(Number(order?.paid_amount ?? 0), Number(order?.prepaid ?? 0));
  const dueToday = Math.max(total - paidBefore, 0);

  const fmtKGS = (n: number) =>
    new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' сом';

  // Человекочитаемое имя позиции (без products.name — собираем из полей)
  const humanName = (r: OrderItemRow) => {
    const parts: string[] = [];
    if (r.item_type) parts.push(labelByType(r.item_type));
    if (r.eye) parts.push(labelByEye(r.eye));
    if (r.lens_type) parts.push(r.lens_type);
    const power: string[] = [];
    if (isNum(r.sph)) power.push(`SPH ${trimZero(r.sph!)}`);
    if (isNum(r.cyl)) power.push(`CYL ${trimZero(r.cyl!)}`);
    if (isNum(r.ax)) power.push(`AX ${r.ax}`);
    if (power.length) parts.push(`(${power.join(' · ')})`);
    return parts.join(' ').trim() || 'Товар';
  };

  return (
    <div id="pos-overlay"
      className="fixed inset-0 z-[99999] m-0 p-0 bg-[#F6F8FC] text-[#111827]">
      {/* фон */}
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-70">
        <div className="absolute -top-24 -left-16 h-96 w-96 rounded-full blur-3xl"
          style={{ background: 'radial-gradient(closest-side, #E8F0FF 0%, transparent 70%)' }} />
        <div className="absolute -bottom-24 -right-16 h-[380px] w-[380px] rounded-full blur-3xl"
          style={{ background: 'radial-gradient(closest-side, #E6FFF5 0%, transparent 70%)' }} />
      </div>

      {/* верхняя полоса */}
      <div className="absolute top-0 left-0 right-0 px-6 py-3 flex items-center justify-between">
        <div className="text-sm/5 text-gray-500">Покупательский экран • {terminal} {order?.id ? `• #${order.id}` : ''}</div>
        <div className="flex items-center gap-4">
          <StageBar stage={stage} />
          <NetBadge online={online} />
        </div>
      </div>

      {/* Dev-панель */}
      {dev && (
        <div className="absolute top-14 right-6 z-10 bg-white shadow rounded-xl border border-gray-200 p-2 flex gap-2 text-sm">
          {(['idle', 'confirm', 'pay_qr', 'pay_card', 'done', 'error', 'refund'] as Stage[]).map(s => (
            <button key={s} className={btn(stage === s)} onClick={() => setStage(s)}>{s}</button>
          ))}
        </div>
      )}

      <div className="h-full p-6 pt-16">
        {stage === 'idle' ? (
          <IdleScreen />
        ) : stage === 'done' ? (
          <ThankYou total={fmtKGS(total)} />
        ) : stage === 'error' ? (
          <ErrorScreen onBack={() => setStage('confirm')} />
        ) : stage === 'refund' ? (
          <RefundScreen amount={fmtKGS(total)} />
        ) : (
          <div className="grid grid-rows-[7fr,3fr] gap-8 h-full">
            {/* ROW 1 */}
            <div className="grid grid-cols-12 gap-8">
              {/* Корзина — реальные позиции */}
              <Card className={`col-span-${stage === 'pay_qr' ? '6' : '8'}`}>
                <h2 className="text-[22px] font-semibold mb-4">Ваш заказ</h2>

                <div className="rounded-2xl overflow-hidden border border-gray-200 bg-white/90 card-gradient">
                  <div className="grid grid-cols-12 px-5 py-2 bg-gray-50/70 text-[15px] text-gray-600">
                    <div className="col-span-7">Позиция</div>
                    <div className="col-span-2 text-right">Кол-во</div>
                    <div className="col-span-3 text-right">Сумма</div>
                  </div>

                  <div className="max-h-[54vh] overflow-auto divide-y divide-gray-100">
                    {items.length === 0 ? (
                      <div className="px-5 py-6 text-gray-500">Позиции будут показаны после оформления заказа</div>
                    ) : items.map((it) => (
                      <div key={it.id} className="grid grid-cols-12 px-5 py-3 hover:bg-white/70 transition">
                        <div className="col-span-7 pr-4 truncate">{humanName(it)}</div>
                        <div className="col-span-2 text-right tabular-nums text-gray-500">
                          {it.qty} × {fmtKGS(it.price)}
                        </div>
                        <div className="col-span-3 text-right font-semibold tabular-nums">
                          {fmtKGS(it.qty * it.price)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>

              {/* Правый блок */}
              {stage === 'pay_qr' ? (
                <Card className="col-span-6 grid grid-cols-12 gap-6 items-center">
                  {/* левая колонка: суммы + таймер + табы */}
                  <div className="col-span-6">
                    <TotalsBlock
                      subtotal={subtotal}
                      discount={discount}
                      paidBefore={paidBefore}
                      dueToday={dueToday}
                      fmt={fmtKGS}
                    />
                    <div className="mt-5 text-gray-600 text-[15px]">
                      Отсканируйте QR и оплатите. Время на оплату:
                    </div>
                    <Timer seconds={qrSeconds} />

                    <div className="mt-5">
                      {/* без заголовка «Способ оплаты» */}
                      <PayMethodTabs active="qr" />
                    </div>
                  </div>

                  {/* правая колонка: большой QR без подложки, скруглённый */}
                  <div className="col-span-6 flex items-center justify-center">
                    <img
                      src="/pos/refocus_qr_blue_darkblue.png"
                      alt="QR для оплаты"
                      className="h-64 w-64 rounded-[22px] shadow-[0_12px_32px_rgba(16,24,40,0.22)]"
                    />
                  </div>
                </Card>
              ) : (
                <Card className="col-span-4">
                  <TotalsBlock
                    subtotal={subtotal}
                    discount={discount}
                    paidBefore={paidBefore}
                    dueToday={dueToday}
                    fmt={fmtKGS}
                  />

                  {/* подсказка показываем только для сценария оплаты картой */}
                  {stage === 'pay_card' && (
                    <div className="mt-6 text-[16px] leading-7 text-gray-700">
                      Поднесите карту или телефон к терминалу. Если не сработало —
                      удерживайте 2–3 секунды.
                    </div>
                  )}

                  <div className="mt-5">
                    {/* без заголовка «Способ оплаты» */}
                    <PayMethodTabs active="card" />
                  </div>
                </Card>
              )}
            </div>

            {/* ROW 2: бренд/промо + QR на сайт */}
            <div className="grid grid-cols-12 gap-8">
              <div className="col-span-8">
                <div className="rounded-2xl px-10 py-8 text-white brand-anim shadow-[0_10px_30px_rgba(16,24,40,0.25)]">
                  <div className="flex items-center justify-between gap-8">
                    {/* логомарка чуть крупнее */}
                    <div className="flex items-center gap-5">
                      <div className="scale-110">
                        <LogoMark />
                      </div>
                      <div>
                        <div className="font-kiona text-4xl tracking-[0.06em]">REFOCUS</div>
                        <div className="opacity-95 text-base">Ваше зрение — наш фокус</div>
                      </div>
                    </div>

                    {/* можно ничего не ставить справа, оставим «чистую» волну-градиент */}
                    <div className="hidden md:block h-10" />
                  </div>
                </div>
              </div>

              <Card className="col-span-4 flex items-center justify-center">
                <div className="rounded-2xl overflow-hidden border-2 border-gray-200 shadow-md bg-white">
                  <img
                    src="/pos/qr-refocus.png"
                    alt="QR Refocus"
                    className="h-48 w-48 object-contain"
                  />
                </div>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== Вспомогательные компоненты / функции ===== */

function btn(active: boolean) {
  return 'px-3 py-1 rounded-lg border ' + (active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 hover:bg-gray-50');
}

function Card(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className = '', ...rest } = props;
  return <div className={'rounded-2xl shadow-[0_8px_28px_rgba(16,24,40,0.08)] border border-gray-200 p-6 card-gradient ' + className} {...rest} />;
}

function StageBar({ stage }: { stage: Stage }) {
  const stages: { key: Stage; label: string }[] = [
    { key: 'confirm', label: 'Подтверждение' },
    { key: 'pay_qr', label: 'Оплата' },
    { key: 'done', label: 'Готово' },
  ];
  const mapStage = stage === 'pay_card' ? 'pay_qr' : stage === 'idle' ? 'confirm' : stage;
  const idx = stages.findIndex((s) => s.key === mapStage);
  return (
    <div className="flex items-center gap-2">
      {stages.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <span className={'h-2 w-2 rounded-full ' + (i <= idx ? 'bg-[#2C4BA5]' : 'bg-gray-300')} title={s.label} />
          {i < stages.length - 1 && <span className="w-6 h-0.5 bg-gray-300/70" />}
        </div>
      ))}
    </div>
  );
}

function NetBadge({ online }: { online: boolean }) {
  return (
    <div className={'text-xs px-2 py-1 rounded-lg border ' + (online ? 'border-emerald-300 text-emerald-700 bg-emerald-50' : 'border-rose-300 text-rose-700 bg-rose-50')} title={online ? 'Онлайн' : 'Оффлайн'}>
      {online ? 'online' : 'offline'}
    </div>
  );
}

function PayMethodTabs({ active }: { active: 'card' | 'qr' | 'cash' }) {
  const Btn = ({
    id, label, icon,
  }: { id: 'card' | 'qr' | 'cash'; label: string; icon: React.ReactNode }) => {
    const on = active === id;
    return (
      <button
        type="button"
        className={[
          "inline-flex items-center gap-2 px-4 py-2 rounded-xl transition ring-1",
          on
            ? "text-white ring-transparent shadow-[0_8px_20px_rgba(34,68,130,0.25)] bg-gradient-to-r from-[#1A284E] via-[#2C4BA5] to-[#4F9DF6]"
            : "text-slate-700 bg-white/80 hover:bg-white ring-gray-200"
        ].join(' ')}
      >
        <span className={on ? "" : "text-slate-500"}>{icon}</span>
        <span className="text-[15px]">{label}</span>
      </button>
    );
  };

  const IcCard = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="2" /><path d="M3 10h18" stroke="currentColor" strokeWidth="2" /></svg>
  );
  const IcQR = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 5h4v4H5V5zm10 0h4v4h-4V5zM5 15h4v4H5v-4zm10 6v-4h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  const IcCash = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" /></svg>
  );

  return (
    <div className="flex flex-wrap gap-2">
      <Btn id="card" label="Карта / NFC" icon={IcCard} />
      <Btn id="qr" label="QR-оплата" icon={IcQR} />
      <Btn id="cash" label="Наличные" icon={IcCash} />
    </div>
  );
}


function LogoMark() {
  return (
    <div className={'h-12 w-12 rounded-2xl grid place-items-center text-white shadow-sm ' + GRADIENT_BRAND} style={{ fontFamily: 'Kiona, system-ui, sans-serif' }}>
      R
    </div>
  );
}

function QrBig() {
  return (
    <div className="h-56 w-56 rounded-2xl border-4 border-gray-200 grid place-items-center bg-white shadow">
      <div className="h-40 w-40 grid grid-cols-6 grid-rows-6 gap-1">
        {Array.from({ length: 36 }).map((_, i) => (
          <div key={i} className={(i % 2 ? 'bg-gray-800' : 'bg-gray-300') + ' rounded-[2px]'} />
        ))}
      </div>
    </div>
  );
}

function Timer({ seconds }: { seconds: number }) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return (
    <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-gray-100 text-gray-700">
      ⏳ <span className="tabular-nums">{mm}:{ss}</span>
    </div>
  );
}

/* Итоговый блок с авансом/остатком и прогресс-баром */
function TotalsBlock({
  subtotal, discount, paidBefore, dueToday, fmt,
}: {
  subtotal: number; discount: number; paidBefore: number; dueToday: number; fmt: (n: number) => string;
}) {
  const total = Math.max(subtotal - discount, 0);
  const progress = Math.min(100, Math.round((Math.min(paidBefore, total) / Math.max(total, 1)) * 100));
  const remainAfter = Math.max(total - (paidBefore + dueToday), 0);

  return (
    <div>
      {/* мини-разбивка */}
      <div className="grid grid-cols-2 gap-y-1 text-[14px]">
        <span className="text-gray-500">Сумма</span>
        <span className="text-right">{fmt(subtotal)}</span>
        <span className="text-gray-500">Скидка</span>
        <span className="text-right">{fmt(discount)}</span>
        {paidBefore > 0 && (
          <>
            <span className="text-gray-500">Оплачено ранее</span>
            <span className="text-right">{fmt(paidBefore)}</span>
          </>
        )}
      </div>

      {/* прогресс по предоплате */}
      {paidBefore > 0 && (
        <div className="mt-3">
          <div className="h-2 rounded-full bg-gray-200/80 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-[#4F9DF6] to-[#2C4BA5]" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-1 text-xs text-gray-500">Оплачено {progress}%</div>
        </div>
      )}

      <div className="h-px bg-gray-200 my-5" />

      {/* крупная сумма */}
      <div className="flex items-end gap-3">
        <div>
          <div className="text-gray-500 mb-1">К оплате сегодня</div>
          <div className="leading-none">
            <span className="text-[64px] font-extrabold tracking-tight tabular-nums bg-clip-text text-transparent bg-gradient-to-r from-[#1A284E] via-[#2C4BA5] to-[#00B78E]">
              {fmt(dueToday).replace(/\s?сом$/, '')}
            </span>
          </div>
        </div>
        <span className="mb-1 inline-flex items-center px-3 py-1.5 rounded-2xl bg-white/70 ring-1 ring-[#CFE0FF] text-slate-700 text-[18px] font-medium">
          сом
        </span>
      </div>

      {remainAfter > 0 && (
        <div className="mt-2 text-[14px] text-gray-600">
          Останется к оплате позже: <span className="font-medium">{fmt(remainAfter)}</span>
        </div>
      )}
    </div>
  );
}


/* Idle-экран: бренд + QR на сайт + плакат бонусов */
function IdleScreen() {
  return (
    <div className="h-full grid grid-rows-[6fr,4fr] gap-8">
      <div className="rounded-2xl p-8 text-white brand-anim shadow">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <LogoMark />
            <div>
              <div className="text-4xl font-kiona tracking-wide">Refocus</div>
              <div className="opacity-95 text-lg">Ваше зрение — наш фокус</div>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <div className="text-white/80 text-sm">Перейдите на сайт Refocus</div>
              <div className="text-white text-lg font-medium">refocuskg.github.io/refocus-site</div>
            </div>
            <img src="/pos/qr-refocus.png" alt="QR Refocus" className="h-32 w-32 rounded-2xl border-2 border-white/50 bg-white p-2" />
          </div>
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden border border-gray-200 bg-white/90 card-gradient grid place-items-center">
        <img src="/pos/loyalty.png" alt="Бонусы и скидки" className="max-h-[48vh] object-contain" />
      </div>
    </div>
  );
}

function ThankYou({ total }: { total: string }) {
  return (
    <div className="h-full grid place-items-center">
      <div className="max-w-3xl w-full text-center">
        <div className={'text-5xl font-extrabold ' + GRADIENT_BRAND + ' text-transparent bg-clip-text mb-6'}>
          СПАСИБО ЗА ПОКУПКУ!
        </div>

        <div className="mx-auto rounded-2xl card-gradient border border-gray-200 p-6 w-[560px]">
          <div className="text-xl font-semibold mb-2">Чек</div>
          <div className="divide-y divide-gray-200 text-left">
            <div className="py-2 flex items-center justify-between">
              <span className="text-gray-500">Сумма</span>
              <span className={'font-bold ' + GRADIENT_PRICE}>{total}</span>
            </div>
            <div className="py-2 text-gray-700">Оплата успешно получена</div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-4">
          <img src="/pos/qr-refocus.png" alt="QR Refocus" className="h-28 w-28 rounded-2xl border-2 border-gray-200 bg-white p-2" />
          <div className="text-gray-600 max-w-md text-left">
            Сканируйте, чтобы получить электронный чек и оставить отзыв
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="h-full grid place-items-center">
      <div className="rounded-2xl card-gradient border border-gray-200 p-8 text-center max-w-xl">
        <div className="text-3xl font-bold text-rose-600 mb-2">Оплата не прошла</div>
        <div className="text-gray-700 mb-6">Повторите или выберите другой способ оплаты</div>
        <div className="inline-flex items-center gap-3 bg-gray-900 text-white px-4 py-2 rounded-xl cursor-default">
          Вернуться к способам
        </div>
      </div>
    </div>
  );
}

function RefundScreen({ amount }: { amount: string }) {
  return (
    <div className="h-full grid place-items-center">
      <div className="rounded-2xl card-gradient border border-gray-200 p-8 text-center max-w-xl">
        <div className="text-3xl font-bold text-gray-900 mb-2">Возврат оформлен</div>
        <div className="text-gray-700">Сумма возврата: <span className="font-semibold">{amount}</span></div>
      </div>
    </div>
  );
}

/* ===== утилиты ===== */
function labelByType(s: string) {
  const t = s.toLowerCase();
  if (t.includes('frame')) return 'Оправа';
  if (t.includes('lens')) return 'Линзы';
  if (t.includes('work') || t.includes('service')) return 'Работа мастера';
  return s.toUpperCase();
}
function labelByEye(s: string | null) {
  if (!s) return '';
  const t = s.toUpperCase();
  if (t === 'OD') return 'OD';
  if (t === 'OS') return 'OS';
  if (t === 'OU') return 'OU';
  return t;
}
function isNum(n: number | null) {
  return typeof n === 'number' && !Number.isNaN(n);
}
function trimZero(n: number) {
  // 1.00 -> 1;  -1.25 остаётся
  return Number(n.toFixed(2)).toString();
}
