'use client';

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import getSupabase from '@/lib/supabaseClient';
import { getDeviceId } from '@/lib/device';

type SessionRow = {
  id: string;
  device_id: string | null;
  user_agent: string | null;
  ip: string | null;
  created_at: string | null;
  last_active: string | null;
  force_logout: boolean | null;
};

export default function SessionsList() {
  const supabase = getSupabase();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [doing, setDoing] = useState<string | null>(null);

  const currentDeviceId = useMemo(() => getDeviceId(), []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('user_sessions')
      .select('id, device_id, user_agent, ip, created_at, last_active, force_logout')
      .order('last_active', { ascending: false })
      .limit(100);

    if (error) {
      console.error(error);
      toast.error('Не удалось загрузить сессии');
    } else {
      setRows((data ?? []) as SessionRow[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // необязательно, но можно периодически обновлять
    // const t = setInterval(load, 30_000);
    // return () => clearInterval(t);
  }, []);

  const currentSessionId = useMemo(() => {
    // Текущую можно определить по device_id (из heartbeat мы сохраняли его в таблице)
    const r = rows.find(r => r.device_id === currentDeviceId);
    return r?.id ?? null;
  }, [rows, currentDeviceId]);

  async function endSession(id: string) {
    try {
      setDoing(id);
      const { error } = await supabase
        .from('user_sessions')
        .update({ force_logout: true })
        .eq('id', id);
      if (error) throw error;
      toast.success('Сессия будет завершена');
      await load();
    } catch (e: any) {
      console.error(e);
      toast.error('Ошибка при завершении сессии');
    } finally {
      setDoing(null);
    }
  }

  async function endAllExceptCurrent() {
    if (!currentSessionId) {
      toast('Не удалось определить текущую сессию', { icon: 'ℹ️' });
    }
    try {
      setDoing('all');
      // Обновляем все свои сессии, кроме текущей
      // RLS пропустит только ваши записи
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes?.user?.id;
      if (!userId) throw new Error('Нет авторизации');

      let q = supabase
        .from('user_sessions')
        .update({ force_logout: true })
        .eq('user_id', userId);

      if (currentSessionId) q = q.neq('id', currentSessionId);

      const { error } = await q;
      if (error) throw error;

      toast.success('Все сессии, кроме текущей, будут завершены');
      await load();
    } catch (e: any) {
      console.error(e);
      toast.error('Ошибка при завершении сессий');
    } finally {
      setDoing(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-white/20 bg-white/40 backdrop-blur p-4">
        Загружаем…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-white/20 bg-white/40 backdrop-blur p-4">
        Записей пока нет.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/20 bg-white/50 backdrop-blur">
      <div className="flex items-center justify-between p-4">
        <h2 className="text-lg font-medium">Устройства</h2>
        <button
          onClick={endAllExceptCurrent}
          disabled={doing !== null}
          className="rounded-full bg-red-600 text-white px-4 py-2 text-sm hover:bg-red-700 disabled:opacity-60"
        >
          {doing === 'all' ? 'Выполняется…' : 'Завершить все, кроме текущей'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left bg-white/40">
              <th className="px-4 py-3">Устройство</th>
              <th className="px-4 py-3">IP</th>
              <th className="px-4 py-3">Создана</th>
              <th className="px-4 py-3">Активность</th>
              <th className="px-4 py-3">Статус</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/30">
            {rows.map(r => {
              const isCurrent = r.device_id === currentDeviceId;
              return (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {isCurrent ? 'Текущая сессия' : 'Сессия'}
                    </div>
                    <div className="text-neutral-500 line-clamp-2">
                      {r.user_agent || '—'}
                    </div>
                  </td>
                  <td className="px-4 py-3">{r.ip || '—'}</td>
                  <td className="px-4 py-3">
                    {formatDate(r.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    {formatDate(r.last_active)}
                  </td>
                  <td className="px-4 py-3">
                    {r.force_logout ? (
                      <span className="text-red-600">помечена к завершению</span>
                    ) : (
                      <span className="text-emerald-700">активна</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => endSession(r.id)}
                      disabled={doing !== null || isCurrent}
                      className="rounded-full bg-neutral-900 text-white px-3 py-1.5 text-xs hover:bg-neutral-800 disabled:opacity-50"
                      title={isCurrent ? 'Нельзя завершить текущую' : 'Завершить'}
                    >
                      {doing === r.id ? '…' : 'Завершить'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}
