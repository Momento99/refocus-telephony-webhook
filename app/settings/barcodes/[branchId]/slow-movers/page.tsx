'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Hourglass, Download, Copy, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { toBlob } from 'html-to-image';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import { SECTION_VISUAL } from '@/lib/shelfLayoutPlan';
import { type SectionKey } from '@/lib/framePricingFormula';

/* ────────── критерии «неходовости» по возрасту на витрине ──────────
 * age = now − created_at для непроданных (sold_at IS NULL, voided_at IS NULL).
 * Срочность кодируется цветом, точные дни на странице не показываем. */

type Tier = 'yellow' | 'orange' | 'red';

const TIERS: { key: Tier; rank: number; emoji: string; short: string; chip: string; dot: string; txt: string }[] = [
  { key: 'yellow', rank: 1, emoji: '🟡', short: 'присмотреться', chip: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-400', txt: 'text-amber-600' },
  { key: 'orange', rank: 2, emoji: '🟠', short: 'убрать', chip: 'bg-orange-50 text-orange-700 ring-orange-200', dot: 'bg-orange-500', txt: 'text-orange-600' },
  { key: 'red', rank: 3, emoji: '🔴', short: 'срочно', chip: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500', txt: 'text-rose-600' },
];

const TIER_BY_KEY = Object.fromEntries(TIERS.map((t) => [t.key, t])) as Record<Tier, (typeof TIERS)[number]>;

function tierOfAge(ageDays: number): Tier | null {
  if (ageDays >= 210) return 'red';
  if (ageDays >= 150) return 'orange';
  if (ageDays >= 90) return 'yellow';
  return null;
}

/* Порядок секций (RL — унисекс, одна строка) */
const SECTION_ORDER: SectionKey[] = ['PA_F', 'MA_F', 'PA_M', 'MA_M', 'RP_F', 'RM_F', 'KD_F', 'KD_M', 'RL_F'];

/* ────────── разбор barcode (фоллбэк, если type_code/gender пустые) ────────── */

const KNOWN_TYPES = ['RP', 'RM', 'KD', 'PA', 'MA', 'RL'];

function inferFromBarcode(barcodeRaw: string): { typeCode: string; gender: string } | null {
  const barcode = String(barcodeRaw || '').trim().toUpperCase();
  const m = barcode.match(/^([A-Z]{2})([A-Z]{2})([FM])(\d{2})(\d{3,5})$/);
  if (!m) return null;
  const [, , t, g] = m;
  if (!KNOWN_TYPES.includes(t)) return null;
  return { typeCode: t, gender: g };
}

function sectionKeyOf(type: string | null, gender: string | null): SectionKey | null {
  if (!type) return null;
  if (type === 'RL') return 'RL_F'; // унисекс
  if (!gender) return null;
  return `${type}_${gender}` as SectionKey;
}

/* ────────── типы данных ────────── */

type Branch = { id: number; name: string; currency_symbol: string | null };

type SlowFrame = {
  barcode: string;
  section: SectionKey;
  price: number;
  ageDays: number;
  tier: Tier;
};

/* ────────── страница ────────── */

export default function SlowMoversPage() {
  const params = useParams<{ branchId: string }>();
  const branchId = Number(params.branchId);

  const [branch, setBranch] = useState<Branch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [frames, setFrames] = useState<SlowFrame[]>([]);
  const [totalOnShelf, setTotalOnShelf] = useState(0);
  const [firstCreated, setFirstCreated] = useState<string | null>(null);

  const [sectionFilter, setSectionFilter] = useState<SectionKey | 'all'>('all');
  const [minTier, setMinTier] = useState<Tier | 'all'>('all');
  const [sortBy, setSortBy] = useState<'age' | 'price'>('age');

  const shotRef = useRef<HTMLDivElement | null>(null);

  const yearsForShelf = useMemo(() => {
    const cur = new Date().getFullYear() % 100;
    const years: number[] = [];
    for (let y = cur; y >= 24; y--) years.push(y);
    return years;
  }, []);

  const load = useCallback(async () => {
    if (!branchId || Number.isNaN(branchId)) {
      setError('Некорректный ID филиала');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const sb = getBrowserSupabase();

      const { data: b, error: eB } = await sb
        .from('branches')
        .select('id, name, country_id')
        .eq('id', branchId)
        .maybeSingle();
      if (eB) throw eB;
      if (!b) {
        setError('Филиал не найден');
        setLoading(false);
        return;
      }
      let currency_symbol: string | null = null;
      const cid = (b as any).country_id;
      if (cid) {
        const { data: cRow } = await sb
          .from('franchise_countries')
          .select('currency_symbol')
          .eq('id', cid)
          .maybeSingle();
        currency_symbol = (cRow as any)?.currency_symbol ?? null;
      }
      setBranch({ id: (b as any).id, name: (b as any).name, currency_symbol });

      const { data, error: eF } = await sb
        .from('frame_barcodes')
        .select('barcode, type_code, gender, price, created_at')
        .eq('branch_id', branchId)
        .in('year', yearsForShelf)
        .is('sold_at', null)
        .is('voided_at', null);
      if (eF) throw eF;

      const now = Date.now();
      const slow: SlowFrame[] = [];
      let onShelf = 0;
      let minCreated: string | null = null;

      for (const row of (data || []) as any[]) {
        const price = Number(row.price);
        if (!Number.isFinite(price) || price <= 0) continue;
        if (!row.created_at) continue;
        onShelf += 1;
        if (!minCreated || row.created_at < minCreated) minCreated = row.created_at;

        const ageDays = Math.floor((now - new Date(row.created_at).getTime()) / 86_400_000);
        const tier = tierOfAge(ageDays);
        if (!tier) continue;

        let type = (row.type_code as string | null) ?? null;
        let gender = (row.gender as string | null) ?? null;
        if (!type || !gender) {
          const inf = inferFromBarcode(row.barcode);
          if (inf) {
            type = type ?? inf.typeCode;
            gender = gender ?? inf.gender;
          }
        }
        const section = sectionKeyOf(type, gender);
        if (!section) continue;

        slow.push({ barcode: row.barcode, section, price, ageDays, tier });
      }

      setTotalOnShelf(onShelf);
      setFirstCreated(minCreated);
      setFrames(slow);
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [branchId, yearsForShelf]);

  useEffect(() => {
    void load();
  }, [load]);

  const sym = branch?.currency_symbol || 'с';
  const fmtPrice = (p: number) => `${p.toLocaleString('ru-RU')} ${sym}`;

  /* фильтрованный набор */
  const filtered = useMemo(() => {
    const minRank = minTier === 'all' ? 0 : TIER_BY_KEY[minTier].rank;
    return frames
      .filter((f) => (sectionFilter === 'all' ? true : f.section === sectionFilter))
      .filter((f) => TIER_BY_KEY[f.tier].rank >= minRank);
  }, [frames, sectionFilter, minTier]);

  /* сводка по показанному набору */
  const report = useMemo(() => {
    let frozen = 0;
    const byTier: Record<Tier, number> = { yellow: 0, orange: 0, red: 0 };
    for (const f of filtered) {
      frozen += f.price;
      byTier[f.tier] += 1;
    }
    const pct = totalOnShelf > 0 ? Math.round((filtered.length / totalOnShelf) * 100) : 0;
    return { count: filtered.length, frozen, byTier, pct };
  }, [filtered, totalOnShelf]);

  /* группировка по секциям */
  const groups = useMemo(() => {
    const bySection = new Map<SectionKey, SlowFrame[]>();
    for (const f of filtered) {
      const arr = bySection.get(f.section) ?? [];
      arr.push(f);
      bySection.set(f.section, arr);
    }
    const sortFn = (a: SlowFrame, b: SlowFrame) =>
      sortBy === 'age' ? b.ageDays - a.ageDays : b.price - a.price;
    return SECTION_ORDER.filter((s) => bySection.has(s)).map((s) => ({
      section: s,
      items: bySection.get(s)!.sort(sortFn),
    }));
  }, [filtered, sortBy]);

  const todayStr = useMemo(() => new Date().toLocaleDateString('ru-RU'), []);
  const firstCreatedStr = firstCreated ? new Date(firstCreated).toLocaleDateString('ru-RU') : null;

  /* экспорт картинки */
  const exportImage = useCallback(async () => {
    const node = shotRef.current;
    if (!node) return;
    const t = toast.loading('Готовлю картинку…');
    try {
      const blob = await toBlob(node, { pixelRatio: 2, backgroundColor: '#ffffff' });
      if (!blob) throw new Error('Не удалось отрендерить картинку');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `nehodovye-${branch?.name ?? branchId}-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success('Картинка скачана', { id: t });
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось сохранить картинку', { id: t });
    }
  }, [branch?.name, branchId]);

  /* копирование текста для WhatsApp (без дней) */
  const copyText = useCallback(async () => {
    if (!groups.length) {
      toast.error('Нечего копировать');
      return;
    }
    const lines: string[] = [];
    lines.push(`*Убрать с витрины — ${branch?.name ?? ''}*`);
    lines.push(`${todayStr} · ${filtered.length} шт`);
    lines.push('');
    for (const { section, items } of groups) {
      lines.push(`*${SECTION_VISUAL[section].full}* (${items.length})`);
      for (const f of items) {
        lines.push(`${TIER_BY_KEY[f.tier].emoji} ${f.price.toLocaleString('ru-RU')}${sym}  ${f.barcode}`);
      }
      lines.push('');
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n').trim());
      toast.success('Список скопирован — вставь в WhatsApp');
    } catch {
      toast.error('Не удалось скопировать');
    }
  }, [groups, filtered.length, branch?.name, todayStr, sym]);

  /* ───────────────────────── render ───────────────────────── */

  return (
    <div className="mx-auto min-h-screen max-w-6xl p-4 text-sm md:p-6">
      {/* Шапка */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link
            href={`/settings/barcodes/${branchId}`}
            className="mt-0.5 inline-flex items-center gap-1.5 rounded-xl bg-slate-800/60 px-3 py-2 text-xs font-medium text-slate-300 ring-1 ring-slate-700/60 transition hover:bg-slate-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Назад
          </Link>
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
            <Hourglass className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-50">Неходовые оправы</div>
            <div className="mt-0.5 text-[12px] text-cyan-300/50">
              {branch?.name ? `${branch.name} · ` : ''}залежавшиеся на витрине
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800/60 px-3 py-2 text-xs font-medium text-slate-300 ring-1 ring-slate-700/60 transition hover:bg-slate-800"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Обновить
          </button>
          <button
            onClick={() => void copyText()}
            disabled={!frames.length}
            className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500 px-3.5 py-2 text-xs font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 disabled:opacity-40"
          >
            <Copy className="h-3.5 w-3.5" /> Копировать текст
          </button>
          <button
            onClick={() => void exportImage()}
            disabled={!frames.length}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800/60 px-3 py-2 text-xs font-medium text-slate-300 ring-1 ring-slate-700/60 transition hover:bg-slate-800 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> Картинка
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-5 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl bg-white p-10 text-center text-slate-400 ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          Загрузка…
        </div>
      ) : frames.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <div className="text-lg font-bold tracking-tight text-slate-900">Неходовых оправ нет</div>
          <div className="mt-1 max-w-xl text-sm text-slate-600">
            На витрине сейчас нет оправ старше 90 дней без продажи
            {totalOnShelf > 0 ? ` (всего на витрине: ${totalOnShelf})` : ''}. Это нормально, если
            штрих-коды добавлены недавно — данные появятся, когда оправы проведут на витрине больше
            времени.{firstCreatedStr ? ` Первые штрих-коды филиала: ${firstCreatedStr}.` : ''}
          </div>
        </div>
      ) : (
        <>
          {/* Панель управления */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <select
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value as SectionKey | 'all')}
              className="rounded-lg bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-200 ring-1 ring-slate-700/60 outline-none transition hover:bg-slate-800 focus:ring-cyan-500/60"
            >
              <option value="all">Все виды</option>
              {SECTION_ORDER.map((s) => (
                <option key={s} value={s}>
                  {SECTION_VISUAL[s].full}
                </option>
              ))}
            </select>
            <FilterPills<Tier | 'all'>
              value={minTier}
              onChange={setMinTier}
              options={[
                { v: 'all', label: 'Все' },
                { v: 'orange', label: 'Убрать' },
                { v: 'red', label: 'Срочно' },
              ]}
            />
            <span className="mx-0.5 h-5 w-px bg-slate-700/50" />
            <FilterPills<'age' | 'price'>
              value={sortBy}
              onChange={setSortBy}
              options={[
                { v: 'age', label: 'Сначала старые' },
                { v: 'price', label: 'Сначала дорогие' },
              ]}
            />
          </div>

          {/* Карточка-отчёт (она же — экспортируемая картинка) */}
          <div
            ref={shotRef}
            className="rounded-2xl bg-white p-5 ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] md:p-6"
          >
            {/* заголовок отчёта */}
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <div className="text-lg font-bold tracking-tight text-slate-900">
                  Убрать с витрины — {branch?.name}
                </div>
                <div className="mt-0.5 text-[13px] text-slate-500">
                  {report.count} оправ
                  {report.pct > 0 ? ` · ${report.pct}% витрины` : ''} · заморожено{' '}
                  <span className="font-semibold text-slate-700">{fmtPrice(report.frozen)}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[12px] font-medium text-slate-400">{todayStr}</div>
                <div className="mt-1.5 flex items-center justify-end gap-1.5">
                  {TIERS.filter((t) => report.byTier[t.key] > 0).map((t) => (
                    <span
                      key={t.key}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${t.chip}`}
                      title={t.short}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
                      {report.byTier[t.key]}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* секции */}
            {groups.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">
                Под текущие фильтры ничего не попало.
              </div>
            ) : (
              <div className="mt-4 space-y-5">
                {groups.map(({ section, items }) => {
                  const v = SECTION_VISUAL[section];
                  return (
                    <div key={section}>
                      <div className="mb-2 flex items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${v.bg} ${v.text} ${v.ring}`}
                        >
                          {v.full}
                        </span>
                        <span className="text-[11px] font-medium text-slate-400">{items.length}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                        {items.map((f) => {
                          const tier = TIER_BY_KEY[f.tier];
                          return (
                            <div
                              key={f.barcode}
                              className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200/70"
                            >
                              <div className="flex items-start justify-between gap-1">
                                <span className="text-[15px] font-bold leading-none text-slate-900">
                                  {fmtPrice(f.price)}
                                </span>
                                <span
                                  className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${tier.dot}`}
                                  title={tier.short}
                                />
                              </div>
                              <div className="mt-1.5 truncate font-mono text-[13px] font-semibold tracking-tight text-slate-700">
                                {f.barcode}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* легенда срочности */}
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-100 pt-3">
              <span className="text-[11px] text-slate-400">Цвет — срочность:</span>
              {TIERS.map((t) => (
                <span key={t.key} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                  <span className={`h-2 w-2 rounded-full ${t.dot}`} /> {t.short}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ────────── мелкие компоненты ────────── */

function FilterPills<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { v: T; label: string }[];
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-slate-800/60 p-1 ring-1 ring-slate-700/60">
      {options.map((o) => {
        const active = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={
              'rounded-md px-2.5 py-1 text-xs font-semibold transition ' +
              (active ? 'bg-cyan-500 text-white' : 'text-slate-300 hover:text-white')
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
