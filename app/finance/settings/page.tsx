// app/finance/settings/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Coins,
  Factory,
  Loader2,
  Pencil,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react';

/* ============ Типы ============ */

type OpexDailyRate = {
  id: number;
  branch_id: number;
  category: string;
  daily_rate: number;
  is_active: boolean;
};

type CogsRate = {
  id: number;
  branch_id: number;
  item: string;
  amount_per_order: number;
  is_active: boolean;
};

/* ============ Константы/утилы ============ */

const BRANCHES = [
  { id: 0, name: 'Общие' },
  { id: 1, name: 'Сокулук' },
  { id: 2, name: 'Беловодск' },
  { id: 3, name: 'Кара-Балта' },
  { id: 4, name: 'Кант' },
];

function fmt(n: number) {
  try {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(
      Number(n || 0),
    );
  } catch {
    return String(n ?? 0);
  }
}

function fmtKGS(n: number) {
  try {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'KGS',
      maximumFractionDigits: 0,
    }).format(Math.round(Number(n || 0)));
  } catch {
    return `${fmt(n)} KGS`;
  }
}

/* ====== малые компоненты UI ====== */

function SectionCard({
  title,
  icon: Icon,
  children,
  action,
  subtitle,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  action?: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <section className="rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/85 ring-1 ring-sky-100/90 shadow-[0_22px_65px_rgba(15,23,42,0.35)] backdrop-blur-xl">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-sky-500/10 text-sky-600 ring-1 ring-sky-200">
              <Icon className="h-4 w-4" />
            </span>
            <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
          </div>
          {subtitle && (
            <p className="pl-10 text-xs text-slate-500">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

function ToolbarButton({
  children,
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost';
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        'inline-flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-sm transition shadow-[0_10px_30px_rgba(15,23,42,0.18)]',
        variant === 'primary'
          ? 'bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 text-white hover:from-teal-300 hover:via-cyan-300 hover:to-sky-300 disabled:opacity-50'
          : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function IconLinkButton({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-1.5 text-sm text-slate-800 ring-1 ring-slate-200 shadow-[0_10px_30px_rgba(15,23,42,0.18)] hover:bg-slate-50"
    >
      {children}
    </Link>
  );
}

function ActionIcon({
  title,
  onClick,
  disabled,
  children,
  color = 'text-slate-700 hover:text-slate-900',
}: {
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm ${color} disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function SummaryTile({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-sky-50 via-white to-slate-50 ring-1 ring-sky-100 shadow-[0_18px_40px_rgba(15,23,42,0.18)] px-4 py-4">
      <div className="text-xs font-medium text-slate-600">{title}</div>
      <div className="mt-1 text-[20px] font-semibold text-slate-900">
        {value}
      </div>
      {subtitle && (
        <div className="mt-1 text-[11px] text-slate-500">{subtitle}</div>
      )}
    </div>
  );
}

/* ============ Страница ============ */

export default function FinanceSettingsPage() {
  const search = useSearchParams();
  const router = useRouter();

  // ветка по умолчанию: из query ?branch=, иначе 1
  const initialBranch = Number(search.get('branch') ?? '1') || 1;
  const [branchId, setBranchId] = useState<number>(initialBranch);

  const editingAllowed = branchId > 0;

  // данные ставок
  const [opexRates, setOpexRates] = useState<OpexDailyRate[]>([]);
  const [cogsRates, setCogsRates] = useState<CogsRate[]>([]);

  // превью фактических данных
  const [ordersCountMonth, setOrdersCountMonth] = useState<number | null>(null);
  const [payrollNetMonth, setPayrollNetMonth] = useState<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // для ссылки назад
  const monthStr = useMemo(() => dayjs().format('YYYY-MM'), []);
  const monthLabel = useMemo(() => dayjs().format('MMMM YYYY'), []);

  const branchName = useMemo(
    () => BRANCHES.find((b) => b.id === branchId)?.name ?? '—',
    [branchId],
  );

  useEffect(() => {
    const params = new URLSearchParams(search.toString());
    params.set('branch', String(branchId));
    router.replace(`/finance/settings?${params.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  async function loadAll() {
    try {
      setLoading(true);
      setErr(null);

      const sb = getBrowserSupabase();

      /* ----- загрузка ставок ----- */

      // opex
      let q1 = sb
        .from('opex_daily_rates')
        .select('*')
        .order('category', { ascending: true });
      if (branchId > 0) q1 = q1.eq('branch_id', branchId);
      const { data: opex, error: e1 } = await q1.returns<OpexDailyRate[]>();
      if (e1) throw e1;

      // cogs
      let q2 = sb
        .from('cogs_per_order_rates')
        .select('*')
        .order('item', { ascending: true });
      if (branchId > 0) q2 = q2.eq('branch_id', branchId);
      const { data: cogs, error: e2 } = await q2.returns<CogsRate[]>();
      if (e2) throw e2;

      setOpexRates(opex ?? []);
      setCogsRates(cogs ?? []);

      /* ----- превью: заказы и факт-ЗП за текущий месяц ----- */

      const monthStart = dayjs().startOf('month').format('YYYY-MM-DD');
      const monthEndExclusive = dayjs()
        .endOf('month')
        .add(1, 'day')
        .format('YYYY-MM-DD');

      // заказы — из base-таблицы orders
      {
        let qOrders = sb
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', monthStart)
          .lt('created_at', monthEndExclusive)
          .eq('is_deleted', false);

        if (branchId > 0) {
          qOrders = qOrders.eq('branch_id', branchId);
        }

        const { count, error: eOrders } = await qOrders;
        if (eOrders) throw eOrders;
        setOrdersCountMonth(count ?? 0);
      }

      // зарплата — из v_payroll_monthly_ui (net по сотрудникам)
      {
        const monthDate = dayjs().startOf('month').format('YYYY-MM-01');

        let qPayroll = sb
          .from('v_payroll_monthly_ui')
          .select('net')
          .eq('month', monthDate);

        if (branchId > 0) {
          qPayroll = qPayroll.eq('branch_id', branchId);
        }

        const { data: payRows, error: ePay } = await qPayroll;
        if (ePay) throw ePay;

        const totalNet =
          (payRows ?? []).reduce(
            (acc: number, row: any) => acc + Number(row.net || 0),
            0,
          ) || 0;

        setPayrollNetMonth(totalNet);
      }
    } catch (e: any) {
      console.error(e);
      setErr(e?.message ?? 'Ошибка загрузки');
      setOpexRates([]);
      setCogsRates([]);
      setOrdersCountMonth(null);
      setPayrollNetMonth(null);
    } finally {
      setLoading(false);
    }
  }

  /* ======= агрегаты по расходам / себестоимости ======= */

  const summary = useMemo(() => {
    const activeOpex = opexRates.filter((r) => r.is_active);
    const activeCogs = cogsRates.filter((r) => r.is_active);

    const opexDaily = activeOpex.reduce((acc, r) => acc + (r.daily_rate || 0), 0);
    const cogsPerOrder = activeCogs.reduce(
      (acc, r) => acc + (r.amount_per_order || 0),
      0,
    );

    const fixedDailyTotal = opexDaily; // сейчас фикс-расходы = только OPEX

    return {
      opexDaily,
      cogsPerOrder,
      fixedDailyTotal,
    };
  }, [opexRates, cogsRates]);

  /* ------- CRUD: OPEX ------- */

  async function addOpexRow() {
    if (!editingAllowed) return;
    const category = prompt('Категория (например: Аренда)');
    if (!category) return;
    const rateStr = prompt('Ставка в день (число)');
    const daily = Number(rateStr);
    if (!Number.isFinite(daily)) return alert('Нужно число');

    const sb = getBrowserSupabase();
    const { error } = await sb.from('opex_daily_rates').insert({
      branch_id: branchId,
      category,
      daily_rate: daily,
      is_active: true,
    });
    if (error) return alert(error.message);
    await loadAll();
  }

  async function updateOpexRow(row: OpexDailyRate, patch: Partial<OpexDailyRate>) {
    if (!editingAllowed) return;
    const sb = getBrowserSupabase();
    const { error } = await sb.from('opex_daily_rates').update(patch).eq('id', row.id);
    if (error) return alert(error.message);
    await loadAll();
  }

  async function deleteOpexRow(id: number) {
    if (!editingAllowed) return;
    if (!confirm('Удалить запись OPEX?')) return;
    const sb = getBrowserSupabase();
    const { error } = await sb.from('opex_daily_rates').delete().eq('id', id);
    if (error) return alert(error.message);
    await loadAll();
  }

  /* ------- CRUD: COGS ------- */

  async function addCogsRow() {
    if (!editingAllowed) return;
    const item = prompt('Позиция (например: Себест. оправ)');
    if (!item) return;
    const amtStr = prompt('Сумма на 1 заказ (число)');
    const amt = Number(amtStr);
    if (!Number.isFinite(amt)) return alert('Нужно число');

    const sb = getBrowserSupabase();
    const { error } = await sb.from('cogs_per_order_rates').insert({
      branch_id: branchId,
      item,
      amount_per_order: amt,
      is_active: true,
    });
    if (error) return alert(error.message);
    await loadAll();
  }

  async function updateCogsRow(row: CogsRate, patch: Partial<CogsRate>) {
    if (!editingAllowed) return;
    const sb = getBrowserSupabase();
    const { error } = await sb
      .from('cogs_per_order_rates')
      .update(patch)
      .eq('id', row.id);
    if (error) return alert(error.message);
    await loadAll();
  }

  async function deleteCogsRow(id: number) {
    if (!editingAllowed) return;
    if (!confirm('Удалить запись COGS?')) return;
    const sb = getBrowserSupabase();
    const { error } = await sb.from('cogs_per_order_rates').delete().eq('id', id);
    if (error) return alert(error.message);
    await loadAll();
  }

  /* ------- Render ------- */

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-6xl px-4 pt-8 pb-10 space-y-6">
        {/* Header в белой плитке */}
        <div className="rounded-3xl border border-slate-100 bg-white/95 shadow-[0_18px_45px_rgba(15,23,42,0.18)] px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_0_25px_rgba(56,189,248,0.55)]">
                <Settings2 className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-[26px] sm:text-[30px] font-semibold leading-tight">
                  Финансовые ставки филиала
                </h1>
                <div className="mt-1 text-sm text-slate-500">
                  Филиал:{' '}
                  <span className="font-medium text-sky-700">{branchName}</span>{' '}
                  • настройки OPEX и себестоимости для расчёта чистой прибыли.
                </div>
              </div>
            </div>

            <IconLinkButton href={`/finance/overview?month=${monthStr}&branch=${branchId}`}>
              <ArrowLeft className="h-4 w-4" />
              Назад к финансам
            </IconLinkButton>
          </div>
        </div>

        {/* Toolbar (филиал + статус редактирования) */}
        <div className="rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/85 ring-1 ring-sky-100 px-4 py-3 sm:px-5 sm:py-4 shadow-[0_18px_45px_rgba(15,23,42,0.18)] flex flex-wrap items-center gap-4">
          <div className="flex flex-col">
            <label className="text-xs font-medium text-slate-600">Филиал</label>
            <div className="relative mt-1">
              <select
                className="peer w-56 appearance-none rounded-xl border border-slate-300 bg-white px-3 py-2 pr-8 text-sm text-slate-900 shadow-[0_10px_25px_rgba(15,23,42,0.12)] outline-none transition focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/60"
                value={branchId}
                onChange={(e) => setBranchId(Number(e.target.value))}
              >
                {BRANCHES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <Building2 className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            </div>
          </div>

          {loading && (
            <div className="inline-flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
            </div>
          )}
          {err && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm text-rose-700 shadow-[0_12px_25px_rgba(127,29,29,0.18)]">
              {err}
            </div>
          )}

          <div className="flex-1" />

          <span
            className={[
              'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs shadow-[0_10px_25px_rgba(15,23,42,0.18)]',
              editingAllowed
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
            ].join(' ')}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {branchId === 0
              ? 'Режим просмотра: все филиалы'
              : 'Редактирование включено'}
          </span>
        </div>

        {/* Сводка по расходам и себестоимости */}
        <div className="rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/85 ring-1 ring-sky-100 shadow-[0_22px_45px_rgба(15,23,42,0.2)] backdrop-blur-xl px-5 py-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-teal-100 text-teal-700 ring-1 ring-teal-200">
                <Settings2 className="h-4 w-4" />
              </span>
              Сводка по расходам и себестоимости
            </div>
            <div className="text-[11px] text-slate-500 max-w-xs text-right">
              Значения считаются по активным ставкам выбранного филиала и
              используются в расчётах чистой прибыли.
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <SummaryTile
              title="Итого фикс-расходы / день"
              value={fmtKGS(summary.fixedDailyTotal)}
              subtitle="Сейчас фикс-расходы = дневной OPEX филиала"
            />
            <SummaryTile
              title="OPEX / день"
              value={fmtKGS(summary.opexDaily)}
              subtitle="Аренда, салфетки и прочие дневные расходы"
            />
            <SummaryTile
              title="Себестоимость / заказ"
              value={fmtKGS(summary.cogsPerOrder)}
              subtitle="COGS: оправы, линзы, расходники, упаковка и т.д."
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 text-[11px] text-slate-600 md:grid-cols-2">
            <div>
              <span className="font-semibold">Заказы за {monthLabel}:</span>{' '}
              {ordersCountMonth == null ? '—' : fmt(ordersCountMonth)} шт.
              <span className="ml-1 text-slate-500">
                (по таблице <code>orders</code>, без удалённых)
              </span>
            </div>
            <div className="md:text-right">
              <span className="font-semibold">
                Фактическая зарплата за {monthLabel}:
              </span>{' '}
              {payrollNetMonth == null ? '—' : fmtKGS(payrollNetMonth)}
              <span className="ml-1 text-slate-500">
                (по вьюхе <code>v_payroll_monthly_ui</code>)
              </span>
            </div>
          </div>
        </div>

        {/* OPEX daily */}
        <SectionCard
          title="Дневные фикс-расходы (OPEX)"
          icon={Factory}
          subtitle="Все регулярные расходы, которые вы несёте каждый рабочий день: аренда, салфетки, интернет и т.п."
          action={
            <ToolbarButton onClick={addOpexRow} disabled={!editingAllowed}>
              <Plus className="h-4 w-4" />
              Добавить расход
            </ToolbarButton>
          }
        >
          <div className="overflow-hidden rounded-xl ring-1 ring-slate-200/80 bg-white/90">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Категория</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Ставка/день
                  </th>
                  <th className="px-3 py-2 text-center font-medium">Активна</th>
                  <th className="px-3 py-2 text-center font-medium w-40">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody>
                {opexRates.length === 0 && (
                  <tr>
                    <td
                      className="px-3 py-3 text-center text-slate-500"
                      colSpan={4}
                    >
                      Пока нет фикс-расходов для этого филиала.
                    </td>
                  </tr>
                )}
                {opexRates.map((row) => (
                  <tr
                    key={row.id}
                    className="odd:bg-white even:bg-slate-50/60 text-slate-800"
                  >
                    <td className="px-3 py-2">{row.category}</td>
                    <td className="px-3 py-2 text-right">
                      {fmtKGS(row.daily_rate)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        disabled={!editingAllowed}
                        checked={row.is_active}
                        onChange={(e) =>
                          updateOpexRow(row, { is_active: e.target.checked })
                        }
                        className="h-4 w-4 accent-teal-500"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <ActionIcon
                        title="Изменить ставку"
                        disabled={!editingAllowed}
                        onClick={async () => {
                          const v = prompt(
                            'Новая ставка/день',
                            String(row.daily_rate),
                          );
                          if (v == null) return;
                          const n = Number(v);
                          if (!Number.isFinite(n)) return alert('Нужно число');
                          await updateOpexRow(row, { daily_rate: n });
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                        Изм.
                      </ActionIcon>
                      <ActionIcon
                        title="Удалить"
                        disabled={!editingAllowed}
                        onClick={() => deleteOpexRow(row.id)}
                        color="text-rose-600 hover:text-rose-700"
                      >
                        <Trash2 className="h-4 w-4" />
                        Удалить
                      </ActionIcon>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {/* COGS */}
        <SectionCard
          title="Себестоимость на 1 заказ (COGS)"
          icon={Coins}
          subtitle="Сколько в среднем стоит один заказ: оправы, линзы, расходники, упаковка и т.д."
          action={
            <ToolbarButton onClick={addCogsRow} disabled={!editingAllowed}>
              <Plus className="h-4 w-4" />
              Добавить позицию
            </ToolbarButton>
          }
        >
          <div className="overflow-hidden rounded-xl ring-1 ring-slate-200/80 bg-white/90">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Позиция</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Сумма/заказ
                  </th>
                  <th className="px-3 py-2 text-center font-medium">Активна</th>
                  <th className="px-3 py-2 text-center font-medium w-40">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody>
                {cogsRates.length === 0 && (
                  <tr>
                    <td
                      className="px-3 py-3 text-center text-slate-500"
                      colSpan={4}
                    >
                      Пока нет настроенных позиций себестоимости.
                    </td>
                  </tr>
                )}
                {cogsRates.map((row) => (
                  <tr
                    key={row.id}
                    className="odd:bg-white even:bg-slate-50/60 text-slate-800"
                  >
                    <td className="px-3 py-2">{row.item}</td>
                    <td className="px-3 py-2 text-right">
                      {fmtKGS(row.amount_per_order)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        disabled={!editingAllowed}
                        checked={row.is_active}
                        onChange={(e) =>
                          updateCogsRow(row, { is_active: e.target.checked })
                        }
                        className="h-4 w-4 accent-teal-500"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <ActionIcon
                        title="Изменить"
                        disabled={!editingAllowed}
                        onClick={async () => {
                          const v = prompt(
                            'Новая сумма/заказ',
                            String(row.amount_per_order),
                          );
                          if (v == null) return;
                          const n = Number(v);
                          if (!Number.isFinite(n)) return alert('Нужно число');
                          await updateCogsRow(row, { amount_per_order: n });
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                        Изм.
                      </ActionIcon>
                      <ActionIcon
                        title="Удалить"
                        disabled={!editingAllowed}
                        onClick={() => deleteCogsRow(row.id)}
                        color="text-rose-600 hover:text-rose-700"
                      >
                        <Trash2 className="h-4 w-4" />
                        Удалить
                      </ActionIcon>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
