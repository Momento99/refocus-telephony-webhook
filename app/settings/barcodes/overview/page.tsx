// app/settings/barcodes/overview/page.tsx
'use client';

import React, { useEffect, useState } from 'react';
import getSupabase from '@/lib/supabaseClient';
import Link from 'next/link';
import { AlertTriangle, Barcode, CheckCircle2 } from 'lucide-react';

/** Плановая ёмкость витрин по филиалам (стартовое значение; переопределяется через localStorage) */
const BRANCH_CAPACITY: Record<string, number> = {
  Сокулук: 140,
  Беловодск: 168,
  'Кара-Балта': 168,
  Кант: 252,
  Токмок: 168,
};

/** Филиалы, где не используем автоматическую «допечатку по продажам» (как в branch page) */
const BRANCHES_WITHOUT_AUTO_REPLENISH: string[] = ['Кант', 'Токмок'];

/* ────────── типы оправ (для barcode inference) ────────── */

type FrameTypeCode = 'RP' | 'RM' | 'KD' | 'PA' | 'MA';
type GenderCode = 'F' | 'M';
type TypeKey = `${FrameTypeCode}_${GenderCode}`;

function makeTypeKey(type: FrameTypeCode, gender: GenderCode): TypeKey {
  return `${type}_${gender}`;
}

/* ────────── barcode inference (как в branch page) ────────── */

const KNOWN_TYPES: FrameTypeCode[] = ['RP', 'RM', 'KD', 'PA', 'MA'];

function inferFromBarcode(barcodeRaw: string): { typeCode: FrameTypeCode; gender: GenderCode } | null {
  const barcode = String(barcodeRaw || '').trim().toUpperCase();
  // BR(2) + TYPE(2) + G(1) + YY(2) + SERIAL(3..5)
  const m = barcode.match(/^([A-Z]{2})([A-Z]{2})([FM])(\d{2})(\d{3,5})$/);
  if (!m) return null;
  const [, , t, g] = m;
  if (!KNOWN_TYPES.includes(t as FrameTypeCode)) return null;
  return { typeCode: t as FrameTypeCode, gender: g as GenderCode };
}


/* ────────── базовые utils ────────── */

type BranchRow = { id: number; name: string };

type BranchStats = {
  id: number;
  name: string;

  plannedSlots: number;

  /** "Сейчас на витрине" — сумма activeSum по всем видам (как нижний блок) */
  filledNow: number;

  /** "Не хватает" — сумма visiblePrices.length по всем видам (как нижний блок) */
  missingNow: number;

  /** чтобы пересчитать missingNow при изменении плана без перезагрузки */
  typeActive: Record<string, Record<number, number>>;
  typeSuggest: Record<string, number[]>;
};

type NetworkStats = {
  branchesTotal: number;
  plannedTotal: number;
  filledTotal: number;
  missingTotal: number;
  lowBranches: number;
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}


/* ───────────── UI ───────────── */

function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-slate-500">{hint}</div> : null}
    </div>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  const p = clamp(percent, 0, 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-1.5 rounded-full bg-cyan-500 transition-all"
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

function FillChip({ plannedSlots, filledNow, fillPct }: { plannedSlots: number; filledNow: number; fillPct: number }) {
  if (!plannedSlots || plannedSlots <= 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
        нет плана
      </span>
    );
  }

  if (filledNow > plannedSlots) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">
        переполнено
      </span>
    );
  }

  if (fillPct >= 100) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-medium text-cyan-700 ring-1 ring-cyan-200">
        <CheckCircle2 className="h-3 w-3" />
        норма
      </span>
    );
  }

  if (fillPct >= 90) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700 ring-1 ring-sky-200">
        почти
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-800 ring-1 ring-sky-200">
      пополнить
    </span>
  );
}

function BranchCard({ branch }: { branch: BranchStats }) {
  const planned = branch.plannedSlots || 0;
  const filled = branch.filledNow || 0;
  const missing = branch.missingNow || 0;

  const percent = planned > 0 ? clamp(Math.round((filled * 100) / planned), 0, 100) : 0;

  return (
    <div
      className="rounded-2xl bg-white ring-1 ring-sky-200/70 p-4
                 shadow-[0_8px_30px_rgba(15,23,42,0.45)]
                 text-slate-900 transition-transform duration-200 hover:-translate-y-0.5"
    >
      {/* Name + status */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-[15px] font-semibold tracking-tight text-slate-900">{branch.name}</div>
        <FillChip plannedSlots={planned} filledNow={filled} fillPct={percent} />
      </div>

      {/* Progress */}
      <div className="mt-3">
        <ProgressBar percent={percent} />
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
          <span>{planned > 0 ? `${percent}%` : '—'}</span>
          <span className="font-mono">{planned > 0 ? `${filled} / ${planned}` : `${filled} / —`}</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-slate-50 ring-1 ring-slate-100 px-2.5 py-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">План</div>
          <div className="mt-0.5 text-[15px] font-bold text-slate-900">{planned || '—'}</div>
        </div>
        <div className="rounded-xl bg-slate-50 ring-1 ring-slate-100 px-2.5 py-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Есть</div>
          <div className="mt-0.5 text-[15px] font-bold text-slate-900">{filled}</div>
        </div>
        <div className="rounded-xl bg-slate-50 ring-1 ring-slate-100 px-2.5 py-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Нужно</div>
          <div className={`mt-0.5 text-[15px] font-bold ${missing > 0 ? 'text-sky-600' : 'text-slate-900'}`}>{planned > 0 ? missing : '—'}</div>
        </div>
      </div>

      <Link
        href={`/settings/barcodes/${branch.id}`}
        className="mt-3 inline-flex w-full items-center justify-center rounded-xl
                   bg-cyan-500 px-4 py-2 text-sm font-semibold text-white
                   shadow-[0_4px_16px_rgba(34,211,238,0.28)]
                   hover:bg-cyan-400 active:brightness-95
                   focus:outline-none focus:ring-2 focus:ring-cyan-300/70"
      >
        Открыть филиал
      </Link>
    </div>
  );
}

/* ───────────── Supabase: загрузить все штрихкоды за год (voided_at IS NULL) ───────────── */

type YearRow = {
  branch_id: number | null;
  price: number | null;
  sold_at: string | null;
  type_code: FrameTypeCode | null;
  gender: GenderCode | null;
  barcode: string | null;
};

async function fetchAllRows(): Promise<YearRow[]> {
  const sb = getSupabase();

  const PAGE = 1000;
  let from = 0;
  let all: YearRow[] = [];

  while (true) {
    const { data, error } = await sb
      .from('frame_barcodes')
      .select('branch_id, price, sold_at, type_code, gender, barcode')
      .is('voided_at', null)
      .order('barcode', { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) throw error;

    const chunk = (data ?? []).map((r: any) => ({
      branch_id: r.branch_id as number | null,
      price: r.price == null ? null : Number(r.price),
      sold_at: r.sold_at == null ? null : String(r.sold_at),
      type_code: (r.type_code ?? null) as FrameTypeCode | null,
      gender: (r.gender ?? null) as GenderCode | null,
      barcode: r.barcode == null ? null : String(r.barcode),
    })) as YearRow[];

    all = all.concat(chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
  }

  return all;
}

/* ───────────── Page ───────────── */

export default function BarcodesOverviewPage() {
  const [branches, setBranches] = useState<BranchStats[]>([]);
  const [network, setNetwork] = useState<NetworkStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // UI: откат штрихкода (вернуть на полку)
  const [rbBarcode, setRbBarcode] = useState('');
  const [rbForce, setRbForce] = useState(false);
  const [rbBusy, setRbBusy] = useState(false);
  const [rbOk, setRbOk] = useState<string | null>(null);
  const [rbErr, setRbErr] = useState<string | null>(null);
  const [rbJson, setRbJson] = useState<any>(null);

  function getPlannedSlots(branchId: number, branchName: string): number {
    let planned = BRANCH_CAPACITY[branchName] ?? 0;
    try {
      const saved = localStorage.getItem(`ui.branchSlots.${branchId}`);
      if (saved != null) {
        const n = Number(JSON.parse(saved));
        if (Number.isFinite(n) && n > 0) planned = n;
      }
    } catch {}
    return planned;
  }

  function normalizeBarcode(v: string) {
    return v.trim().toUpperCase();
  }

  function recalcNetwork(nextBranches: BranchStats[]): NetworkStats {
    const plannedTotal = nextBranches.reduce((s, b) => s + (b.plannedSlots || 0), 0);
    const filledTotal = nextBranches.reduce((s, b) => s + (b.filledNow || 0), 0);
    const missingTotal = nextBranches.reduce((s, b) => s + (b.missingNow || 0), 0);

    const lowBranches = nextBranches.filter((b) => (b.plannedSlots || 0) > 0 && (b.missingNow || 0) > 0).length;

    return {
      branchesTotal: nextBranches.length,
      plannedTotal,
      filledTotal,
      missingTotal,
      lowBranches,
    };
  }

  async function loadData() {
    setLoading(true);
    setErrorText(null);

    try {
      const sb = getSupabase();

      // 1) Филиалы
      const { data: branchesData, error: branchesError } = await sb.from('branches').select('id, name').order('id', { ascending: true });
      if (branchesError) throw branchesError;

      const list = (branchesData ?? []) as BranchRow[];

      // 2) Все штрихкоды всех годов (voided_at NULL)
      const rows = await fetchAllRows();

      // 3) Группировка per-branch: totalMap + activeMap + rawActiveCount
      const byBranch: Record<
        number,
        {
          totalMap: Record<string, Record<number, number>>;
          activeMap: Record<string, Record<number, number>>;
          suggestMap: Record<string, number[]>;
          rawActiveCount: number; // ВСЕ оправы на полке (sold_at IS NULL), включая без типа/пола
        }
      > = {};

      const ensure = (branchId: number) => {
        if (!byBranch[branchId]) {
          byBranch[branchId] = {
            totalMap: {},
            activeMap: {},
            suggestMap: {},
            rawActiveCount: 0,
          };
        }
        return byBranch[branchId];
      };

      for (const r of rows) {
        const bid = r.branch_id;
        if (!bid || !Number.isFinite(bid)) continue;

        const slot = ensure(bid);

        // Считаем ВСЕ оправы на полке — вне зависимости от цены/типа/пола
        if (!r.sold_at) {
          slot.rawActiveCount += 1;
        }

        // Ценовая аналитика требует валидную цену
        const priceNum = r.price == null ? NaN : Number(r.price);
        if (!Number.isFinite(priceNum) || priceNum <= 0) continue;

        // Для ценовой аналитики нужен тип+пол — пропускаем без них
        const inferred = inferFromBarcode(r.barcode || '');
        const t = (inferred?.typeCode ?? r.type_code ?? null) as FrameTypeCode | null;
        const g = (inferred?.gender ?? r.gender ?? null) as GenderCode | null;
        if (!t || !g) continue;

        const key = makeTypeKey(t, g);

        if (!slot.totalMap[key]) slot.totalMap[key] = {};
        if (!slot.activeMap[key]) slot.activeMap[key] = {};

        slot.totalMap[key][priceNum] = (slot.totalMap[key][priceNum] || 0) + 1;

        if (!r.sold_at) {
          slot.activeMap[key][priceNum] = (slot.activeMap[key][priceNum] || 0) + 1;
        }
      }

      // suggestMap: цены, где продано > 0 и на полке 0
      for (const bidStr of Object.keys(byBranch)) {
        const bid = Number(bidStr);
        const slot = byBranch[bid];

        const suggest: Record<string, number[]> = {};
        for (const key of Object.keys(slot.totalMap)) {
          const totalPrices = slot.totalMap[key] || {};
          const activePrices = slot.activeMap[key] || {};
          const list: number[] = [];

          for (const priceStr of Object.keys(totalPrices)) {
            const p = Number(priceStr);
            if (!Number.isFinite(p)) continue;

            const totalC = totalPrices[p] || 0;
            const activeC = activePrices[p] || 0;
            const sold = Math.max(totalC - activeC, 0);

            if (sold > 0 && activeC === 0) list.push(p);
          }

          if (list.length) suggest[key] = Array.from(new Set(list)).sort((a, b) => a - b);
        }

        slot.suggestMap = suggest;
      }

      // 4) Сборка stats
      const stats: BranchStats[] = list.map((br) => {
        const plannedSlots = getPlannedSlots(br.id, br.name);
        const disableAutoSuggest = BRANCHES_WITHOUT_AUTO_REPLENISH.includes(br.name);

        const typeActive = (byBranch[br.id]?.activeMap ?? {}) as Record<string, Record<number, number>>;
        const rawSuggest = (byBranch[br.id]?.suggestMap ?? {}) as Record<string, number[]>;
        const typeSuggest = disableAutoSuggest ? {} : rawSuggest;

        // filledNow = все оправы с sold_at IS NULL (включая те, у которых нет типа/пола)
        const filledNow = byBranch[br.id]?.rawActiveCount ?? 0;
        const missingNow = Math.max(0, plannedSlots - filledNow);

        return {
          id: br.id,
          name: br.name,
          plannedSlots,
          filledNow,
          missingNow,
          typeActive,
          typeSuggest,
        };
      });

      setBranches(stats);
      setNetwork(recalcNetwork(stats));
    } catch (err: any) {
      console.error(err);
      setErrorText(err?.message || 'Ошибка загрузки данных');
    } finally {
      setLoading(false);
    }
  }

  async function rollbackBarcode() {
    const bc = normalizeBarcode(rbBarcode);
    setRbOk(null);
    setRbErr(null);
    setRbJson(null);

    if (!bc) {
      setRbErr('Введи штрихкод.');
      return;
    }

    const confirmText = rbForce ? `Точно ОТКАТИТЬ ${bc} в режиме force=true?` : `Откатить тестовую продажу и вернуть ${bc} на полку?`;
    if (!window.confirm(confirmText)) return;

    setRbBusy(true);
    try {
      const sb = getSupabase();
      const { data, error } = await sb.rpc('rollback_frame_barcode', {
        p_barcode: bc,
        p_force: rbForce,
      });

      if (error) throw error;

      setRbJson(data ?? null);
      setRbOk(`Готово: ${bc} возвращён на полку.`);
      await loadData();
    } catch (e: any) {
      console.error(e);
      setRbErr(e?.message || 'Ошибка отката');
    } finally {
      setRbBusy(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  return (
    <div className="min-h-screen bg-transparent text-slate-50">
      {/* ВАЖНО: убран прямоугольный фон-оверлей (inset-0 radial-gradient). Оставили только «точечные» свечения (не прямоугольник). */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-44 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-cyan-500/12 blur-[90px]" />
        <div className="absolute -bottom-44 right-0 h-[520px] w-[520px] rounded-full bg-teal-500/10 blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-5 pt-8 pb-10">
        {/* Header (прозрачный, без подложки) */}
        <div className="mb-6 flex items-start gap-3">
          <div
            className="grid h-10 w-10 place-items-center rounded-2xl
                       bg-cyan-500
                       shadow-[0_4px_20px_rgba(34,211,238,0.40)]"
          >
            <Barcode className="h-5 w-5 text-white drop-shadow-[0_6px_18px_rgba(0,0,0,0.35)]" />
          </div>

          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-50">
              Оправы и штрих-коды
            </div>
            <div className="mt-0.5 text-[12px] text-cyan-300/50">Обзор витрин по филиалам</div>
            {loading ? <div className="mt-1 text-[11px] text-cyan-400 animate-pulse">Обновляю данные…</div> : null}
          </div>
        </div>

        {/* Ошибка */}
        {errorText ? (
          <div className="mb-6 rounded-2xl bg-white ring-1 ring-amber-200 px-5 py-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
              <div>
                <div className="font-semibold text-slate-900">Ошибка загрузки данных</div>
                <div className="mt-1 text-[12px] text-slate-600">{errorText}</div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Сводка */}
        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <StatCard label="План слотов (сумма)" value={network?.plannedTotal ?? '—'} />
          <StatCard label="Сейчас на витринах (сумма)" value={network?.filledTotal ?? '—'} />
          <StatCard label="К печати сейчас (сумма)" value={network?.missingTotal ?? '—'} />
        </div>

        {/* Филиалы */}
        {branches.length === 0 && !loading ? (
          <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-6 text-slate-500 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
            Ничего не найдено.
          </div>
        ) : null}

        {branches.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {branches.map((b) => (
              <BranchCard key={b.id} branch={b} />
            ))}
          </div>
        ) : null}

        {/* Откат штрихкода */}
        <div className="mt-8 rounded-2xl bg-white ring-1 ring-sky-100 p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)] text-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold tracking-tight">Откат тестовой продажи (вернуть штрихкод на полку)</div>
              <div className="mt-1 text-[12px] text-slate-600">RPC: rollback_frame_barcode(p_barcode, p_force)</div>
            </div>
            <div className="text-[11px] text-slate-600">
              По умолчанию откат блокируется, если заказ не NEW или есть оплаты. Для обхода — force=true.
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <label className="block text-[11px] font-medium text-slate-600">Штрихкод</label>
              <input
                value={rbBarcode}
                onChange={(e) => setRbBarcode(e.target.value)}
                placeholder="Напр. KBRPF250117"
                className="mt-1 w-full rounded-2xl bg-white/90 px-3 py-2.5 text-sm text-slate-900
                           ring-1 ring-sky-200/80 shadow-[0_14px_40px_rgba(15,23,42,0.14)]
                           outline-none focus:ring-2 focus:ring-cyan-400/70"
              />

              <div className="mt-2 flex items-center gap-2">
                <input
                  id="rbForce"
                  type="checkbox"
                  checked={rbForce}
                  onChange={(e) => setRbForce(e.target.checked)}
                  className="h-4 w-4 accent-cyan-500"
                />
                <label htmlFor="rbForce" className="text-[12px] text-slate-700">
                  force=true (опасно — только если понимаешь последствия)
                </label>
              </div>
            </div>

            <button
              type="button"
              onClick={rollbackBarcode}
              disabled={rbBusy}
              className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold
                         bg-cyan-500 text-white
                         shadow-[0_4px_16px_rgba(34,211,238,0.28)]
                         hover:bg-cyan-400 active:brightness-95
                         focus:outline-none focus:ring-2 focus:ring-cyan-300/70
                         disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {rbBusy ? 'Откатываю…' : 'Вернуть на полку'}
            </button>
          </div>

          {rbErr ? (
            <div className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-[12px] text-rose-800 ring-1 ring-rose-200">
              {rbErr}
            </div>
          ) : null}

          {rbOk ? (
            <div className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-[12px] text-emerald-800 ring-1 ring-emerald-200">
              {rbOk}
            </div>
          ) : null}

          {rbJson ? (
            <pre className="mt-4 max-h-60 overflow-auto rounded-2xl bg-white/85 p-3 text-[11px] text-slate-800 ring-1 ring-slate-200 shadow-[0_14px_40px_rgba(15,23,42,0.10)]">
              {JSON.stringify(rbJson, null, 2)}
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}
