'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import { toast } from 'react-hot-toast';
import {
  X,
  RotateCcw,
  Undo2,
  Wrench,
  Ban,
  Repeat,
  Glasses,
  AlertTriangle,
  CheckCircle2,
  Info,
  Lightbulb,
  ChevronDown,
} from 'lucide-react';

/* ============================================================================
   Единый мастер «Возврат / замена» для CRM (/orders).
   Админ-операции с деньгами: отмена до выдачи (возврат аванса), возврат денег,
   доработка/сервис. ЗАМЕНА (оправа+линзы / линзы по рецепту) оформляется на КАССЕ
   (нужен сканер штрих-кода новой оправы) — здесь только подсказка.
   Денежная модель — на стороне БД (минус-платёж + строка refunds):
     pos_order_cancel_v2 / pos_order_cash_refund_v2 / pos_warranty_adjustment.
   ========================================================================== */

type OrderLite = {
  order_no: number;
  status: string;
  paid_amount: number;
  total_amount: number;
  customer_name?: string | null;
  phone?: string | null;
};

type Warranty = {
  status: string;
  delivered_at: string | null;
  paid_amount: number | null;
  adaptation_status: string | null; // active | used | expired | null
  adaptation_days_remaining: number | null;
  prescription_status: string | null;
  prescription_days_remaining: number | null;
};

type RefundRowDb = {
  id: number;
  amount: number;
  method: string | null;
  reason_code: string | null;
  refund_type: string | null;
  status: string;
  created_at: string;
};

type Step = 'menu' | 'cancel' | 'refund' | 'service';
type MethodUI = '' | 'cash' | 'card' | 'qr';

const TERMINAL = new Set(['CANCELLED', 'REFUNDED', 'REPLACED']);

// Все коды причин (для отображения в истории/дашборде)
const REASONS: Record<string, string> = {
  changed_mind: 'Передумал',
  too_expensive: 'Дорого / дешевле в др. месте',
  too_slow: 'Долго ждать',
  cant_pay: 'Не смог оплатить',
  our_error: 'Наша ошибка при оформлении',
  quality_issue: 'Брак / дефект',
  wrong_recipe: 'Ошибка в рецепте (наша)',
  did_not_fit: 'Не подошло (посадка/комфорт)',
  customer_unhappy: 'Не понравилось / передумал', // legacy
  other: 'Другое',
};
// Причины ОТМЕНЫ (до выдачи)
const CANCEL_REASONS = ['changed_mind', 'too_expensive', 'too_slow', 'cant_pay', 'our_error', 'other'];
// Причины ВОЗВРАТА денег (после выдачи)
const REFUND_REASONS = ['quality_issue', 'wrong_recipe', 'did_not_fit', 'changed_mind', 'other'];

const SERVICE_ITEMS = [
  'Поджать дужки',
  'Винтик',
  'Носовые упоры',
  'Лёгкая правка посадки',
  'Чистка',
];

const fmt = (n: number) =>
  new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0));

function getCrmPosSessionId() {
  try {
    return window.sessionStorage.getItem('pos_session_id');
  } catch {
    return null;
  }
}

function MethodPicker({ value, onChange }: { value: MethodUI; onChange: (m: MethodUI) => void }) {
  const opts: Array<{ k: Exclude<MethodUI, ''>; label: string }> = [
    { k: 'cash', label: 'Наличные' },
    { k: 'card', label: 'Карта' },
    { k: 'qr', label: 'QR / перевод' },
  ];
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
      {opts.map((o) => (
        <button
          key={o.k}
          type="button"
          onClick={() => onChange(o.k)}
          className={
            'rounded-xl px-3 py-2 text-sm font-semibold transition ' +
            (value === o.k
              ? 'bg-cyan-500 text-white ring-1 ring-cyan-400 shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
              : 'bg-white text-slate-600 ring-1 ring-sky-200 hover:bg-sky-50')
          }
        >
          {o.label}
        </button>
      ))}
      </div>
      {value === 'cash' ? (
        <div className="mt-1 text-[11px] text-amber-600">
          Наличные — деньги выходят из кассы (учтётся в сверке выручки).
        </div>
      ) : value === '' ? (
        <div className="mt-1 text-[11px] text-slate-400">Укажите, как возвращаете деньги.</div>
      ) : null}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </span>
  );
}

export default function ReturnExchangeModal({
  order,
  onClose,
  onDone,
}: {
  order: OrderLite;
  onClose: () => void;
  onDone: () => void;
}) {
  const sb = useMemo(() => getBrowserSupabase(), []);
  const [step, setStep] = useState<Step>('menu');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [w, setW] = useState<Warranty | null>(null);
  const [refunds, setRefunds] = useState<RefundRowDb[]>([]);
  const [ledgerNet, setLedgerNet] = useState<number | null>(null);
  const [ledgerPending, setLedgerPending] = useState<number | null>(null);
  const [ledgerRefundable, setLedgerRefundable] = useState<number | null>(null);

  // form state
  const [method, setMethod] = useState<MethodUI>('');
  const [reason, setReason] = useState<string>('');
  const [comment, setComment] = useState('');
  const [settleNow, setSettleNow] = useState(true);
  const [amount, setAmount] = useState<string>('');
  const [cancelAmount, setCancelAmount] = useState<string>('');
  const [settleRefundId, setSettleRefundId] = useState<number | null>(null);
  const [settleMethod, setSettleMethod] = useState<MethodUI>('');
  const [svcChecks, setSvcChecks] = useState<Record<string, boolean>>({});
  const [svcOther, setSvcOther] = useState('');

  const status = w?.status ?? order.status;
  const pendingAmount = ledgerPending ?? 0;
  const moneyReady =
    !loading && !loadError && ledgerNet !== null && ledgerPending !== null && ledgerRefundable !== null;
  const paid = ledgerNet ?? 0;
  const refundable = moneyReady ? Number(ledgerRefundable) : 0;
  const isTerminal = TERMINAL.has(status);
  const isDelivered = status === 'DELIVERED';

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setLoadError(null);
      setLedgerNet(null);
      setLedgerPending(null);
      setLedgerRefundable(null);
      setW(null);
      setRefunds([]);
      try {
        const [wq, rq, bq] = await Promise.all([
          sb.from('orders_with_warranties').select('*').eq('order_no', order.order_no).maybeSingle(),
          sb
            .from('refunds')
            .select('id,amount,method,reason_code,refund_type,status,created_at')
            .eq('order_id', order.order_no)
            .order('id', { ascending: false }),
          sb.rpc('pos_order_refund_balance_v2', {
            p_order_id: order.order_no,
            p_pos_session_id: getCrmPosSessionId(),
            p_client_uuid: null,
          }),
        ]);
        if (!alive) return;
        if (wq.data) setW(wq.data as Warranty);
        if (!rq.error) setRefunds(((rq.data as RefundRowDb[]) || []));
        if (!bq.error) {
          const balance = Array.isArray(bq.data) ? bq.data[0] : bq.data;
          const net = Number(balance?.ledger_net);
          const pending = Number(balance?.pending_reserved);
          const available = Number(balance?.refundable_amount);
          if (
            balance &&
            Number.isFinite(net) &&
            Number.isFinite(pending) &&
            Number.isFinite(available) &&
            pending >= 0 &&
            available >= 0 &&
            Math.abs(Math.max(net - pending, 0) - available) < 0.01
          ) {
            setLedgerNet(net);
            setLedgerPending(pending);
            setLedgerRefundable(available);
          } else {
            setLoadError('Сервер вернул некорректный остаток по платежам');
          }
        }
        const queryError = wq.error || rq.error || bq.error;
        if (queryError) {
          setLoadError(`Не удалось проверить платежи и возвраты: ${queryError.message}`);
        }
      } catch (error: any) {
        if (alive) setLoadError(`Не удалось проверить платежи и возвраты: ${error?.message ?? 'ошибка сети'}`);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [sb, order.order_no]);

  // Новая операция может использовать только подтверждённый остаток из журнала платежей.
  useEffect(() => {
    if (step === 'refund' && !amount && refundable > 0) setAmount(String(refundable));
  }, [step, refundable, amount]);

  const methodParam = method || null;

  async function doCancel() {
    if (!moneyReady) return toast.error('Платежи не загружены. Закройте окно и попробуйте снова.');
    if (!reason) return toast.error('Выберите причину отмены');
    if (reason === 'other' && !comment.trim()) return toast.error('Опишите причину в комментарии');
    if (settleNow && refundable > 0 && !cancelAmount.trim()) {
      return toast.error('Укажите, сколько денег фактически выдали сейчас');
    }
    const refundNow = settleNow ? Number(String(cancelAmount).replace(',', '.')) : 0;
    if (settleNow && (!Number.isFinite(refundNow) || refundNow < 0 || refundNow > refundable)) {
      return toast.error(`Фактически выданная сумма должна быть от 0 до ${fmt(refundable)} с`);
    }
    if (refundable > 0 && !method) return toast.error('Укажите способ возврата (наличные / карта / QR)');
    setBusy(true);
    const t = toast.loading('Отменяем заказ…');
    try {
      const { data, error } = await sb.rpc('pos_order_cancel_v2', {
        p_order_id: order.order_no,
        p_reason: reason,
        p_comment: comment.trim() || null,
        p_refund_method: methodParam,
        p_settle_now: settleNow,
        p_branch_id: null,
        p_employee_id: null,
        p_pos_session_id: getCrmPosSessionId(),
        p_refund_amount: settleNow ? refundNow : 0,
        p_client_uuid: null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error('Сервер не вернул результат отмены');
      const returned = Number(row.refunded_amount);
      const pending = Number(row.pending_amount);
      if (!Number.isFinite(returned) || !Number.isFinite(pending)) {
        throw new Error('Сервер вернул неполный результат отмены');
      }
      toast.success(
        returned > 0 || pending > 0
          ? `Заказ отменён. Выдано сейчас: ${fmt(returned)} с; осталось вернуть: ${fmt(pending)} с.`
          : 'Заказ отменён. Возвращать нечего.',
        { id: t },
      );
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? 'Не удалось отменить', { id: t });
    } finally {
      setBusy(false);
    }
  }

  async function doRefund() {
    if (!moneyReady) return toast.error('Платежи не загружены. Закройте окно и попробуйте снова.');
    const amt = Number(String(amount).replace(',', '.')) || 0;
    if (amt <= 0) return toast.error('Укажите сумму возврата');
    if (amt > refundable) return toast.error(`Доступно к возврату не больше ${fmt(refundable)} с`);
    if (!reason) return toast.error('Выберите причину возврата');
    if (reason === 'other' && !comment.trim()) return toast.error('Опишите причину в комментарии');
    if (!method) return toast.error('Укажите способ возврата (наличные / карта / QR)');
    setBusy(true);
    const t = toast.loading('Оформляем возврат…');
    try {
      const { data, error } = await sb.rpc('pos_order_cash_refund_v2', {
        p_order_id: order.order_no,
        p_amount: amt,
        p_reason: reason,
        p_comment: comment.trim() || null,
        p_refund_method: methodParam,
        p_settle_now: settleNow,
        p_branch_id: null,
        p_employee_id: null,
        p_pos_session_id: getCrmPosSessionId(),
        p_client_uuid: null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !Number.isFinite(Number(row.refunded_amount)) || !row.refund_status) {
        throw new Error('Сервер вернул неполный результат возврата');
      }
      const returned = Number(row.refunded_amount);
      toast.success(
        row.refund_status === 'done'
          ? `Фактически возвращено ${fmt(returned)} с${row.is_full ? ', заказ закрыт' : ''}`
          : `К возврату поставлено ${fmt(returned)} с — деньги ещё не выданы`,
        { id: t },
      );
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? 'Не удалось оформить возврат', { id: t });
    } finally {
      setBusy(false);
    }
  }

  async function doSettle(refundId: number) {
    if (!moneyReady) return toast.error('Платежи не загружены. Закройте окно и попробуйте снова.');
    if (!settleMethod) return toast.error('Выберите способ, которым фактически выдали деньги');
    setBusy(true);
    const t = toast.loading('Проводим возврат…');
    try {
      const { data, error } = await sb.rpc('pos_refund_settle_v2', {
        p_refund_id: refundId,
        p_refund_method: settleMethod,
        p_employee_id: null,
        p_pos_session_id: getCrmPosSessionId(),
        p_client_uuid: null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !Number.isFinite(Number(row.refunded_amount))) {
        throw new Error('Сервер не вернул фактическую сумму возврата');
      }
      toast.success(
        `Фактически выдано ${fmt(Number(row.refunded_amount))} с${row.is_full ? ', заказ полностью возвращён' : ''}`,
        { id: t },
      );
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? 'Не удалось провести возврат', { id: t });
    } finally {
      setBusy(false);
    }
  }

  async function doService() {
    const parts = SERVICE_ITEMS.filter((s) => svcChecks[s]);
    const desc = [...parts, svcOther.trim()].filter(Boolean).join(', ');
    if (desc.trim().length < 3) return toast.error('Опишите доработку');
    setBusy(true);
    const t = toast.loading('Записываем доработку…');
    try {
      const { error } = await sb.rpc('pos_warranty_adjustment', {
        p_order_id: order.order_no,
        p_description: desc,
        p_branch_id: null,
        p_employee_id: null,
        p_pos_session_id: getCrmPosSessionId(),
      });
      if (error) throw error;
      toast.success('Доработка записана', { id: t });
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? 'Ошибка', { id: t });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.4)] ring-1 ring-sky-100 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.3)]">
              <RotateCcw className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight text-slate-900">
                Возврат / замена
              </div>
              <div className="text-[12px] text-slate-500">
                Заказ №{order.order_no}
                {order.customer_name ? ` · ${order.customer_name}` : ''}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* order summary */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Остаток оплаты по платежам
            </div>
            <div className="mt-0.5 text-lg font-bold text-slate-900">
              {moneyReady ? `${fmt(paid)} с` : '—'}
            </div>
          </div>
          <div className="rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Статус
            </div>
            <div className="mt-0.5 text-lg font-bold text-slate-900">
              {STATUS_LABEL[status] ?? status}
            </div>
          </div>
        </div>

        {moneyReady && pendingAmount > 0 && (
          <div className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-800 ring-1 ring-amber-200">
            Уже ожидает выдачи: {fmt(pendingAmount)} с · ещё доступно к возврату: {fmt(refundable)} с
          </div>
        )}

        {/* история возвратов (если есть) */}
        {refunds.length > 0 && (
          <div className="mb-4 rounded-2xl bg-rose-50/60 ring-1 ring-rose-200 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-600">
              Возвраты по заказу
            </div>
            <div className="mt-2 space-y-1.5">
              {refunds.map((r) => (
                <div key={r.id} className="rounded-xl bg-white/70 px-2.5 py-2 ring-1 ring-rose-100">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-slate-700">
                      {REASONS[r.reason_code || ''] ?? r.reason_code ?? '—'}
                      {r.status === 'pending' && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          к возврату
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      {r.status === 'pending' && settleRefundId !== r.id && (
                        <button
                          type="button"
                          onClick={() => {
                            setSettleRefundId(r.id);
                            setSettleMethod('');
                          }}
                          disabled={busy || !moneyReady}
                          className="rounded-lg bg-cyan-500 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-cyan-400 disabled:opacity-50"
                        >
                          Выдать деньги
                        </button>
                      )}
                      <span className="font-semibold text-rose-700">−{fmt(r.amount)} с</span>
                    </span>
                  </div>
                  {r.status === 'pending' && settleRefundId === r.id && (
                    <div className="mt-3 space-y-2 border-t border-rose-100 pt-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Как фактически выдали деньги
                      </div>
                      <MethodPicker value={settleMethod} onChange={setSettleMethod} />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setSettleRefundId(null)}
                          disabled={busy}
                          className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 disabled:opacity-50"
                        >
                          Отмена
                        </button>
                        <button
                          type="button"
                          onClick={() => doSettle(r.id)}
                          disabled={busy || !settleMethod || !moneyReady}
                          className="rounded-lg bg-cyan-500 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-cyan-400 disabled:opacity-50"
                        >
                          Подтвердить выдачу
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-6 text-center text-sm text-slate-500">Загрузка…</div>
        ) : loadError ? (
          <div className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-800 ring-1 ring-rose-200">
            <div className="mb-1 flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" /> Денежные операции заблокированы
            </div>
            {loadError}. Закройте окно и попробуйте снова.
          </div>
        ) : isTerminal ? (
          <div className="rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-4 text-sm text-slate-600">
            <div className="mb-1 flex items-center gap-2 font-semibold text-slate-800">
              <Ban className="h-4 w-4 text-slate-400" /> Заказ закрыт
            </div>
            Этот заказ уже {status === 'CANCELLED' ? 'отменён' : status === 'REFUNDED' ? 'возвращён' : 'заменён'}. Новые операции недоступны.
          </div>
        ) : step === 'menu' ? (
          <div className="space-y-4">
            <Cheatsheet />
            <div>
              <GroupHeader tone="rose">Возвращаем деньги клиенту</GroupHeader>
              <div className="space-y-2">
                {!isDelivered && (
                  <MenuItem
                    icon={<Ban className="h-5 w-5" />}
                    tone="rose"
                    title="Отменить заказ"
                    desc="Клиент передумал до получения"
                    money={refundable > 0 ? { text: `доступно ${fmt(refundable)} с`, tone: 'rose' } : { text: 'возвращать нечего', tone: 'slate' }}
                    onClick={() => {
                      setReason('');
                      setComment('');
                      setMethod('');
                      setSettleNow(true);
                      setCancelAmount('');
                      setStep('cancel');
                    }}
                  />
                )}
                {isDelivered && (
                  <MenuItem
                    icon={<Undo2 className="h-5 w-5" />}
                    tone="rose"
                    title="Возврат денег"
                    desc="Полный или частичный, товар принят назад"
                    money={{ text: `доступно ${fmt(refundable)} с`, tone: refundable > 0 ? 'rose' : 'slate' }}
                    disabled={refundable <= 0}
                    onClick={() => {
                      setReason('');
                      setComment('');
                      setMethod('');
                      setSettleNow(true);
                      setAmount(String(refundable || ''));
                      setStep('refund');
                    }}
                  />
                )}
              </div>
            </div>

            <div>
              <GroupHeader tone="slate">Без возврата денег</GroupHeader>
              <div className="space-y-2">
                <MenuItem
                  icon={<Wrench className="h-5 w-5" />}
                  tone="cyan"
                  title="Доработка / сервис"
                  desc="Подтянуть, винтик, нос-пады"
                  money={{ text: 'без денег', tone: 'slate' }}
                  onClick={() => setStep('service')}
                />
              </div>
            </div>

            {isDelivered && (
              <div className="flex items-start gap-2 rounded-2xl bg-sky-50 ring-1 ring-sky-200 p-3 text-[13px] text-sky-800">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                <div>
                  <b>Замена</b> (полная / только линзы) оформляется на <b>кассе</b> — нужен сканер новой оправы/линз.
                  {w?.adaptation_status === 'active' &&
                    ` Адаптация активна, осталось ${w?.adaptation_days_remaining ?? 0} дн.`}
                  {w?.adaptation_status === 'used' && ' Адаптация по этой паре уже использована.'}
                </div>
              </div>
            )}
          </div>
        ) : step === 'cancel' ? (
          <div className="space-y-4">
            <Banner tone="rose">
              Заказ перейдёт в «Отменён». {refundable > 0 ? `Доступно к возврату ${fmt(refundable)} с.` : 'Возвращать нечего.'}
            </Banner>

            <ReasonBlock title="Почему отменяем?" codes={CANCEL_REASONS} value={reason} onChange={setReason} />
            <CommentField value={comment} onChange={setComment} required={reason === 'other'} />

            {refundable > 0 && (
              <>
                <SettleToggle value={settleNow} onChange={setSettleNow} />
                {settleNow && (
                  <div>
                    <Label>Фактически выдали сейчас (макс. {fmt(refundable)} с)</Label>
                    <div className="flex gap-2">
                      <input
                        value={cancelAmount}
                        onChange={(e) => setCancelAmount(e.target.value)}
                        inputMode="decimal"
                        placeholder="Введите фактическую сумму"
                        className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
                      />
                      <button
                        type="button"
                        onClick={() => setCancelAmount(String(refundable))}
                        className="rounded-xl bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100"
                      >
                        Вернули всю сумму
                      </button>
                    </div>
                  </div>
                )}
                <div>
                  <Label>Способ возврата</Label>
                  <MethodPicker value={method} onChange={setMethod} />
                </div>
              </>
            )}

            <Footer
              onBack={() => setStep('menu')}
              onConfirm={doCancel}
              busy={busy}
              confirmLabel="Отменить заказ"
              danger
            />
          </div>
        ) : step === 'refund' ? (
          <div className="space-y-4">
            <Banner tone="rose">
              Возврат денег по выданному заказу. Товар (оправа+линзы) принимаем назад. Полный возврат закрывает заказ.
            </Banner>
            <ReasonBlock title="Причина возврата" codes={REFUND_REASONS} value={reason} onChange={setReason} />
            <CommentField value={comment} onChange={setComment} required={reason === 'other'} />
            <div>
              <Label>Сумма возврата (макс. {fmt(refundable)} с)</Label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="numeric"
                className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
              />
            </div>
            <div>
              <Label>Способ возврата</Label>
              <MethodPicker value={method} onChange={setMethod} />
            </div>
            <SettleToggle value={settleNow} onChange={setSettleNow} />
            <Footer
              onBack={() => setStep('menu')}
              onConfirm={doRefund}
              busy={busy}
              confirmLabel="Оформить возврат"
              danger
            />
          </div>
        ) : (
          <div className="space-y-4">
            <Banner tone="cyan">Бесплатная доработка/сервис. Деньги не двигаются — фиксируем факт.</Banner>
            <div className="grid grid-cols-2 gap-2">
              {SERVICE_ITEMS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSvcChecks((p) => ({ ...p, [s]: !p[s] }))}
                  className={
                    'rounded-xl px-3 py-2 text-sm font-medium transition text-left ' +
                    (svcChecks[s]
                      ? 'bg-cyan-500 text-white ring-1 ring-cyan-400'
                      : 'bg-white text-slate-600 ring-1 ring-sky-200 hover:bg-sky-50')
                  }
                >
                  {s}
                </button>
              ))}
            </div>
            <div>
              <Label>Другое</Label>
              <input
                value={svcOther}
                onChange={(e) => setSvcOther(e.target.value)}
                placeholder="что сделали"
                className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70 placeholder:text-slate-400"
              />
            </div>
            <Footer
              onBack={() => setStep('menu')}
              onConfirm={doService}
              busy={busy}
              confirmLabel="Записать доработку"
            />
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  NEW: 'Новый',
  TO_LAB: 'В лабораторию',
  IN_LAB: 'Изготовление',
  READY: 'Готово',
  IN_TRANSIT: 'В доставке',
  AT_BRANCH: 'В филиале',
  DELIVERED: 'Выдано',
  UNCLAIMED: 'Не забрано',
  CANCELLED: 'Отменён',
  REFUNDED: 'Возврат',
  REPLACED: 'Заменён',
};

function ReasonBlock({
  title,
  codes,
  value,
  onChange,
}: {
  title: string;
  codes: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="rounded-2xl bg-amber-50/70 ring-1 ring-amber-200 p-3">
      <div className="mb-2 text-[12px] font-bold uppercase tracking-wide text-amber-700">
        {title} <span className="text-rose-500">*</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {codes.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={
              'rounded-xl px-3 py-2 text-left text-[13px] font-semibold transition ' +
              (value === c
                ? 'bg-cyan-500 text-white ring-1 ring-cyan-400'
                : 'bg-white text-slate-700 ring-1 ring-sky-200 hover:bg-sky-50')
            }
          >
            {REASONS[c]}
          </button>
        ))}
      </div>
    </div>
  );
}

function CommentField({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <Label>{required ? 'Комментарий (обязательно)' : 'Комментарий'}</Label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={required ? 'опишите причину' : 'необязательно'}
        className={
          'w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:ring-2 focus:ring-cyan-400/70 placeholder:text-slate-400 ring-1 ' +
          (required && !value.trim() ? 'ring-amber-300' : 'ring-sky-200')
        }
      />
    </div>
  );
}

function SettleToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div>
      <Label>Деньги клиенту</Label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={
            'rounded-xl px-3 py-2 text-sm font-semibold transition ' +
            (value
              ? 'bg-cyan-500 text-white ring-1 ring-cyan-400'
              : 'bg-white text-slate-600 ring-1 ring-sky-200 hover:bg-sky-50')
          }
        >
          Вернул сейчас
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={
            'rounded-xl px-3 py-2 text-sm font-semibold transition ' +
            (!value
              ? 'bg-amber-500 text-white ring-1 ring-amber-400'
              : 'bg-white text-slate-600 ring-1 ring-sky-200 hover:bg-sky-50')
          }
        >
          Верну позже
        </button>
      </div>
      {!value && (
        <div className="mt-1 text-[11px] text-amber-600">
          Пометим «к возврату». Когда отдадите деньги — нажмёте «Выдать деньги».
        </div>
      )}
    </div>
  );
}

function Cheatsheet() {
  const [open, setOpen] = useState(true);
  const rows: Array<{ icon: React.ReactNode; tone: 'rose' | 'cyan' | 'slate'; label: string; rule: string }> = [
    { icon: <Ban className="h-4 w-4" />, tone: 'rose', label: 'Ещё не забрал заказ', rule: '«Отменить заказ» — вернуть аванс' },
    { icon: <Undo2 className="h-4 w-4" />, tone: 'rose', label: 'Брак или совсем не подошло', rule: '«Возврат денег» — товар забираем назад' },
    { icon: <Repeat className="h-4 w-4" />, tone: 'cyan', label: 'Замена: 14 дн любая, 60 дн рецепт', rule: 'оформляется на кассе — нужен сканер оправы' },
    { icon: <Wrench className="h-4 w-4" />, tone: 'slate', label: 'Подтянуть, винтик, нос-пады', rule: '«Доработка» — без денег' },
  ];
  const chip: Record<string, string> = {
    rose: 'text-rose-600 bg-rose-50 ring-rose-200',
    cyan: 'text-cyan-600 bg-cyan-50 ring-cyan-200',
    slate: 'text-slate-500 bg-slate-100 ring-slate-200',
  };
  return (
    <div className="rounded-2xl bg-slate-50 ring-1 ring-slate-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5"
      >
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-cyan-500 text-white shadow-[0_2px_10px_rgba(34,211,238,0.4)]">
          <Lightbulb className="h-4 w-4" />
        </span>
        <span className="flex-1 text-left text-[12px] font-bold uppercase tracking-wide text-slate-600">
          Памятка — что выбрать
        </span>
        <ChevronDown className={'h-4 w-4 text-slate-400 transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>
      {open && (
        <div className="space-y-1.5 px-3 pb-3">
          {rows.map((r, i) => (
            <div key={i} className="flex items-start gap-2.5 rounded-xl bg-white px-2.5 py-2 ring-1 ring-slate-100">
              <span className={'grid h-7 w-7 shrink-0 place-items-center rounded-lg ring-1 ' + chip[r.tone]}>
                {r.icon}
              </span>
              <div className="text-[12px] leading-snug">
                <div className="font-semibold text-slate-800">{r.label}</div>
                <div className="text-slate-500">{r.rule}</div>
              </div>
            </div>
          ))}
          <div className="flex items-start gap-2 rounded-xl bg-sky-50 px-2.5 py-2 text-[12px] leading-snug text-sky-900 ring-1 ring-sky-200">
            <Glasses className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" />
            <div>
              <b>Очки вернули</b> (возврат / полная замена) — заберите и уберите отдельно, <b>на витрину не возвращайте</b>. При замене только линз оправа остаётся у клиента.
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-2.5 py-2 text-[12px] leading-snug text-amber-800 ring-1 ring-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <b>Наличные = деньги из кассы.</b> Отдаёте позже — потом откройте заказ и нажмите «Выдать деньги», иначе будет недостача.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupHeader({ tone, children }: { tone: 'rose' | 'slate'; children: React.ReactNode }) {
  return (
    <div
      className={
        'mb-1.5 text-[11px] font-bold uppercase tracking-wide ' +
        (tone === 'rose' ? 'text-rose-500' : 'text-slate-400')
      }
    >
      {children}
    </div>
  );
}

function MenuItem({
  icon,
  title,
  desc,
  onClick,
  tone,
  disabled,
  money,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
  tone: 'rose' | 'cyan';
  disabled?: boolean;
  money?: { text: string; tone: 'rose' | 'slate' };
}) {
  const toneCls =
    tone === 'rose'
      ? 'text-rose-600 bg-rose-50 ring-rose-200'
      : 'text-cyan-600 bg-cyan-50 ring-cyan-200';
  const moneyCls =
    money?.tone === 'rose'
      ? 'bg-rose-100 text-rose-700'
      : 'bg-slate-100 text-slate-500';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left ring-1 ring-sky-100 transition hover:bg-sky-50/50 hover:ring-sky-200 disabled:opacity-40 disabled:hover:bg-white"
    >
      <span className={`grid h-10 w-10 place-items-center rounded-xl ring-1 ${toneCls}`}>{icon}</span>
      <span className="flex-1">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="block text-[12px] text-slate-500">{desc}</span>
      </span>
      {money && (
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${moneyCls}`}>
          {money.text}
        </span>
      )}
    </button>
  );
}

function Banner({ tone, children }: { tone: 'rose' | 'cyan'; children: React.ReactNode }) {
  const cls =
    tone === 'rose'
      ? 'bg-rose-50 ring-rose-200 text-rose-800'
      : 'bg-cyan-50 ring-cyan-200 text-cyan-800';
  return (
    <div className={`flex items-start gap-2 rounded-2xl p-3 text-[13px] ring-1 ${cls}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function Footer({
  onBack,
  onConfirm,
  busy,
  confirmLabel,
  danger,
}: {
  onBack: () => void;
  onConfirm: () => void;
  busy: boolean;
  confirmLabel: string;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      <button
        type="button"
        onClick={onBack}
        disabled={busy}
        className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"
      >
        Назад
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy}
        className={
          'inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50 ' +
          (danger
            ? 'bg-rose-500 shadow-[0_4px_16px_rgba(244,63,94,0.28)] hover:bg-rose-400'
            : 'bg-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.28)] hover:bg-cyan-400')
        }
      >
        <CheckCircle2 className="h-4 w-4" />
        {busy ? 'Сохраняем…' : confirmLabel}
      </button>
    </div>
  );
}
