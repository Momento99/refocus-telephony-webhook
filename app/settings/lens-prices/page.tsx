'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { toast, Toaster } from 'react-hot-toast';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import { Sparkles, RotateCcw, Clock, Layers, Star, Crown, Calculator, ChevronDown, ChevronUp, Wand2, MapPin } from 'lucide-react';
import {
  CITY_INDEX,
  COUNTRIES,
  computeBranchPriceTable,
  type CatalogCosts,
  type LensId,
} from '@/lib/lensPricingFormula';

/* =========================
   Types
========================= */
type Country = {
  id: string;
  name: string;
  currency: string;
  currency_symbol: string;
  exchange_rate: number;
  rate_updated_at: string | null;
  is_active: boolean;
};

type LocalizedLens = {
  lens_id: string;
  country_id: string;
  name: string;
  category: string;
  price_from: number;
  price_to: number;
  currency: string;
  currency_symbol: string;
  has_override: boolean;
  is_active: boolean;
  sort_order: number;
};

type LensCost = {
  lens_id: string;
  lens_name: string;
  category: string;
  sort_order: number;
  cost_price_from: number | null; // до ±2.75 дптр
  cost_price_to: number | null;   // от ±3.00 дптр
  cost_price_updated_at: string | null;
  retail_from: number; // KG, в сомах
  retail_to: number;
};

/* =========================
   Helpers
========================= */
function sb() {
  return getBrowserSupabase();
}

function cx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(' ');
}

const CATEGORY_LABELS: Record<string, { label: string; desc: string; accent: string; accentBg: string; icon: 'layers' | 'star' | 'crown' }> = {
  basic:   { label: 'Базовые',      desc: 'Стандартные линзы',    accent: 'text-white', accentBg: 'bg-cyan-500',    icon: 'layers' },
  special: { label: 'Специальные',  desc: 'Линзы с покрытиями',   accent: 'text-white', accentBg: 'bg-sky-500',     icon: 'star' },
  premium: { label: 'Премиум',      desc: 'Топовые линзы',        accent: 'text-white', accentBg: 'bg-slate-800',   icon: 'crown' },
};

const CATEGORY_ORDER = ['basic', 'special', 'premium'];

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatPrice(val: number, symbol: string) {
  return val.toLocaleString('ru-RU') + '\u00a0' + symbol;
}

type LensNameInfo = { name: string; tag?: string; tagClass?: string };

function getBeautifulName(lensId: string, lensName: string | null | undefined): LensNameInfo {
  const map: Record<string, LensNameInfo> = {
    'standard':         { name: 'Стандарт' },
    'antiglare':        { name: 'Антибликовый', tag: 'AR', tagClass: 'bg-cyan-500/15 text-cyan-600 ring-cyan-500/20' },
    'screen':           { name: 'Защита от экранов', tag: 'Blue Cut', tagClass: 'bg-blue-500/15 text-blue-600 ring-blue-500/20' },
    'chameleon':        { name: 'Хамелеон', tag: 'Photo', tagClass: 'bg-amber-500/15 text-amber-600 ring-amber-500/20' },
    'ast-antiglare':    { name: 'Антиблик', tag: 'AST', tagClass: 'bg-violet-500/15 text-violet-600 ring-violet-500/20' },
    'ast-screen':       { name: 'Защита от экранов', tag: 'AST', tagClass: 'bg-violet-500/15 text-violet-600 ring-violet-500/20' },
    'ast-chameleon':    { name: 'Хамелеон', tag: 'AST', tagClass: 'bg-violet-500/15 text-violet-600 ring-violet-500/20' },
    'polycarbonate':    { name: 'Поликарбонат', tag: 'PC', tagClass: 'bg-emerald-500/15 text-emerald-600 ring-emerald-500/20' },
    'thin':             { name: 'Утонченная', tag: '1.67', tagClass: 'bg-slate-500/15 text-slate-600 ring-slate-500/20' },
    'thin-antiglare':   { name: 'Антибликовый', tag: '1.67', tagClass: 'bg-slate-500/15 text-slate-600 ring-slate-500/20' },
    'thin-screen':      { name: 'Защита от экранов', tag: '1.67', tagClass: 'bg-slate-500/15 text-slate-600 ring-slate-500/20' },
    'meopea-control':   { name: 'Контроль миопии', tag: 'MiYOSMART', tagClass: 'bg-rose-500/15 text-rose-600 ring-rose-500/20' },
    'myopia-control':   { name: 'Контроль миопии', tag: 'MiYOSMART', tagClass: 'bg-rose-500/15 text-rose-600 ring-rose-500/20' },
    'asph-standard':    { name: 'Стандарт', tag: 'ASPH', tagClass: 'bg-teal-500/15 text-teal-600 ring-teal-500/20' },
    'asph-antiglare':   { name: 'Антибликовый', tag: 'ASPH', tagClass: 'bg-teal-500/15 text-teal-600 ring-teal-500/20' },
    'asph-screen':      { name: 'Защита от экранов', tag: 'ASPH', tagClass: 'bg-teal-500/15 text-teal-600 ring-teal-500/20' },
    'chameleon-screen': { name: 'Хамелеон + экран', tag: 'Photo+BC', tagClass: 'bg-amber-500/15 text-amber-600 ring-amber-500/20' },
  };

  if (map[lensId]) return map[lensId];

  const fallback = lensName?.trim() || lensId.replace(/-/g, ' ').replace(/^./, s => s.toUpperCase());
  return { name: fallback };
}

/* ========= UI primitives ========= */

function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx(
      'rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]',
      className,
    )}>
      {children}
    </div>
  );
}

function GBtn({
  children, onClick, disabled, variant = 'solid', type = 'button', className = '', size = 'md', title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'solid' | 'outline' | 'ghost';
  type?: 'button' | 'submit';
  className?: string;
  size?: 'sm' | 'md';
  title?: string;
}) {
  const base = cx(
    'inline-flex items-center gap-1.5 rounded-xl font-semibold transition focus:outline-none focus:ring-2 focus:ring-cyan-300/70',
    'disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
    size === 'sm' ? 'px-2.5 py-1.5 text-[11px]' : 'px-4 py-2.5 text-sm',
  );
  const solid   = 'bg-cyan-500 text-white hover:bg-cyan-400 shadow-[0_4px_16px_rgba(34,211,238,0.28)]';
  const outline = 'bg-white ring-1 ring-slate-200 text-slate-700 hover:bg-slate-50';
  const ghost   = 'text-slate-600 hover:bg-slate-50';
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title}
      className={cx(base, variant === 'solid' ? solid : variant === 'outline' ? outline : ghost, className)}>
      {children}
    </button>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        'w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400',
        'ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70',
        props.className,
      )}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx(
        'w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900',
        'ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70',
        props.className,
      )}
    />
  );
}

/* =========================
   CostRow — изолированный компонент, вынесен из страницы,
   иначе React пересоздаёт input на каждый keystroke → теряется фокус.
========================= */
type CostRowProps = {
  lens: LensCost;
  draft: { from: string; to: string };
  isSaving: boolean;
  onChange: (side: 'from' | 'to', value: string) => void;
  onSave: () => void;
};

function CostRow({ lens, draft, isSaving, onChange, onSave }: CostRowProps) {
  const saved = {
    from: lens.cost_price_from != null ? String(lens.cost_price_from) : '',
    to:   lens.cost_price_to   != null ? String(lens.cost_price_to)   : '',
  };
  const isDirty = draft.from !== saved.from || draft.to !== saved.to;

  const compute = (costRaw: string, retail: number) => {
    const n = Number(costRaw || 0);
    if (!(costRaw !== '' && Number.isFinite(n) && n > 0)) return null;
    const pair = n * 2;
    const markup = retail / pair;
    const marginPct = (1 - 1 / markup) * 100;
    return { pair, markup, marginPct };
  };
  const fromCalc = compute(draft.from, lens.retail_from);
  const toCalc   = compute(draft.to,   lens.retail_to);

  const marginCls = (m: number | null) => {
    if (m == null) return 'bg-slate-100 text-slate-400 ring-slate-200';
    if (m >= 85) return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    if (m >= 70) return 'bg-amber-50 text-amber-700 ring-amber-200';
    return 'bg-rose-50 text-rose-700 ring-rose-200';
  };

  const { name, tag, tagClass } = getBeautifulName(lens.lens_id, lens.lens_name);

  const inputCls =
    'w-[80px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-900 outline-none focus:ring-2 focus:ring-emerald-400 transition';

  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50/40 transition">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-slate-800 text-[13px]">{name}</span>
          {tag && (
            <span className={cx('rounded-md px-1.5 py-0.5 text-[9px] font-bold ring-1', tagClass)}>
              {tag}
            </span>
          )}
        </div>
      </td>

      {/* FROM ±2.75 */}
      <td className="px-2 py-2.5">
        <input
          type="number"
          min={0}
          value={draft.from}
          placeholder="—"
          onChange={(e) => onChange('from', e.target.value)}
          className={inputCls}
        />
      </td>
      <td className="px-2 py-2.5 font-mono text-slate-600 text-[11.5px]">
        {lens.retail_from.toLocaleString('ru-RU')}
        {fromCalc && <span className="ml-1 text-[10px] text-slate-400">·{fromCalc.markup.toFixed(1)}×</span>}
      </td>
      <td className="px-2 py-2.5">
        <span className={cx('inline-flex rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ring-1', marginCls(fromCalc?.marginPct ?? null))}>
          {fromCalc ? `${fromCalc.marginPct.toFixed(0)}%` : '—'}
        </span>
      </td>

      {/* TO ±3.00+ */}
      <td className="px-2 py-2.5 border-l border-slate-100">
        <input
          type="number"
          min={0}
          value={draft.to}
          placeholder="—"
          onChange={(e) => onChange('to', e.target.value)}
          className={inputCls}
        />
      </td>
      <td className="px-2 py-2.5 font-mono text-slate-600 text-[11.5px]">
        {lens.retail_to.toLocaleString('ru-RU')}
        {toCalc && <span className="ml-1 text-[10px] text-slate-400">·{toCalc.markup.toFixed(1)}×</span>}
      </td>
      <td className="px-2 py-2.5">
        <span className={cx('inline-flex rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ring-1', marginCls(toCalc?.marginPct ?? null))}>
          {toCalc ? `${toCalc.marginPct.toFixed(0)}%` : '—'}
        </span>
      </td>

      <td className="px-2 py-2.5">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving || !isDirty}
          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-semibold text-white shadow-[0_4px_12px_rgba(16,185,129,0.28)] hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isSaving ? '…' : 'OK'}
        </button>
      </td>
    </tr>
  );
}

/* =========================
   Page
========================= */
export default function LensPricesSettingsPage() {
  const [countries, setCountries]           = useState<Country[]>([]);
  const [lenses, setLenses]                 = useState<LocalizedLens[]>([]);
  const [activeCountry, setActiveCountry]   = useState<string>('kg');
  const [loading, setLoading]               = useState(false);

  const [editPrices, setEditPrices]         = useState<Record<string, { from: string; to: string }>>({});
  const [savingIds, setSavingIds]           = useState<Set<string>>(new Set());
  const [resetingIds, setResetingIds]       = useState<Set<string>>(new Set());

  const [showAdd, setShowAdd]               = useState(false);
  const [addForm, setAddForm]               = useState({ id: '', name: '', category: 'basic', price_from: '', price_to: '' });
  const [addSaving, setAddSaving]           = useState(false);

  // Себестоимость линз (KGS, за одну линзу) — две графы: слабые/сильные диоптрии
  const [costs, setCosts]                   = useState<LensCost[]>([]);
  const [editCosts, setEditCosts]           = useState<Record<string, { from: string; to: string }>>({});
  const [savingCostIds, setSavingCostIds]   = useState<Set<string>>(new Set());
  const [showCosts, setShowCosts]           = useState(false);

  // Предпросмотр формулы v6 — считается в браузере, в БД не сохраняется
  const [showFormula, setShowFormula]       = useState(false);
  const [formulaCity, setFormulaCity]       = useState<string>('Токмок');

  // Филиальные цены по формуле (branch-level override)
  type BranchFormulaStatus = {
    branch_id: number;
    branch_name: string;
    city: string | null;
    country_id: string | null;
    is_enabled: boolean;
    enabled_at: string | null;
    applied_skus: number;
    last_updated: string | null;
  };
  const [showBranches, setShowBranches]           = useState(false);
  const [branchStatuses, setBranchStatuses]       = useState<BranchFormulaStatus[]>([]);
  const [loadingBranchStatus, setLoadingBranchStatus] = useState(false);
  const [applyingBranchId, setApplyingBranchId]   = useState<number | null>(null);

  const formulaTable = useMemo(() => {
    const input: CatalogCosts = {};
    for (const c of costs) {
      if (c.cost_price_from != null && c.cost_price_to != null) {
        input[c.lens_id as LensId] = {
          costFromKGS: Number(c.cost_price_from) * 2,
          costToKGS:   Number(c.cost_price_to)   * 2,
        };
      }
    }
    try {
      return computeBranchPriceTable(input, formulaCity);
    } catch {
      return {};
    }
  }, [costs, formulaCity]);

  const formulaCityEntry = CITY_INDEX[formulaCity];
  const formulaCountry   = formulaCityEntry ? COUNTRIES[formulaCityEntry.country] : null;
  const formulaCurrency  = formulaCountry?.currencySymbol ?? '';

  async function loadCountries() {
    const { data, error } = await sb()
      .from('franchise_countries')
      .select('*')
      .eq('is_active', true)
      .order('id');
    if (error) { toast.error('Ошибка загрузки стран: ' + error.message); return; }
    setCountries((data as Country[]) || []);
  }

  const loadLenses = useCallback(async (countryId: string) => {
    setLoading(true);
    try {
      const { data, error } = await sb()
        .from('lens_catalog_localized')
        .select('*')
        .eq('country_id', countryId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      const rows = (data as LocalizedLens[]) || [];
      setLenses(rows);
      const ep: Record<string, { from: string; to: string }> = {};
      for (const r of rows) {
        ep[r.lens_id] = { from: String(r.price_from ?? 0), to: String(r.price_to ?? 0) };
      }
      setEditPrices(ep);
    } catch (e: any) {
      toast.error('Ошибка загрузки линз: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCosts = useCallback(async () => {
    const { data, error } = await sb()
      .from('lens_catalog')
      .select('id, name, category, sort_order, cost_price_from, cost_price_to, cost_price_updated_at, price_from, price_to')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) { toast.error('Ошибка загрузки себестоимости: ' + error.message); return; }
    const rows = ((data as Array<{
      id: string; name: string; category: string; sort_order: number;
      cost_price_from: number | null; cost_price_to: number | null;
      cost_price_updated_at: string | null;
      price_from: number; price_to: number;
    }>) || []).map((r) => ({
      lens_id: r.id,
      lens_name: r.name,
      category: r.category,
      sort_order: r.sort_order,
      cost_price_from: r.cost_price_from,
      cost_price_to: r.cost_price_to,
      cost_price_updated_at: r.cost_price_updated_at,
      retail_from: r.price_from,
      retail_to: r.price_to,
    }));
    setCosts(rows);
    const ec: Record<string, { from: string; to: string }> = {};
    for (const r of rows) {
      ec[r.lens_id] = {
        from: r.cost_price_from != null ? String(r.cost_price_from) : '',
        to:   r.cost_price_to   != null ? String(r.cost_price_to)   : '',
      };
    }
    setEditCosts(ec);
  }, []);

  async function saveCost(lensId: string) {
    const draft = editCosts[lensId] ?? { from: '', to: '' };
    const fromVal = draft.from === '' ? null : Number(draft.from);
    const toVal   = draft.to === ''   ? null : Number(draft.to);
    if ((fromVal !== null && (!Number.isFinite(fromVal) || fromVal < 0)) ||
        (toVal   !== null && (!Number.isFinite(toVal)   || toVal   < 0))) {
      toast.error('Некорректная себестоимость'); return;
    }
    setSavingCostIds((s) => new Set(s).add(lensId));
    try {
      const { error } = await sb().from('lens_catalog')
        .update({
          cost_price_from: fromVal,
          cost_price_to:   toVal,
          cost_price_updated_at: new Date().toISOString(),
        })
        .eq('id', lensId);
      if (error) throw error;
      toast.success('Себестоимость сохранена');
      await loadCosts();
    } catch (e: any) {
      toast.error('Ошибка: ' + e.message);
    } finally {
      setSavingCostIds((s) => { const n = new Set(s); n.delete(lensId); return n; });
    }
  }

  const loadBranchStatuses = useCallback(async () => {
    setLoadingBranchStatus(true);
    try {
      const res = await fetch('/api/lens-branch-prices');
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'unknown_error');
      setBranchStatuses(json.branches as BranchFormulaStatus[]);
    } catch (e: any) {
      toast.error('Ошибка статуса филиалов: ' + e.message);
    } finally {
      setLoadingBranchStatus(false);
    }
  }, []);

  async function applyFormulaToBranch(branchId: number, city: string) {
    // Собираем cost для формулы
    const input: CatalogCosts = {};
    for (const c of costs) {
      if (c.cost_price_from != null && c.cost_price_to != null) {
        input[c.lens_id as LensId] = {
          costFromKGS: Number(c.cost_price_from) * 2,
          costToKGS:   Number(c.cost_price_to)   * 2,
        };
      }
    }
    if (Object.keys(input).length === 0) {
      toast.error('Нет заполненных себестоимостей'); return;
    }
    let table;
    try {
      table = computeBranchPriceTable(input, city);
    } catch (e: any) {
      toast.error(`Город «${city}» не в CITY_INDEX: ${e.message}`); return;
    }
    // Собираем prices[]
    const lensIds = new Set<string>();
    for (const key in table) {
      const m = key.match(/^(.+)_(from|to)$/);
      if (m) lensIds.add(m[1]);
    }
    const prices: Array<{ lens_id: string; price_from: number; price_to: number }> = [];
    for (const lensId of lensIds) {
      const from = table[`${lensId as LensId}_from`];
      const to   = table[`${lensId as LensId}_to`];
      if (from && to) {
        prices.push({ lens_id: lensId, price_from: from.price, price_to: to.price });
      }
    }
    if (prices.length === 0) { toast.error('Формула не вернула ни одной линзы'); return; }

    setApplyingBranchId(branchId);
    try {
      const res = await fetch('/api/lens-branch-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_id: branchId, prices }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'unknown_error');
      toast.success(`Применено для «${city}»: ${json.result?.applied ?? prices.length} линз`);
      await loadBranchStatuses();
    } catch (e: any) {
      toast.error('Ошибка: ' + e.message);
    } finally {
      setApplyingBranchId(null);
    }
  }

  async function disableFormulaForBranch(branchId: number, branchName: string) {
    if (!confirm(`Выключить формулу для «${branchName}»?\nФилиал вернётся к ценам страны.`)) return;
    setApplyingBranchId(branchId);
    try {
      const res = await fetch(`/api/lens-branch-prices?branch_id=${branchId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'unknown_error');
      toast.success('Формула выключена');
      await loadBranchStatuses();
    } catch (e: any) {
      toast.error('Ошибка: ' + e.message);
    } finally {
      setApplyingBranchId(null);
    }
  }

  useEffect(() => { loadCountries(); loadCosts(); loadBranchStatuses(); }, [loadCosts, loadBranchStatuses]);
  useEffect(() => { loadLenses(activeCountry); }, [activeCountry, loadLenses]);

  const grouped = CATEGORY_ORDER.map(cat => ({
    cat,
    meta: CATEGORY_LABELS[cat] ?? { label: cat, color: 'bg-slate-100 text-slate-500' },
    items: lenses.filter(l => l.category === cat),
  })).filter(g => g.items.length > 0);

  async function savePrice(lensId: string) {
    const ep = editPrices[lensId];
    if (!ep) return;
    const fromVal = parseInt(ep.from, 10);
    const toVal   = parseInt(ep.to, 10);
    if (isNaN(fromVal) || isNaN(toVal) || fromVal < 0 || toVal < 0) {
      toast.error('Некорректная цена'); return;
    }
    setSavingIds(s => new Set(s).add(lensId));
    try {
      if (activeCountry === 'kg') {
        const { error } = await sb().from('lens_catalog')
          .update({ price_from: fromVal, price_to: toVal }).eq('id', lensId);
        if (error) throw error;
      } else {
        const { error } = await sb().from('lens_catalog_prices')
          .upsert({ country_id: activeCountry, lens_id: lensId, price_from: fromVal, price_to: toVal },
            { onConflict: 'country_id,lens_id' });
        if (error) throw error;
      }
      toast.success('Цена сохранена');
      await loadLenses(activeCountry);
    } catch (e: any) {
      toast.error('Ошибка: ' + e.message);
    } finally {
      setSavingIds(s => { const n = new Set(s); n.delete(lensId); return n; });
    }
  }

  async function resetOverride(lensId: string) {
    setResetingIds(s => new Set(s).add(lensId));
    try {
      const { error } = await sb().from('lens_catalog_prices')
        .delete().eq('country_id', activeCountry).eq('lens_id', lensId);
      if (error) throw error;
      toast.success('Сброшено — используется автокурс');
      await loadLenses(activeCountry);
    } catch (e: any) {
      toast.error('Ошибка: ' + e.message);
    } finally {
      setResetingIds(s => { const n = new Set(s); n.delete(lensId); return n; });
    }
  }

  // toggleActive removed — hiding lenses is disabled

  async function submitAdd() {
    const slugOk = /^[a-z0-9-]+$/.test(addForm.id);
    if (!slugOk) { toast.error('ID: только строчные латинские буквы, цифры и дефис'); return; }
    if (!addForm.name.trim()) { toast.error('Укажи название'); return; }
    const pf = parseInt(addForm.price_from, 10);
    const pt = parseInt(addForm.price_to, 10);
    if (isNaN(pf) || isNaN(pt) || pf < 0 || pt < 0) { toast.error('Некорректные цены'); return; }
    setAddSaving(true);
    try {
      const { error } = await sb().from('lens_catalog').insert({
        id: addForm.id, name: addForm.name.trim(),
        category: addForm.category, price_from: pf, price_to: pt, is_active: true,
      });
      if (error) throw error;
      toast.success('Линза добавлена');
      setShowAdd(false);
      setAddForm({ id: '', name: '', category: 'basic', price_from: '', price_to: '' });
      await loadLenses(activeCountry);
    } catch (e: any) {
      toast.error('Ошибка: ' + e.message);
    } finally {
      setAddSaving(false);
    }
  }

  const activeCountryData = countries.find(c => c.id === activeCountry);
  const otherCountries    = countries.filter(c => c.id !== 'kg');

  return (
    <div className="text-slate-50">
      <Toaster position="top-right" />

      <div className="space-y-5">

        {/* Header (бренд-стандарт) */}
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-50">Цены на линзы</div>
            <div className="mt-0.5 text-[12px] text-cyan-300/50">
              Мультивалютный каталог · цены синхронизируются на кассу и тач-экран
            </div>
          </div>
        </div>

        {/* ── Себестоимость линз (KGS, за одну линзу) ── */}
        <div className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] overflow-hidden">
          <button
            type="button"
            onClick={() => setShowCosts((s) => !s)}
            className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50/60 transition"
          >
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500 shadow-[0_4px_12px_rgba(16,185,129,0.28)]">
              <Calculator className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 text-left">
              <div className="text-[15px] font-semibold text-slate-900">Себестоимость линз</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                За одну линзу в сомах · маржа и наценка считаются автоматически
              </div>
            </div>
            <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
              {costs.filter((c) => c.cost_price_from != null || c.cost_price_to != null).length}/{costs.length} заполнено
            </span>
            {showCosts ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
          </button>

          {showCosts && (
            <div className="border-t border-slate-100 p-5 space-y-4">
              {CATEGORY_ORDER.map((cat) => {
                const meta = CATEGORY_LABELS[cat];
                const items = costs.filter((c) => c.category === cat);
                if (items.length === 0) return null;

                const CatIcon = meta?.icon === 'layers' ? Layers : meta?.icon === 'star' ? Star : Crown;

                return (
                  <div key={cat} className="rounded-xl ring-1 ring-slate-200 overflow-hidden">
                    {/* Category header */}
                    <div className={cx('flex items-center gap-2.5 px-4 py-2.5', meta?.accentBg ?? 'bg-slate-500')}>
                      <CatIcon size={16} className="text-white" />
                      <div className="flex-1">
                        <div className="text-[12px] font-bold text-white uppercase tracking-wide">{meta?.label ?? cat}</div>
                        <div className="text-[10px] text-white/70">{meta?.desc ?? ''}</div>
                      </div>
                      <span className="rounded-md bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-white">
                        {items.length} поз.
                      </span>
                    </div>

                    {/* Rows */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="text-left text-[9.5px] uppercase tracking-wide text-slate-400 bg-slate-50/60">
                            <th className="px-3 py-2 font-semibold min-w-[170px]">Линза</th>
                            <th className="px-2 py-2 font-semibold" colSpan={3}>До ±2.75 дптр</th>
                            <th className="px-2 py-2 font-semibold" colSpan={3}>От ±3.00 дптр</th>
                            <th className="px-2 py-2"></th>
                          </tr>
                          <tr className="text-left text-[9.5px] text-slate-400 bg-slate-50/40">
                            <th></th>
                            <th className="px-2 py-1 font-normal">закуп/шт</th>
                            <th className="px-2 py-1 font-normal">розница</th>
                            <th className="px-2 py-1 font-normal">маржа</th>
                            <th className="px-2 py-1 font-normal border-l border-slate-200">закуп/шт</th>
                            <th className="px-2 py-1 font-normal">розница</th>
                            <th className="px-2 py-1 font-normal">маржа</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((lens) => (
                            <CostRow
                              key={lens.lens_id}
                              lens={lens}
                              draft={editCosts[lens.lens_id] ?? { from: '', to: '' }}
                              isSaving={savingCostIds.has(lens.lens_id)}
                              onChange={(side, value) =>
                                setEditCosts((prev) => {
                                  const prevDraft = prev[lens.lens_id] ?? { from: '', to: '' };
                                  return { ...prev, [lens.lens_id]: { ...prevDraft, [side]: value } };
                                })
                              }
                              onSave={() => saveCost(lens.lens_id)}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Предпросмотр формулы v6 (без записи в БД) ── */}
        <div className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] overflow-hidden">
          <button
            type="button"
            onClick={() => setShowFormula((s) => !s)}
            className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50/60 transition"
          >
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cyan-500 shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
              <Wand2 className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 text-left">
              <div className="text-[15px] font-semibold text-slate-900">Предпросмотр формулы v6</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Считается из себестоимости · НЕ сохраняется в БД · только для просмотра
              </div>
            </div>
            <select
              value={formulaCity}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setFormulaCity(e.target.value)}
              className="rounded-lg bg-white ring-1 ring-sky-200 px-2.5 py-1 text-[11px] text-slate-700 outline-none focus:ring-2 focus:ring-cyan-400/70"
            >
              {(['KG', 'UZ', 'KZ', 'RU'] as const).map((cc) => {
                const cities = Object.entries(CITY_INDEX).filter(([, v]) => v.country === cc);
                return (
                  <optgroup key={cc} label={COUNTRIES[cc].name}>
                    {cities.map(([name]) => <option key={name} value={name}>{name}</option>)}
                  </optgroup>
                );
              })}
            </select>
            {showFormula ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
          </button>

          {showFormula && (
            <div className="border-t border-slate-100">
              <div className="px-4 py-3 bg-cyan-50 border-b border-cyan-100 flex flex-wrap items-center gap-3">
                <div className="text-[12px] text-slate-600">
                  Город: <span className="font-bold text-slate-800">{formulaCity}</span>
                  {formulaCityEntry && (
                    <span className="ml-2 font-mono text-slate-500">
                      K = {(COUNTRIES[formulaCityEntry.country].countryIndex * formulaCityEntry.cityMultiplier).toFixed(2)}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  Валюта: <span className="font-semibold">{formulaCountry?.currency}</span>
                </div>
                <div className="flex-1" />
                <div className="rounded-lg bg-white/70 border border-fuchsia-200 px-2.5 py-1 text-[11px] font-semibold text-fuchsia-700">
                  Read-only
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[9.5px] uppercase tracking-wide text-slate-400 bg-slate-50/60">
                      <th className="px-3 py-2 font-semibold min-w-[170px]">Линза</th>
                      <th className="px-2 py-2 font-semibold">Cost пары (KGS)</th>
                      <th className="px-2 py-2 font-semibold border-l border-slate-200" colSpan={3}>До ±2.75 дптр</th>
                      <th className="px-2 py-2 font-semibold border-l border-slate-200" colSpan={3}>От ±3.00 дптр</th>
                    </tr>
                    <tr className="text-left text-[9.5px] text-slate-400 bg-slate-50/40">
                      <th></th>
                      <th className="px-2 py-1 font-normal">from / to</th>
                      <th className="px-2 py-1 font-normal border-l border-slate-200">текущая</th>
                      <th className="px-2 py-1 font-normal">формула</th>
                      <th className="px-2 py-1 font-normal">маржа / Δ</th>
                      <th className="px-2 py-1 font-normal border-l border-slate-200">текущая</th>
                      <th className="px-2 py-1 font-normal">формула</th>
                      <th className="px-2 py-1 font-normal">маржа / Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CATEGORY_ORDER.map((cat) => {
                      const meta = CATEGORY_LABELS[cat];
                      const items = costs.filter((c) => c.category === cat);
                      if (items.length === 0) return null;
                      return (
                        <React.Fragment key={cat}>
                          <tr>
                            <td colSpan={8} className={cx('px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white', meta?.accentBg)}>
                              {meta?.label}
                            </td>
                          </tr>
                          {items.map((lens) => {
                            const resFrom = formulaTable[`${lens.lens_id as LensId}_from`];
                            const resTo   = formulaTable[`${lens.lens_id as LensId}_to`];
                            const { name, tag, tagClass } = getBeautifulName(lens.lens_id, lens.lens_name);
                            const hasCosts = lens.cost_price_from != null && lens.cost_price_to != null;
                            const costPair = hasCosts
                              ? `${Number(lens.cost_price_from) * 2} / ${Number(lens.cost_price_to) * 2}`
                              : '—';

                            // retail в БД хранится в KGS — сравнение Δ корректно только для KG городов
                            const isKG = formulaCityEntry?.country === 'KG';
                            const currFrom = isKG ? lens.retail_from : null;
                            const currTo   = isKG ? lens.retail_to   : null;

                            const deltaFrom = resFrom && currFrom != null ? resFrom.price - currFrom : null;
                            const deltaTo   = resTo   && currTo   != null ? resTo.price   - currTo   : null;

                            const deltaCls = (d: number | null) => {
                              if (d == null) return 'text-slate-400';
                              if (d > 0) return 'text-emerald-600';
                              if (d < 0) return 'text-rose-600';
                              return 'text-slate-500';
                            };

                            const marginCls = (m?: number) => {
                              if (m == null) return 'bg-slate-100 text-slate-400 ring-slate-200';
                              if (m >= 85) return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
                              if (m >= 70) return 'bg-amber-50 text-amber-700 ring-amber-200';
                              return 'bg-rose-50 text-rose-700 ring-rose-200';
                            };

                            return (
                              <tr key={lens.lens_id} className="border-t border-slate-100 hover:bg-fuchsia-50/20 transition">
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-medium text-slate-800 text-[12.5px]">{name}</span>
                                    {tag && (
                                      <span className={cx('rounded-md px-1.5 py-0.5 text-[9px] font-bold ring-1', tagClass)}>
                                        {tag}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-2 py-2 font-mono text-slate-500 text-[11px]">
                                  {costPair}
                                </td>

                                {/* FROM */}
                                <td className="px-2 py-2 font-mono text-slate-500 border-l border-slate-100 text-[11px]">
                                  {currFrom != null ? currFrom.toLocaleString('ru-RU') : '—'}
                                </td>
                                <td className="px-2 py-2 font-mono font-bold text-fuchsia-700 text-[12px]">
                                  {resFrom ? `${resFrom.price.toLocaleString('ru-RU')} ${formulaCurrency}` : '—'}
                                </td>
                                <td className="px-2 py-2 text-[11px]">
                                  <div className="flex items-center gap-1.5">
                                    {resFrom && (
                                      <span className={cx('inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1', marginCls(resFrom.marginPercent))}>
                                        {resFrom.marginPercent.toFixed(0)}%
                                      </span>
                                    )}
                                    {deltaFrom != null && (
                                      <span className={cx('font-mono text-[10.5px] font-semibold', deltaCls(deltaFrom))}>
                                        {deltaFrom > 0 ? '+' : ''}{deltaFrom.toLocaleString('ru-RU')}
                                      </span>
                                    )}
                                  </div>
                                </td>

                                {/* TO */}
                                <td className="px-2 py-2 font-mono text-slate-500 border-l border-slate-100 text-[11px]">
                                  {currTo != null ? currTo.toLocaleString('ru-RU') : '—'}
                                </td>
                                <td className="px-2 py-2 font-mono font-bold text-fuchsia-700 text-[12px]">
                                  {resTo ? `${resTo.price.toLocaleString('ru-RU')} ${formulaCurrency}` : '—'}
                                </td>
                                <td className="px-2 py-2 text-[11px]">
                                  <div className="flex items-center gap-1.5">
                                    {resTo && (
                                      <span className={cx('inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1', marginCls(resTo.marginPercent))}>
                                        {resTo.marginPercent.toFixed(0)}%
                                      </span>
                                    )}
                                    {deltaTo != null && (
                                      <span className={cx('font-mono text-[10.5px] font-semibold', deltaCls(deltaTo))}>
                                        {deltaTo > 0 ? '+' : ''}{deltaTo.toLocaleString('ru-RU')}
                                      </span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-2.5 bg-slate-50/60 border-t border-slate-100 text-[10.5px] text-slate-500 flex items-center gap-2">
                <Sparkles size={11} className="text-cyan-500" />
                Цены рассчитаны формулой v6 из себестоимостей. Ничего в базу не записано.
                Пустое «—» = не заполнена себестоимость или линза вне формулы.
              </div>
            </div>
          )}
        </div>

        {/* ── Филиальные цены по формуле ── */}
        <div className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] overflow-hidden">
          <button
            type="button"
            onClick={() => setShowBranches((s) => !s)}
            className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50/60 transition"
          >
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cyan-500 shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
              <MapPin className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 text-left">
              <div className="text-[15px] font-semibold text-slate-900">Филиальные цены по формуле</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                По умолчанию филиал использует цены страны. Формулу можно включить как исключение (например, для Токмока).
              </div>
            </div>
            <span className="rounded-lg bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-700 ring-1 ring-cyan-200">
              {branchStatuses.filter(b => b.is_enabled).length}/{branchStatuses.length} с формулой
            </span>
            {showBranches ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
          </button>

          {showBranches && (
            <div className="border-t border-slate-100">
              {loadingBranchStatus ? (
                <div className="p-8 text-center text-sm text-slate-400">
                  <Sparkles className="mx-auto mb-2 h-5 w-5 animate-spin text-cyan-500" />
                  Загрузка…
                </div>
              ) : branchStatuses.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400">Нет филиалов</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400 bg-slate-50/60">
                        <th className="px-4 py-2 font-semibold">Филиал</th>
                        <th className="px-3 py-2 font-semibold">Страна</th>
                        <th className="px-3 py-2 font-semibold">Статус</th>
                        <th className="px-3 py-2 font-semibold">SKU</th>
                        <th className="px-3 py-2 font-semibold">Обновлено</th>
                        <th className="px-3 py-2 font-semibold text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {branchStatuses.map(b => {
                        const cityInFormula = b.city && CITY_INDEX[b.city];
                        const cityUnknown = Boolean(b.city && !cityInFormula);
                        return (
                          <tr key={b.branch_id} className="border-t border-slate-100 hover:bg-slate-50/40 transition">
                            <td className="px-4 py-2.5">
                              <div className="font-medium text-slate-800">{b.branch_name}</div>
                              <div className="text-[10.5px] text-slate-400">{b.city ?? '—'} · id={b.branch_id}</div>
                            </td>
                            <td className="px-3 py-2.5 text-slate-500 uppercase text-[11px]">{b.country_id ?? '—'}</td>
                            <td className="px-3 py-2.5">
                              {b.is_enabled ? (
                                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-2 py-0.5 text-[11px] font-semibold">
                                  ● ВКЛ
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 text-slate-500 ring-1 ring-slate-200 px-2 py-0.5 text-[11px]">
                                  ○ выкл
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-slate-600">
                              {b.applied_skus}
                            </td>
                            <td className="px-3 py-2.5 text-slate-500 text-[11px]">
                              {b.last_updated ? formatDate(b.last_updated) : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <div className="flex justify-end gap-1.5 flex-wrap">
                                {cityUnknown && (
                                  <span className="inline-flex items-center rounded-md bg-rose-50 text-rose-600 ring-1 ring-rose-200 px-2 py-1 text-[10.5px] font-semibold">
                                    Город «{b.city}» не в CITY_INDEX
                                  </span>
                                )}
                                {cityInFormula && (
                                  <button
                                    type="button"
                                    onClick={() => applyFormulaToBranch(b.branch_id, b.city!)}
                                    disabled={applyingBranchId === b.branch_id}
                                    className="rounded-lg bg-cyan-500 px-3 py-1.5 text-[11px] font-semibold text-white shadow-[0_4px_12px_rgba(34,211,238,0.28)] hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed transition"
                                  >
                                    {applyingBranchId === b.branch_id
                                      ? '…'
                                      : b.is_enabled ? 'Пересчитать' : 'Применить формулу'}
                                  </button>
                                )}
                                {b.is_enabled && (
                                  <button
                                    type="button"
                                    onClick={() => disableFormulaForBranch(b.branch_id, b.branch_name)}
                                    disabled={applyingBranchId === b.branch_id}
                                    className="rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 text-[11px] font-semibold transition disabled:opacity-40"
                                  >
                                    Выкл
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="px-4 py-2.5 bg-slate-50/60 border-t border-slate-100 text-[10.5px] text-slate-500 flex items-center gap-2">
                <Sparkles size={11} className="text-cyan-500" />
                При нажатии «Применить» формула пересчитает цены из себестоимости и запишет их в БД. POS/Kiosk филиала увидят их при следующем запросе.
              </div>
            </div>
          )}
        </div>

        {/* ── Вкладки стран ── */}
        <div className="px-2 py-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-cyan-300/60">Страна</p>
          <div className="flex flex-wrap gap-2">
            {countries.map(c => (
              <button
                key={c.id}
                onClick={() => setActiveCountry(c.id)}
                className={cx(
                  'inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition',
                  activeCountry === c.id
                    ? 'bg-cyan-500 text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)]'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50',
                )}
              >
                <span>{c.name}</span>
                <span className={cx(
                  'rounded-lg px-2 py-0.5 text-[10px] font-bold',
                  activeCountry === c.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400',
                )}>
                  {c.currency}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Таблица линз ── */}
        <div className="px-2 py-5">
          {/* Заголовок секции */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-bold text-white">
                {activeCountryData?.name ?? activeCountry}
              </h2>
              <p className="text-[12px] text-slate-400 mt-0.5">
                Валюта: <span className="font-semibold text-slate-300">{activeCountryData?.currency_symbol} ({activeCountryData?.currency})</span>
                {activeCountry !== 'kg' && activeCountryData?.exchange_rate
                  ? <> · Курс: <span className="font-mono text-cyan-400">1 KGS = {(1 / activeCountryData.exchange_rate).toFixed(4)} {activeCountryData.currency_symbol}</span></>
                  : ''}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="py-16 text-center text-sm text-slate-400">
              <Sparkles className="mx-auto mb-2 h-5 w-5 animate-spin text-sky-400" />
              Загрузка…
            </div>
          ) : grouped.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-400">Нет данных</div>
          ) : (
            <div className="space-y-6">
              {grouped.map(({ cat, meta, items }) => (
                <div key={cat} className="overflow-hidden rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
                  {/* Заголовок категории */}
                  <div className={cx('px-4 py-3.5 flex items-center gap-3', meta.accentBg)}>
                    <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                      {meta.icon === 'layers' && <Layers size={18} className="text-white" />}
                      {meta.icon === 'star' && <Star size={18} className="text-white" />}
                      {meta.icon === 'crown' && <Crown size={18} className="text-white" />}
                    </div>
                    <div>
                      <div className="text-[14px] font-bold text-white">{meta.label}</div>
                      <div className="text-[11px] text-white/60">{meta.desc} · {items.length} шт.</div>
                    </div>
                  </div>
                  <div className="bg-white">
                    <table className="min-w-full text-[13px] leading-tight">
                      <thead>
                        <tr className="text-[11px] font-semibold tracking-wide text-slate-500 border-b border-slate-100/60">
                          <th className="px-3 py-2.5 text-left">Линза</th>
                          <th className="px-3 py-2.5 text-right w-36">
                            <span className="text-cyan-600">до ±2.75</span>
                          </th>
                          <th className="px-3 py-2.5 text-right w-36">
                            <span className="text-cyan-600">от ±3.00 и выше</span>
                          </th>
                          <th className="px-3 py-2.5 text-right w-28"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/50">
                        {items.map(lens => {
                          const ep         = editPrices[lens.lens_id] ?? { from: String(lens.price_from), to: String(lens.price_to) };
                          const isSaving   = savingIds.has(lens.lens_id);
                          const isReseting = resetingIds.has(lens.lens_id);
                          return (
                            <tr
                              key={lens.lens_id}
                              className="transition-colors hover:bg-sky-50/40 group"
                            >
                              <td className="px-3 py-3">
                                {(() => {
                                  const info = getBeautifulName(lens.lens_id, lens.name);
                                  return (
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-slate-800 text-[13px]">{info.name}</span>
                                      {info.tag && (
                                        <span className={cx('text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md ring-1', info.tagClass)}>
                                          {info.tag}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })()}
                              </td>

                              <td className="px-3 py-2.5 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <input
                                    className="w-20 rounded-lg bg-white ring-1 ring-sky-200 px-2 py-1 text-right text-[12px] text-slate-900 outline-none focus:ring-2 focus:ring-cyan-400/70 transition"
                                    value={ep.from}
                                    onChange={e => setEditPrices(p => ({ ...p, [lens.lens_id]: { ...ep, from: e.target.value } }))}
                                  />
                                  <span className="text-[10px] text-slate-400">{lens.currency_symbol}</span>
                                </div>
                              </td>

                              <td className="px-3 py-2.5 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <input
                                    className="w-20 rounded-lg bg-white ring-1 ring-sky-200 px-2 py-1 text-right text-[12px] text-slate-900 outline-none focus:ring-2 focus:ring-cyan-400/70 transition"
                                    value={ep.to}
                                    onChange={e => setEditPrices(p => ({ ...p, [lens.lens_id]: { ...ep, to: e.target.value } }))}
                                  />
                                  <span className="text-[10px] text-slate-400">{lens.currency_symbol}</span>
                                </div>
                              </td>

                              <td className="px-3 py-2.5 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <GBtn size="sm" onClick={() => savePrice(lens.lens_id)} disabled={isSaving}>
                                    {isSaving ? '…' : 'Сохранить'}
                                  </GBtn>
                                  {activeCountry !== 'kg' && lens.has_override && (
                                    <GBtn size="sm" variant="outline" onClick={() => resetOverride(lens.lens_id)} disabled={isReseting} title="Сбросить на автокурс">
                                      <RotateCcw className="h-3 w-3" />
                                    </GBtn>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Курсы валют (только чтение) ── */}
        {otherCountries.length > 0 && (
          <div className="px-2 py-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-[17px] font-bold text-white">Курсы валют</h2>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Clock size={11} />
                  Обновляются автоматически каждый день из ЦБ РФ
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {otherCountries.map(c => (
                <div
                  key={c.id}
                  className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] p-4"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="text-[13px] font-semibold text-slate-800">{c.name}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{c.currency} · {c.currency_symbol}</div>
                    </div>
                    <span className="rounded-xl bg-cyan-50 ring-1 ring-cyan-200 px-2.5 py-1 text-[12px] font-mono font-semibold text-cyan-700">
                      {c.exchange_rate?.toFixed(4) ?? '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Clock size={11} className="shrink-0" />
                    <span>
                      {c.rate_updated_at
                        ? <>Обновлён {formatDate(c.rate_updated_at)}</>
                        : 'Дата неизвестна'}
                    </span>
                  </div>
                  <div className="mt-2 text-[10px] text-slate-400">
                    1 KGS = {c.exchange_rate ? (1 / c.exchange_rate).toFixed(4) : '—'} {c.currency_symbol}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* ── Модал: добавить линзу ── */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 backdrop-blur-sm p-4"
          onClick={() => setShowAdd(false)}
        >
          <div
            className="w-[540px] max-w-[95vw] rounded-3xl bg-white ring-1 ring-sky-100 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.4)]"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="mb-1 text-base font-semibold text-slate-900">Добавить линзу</h3>
            <p className="mb-5 text-xs text-slate-400">
              Цены для других стран будут рассчитаны автоматически по текущему курсу.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-xs font-semibold text-slate-600">
                  ID (slug) — только a–z, 0–9, дефис
                </span>
                <Input
                  placeholder="antiglare, chameleon-brown, blue-cut"
                  value={addForm.id}
                  onChange={e => setAddForm(p => ({ ...p, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                />
              </label>
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-xs font-semibold text-slate-600">Название на русском</span>
                <Input
                  placeholder="Антибликовое, Защита от экранов, Хамелеон…"
                  value={addForm.name}
                  onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Категория</span>
                <Select value={addForm.category} onChange={e => setAddForm(p => ({ ...p, category: e.target.value }))}>
                  <option value="basic">Базовые</option>
                  <option value="special">Специальные</option>
                  <option value="premium">Премиум</option>
                </Select>
              </label>
              <div />
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">до ±2.75 (сом)</span>
                <Input type="number" min={0} placeholder="1 000" value={addForm.price_from}
                  onChange={e => setAddForm(p => ({ ...p, price_from: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-600">±3.00 и выше (сом)</span>
                <Input type="number" min={0} placeholder="2 500" value={addForm.price_to}
                  onChange={e => setAddForm(p => ({ ...p, price_to: e.target.value }))} />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <GBtn variant="outline" onClick={() => setShowAdd(false)}>Отмена</GBtn>
              <GBtn onClick={submitAdd} disabled={addSaving}>
                {addSaving ? 'Сохраняю…' : 'Добавить'}
              </GBtn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
