'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import { EyeOff, Monitor, RefreshCw } from 'lucide-react';

/* ---------- types ---------- */

type FocusEventRow = {
  id: number;
  terminal_code: string;
  branch_id: number | null;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  event_kind: string;
};

type Branch = { id: number; name: string };

type TerminalStat = {
  terminal_code: string;
  branch_name: string | null;
  count: number;
  total_seconds: number;
  longest_seconds: number;
};

type RangeKey = 'today' | 'yesterday' | '7d' | '30d';

/* ---------- helpers ---------- */

function rangeBounds(key: RangeKey): { from: string; to: string } {
  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);

  if (key === 'today') {
    return { from: startToday.toISOString(), to: now.toISOString() };
  }
  if (key === 'yesterday') {
    const startYest = new Date(startToday);
    startYest.setDate(startYest.getDate() - 1);
    return { from: startYest.toISOString(), to: startToday.toISOString() };
  }
  const days = key === '7d' ? 7 : 30;
  const from = new Date(startToday);
  from.setDate(from.getDate() - (days - 1));
  return { from: from.toISOString(), to: now.toISOString() };
}

function fmtDuration(sec: number): string {
  if (!sec) return '0 с';
  if (sec < 60) return `${sec} с`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s ? `${m} мин ${s} с` : `${m} мин`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h} ч ${mm} мин` : `${h} ч`;
}

const RANGE_LABELS: Record<RangeKey, string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  '7d': '7 дней',
  '30d': '30 дней',
};

/* ---------- component ---------- */

export default function AppFocusBlock() {
  const [range, setRange] = useState<RangeKey>('7d');
  const [branchId, setBranchId] = useState<number | 'all'>('all');
  const [events, setEvents] = useState<FocusEventRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const sb = getBrowserSupabase();
      const { from, to } = rangeBounds(range);

      const [evRes, brRes] = await Promise.all([
        sb
          .from('pos_focus_events')
          .select(
            'id, terminal_code, branch_id, started_at, ended_at, duration_seconds, event_kind',
          )
          .gte('started_at', from)
          .lte('started_at', to)
          .order('started_at', { ascending: false })
          .limit(2000),
        sb.from('branches').select('id, name'),
      ]);

      setEvents((evRes.data as FocusEventRow[]) || []);
      setBranches((brRes.data as Branch[]) || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const filtered = useMemo(() => {
    if (branchId === 'all') return events;
    return events.filter((e) => e.branch_id === branchId);
  }, [events, branchId]);

  const branchById = useMemo(() => {
    const m = new Map<number, string>();
    for (const b of branches) m.set(b.id, b.name);
    return m;
  }, [branches]);

  const terminalStats = useMemo<TerminalStat[]>(() => {
    const map = new Map<string, TerminalStat>();
    for (const ev of filtered) {
      const code = ev.terminal_code || '—';
      const dur = ev.duration_seconds || 0;
      const cur = map.get(code);
      if (cur) {
        cur.count += 1;
        cur.total_seconds += dur;
        if (dur > cur.longest_seconds) cur.longest_seconds = dur;
      } else {
        map.set(code, {
          terminal_code: code,
          branch_name: ev.branch_id != null ? branchById.get(ev.branch_id) ?? null : null,
          count: 1,
          total_seconds: dur,
          longest_seconds: dur,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.total_seconds - a.total_seconds);
  }, [filtered, branchById]);

  const totalCount = filtered.length;
  const totalSec = filtered.reduce((s, e) => s + (e.duration_seconds || 0), 0);

  return (
    <div className="rounded-2xl bg-white ring-1 ring-sky-100 px-5 py-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)] text-slate-900">
      {/* Заголовок */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
            <EyeOff className="h-4 w-4 text-slate-500" />
            Выходы из приложения
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            POS фиксирует, когда касса свернула приложение или переключилась в браузер.
            Группировка только по терминалам — на смене может быть несколько продавцов,
            точно определить «кто именно вышел» нельзя. Источник:{' '}
            <span className="font-mono">pos_focus_events</span>.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1 rounded-lg ring-1 ring-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 transition"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Обновить
        </button>
      </div>

      {/* Фильтры */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[11px]">
          {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setRange(k)}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                range === k
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {RANGE_LABELS[k]}
            </button>
          ))}
        </div>

        <select
          value={String(branchId)}
          onChange={(e) =>
            setBranchId(e.target.value === 'all' ? 'all' : Number(e.target.value))
          }
          className="rounded-lg ring-1 ring-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-300"
        >
          <option value="all">Все филиалы</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>

        <span className="ml-auto inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
          <Monitor className="h-3 w-3" /> По терминалам
        </span>
      </div>

      {/* Сводка */}
      <div className="mb-3 inline-flex items-center gap-2 rounded-xl bg-rose-50 ring-1 ring-rose-100 px-3 py-1.5 text-[12px]">
        <span className="font-semibold text-rose-700 tabular-nums">{totalCount}</span>
        <span className="text-rose-700">выходов</span>
        <span className="text-rose-300">·</span>
        <span className="font-semibold text-rose-700 tabular-nums">{fmtDuration(totalSec)}</span>
        <span className="text-rose-700">суммарно</span>
      </div>

      {/* Таблица */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="px-3 py-2 text-left">Терминал</th>
              <th className="px-3 py-2 text-left">Филиал</th>
              <th className="px-3 py-2 text-right">Кол-во</th>
              <th className="px-3 py-2 text-right">Суммарно</th>
              <th className="px-3 py-2 text-right">Самый долгий</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {terminalStats.map((s) => (
              <tr key={s.terminal_code}>
                <td className="px-3 py-2.5 font-mono font-medium text-slate-900">
                  {s.terminal_code}
                </td>
                <td className="px-3 py-2.5 text-slate-600">{s.branch_name || '—'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{s.count}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-rose-700">
                  {fmtDuration(s.total_seconds)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                  {fmtDuration(s.longest_seconds)}
                </td>
              </tr>
            ))}
            {!loading && terminalStats.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                  Выходов нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
