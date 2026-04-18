'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  Clock3,
  XCircle,
  Loader2,
  Terminal,
  AlertCircle,
} from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';

type Book = {
  id: string;
  title: string;
  author: string | null;
  category: string;
  language: string;
  file_name: string | null;
  pages_count: number | null;
  chunks_count: number;
  status: 'pending' | 'indexing' | 'indexed' | 'failed';
  indexed_at: string | null;
};

const STATUS_META: Record<Book['status'], { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  indexed:  { label: 'Проиндексирована', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: CheckCircle2 },
  indexing: { label: 'Индексируется',    className: 'bg-sky-50 text-sky-700 ring-sky-200',             icon: Loader2 },
  pending:  { label: 'Ожидает',          className: 'bg-slate-50 text-slate-600 ring-slate-200',       icon: Clock3 },
  failed:   { label: 'Ошибка',           className: 'bg-rose-50 text-rose-700 ring-rose-200',          icon: XCircle },
};

const CATEGORY_LABEL: Record<string, string> = {
  retail: 'Ритейл',
  marketing: 'Маркетинг',
  psychology: 'Психология',
  sales: 'Продажи',
  strategy: 'Стратегия',
  finance: 'Финансы',
  culture: 'Культура',
  optics: 'Оптика',
  other: 'Прочее',
};

function classNames(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(' ');
}

export default function LibraryPage() {
  const supabase = useMemo(() => getBrowserSupabase(), []);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('ai_knowledge_books')
      .select('id, title, author, category, language, file_name, pages_count, chunks_count, status, indexed_at')
      .order('category', { ascending: true })
      .order('title', { ascending: true });
    if (error) setError(error.message);
    setBooks((data ?? []) as Book[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const indexed = books.filter((b) => b.status === 'indexed').length;
    const totalChunks = books.reduce((acc, b) => acc + (b.chunks_count ?? 0), 0);
    return { total: books.length, indexed, totalChunks };
  }, [books]);

  const grouped = useMemo(() => {
    const map = new Map<string, Book[]>();
    for (const b of books) {
      const list = map.get(b.category) ?? [];
      list.push(b);
      map.set(b.category, list);
    }
    return Array.from(map.entries());
  }, [books]);

  return (
    <div className="mx-auto w-full max-w-7xl px-5 pb-10 pt-4">
      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/80 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-white shadow-sm">
            <BookOpen className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h1 className="text-base font-bold text-slate-900">Библиотека знаний</h1>
            <p className="text-[12px] text-slate-500">
              Бизнес-книги, по которым советник ищет принципы и цитаты. Индексация — через локальный скрипт.
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Stat label="Всего книг" value={stats.total} />
            <Stat label="Готовы" value={stats.indexed} tone="emerald" />
            <Stat label="Фрагментов" value={stats.totalChunks.toLocaleString('ru-RU')} />
          </div>
        </div>
      </section>

      <section className="mt-3 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200 text-[12.5px] leading-6 text-amber-900">
        <div className="flex items-center gap-2 font-semibold">
          <Terminal className="h-4 w-4" />
          Как добавить или переиндексировать книги
        </div>
        <ol className="mt-1.5 list-decimal pl-5 space-y-0.5">
          <li>Положи PDF-файлы в папку <code className="rounded bg-amber-100 px-1 text-[11.5px]">knowledge-books/</code> в корне репо.</li>
          <li>Имена файлов должны совпадать с <code className="rounded bg-amber-100 px-1 text-[11.5px]">knowledge-books/manifest.json</code>.</li>
          <li>В <code className="rounded bg-amber-100 px-1 text-[11.5px]">.env.local</code> должны быть: <code>SUPABASE_URL</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code>, <code>VOYAGE_API_KEY</code>.</li>
          <li>Запусти <code className="rounded bg-amber-100 px-1 text-[11.5px]">npm run index-books</code>. Уже проиндексированные книги пропускаются.</li>
        </ol>
      </section>

      {error && (
        <div className="mt-3 rounded-xl bg-rose-50 px-4 py-2 text-[12px] text-rose-700 ring-1 ring-rose-200 inline-flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      {loading && (
        <div className="mt-4 space-y-3">
          {[1, 2].map((k) => (
            <div key={k} className="animate-pulse rounded-2xl bg-white p-4 ring-1 ring-slate-200/80">
              <div className="h-5 w-40 rounded bg-slate-200" />
              <div className="mt-3 h-12 w-full rounded bg-slate-200" />
            </div>
          ))}
        </div>
      )}

      {!loading && books.length === 0 && (
        <div className="mt-4 rounded-2xl bg-white px-5 py-10 text-center ring-1 ring-slate-200/80 shadow-sm">
          <BookOpen className="h-8 w-8 mx-auto text-slate-300" />
          <div className="mt-2 text-sm font-semibold text-slate-700">Библиотека пока пуста</div>
          <div className="mt-1 text-[12px] text-slate-500">После первого запуска <code className="rounded bg-slate-100 px-1">npm run index-books</code> список появится здесь.</div>
        </div>
      )}

      {!loading && grouped.map(([category, list]) => (
        <section key={category} className="mt-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
              {CATEGORY_LABEL[category] ?? category}
            </span>
            <div className="h-px flex-1 bg-slate-200/80" />
            <span className="text-[10px] text-slate-400">{list.length} книг</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {list.map((b) => {
              const meta = STATUS_META[b.status];
              const Icon = meta.icon;
              return (
                <div key={b.id} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200/80 shadow-sm">
                  <BookOpen className="h-4 w-4 shrink-0 text-cyan-600" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-slate-900 truncate">{b.title}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {b.author ?? 'автор не указан'} · {b.language.toUpperCase()} · {b.chunks_count} фрагм.
                      {b.pages_count ? ` · ${b.pages_count} стр.` : ''}
                    </div>
                  </div>
                  <span
                    className={classNames(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1',
                      meta.className,
                    )}
                  >
                    <Icon className={classNames('h-3 w-3', b.status === 'indexing' && 'animate-spin')} />
                    {meta.label}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function Stat({ label, value, tone = 'slate' }: { label: string; value: string | number; tone?: 'slate' | 'emerald' }) {
  return (
    <div className="text-center">
      <div className={classNames('text-lg font-bold', tone === 'emerald' ? 'text-emerald-600' : 'text-slate-900')}>{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  );
}
