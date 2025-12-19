'use client';

import React, { useEffect, useState } from 'react';
import getSupabase from '@/lib/supabaseClient';
import Link from 'next/link';

/* ────────── корзины цен ────────── */

type BucketId = 1 | 2 | 3 | 4 | 5;

const BUCKETS = [
  { id: 1 as BucketId, name: 'Бюджет', min: 800, max: 1299 },
  { id: 2 as BucketId, name: 'Нижний средний', min: 1300, max: 1799 },
  { id: 3 as BucketId, name: 'Средний', min: 1800, max: 2499 },
  { id: 4 as BucketId, name: 'Верхний средний', min: 2500, max: 3499 },
  { id: 5 as BucketId, name: 'Премиум', min: 3500, max: 10000 },
] as const;

/** Текущие проценты по корзинам — потом можно вынести в БД */
const PCT = { b1: 30, b2: 24, b3: 20, b4: 18, b5: 8 } as const;

/** Плановая ёмкость витрин по филиалам (временно здесь, потом унесём в таблицу) */
const BRANCH_CAPACITY: Record<string, number> = {
  Сокулук: 120,
  Беловодск: 100,
  'Кара-Балта': 100,
  Кант: 120,
};

type BranchStats = {
  id: number;
  name: string;
  plannedSlots: number;
  printedTotal: number;
  bucketCounts: Record<BucketId, number>;
};

type GlobalStats = {
  totalBranches: number;
  totalBarcodes: number;
  bucketCounts: Record<BucketId, number>;
};

function emptyBuckets(): Record<BucketId, number> {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

function bucketOfPrice(p: number): BucketId | null {
  for (const b of BUCKETS) {
    if (p >= b.min && p <= b.max) return b.id;
  }
  return null;
}

/* ────────── мелкие компоненты UI ────────── */

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value * 100) / max)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80">
      <div
        className="h-1.5 rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-500 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function Section(props: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { title, aside, children } = props;
  return (
    <section
      className="mb-5 rounded-3xl border border-sky-200 
                 bg-gradient-to-br from-white via-slate-50 to-sky-50/85
                 shadow-[0_18px_50px_rgba(15,23,42,0.45)] backdrop-blur-xl"
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 px-5 pt-4 pb-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {aside && (
          <div className="text-[11px] text-slate-600 flex items-center gap-1">
            {aside}
          </div>
        )}
      </div>
      <div className="px-5 pb-4 pt-2">{children}</div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl border border-sky-100 bg-white/90 px-4 py-3 
                 shadow-sm text-slate-900"
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-slate-900 flex items-baseline gap-1.5">
        {value}
      </div>
    </div>
  );
}

function formatPercent(num: number, denom: number): string {
  if (!denom || denom <= 0) return '—';
  const v = Math.round((num * 100) / denom);
  return `${v}%`;
}

/* ────────── карточка филиала ────────── */

function BranchCard({
  branch,
  hasPerBranchStats,
}: {
  branch: BranchStats;
  hasPerBranchStats: boolean;
}) {
  const fillPct = branch.plannedSlots
    ? Math.min(100, Math.round((branch.printedTotal * 100) / branch.plannedSlots))
    : 0;

  return (
    <div
      className="flex flex-col rounded-3xl border border-sky-100 
                 bg-gradient-to-br from-white via-slate-50 to-sky-50/80 
                 p-4 shadow-[0_14px_40px_rgba(15,23,42,0.35)] text-slate-900"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-900">{branch.name}</div>
          <div className="text-[11px] text-slate-500">
            План слотов:{' '}
            <span className="font-medium text-slate-900">
              {branch.plannedSlots || 'не задан'}
            </span>
          </div>
        </div>
        {!hasPerBranchStats && (
          <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-800 border border-amber-200">
            пока без привязки штрихкодов
          </span>
        )}
      </div>

      <ProgressBar value={branch.printedTotal} max={branch.plannedSlots || 1} />
      <div className="mt-2 text-[11px] text-slate-600">
        Ценников:{' '}
        <span className="font-semibold text-slate-900">{branch.printedTotal}</span>{' '}
        {branch.plannedSlots ? (
          <>
            • заполненность:{' '}
            <span className="font-semibold text-slate-900">
              {formatPercent(branch.printedTotal, branch.plannedSlots)} (
              {fillPct}%)
            </span>
          </>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {BUCKETS.map((b) => (
          <span
            key={b.id}
            className="rounded-full border border-sky-100 bg-white px-2 py-1 text-[11px] text-slate-700 shadow-xs"
          >
            {b.name}: <span className="font-semibold">{branch.bucketCounts[b.id] ?? 0}</span>
          </span>
        ))}
      </div>

      <Link
        href={`/settings/barcodes/${branch.id}`}
        className="mt-3 inline-flex items-center justify-center rounded-xl 
                   border border-cyan-400 bg-white px-3 py-1.5 text-xs font-medium 
                   text-slate-900 shadow-sm hover:bg-cyan-50 hover:border-cyan-500 
                   transition"
      >
        Открыть страницу филиала
      </Link>
    </div>
  );
}

/* ────────── страница обзора ────────── */

export default function BarcodesOverviewPage() {
  const [branches, setBranches] = useState<BranchStats[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [hasPerBranchStats, setHasPerBranchStats] = useState<boolean>(true);

  async function loadData() {
    setLoading(true);
    setErrorText(null);

    try {
      const sb = getSupabase();

      // 1) Филиалы
      const { data: branchesData, error: branchesError } = await sb
        .from('branches')
        .select('id, name')
        .order('id', { ascending: true });

      if (branchesError) throw branchesError;

      const branchesList = (branchesData ?? []) as { id: number; name: string }[];

      // 2) Штрихкоды.
      // Пытаемся взять branch_id + price. Если колонка branch_id ещё не создана — gracefully деградируем.
      let hasBranch = true;
      let barcodes: { branch_id: number | null; price: number }[] = [];

      const { data: bcWithBranch, error: bcErr } = await sb
        .from('frame_barcodes')
        .select('branch_id, price');

      if (bcErr) {
        // Колонки branch_id, возможно, нет — работаем только по сети.
        hasBranch = false;
        const { data: bcNoBranch, error: bcErr2 } = await sb
          .from('frame_barcodes')
          .select('price');

        if (bcErr2) throw bcErr2;

        barcodes = (bcNoBranch ?? []).map((row: any) => ({
          branch_id: null,
          price: Number(row.price),
        }));
      } else {
        barcodes = (bcWithBranch ?? []).map((row: any) => ({
          branch_id: row.branch_id ?? null,
          price: Number(row.price),
        }));
      }

      setHasPerBranchStats(hasBranch);

      // 3) Статистика
      const globalBucketCounts = emptyBuckets();
      const perBranchBuckets: Record<number, Record<BucketId, number>> = {};
      const perBranchTotals: Record<number, number> = {};
      let totalBarcodes = 0;

      for (const row of barcodes) {
        const price = row.price;
        if (!Number.isFinite(price)) continue;

        const bucket = bucketOfPrice(price);
        if (!bucket) continue;

        totalBarcodes += 1;
        globalBucketCounts[bucket] += 1;

        const bid = row.branch_id;
        if (bid) {
          if (!perBranchBuckets[bid]) perBranchBuckets[bid] = emptyBuckets();
          perBranchBuckets[bid][bucket] += 1;
          perBranchTotals[bid] = (perBranchTotals[bid] ?? 0) + 1;
        }
      }

      const branchStats: BranchStats[] = branchesList.map((br) => {
        // дефолт из константы
        let plannedSlots = BRANCH_CAPACITY[br.name] ?? 0;

        // если на странице филиала уже вручную ввели слоты,
        // забираем их из localStorage
        try {
          const saved = localStorage.getItem(`ui.branchSlots.${br.id}`);
          if (saved != null) {
            const n = Number(JSON.parse(saved));
            if (Number.isFinite(n) && n > 0) {
              plannedSlots = n;
            }
          }
        } catch {
          // если localStorage недоступен — просто игнорируем
        }

        return {
          id: br.id,
          name: br.name,
          plannedSlots,
          printedTotal: perBranchTotals[br.id] ?? 0,
          bucketCounts: perBranchBuckets[br.id] ?? emptyBuckets(),
        };
      });


      setBranches(branchStats);
      setGlobalStats({
        totalBranches: branchStats.length,
        totalBarcodes,
        bucketCounts: globalBucketCounts,
      });
    } catch (err: any) {
      console.error(err);
      setErrorText(err?.message || 'Ошибка загрузки данных');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  return (
    <div className="mx-auto max-w-6xl p-6 text-sm text-slate-900">
      {/* Шапка */}
      <header
        className="mb-4 rounded-3xl border border-sky-200 
                   bg-gradient-to-br from-white via-slate-50 to-sky-50/85 
                   px-6 py-4 shadow-[0_22px_60px_rgba(15,23,42,0.55)] 
                   backdrop-blur-xl flex items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <div
            className="grid h-10 w-10 place-items-center rounded-2xl 
                       bg-gradient-to-br from-cyan-400 via-sky-400 to-indigo-500 
                       text-xs font-bold text-slate-900 shadow-[0_0_18px_rgba(56,189,248,0.75)]"
          >
            RF
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">
              Оправы и штрихкоды · обзор по филиалам
            </h1>
            <div className="text-[11px] font-medium text-slate-500">
              Видно картину в целом, дальше проваливаемся в каждый филиал отдельно
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl 
                     bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-500 
                     px-3 py-2 text-xs font-medium text-slate-900
                     shadow-[0_0_14px_rgba(56,189,248,0.55)]
                     hover:brightness-110 focus:outline-none 
                     focus:ring-2 focus:ring-cyan-400/60
                     disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? 'Обновляю…' : 'Обновить данные'}
        </button>
      </header>

      {errorText && (
        <div
          className="mb-4 flex items-start justify-between gap-3 rounded-2xl 
                     border border-rose-300 bg-gradient-to-r from-rose-50 via-rose-50 to-amber-50 
                     px-4 py-3 text-xs text-rose-800 shadow-sm"
        >
          <div>
            <div className="font-semibold">Ошибка загрузки данных</div>
            <div className="mt-0.5 text-[11px]">{errorText}</div>
          </div>
        </div>
      )}

      {/* Сводка по сети */}
      <Section
        title="Сводка по сети"
        aside={
          globalStats && (
            <span>
              Всего ценников:{' '}
              <span className="font-semibold text-slate-900">
                {globalStats.totalBarcodes}
              </span>
            </span>
          )
        }
      >
        {globalStats ? (
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard label="Филиалов в системе" value={globalStats.totalBranches} />
            <StatCard
              label="Ценников в базе (вся сеть)"
              value={globalStats.totalBarcodes}
            />
            <StatCard
              label="Баланс корзин"
              value={
                <div className="mt-0.5 space-y-0.5 text-[11px]">
                  <div className="text-slate-600">
                    Бюджет / Нижний / Средний / Верхний / Премиум:
                  </div>
                  <div className="font-mono text-[11px]">
                    {globalStats.bucketCounts[1]} / {globalStats.bucketCounts[2]} /{' '}
                    {globalStats.bucketCounts[3]} / {globalStats.bucketCounts[4]} /{' '}
                    {globalStats.bucketCounts[5]}
                  </div>
                </div>
              }
            />
          </div>
        ) : (
          <div className="text-xs text-slate-500">Загружаю сводку по сети…</div>
        )}
      </Section>

      {/* Филиалы */}
      <Section
        title="Филиалы"
        aside={
          !hasPerBranchStats ? (
            <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-800 border border-amber-200">
              Сейчас штрихкоды не привязаны к филиалам; считаем только общую картину
            </span>
          ) : (
            <span className="text-[11px] text-slate-500">
              План по корзинам: {PCT.b1}% / {PCT.b2}% / {PCT.b3}% / {PCT.b4}% /{' '}
              {PCT.b5}%
            </span>
          )
        }
      >
        {branches.length === 0 && !loading && (
          <div className="text-xs text-slate-500">
            Филиалы не найдены или нет прав на их чтение.
          </div>
        )}

        {branches.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            {branches.map((b) => (
              <BranchCard
                key={b.id}
                branch={b}
                hasPerBranchStats={hasPerBranchStats}
              />
            ))}
          </div>
        )}

        {loading && (
          <div className="mt-4 text-xs text-slate-500">
            Обновляю данные по филиалам…
          </div>
        )}
      </Section>
    </div>
  );
}
