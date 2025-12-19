// /components/security/SessionsPanel.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';

type SessionRow = {
  id: string;
  user_id: string;
  device_id: string | null;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_active: string | null;
  updated_at: string;
  force_logout: boolean | null;
};

function getOrMakeDeviceId(): string {
  const KEY = 'rf_device_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
    localStorage.setItem(KEY, id);
  }
  return id;
}

export default function SessionsPanel() {
  const supabase = getBrowserSupabase();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentDeviceId = useMemo(getOrMakeDeviceId, []);

  async function load() {
    try {
      setLoading(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setRows([]);
        setUid(null);
        setLoading(false);
        return;
      }
      setUid(user.id);

      const { data, error } = await supabase
        .from('user_sessions')
        .select('id,user_id,device_id,user_agent,ip,created_at,last_active,updated_at,force_logout')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setRows(data as SessionRow[]);
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // авто-обновление списка раз в 60 секунд
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const current = rows.filter(r => r.device_id === currentDeviceId);
  const others  = rows.filter(r => r.device_id !== currentDeviceId);

  async function logoutById(id: string) {
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session) return;

      const { error } = await supabase
        .from('user_sessions')
        .update({ force_logout: true })
        .eq('id', id);

      if (error) throw error;
      await load();
      alert('Готово: сессия будет завершена в ближайшую минуту.');
    } catch (e: any) {
      alert('Ошибка: ' + (e?.message || 'не удалось завершить сессию'));
    }
  }

  async function logoutOthers() {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();
      if (!sess?.session || !user) return;

      const { error } = await supabase
        .from('user_sessions')
        .update({ force_logout: true })
        .eq('user_id', user.id)
        .neq('device_id', currentDeviceId);

      if (error) throw error;
      await load();
      alert('Готово: все другие устройства скоро выйдут.');
    } catch (e: any) {
      alert('Ошибка: ' + (e?.message || 'не удалось завершить другие сессии'));
    }
  }

  async function logoutAll() {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();
      if (!sess?.session || !user) return;

      const { error } = await supabase
        .from('user_sessions')
        .update({ force_logout: true })
        .eq('user_id', user.id);

      if (error) throw error;
      await load();
      alert('Готово: все устройства будут разлогинены.');
    } catch (e: any) {
      alert('Ошибка: ' + (e?.message || 'не удалось разлогинить все устройства'));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Активные сессии</h2>
        <div className="flex gap-2">
          <button
            onClick={logoutOthers}
            className="rounded-lg bg-amber-500 px-3 py-2 text-white hover:bg-amber-600"
            title="Выйти на всех устройствах, кроме текущего"
          >
            Выйти на других устройствах
          </button>
          <button
            onClick={logoutAll}
            className="rounded-lg bg-rose-600 px-3 py-2 text-white hover:bg-rose-700"
            title="Выйти везде"
          >
            Выйти везде
          </button>
        </div>
      </div>

      {loading && <div className="text-neutral-500">Загрузка…</div>}
      {error   && <div className="text-rose-600">Ошибка: {error}</div>}
      {!loading && rows.length === 0 && (
        <div className="text-neutral-500">Сессий пока нет.</div>
      )}

      {/* Текущее устройство */}
      {current.length > 0 && (
        <div>
          <h3 className="mb-2 font-medium text-neutral-700">Это устройство</h3>
          <ul className="space-y-2">
            {current.map(r => (
              <li key={r.id} className="rounded-lg border border-white/40 bg-white/40 px-4 py-3 backdrop-blur">
                <div className="text-sm">
                  <div className="font-medium">{r.user_agent || 'unknown'}</div>
                  <div className="text-neutral-500">
                    IP: {r.ip || '—'} · Последняя активность: {r.last_active ? new Date(r.last_active).toLocaleString() : '—'}
                  </div>
                </div>
                <div className="mt-2 text-xs text-green-700">Текущая сессия</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Другие */}
      {others.length > 0 && (
        <div>
          <h3 className="mb-2 font-medium text-neutral-700">Другие устройства</h3>
          <ul className="space-y-2">
            {others.map(r => (
              <li key={r.id} className="flex items-start justify-between rounded-lg border border-white/40 bg-white/40 px-4 py-3 backdrop-blur">
                <div className="text-sm">
                  <div className="font-medium">{r.user_agent || 'unknown'}</div>
                  <div className="text-neutral-500">
                    IP: {r.ip || '—'} · Последняя активность: {r.last_active ? new Date(r.last_active).toLocaleString() : '—'}
                  </div>
                </div>
                <button
                  onClick={() => logoutById(r.id)}
                  className="ml-3 rounded bg-neutral-800 px-3 py-1.5 text-sm text-white hover:bg-neutral-900"
                >
                  Завершить
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
