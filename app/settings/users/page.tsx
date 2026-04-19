'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  UserCog,
  UserPlus,
  Trash2,
  ShieldCheck,
  Mail,
  Loader2,
  X,
  AlertTriangle,
} from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';

type Role = 'owner' | 'manager' | 'seller';
const ROLES: Role[] = ['owner', 'manager', 'seller'];

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Владелец',
  manager: 'Менеджер',
  seller: 'Продавец',
};

type Row = {
  user_id: string;
  email: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  role: Role | '' | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function initial(email: string | null): string {
  if (!email) return '?';
  return email.trim().charAt(0).toUpperCase();
}

function RoleChip({ role }: { role: Role | '' | null }) {
  if (!role) {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
        нет роли
      </span>
    );
  }
  const styles: Record<Role, string> = {
    owner:   'bg-cyan-50 text-cyan-700 ring-cyan-200',
    manager: 'bg-sky-50 text-sky-700 ring-sky-200',
    seller:  'bg-teal-50 text-teal-700 ring-teal-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${styles[role]}`}>
      {ROLE_LABEL[role]}
    </span>
  );
}

function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-slate-500">{hint}</div> : null}
    </div>
  );
}

export default function UsersPage() {
  const sb = useMemo(() => getBrowserSupabase(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [meEmail, setMeEmail] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await sb.rpc('admin_users_list');
      if (error) throw error;
      setRows((data || []) as Row[]);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Не удалось загрузить пользователей');
    } finally {
      setLoading(false);
    }
  }, [sb]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await sb.auth.getUser();
      if (cancelled) return;
      setMeId(data.user?.id ?? null);
      setMeEmail(data.user?.email ?? null);
      setIsOwner((data.user?.app_metadata as any)?.role === 'owner');
    })();
    return () => { cancelled = true; };
  }, [sb]);

  useEffect(() => { load(); }, [load]);

  const ownersCount = useMemo(
    () => rows.filter(r => r.role === 'owner').length,
    [rows]
  );

  async function changeRole(r: Row, newRole: Role) {
    if (r.role === newRole) return;
    setBusyId(r.user_id);
    const t = toast.loading('Обновляю роль…');
    try {
      const res = await fetch('/api/admin/set-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: r.user_id, role: newRole }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || 'Ошибка');
      setRows(prev => prev.map(x => x.user_id === r.user_id ? { ...x, role: newRole } : x));
      toast.success('Роль обновлена');
    } catch (e: any) {
      toast.error(e.message || 'Ошибка');
    } finally {
      toast.dismiss(t);
      setBusyId(null);
    }
  }

  async function performDelete(r: Row) {
    setBusyId(r.user_id);
    const t = toast.loading('Удаляю…');
    try {
      const res = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: r.user_id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || 'Ошибка');
      setRows(prev => prev.filter(x => x.user_id !== r.user_id));
      toast.success('Пользователь удалён');
    } catch (e: any) {
      toast.error(e.message || 'Ошибка');
    } finally {
      toast.dismiss(t);
      setBusyId(null);
      setConfirmDelete(null);
    }
  }

  return (
    <div className="min-h-screen bg-transparent text-slate-50">
      <div className="relative">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
              <UserCog className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold tracking-tight text-slate-50">
                Пользователи и роли
              </div>
              <div className="mt-0.5 text-[12px] text-cyan-300/50">
                Доступ сотрудников к CRM
              </div>
            </div>
          </div>

          {isOwner && (
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-300/70"
            >
              <UserPlus className="h-4 w-4" />
              Пригласить
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <StatCard label="Всего пользователей" value={loading ? '—' : rows.length} />
          <StatCard label="Владельцев" value={loading ? '—' : ownersCount} />
          <StatCard
            label="Ваш email"
            value={<span className="text-base font-semibold">{meEmail ?? '—'}</span>}
            hint={isOwner ? 'активная сессия · владелец' : 'активная сессия'}
          />
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Пользователь</th>
                  <th className="px-5 py-3">Последний вход</th>
                  <th className="px-5 py-3">Роль</th>
                  <th className="px-5 py-3 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-900">
                {loading && [...Array(2)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-5 py-5"><div className="h-4 w-56 rounded bg-slate-200" /></td>
                    <td className="px-5 py-5"><div className="h-4 w-32 rounded bg-slate-200" /></td>
                    <td className="px-5 py-5"><div className="h-6 w-24 rounded-full bg-slate-200" /></td>
                    <td className="px-5 py-5"><div className="ml-auto h-8 w-20 rounded-lg bg-slate-200" /></td>
                  </tr>
                ))}

                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-slate-500">
                      Пока нет пользователей.
                    </td>
                  </tr>
                )}

                {!loading && rows.map(r => {
                  const isMe = r.user_id === meId;
                  const saving = busyId === r.user_id;
                  return (
                    <tr key={r.user_id} className="transition hover:bg-sky-50/40">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-500 text-[13px] font-bold text-white">
                            {initial(r.email)}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-900">
                              {r.email ?? '—'}
                              {isMe && <span className="ml-2 rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-700">вы</span>}
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-400">
                              добавлен {formatDate(r.created_at)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        {formatDate(r.last_sign_in_at)}
                      </td>
                      <td className="px-5 py-4">
                        {isOwner && !isMe ? (
                          <select
                            value={(r.role as string) || ''}
                            onChange={e => changeRole(r, e.target.value as Role)}
                            disabled={saving}
                            className="rounded-xl bg-white px-3 py-1.5 text-sm font-medium text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 disabled:opacity-50"
                          >
                            <option value="" disabled>— выбрать —</option>
                            {ROLES.map(role => (
                              <option key={role} value={role}>{ROLE_LABEL[role]}</option>
                            ))}
                          </select>
                        ) : (
                          <RoleChip role={r.role ?? ''} />
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end">
                          {isOwner && !isMe && (
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(r)}
                              disabled={saving}
                              title="Удалить пользователя"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 ring-1 ring-slate-200 transition hover:bg-rose-50 hover:text-rose-600 hover:ring-rose-200 disabled:opacity-50"
                            >
                              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </button>
                          )}
                          {isMe && (
                            <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
                              <ShieldCheck className="h-3.5 w-3.5 text-cyan-600" />
                              защищено
                            </span>
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

        {!isOwner && !loading && (
          <div className="mt-4 text-[12px] text-slate-400">
            Редактирование доступно только владельцу.
          </div>
        )}
      </div>

      {/* Invite modal */}
      {inviteOpen && isOwner && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onDone={() => { setInviteOpen(false); load(); }}
        />
      )}

      {/* Delete confirm modal */}
      {confirmDelete && (
        <ConfirmDeleteModal
          user={confirmDelete}
          busy={busyId === confirmDelete.user_id}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => performDelete(confirmDelete)}
        />
      )}
    </div>
  );
}

function ConfirmDeleteModal({
  user, busy, onCancel, onConfirm,
}: {
  user: Row;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.4)] ring-1 ring-sky-100"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-rose-500 shadow-[0_4px_16px_rgba(244,63,94,0.3)]">
              <AlertTriangle className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight text-slate-900">Удалить пользователя?</div>
              <div className="text-[12px] text-slate-500">Действие необратимо</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-5 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Email</div>
          <div className="mt-1 text-sm font-semibold text-slate-900 break-all">{user.email ?? '—'}</div>
          {user.role ? (
            <div className="mt-2 inline-flex items-center rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
              роль: {ROLE_LABEL[user.role as Role]}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(244,63,94,0.28)] transition hover:bg-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-300/70 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Удалить
          </button>
        </div>
      </div>
    </div>
  );
}

function InviteModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('seller');
  const [sending, setSending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const emailTrim = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(emailTrim)) {
      toast.error('Некорректный email');
      return;
    }
    setSending(true);
    const t = toast.loading('Отправляю приглашение…');
    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailTrim, role }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || 'Ошибка');
      toast.success('Приглашение отправлено');
      onDone();
    } catch (e: any) {
      toast.error(e.message || 'Ошибка');
    } finally {
      toast.dismiss(t);
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.4)] ring-1 ring-sky-100"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.3)]">
              <UserPlus className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight text-slate-900">Пригласить пользователя</div>
              <div className="text-[12px] text-slate-500">На email придёт ссылка для входа</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Email</span>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                autoFocus
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full rounded-xl bg-white pl-10 pr-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 placeholder:text-slate-400"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Роль</span>
            <div className="grid grid-cols-3 gap-2">
              {ROLES.map(r => {
                const active = role === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={
                      'rounded-xl px-3 py-2 text-sm font-semibold transition ' +
                      (active
                        ? 'bg-cyan-500 text-white ring-1 ring-cyan-400 shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
                        : 'bg-white text-slate-600 ring-1 ring-sky-200 hover:bg-sky-50')
                    }
                  >
                    {ROLE_LABEL[r]}
                  </button>
                );
              })}
            </div>
          </label>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={sending}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-300/70 disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Отправить приглашение
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
