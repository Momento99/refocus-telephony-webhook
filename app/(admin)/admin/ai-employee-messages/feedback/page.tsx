'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Sparkles, Shield, User2, Calendar, Volume2, AlertTriangle, Lightbulb } from 'lucide-react';

const BRANCH_ID = 5; // Токмок — единственный пилотный филиал

const MOOD_EMOJI: Record<number, string> = { 1: '😫', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };

const ANON_TOPIC_LABELS: Record<string, string> = {
  complaints:   'Жалобы / раздражение',
  ideas:        'Неозвученные идеи',
  coworkers:    'О коллегах',
  management:   'О руководстве',
  processes:    'Бессмысленные процессы',
  improvements: 'Что изменить в оптике',
};

type DailyRow = {
  id: number;
  employee_id: number;
  employee_name: string;
  day: string;
  mood: number;
  topic_key: string | null;
  question_text: string | null;
  answer_text: string | null;
  answer_voice_url: string | null;
  extra_text: string | null;
  extra_voice_url: string | null;
  submitted_at: string;
};
type WeeklyRow = {
  id: number;
  employee_id: number;
  employee_name: string;
  week_start: string;
  mood: number | null;
  week_text: string | null;
  week_voice_url: string | null;
  helped_text: string | null;
  helped_voice_url: string | null;
};
type AnonRow = {
  id: number;
  week_start: string;
  anon_topic: string;
  transcript: string | null;
  voice_url: string | null;
  submitted_at: string;
};
type MoodPoint = { day: string; avg: number; count: number };

function ymd(d: Date) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bishkek' });
}
function humanDay(s: string) {
  try {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  } catch { return s; }
}

function VoicePlayer({ path }: { path: string }) {
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const load = async () => {
    if (url) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/feedback/voice-url?path=${encodeURIComponent(path)}`);
      const j = await r.json();
      if (j.ok) setUrl(j.signed_url);
    } finally { setLoading(false); }
  };
  return (
    <div className="mt-2">
      {!url ? (
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-200 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}
          Прослушать
        </button>
      ) : (
        <audio src={url} controls className="h-8" />
      )}
    </div>
  );
}

function MoodChart({ points }: { points: MoodPoint[] }) {
  if (!points.length) return <div className="text-sm text-slate-400">Пока нет ответов за период</div>;
  const max = 5;
  return (
    <div className="flex items-end gap-1 h-28">
      {points.map((p) => {
        const h = (p.avg / max) * 100;
        const colour = p.avg >= 4 ? 'bg-emerald-400' : p.avg >= 3 ? 'bg-sky-400' : p.avg >= 2 ? 'bg-amber-400' : 'bg-rose-500';
        return (
          <div key={p.day} className="flex-1 min-w-[24px] flex flex-col items-center gap-1">
            <div className={`w-full rounded-t ${colour}`} style={{ height: `${h}%` }} title={`${p.avg} / 5`} />
            <div className="text-[10px] text-slate-500 whitespace-nowrap">{p.day.slice(5)}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function FeedbackPage() {
  const today = useMemo(() => ymd(new Date()), []);
  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return ymd(d);
  }, []);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [loading, setLoading] = useState(false);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [weekly, setWeekly] = useState<WeeklyRow[]>([]);
  const [anonymous, setAnonymous] = useState<AnonRow[]>([]);
  const [moodChart, setMoodChart] = useState<MoodPoint[]>([]);
  const [tab, setTab] = useState<'signed' | 'anon'>('signed');

  const [digesting, setDigesting] = useState(false);
  const [digest, setDigest] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/feedback/list?branch_id=${BRANCH_ID}&from=${from}&to=${to}`, { cache: 'no-store' });
      const j = await r.json();
      if (j.ok) {
        setDaily(j.daily || []);
        setWeekly(j.weekly || []);
        setAnonymous(j.anonymous || []);
        setMoodChart(j.moodChart || []);
      }
    } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const makeDigest = async () => {
    setDigesting(true);
    setDigest(null);
    try {
      const r = await fetch('/api/feedback/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_id: BRANCH_ID, period_start: from, period_end: to, force: true }),
      });
      const j = await r.json();
      setDigest(j?.summary || j);
    } finally { setDigesting(false); }
  };

  const avgMood = moodChart.length
    ? +(moodChart.reduce((s, p) => s + p.avg * p.count, 0) / moodChart.reduce((s, p) => s + p.count, 0)).toFixed(2)
    : null;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Фидбэк сотрудников</h1>
          <div className="text-sm text-slate-500">Филиал: <b>Токмок</b> · пилот</div>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs text-slate-500">
            с
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="ml-2 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">
            по
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="ml-2 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
          </label>
          <button
            onClick={load}
            disabled={loading}
            className="rounded-xl bg-slate-100 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-200 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Обновить'}
          </button>
        </div>
      </div>

      {/* Верхняя панель: Пульс + Дайджест */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-3xl bg-white ring-1 ring-slate-200/80 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">Пульс настроения</h2>
            {avgMood != null && (
              <div className="text-xs text-slate-500">
                средняя: <span className="text-slate-900 font-semibold">{avgMood}/5 {MOOD_EMOJI[Math.round(avgMood)] || ''}</span> · {daily.length} ответов
              </div>
            )}
          </div>
          <MoodChart points={moodChart} />
        </div>

        <div className="rounded-3xl bg-gradient-to-br from-teal-50 via-cyan-50 to-sky-50 ring-1 ring-sky-200/60 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-sky-600" />
            <h2 className="text-sm font-semibold text-slate-800">AI-дайджест</h2>
          </div>
          <p className="text-xs text-slate-600 mb-3">Claude Sonnet соберёт темы, алерты и идеи за выбранный период.</p>
          <button
            onClick={makeDigest}
            disabled={digesting}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-sky-500 px-4 py-2 text-sm text-white shadow-md hover:opacity-95 disabled:opacity-60"
          >
            {digesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Сформировать
          </button>
        </div>
      </div>

      {/* Дайджест-блок */}
      {digest && (
        <div className="rounded-3xl bg-white ring-1 ring-slate-200/80 p-5 shadow-sm space-y-4">
          {digest.summary && <p className="text-[15px] text-slate-800 leading-relaxed">{digest.summary}</p>}

          {Array.isArray(digest.themes) && digest.themes.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Темы периода</h3>
              <div className="space-y-2">
                {digest.themes.map((t: any, i: number) => (
                  <div key={i} className="rounded-xl bg-slate-50 px-3 py-2">
                    <div className="text-[13px] text-slate-800 font-medium">{t.topic} <span className="text-slate-400">· {t.mentions}</span></div>
                    {Array.isArray(t.excerpts) && t.excerpts.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-[12px] text-slate-600">
                        {t.excerpts.map((e: string, k: number) => <li key={k}>«{e}»</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {Array.isArray(digest.alerts) && digest.alerts.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-rose-700 mb-2 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />Алерты</h3>
              <ul className="space-y-1.5">
                {digest.alerts.map((a: any, i: number) => (
                  <li key={i} className={`rounded-xl px-3 py-2 text-[13px] ${a.severity === 'high' ? 'bg-rose-50 text-rose-900' : a.severity === 'mid' ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-700'}`}>
                    {a.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {Array.isArray(digest.ideas) && digest.ideas.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-emerald-700 mb-2 flex items-center gap-1.5"><Lightbulb className="h-4 w-4" />Идеи от сотрудников</h3>
              <ul className="space-y-1 text-[13px] text-slate-800 list-disc pl-5">
                {digest.ideas.map((it: string, i: number) => <li key={i}>{it}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Табы */}
      <div className="rounded-3xl bg-white ring-1 ring-slate-200/80 p-1.5 shadow-sm inline-flex gap-1">
        <button
          onClick={() => setTab('signed')}
          className={`rounded-xl px-3.5 py-2 text-sm font-medium ${tab === 'signed' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          Именные ({daily.length + weekly.length})
        </button>
        <button
          onClick={() => setTab('anon')}
          className={`rounded-xl px-3.5 py-2 text-sm font-medium ${tab === 'anon' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          <Shield className="h-3.5 w-3.5 inline-block -mt-0.5 mr-1" />Анонимные ({anonymous.length})
        </button>
      </div>

      {tab === 'signed' && (
        <div className="space-y-3">
          {weekly.map((w) => (
            <div key={`w${w.id}`} className="rounded-2xl bg-white ring-1 ring-slate-200/80 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                <span className="inline-flex items-center gap-1.5">
                  <User2 className="h-3.5 w-3.5" />{w.employee_name}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />неделя {humanDay(w.week_start)} · {w.mood ? `${MOOD_EMOJI[w.mood]} ${w.mood}/5` : ''}
                </span>
              </div>
              <div className="inline-block text-[10px] uppercase tracking-wide bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full mb-2">Суббота</div>
              {w.week_text && <p className="text-[14px] text-slate-800">{w.week_text}</p>}
              {w.week_voice_url && <VoicePlayer path={w.week_voice_url} />}
              {w.helped_text && (
                <div className="mt-2 pt-2 border-t border-slate-100">
                  <div className="text-[11px] uppercase text-slate-400">Что помогло</div>
                  <p className="text-[13px] text-slate-700">{w.helped_text}</p>
                </div>
              )}
              {w.helped_voice_url && <VoicePlayer path={w.helped_voice_url} />}
            </div>
          ))}

          {daily.map((d) => (
            <div key={`d${d.id}`} className="rounded-2xl bg-white ring-1 ring-slate-200/80 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                <span className="inline-flex items-center gap-1.5">
                  <User2 className="h-3.5 w-3.5" />{d.employee_name}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />{humanDay(d.day)} · {MOOD_EMOJI[d.mood]} {d.mood}/5
                </span>
              </div>
              {d.question_text && (
                <div className="text-[12px] text-slate-500 mb-1 italic">{d.question_text}</div>
              )}
              {d.answer_text && <p className="text-[14px] text-slate-800">{d.answer_text}</p>}
              {!d.answer_text && d.answer_voice_url && <p className="text-[13px] text-slate-400 italic">Голосовое — транскрипт обрабатывается…</p>}
              {d.answer_voice_url && <VoicePlayer path={d.answer_voice_url} />}
              {(d.extra_text || d.extra_voice_url) && (
                <div className="mt-2 pt-2 border-t border-slate-100">
                  <div className="text-[11px] uppercase text-slate-400">Доп.</div>
                  {d.extra_text && <p className="text-[13px] text-slate-700">{d.extra_text}</p>}
                  {d.extra_voice_url && <VoicePlayer path={d.extra_voice_url} />}
                </div>
              )}
            </div>
          ))}

          {!loading && daily.length + weekly.length === 0 && (
            <div className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-500">
              Пока нет ответов за этот период.
            </div>
          )}
        </div>
      )}

      {tab === 'anon' && (
        <div className="space-y-3">
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-[13px] text-emerald-900">
            <Shield className="h-4 w-4 inline-block -mt-0.5 mr-1" />
            Эти записи не связаны с конкретными сотрудниками — только с филиалом и неделей.
          </div>
          {anonymous.map((a) => (
            <div key={`a${a.id}`} className="rounded-2xl bg-white ring-1 ring-slate-200/80 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                <span className="inline-block text-[10px] uppercase tracking-wide bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                  {ANON_TOPIC_LABELS[a.anon_topic] || a.anon_topic}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />неделя {humanDay(a.week_start)}
                </span>
              </div>
              {a.transcript && <p className="text-[14px] text-slate-800">{a.transcript}</p>}
              {!a.transcript && a.voice_url && <p className="text-[13px] text-slate-400 italic">Транскрипт обрабатывается…</p>}
              {a.voice_url && <VoicePlayer path={a.voice_url} />}
            </div>
          ))}
          {!loading && anonymous.length === 0 && (
            <div className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-500">
              Пока нет анонимных ответов за этот период.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
