'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Save, Loader2, CheckCircle2, AlertCircle, Users, Swords, Target, StickyNote } from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';

type BranchRow = {
  branch_id: number;
  branch_name: string;
  city: string | null;
  country_id: string | null;
  population_note: string | null;
  competitors_note: string | null;
  positioning_note: string | null;
  owner_notes: string | null;
  updated_at: string | null;
};

type Draft = {
  population_note: string;
  competitors_note: string;
  positioning_note: string;
  owner_notes: string;
};

function classNames(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(' ');
}

const EMPTY_DRAFT: Draft = {
  population_note: '',
  competitors_note: '',
  positioning_note: '',
  owner_notes: '',
};

export default function BranchNotesPage() {
  const supabase = useMemo(() => getBrowserSupabase(), []);

  const [rows, setRows] = useState<BranchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('fn_ai_tool_branch_context');
      if (rpcErr) throw new Error(rpcErr.message);
      const list = (data ?? []) as BranchRow[];
      setRows(list);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const r of list) {
          if (!(r.branch_id in next)) {
            next[r.branch_id] = {
              population_note: r.population_note ?? '',
              competitors_note: r.competitors_note ?? '',
              positioning_note: r.positioning_note ?? '',
              owner_notes: r.owner_notes ?? '',
            };
          }
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить филиалы');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const isDirty = (branchId: number, row: BranchRow): boolean => {
    const d = drafts[branchId] ?? EMPTY_DRAFT;
    return (
      d.population_note !== (row.population_note ?? '') ||
      d.competitors_note !== (row.competitors_note ?? '') ||
      d.positioning_note !== (row.positioning_note ?? '') ||
      d.owner_notes !== (row.owner_notes ?? '')
    );
  };

  const handleSave = async (row: BranchRow) => {
    const d = drafts[row.branch_id] ?? EMPTY_DRAFT;
    setSavingId(row.branch_id);
    setError(null);
    try {
      const { error: upErr } = await supabase
        .from('ai_branch_context')
        .upsert({
          branch_id: row.branch_id,
          population_note: d.population_note || null,
          competitors_note: d.competitors_note || null,
          positioning_note: d.positioning_note || null,
          owner_notes: d.owner_notes || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'branch_id' });
      if (upErr) throw new Error(upErr.message);
      setSavedId(row.branch_id);
      setTimeout(() => setSavedId(null), 2000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-5 pb-10 pt-4">
      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/80 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-white shadow-sm">
            <Building2 className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900">Заметки по филиалам</h1>
            <p className="text-[12px] text-slate-500">
              Эти заметки подтягиваются ассистентом автоматически при каждом вопросе о конкретном филиале. Чем подробнее — тем точнее советы.
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="mt-3 rounded-xl bg-rose-50 px-4 py-2 text-[12px] text-rose-700 ring-1 ring-rose-200 inline-flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      {loading && (
        <div className="mt-4 space-y-3">
          {[1, 2, 3].map((k) => (
            <div key={k} className="animate-pulse rounded-2xl bg-white p-4 ring-1 ring-slate-200/80">
              <div className="h-5 w-40 rounded bg-slate-200" />
              <div className="mt-3 h-20 w-full rounded bg-slate-200" />
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {!loading && rows.map((row) => {
          const draft = drafts[row.branch_id] ?? EMPTY_DRAFT;
          const dirty = isDirty(row.branch_id, row);
          return (
            <div key={row.branch_id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/80 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Building2 className="h-4 w-4 text-cyan-600" />
                <span className="text-sm font-semibold text-slate-900">{row.branch_name}</span>
                {row.city && <span className="text-[11px] text-slate-500">· {row.city}</span>}
                <span className="text-[10px] text-slate-400 uppercase">{row.country_id ?? ''}</span>
                <span className="ml-auto" />
                {savedId === row.branch_id && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                    <CheckCircle2 className="h-3 w-3" />
                    Сохранено
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <Field
                  icon={<Users className="h-3.5 w-3.5" />}
                  label="Население и ЦА"
                  placeholder="Например: райцентр на 30 тыс., средний возраст 45+, уровень достатка ниже среднего, мало студентов…"
                  value={draft.population_note}
                  onChange={(v) => setDrafts((prev) => ({ ...prev, [row.branch_id]: { ...draft, population_note: v } }))}
                />
                <Field
                  icon={<Swords className="h-3.5 w-3.5" />}
                  label="Конкуренты"
                  placeholder="Например: через 200м — оптика «Визус», агрессивные цены; в ТЦ «Беш-Сары» — «Zentral», сильный маркетинг и бренд на молодёжь…"
                  value={draft.competitors_note}
                  onChange={(v) => setDrafts((prev) => ({ ...prev, [row.branch_id]: { ...draft, competitors_note: v } }))}
                />
                <Field
                  icon={<Target className="h-3.5 w-3.5" />}
                  label="Позиционирование"
                  placeholder="Например: делаем упор на скорость выдачи (за час), средний чек выше сети, продаём много Premium линз…"
                  value={draft.positioning_note}
                  onChange={(v) => setDrafts((prev) => ({ ...prev, [row.branch_id]: { ...draft, positioning_note: v } }))}
                />
                <Field
                  icon={<StickyNote className="h-3.5 w-3.5" />}
                  label="Свободные заметки"
                  placeholder="Любая информация, которая поможет советчику: сезонность, связи, особенности персонала, контракты с НКО, планы…"
                  value={draft.owner_notes}
                  onChange={(v) => setDrafts((prev) => ({ ...prev, [row.branch_id]: { ...draft, owner_notes: v } }))}
                  rows={3}
                />
              </div>

              <div className="mt-3 flex items-center justify-between">
                <div className="text-[10px] text-slate-400">
                  {row.updated_at ? `Обновлено: ${new Date(row.updated_at).toLocaleString('ru-RU')}` : 'Никогда не сохранялось'}
                </div>
                <button
                  type="button"
                  onClick={() => void handleSave(row)}
                  disabled={!dirty || savingId === row.branch_id}
                  className={classNames(
                    'inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition',
                    dirty
                      ? 'bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_8px_20px_rgba(14,165,233,0.25)] hover:brightness-105'
                      : 'bg-slate-100 text-slate-400',
                  )}
                >
                  {savingId === row.branch_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Сохранить
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({
  icon,
  label,
  value,
  onChange,
  placeholder,
  rows = 2,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
        <span className="text-cyan-600">{icon}</span>
        {label}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-y rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] text-slate-900 ring-1 ring-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/80"
      />
    </label>
  );
}
