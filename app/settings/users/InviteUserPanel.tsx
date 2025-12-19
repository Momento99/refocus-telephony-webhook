'use client';

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import getSupabase from '@/lib/supabaseClient';

type Role = 'owner' | 'manager' | 'seller' | 'master';

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Владелец',
  manager: 'Менеджер',
  seller: 'Продавец',
  master: 'Мастер',
};

export default function InviteUserPanel() {
  // ✅ клиент создаём внутри компонента и мемоизируем
  const sb = useMemo(() => getSupabase(), []);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [role, setRole] = useState<Role>('seller');
  const [email, setEmail] = useState('');
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // ⚠️ выбираем существующие поля (name), а не branch_name
        const { data, error } = await sb.from('branches').select('id, name').order('id', { ascending: true });
        if (error) throw error;
        if (!cancelled) setBranches(data || []);
      } catch (e: any) {
        console.error(e);
        toast.error(e.message || 'Не удалось загрузить филиалы');
      } finally {
        if (!cancelled) setLoadingBranches(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sb]);

  async function onInvite() {
    const emailTrim = email.trim().toLowerCase();
    if (!emailTrim || !/^\S+@\S+\.\S+$/.test(emailTrim)) {
      toast.error('Некорректный email');
      return;
    }
    if (!branchId) {
      toast.error('Выбери филиал');
      return;
    }

    setSending(true);
    const t = toast.loading('Отправляю приглашение…');
    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 👇 серверная ручка ждёт camelCase
        body: JSON.stringify({ email: emailTrim, branchId, role }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        throw new Error(j.error || 'Не удалось пригласить');
      }
      toast.success('Приглашение отправлено (если почта настроена)');
      setEmail('');
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Ошибка при приглашении');
    } finally {
      toast.dismiss(t);
      setSending(false);
    }
  }

  return (
    <div className="rounded-2xl p-[1px] bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-600">
      <div className="rounded-2xl bg-white p-4 md:p-5">
        <div className="text-base font-medium mb-3">Пригласить пользователя</div>

        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="email@domain.com"
            className="w-full md:w-72 px-3 py-2 border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600/30"
          />

          <select
            value={branchId}
            onChange={e => setBranchId(e.target.value ? Number(e.target.value) : '')}
            disabled={loadingBranches}
            className="w-full md:w-56 px-3 py-2 border border-neutral-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/30"
          >
            <option value="">{branches.length ? 'Выбери филиал' : 'Нет филиалов'}</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>

          <select
            value={role}
            onChange={e => setRole(e.target.value as Role)}
            className="w-full md:w-48 px-3 py-2 border border-neutral-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/30"
          >
            <option value="seller">{ROLE_LABEL.seller}</option>
            <option value="master">{ROLE_LABEL.master}</option>
            <option value="manager">{ROLE_LABEL.manager}</option>
            <option value="owner">{ROLE_LABEL.owner}</option>
          </select>

          <button
            onClick={onInvite}
            disabled={sending || loadingBranches}
            className="px-5 py-2 rounded-xl text-white bg-gradient-to-r from-blue-600 to-indigo-700 hover:opacity-95 disabled:opacity-50"
          >
            {sending ? 'Отправляю…' : 'Пригласить'}
          </button>
        </div>

        <p className="text-xs text-neutral-500 mt-3">
          Пользователь получит письмо при настроенном почтовом провайдере. Роль назначится сразу после акцепта.
        </p>
      </div>
    </div>
  );
}
