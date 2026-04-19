// app/finance/reconciliation/page.tsx
'use client';

import Link from 'next/link';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import getSupabase from '@/lib/supabaseClient';
import {
  fetchOverview,
  fetchOnlineOverview,
  upsertManualAmount,
  upsertOnlineManual,
  getWeekStartMonday,
  type RecoRow,
  type OnlineRecoRow,
} from '@/lib/reconciliation';

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Clock,
  History,
  RefreshCw,
  Search,
  Building2,
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

const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const shiftWeeks = (d: Date, w: number) => addDays(d, w * 7);

const formatRangeRu = (start: Date) => {
  const end = addDays(start, 6);
  return `${start.getDate()} ${MONTHS_RU[start.getMonth()]} — ${end.getDate()} ${
    MONTHS_RU[end.getMonth()]
  } ${end.getFullYear()}`;
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

const DELAY_REFETCH_MS = 350;

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

type ExpenseRow = {
  branch_id: number;
  branch_name: string;
  cash_expenses: number;
};

async function checkIsOwner(): Promise<boolean> {
  const sb = getSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return false;
  const { data } = await sb.from('profiles').select('role').eq('id', u.user.id).single();
  return data?.role === 'owner';
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

async function fetchWeeklyExpenses(weekStartISO: string): Promise<ExpenseRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('v_reconciliation_weekly_branch_income')
    .select('branch_id, branch_name, week_start, cash_expenses')
    .eq('week_start', weekStartISO);

  if (error) throw error;
  if (!data) return [];

  return (data as any[]).map((r) => ({
    branch_id: r.branch_id,
    branch_name: r.branch_name,
    cash_expenses: Number(r.cash_expenses || 0),
  }));
}

/* ===== POS (онлайн) по филиалам ===== */

type OnlinePosBranchRow = {
  branch_id: number;
  branch_name: string;
  pos_amount: number;
};

async function fetchWeeklyOnlinePosByBranch(weekStartISO: string): Promise<OnlinePosBranchRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('v_reconciliation_weekly_branch_income')
    .select('branch_id, branch_name, week_start, non_cash_payments')
    .eq('week_start', weekStartISO);

  if (error) throw error;
  if (!data) return [];

  return (data as any[])
    .filter((r) => r.branch_name !== 'Новый филиал')
    .map((r) => ({
      branch_id: Number(r.branch_id),
      branch_name: String(r.branch_name || ''),
      pos_amount: Number(r.non_cash_payments || 0),
    }));
}

/* ====================== extra types (онлайн) ====================== */

type OnlineSummary = {
  posTotal: number;
  bankIncoming: number;
  bankCommission: number;
  bankNet: number;
  delta: number;
};

type ExpensesSummary = {
  total: number;
  list: ExpenseRow[];
};

/* ====================== page ====================== */

export default function Page() {
  const [weekStartDate, setWeekStartDate] = useState<Date>(
    () => new Date(getWeekStartMonday(new Date())),
  );
  const weekStartISO = getWeekStartMonday(weekStartDate);
  const weekLabel = useMemo(() => formatRangeRu(weekStartDate), [weekStartDate]);

  const [rows, setRows] = useState<RecoRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const qDeferred = useDeferredValue(q);
  const [owner, setOwner] = useState<boolean>(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const [onlineRow, setOnlineRow] = useState<OnlineRecoRow | null>(null);
  const [onlineInput, setOnlineInput] = useState('');
  const [onlineCommissionInput, setOnlineCommissionInput] = useState('');
  const [onlineCommissionRateInput, setOnlineCommissionRateInput] = useState(
    String(DEFAULT_ACQUIRING_RATE_PCT),
  );
  const [onlineComment, setOnlineComment] = useState('');
  const [onlineSaving, setOnlineSaving] = useState(false);

  const [onlinePosRows, setOnlinePosRows] = useState<OnlinePosBranchRow[] | null>(null);

  const [lastFixedAt, setLastFixedAt] = useState<Record<number, string>>({});

  const [histOpen, setHistOpen] = useState<{ open: boolean; branchId?: number; branchName?: string }>(
    { open: false },
  );
  const [histLoading, setHistLoading] = useState(false);
  const [history, setHistory] = useState<FixRow[] | null>(null);

  const [expensesRows, setExpensesRows] = useState<ExpenseRow[] | null>(null);

  useEffect(() => {
    (async () => setOwner(await checkIsOwner()))();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        const [data, online, expenses, posByBranch] = await Promise.all([
          fetchOverview(weekStartISO),
          fetchOnlineOverview(weekStartISO),
          fetchWeeklyExpenses(weekStartISO),
          fetchWeeklyOnlinePosByBranch(weekStartISO),
        ]);

        const cleaned = (data || []).filter((r) => r.branch_name !== 'Новый филиал');
        setRows(cleaned);

        setOnlineRow(online);
        setOnlineInput(online.manual_amount > 0 ? String(Math.round(online.manual_amount)) : '');
        setOnlineComment('');

        // комиссия: ставка (по умолчанию 1.95%) + сумма (авто от POS)
        const posTotal = Number(online.expected_amount || 0);
        const savedComm = Number(online.commission || 0);

        let ratePct = DEFAULT_ACQUIRING_RATE_PCT;
        if (posTotal > 0 && savedComm > 0) ratePct = round2((savedComm / posTotal) * 100);
        setOnlineCommissionRateInput(String(ratePct));

        const computedComm = posTotal > 0 ? Math.round((posTotal * ratePct) / 100) : 0;
        const initialComm = savedComm > 0 ? Math.round(savedComm) : computedComm;
        setOnlineCommissionInput(initialComm > 0 ? String(initialComm) : '');

        setExpensesRows(expenses || []);
        setOnlinePosRows(posByBranch || []);

        setLastUpdatedAt(new Date());
      } catch (e: any) {
        setErr(e?.message || 'Ошибка загрузки');
      } finally {
        setLoading(false);
      }
    })();
  }, [weekStartISO]);

  const filtered = useMemo(() => {
    const s = qDeferred.trim().toLowerCase();
    return (rows || []).filter((r) => r.branch_name.toLowerCase().includes(s));
  }, [rows, qDeferred]);

  /* ===== сводка по НАЛИЧНЫМ ===== */
  const cashSummary = useMemo(() => {
    const src = rows || [];
    let should = 0,
      fact = 0,
      match = 0,
      shortage = 0,
      overpay = 0,
      overpayTotal = 0;
    const overList: { id: number; name: string; delta: number }[] = [];

    for (const r of src) {
      const s = r.expected_amount || 0;
      const m = r.manual_amount || 0;
      const d = m - s;
      should += s;
      fact += m;

      if (Math.abs(d) <= TOLERANCE) match++;
      else if (d < -TOLERANCE) shortage++;
      else {
        overpay++;
        overpayTotal += d;
        overList.push({ id: r.branch_id, name: r.branch_name, delta: d });
      }
    }

    const percent = should > 0 ? Math.min(100, Math.max(0, (fact / should) * 100)) : 0;
    const delta = fact - should;

    overList.sort((a, b) => b.delta - a.delta);

    return { should, fact, delta, percent, match, shortage, overpay, overpayTotal, overList };
  }, [rows]);

  /* ===== сводка по РАСХОДАМ (наличные) ===== */
  const expensesSummary: ExpensesSummary = useMemo(() => {
    const list = (expensesRows || []).filter((r) => (r.cash_expenses || 0) > 0);
    const total = list.reduce((acc, r) => acc + (r.cash_expenses || 0), 0);
    const sorted = [...list].sort((a, b) => b.cash_expenses - a.cash_expenses);
    return { total, list: sorted };
  }, [expensesRows]);

  /* ===== сводка по ОНЛАЙН-оплатам (вся сеть) ===== */
  const onlineSummary: OnlineSummary = useMemo(() => {
    if (!onlineRow) return { posTotal: 0, bankIncoming: 0, bankCommission: 0, bankNet: 0, delta: 0 };

    const posTotal = Number(onlineRow.expected_amount || 0);

    // показываем "живые" значения с формы (чтобы комиссия считалась сразу на странице)
    const bankIncoming =
      onlineInput.trim() !== '' ? parseMoney(onlineInput) : Number(onlineRow.manual_amount || 0);

    const ratePct =
      onlineCommissionRateInput.trim() !== ''
        ? parsePercent(onlineCommissionRateInput)
        : DEFAULT_ACQUIRING_RATE_PCT;

    const bankCommission =
      onlineCommissionInput.trim() !== ''
        ? parseMoney(onlineCommissionInput)
        : Math.round((posTotal * ratePct) / 100);

    const bankNet = Math.max(0, bankIncoming - bankCommission);
    const delta = bankIncoming - posTotal;

    return { posTotal, bankIncoming, bankCommission, bankNet, delta };
  }, [onlineRow, onlineInput, onlineCommissionInput, onlineCommissionRateInput]);

  /* ===== POS (онлайн) по филиалам — подготовка списка ===== */
  const onlinePosByBranch = useMemo(() => {
    const list = (onlinePosRows || [])
      .filter((r) => (r.pos_amount || 0) > 0)
      .sort((a, b) => b.pos_amount - a.pos_amount);
    const total = list.reduce((acc, r) => acc + (r.pos_amount || 0), 0);
    return { list, total };
  }, [onlinePosRows]);

  /* ---- мягкий merge ---- */
  function softMergeRows(prev: RecoRow[], fresh: RecoRow[]) {
    const normalized = (fresh || []).filter((r) => r.branch_name !== 'Новый филиал');
    const byId = new Map(normalized.map((r) => [r.branch_id, r]));
    return prev.map((p) => {
      const f = byId.get(p.branch_id);
      if (!f) return p;
      const manual = p.manual_amount > 0 && f.manual_amount === 0 ? p.manual_amount : f.manual_amount;
      const expected = f.expected_amount;
      const diff = manual - expected;
      const status: RecoRow['status'] = Math.abs(diff) <= TOLERANCE ? 'match' : diff < -TOLERANCE ? 'shortage' : 'overpay';
      return { ...f, manual_amount: manual, diff, status };
    });
  }

  /* ====================== actions ====================== */

  async function manualRefresh() {
    setLoading(true);
    try {
      const [fresh, online, expenses, posByBranch] = await Promise.all([
        fetchOverview(weekStartISO),
        fetchOnlineOverview(weekStartISO),
        fetchWeeklyExpenses(weekStartISO),
        fetchWeeklyOnlinePosByBranch(weekStartISO),
      ]);

      const cleaned = (fresh || []).filter((r) => r.branch_name !== 'Новый филиал');
      setRows((prev) => (prev ? softMergeRows(prev, cleaned) : cleaned));

      setOnlineRow(online);
      setOnlineInput(online.manual_amount > 0 ? String(Math.round(online.manual_amount)) : '');

      const posTotal = Number(online.expected_amount || 0);
      const savedComm = Number(online.commission || 0);

      let ratePct = DEFAULT_ACQUIRING_RATE_PCT;
      if (posTotal > 0 && savedComm > 0) ratePct = round2((savedComm / posTotal) * 100);
      setOnlineCommissionRateInput(String(ratePct));

      const computedComm = posTotal > 0 ? Math.round((posTotal * ratePct) / 100) : 0;
      const initialComm = savedComm > 0 ? Math.round(savedComm) : computedComm;
      setOnlineCommissionInput(initialComm > 0 ? String(initialComm) : '');

      setExpensesRows(expenses || []);
      setOnlinePosRows(posByBranch || []);

      setLastUpdatedAt(new Date());
    } finally {
      setLoading(false);
    }
  }

  async function saveManual(branchId: number, amountInput: string, comment?: string) {
    const amount = parseMoney(amountInput);
    try {
      setRows((prev) => {
        if (!prev) return prev;
        return prev.map((r) => {
          if (r.branch_id !== branchId) return r;
          const manual = amount;
          const expected = r.expected_amount || 0;
          const diff = manual - expected;
          const status: RecoRow['status'] = Math.abs(diff) <= TOLERANCE ? 'match' : diff < -TOLERANCE ? 'shortage' : 'overpay';
          return { ...r, manual_amount: manual, diff, status };
        });
      });
      setLastUpdatedAt(new Date());

      await upsertManualAmount({
        weekStartISO,
        branchId,
        amount,
        comment: comment?.trim() ? comment.trim() : null,
      });

      await new Promise((r) => setTimeout(r, DELAY_REFETCH_MS));
      const fresh = await fetchOverview(weekStartISO);
      const cleaned = (fresh || []).filter((r) => r.branch_name !== 'Новый филиал');
      setRows((prev) => (prev ? softMergeRows(prev, cleaned) : cleaned));
      setLastUpdatedAt(new Date());
    } catch (e: any) {
      alert(`Не удалось сохранить факт: ${e?.message ?? e}`);
    }
  }

  async function fixTransfer(branchId: number, comment?: string) {
    try {
      await fixTransferRPC(weekStartISO, branchId, comment?.trim() ? comment.trim() : null);
      setLastFixedAt((prev) => ({ ...prev, [branchId]: new Date().toISOString() }));
      alert('Перевод зафиксирован. Запись добавлена в историю.');

      await new Promise((r) => setTimeout(r, DELAY_REFETCH_MS));
      const fresh = await fetchOverview(weekStartISO);
      const cleaned = (fresh || []).filter((r) => r.branch_name !== 'Новый филиал');
      setRows((prev) => (prev ? softMergeRows(prev, cleaned) : cleaned));
      setLastUpdatedAt(new Date());
    } catch (e: any) {
      alert(`Не удалось зафиксировать перевод: ${e?.message ?? e}`);
    }
  }

  async function openHistory(branchId: number, branchName: string) {
    setHistOpen({ open: true, branchId, branchName });
    setHistLoading(true);
    try {
      const data = await fetchFixHistoryRPC(weekStartISO, branchId);
      setHistory(data);
      if (data && data.length > 0) {
        setLastFixedAt((prev) => ({ ...prev, [branchId]: data[data.length - 1].fixed_at }));
      }
    } finally {
      setHistLoading(false);
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

    try {
      setOnlineSaving(true);

      await upsertOnlineManual({
        weekStartISO,
        amountBank: amount,
        commission: comm,
        comment: onlineComment,
      });

      await new Promise((r) => setTimeout(r, DELAY_REFETCH_MS));
      const online = await fetchOnlineOverview(weekStartISO);

      setOnlineRow(online);
      setOnlineInput(online.manual_amount > 0 ? String(Math.round(online.manual_amount)) : '');

      const refreshedPosTotal = Number(online.expected_amount || 0);
      const refreshedSavedComm = Number(online.commission || 0);

      let refreshedRatePct = DEFAULT_ACQUIRING_RATE_PCT;
      if (refreshedPosTotal > 0 && refreshedSavedComm > 0) {
        refreshedRatePct = round2((refreshedSavedComm / refreshedPosTotal) * 100);
      }
      setOnlineCommissionRateInput(String(refreshedRatePct));

      const computedComm = refreshedPosTotal > 0 ? Math.round((refreshedPosTotal * refreshedRatePct) / 100) : 0;
      const initialComm = refreshedSavedComm > 0 ? Math.round(refreshedSavedComm) : computedComm;
      setOnlineCommissionInput(initialComm > 0 ? String(initialComm) : '');

      setOnlineComment('');
      setLastUpdatedAt(new Date());
    } catch (e: any) {
      alert(`Не удалось сохранить онлайн-выручку: ${e?.message ?? e}`);
    } finally {
      setOnlineSaving(false);
    }
  }

  /* ====================== render ====================== */

  const currentRatePct =
    onlineCommissionRateInput.trim() !== ''
      ? parsePercent(onlineCommissionRateInput)
      : DEFAULT_ACQUIRING_RATE_PCT;

  return (
    <div className="text-slate-50">
      <div>
        {/* Header (бренд-стандарт) */}
        <div className="mb-6 flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
            <PiggyBank className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-50">
              Сверка недельной выручки
            </div>
            <div className="mt-0.5 text-[12px] text-cyan-300/50">
              Наличные, расходы и онлайн-оплаты по филиалам
            </div>
          </div>
        </div>

        {/* Навигация по неделям */}
        <div className="flex items-center justify-between rounded-2xl bg-white ring-1 ring-sky-100 px-4 py-3 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <button
            onClick={() => setWeekStartDate((prev) => shiftWeeks(prev, -1))}
            className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium text-cyan-700 hover:bg-cyan-50 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Предыдущая
          </button>

          <div className="text-center">
            <div className="text-[13px] font-semibold text-slate-800">{weekLabel}</div>
            <button
              onClick={() => setWeekStartDate(new Date(getWeekStartMonday(new Date())))}
              className="mt-0.5 text-[11px] font-medium text-cyan-600 hover:text-cyan-800 transition-colors"
            >
              Текущая неделя
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setWeekStartDate((prev) => shiftWeeks(prev, +1))}
              className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium text-cyan-700 hover:bg-cyan-50 transition-colors"
            >
              Следующая <ArrowRight className="h-4 w-4" />
            </button>
            <button
              onClick={manualRefresh}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 transition-colors"
              title="Обновить"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Переход на Бюджет расходов */}
        <div className="mt-3">
          <Link
            href="/admin/budget"
            className="group flex items-center gap-4 rounded-2xl px-5 py-4 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] hover:ring-cyan-300/40 transition"
          >
            <div className="h-10 w-10 shrink-0 grid place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.28)]">
              <PiggyBank className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-slate-900">Бюджет расходов</div>
              <div className="mt-0.5 text-[12px] text-slate-500">Планирование и контроль расходов по филиалам</div>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-300 group-hover:text-cyan-500 transition-colors" />
          </Link>
        </div>

        {/* поиск + легенда */}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:w-96">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск филиала…"
              className="w-full rounded-xl bg-white pl-10 pr-4 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 placeholder:text-slate-400"
            />
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          </div>
          <div className="flex items-center gap-3 text-xs">
            <LegendChip color="emerald" label={`Совпадает: ${cashSummary.match}`} />
            <LegendChip color="red" label={`Недостача: ${cashSummary.shortage}`} />
            <LegendChip color="yellow" label={`Переплата: ${cashSummary.overpay}`} />
          </div>
        </div>

        {/* сводка по НАЛИЧНЫМ */}
        <div className="mt-6 rounded-2xl p-5 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] text-slate-900">
          <div className="mb-3 text-sm font-semibold text-slate-800">Наличные по филиалам</div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
            <StatBox
              title="Должно (наличные)"
              value={fmtKGS(cashSummary.should)}
              subtitle="Авансы + доплаты (кэш) с учётом расходов"
            />
            <StatBox title="Факт (наличные)" value={fmtKGS(cashSummary.fact)} />
            <StatBox
              title="Δ Наличные"
              value={fmtKGS(cashSummary.delta)}
              tone={
                cashSummary.delta < -TOLERANCE
                  ? 'bad'
                  : Math.abs(cashSummary.delta) <= TOLERANCE
                  ? 'ok'
                  : 'warn'
              }
            />
            <div>
              <div className="text-sm text-slate-700 mb-2">Совпадение по филиалам</div>
              <div className="h-2 w-full rounded-full bg-slate-200/80 overflow-hidden">
                <div
                  className="h-full bg-cyan-500"
                  style={{ width: `${cashSummary.percent}%` }}
                />
              </div>
              <div className="mt-1 text-right text-[11px] text-slate-500">{cashSummary.percent.toFixed(0)}%</div>
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                <Building2 className="h-3.5 w-3.5" />
                Обновлено: {lastUpdatedAt ? lastUpdatedAt.toLocaleString('ru-RU') : '—'}
              </div>
            </div>
          </div>
        </div>

        {/* блок по РАСХОДАМ (наличные) */}
        <div className="mt-6 rounded-2xl p-5 bg-white ring-1 ring-rose-200 shadow-[0_8px_30px_rgba(15,23,42,0.45)] text-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-rose-100 text-rose-700 ring-1 ring-rose-200">
                <AlertTriangle className="h-4 w-4" />
              </span>
              Расходы по филиалам (наличные)
            </div>
            <div className="text-[11px] text-slate-500">Все расходы, которые уже вычтены из кэша в расчёте «Должно».</div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
            <StatBox
              title="Итого расходы (кэш)"
              value={fmtKGS(expensesSummary.total)}
              subtitle="Все филиалы за выбранную неделю"
              tone={expensesSummary.total > 0 ? 'warn' : 'ok'}
            />
            <div className="sm:col-span-3 flex flex-col gap-2">
              {expensesSummary.list.length === 0 ? (
                <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 px-3 py-2 text-xs text-slate-500">
                  Нет расходов по филиалам за эту неделю.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {expensesSummary.list.map((item) => (
                    <div
                      key={item.branch_id}
                      className="rounded-xl bg-rose-50 ring-1 ring-rose-200 px-3 py-2 flex items-center justify-between text-sm"
                    >
                      <div className="font-medium text-slate-900">{item.branch_name}</div>
                      <div className="font-semibold text-rose-700">{fmtKGS(item.cash_expenses)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* блок по ОНЛАЙН-оплатам (вся сеть) */}
        <div className="mt-6 rounded-2xl p-5 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] text-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-teal-100 text-teal-700 ring-1 ring-teal-200">
                <PiggyBank className="h-4 w-4" />
              </span>
              Онлайн-оплаты (вся сеть)
            </div>
            <div className="text-[11px] text-slate-500">Сводка по онлайн-платежам за выбранную неделю.</div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
            <StatBox
              title="По POS (онлайн)"
              value={fmtKGS(onlineSummary.posTotal)}
              subtitle="Сумма онлайн-платежей в CRM"
            />
            <StatBox
              title="По банку (грязными)"
              value={fmtKGS(onlineSummary.bankIncoming)}
              subtitle="Платежи клиентов по выписке"
            />
            <StatBox
              title="Комиссия банка"
              value={fmtKGS(onlineSummary.bankCommission)}
              subtitle={`Ставка: ${round2(currentRatePct).toString()}% (по умолчанию ${DEFAULT_ACQUIRING_RATE_PCT}%)`}
              tone={onlineSummary.bankCommission > 0 ? 'warn' : undefined}
            />
            <StatBox
              title="Δ POS vs банк"
              value={fmtKGS(onlineSummary.delta)}
              tone={
                Math.abs(onlineSummary.delta) <= TOLERANCE
                  ? 'ok'
                  : onlineSummary.delta < -TOLERANCE
                  ? 'bad'
                  : 'warn'
              }
            />
          </div>

          {/* POS (онлайн) по филиалам */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-800">Оплата по POS терминалам (онлайн) по филиалам</div>
              <div className="text-[11px] text-slate-500">Итого: {fmtKGS(onlinePosByBranch.total)}</div>
            </div>

            {onlinePosByBranch.list.length === 0 ? (
              <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 px-3 py-2 text-xs text-slate-500">
                Нет POS-онлайна по филиалам за эту неделю.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {onlinePosByBranch.list.map((item) => (
                  <div
                    key={item.branch_id}
                    className="rounded-xl bg-sky-50 ring-1 ring-sky-200 px-3 py-2 flex items-center justify-between text-sm"
                  >
                    <div className="font-medium text-slate-900">{item.branch_name}</div>
                    <div className="font-semibold text-slate-900">{fmtKGS(item.pos_amount)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* карточки по филиалам */}
        <div className="mt-7">
          {err && (
            <div className="mb-4 rounded-xl bg-rose-50 text-rose-800 ring-1 ring-rose-200 px-4 py-3">
              {err}
            </div>
          )}
          {loading && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          )}
          {!loading && filtered.length === 0 && <EmptyState />}
          {!loading && filtered.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filtered.map((r) => (
                <BranchCard
                  key={r.branch_id}
                  row={r}
                  canFix={owner}
                  lastFixedAt={lastFixedAt[r.branch_id]}
                  onSave={saveManual}
                  onFix={fixTransfer}
                  onHistory={(id, name) => openHistory(id, name)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Онлайн-оплаты за неделю */}
        {onlineRow && (
          <div className="mt-10">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100">
              <PiggyBank className="h-4 w-4 text-cyan-300" />
              Онлайн-оплаты за неделю
            </h2>
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
            />
          </div>
        )}

        {/* Переплаты */}
        {!loading && cashSummary.overList.length > 0 && (
          <div className="mt-10">
            <div className="mb-3 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              <div className="text-sm text-slate-100">
                Переплаты (наличные) • всего {cashSummary.overList.length} • сумма {fmtKGS(cashSummary.overpayTotal)}
              </div>
            </div>
            <div className="rounded-2xl ring-1 ring-amber-200 bg-white p-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
              {cashSummary.overList.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2 flex items-center justify-between text-sm"
                >
                  <div className="font-medium text-slate-900">{item.name}</div>
                  <div className="font-semibold text-amber-700">{fmtKGS(item.delta)}</div>
                </div>
              ))}
            </div>
          </div>
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
        'inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white ' +
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
        'inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ' +
        'ring-1 ring-slate-200 transition hover:bg-slate-50 ' +
        'disabled:opacity-50 disabled:cursor-not-allowed ' +
        className
      }
    >
      {children}
    </button>
  );
}

function LegendChip({ color, label }: { color: 'emerald' | 'red' | 'yellow'; label: string }) {
  const map = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    red: 'bg-red-50 text-red-700 ring-red-200',
    yellow: 'bg-amber-50 text-amber-700 ring-amber-200',
  } as const;
  const icon =
    color === 'emerald' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />;
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 ring-1 ${map[color]}`}>
      {icon}
      {label}
    </span>
  );
}

function StatBox({
  title,
  value,
  subtitle,
  tone,
}: {
  title: string;
  value: string;
  subtitle?: string;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  const ring =
    tone === 'bad'
      ? 'ring-rose-200'
      : tone === 'warn'
      ? 'ring-amber-200'
      : tone === 'ok'
      ? 'ring-emerald-200'
      : 'ring-sky-100';

  return (
    <div className={`rounded-2xl p-4 bg-white ring-1 ${ring} shadow-[0_8px_30px_rgba(15,23,42,0.45)]`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
      {subtitle && <div className="mt-1 text-[11px] text-slate-500">{subtitle}</div>}
    </div>
  );
}

function BranchCard({
  row,
  canFix,
  lastFixedAt,
  onSave,
  onFix,
  onHistory,
}: {
  row: RecoRow;
  canFix: boolean;
  lastFixedAt?: string;
  onSave: (branchId: number, amountInput: string, comment?: string) => Promise<void>;
  onFix: (branchId: number, comment?: string) => Promise<void>;
  onHistory: (branchId: number, branchName: string) => void;
}) {
  const [input, setInput] = useState(row.manual_amount > 0 ? String(Math.round(row.manual_amount)) : '');
  const [comment, setComment] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [fixing, setFixing] = useState(false);

  const percent =
    row.expected_amount > 0
      ? Math.min(100, Math.max(0, (row.manual_amount / row.expected_amount) * 100))
      : 0;

  const theme =
    {
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
    try {
      setSaving(true);
      await onSave(row.branch_id, input, comment);
    } finally {
      setSaving(false);
    }
  }

  async function handleFix() {
    try {
      setFixing(true);
      await onFix(row.branch_id, comment);
    } finally {
      setFixing(false);
    }
  }

  return (
    <div className="rounded-2xl p-5 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] text-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="font-semibold text-slate-900">{row.branch_name}</div>
        <div className="flex items-center gap-2">
          {lastFixedAt && (
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              <History className="h-3.5 w-3.5" />
              {new Date(lastFixedAt).toLocaleString('ru-RU')}
            </span>
          )}
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ring-1 ${theme.chip}`}>
            {theme.icon}
            {theme.label}
          </span>
        </div>
      </div>

      {/* Numbers */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <MiniKV k="Должно (кэш)" v={fmtKGS(row.expected_amount)} />
        <MiniKV k="Факт (кэш)" v={fmtKGS(row.manual_amount)} />
        <MiniKV
          k="Δ"
          v={fmtKGS(row.diff)}
          className={
            row.status === 'shortage' ? 'text-red-600' : row.status === 'overpay' ? 'text-amber-600' : 'text-slate-900'
          }
        />
      </div>

      {/* Progress */}
      <div className="mt-3">
        <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full bg-cyan-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="mt-1 text-right text-[11px] text-slate-500">{percent.toFixed(0)}%</div>
      </div>

      {/* Inputs */}
      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Факт, сом (наличные)"
            inputMode="numeric"
            className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 placeholder:text-slate-400"
          />
          <SoftPrimaryBtn onClick={handleSave} disabled={saving}>
            {saving ? 'Сохраняю…' : 'Сохранить'}
          </SoftPrimaryBtn>
        </div>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Комментарий"
          rows={2}
          className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 placeholder:text-slate-400"
        />
      </div>

      {/* Actions */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <SoftPrimaryBtn onClick={handleFix} disabled={!canFix || fixing} title={canFix ? '' : 'Доступ только владельцу'}>
          {fixing ? 'Фиксирую…' : 'Зафиксировать'}
        </SoftPrimaryBtn>
        <SoftGhostBtn onClick={() => onHistory(row.branch_id, row.branch_name)}>
          <History className="h-4 w-4" /> История
        </SoftGhostBtn>
      </div>
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
}) {
  const percent =
    row.expected_amount > 0
      ? Math.min(100, Math.max(0, (row.manual_amount / row.expected_amount) * 100))
      : 0;

  const theme =
    {
      match: { chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'Совпадает' },
      shortage: { chip: 'bg-rose-50 text-rose-700 ring-rose-200', label: 'Недостача' },
      overpay: { chip: 'bg-amber-50 text-amber-700 ring-amber-200', label: 'Переплата' },
    }[row.status] || { chip: 'bg-slate-100 text-slate-700 ring-slate-200', label: '—' };

  const ratePct =
    inputCommissionRate.trim() !== '' ? parsePercent(inputCommissionRate) : DEFAULT_ACQUIRING_RATE_PCT;

  const expectedCommissionHint =
    row.expected_amount > 0 ? fmtKGS((row.expected_amount * ratePct) / 100) : fmtKGS(0);

  return (
    <div className="rounded-2xl p-5 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] text-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">Онлайн-оплаты (все филиалы)</div>
          <div className="mt-1 text-[11px] text-slate-500">
            Неделя: {row.week_start} — {row.week_end}
          </div>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ring-1 ${theme.chip}`}>
          {theme.label}
        </span>
      </div>

      {/* Numbers */}
      <div className="mt-4 grid grid-cols-4 gap-3">
        <MiniKV k="Должно по POS" v={fmtKGS(row.expected_amount)} />
        <MiniKV k="Факт по банку" v={fmtKGS(row.manual_amount)} />
        <MiniKV k="Комиссия" v={fmtKGS(row.commission)} />
        <MiniKV
          k="Δ (грязная)"
          v={fmtKGS(row.diff)}
          className={
            row.status === 'shortage' ? 'text-red-600' : row.status === 'overpay' ? 'text-amber-600' : 'text-slate-900'
          }
        />
      </div>

      {/* Progress */}
      <div className="mt-3">
        <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full bg-cyan-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="mt-1 text-right text-[11px] text-slate-500">{percent.toFixed(0)}%</div>
      </div>

      {/* Inputs */}
      <div className="mt-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Факт по банку, сом</div>
            <input
              value={inputAmount}
              onChange={(e) => onChangeAmount(e.target.value)}
              placeholder="Сколько реально пришло на счёт"
              inputMode="numeric"
              className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 placeholder:text-slate-400"
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
                  className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 placeholder:text-slate-400"
                />
              </div>

              <div className="flex-1">
                <div className="text-[10px] text-slate-500 mb-1">Сумма, сом</div>
                <input
                  value={inputCommission}
                  onChange={(e) => onChangeCommission(e.target.value)}
                  placeholder="Авто от ставки"
                  inputMode="numeric"
                  className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 placeholder:text-slate-400"
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
            className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 flex justify-end">
        <SoftPrimaryBtn onClick={onSave} disabled={saving}>
          {saving ? 'Сохраняю…' : 'Сохранить онлайн-выручку'}
        </SoftPrimaryBtn>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-10 text-center text-slate-500 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
      Нет филиалов по фильтру.
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
        className="relative w-full max-w-2xl rounded-3xl bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.4)] ring-1 ring-sky-100"
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
