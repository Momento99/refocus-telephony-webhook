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

/* ────────── типы оправ и правила цен (как в branch page) ────────── */

type FrameTypeCode = 'RP' | 'RM' | 'KD' | 'PA' | 'MA';
type GenderCode = 'F' | 'M';
type TypeKey = `${FrameTypeCode}_${GenderCode}`;

function makeTypeKey(type: FrameTypeCode, gender: GenderCode): TypeKey {
  return `${type}_${gender}`;
}

/** Жёсткие границы цен по каждому типу */
const FRAME_TYPE_PRICE_RULES: Record<FrameTypeCode, { min: number; max: number }> = {
  RP: { min: 800, max: 2200 },
  RM: { min: 1000, max: 2400 },
  KD: { min: 800, max: 3500 },
  PA: { min: 1000, max: 3200 },
  MA: { min: 1200, max: 10000 },
};

/** Границы цен с учётом типа И пола (одна точка правды) */
function getTypePriceBounds(type: FrameTypeCode, gender: GenderCode): { min: number; max: number } {
  const base = FRAME_TYPE_PRICE_RULES[type];
  if (!base) return { min: 0, max: 0 };

  let { min, max } = base;

  if (type === 'RP') {
    min = 800;
    max = 2200;
  }
  if (type === 'RM') {
    min = 1000;
    max = 2400;
  }
  if (type === 'KD') {
    min = 800;
    max = 3500;
  }
  if (type === 'PA') {
    if (gender === 'F') {
      min = 1000;
      max = 3000;
    } else {
      min = 1200;
      max = 3200;
    }
  }
  if (type === 'MA') {
    if (gender === 'F') {
      min = 1200;
      max = 9000;
    } else {
      min = 1400;
      max = 10000;
    }
  }

  return { min, max };
}

const PRICE_ALPHA = 3.4;

function generatePriceLadder(count: number, minPrice: number, maxPrice: number, alpha = PRICE_ALPHA): number[] {
  if (count <= 0 || maxPrice <= minPrice) return [];
  const prices: number[] = [];

  for (let i = 1; i <= count; i++) {
    const q = (i - 0.5) / count;
    const raw = minPrice + (maxPrice - minPrice) * Math.pow(q, alpha);
    let p = 10 * Math.round(raw / 10);

    if (p < 3000 && p % 100 === 0) p += 10;
    if (p >= 3000) p = 100 * Math.round(p / 100);

    if (p < minPrice) p = minPrice;
    if (p > maxPrice) p = maxPrice;

    prices.push(p);
  }

  for (let i = 1; i < prices.length; i++) {
    if (prices[i] <= prices[i - 1]) {
      const prev = prices[i - 1];
      const step = prev >= 3000 ? 100 : 10;
      let next = prev + step;
      if (next > maxPrice) next = maxPrice;
      prices[i] = next;
    }
  }

  return prices;
}

/* ────────── секции/доли (как в branch page) ────────── */

const TYPE_SECTIONS = [
  { id: 'RD_PL_F', title: 'Для чтения · Женские пластик', typeCode: 'RP' as FrameTypeCode, gender: 'F' as GenderCode },
  { id: 'RD_MT_F', title: 'Для чтения · Женские металл', typeCode: 'RM' as FrameTypeCode, gender: 'F' as GenderCode },
  { id: 'KD_F', title: 'Детские · Девочки', typeCode: 'KD' as FrameTypeCode, gender: 'F' as GenderCode },
  { id: 'KD_M', title: 'Детские · Мальчики', typeCode: 'KD' as FrameTypeCode, gender: 'M' as GenderCode },
  { id: 'PA_F', title: 'Взрослый пластик · Женские', typeCode: 'PA' as FrameTypeCode, gender: 'F' as GenderCode },
  { id: 'PA_M', title: 'Взрослый пластик · Мужские', typeCode: 'PA' as FrameTypeCode, gender: 'M' as GenderCode },
  { id: 'MA_F', title: 'Взрослый металл · Женские', typeCode: 'MA' as FrameTypeCode, gender: 'F' as GenderCode },
  { id: 'MA_M', title: 'Взрослый металл · Мужские', typeCode: 'MA' as FrameTypeCode, gender: 'M' as GenderCode },
] as const;

type TypeSection = (typeof TYPE_SECTIONS)[number];
type TypeSectionId = TypeSection['id'];

const TYPE_SLOT_SHARE: Record<TypeSectionId, number> = {
  RD_PL_F: 14 / 168,
  RD_MT_F: 14 / 168,
  KD_F: 7 / 168,
  KD_M: 7 / 168,
  PA_F: 35 / 168,
  PA_M: 28 / 168,
  MA_F: 35 / 168,
  MA_M: 28 / 168,
};

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

/* ────────── “точка правды” расчёта как в нижнем блоке ────────── */

function sumMapCounts(map: Record<number, number> | undefined | null): number {
  if (!map) return 0;
  let s = 0;
  for (const v of Object.values(map)) {
    const n = Number(v);
    if (Number.isFinite(n)) s += n;
  }
  return s;
}

function computeVisiblePricesForType(args: {
  planSlots: number;
  frameType: FrameTypeCode;
  gender: GenderCode;
  typeActivePrices: Record<number, number>;
  typeSuggestPrices: number[];
}) {
  const { planSlots, frameType, gender, typeActivePrices, typeSuggestPrices } = args;

  const rules = getTypePriceBounds(frameType, gender);
  const activeSum = sumMapCounts(typeActivePrices);

  const soldSuggestAll = (typeSuggestPrices || []).filter((p) => {
    if (!Number.isFinite(p)) return false;
    if (p < rules.min || p > rules.max) return false;
    if ((typeActivePrices[p] || 0) > 0) return false;
    return true;
  });

  const soldSuggestUniq = Array.from(new Set(soldSuggestAll)).sort((a, b) => a - b);

  const remainingByPlan = planSlots > 0 ? Math.max(planSlots - activeSum, 0) : 0;
  const slotsForFormula = planSlots > 0 ? Math.max(remainingByPlan - soldSuggestUniq.length, 0) : 0;

  let formulaPrices: number[] = [];
  if (planSlots > 0 && slotsForFormula > 0) {
    const ladderAll = generatePriceLadder(planSlots, rules.min, rules.max, PRICE_ALPHA);

    const used = new Set<number>();
    Object.keys(typeActivePrices || {}).forEach((k) => {
      const num = Number(k);
      if (Number.isFinite(num)) used.add(num);
    });
    soldSuggestUniq.forEach((p) => used.add(p));

    const free = ladderAll.filter((p) => !used.has(p));
    formulaPrices = free.slice(0, slotsForFormula);
  }

  const visiblePrices = planSlots > 0 ? [...soldSuggestUniq, ...formulaPrices] : soldSuggestUniq;

  return {
    rules,
    activeSum,
    soldSuggestUniq,
    visiblePrices,
    remainingByPlan,
  };
}

function calcTypePlans(totalSlots: number): Record<TypeSectionId, number> {
  const res: Record<TypeSectionId, number> = {} as any;
  TYPE_SECTIONS.forEach((sec) => {
    const share = TYPE_SLOT_SHARE[sec.id] ?? 0;
    res[sec.id] = Math.round((totalSlots || 0) * share);
  });
  return res;
}

function computeBranchTotals(args: {
  plannedSlots: number;
  typeActive: Record<string, Record<number, number>>;
  typeSuggest: Record<string, number[]>;
}) {
  const { plannedSlots, typeActive, typeSuggest } = args;

  const plans = calcTypePlans(plannedSlots);

  let activeAll = 0;
  let toPrintAll = 0;

  for (const sec of TYPE_SECTIONS) {
    const key = makeTypeKey(sec.typeCode, sec.gender);
    const planSlots = plans[sec.id] ?? 0;

    const activePrices = typeActive[key] || {};
    const suggestPrices = typeSuggest[key] || [];

    const calc = computeVisiblePricesForType({
      planSlots,
      frameType: sec.typeCode,
      gender: sec.gender,
      typeActivePrices: activePrices,
      typeSuggestPrices: suggestPrices,
    });

    activeAll += calc.activeSum;
    toPrintAll += calc.visiblePrices.length;
  }

  return { activeAll, toPrintAll };
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

function currentYear2(): number {
  return new Date().getFullYear() % 100;
}

/* ───────────── UI ───────────── */

function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div
      className="rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/85
                 ring-1 ring-sky-200/70 p-4
                 shadow-[0_22px_70px_rgba(15,23,42,0.55)]
                 backdrop-blur-xl text-slate-900
                 transition-transform duration-200 hover:-translate-y-0.5"
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-600">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-slate-600">{hint}</div> : null}
    </div>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  const p = clamp(percent, 0, 100);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200/80">
      <div
        className="h-2 rounded-full bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-400 transition-all"
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

function FillChip({ plannedSlots, filledNow, fillPct }: { plannedSlots: number; filledNow: number; fillPct: number }) {
  if (!plannedSlots || plannedSlots <= 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">
        <AlertTriangle className="h-3.5 w-3.5" />
        план не задан
      </span>
    );
  }

  if (filledNow > plannedSlots) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900 ring-1 ring-amber-200">
        <AlertTriangle className="h-3.5 w-3.5" />
        переполнено
      </span>
    );
  }

  // Градация по заполненности
  if (fillPct >= 100) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200">
        <CheckCircle2 className="h-3.5 w-3.5" />
        норма
      </span>
    );
  }

  if (fillPct >= 95) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900 ring-1 ring-amber-200">
        <AlertTriangle className="h-3.5 w-3.5" />
        желательно пополнить
      </span>
    );
  }

  if (fillPct >= 90) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-medium text-orange-900 ring-1 ring-orange-200">
        <AlertTriangle className="h-3.5 w-3.5" />
        нужно пополнить
      </span>
    );
  }

  if (fillPct >= 85) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-900 ring-1 ring-rose-200">
        <AlertTriangle className="h-3.5 w-3.5" />
        важно пополнить
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-900 ring-1 ring-red-200">
      <AlertTriangle className="h-3.5 w-3.5" />
      срочно пополнить
    </span>
  );
}

function BranchCard({ branch }: { branch: BranchStats }) {
  const planned = branch.plannedSlots || 0;
  const filled = branch.filledNow || 0;
  const missing = branch.missingNow || 0;

  const percent = planned > 0 ? clamp(Math.round((filled * 100) / planned), 0, 100) : 0;
  const freeByCount = planned > 0 ? planned - filled : 0;

  return (
    <div
      className="rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/85
                 ring-1 ring-sky-200/70 p-5
                 shadow-[0_22px_70px_rgba(15,23,42,0.6)]
                 backdrop-blur-xl text-slate-900
                 transition-transform duration-200 hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold tracking-tight text-slate-900">{branch.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <FillChip plannedSlots={planned} filledNow={filled} fillPct={percent} />
            {planned > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200">
                {`к печати: ${missing}`}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white/90 ring-1 ring-slate-200 p-3 shadow-[0_14px_40px_rgba(15,23,42,0.12)]">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">План слотов</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{planned || '—'}</div>
        </div>
        <div className="rounded-2xl bg-white/90 ring-1 ring-slate-200 p-3 shadow-[0_14px_40px_rgba(15,23,42,0.12)]">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Сейчас на витрине</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{filled}</div>
        </div>
        <div className="rounded-2xl bg-white/90 ring-1 ring-slate-200 p-3 shadow-[0_14px_40px_rgba(15,23,42,0.12)]">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">К печати сейчас (по видам)</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{planned > 0 ? missing : '—'}</div>
        </div>
      </div>

      <div className="mt-4">
        <ProgressBar percent={percent} />
        <div className="mt-2 flex items-center justify-between text-[12px] text-slate-600">
          <span>
            Заполненность (по количеству):{' '}
            <span className="font-semibold text-slate-900">{planned > 0 ? `${percent}%` : '—'}</span>
          </span>
          <span className="font-mono text-[12px] text-slate-700">{planned > 0 ? `${filled} / ${planned}` : `${filled} / —`}</span>
        </div>

        {planned > 0 ? (
          <div className="mt-1 text-[11px] text-slate-600">
            Свободно по количеству:{' '}
            <span className={`font-semibold ${freeByCount < 0 ? 'text-amber-700' : 'text-slate-900'}`}>{freeByCount}</span>
            {freeByCount < 0 ? ' (перебор по количеству)' : ''}
          </div>
        ) : null}
      </div>

      <Link
        href={`/settings/barcodes/${branch.id}`}
        className="mt-4 inline-flex w-full items-center justify-center rounded-xl
                   bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400
                   px-4 py-2.5 text-sm font-semibold text-slate-950
                   shadow-[0_16px_45px_rgba(34,211,238,0.28)]
                   hover:brightness-110 active:brightness-95
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

async function fetchRowsForYear(yearNum: number): Promise<YearRow[]> {
  const sb = getSupabase();

  const PAGE = 1000;
  let from = 0;
  let all: YearRow[] = [];

  while (true) {
    const { data, error } = await sb
      .from('frame_barcodes')
      .select('branch_id, price, sold_at, type_code, gender, barcode')
      .eq('year', yearNum)
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
      const yearNum = currentYear2();

      // 2) Все штрихкоды за год (voided_at NULL)
      const rows = await fetchRowsForYear(yearNum);

      // 3) Группировка per-branch: totalMap + activeMap, затем suggestMap
      const byBranch: Record<
        number,
        {
          totalMap: Record<string, Record<number, number>>;
          activeMap: Record<string, Record<number, number>>;
          suggestMap: Record<string, number[]>;
        }
      > = {};

      const ensure = (branchId: number) => {
        if (!byBranch[branchId]) {
          byBranch[branchId] = {
            totalMap: {},
            activeMap: {},
            suggestMap: {},
          };
        }
        return byBranch[branchId];
      };

      for (const r of rows) {
        const bid = r.branch_id;
        if (!bid || !Number.isFinite(bid)) continue;

        const priceNum = r.price == null ? NaN : Number(r.price);
        if (!Number.isFinite(priceNum) || priceNum <= 0) continue;

        const inferred = inferFromBarcode(r.barcode || '');
        const t = (inferred?.typeCode ?? r.type_code ?? null) as FrameTypeCode | null;
        const g = (inferred?.gender ?? r.gender ?? null) as GenderCode | null;
        if (!t || !g) continue;

        const key = makeTypeKey(t, g);
        const slot = ensure(bid);

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

      // 4) Сборка stats: filledNow/missingNow = как нижний блок
      const stats: BranchStats[] = list.map((br) => {
        const plannedSlots = getPlannedSlots(br.id, br.name);
        const disableAutoSuggest = BRANCHES_WITHOUT_AUTO_REPLENISH.includes(br.name);

        const typeActive = (byBranch[br.id]?.activeMap ?? {}) as Record<string, Record<number, number>>;
        const rawSuggest = (byBranch[br.id]?.suggestMap ?? {}) as Record<string, number[]>;
        const typeSuggest = disableAutoSuggest ? {} : rawSuggest;

        const totals = computeBranchTotals({ plannedSlots, typeActive, typeSuggest });

        return {
          id: br.id,
          name: br.name,
          plannedSlots,
          filledNow: totals.activeAll,
          missingNow: totals.toPrintAll,
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
                       bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400
                       shadow-[0_0_26px_rgba(34,211,238,0.55)]"
          >
            <Barcode className="h-5 w-5 text-white drop-shadow-[0_6px_18px_rgba(0,0,0,0.35)]" />
          </div>

          <div>
            <div className="text-3xl font-semibold tracking-tight text-slate-50 drop-shadow-[0_10px_30px_rgba(34,211,238,0.15)]">
              Barcode Overview · филиалы
            </div>
            {loading ? <div className="mt-1 text-[11px] text-sky-200/80">Обновляю данные…</div> : null}
          </div>
        </div>

        {/* Ошибка */}
        {errorText ? (
          <div
            className="mb-6 rounded-3xl bg-gradient-to-r from-rose-50 via-rose-50 to-amber-50
                       ring-1 ring-rose-200 px-5 py-4 text-slate-900
                       shadow-[0_22px_70px_rgba(15,23,42,0.55)]
                       backdrop-blur-xl"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-rose-600" />
              <div>
                <div className="font-semibold">Ошибка загрузки данных</div>
                <div className="mt-1 text-[12px] text-slate-700">{errorText}</div>
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
          <div
            className="rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/85
                       ring-1 ring-sky-200/70 p-6 text-slate-700
                       shadow-[0_22px_70px_rgba(15,23,42,0.45)]
                       backdrop-blur-xl"
          >
            Ничего не найдено.
          </div>
        ) : null}

        {branches.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {branches.map((b) => (
              <BranchCard key={b.id} branch={b} />
            ))}
          </div>
        ) : null}

        {/* Откат штрихкода */}
        <div
          className="mt-8 rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/85
                     ring-1 ring-sky-200/70 p-5
                     shadow-[0_22px_70px_rgba(15,23,42,0.6)]
                     backdrop-blur-xl text-slate-900"
        >
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
                         bg-gradient-to-r from-rose-300 via-amber-200 to-cyan-200 text-slate-950
                         shadow-[0_16px_45px_rgba(15,23,42,0.18)]
                         hover:brightness-105 active:brightness-95
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
