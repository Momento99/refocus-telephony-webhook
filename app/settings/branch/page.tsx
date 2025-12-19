'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import getSupabase from '@/lib/supabaseClient';

type BranchItem = {
  branch_id: number;
  branch_name: string | null;
  address: string | null;
};

function sb() {
  const c = getSupabase();
  if (!c) throw new Error('Supabase client missing');
  return c;
}

export default function BranchListPage() {
  const [items, setItems] = useState<BranchItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await sb()
          .from('branches_with_settings')
          .select('branch_id, branch_name, address')
          .order('branch_id', { ascending: true });
        if (error) throw error;
        if (!cancelled) setItems((data || []) as BranchItem[]);
      } catch (e: any) {
        console.error(e);
        toast.error(e.message || 'Не удалось загрузить список филиалов');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      {/* Хедер */}
      <header className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Настройки филиалов</h1>
        <p className="text-sm text-neutral-500">
          Выберите филиал, чтобы редактировать адрес, телефоны, оплату и график работы.
        </p>
      </header>

      {/* Градиентная полоса-инфо (тонкая, в нашем стиле) */}
      <div className="rounded-2xl p-[1px] bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-600">
        <div className="rounded-2xl bg-white p-4 md:p-5">
          <div className="text-sm text-neutral-600">
            Доступ по ролям: владелец видит все филиалы, менеджер — свой, продавец — только чтение.
          </div>
        </div>
      </div>

      {/* Скелетоны при загрузке */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-2xl p-[1px] bg-gradient-to-br from-blue-600/50 via-indigo-600/50 to-cyan-600/50">
              <div className="rounded-2xl bg-white p-5">
                <div className="h-6 w-48 bg-neutral-200 rounded mb-2" />
                <div className="h-4 w-64 bg-neutral-200 rounded mb-6" />
                <div className="h-10 w-40 bg-neutral-200 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Сетка карточек филиалов */}
      {!loading && (
        items.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {items.map(b => (
              <article
                key={b.branch_id}
                className="rounded-2xl p-[1px] bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-600"
              >
                <div className="rounded-2xl bg-white p-5 h-full flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">
                        {b.branch_name || `Филиал #${b.branch_id}`}
                      </h2>
                      <div className="text-xs text-neutral-400 mt-0.5">ID {b.branch_id}</div>
                    </div>
                  </div>

                  <p className="mt-4 text-sm text-neutral-600 line-clamp-3">
                    {b.address || 'Адрес не указан'}
                  </p>

                  <div className="mt-6 flex items-center justify-between">
                    <Link
                      href={`/settings/branch/${b.branch_id}`}
                      className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl text-white
                                 bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800
                                 shadow-sm transition-colors"
                    >
                      Открыть настройки
                    </Link>
                    <span className="text-xs text-neutral-400">настройка</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="text-sm text-neutral-500">Филиалов нет или нет прав на просмотр.</div>
        )
      )}
    </div>
  );
}
