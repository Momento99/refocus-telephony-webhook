'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  RefreshCw,
  PiggyBank,
  TrendingUp,
  Glasses,
  Sparkles,
  Building2,
  Banknote,
  Home,
} from 'lucide-react';

type LensBranchRow = {
  branch_id: number;
  branch_name: string;
  planned_lenses_per_month: number | null;
  monthly_budget_kgs: number | null;
  assumed_from_branch: string | null;
};

type LensTotalRow = {
  planned_lenses_network: number | null;
  monthly_budget_network_kgs: number | null;
};

type FrameBranchRow = {
  branch_id: number;
  branch_name: string;
  planned_frames_per_month: number | null;
  monthly_budget_kgs: number | null;
  unit_cost_kgs: number | null;
  assumed_from_branch: string | null;
};

type FrameTotalRow = {
  planned_frames_network: number | null;
  monthly_budget_network_kgs: number | null;
  unit_cost_kgs: number | null;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
);

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

function normName(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[–—]/g, '-');
}

function getBishkekYMD() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bishkek',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return {
    y: Number(get('year')),
    m: Number(get('month')), // 1..12
    d: Number(get('day')), // 1..31
  };
}

function daysInMonthUTC(year: number, month1to12: number) {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function SoftPrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = '', ...rest } = props;
  return (
    <button
      {...rest}
      className={[
        'inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white',
        'shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400',
        'focus:outline-none focus:ring-2 focus:ring-cyan-300/70',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      ].join(' ')}
    />
  );
}

function SoftGhostButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = '', ...rest } = props;
  return (
    <button
      {...rest}
      className={[
        'inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-slate-700',
        'ring-1 ring-slate-200 transition hover:bg-slate-50',
        'focus:outline-none focus:ring-2 focus:ring-cyan-300/70',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      ].join(' ')}
    />
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="mt-3">
      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-2 rounded-full bg-cyan-500 transition-all"
          style={{ width: `${p}%` }}
        />
      </div>
      <div className="mt-1 text-right text-[11px] text-slate-500">{nf2.format(p)}%</div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl p-5 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] animate-pulse">
      <div className="h-4 w-44 bg-slate-200 rounded" />
      <div className="mt-4 h-10 w-56 bg-slate-200 rounded" />
      <div className="mt-3 h-3 w-64 bg-slate-200 rounded" />
      <div className="mt-2 h-3 w-52 bg-slate-200 rounded" />
      <div className="mt-4 h-2 w-full bg-slate-200 rounded-full" />
    </div>
  );
}

function NowCard({
  title,
  icon,
  monthly,
  plannedUnitsText,
  unitText,
  day,
  daysInMonth,
  accent = 'sky',
  note,
}: {
  title: string;
  icon: React.ReactNode;
  monthly: number;
  plannedUnitsText?: string;
  unitText?: string;
  day: number;
  daysInMonth: number;
  accent?: 'sky' | 'emerald';
  note?: string;
}) {
  const daily = monthly / Math.max(1, daysInMonth);
  const shouldHaveToday = daily * Math.max(1, day); // включительно
  const remain = Math.max(0, monthly - shouldHaveToday);
  const pct = (day / Math.max(1, daysInMonth)) * 100;

  const ring = accent === 'emerald' ? 'ring-emerald-200' : 'ring-sky-100';

  return (
    <div
      className={[
        'rounded-2xl p-5 bg-white',
        'ring-1',
        ring,
        'shadow-[0_8px_30px_rgba(15,23,42,0.45)]',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.28)]">
            <div className="text-white">{icon}</div>
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-slate-900">{title}</div>
            <div className="mt-0.5 text-[11px] text-slate-600">
              {plannedUnitsText ? <span className="font-medium text-slate-900">{plannedUnitsText}</span> : null}
              {plannedUnitsText && unitText ? <span className="mx-2 text-slate-400">•</span> : null}
              {unitText ? <span>{unitText}</span> : null}
              {note ? (
                <>
                  <span className="mx-2 text-slate-400">•</span>
                  <span className="text-slate-500">{note}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="text-[11px] text-slate-500 text-right">
          День <span className="font-medium text-slate-900">{day}</span> / {daysInMonth}
        </div>
      </div>

      <div className="mt-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Сегодня должно быть отложено</div>
        <div className="mt-1 text-3xl font-bold text-slate-900">
          {nf0.format(Math.round(shouldHaveToday))} сом
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-slate-50/60 ring-1 ring-sky-100 px-3 py-2">
            <div className="text-[11px] text-slate-500">В месяц</div>
            <div className="mt-0.5 text-[13px] font-semibold text-slate-900">{nf0.format(Math.round(monthly))} сом</div>
          </div>
          <div className="rounded-xl bg-slate-50/60 ring-1 ring-sky-100 px-3 py-2">
            <div className="text-[11px] text-slate-500">В день</div>
            <div className="mt-0.5 text-[13px] font-semibold text-slate-900">{nf0.format(Math.round(daily))} сом</div>
          </div>
          <div className="rounded-xl bg-slate-50/60 ring-1 ring-sky-100 px-3 py-2">
            <div className="text-[11px] text-slate-500">Осталось до конца месяца</div>
            <div className="mt-0.5 text-[13px] font-semibold text-slate-900">{nf0.format(Math.round(remain))} сом</div>
          </div>
        </div>

        <ProgressBar pct={pct} />
      </div>
    </div>
  );
}

function SectionShell({
  title,
  icon,
  subtitle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6 rounded-2xl p-5 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-50 ring-1 ring-cyan-200">
            {icon}
          </div>
          <div className="text-sm font-semibold text-slate-900">{title}</div>
        </div>
        <div className="text-[11px] text-slate-500">{subtitle ?? '—'}</div>
      </div>

      {children}
    </div>
  );
}

function MiniLine({
  label,
  today,
  daily,
  monthly,
  icon,
  tone = 'sky',
  note,
}: {
  label: string;
  today: number;
  daily: number;
  monthly: number;
  icon: React.ReactNode;
  tone?: 'sky' | 'emerald' | 'amber';
  note?: string;
}) {
  const toneCls =
    tone === 'emerald'
      ? 'ring-emerald-200 bg-emerald-50/40'
      : tone === 'amber'
        ? 'ring-amber-200 bg-amber-50/40'
        : 'ring-sky-100 bg-slate-50/60';

  return (
    <div className={['rounded-xl px-3 py-2 ring-1', toneCls].join(' ')}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-slate-700">{icon}</span>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-slate-900 truncate">{label}</div>
            {note ? <div className="text-[10px] text-slate-500 truncate">{note}</div> : null}
          </div>
        </div>

        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">на сегодня</div>
          <div className="text-[14px] font-semibold text-slate-900">{nf0.format(Math.round(today))}</div>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
        <div className="rounded-lg bg-white ring-1 ring-slate-200 px-2 py-1 flex items-center justify-between">
          <span>в день</span>
          <span className="font-semibold text-slate-900">{nf0.format(Math.round(daily))}</span>
        </div>
        <div className="rounded-lg bg-white ring-1 ring-slate-200 px-2 py-1 flex items-center justify-between">
          <span>в месяц</span>
          <span className="font-semibold text-slate-900">{nf0.format(Math.round(monthly))}</span>
        </div>
      </div>
    </div>
  );
}

export default function BudgetPage() {
  const [lensRows, setLensRows] = useState<LensBranchRow[]>([]);
  const [lensTotal, setLensTotal] = useState<LensTotalRow | null>(null);

  const [frameRows, setFrameRows] = useState<FrameBranchRow[]>([]);
  const [frameTotal, setFrameTotal] = useState<FrameTotalRow | null>(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const allowKeys = useMemo(
    () =>
      new Set([
        normName('Кант'),
        normName('Кара-Балта'),
        normName('Сокулук'),
        normName('Беловодск'),
        normName('Токмок'),
      ]),
    []
  );

  // Аренда (сом/мес по филиалам) + кредит (сом/мес)
  const rentByBranch = useMemo(
    () => [
      { name: 'Сокулук', monthly: 15000 },
      { name: 'Беловодск', monthly: 13000 },
      { name: 'Кара-Балта', monthly: 35000 },
      { name: 'Кант', monthly: 30000 },
      { name: 'Токмок', monthly: 50000 },
    ],
    []
  );
  const creditMonthly = 58000;

  const { y, m, d } = useMemo(() => getBishkekYMD(), []);
  const dim = useMemo(() => daysInMonthUTC(y, m), [y, m]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);

    const [a, b, c, d2] = await Promise.all([
      supabase
        .from('v_lens_budget_plan_monthly')
        .select('branch_id,branch_name,planned_lenses_per_month,monthly_budget_kgs,assumed_from_branch')
        .order('branch_name', { ascending: true }),
      supabase
        .from('v_lens_budget_plan_monthly_total')
        .select('planned_lenses_network,monthly_budget_network_kgs')
        .maybeSingle(),
      supabase
        .from('v_frame_budget_plan_monthly')
        .select('branch_id,branch_name,planned_frames_per_month,monthly_budget_kgs,unit_cost_kgs,assumed_from_branch')
        .order('branch_name', { ascending: true }),
      supabase
        .from('v_frame_budget_plan_monthly_total')
        .select('planned_frames_network,monthly_budget_network_kgs,unit_cost_kgs')
        .maybeSingle(),
    ]);

    if (a.error || b.error || c.error || d2.error) {
      const msg =
        a.error?.message ||
        b.error?.message ||
        c.error?.message ||
        d2.error?.message ||
        'Unknown error';
      setErr(msg);
      setLensRows([]);
      setLensTotal(null);
      setFrameRows([]);
      setFrameTotal(null);
      setLoading(false);
      return;
    }

    const lensFiltered = (a.data ?? []).filter((r: any) => allowKeys.has(normName(r.branch_name)));
    const frameFiltered = (c.data ?? []).filter((r: any) => allowKeys.has(normName(r.branch_name)));

    setLensRows(lensFiltered as LensBranchRow[]);
    setLensTotal((b.data ?? null) as LensTotalRow | null);
    setFrameRows(frameFiltered as FrameBranchRow[]);
    setFrameTotal((d2.data ?? null) as FrameTotalRow | null);

    setLoading(false);
  }, [allowKeys]);

  useEffect(() => {
    void load();
  }, [load]);

  const rentMonthlyTotal = useMemo(() => rentByBranch.reduce((s, x) => s + x.monthly, 0), [rentByBranch]);

  const lensMonthly = Number(lensTotal?.monthly_budget_network_kgs ?? 0);
  const frameMonthly = Number(frameTotal?.monthly_budget_network_kgs ?? 0);
  const overallMonthly = lensMonthly + frameMonthly + rentMonthlyTotal + creditMonthly;

  const overallDaily = overallMonthly / Math.max(1, dim);
  const overallToday = overallDaily * Math.max(1, d);

  // Словари по филиалам
  const lensMap = useMemo(() => {
    const m = new Map<string, { monthly: number; planned: number; assumed?: string | null }>();
    for (const r of lensRows) {
      m.set(normName(r.branch_name), {
        monthly: Number(r.monthly_budget_kgs ?? 0),
        planned: Number(r.planned_lenses_per_month ?? 0),
        assumed: r.assumed_from_branch ?? null,
      });
    }
    return m;
  }, [lensRows]);

  const frameMap = useMemo(() => {
    const m = new Map<string, { monthly: number; planned: number; assumed?: string | null }>();
    for (const r of frameRows) {
      m.set(normName(r.branch_name), {
        monthly: Number(r.monthly_budget_kgs ?? 0),
        planned: Number(r.planned_frames_per_month ?? 0),
        assumed: r.assumed_from_branch ?? null,
      });
    }
    return m;
  }, [frameRows]);

  const rentMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rentByBranch) m.set(normName(r.name), r.monthly);
    return m;
  }, [rentByBranch]);

  const branchOrder = useMemo(
    () => ['Кант', 'Кара-Балта', 'Сокулук', 'Беловодск', 'Токмок'].map(normName),
    []
  );

  const branches = useMemo(() => {
    return branchOrder.map((k) => {
      // display name: use canonical Russian labels
      const name =
        k === normName('Кант')
          ? 'Кант'
          : k === normName('Кара-Балта')
            ? 'Кара-Балта'
            : k === normName('Сокулук')
              ? 'Сокулук'
              : k === normName('Беловодск')
                ? 'Беловодск'
                : 'Токмок';

      const lensMonthlyB = lensMap.get(k)?.monthly ?? 0;
      const lensPlanned = lensMap.get(k)?.planned ?? 0;
      const lensAssumed = lensMap.get(k)?.assumed ?? null;

      const frameMonthlyB = frameMap.get(k)?.monthly ?? 0;
      const framePlanned = frameMap.get(k)?.planned ?? 0;
      const frameAssumed = frameMap.get(k)?.assumed ?? null;

      const rentMonthlyB = rentMap.get(k) ?? 0;

      const lensDaily = lensMonthlyB / Math.max(1, dim);
      const frameDaily = frameMonthlyB / Math.max(1, dim);
      const rentDaily = rentMonthlyB / Math.max(1, dim);

      const lensToday = lensDaily * Math.max(1, d);
      const frameToday = frameDaily * Math.max(1, d);
      const rentToday = rentDaily * Math.max(1, d);

      const totalMonthly = lensMonthlyB + frameMonthlyB + rentMonthlyB;
      const totalDaily = totalMonthly / Math.max(1, dim);
      const totalToday = totalDaily * Math.max(1, d);

      return {
        key: k,
        name,
        lens: { monthly: lensMonthlyB, daily: lensDaily, today: lensToday, planned: lensPlanned, assumed: lensAssumed },
        frame: { monthly: frameMonthlyB, daily: frameDaily, today: frameToday, planned: framePlanned, assumed: frameAssumed },
        rent: { monthly: rentMonthlyB, daily: rentDaily, today: rentToday },
        total: { monthly: totalMonthly, daily: totalDaily, today: totalToday },
      };
    });
  }, [branchOrder, lensMap, frameMap, rentMap, dim, d]);

  return (
    <div className="text-slate-50">
      <div>
        {/* Header (бренд-стандарт) */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
              <PiggyBank className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold tracking-tight text-slate-50">
                Финансовые накопления на закуп
              </div>
              <div className="mt-0.5 text-[12px] text-cyan-300/50">
                Сегодня: {`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`} · день {d} / {dim}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <SoftGhostButton onClick={load} disabled={loading}>
              <RefreshCw className={['h-4 w-4', loading ? 'animate-spin' : ''].join(' ')} />
              Обновить
            </SoftGhostButton>
            <SoftPrimaryButton disabled>
              <Sparkles className="h-4 w-4" />
              Категории (скоро)
            </SoftPrimaryButton>
          </div>
        </div>

        {err ? (
          <div className="mb-4 rounded-xl bg-rose-50 ring-1 ring-rose-200 px-4 py-3">
            <div className="text-sm font-semibold text-rose-700">Ошибка загрузки</div>
            <div className="mt-1 text-xs text-slate-600">{err}</div>
          </div>
        ) : null}

        <div>
          {/* Overall summary */}
          <div className="mb-5 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Итого на сегодня</div>
              <div className="mt-1 text-2xl font-bold text-slate-900">
                {loading ? '…' : `${nf0.format(Math.round(overallToday))} сом`}
              </div>
            </div>
            <div className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Итого в месяц</div>
              <div className="mt-1 text-2xl font-bold text-slate-900">
                {loading ? '…' : `${nf0.format(Math.round(overallMonthly))} сом`}
              </div>
            </div>
            <div className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Итого в день</div>
              <div className="mt-1 text-2xl font-bold text-slate-900">
                {loading ? '…' : `${nf0.format(Math.round(overallDaily))} сом`}
              </div>
            </div>
          </div>

          {/* 4 “коробочки” */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-5">
            {loading ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : (
              <>
                <NowCard
                  title="Линзы — коробочка"
                  icon={<TrendingUp className="h-5 w-5" />}
                  monthly={lensMonthly}
                  plannedUnitsText={
                    lensTotal?.planned_lenses_network != null
                      ? `План: ${nf0.format(Number(lensTotal.planned_lenses_network))} линз/мес`
                      : undefined
                  }
                  unitText="Цена: 76.20 сом/шт"
                  day={d}
                  daysInMonth={dim}
                  accent="emerald"
                />

                <NowCard
                  title="Оправы — коробочка"
                  icon={<Glasses className="h-5 w-5" />}
                  monthly={frameMonthly}
                  plannedUnitsText={
                    frameTotal?.planned_frames_network != null
                      ? `План: ${nf0.format(Number(frameTotal.planned_frames_network))} оправ/мес`
                      : undefined
                  }
                  unitText={
                    frameTotal?.unit_cost_kgs != null
                      ? `Себестоимость: ${nf2.format(Number(frameTotal.unit_cost_kgs))} сом/шт`
                      : undefined
                  }
                  day={d}
                  daysInMonth={dim}
                  accent="sky"
                />

                <NowCard
                  title="Аренда — коробочка"
                  icon={<Home className="h-5 w-5" />}
                  monthly={rentMonthlyTotal}
                  plannedUnitsText="Все филиалы"
                  unitText="Фиксированная сумма"
                  day={d}
                  daysInMonth={dim}
                  accent="emerald"
                  note="Детализация по филиалам — внизу"
                />

                <NowCard
                  title="Кредит — коробочка"
                  icon={<Banknote className="h-5 w-5" />}
                  monthly={creditMonthly}
                  plannedUnitsText="Ежемесячный платёж"
                  unitText="Фиксированная сумма"
                  day={d}
                  daysInMonth={dim}
                  accent="sky"
                />
              </>
            )}
          </div>

          {/* НИЖНИЙ БЛОК: детали по филиалам (линзы/оправы/аренда) */}
          <SectionShell
            title="По филиалам — детализация (линзы / оправы / аренда)"
            icon={<Building2 className="h-4 w-4 text-sky-700" />}
            subtitle="В каждой карточке: на сегодня / в день / в месяц"
          >
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-2xl p-4 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] animate-pulse"
                  >
                    <div className="h-4 w-24 bg-slate-200 rounded" />
                    <div className="mt-3 h-7 w-28 bg-slate-200 rounded" />
                    <div className="mt-3 h-20 w-full bg-slate-200 rounded-2xl" />
                  </div>
                ))
              ) : (
                branches.map((b) => (
                  <div
                    key={b.key}
                    className="rounded-2xl p-4 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-slate-900 truncate">{b.name}</div>
                        <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          итого на сегодня
                        </div>
                        <div className="mt-0.5 text-[18px] font-semibold text-slate-900">
                          {nf0.format(Math.round(b.total.today))} сом
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-500">в день</div>
                        <div className="text-[12px] font-semibold text-slate-900">
                          {nf0.format(Math.round(b.total.daily))}
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500">в месяц</div>
                        <div className="text-[12px] font-semibold text-slate-900">
                          {nf0.format(Math.round(b.total.monthly))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      <MiniLine
                        label="Линзы"
                        icon={<TrendingUp className="h-4 w-4" />}
                        today={b.lens.today}
                        daily={b.lens.daily}
                        monthly={b.lens.monthly}
                        tone="emerald"
                        note={
                          b.lens.assumed
                            ? `допущение: как ${b.lens.assumed} • план ${nf0.format(b.lens.planned)} шт/мес`
                            : `план ${nf0.format(b.lens.planned)} шт/мес`
                        }
                      />
                      <MiniLine
                        label="Оправы"
                        icon={<Glasses className="h-4 w-4" />}
                        today={b.frame.today}
                        daily={b.frame.daily}
                        monthly={b.frame.monthly}
                        tone="sky"
                        note={
                          b.frame.assumed
                            ? `допущение: как ${b.frame.assumed} • план ${nf0.format(b.frame.planned)} шт/мес`
                            : `план ${nf0.format(b.frame.planned)} шт/мес`
                        }
                      />
                      <MiniLine
                        label="Аренда"
                        icon={<Home className="h-4 w-4" />}
                        today={b.rent.today}
                        daily={b.rent.daily}
                        monthly={b.rent.monthly}
                        tone="amber"
                        note="фикс"
                      />
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 text-[11px] text-slate-500">
              “На сегодня” считается пропорционально дню месяца (включая сегодняшний день). В новом месяце накопление начинается заново.
              Кредит — отдельная коробочка (без привязки к филиалам).
            </div>
          </SectionShell>
        </div>
      </div>
    </div>
  );
}