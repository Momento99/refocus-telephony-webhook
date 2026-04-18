'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Inbox, MapPin, Phone, MessageCircle,
  Clock, User, Building2, CalendarClock, StickyNote, ChevronDown,
} from 'lucide-react';

type App = {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  budget: string | null;
  comment: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  new:         { label: 'Новая',       cls: 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200' },
  contacted:   { label: 'Связались',   cls: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  negotiation: { label: 'Переговоры',  cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  converted:   { label: 'Партнёр',     cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  rejected:    { label: 'Отклонена',   cls: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200' },
};

const BUDGET_MAP: Record<string, string> = {
  both: 'Помещение + бюджет', budget: 'Есть бюджет', space: 'Есть помещение', none: 'Планирует',
};

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function cleanPhone(p: string) {
  return p.replace(/[^+\d]/g, '');
}

function waLink(phone: string, name: string) {
  const num = cleanPhone(phone).replace(/^\+/, '');
  const text = encodeURIComponent(
    `Здравствуйте, ${name}! Спасибо за заявку на франшизу Refocus. Я бы хотел обсудить с вами детали сотрудничества. Когда вам будет удобно поговорить?`
  );
  return `https://wa.me/${num}?text=${text}`;
}

export default function FranchiseApplicationsPage() {
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [notes, setNotes] = useState<Record<string, string>>({});

  function sb() { return getBrowserSupabase(); }

  async function load() {
    setLoading(true);
    const { data } = await sb()
      .from('franchise_applications')
      .select('*')
      .order('created_at', { ascending: false });
    setApps((data || []) as App[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function updateStatus(id: string, status: string) {
    await sb().from('franchise_applications').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    setApps(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    toast.success('Статус обновлён');
  }

  async function saveNote(id: string) {
    const note = notes[id];
    if (note === undefined) return;
    await sb().from('franchise_applications').update({ admin_note: note, updated_at: new Date().toISOString() }).eq('id', id);
    setApps(prev => prev.map(a => a.id === id ? { ...a, admin_note: note } : a));
    toast.success('Заметка сохранена');
  }

  const filtered = filter === 'all' ? apps : apps.filter(a => a.status === filter);
  const newCount = apps.filter(a => a.status === 'new').length;

  return (
    <div className="mx-auto max-w-5xl px-5 pt-8 pb-12">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/admin/franchise-map" className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/15 transition-colors">
            <ArrowLeft size={16} className="text-slate-400" />
          </Link>
          <div>
            <h1 className="text-[20px] font-bold text-white tracking-tight">Заявки на франшизу</h1>
            <p className="text-[12px] text-slate-400">{apps.length} заявок{newCount > 0 ? ` · ${newCount} новых` : ''}</p>
          </div>
        </div>
        <button onClick={load} disabled={loading}
          className="px-4 py-2.5 rounded-xl bg-white/10 text-slate-300 text-[13px] font-medium hover:bg-white/15 disabled:opacity-50 transition-all">
          Обновить
        </button>
      </div>

      {/* Фильтры */}
      <div className="flex flex-wrap gap-2 mb-5">
        {[
          { key: 'all', label: 'Все', count: apps.length },
          { key: 'new', label: 'Новые', count: newCount },
          { key: 'contacted', label: 'Связались', count: apps.filter(a => a.status === 'contacted').length },
          { key: 'negotiation', label: 'Переговоры', count: apps.filter(a => a.status === 'negotiation').length },
          { key: 'converted', label: 'Партнёры', count: apps.filter(a => a.status === 'converted').length },
          { key: 'rejected', label: 'Отклонённые', count: apps.filter(a => a.status === 'rejected').length },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3.5 py-2 rounded-xl text-[12px] font-semibold transition-all ${
              filter === f.key
                ? 'bg-[#22d3ee] text-[#0f172a] shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
                : 'bg-white/10 text-slate-400 hover:bg-white/15 hover:text-white'
            }`}>
            {f.label}{f.count > 0 ? ` (${f.count})` : ''}
          </button>
        ))}
      </div>

      {/* Список */}
      {loading ? (
        <div className="text-center py-16 text-slate-500 text-sm">Загрузка...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Inbox size={32} className="mx-auto text-slate-600 mb-3" />
          <p className="text-slate-400 text-sm">{filter === 'all' ? 'Пока нет заявок' : 'Нет заявок с таким статусом'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(app => {
            const st = STATUS_MAP[app.status] || STATUS_MAP.new;
            const isNew = app.status === 'new';
            return (
              <div key={app.id} className={`rounded-2xl bg-white ring-1 ring-slate-200 p-5 transition-all ${isNew ? 'shadow-[0_0_0_2px_rgba(34,211,238,0.2),0_4px_20px_rgba(34,211,238,0.08)]' : 'shadow-sm'}`}>

                {/* Верхняя строка */}
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-[15px] font-bold shrink-0 ${isNew ? 'bg-gradient-to-br from-[#22d3ee] to-cyan-500 text-[#0f172a]' : 'bg-slate-100 text-slate-500'}`}>
                      {app.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-[15px] font-semibold text-slate-900">{app.name}</div>
                      <div className="flex items-center gap-3 mt-0.5">
                        {app.city && (
                          <span className="flex items-center gap-1 text-[11px] text-slate-400">
                            <MapPin size={10} /> {app.city}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          <Clock size={10} /> {fmtDate(app.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <select
                    value={app.status}
                    onChange={e => updateStatus(app.id, e.target.value)}
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold cursor-pointer outline-none ${st.cls}`}
                  >
                    <option value="new">Новая</option>
                    <option value="contacted">Связались</option>
                    <option value="negotiation">Переговоры</option>
                    <option value="converted">Партнёр</option>
                    <option value="rejected">Отклонена</option>
                  </select>
                </div>

                {/* Контакты — кнопки */}
                <div className="flex items-center gap-2 mb-3">
                  <a href={waLink(app.phone, app.name)} target="_blank" rel="noopener"
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 ring-1 ring-emerald-200 text-emerald-700 text-[12px] font-semibold hover:bg-emerald-100 transition-all">
                    <MessageCircle size={14} />
                    WhatsApp
                  </a>
                  <a href={`tel:${cleanPhone(app.phone)}`}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-50 ring-1 ring-slate-200 text-slate-700 text-[12px] font-semibold hover:bg-slate-100 transition-all">
                    <Phone size={14} />
                    {app.phone}
                  </a>
                </div>

                {/* Детали */}
                <div className="flex flex-wrap gap-2 mb-3">
                  {app.budget && (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 ring-1 ring-slate-100 text-[11px] text-slate-600">
                      <Building2 size={11} /> {BUDGET_MAP[app.budget] || app.budget}
                    </span>
                  )}
                  {app.comment && app.comment.includes('Опыт:') && (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 ring-1 ring-slate-100 text-[11px] text-slate-600">
                      <User size={11} /> {app.comment.split('\n').find(l => l.startsWith('Опыт:'))?.replace('Опыт: ', '')}
                    </span>
                  )}
                  {app.comment && app.comment.includes('Сроки:') && (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 ring-1 ring-slate-100 text-[11px] text-slate-600">
                      <CalendarClock size={11} /> {app.comment.split('\n').find(l => l.startsWith('Сроки:'))?.replace('Сроки: ', '')}
                    </span>
                  )}
                </div>

                {/* Комментарий заявителя */}
                {app.comment && (() => {
                  const lines = app.comment.split('\n').filter(l => !l.startsWith('Опыт:') && !l.startsWith('Сроки:') && l.trim());
                  return lines.length > 0 ? (
                    <div className="text-[12px] text-slate-500 italic mb-3 bg-slate-50 rounded-lg px-3 py-2">
                      "{lines.join(' ')}"
                    </div>
                  ) : null;
                })()}

                {/* Заметка админа */}
                <div className="flex items-center gap-2">
                  <StickyNote size={12} className="text-slate-300 shrink-0" />
                  <input
                    type="text"
                    placeholder="Ваша заметка..."
                    value={notes[app.id] ?? app.admin_note ?? ''}
                    onChange={e => setNotes(prev => ({ ...prev, [app.id]: e.target.value }))}
                    onBlur={() => saveNote(app.id)}
                    onKeyDown={e => { if (e.key === 'Enter') saveNote(app.id); }}
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-50 ring-1 ring-slate-100 text-[12px] text-slate-700 placeholder:text-slate-300 outline-none focus:ring-cyan-300 transition-all"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
