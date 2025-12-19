'use client';

import { useEffect, useState } from 'react';
import getSupabase from '@/lib/supabaseClient';

type Session = {
  id: string;
  user_id: string;
  device_id: string;
  user_agent: string;
  ip: string;
  created_at: string;
  last_active: string;
};

export default function SecuritySessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);

  // Загружаем список сессий
  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    const supabase = getSupabase();
    setLoading(true);

    const { data, error } = await supabase
      .from('user_sessions')
      .select('*')
      .order('last_active', { ascending: false });

    if (error) {
      console.error('Ошибка загрузки сессий:', error.message);
    } else {
      setSessions(data || []);
    }

    setLoading(false);
  }

  // Завершить конкретную сессию
  async function terminateSession(id: string) {
    const supabase = getSupabase();

    const { error } = await supabase
      .from('user_sessions')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Ошибка завершения сессии:', error.message);
      return;
    }

    setSessions(sessions.filter((s) => s.id !== id));
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Активные сессии</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Список устройств, где выполнен вход. При необходимости можно завершить.
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-neutral-500">Загрузка...</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-neutral-500">Активных сессий нет.</p>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
            >
              <div>
                <p className="text-sm font-medium">
                  {s.user_agent || 'Неизвестное устройство'}
                </p>
                <p className="text-xs text-neutral-500">
                  IP: {s.ip || '—'} | Последняя активность:{' '}
                  {new Date(s.last_active).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => terminateSession(s.id)}
                className="rounded-full bg-red-500 px-3 py-1 text-xs text-white hover:bg-red-600"
              >
                Завершить
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
