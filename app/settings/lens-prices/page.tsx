'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { toast, Toaster } from 'react-hot-toast';
import getSupabase from '@/lib/supabaseClient';
import { RefreshCw, Plus, Sparkles } from 'lucide-react';

/* =========================
   Types
========================= */
type LensRow = {
  id: number | string;
  lens_type: string | null;
  refr_index: number | null;
  coating: string | null;
  is_astigmatism: boolean | null;
  sph_min: number | null;
  sph_max: number | null;
  price: number;
  currency: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/* =========================
   Helpers
========================= */
function sb() {
  const c = getSupabase?.();
  if (!c) throw new Error('Supabase client is not configured');
  return c;
}

function parsePrice(val: string): number | null {
  if (!val && val !== '0') return null;
  const n = Number(String(val).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

function cx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(' ');
}

/* ========= Small UI helpers (в стиле сверки выручки) ========= */

function GlassCard({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'rounded-3xl border border-sky-100/80 bg-white/92 backdrop-blur-2xl',
        'shadow-[0_22px_80px_rgba(15,23,42,0.22)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

function GBtn({
  children,
  onClick,
  disabled,
  variant = 'solid',
  type = 'button',
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'solid' | 'outline';
  type?: 'button' | 'submit';
  className?: string;
}) {
  const base =
    'inline-flex items-center gap-2 px-3.5 py-2.5 rounded-2xl text-[13px] font-medium transition ' +
    'focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';
  const solid =
    'bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-400 text-slate-950 hover:from-sky-400 hover:via-cyan-400 hover:to-emerald-300 shadow-[0_12px_35px_rgba(56,189,248,0.6)]';
  const outline =
    'border border-sky-300/70 bg-white/90 text-sky-700 hover:bg-sky-50';
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(base, variant === 'solid' ? solid : outline, className)}
    >
      {children}
    </button>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        'w-full px-3.5 py-2.5 rounded-2xl border border-sky-100 bg-white/95 backdrop-blur',
        'text-sm text-slate-900 placeholder:text-slate-400 outline-none',
        'focus:ring-2 focus:ring-sky-300',
        props.className || '',
      )}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx(
        'w-full px-3.5 py-2.5 rounded-2xl border border-sky-100 bg-white/95 backdrop-blur',
        'text-sm text-slate-900 outline-none focus:ring-2 focus:ring-sky-300',
        props.className || '',
      )}
    />
  );
}

/* =========================
   Page
========================= */
export default function LensPricesSettingsPage() {
  const [rows, setRows] = useState<LensRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | string | null>(null);
  const [deletingId, setDeletingId] = useState<number | string | null>(null);
  const [confirmRow, setConfirmRow] = useState<LensRow | null>(null);

  // filters
  const [query, setQuery] = useState('');
  const [fType, setFType] = useState('');
  const [fIndex, setFIndex] = useState('');
  const [fCoating, setFCoating] = useState('');

  // modals
  const [showAdd, setShowAdd] = useState(false);

  // add form
  const [form, setForm] = useState({
    lens_type: '',
    refr_index: '',
    coating: '',
    is_astigmatism: false,
    sph_min: '',
    sph_max: '',
    price: '',
  });

  // load
  async function load() {
    try {
      setLoading(true);
      const { data, error } = await sb()
        .from('lens_prices')
        .select('*')
        .order('lens_type', { ascending: true })
        .order('refr_index', { ascending: true })
        .order('coating', { ascending: true })
        .order('is_astigmatism', { ascending: true })
        .order('sph_min', { ascending: true });
      if (error) throw error;
      setRows((data as any) || []);
    } catch (e: any) {
      toast.error(`Ошибка загрузки: ${e.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // options
  const typeOptions = useMemo(
    () =>
      Array.from(new Set(rows.map(r => r.lens_type ?? '').filter(Boolean))).sort(),
    [rows],
  );
  const indexOptions = useMemo(
    () =>
      Array.from(
        new Set(rows.map(r => String(r.refr_index ?? '')).filter(Boolean)),
      ).sort(),
    [rows],
  );
  const coatingOptions = useMemo(
    () =>
      Array.from(new Set(rows.map(r => r.coating ?? '').filter(Boolean))).sort(),
    [rows],
  );

  // filtering
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      const okQ =
        !q ||
        `${r.lens_type ?? ''} ${r.refr_index ?? ''} ${r.coating ?? ''}`
          .toLowerCase()
          .includes(q);
      const okT = !fType || (r.lens_type ?? '') === fType;
      const okI = !fIndex || String(r.refr_index ?? '') === fIndex;
      const okC = !fCoating || (r.coating ?? '') === fCoating;
      return okQ && okT && okI && okC;
    });
  }, [rows, query, fType, fIndex, fCoating]);

  // save price
  async function savePrice(row: LensRow, newVal: string) {
    const parsed = parsePrice(newVal);
    if (parsed == null) {
      toast.error('Некорректная цена');
      return;
    }
    try {
      setSavingId(row.id);
      const { error } = await sb().rpc('set_lens_price', {
        p_price_row_id: Number(row.id),
        p_new_price: parsed,
      });
      if (error) throw error;
      toast.success('Цена обновлена');
      setRows(prev =>
        prev.map(r => (r.id === row.id ? { ...r, price: parsed } : r)),
      );
    } catch (e: any) {
      toast.error(`Ошибка сохранения: ${e.message ?? e}`);
    } finally {
      setSavingId(null);
    }
  }

  // delete price row
  async function doDelete(row: LensRow) {
    try {
      setDeletingId(row.id);
      const { error } = await sb().rpc('delete_lens_price', {
        p_price_row_id: Number(row.id),
      });
      if (error) throw error;
      setRows(prev => prev.filter(r => r.id !== row.id));
      toast.success('Строка удалена');
    } catch (e: any) {
      toast.error(`Удалить не удалось: ${e.message ?? e}`);
    } finally {
      setDeletingId(null);
      setConfirmRow(null);
    }
  }

  // upsert
  async function submitAdd() {
    const p = parsePrice(form.price);
    const refr = form.refr_index
      ? Number(String(form.refr_index).replace(',', '.'))
      : null;
    const sMin = form.sph_min
      ? Number(String(form.sph_min).replace(',', '.'))
      : null;
    const sMax = form.sph_max
      ? Number(String(form.sph_max).replace(',', '.'))
      : null;

    if (p == null) {
      toast.error('Укажи корректную цену');
      return;
    }
    try {
      const { error } = await sb().rpc('upsert_lens_price', {
        p_lens_type: form.lens_type || null,
        p_refr_index: refr,
        p_coating: form.coating || null,
        p_is_astigmatism: form.is_astigmatism,
        p_sph_min: sMin,
        p_sph_max: sMax,
        p_price: p,
        p_currency: 'KGS',
      });
      if (error) throw error;
      toast.success('Строка сохранена');
      setShowAdd(false);
      setForm({
        lens_type: '',
        refr_index: '',
        coating: '',
        is_astigmatism: false,
        sph_min: '',
        sph_max: '',
        price: '',
      });
      await load();
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message ?? e}`);
    }
  }

  return (
    <div className="min-h-[100dvh] text-slate-900">
      {/* фон теперь только из layout, без лишнего прямоугольника */}
      <Toaster position="top-right" />

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-4">
        {/* Header */}
        <GlassCard className="px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 via-cyan-400 to-emerald-400 text-slate-950 shadow-[0_16px_40px_rgba(56,189,248,0.7)]">
                <Sparkles size={20} />
              </div>
              <div>
                <h1 className="text-[18px] font-semibold tracking-tight text-slate-900 sm:text-[20px]">
                  Настройки · Цены на линзы
                </h1>
                <p className="text-[11px] text-slate-500 sm:text-[12px]">
                  Единый прайс для всех оптик. Любое изменение сразу попадает в
                  «Новый заказ» и отчёты.
                </p>
              </div>
            </div>

            <div className="hidden items-center gap-2 sm:flex">
              <GBtn variant="outline" onClick={() => setShowAdd(true)}>
                <Plus className="h-4 w-4" />
                Добавить строку
              </GBtn>
              <GBtn onClick={() => load()} disabled={loading}>
                <RefreshCw
                  className={cx('h-4 w-4', loading && 'animate-spin')}
                />
                {loading ? 'Обновляю…' : 'Обновить'}
              </GBtn>
            </div>
          </div>
        </GlassCard>

        {/* Фильтры */}
        <Section
          title="Фильтры"
          subtitle={
            <span>
              Строк всего:{' '}
              <span className="font-semibold">{rows.length}</span>, отфильтровано:{' '}
              <span className="font-semibold">{filtered.length}</span>
            </span>
          }
        >
          <div className="grid gap-3 md:grid-cols-4">
            <Input
              placeholder="Поиск: тип / индекс / покрытие"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            <Select value={fType} onChange={e => setFType(e.target.value)}>
              <option value="">Тип: все</option>
              {typeOptions.map(v => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
            <Select value={fIndex} onChange={e => setFIndex(e.target.value)}>
              <option value="">Индекс: все</option>
              {indexOptions.map(v => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
            <Select
              value={fCoating}
              onChange={e => setFCoating(e.target.value)}
            >
              <option value="">Покрытие: все</option>
              {coatingOptions.map(v => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </div>

          {/* Mobile actions */}
          <div className="mt-3 flex items-center justify-between gap-2 sm:hidden">
            <GBtn
              variant="outline"
              onClick={() => setShowAdd(true)}
              className="flex-1 justify-center"
            >
              <Plus className="h-4 w-4" />
              Добавить
            </GBtn>
            <GBtn
              onClick={() => load()}
              disabled={loading}
              className="flex-1 justify-center"
            >
              <RefreshCw
                className={cx('h-4 w-4', loading && 'animate-spin')}
              />
              {loading ? 'Обновляю…' : 'Обновить'}
            </GBtn>
          </div>
        </Section>

        {/* Таблица */}
        <Section
          title="Прайс-лист линз"
          subtitle="Любое изменение уходит в lens_prices и используется в «Новом заказе» и отчётах."
        >
          <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white/98 shadow-sm">
            <table className="min-w-full text-[12px] sm:text-[13px] leading-tight">
              <thead className="bg-slate-50 text-[11px] sm:text-[12px] font-semibold tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-1.5 text-left whitespace-nowrap">
                    Тип
                  </th>
                  <th className="px-3 py-1.5 text-left whitespace-nowrap">
                    Индекс
                  </th>
                  <th className="px-3 py-1.5 text-left whitespace-nowrap">
                    Покрытие
                  </th>
                  <th className="px-3 py-1.5 text-left whitespace-nowrap">
                    Астигм.
                  </th>
                  <th className="px-3 py-1.5 text-left whitespace-nowrap">
                    SPH от
                  </th>
                  <th className="px-3 py-1.5 text-left whitespace-nowrap">
                    SPH до
                  </th>
                  <th className="px-3 py-1.5 text-left whitespace-nowrap">
                    Цена
                  </th>
                  <th className="px-3 py-1.5 text-left w-40 whitespace-nowrap">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && (
                  <tr>
                    <td
                      className="px-3 py-6 text-center text-slate-500"
                      colSpan={8}
                    >
                      Загрузка…
                    </td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td
                      className="px-3 py-6 text-center text-slate-500"
                      colSpan={8}
                    >
                      Ничего не найдено
                    </td>
                  </tr>
                )}
                {!loading &&
                  filtered.map((r, i) => (
                    <Row
                      key={String(r.id)}
                      row={r}
                      stripe={i % 2 === 1}
                      onSave={savePrice}
                      onDelete={() => setConfirmRow(r)}
                      saving={savingId === r.id}
                      deleting={deletingId === r.id}
                    />
                  ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/60 p-4">
          <div className="w-[720px] max-w-[95vw] max-h-[90vh] overflow-y-auto rounded-3xl border border-sky-100 bg-white/98 p-6 shadow-[0_18px_70px_rgba(15,23,42,0.75)]">
            <div className="mb-4 text-base font-semibold text-slate-900">
              Добавить / обновить строку прайса
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <LabeledInput
                label="Тип линзы"
                value={form.lens_type}
                onChange={v => setForm(p => ({ ...p, lens_type: v }))}
              />
              <LabeledInput
                label="Индекс (например 1.56)"
                value={form.refr_index}
                onChange={v => setForm(p => ({ ...p, refr_index: v }))}
              />
              <LabeledInput
                label="Покрытие (AR / BB / Photo…)"
                value={form.coating}
                onChange={v => setForm(p => ({ ...p, coating: v }))}
              />
              <label className="mt-1 flex items-center gap-2 text-sm text-slate-700">
                <input
                  id="astig"
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-sky-600"
                  checked={form.is_astigmatism}
                  onChange={e =>
                    setForm(p => ({
                      ...p,
                      is_astigmatism: e.target.checked,
                    }))
                  }
                />
                <span>Астигматизм</span>
              </label>
              <LabeledInput
                label="SPH от"
                value={form.sph_min}
                onChange={v => setForm(p => ({ ...p, sph_min: v }))}
              />
              <LabeledInput
                label="SPH до"
                value={form.sph_max}
                onChange={v => setForm(p => ({ ...p, sph_max: v }))}
              />
              <LabeledInput
                label="Цена (сом)"
                value={form.price}
                onChange={v => setForm(p => ({ ...p, price: v }))}
              />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => setShowAdd(false)}
              >
                Отмена
              </button>
              <GBtn onClick={submitAdd}>Сохранить</GBtn>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete */}
      {confirmRow && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/60 p-4"
          onClick={() => setConfirmRow(null)}
        >
          <div
            className="w-[560px] max-w-[95vw] max-h-[90vh] overflow-y-auto rounded-3xl border border-rose-100 bg-white/98 p-6 shadow-[0_18px_70px_rgba(127,29,29,0.7)]"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-2 text-base font-semibold text-rose-600">
              Удалить строку?
            </div>
            <div className="mb-4 text-xs text-slate-600">
              {confirmRow.lens_type} • {confirmRow.refr_index ?? '—'} •{' '}
              {confirmRow.coating ?? '—'} • SPH {confirmRow.sph_min ?? '—'}..
              {confirmRow.sph_max ?? '—'}
              <br />
              Это действие необратимо. Если сомневаешься, просто закрой окно.
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => setConfirmRow(null)}
              >
                Отмена
              </button>
              <button
                onClick={() => doDelete(confirmRow)}
                className={cx(
                  'rounded-2xl bg-gradient-to-r from-rose-500 to-red-600 px-5 py-2 text-sm font-medium text-white shadow hover:opacity-95',
                  deletingId === confirmRow.id && 'cursor-not-allowed opacity-70',
                )}
                disabled={deletingId === confirmRow.id}
              >
                {deletingId === confirmRow.id ? 'Удаляю…' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================
   Row
========================= */
function Row({
  row,
  stripe,
  onSave,
  onDelete,
  saving,
  deleting,
}: {
  row: LensRow;
  stripe: boolean;
  onSave: (row: LensRow, val: string) => void;
  onDelete: () => void;
  saving: boolean;
  deleting: boolean;
}) {
  const [val, setVal] = useState(String(row.price ?? 0));

  useEffect(() => setVal(String(row.price ?? 0)), [row.price]);

  return (
    <tr
      className={cx(
        'transition-colors',
        stripe ? 'bg-slate-50/80' : 'bg-white',
        'hover:bg-sky-50/70',
      )}
    >
      <td className="px-3 py-1.5 align-middle text-[12px] sm:text-[13px] text-slate-800 whitespace-nowrap">
        {row.lens_type || '—'}
      </td>
      <td className="px-3 py-1.5 align-middle text-[12px] sm:text-[13px] text-slate-800 whitespace-nowrap">
        {row.refr_index ?? '—'}
      </td>
      <td className="px-3 py-1.5 align-middle text-[12px] sm:text-[13px] text-slate-800 whitespace-nowrap">
        {row.coating || '—'}
      </td>
      <td className="px-3 py-1.5 align-middle text-[12px] sm:text-[13px] text-slate-800 whitespace-nowrap">
        {row.is_astigmatism ? 'Да' : 'Нет'}
      </td>
      <td className="px-3 py-1.5 align-middle text-[12px] sm:text-[13px] text-slate-800 whitespace-nowrap">
        {row.sph_min ?? '—'}
      </td>
      <td className="px-3 py-1.5 align-middle text-[12px] sm:text-[13px] text-slate-800 whitespace-nowrap">
        {row.sph_max ?? '—'}
      </td>
      <td className="px-3 py-1.5 align-middle whitespace-nowrap">
        <input
          className="w-24 rounded-2xl border border-sky-100 bg-white/95 px-3 py-1 text-right text-[12px] sm:text-[13px] text-slate-900 shadow-inner outline-none focus:ring-2 focus:ring-sky-300"
          value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={() => onSave(row, val)}
        />
      </td>
      <td className="px-3 py-1.5 align-middle">
        <div className="flex flex-nowrap gap-1.5">
          <button
            className={cx(
              'inline-flex items-center justify-center rounded-2xl px-3 py-1.5 text-[11px] sm:text-[12px] font-semibold',
              'bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-400 text-slate-950',
              'shadow-[0_10px_25px_rgba(56,189,248,0.6)] hover:brightness-110 transition',
              saving && 'cursor-not-allowed opacity-60',
            )}
            onClick={() => onSave(row, val)}
            disabled={saving}
          >
            {saving ? 'Сохр.' : 'Сохранить'}
          </button>
          <button
            className={cx(
              'inline-flex items-center justify-center rounded-2xl px-3 py-1.5 text-[11px] sm:text-[12px] font-semibold',
              'bg-gradient-to-r from-rose-500 to-red-600 text-white shadow hover:opacity-95 transition',
              deleting && 'cursor-not-allowed opacity-60',
            )}
            onClick={onDelete}
            disabled={deleting}
          >
            {deleting ? 'Удаляю…' : 'Удалить'}
          </button>
        </div>
      </td>
    </tr>
  );
}

/* =========================
   Labeled input
========================= */
function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input
        className="w-full rounded-2xl border border-sky-100 bg-white/95 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-sky-300"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  );
}

/* =========================
   Section
========================= */
function Section({
  title,
  subtitle,
  children,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  const hasHeader = title || subtitle;
  return (
    <GlassCard className="mt-2 px-6 py-4 sm:py-5">
      {hasHeader && (
        <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          {title && (
            <h2 className="text-[15px] font-semibold text-slate-900">
              {title}
            </h2>
          )}
          {subtitle && (
            <div className="text-[11px] text-slate-500 sm:text-xs">
              {subtitle}
            </div>
          )}
        </header>
      )}
      {children}
    </GlassCard>
  );
}
