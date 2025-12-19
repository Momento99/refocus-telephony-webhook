'use client';

import { useEffect, useState } from 'react';
import getSupabase from '@/lib/supabaseClient';

type Row = {
  id: number;
  user_id: string;
  event: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
};

export default function SecurityLogsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();

    async function load() {
      setLoading(true);
      setMsg(null);

      // 1) Берём текущего пользователя
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) {
        console.error('getUser error:', userErr);
        setMsg('Не удалось получить текущего пользователя.');
        setRows([]);
        setLoading(false);
        return;
      }
      const user = userRes?.user;
      if (!user) {
        setMsg('Вы не авторизованы.');
        setRows([]);
        setLoading(false);
        return;
      }

      // 2) Явно передаём user_id в RPC
      const { data, error } = await supabase.rpc('get_user_login_logs_by_uid', {
        p_user_id: user.id,
      });

      if (error) {
        console.error('RPC get_user_login_logs_by_uid error:', error);
        setMsg('Ошибка загрузки журнала.');
        setRows([]);
      } else {
        setRows((data as Row[]) ?? []);
      }
      setLoading(false);
    }

    load();
  }, []);

  return (
    <div className="p-6 rounded-xl bg-white/60 shadow-sm">
      <h2 className="text-2xl font-semibold mb-4">Журнал входов</h2>

      {loading && <div>Загрузка…</div>}

      {!loading && msg && (
        <div className="text-slate-500">{msg}</div>
      )}

      {!loading && !msg && rows && rows.length === 0 && (
        <div className="text-slate-500">Записей пока нет.</div>
      )}

      {!loading && rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-4">Дата</th>
                <th className="py-2 pr-4">Событие</th>
                <th className="py-2 pr-4">IP</th>
                <th className="py-2 pr-4">User-Agent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-4">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4">{r.event}</td>
                  <td className="py-2 pr-4">{r.ip ?? '—'}</td>
                  <td className="py-2 pr-4 truncate max-w-[420px]">
                    {r.user_agent ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
