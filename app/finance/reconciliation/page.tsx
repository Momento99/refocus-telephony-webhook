// app/finance/reconciliation/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import getSupabase from '@/lib/supabaseClient';
import { hasCrmPermission } from '@/lib/crmAccess';
import {
  fetchOverview,
  fetchOnlineOverview,
  upsertManualAmount,
  upsertOnlineManual,
  getReconciliationPeriodStart,
  getReconciliationPeriodEnd,
  shiftReconciliationPeriodISO,
  type RecoRow,
  type OnlineRecoRow,
} from '@/lib/reconciliation';

import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  Clock,
  History,
  RefreshCw,
  PiggyBank,
  X,
} from 'lucide-react';

/* ====================== consts & helpers ====================== */

const TOLERANCE = 50; // ±50 сом
const DEFAULT_ACQUIRING_RATE_PCT = 1.95; // фикс по умолчанию, но редактируем на странице

const MONTHS_RU = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

const fmtKGS = (n: number) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'KGS',
    maximumFractionDigits: 0,
  }).format(Math.round(n || 0));

const parseISODateUTC = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const formatRangeRu = (startISO: string, endISO: string) => {
  const start = parseISODateUTC(startISO);
  const end = parseISODateUTC(endISO);
  return `${start.getUTCDate()} ${MONTHS_RU[start.getUTCMonth()]} — ${end.getUTCDate()} ${
    MONTHS_RU[end.getUTCMonth()]
  } ${end.getUTCFullYear()}`;
};

const parseMoney = (input: string): number => {
  if (!input) return 0;
  const v = Number(String(input).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(v) ? Math.max(0, v) : 0;
};

const parsePercent = (input: string): number => {
  if (!input) return 0;
  const v = Number(String(input).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(v) ? Math.max(0, v) : 0;
};

const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

const getOnlineFormValues = (online: OnlineRecoRow) => {
  const posTotal = Number(online.expected_amount || 0);

  // A saved zero is a real value. Only a pending row should receive the
  // suggested acquiring commission.
  if (online.status !== 'pending') {
    const commission = Number(online.commission || 0);
    const ratePct = posTotal > 0 ? round2((commission / posTotal) * 100) : 0;
    return {
      amount: String(round2(Number(online.manual_amount || 0))),
      commission: String(round2(commission)),
      ratePct: String(ratePct),
    };
  }

  const computedCommission =
    posTotal > 0 ? Math.round((posTotal * DEFAULT_ACQUIRING_RATE_PCT) / 100) : 0;
  return {
    amount: '',
    commission: computedCommission > 0 ? String(computedCommission) : '',
    ratePct: String(DEFAULT_ACQUIRING_RATE_PCT),
  };
};

const cashStatusFromDiff = (hasManual: boolean, diff: number): RecoRow['status'] => {
  if (!hasManual) return 'pending';
  if (Math.abs(diff) <= TOLERANCE) return 'match';
  return diff < 0 ? 'shortage' : 'overpay';
};

const DELAY_REFETCH_MS = 350;

const loadFailureMessage = (section: string, reason: unknown) => {
  const message =
    typeof reason === 'object' && reason !== null && 'message' in reason
      ? String((reason as { message?: unknown }).message || 'неизвестная ошибка')
      : String(reason || 'неизвестная ошибка');

  if (message.includes('Неделя должна начинаться в понедельник')) {
    return `${section}: календарь сверки в базе ещё не обновлён до периода воскресенье–суббота.`;
  }

  return `${section}: ${message}`;
};

/* ====================== rpc wrappers ====================== */

type FixRow = {
  branch_id: number;
  branch_name: string;
  week_start: string;
  week_end: string;
  expected_snapshot: number;
  manual_snapshot: number;
  diff_snapshot: number;
  comment: string | null;
  fixed_by: string;
  fixed_at: string;
};

async function checkCanManageReconciliation(): Promise<boolean> {
  const sb = getSupabase();
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) return false;
  return hasCrmPermission(data.user.app_metadata?.role, 'reconciliation');
}

async function fixTransferRPC(weekStartISO: string, branchId: number, comment?: string | null) {
  const sb = getSupabase();
  const { error } = await sb.rpc('reconciliation_fix_transfer', {
    p_week_start: weekStartISO,
    p_branch_id: branchId,
    p_comment: comment ?? null,
  });
  if (error) throw error;
}

async function fetchFixHistoryRPC(weekStartISO: string, branchId?: number): Promise<FixRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc('reconciliation_fix_history', {
    p_week_start: weekStartISO,
    p_branch_id: branchId ?? null,
  });
  if (error) throw error;
  return (data as any[]) as FixRow[];
}

/* ====================== page ====================== */

export default function Page() {
  const currentWeekStartISO = getReconciliationPeriodStart(new Date());
  const [weekStartISO, setWeekStartISO] = useState<string>(() => currentWeekStartISO);
  const activeWeekRef = useRef(weekStartISO);
  const weekEndISO = getReconciliationPeriodEnd(weekStartISO);
  const weekLabel = useMemo(
    () => formatRangeRu(weekStartISO, weekEndISO),
    [weekStartISO, weekEndISO],
  );
  const isCurrentWeek = weekStartISO === currentWeekStartISO;

  const [rows, setRows] = useState<RecoRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [onlineErr, setOnlineErr] = useState<string | null>(null);
  const [owner, setOwner] = useState<boolean>(false);

  const [onlineRow, setOnlineRow] = useState<OnlineRecoRow | null>(null);
  const [onlineInput, setOnlineInput] = useState('');
  const [onlineCommissionInput, setOnlineCommissionInput] = useState('');
  const [onlineCommissionRateInput, setOnlineCommissionRateInput] = useState(
    String(DEFAULT_ACQUIRING_RATE_PCT),
  );
  const [onlineComment, setOnlineComment] = useState('');
  const [onlineSaving, setOnlineSaving] = useState(false);

  const [lastFixedAt, setLastFixedAt] = useState<Record<number, string>>({});

  const [histOpen, setHistOpen] = useState<{ open: boolean; branchId?: number; branchName?: string }>(
    { open: false },
  );
  const [histLoading, setHistLoading] = useState(false);
  const [history, setHistory] = useState<FixRow[] | null>(null);

  const selectWeek = (nextWeekStartISO: string) => {
    const latestCurrentWeekStartISO = getReconciliationPeriodStart(new Date());
    if (
      nextWeekStartISO === activeWeekRef.current ||
      nextWeekStartISO > latestCurrentWeekStartISO
    ) {
      return;
    }

    // Clear period-bound facts before changing the key. This prevents a stale
    // cash/bank card from being saved into the newly selected period while its
    // RPCs are still loading.
    activeWeekRef.current = nextWeekStartISO;
    setLoading(true);
    setRows(null);
    setOnlineRow(null);
    setOnlineErr(null);
    setOnlineInput('');
    setOnlineCommissionInput('');
    setOnlineCommissionRateInput(String(DEFAULT_ACQUIRING_RATE_PCT));
    setOnlineComment('');
    setWeekStartISO(nextWeekStartISO);
  };

  useEffect(() => {
    activeWeekRef.current = weekStartISO;
  }, [weekStartISO]);

  useEffect(() => {
    (async () => setOwner(await checkCanManageReconciliation()))();
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setErr(null);
        setOnlineErr(null);
        setLastFixedAt({});
        setHistOpen({ open: false });
        setHistory(null);

        const [cashResult, onlineResult] = await Promise.allSettled([
          fetchOverview(weekStartISO),
          fetchOnlineOverview(weekStartISO),
        ]);
        if (cancelled) return;

        if (cashResult.status === 'fulfilled') {
          const cleaned = (cashResult.value || []).filter(
            (r) => r.branch_name !== 'Новый филиал',
          );
          setRows(cleaned);
        } else {
          setRows(null);
          setErr(loadFailureMessage('Наличные', cashResult.reason));
        }

        if (onlineResult.status === 'fulfilled') {
          const online = onlineResult.value;
          setOnlineRow(online);
          const onlineForm = getOnlineFormValues(online);
          setOnlineInput(onlineForm.amount);
          setOnlineComment('');
          setOnlineCommissionRateInput(onlineForm.ratePct);
          setOnlineCommissionInput(onlineForm.commission);
        } else {
          setOnlineRow(null);
          setOnlineErr(loadFailureMessage('Банковская сверка', onlineResult.reason));
        }

      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.message || 'Ошибка загрузки');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [weekStartISO]);

  /* ====================== actions ====================== */

  async function manualRefresh() {
    const requestedWeek = weekStartISO;
    setLoading(true);
    try {
      setErr(null);
      setOnlineErr(null);
      const [cashResult, onlineResult] = await Promise.allSettled([
        fetchOverview(requestedWeek),
        fetchOnlineOverview(requestedWeek),
      ]);
      if (activeWeekRef.current !== requestedWeek) return;

      if (cashResult.status === 'fulfilled') {
        const cleaned = (cashResult.value || []).filter(
          (r) => r.branch_name !== 'Новый филиал',
        );
        setRows(cleaned);
      } else {
        setErr(loadFailureMessage('Наличные', cashResult.reason));
      }

      if (onlineResult.status === 'fulfilled') {
        const online = onlineResult.value;
        setOnlineRow(online);
        const onlineForm = getOnlineFormValues(online);
        setOnlineInput(onlineForm.amount);
        setOnlineCommissionRateInput(onlineForm.ratePct);
        setOnlineCommissionInput(onlineForm.commission);
      } else {
        setOnlineErr(loadFailureMessage('Банковская сверка', onlineResult.reason));
      }
    } finally {
      if (activeWeekRef.current === requestedWeek) setLoading(false);
    }
  }

  async function saveManual(
    branchId: number,
    amountInput: string,
    depositFeeInput: string,
    comment?: string,
  ) {
    if (!owner) return;
    if (!amountInput.trim()) {
      alert('Введите сумму, которая фактически поступила на счёт. Если поступлений не было, введите 0.');
      return;
    }
    const amount = parseMoney(amountInput);
    const depositFee = parseMoney(depositFeeInput);
    const selected = rows?.find((r) => r.branch_id === branchId);
    if (selected && depositFee > Math.max(0, selected.cash_to_handover)) {
      alert('Комиссия внесения не может быть больше суммы к сдаче.');
      return;
    }
    const previousRows = rows;
    const requestedWeek = weekStartISO;
    setRows((prev) => {
      if (!prev) return prev;
      return prev.map((r) => {
        if (r.branch_id !== branchId) return r;
        const manual = amount;
        const expected = r.cash_to_handover - depositFee;
        const diff = manual - expected;
        const status = cashStatusFromDiff(true, diff);
        return {
          ...r,
          deposit_fee: depositFee,
          expected_amount: expected,
          manual_amount: manual,
          has_manual: true,
          diff,
          status,
        };
      });
    });
    try {
      await upsertManualAmount({
        weekStartISO: requestedWeek,
        branchId,
        amount,
        depositFee,
        comment: comment?.trim() ? comment.trim() : null,
      });
    } catch (e: any) {
      if (activeWeekRef.current === requestedWeek) setRows(previousRows);
      alert(`Не удалось сохранить факт: ${e?.message ?? e}`);
      return;
    }

    try {
      await new Promise((r) => setTimeout(r, DELAY_REFETCH_MS));
      const fresh = await fetchOverview(requestedWeek);
      if (activeWeekRef.current !== requestedWeek) return;
      const cleaned = (fresh || []).filter((r) => r.branch_name !== 'Новый филиал');
      setRows(cleaned);
    } catch (e: any) {
      if (activeWeekRef.current === requestedWeek) {
        alert(`Факт сохранён, но данные не удалось перечитать: ${e?.message ?? e}`);
      }
    }
  }

  async function fixTransfer(branchId: number, comment?: string) {
    if (!owner) return;
    const requestedWeek = weekStartISO;
    try {
      await fixTransferRPC(requestedWeek, branchId, comment?.trim() ? comment.trim() : null);
      if (activeWeekRef.current !== requestedWeek) return;
      setLastFixedAt((prev) => ({ ...prev, [branchId]: new Date().toISOString() }));
      alert('Перевод зафиксирован. Запись добавлена в историю.');

      await new Promise((r) => setTimeout(r, DELAY_REFETCH_MS));
      const fresh = await fetchOverview(requestedWeek);
      if (activeWeekRef.current !== requestedWeek) return;
      const cleaned = (fresh || []).filter((r) => r.branch_name !== 'Новый филиал');
      setRows(cleaned);
    } catch (e: any) {
      alert(`Не удалось зафиксировать перевод: ${e?.message ?? e}`);
    }
  }

  async function openHistory(branchId: number, branchName: string) {
    const requestedWeek = weekStartISO;
    setHistOpen({ open: true, branchId, branchName });
    setHistLoading(true);
    try {
      const data = await fetchFixHistoryRPC(requestedWeek, branchId);
      if (activeWeekRef.current !== requestedWeek) return;
      setHistory(data);
      if (data && data.length > 0) {
        setLastFixedAt((prev) => ({ ...prev, [branchId]: data[data.length - 1].fixed_at }));
      }
    } finally {
      if (activeWeekRef.current === requestedWeek) setHistLoading(false);
    }
  }

  function handleOnlineCommissionRateChange(v: string) {
    setOnlineCommissionRateInput(v);

    const posTotal = Number(onlineRow?.expected_amount || 0);
    if (posTotal <= 0) return;

    if (v.trim() === '') {
      setOnlineCommissionInput('');
      return;
    }

    const rate = parsePercent(v);
    const comm = Math.round((posTotal * rate) / 100);
    setOnlineCommissionInput(comm > 0 ? String(comm) : '0');
  }

  function handleOnlineCommissionAmountChange(v: string) {
    setOnlineCommissionInput(v);

    const posTotal = Number(onlineRow?.expected_amount || 0);
    if (posTotal <= 0) return;

    // если очистили поле суммы — оставляем ставку как есть
    if (v.trim() === '') return;

    const comm = parseMoney(v);
    const rate = (comm / posTotal) * 100;
    if (Number.isFinite(rate)) setOnlineCommissionRateInput(String(round2(rate)));
  }

  async function saveOnline() {
    if (
      !owner ||
      loading ||
      onlineSaving ||
      !onlineRow ||
      onlineRow.week_start !== weekStartISO
    ) {
      return;
    }
    if (!onlineInput.trim()) {
      alert('Введите сумму, которая фактически поступила на счёт. Если поступлений не было, введите 0.');
      return;
    }
    const requestedWeek = weekStartISO;
    const amount = parseMoney(onlineInput);

    const posTotal = Number(onlineRow?.expected_amount || 0);
    const ratePct =
      onlineCommissionRateInput.trim() !== ''
        ? parsePercent(onlineCommissionRateInput)
        : DEFAULT_ACQUIRING_RATE_PCT;

    const comm =
      onlineCommissionInput.trim() !== ''
        ? parseMoney(onlineCommissionInput)
        : Math.round((posTotal * ratePct) / 100);

    setOnlineSaving(true);
    try {
      await upsertOnlineManual({
        weekStartISO: requestedWeek,
        amountBank: amount,
        commission: comm,
        comment: onlineComment,
      });
    } catch (e: any) {
      alert(`Не удалось сохранить онлайн-выручку: ${e?.message ?? e}`);
      setOnlineSaving(false);
      return;
    }

    if (activeWeekRef.current === requestedWeek) {
      const diff = amount + comm - posTotal;
      const status: OnlineRecoRow['status'] =
        Math.abs(diff) <= TOLERANCE ? 'match' : diff < 0 ? 'shortage' : 'overpay';
      setOnlineRow((prev) =>
        prev ? { ...prev, manual_amount: amount, commission: comm, diff, status } : prev,
      );
      setOnlineComment('');
    }

    try {
      await new Promise((r) => setTimeout(r, DELAY_REFETCH_MS));
      const online = await fetchOnlineOverview(requestedWeek);
      if (activeWeekRef.current !== requestedWeek) return;

      setOnlineRow(online);
      const onlineForm = getOnlineFormValues(online);
      setOnlineInput(onlineForm.amount);
      setOnlineCommissionRateInput(onlineForm.ratePct);
      setOnlineCommissionInput(onlineForm.commission);
    } catch (e: any) {
      if (activeWeekRef.current === requestedWeek) {
        alert(`Онлайн-выручка сохранена, но данные не удалось перечитать: ${e?.message ?? e}`);
      }
    } finally {
      setOnlineSaving(false);
    }
  }

  /* ====================== render ====================== */

  return (
    <div className="text-slate-50">
      <div>
        {/* Header (бренд-стандарт) */}
        <div className="mb-6 flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
            <PiggyBank className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-50">Наличные в кассах</div>
            <div className="mt-0.5 text-[12px] text-cyan-300/60">
              Сколько должно быть в каждом филиале по данным учёта
            </div>
          </div>
        </div>

        {/* Навигация по периодам сверки */}
        <div className="grid grid-cols-2 items-center gap-2 rounded-2xl bg-white ring-1 ring-sky-100 px-4 py-3 shadow-[0_8px_30px_rgba(15,23,42,0.45)] sm:flex sm:flex-wrap sm:justify-between">
          <button
            onClick={() => selectWeek(shiftReconciliationPeriodISO(activeWeekRef.current, -1))}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 py-2 text-sm font-medium text-cyan-700 hover:bg-cyan-50 transition-colors sm:min-h-0 sm:px-3.5"
          >
            <ArrowLeft className="h-4 w-4" /> Предыдущая
          </button>

          <div className="col-span-2 row-start-1 text-center">
            <div className="text-[13px] font-semibold text-slate-800">{weekLabel}</div>
            <button
              onClick={() => selectWeek(getReconciliationPeriodStart(new Date()))}
              className="mt-0.5 min-h-10 px-2 text-[11px] font-medium text-cyan-600 hover:text-cyan-800 transition-colors sm:min-h-0"
            >
              Текущий период
            </button>
          </div>

          <div className="flex items-center justify-end gap-1 sm:gap-2">
            <button
              onClick={() => selectWeek(shiftReconciliationPeriodISO(activeWeekRef.current, +1))}
              disabled={weekStartISO >= currentWeekStartISO}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 py-2 text-sm font-medium text-cyan-700 hover:bg-cyan-50 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent sm:min-h-0 sm:px-3.5"
            >
              Следующая <ArrowRight className="h-4 w-4" />
            </button>
            <button
              onClick={manualRefresh}
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 transition-colors sm:min-h-0 sm:min-w-0"
              title="Обновить"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {err && (
          <div className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-xs text-rose-900 ring-1 ring-rose-200">
            <div className="font-semibold">Данные не обнулены — загрузка не выполнена полностью.</div>
            <div className="mt-1">{err}</div>
          </div>
        )}

        {/* Быстрый обзор наличных по филиалам */}
        <section className="mt-5 rounded-2xl bg-gradient-to-br from-cyan-500 via-sky-500 to-blue-600 p-5 text-white shadow-[0_12px_32px_rgba(14,165,233,0.28)] ring-1 ring-white/20">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-50/80">
            {isCurrentWeek ? 'Должно быть в кассах сейчас' : 'Должно было быть в кассах'}
          </div>

          {rows === null ? (
            <div className="mt-4 rounded-xl bg-white/10 px-4 py-5 text-sm text-cyan-50/80 ring-1 ring-white/15">
              {loading ? 'Данные загружаются…' : 'Данные по наличным недоступны'}
            </div>
          ) : rows.length === 0 ? (
            <div className="mt-4 rounded-xl bg-white/10 px-4 py-5 text-sm text-cyan-50/80 ring-1 ring-white/15">
              Нет данных по филиалам.
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {rows.map((row) => (
                <div
                  key={`cash-overview:${row.branch_id}`}
                  className="min-w-0 rounded-2xl bg-white/15 p-4 ring-1 ring-white/20 backdrop-blur-sm"
                >
                  <div className="truncate text-xs font-medium text-cyan-50/85" title={row.branch_name}>
                    {row.branch_name}
                  </div>
                  <div className="mt-2 whitespace-nowrap text-xl font-bold tracking-tight text-white xl:text-2xl">
                    {fmtKGS(row.cash_to_handover)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* карточки по филиалам */}
        <div className="mt-7">
          {loading && rows === null && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {[...Array(5)].map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          )}
          {!loading && rows !== null && rows.length === 0 && <EmptyState />}
          {!loading && rows !== null && rows.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {rows.map((r) => (
                <BranchCard
                  key={`${r.week_start}:${r.branch_id}`}
                  row={r}
                  canEdit={owner}
                  isCurrentPeriod={isCurrentWeek}
                  lastFixedAt={lastFixedAt[r.branch_id]}
                  onSave={saveManual}
                  onFix={fixTransfer}
                  onHistory={(id, name) => openHistory(id, name)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Вторичная банковская сверка — не влияет на наличные в кассах */}
        {!loading && (onlineErr || (onlineRow && onlineRow.week_start === weekStartISO)) && (
          <details className="group mt-8 overflow-hidden rounded-2xl bg-white text-slate-900 ring-1 ring-slate-200 shadow-[0_8px_30px_rgba(15,23,42,0.35)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:content-none">
              <div>
                <div className="text-sm font-semibold text-slate-800">Дополнительно: онлайн-оплаты и банк</div>
                <div className="mt-0.5 text-xs text-slate-500">Не влияет на сумму наличных в кассах</div>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-cyan-700">
                <span className="group-open:hidden">Открыть</span>
                <span className="hidden group-open:inline">Скрыть</span>
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="border-t border-slate-200 p-4">
              {onlineErr && (
                <div className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800 ring-1 ring-rose-200">
                  {onlineErr}
                </div>
              )}
              {onlineRow && onlineRow.week_start === weekStartISO && (
                <OnlineCard
                  row={onlineRow}
                  inputAmount={onlineInput}
                  inputCommission={onlineCommissionInput}
                  inputCommissionRate={onlineCommissionRateInput}
                  comment={onlineComment}
                  onChangeAmount={setOnlineInput}
                  onChangeCommission={handleOnlineCommissionAmountChange}
                  onChangeCommissionRate={handleOnlineCommissionRateChange}
                  onChangeComment={setOnlineComment}
                  onSave={saveOnline}
                  saving={onlineSaving}
                  canEdit={owner && !onlineSaving}
                />
              )}
            </div>
          </details>
        )}
      </div>

      {/* история */}
      {histOpen.open && (
        <Modal
          onClose={() => {
            setHistOpen({ open: false });
            setHistory(null);
          }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-5 w-5 text-cyan-500" />
            <div className="font-semibold text-slate-900">История фиксаций: {histOpen.branchName}</div>
          </div>
          {histLoading && <div className="text-sm text-slate-500">Загрузка…</div>}
          {!histLoading && (!history || history.length === 0) && <div className="text-sm text-slate-500">Пусто.</div>}
          {!histLoading && history && history.length > 0 && (
            <div className="space-y-3">
              {history.map((h, i) => (
                <div key={i} className="rounded-xl ring-1 ring-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm text-slate-900">
                      <b>{fmtKGS(h.manual_snapshot)}</b> зафиксировано • Δ {fmtKGS(h.diff_snapshot)}
                    </div>
                    <div className="text-xs text-slate-500">{new Date(h.fixed_at).toLocaleString('ru-RU')}</div>
                  </div>
                  {h.comment && <div className="text-xs text-slate-600 mt-1">Комментарий: {h.comment}</div>}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/* ====================== small ui ====================== */

function SoftPrimaryBtn({
  children,
  className = '',
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white sm:min-h-0 ' +
        'shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 ' +
        'focus:outline-none focus:ring-2 focus:ring-cyan-300/70 ' +
        'disabled:opacity-50 disabled:cursor-not-allowed ' +
        className
      }
    >
      {children}
    </button>
  );
}

function SoftGhostBtn({
  children,
  className = '',
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-slate-700 sm:min-h-0 ' +
        'ring-1 ring-slate-200 transition hover:bg-slate-50 ' +
        'disabled:opacity-50 disabled:cursor-not-allowed ' +
        className
      }
    >
      {children}
    </button>
  );
}

function BranchCard({
  row,
  canEdit,
  isCurrentPeriod,
  lastFixedAt,
  onSave,
  onFix,
  onHistory,
}: {
  row: RecoRow;
  canEdit: boolean;
  isCurrentPeriod: boolean;
  lastFixedAt?: string;
  onSave: (
    branchId: number,
    amountInput: string,
    depositFeeInput: string,
    comment?: string,
  ) => Promise<void>;
  onFix: (branchId: number, comment?: string) => Promise<void>;
  onHistory: (branchId: number, branchName: string) => void;
}) {
  const [input, setInput] = useState(row.has_manual ? String(Math.round(row.manual_amount)) : '');
  const [depositFeeInput, setDepositFeeInput] = useState(
    row.deposit_fee > 0 ? String(Math.round(row.deposit_fee)) : '',
  );
  const [comment, setComment] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [fixing, setFixing] = useState(false);

  useEffect(() => {
    setInput(row.has_manual ? String(Math.round(row.manual_amount)) : '');
    setDepositFeeInput(row.deposit_fee > 0 ? String(Math.round(row.deposit_fee)) : '');
    setComment('');
  }, [row.branch_id, row.week_start, row.manual_amount, row.deposit_fee, row.has_manual]);

  const theme =
    {
      pending: {
        chip: 'bg-slate-100 text-slate-700 ring-slate-200',
        label: 'Факт не внесён',
        icon: <Clock className="h-4 w-4" />,
      },
      match: {
        chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
        label: 'Совпадает',
        icon: <CheckCircle2 className="h-4 w-4" />,
      },
      shortage: {
        chip: 'bg-rose-50 text-rose-700 ring-rose-200',
        label: 'Недостача',
        icon: <AlertTriangle className="h-4 w-4" />,
      },
      overpay: {
        chip: 'bg-amber-50 text-amber-700 ring-amber-200',
        label: 'Переплата',
        icon: <AlertTriangle className="h-4 w-4" />,
      },
    }[row.status] || {
      chip: 'bg-slate-100 text-slate-700 ring-slate-200',
      label: '—',
      icon: null,
    };

  async function handleSave() {
    if (!canEdit) return;
    try {
      setSaving(true);
      await onSave(row.branch_id, input, depositFeeInput, comment);
    } finally {
      setSaving(false);
    }
  }

  async function handleFix() {
    if (!canEdit || !row.has_manual) return;
    try {
      setFixing(true);
      await onFix(row.branch_id, comment);
    } finally {
      setFixing(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-5 text-slate-900 ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
      <div className="text-base font-semibold text-slate-900">{row.branch_name}</div>

      <div className="mt-4 rounded-2xl bg-gradient-to-br from-cyan-50 to-sky-100 p-4 ring-1 ring-cyan-200">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-800/70">
          {isCurrentPeriod ? 'Должно быть в кассе сейчас' : 'Должно было быть в кассе'}
        </div>
        <div className="mt-1 text-3xl font-bold tracking-tight text-slate-950">
          {fmtKGS(row.cash_to_handover)}
        </div>
        <div className="mt-1 text-[11px] text-slate-600">По учёту выбранного кассового периода</div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 min-[420px]:grid-cols-3">
        <MiniKV k="Продажи наличными" v={fmtKGS(row.cash_sales)} />
        <MiniKV k="Возвраты" v={fmtKGS(row.cash_refunds)} className="text-rose-600" />
        <MiniKV k="Расходы" v={fmtKGS(row.cash_expenses)} className="text-rose-600" />
      </div>

      <details className="group mt-4 overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 marker:content-none">
          <span className="text-xs font-medium text-slate-600">Сверка внесения в банк</span>
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-700">
            <span className="group-open:hidden">Открыть</span>
            <span className="hidden group-open:inline">Скрыть</span>
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
          </span>
        </summary>

        <div className="border-t border-slate-200 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-[11px] text-slate-500">Статус сверки</span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ring-1 ${theme.chip}`}>
              {theme.icon}
              {theme.label}
            </span>
          </div>

          {lastFixedAt && (
            <div className="mb-3 flex items-center gap-1 text-[11px] text-slate-500">
              <History className="h-3.5 w-3.5" />
              Последняя фиксация: {new Date(lastFixedAt).toLocaleString('ru-RU')}
            </div>
          )}

          {row.deposit_fee > 0 && (
            <div className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-xs text-slate-700 ring-1 ring-sky-200">
              После комиссии {fmtKGS(row.deposit_fee)} на счёт должно поступить{' '}
              <b>{fmtKGS(row.expected_amount)}</b>.
            </div>
          )}

          {row.has_manual && (
            <div className="mb-3 grid grid-cols-2 gap-3">
              <MiniKV k="Фактически поступило" v={fmtKGS(row.manual_amount)} />
              <MiniKV
                k="Разница"
                v={fmtKGS(row.diff)}
                className={
                  row.status === 'shortage'
                    ? 'text-red-600'
                    : row.status === 'overpay'
                      ? 'text-amber-600'
                      : 'text-slate-900'
                }
              />
            </div>
          )}

          {canEdit ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label>
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Поступило на счёт, сом
                  </span>
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="После комиссии внесения"
                    inputMode="decimal"
                    className="w-full rounded-xl bg-white px-3 py-2.5 text-base sm:text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition placeholder:text-slate-400 focus:ring-2 focus:ring-cyan-400/70"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Комиссия внесения, сом
                  </span>
                  <input
                    value={depositFeeInput}
                    onChange={(e) => setDepositFeeInput(e.target.value)}
                    placeholder="0, если комиссии не было"
                    inputMode="decimal"
                    className="w-full rounded-xl bg-white px-3 py-2.5 text-base sm:text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition placeholder:text-slate-400 focus:ring-2 focus:ring-cyan-400/70"
                  />
                </label>
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Комментарий"
                rows={2}
                className="w-full rounded-xl bg-white px-3 py-2.5 text-base sm:text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition placeholder:text-slate-400 focus:ring-2 focus:ring-cyan-400/70"
              />
              <SoftPrimaryBtn onClick={handleSave} disabled={saving}>
                {saving ? 'Сохраняю…' : 'Сохранить факт и комиссию'}
              </SoftPrimaryBtn>
            </div>
          ) : (
            <div className="text-[11px] text-slate-500">Изменение сверки доступно владельцу и управляющей.</div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            {canEdit ? (
              <SoftPrimaryBtn
                onClick={handleFix}
                disabled={!row.has_manual || fixing}
                title={!row.has_manual ? 'Сначала сохраните факт' : ''}
              >
                {fixing ? 'Фиксирую…' : 'Зафиксировать'}
              </SoftPrimaryBtn>
            ) : (
              <div />
            )}
            <SoftGhostBtn onClick={() => onHistory(row.branch_id, row.branch_name)}>
              <History className="h-4 w-4" /> История
            </SoftGhostBtn>
          </div>
        </div>
      </details>
    </div>
  );
}

function MiniKV({ k, v, className = '' }: { k: string; v: string; className?: string }) {
  return (
    <div>
      <div className="text-[11px] tracking-wide text-slate-500">{k}</div>
      <div className={`text-base font-semibold text-slate-900 ${className}`}>{v}</div>
    </div>
  );
}

function OnlineCard({
  row,
  inputAmount,
  inputCommission,
  inputCommissionRate,
  comment,
  onChangeAmount,
  onChangeCommission,
  onChangeCommissionRate,
  onChangeComment,
  onSave,
  saving,
  canEdit,
}: {
  row: OnlineRecoRow;
  inputAmount: string;
  inputCommission: string;
  inputCommissionRate: string;
  comment: string;
  onChangeAmount: (v: string) => void;
  onChangeCommission: (v: string) => void;
  onChangeCommissionRate: (v: string) => void;
  onChangeComment: (v: string) => void;
  onSave: () => Promise<void> | void;
  saving: boolean;
  canEdit: boolean;
}) {
  const ratePct =
    inputCommissionRate.trim() !== '' ? parsePercent(inputCommissionRate) : DEFAULT_ACQUIRING_RATE_PCT;

  const expectedCommissionHint =
    row.expected_amount > 0 ? fmtKGS((row.expected_amount * ratePct) / 100) : fmtKGS(0);

  const bankNet = inputAmount.trim() !== '' ? parseMoney(inputAmount) : Number(row.manual_amount || 0);
  const bankCommission =
    inputCommission.trim() !== ''
      ? parseMoney(inputCommission)
      : Number(row.commission || Math.round((row.expected_amount * ratePct) / 100));
  const bankGross = bankNet + bankCommission;
  const liveDiff = bankGross - row.expected_amount;
  const hasBankFact = row.status !== 'pending' || inputAmount.trim() !== '';
  const liveStatus: OnlineRecoRow['status'] = !hasBankFact
    ? 'pending'
    : Math.abs(liveDiff) <= TOLERANCE
      ? 'match'
      : liveDiff < 0
        ? 'shortage'
        : 'overpay';
  const percent =
    hasBankFact && row.expected_amount > 0
      ? Math.min(100, Math.max(0, (bankGross / row.expected_amount) * 100))
      : 0;

  const theme =
    {
      pending: { chip: 'bg-slate-100 text-slate-700 ring-slate-200', label: 'Факт не внесён' },
      match: { chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'Совпадает' },
      shortage: { chip: 'bg-rose-50 text-rose-700 ring-rose-200', label: 'Недостача' },
      overpay: { chip: 'bg-amber-50 text-amber-700 ring-amber-200', label: 'Переплата' },
    }[liveStatus];

  return (
    <div className="rounded-2xl p-5 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] text-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">Онлайн-оплаты (все филиалы)</div>
          <div className="mt-1 text-[11px] text-slate-500">
            Период: {row.week_start} — {row.week_end}
          </div>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ring-1 ${theme.chip}`}>
          {theme.label}
        </span>
      </div>

      {/* Numbers */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <MiniKV k="Должно по POS" v={fmtKGS(row.expected_amount)} />
        <MiniKV k="На счёт (чистыми)" v={hasBankFact ? fmtKGS(bankNet) : 'Не внесено'} />
        <MiniKV k="Комиссия" v={fmtKGS(bankCommission)} />
        <MiniKV k="До комиссии" v={hasBankFact ? fmtKGS(bankGross) : '—'} />
        <MiniKV
          k="Δ POS vs до комиссии"
          v={hasBankFact ? fmtKGS(liveDiff) : '—'}
          className={
            liveStatus === 'shortage' ? 'text-red-600' : liveStatus === 'overpay' ? 'text-amber-600' : 'text-slate-900'
          }
        />
      </div>
      <div className="mt-2 rounded-xl bg-sky-50 px-3 py-2 text-xs text-slate-700 ring-1 ring-sky-200">
        {hasBankFact ? (
          <>
            {fmtKGS(bankNet)} поступило на счёт + {fmtKGS(bankCommission)} комиссии ={' '}
            <b>{fmtKGS(bankGross)}</b> до комиссии; сравниваем с {fmtKGS(row.expected_amount)} по POS.
          </>
        ) : (
          <>Факт по банковской выписке ещё не внесён — недостача пока не рассчитывается.</>
        )}
      </div>

      {/* Progress */}
      <div className="mt-3">
        <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full bg-cyan-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="mt-1 text-right text-[11px] text-slate-500">
          {hasBankFact ? `${percent.toFixed(0)}%` : 'Ожидается ввод факта'}
        </div>
      </div>

      {/* Inputs */}
      <div className="mt-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
              Поступило на счёт после комиссии, сом
            </div>
            <input
              value={inputAmount}
              onChange={(e) => onChangeAmount(e.target.value)}
              placeholder="Сколько реально пришло на счёт"
              inputMode="numeric"
              disabled={!canEdit}
              className="w-full rounded-xl bg-white px-3 py-2.5 text-base sm:text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 placeholder:text-slate-400 disabled:bg-slate-100"
            />
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Комиссия эквайринга</div>

            {/* ставка + сумма */}
            <div className="flex items-end gap-2">
              <div className="w-[110px]">
                <div className="text-[10px] text-slate-500 mb-1">Ставка, %</div>
                <input
                  value={inputCommissionRate}
                  onChange={(e) => onChangeCommissionRate(e.target.value)}
                  placeholder={String(DEFAULT_ACQUIRING_RATE_PCT)}
                  inputMode="decimal"
                  disabled={!canEdit}
                  className="w-full rounded-xl bg-white px-3 py-2.5 text-base sm:text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 placeholder:text-slate-400 disabled:bg-slate-100"
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-[10px] text-slate-500 mb-1">Сумма, сом</div>
                <input
                  value={inputCommission}
                  onChange={(e) => onChangeCommission(e.target.value)}
                  placeholder="Авто от ставки"
                  inputMode="numeric"
                  disabled={!canEdit}
                  className="w-full rounded-xl bg-white px-3 py-2.5 text-base sm:text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 placeholder:text-slate-400 disabled:bg-slate-100"
                />
              </div>
            </div>

            <div className="mt-1 text-[11px] text-slate-500">
              По умолчанию: {DEFAULT_ACQUIRING_RATE_PCT}% • сейчас: {round2(ratePct)}% • расчёт ≈ {expectedCommissionHint}
            </div>
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Комментарий</div>
          <textarea
            value={comment}
            onChange={(e) => onChangeComment(e.target.value)}
            rows={2}
            placeholder="Например: «Много возвратов по онлайну»"
            disabled={!canEdit}
            className="w-full rounded-xl bg-white px-3 py-2.5 text-base sm:text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 placeholder:text-slate-400 disabled:bg-slate-100"
          />
        </div>
        {!canEdit && <div className="text-[11px] text-slate-500">Изменение онлайн-сверки доступно владельцу и управляющей.</div>}
      </div>

      {/* Actions */}
      <div className="mt-4 flex justify-end">
        <SoftPrimaryBtn onClick={onSave} disabled={!canEdit || saving}>
          {saving ? 'Сохраняю…' : 'Сохранить онлайн-выручку'}
        </SoftPrimaryBtn>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-10 text-center text-slate-500 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
      Нет данных по филиалам.
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl p-5 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] animate-pulse">
      <div className="h-6 rounded bg-slate-200" />
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="h-8 rounded bg-slate-200" />
        <div className="h-8 rounded bg-slate-200" />
        <div className="h-8 rounded bg-slate-200" />
      </div>
      <div className="mt-4 h-2 rounded bg-slate-200" />
      <div className="mt-5 h-10 rounded bg-slate-200" />
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl rounded-3xl bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.4)] ring-1 ring-sky-100 max-h-[90dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label="Закрыть"
        >
          <X className="h-5 w-5" />
        </button>
        {children}
      </div>
    </div>
  );
}
