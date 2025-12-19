// app/settings/users/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { HiOutlineTrash, HiOutlineMail, HiUser, HiSearch } from 'react-icons/hi';
import getSupabase from '@/lib/supabaseClient';
import InviteUserPanel from './InviteUserPanel';

type Role = 'owner' | 'manager' | 'seller' | 'master';

type Row = {
  user_id: string;
  email: string | null;
  last_sign_in_at: string | null;
  branch_id: number | null;
  branch_name: string | null;
  role: Role | null;
};

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Владелец',
  manager: 'Менеджер',
  seller: 'Продавец',
  master: 'Мастер',
};

function RoleBadge({ role }: { role: Role }) {
  const map: Record<Role, string> = {
    owner: 'from-indigo-600 to-blue-600',
    manager: 'from-sky-500 to-cyan-500',
    seller: 'from-emerald-500 to-teal-500',
    master: 'from-fuchsia-500 to-violet-500',
  };
  return (
    <span className={`inline-flex items-center rounded-full bg-gradient-to-r ${map[role]} px-3 py-1 text-xs font-medium text-white shadow-sm`}>
      {ROLE_LABEL[role]}
    </span>
  );
}

export default function UsersPage() {
  const supabase = getSupabase();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [sessionUid, setSessionUid] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState<number | 'all'>('all');

  const searchParams = useSearchParams();

  // сессия
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!cancelled) setSessionUid(data.user?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // список пользователей
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('users_with_roles_list');
        if (error) throw error;
        if (!cancelled) setRows((data || []) as Row[]);
      } catch (e: any) {
        console.error(e);
        toast.error(e.message || 'Не удалось загрузить пользователей');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // права: владелец хоть одного филиала
  const isOwner = useMemo(() => {
    if (!sessionUid) return false;
    return rows.some(r => r.user_id === sessionUid && r.role === 'owner');
  }, [rows, sessionUid]);

  // фильтры
  const branches = useMemo(() => {
    const set = new Map<number, string>();
    rows.forEach(r => { if (r.branch_id) set.set(r.branch_id, r.branch_name ?? `ID ${r.branch_id}`); });
    return Array.from(set.entries()).map(([id, name]) => ({ id, name }));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      const byBranch = branchFilter === 'all' || r.branch_id === branchFilter;
      const byQuery =
        !q ||
        (r.email ?? '').toLowerCase().includes(q) ||
        (r.branch_name ?? '').toLowerCase().includes(q) ||
        (r.role ? ROLE_LABEL[r.role].toLowerCase().includes(q) : false);
      return byBranch && byQuery;
    });
  }, [rows, query, branchFilter]);

  // смена роли
  async function changeRole(r: Row, newRole: Role) {
    if (!r.branch_id) {
      toast.error('У записи нет филиала.');
      return;
    }
    const key = `${r.user_id}-${r.branch_id}`;
    setSavingKey(key);
    const t = toast.loading('Обновляю роль…');
    try {
      const res = await fetch('/api/admin/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: r.user_id, branchId: r.branch_id, role: newRole }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) throw new Error(j?.error || 'Ошибка при обновлении роли');

      setRows(prev => prev.map(x =>
        (x.user_id === r.user_id && x.branch_id === r.branch_id) ? { ...x, role: newRole } : x
      ));
      toast.success('Роль обновлена');
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Ошибка при обновлении роли');
    } finally {
      setSavingKey(null);
      toast.dismiss(t);
    }
  }

  // удаление пользователя из филиала
  async function removeUser(r: Row) {
    if (!r.branch_id) {
      toast.error('У записи нет филиала.');
      return;
    }
    if (!confirm(`Удалить пользователя ${r.email ?? ''} из филиала «${r.branch_name ?? r.branch_id}»?`)) return;

    const key = `${r.user_id}-${r.branch_id}`;
    setSavingKey(key);
    const t = toast.loading('Удаляю…');

    try {
      const res = await fetch('/api/admin/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: r.user_id, branchId: r.branch_id }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) throw new Error(j?.error || 'Ошибка при удалении');

      setRows(prev => prev.filter(x => !(x.user_id === r.user_id && x.branch_id === r.branch_id)));
      toast.success('Пользователь удалён из филиала');
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Ошибка при удалении');
    } finally {
      setSavingKey(null);
      toast.dismiss(t);
    }
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-500 px-6 py-8 text-white shadow-md">
        <div className="absolute inset-0 bg-[radial-gradient(60rem_30rem_at_70%_-10%,rgba(255,255,255,0.18),transparent)]" />
        <div className="relative z-10">
          <h1 className="text-2xl md:text-3xl font-semibold">Пользователи и роли</h1>
          <p className="mt-1 text-white/80">
            Владелец может приглашать и менять роли. Остальные видят список без редактирования.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <div className="rounded-xl bg-white/15 backdrop-blur px-3 py-2 text-sm">
              Всего пользователей: <span className="font-semibold">{rows.length}</span>
            </div>
            {isOwner ? (
              <div className="rounded-xl bg-white/15 backdrop-blur px-3 py-2 text-sm">
                Права: <span className="font-semibold">владелец</span>
              </div>
            ) : (
              <div className="rounded-xl bg-white/15 backdrop-blur px-3 py-2 text-sm">
                Права: <span className="font-semibold">только просмотр</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* FILTERS */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <label className="relative">
            <HiSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Поиск по email, филиалу или роли…"
              className="w-72 rounded-xl border border-neutral-200 bg-white px-10 py-2 outline-none transition focus:ring-2 focus:ring-blue-600/30"
            />
          </label>

          <select
            value={branchFilter}
            onChange={e => setBranchFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="rounded-xl border border-neutral-200 bg-white px-3 py-2 outline-none transition focus:ring-2 focus:ring-blue-600/30"
          >
            <option value="all">Все филиалы</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        <div className="text-sm text-neutral-500">
          {loading ? 'Загружаем…' : `Показано: ${filtered.length}`}
        </div>
      </div>

      {/* TABLE CARD */}
      <div className="rounded-3xl bg-white/70 backdrop-blur shadow-sm ring-1 ring-black/5 p-1">
        <div className="overflow-x-auto rounded-3xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Последний вход</th>
                <th className="px-5 py-3">Филиал</th>
                <th className="px-5 py-3">Роль</th>
                <th className="px-5 py-3 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {loading && (
                <>
                  {[...Array(3)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-5 py-5"><div className="h-4 w-56 rounded bg-neutral-200" /></td>
                      <td className="px-5 py-5"><div className="h-4 w-28 rounded bg-neutral-200" /></td>
                      <td className="px-5 py-5"><div className="h-4 w-24 rounded bg-neutral-200" /></td>
                      <td className="px-5 py-5"><div className="h-6 w-24 rounded bg-neutral-200" /></td>
                      <td className="px-5 py-5"><div className="ml-auto h-8 w-8 rounded bg-neutral-200" /></td>
                    </tr>
                  ))}
                </>
              )}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td className="px-5 py-10 text-neutral-500" colSpan={5}>
                    Ничего не найдено по текущим фильтрам.
                  </td>
                </tr>
              )}

              {!loading && filtered.map((r, idx) => {
                const canEdit = isOwner && !!r.branch_id;
                const key = `${r.user_id}-${r.branch_id}`;
                const saving = savingKey === key;
                return (
                  <tr key={`${r.user_id}-${idx}`} className="hover:bg-neutral-50/60">
                    {/* Email */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-sm">
                          <HiUser className="h-4 w-4" />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-medium">{r.email ?? '—'}</span>
                          <span className="text-xs text-neutral-400">UID: {r.user_id.slice(0, 8)}…</span>
                        </div>
                      </div>
                    </td>

                    {/* last sign-in */}
                    <td className="px-5 py-4">
                      {r.last_sign_in_at ? (
                        new Date(r.last_sign_in_at).toLocaleString()
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>

                    {/* Branch */}
                    <td className="px-5 py-4">
                      {r.branch_name ?? (r.branch_id ? `ID ${r.branch_id}` : '—')}
                    </td>

                    {/* Role */}
                    <td className="px-5 py-4">
                      {canEdit ? (
                        <select
                          className="rounded-xl border border-neutral-300 bg-white px-3 py-2 outline-none transition focus:ring-2 focus:ring-blue-600/30"
                          value={r.role ?? ''}
                          onChange={(e) => changeRole(r, e.target.value as Role)}
                          disabled={saving}
                        >
                          <option value="" disabled>— выбрать роль —</option>
                          <option value="owner">Владелец</option>
                          <option value="manager">Менеджер</option>
                          <option value="seller">Продавец</option>
                          <option value="master">Мастер</option>
                        </select>
                      ) : r.role ? (
                        <RoleBadge role={r.role} />
                      ) : (
                        <span className="text-neutral-400">нет</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          title="Удалить из филиала"
                          onClick={() => removeUser(r)}
                          disabled={!canEdit || saving}
                          className="rounded-xl border border-neutral-200 px-3 py-2 text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-50"
                        >
                          <HiOutlineTrash className="h-5 w-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite panel */}
      <InviteUserPanel />
    </div>
  );
}
