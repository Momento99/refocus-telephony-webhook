'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import toast from 'react-hot-toast';
import {
  CalendarDays, ArrowLeft, Plus, Trash2, Edit3, Check, X,
  DollarSign, Package, Shield, ClipboardCheck, FileText, Star,
  Bell, Megaphone, GraduationCap, Heart, Zap, ShoppingCart,
  Users, Eye, Truck, Wrench, Clock,
} from 'lucide-react';

const ICONS = [
  { name: 'DollarSign', icon: DollarSign }, { name: 'Package', icon: Package },
  { name: 'Shield', icon: Shield }, { name: 'ClipboardCheck', icon: ClipboardCheck },
  { name: 'FileText', icon: FileText }, { name: 'Star', icon: Star },
  { name: 'Bell', icon: Bell }, { name: 'Megaphone', icon: Megaphone },
  { name: 'GraduationCap', icon: GraduationCap }, { name: 'Heart', icon: Heart },
  { name: 'Zap', icon: Zap }, { name: 'ShoppingCart', icon: ShoppingCart },
  { name: 'Users', icon: Users }, { name: 'Eye', icon: Eye },
  { name: 'Truck', icon: Truck }, { name: 'Wrench', icon: Wrench },
  { name: 'CalendarDays', icon: CalendarDays }, { name: 'Clock', icon: Clock },
];

const COLORS = ['amber', 'sky', 'teal', 'violet', 'indigo', 'red', 'emerald', 'pink'];
const COLOR_BG: Record<string, string> = { amber: 'bg-amber-400', sky: 'bg-sky-400', teal: 'bg-teal-400', violet: 'bg-violet-400', indigo: 'bg-indigo-400', red: 'bg-red-400', emerald: 'bg-emerald-400', pink: 'bg-pink-400' };
const COLOR_HEX: Record<string, { bg: string; ring: string; text: string }> = {
  amber: { bg: '#fffbeb', ring: '#fcd34d', text: '#92400e' },
  sky: { bg: '#f0f9ff', ring: '#7dd3fc', text: '#0369a1' },
  teal: { bg: '#f0fdfa', ring: '#5eead4', text: '#115e59' },
  violet: { bg: '#f5f3ff', ring: '#c4b5fd', text: '#5b21b6' },
  indigo: { bg: '#eef2ff', ring: '#a5b4fc', text: '#3730a3' },
  red: { bg: '#fef2f2', ring: '#fca5a5', text: '#991b1b' },
  emerald: { bg: '#ecfdf5', ring: '#6ee7b7', text: '#065f46' },
  pink: { bg: '#fdf2f8', ring: '#f9a8d4', text: '#9d174d' },
  slate: { bg: '#f8fafc', ring: '#cbd5e1', text: '#475569' },
};
const DOW_NAMES = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

interface Template { id: number; title: string; description: string | null; icon: string; color: string; recurrence_type: string; recurrence_value: number; branch_id: number | null; is_active: boolean; }
interface Branch { id: number; name: string; }
interface OneOffEvent { id: number; title: string; description: string | null; event_date: string; icon: string; color: string; branch_id: number | null; branch_name?: string; }

const cardCls = "rounded-2xl bg-white/95 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,0,0,0.15)] ring-1 ring-sky-200/40";

function sb() { return getBrowserSupabase(); }

export default function FranchiseCalendarPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [events, setEvents] = useState<OneOffEvent[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  // Template form
  const [showTplForm, setShowTplForm] = useState(false);
  const [tplTitle, setTplTitle] = useState('');
  const [tplDesc, setTplDesc] = useState('');
  const [tplIcon, setTplIcon] = useState('CalendarDays');
  const [tplColor, setTplColor] = useState('sky');
  const [tplType, setTplType] = useState('monthly_day');
  const [tplValue, setTplValue] = useState(1);
  const [tplBranch, setTplBranch] = useState<number | null>(null);

  // Event form
  const [showEvForm, setShowEvForm] = useState(false);
  const [evTitle, setEvTitle] = useState('');
  const [evDesc, setEvDesc] = useState('');
  const [evDate, setEvDate] = useState('');
  const [evIcon, setEvIcon] = useState('CalendarDays');
  const [evColor, setEvColor] = useState('red');
  const [evBranch, setEvBranch] = useState<number | null>(null);
  const [evNotify, setEvNotify] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const s = getBrowserSupabase();
      const [{ data: tpl }, { data: ev }, { data: br }] = await Promise.all([
        s.from('franchise_calendar_templates').select('*').order('recurrence_value'),
        s.from('franchise_calendar_events').select('*').order('event_date', { ascending: false }).limit(30),
        s.from('branches').select('id, name').order('name'),
      ]);
      setTemplates((tpl || []) as Template[]);
      const bMap = new Map((br || []).map((b: any) => [b.id, b.name]));
      setEvents((ev || []).map((e: any) => ({ ...e, branch_name: e.branch_id ? bMap.get(e.branch_id) || '' : 'Все' })) as OneOffEvent[]);
      setBranches(br || []);
      setLoading(false);
    })();
  }, []);

  async function saveTpl() {
    if (!tplTitle.trim()) { toast.error('Введите название'); return; }
    await sb().from('franchise_calendar_templates').insert({
      title: tplTitle.trim(), description: tplDesc.trim() || null,
      icon: tplIcon, color: tplColor, recurrence_type: tplType, recurrence_value: tplValue,
      branch_id: tplBranch, is_active: true,
    });
    toast.success('Шаблон создан');
    setShowTplForm(false); setTplTitle(''); setTplDesc('');
    const { data } = await sb().from('franchise_calendar_templates').select('*').order('recurrence_value');
    setTemplates((data || []) as Template[]);
  }

  async function toggleTpl(id: number, active: boolean) {
    await sb().from('franchise_calendar_templates').update({ is_active: !active }).eq('id', id);
    setTemplates((prev) => prev.map((t) => t.id === id ? { ...t, is_active: !active } : t));
  }

  async function deleteTpl(id: number) {
    if (!confirm('Удалить шаблон?')) return;
    await sb().from('franchise_calendar_templates').delete().eq('id', id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }

  async function saveEv() {
    if (!evTitle.trim() || !evDate) { toast.error('Заполните название и дату'); return; }
    const { data } = await sb().from('franchise_calendar_events').insert({
      title: evTitle.trim(), description: evDesc.trim() || null, event_date: evDate,
      icon: evIcon, color: evColor, branch_id: evBranch, is_recurring: false, notify: evNotify,
    }).select().single();
    if (evNotify && data) {
      // Send notification
      await sb().from('franchise_notifications').insert({
        branch_id: evBranch, title: `📅 ${evTitle.trim()}`,
        body: `Новое событие: ${evDate} — ${evDesc.trim() || evTitle.trim()}`,
        priority: 'normal',
      });
    }
    toast.success('Событие создано');
    setShowEvForm(false); setEvTitle(''); setEvDesc(''); setEvDate('');
    const { data: ev } = await sb().from('franchise_calendar_events').select('*').order('event_date', { ascending: false }).limit(30);
    const bMap = new Map(branches.map((b) => [b.id, b.name]));
    setEvents((ev || []).map((e: any) => ({ ...e, branch_name: e.branch_id ? bMap.get(e.branch_id) || '' : 'Все' })));
  }

  async function deleteEv(id: number) {
    if (!confirm('Удалить событие?')) return;
    await sb().from('franchise_calendar_events').delete().eq('id', id);
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }

  function getIcon(name: string) { return ICONS.find((i) => i.name === name)?.icon || CalendarDays; }

  return (
    <div className="mx-auto max-w-5xl px-5 pt-8 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/admin/franchise-map" className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/10 hover:bg-white/20 transition-colors">
            <ArrowLeft size={18} className="text-slate-300" />
          </Link>
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 shadow-[0_4px_20px_rgba(56,189,248,0.35)]">
              <CalendarDays size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Календарь франчайзи</h1>
              <p className="text-[12px] text-slate-400">Шаблоны повторяющихся событий и разовые события</p>
            </div>
          </div>
        </div>
      </div>

      {loading ? <div className={`${cardCls} p-10 text-center text-slate-400`}>Загрузка...</div> : (
        <div className="space-y-6">
          {/* ═══ TEMPLATES ═══ */}
          <div className={`${cardCls} overflow-hidden`}>
            <div className="px-5 py-4 flex items-center justify-between border-b border-sky-100/50">
              <div className="text-sm font-bold text-slate-800">Повторяющиеся события</div>
              <button onClick={() => setShowTplForm(!showTplForm)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-teal-400 to-cyan-400 text-white text-[13px] font-semibold shadow-sm">
                <Plus size={14} /> Добавить
              </button>
            </div>

            {showTplForm && (
              <div className="px-5 py-4 border-b border-sky-100/50 bg-sky-50/30">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <input type="text" value={tplTitle} onChange={(e) => setTplTitle(e.target.value)} placeholder="Название"
                    className="px-3 py-2 rounded-xl border border-sky-200 bg-white text-sm text-slate-900 outline-none focus:ring-2 focus:ring-cyan-400" />
                  <input type="text" value={tplDesc} onChange={(e) => setTplDesc(e.target.value)} placeholder="Описание"
                    className="px-3 py-2 rounded-xl border border-sky-200 bg-white text-sm text-slate-900 outline-none focus:ring-2 focus:ring-cyan-400" />
                </div>
                <div className="flex flex-wrap gap-3 mb-3">
                  <div>
                    <div className="text-[10px] text-slate-400 font-semibold uppercase mb-1">Иконка</div>
                    <div className="flex flex-wrap gap-1">
                      {ICONS.map((ic) => { const I = ic.icon; return (
                        <button key={ic.name} onClick={() => setTplIcon(ic.name)}
                          className={`h-8 w-8 rounded-lg flex items-center justify-center transition-all ${tplIcon === ic.name ? 'bg-sky-100 ring-2 ring-sky-400' : 'bg-slate-50 hover:bg-slate-100'}`}>
                          <I size={14} className="text-slate-600" />
                        </button>
                      ); })}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 font-semibold uppercase mb-1">Цвет</div>
                    <div className="flex gap-1.5">
                      {COLORS.map((c) => (
                        <button key={c} onClick={() => setTplColor(c)}
                          className={`h-8 w-8 rounded-full ${COLOR_BG[c]} transition-all ${tplColor === c ? 'ring-2 ring-offset-2 ring-slate-800 scale-110' : 'hover:scale-105'}`} />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 mb-3">
                  <select value={tplType} onChange={(e) => setTplType(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-sky-200 bg-white text-sm text-slate-900 outline-none">
                    <option value="monthly_day">Каждый месяц</option>
                    <option value="weekly_dow">Каждую неделю</option>
                  </select>
                  {tplType === 'monthly_day' ? (
                    <select value={tplValue} onChange={(e) => setTplValue(Number(e.target.value))}
                      className="px-3 py-2 rounded-xl border border-sky-200 bg-white text-sm text-slate-900 outline-none">
                      <option value={0}>Последний день</option>
                      {Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}-е число</option>)}
                    </select>
                  ) : (
                    <select value={tplValue} onChange={(e) => setTplValue(Number(e.target.value))}
                      className="px-3 py-2 rounded-xl border border-sky-200 bg-white text-sm text-slate-900 outline-none">
                      {DOW_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                    </select>
                  )}
                  <select value={tplBranch ?? ''} onChange={(e) => setTplBranch(e.target.value ? Number(e.target.value) : null)}
                    className="px-3 py-2 rounded-xl border border-sky-200 bg-white text-sm text-slate-900 outline-none">
                    <option value="">Все филиалы</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button onClick={saveTpl} className="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-400 to-cyan-400 text-white text-sm font-semibold shadow-sm">Создать</button>
                  <button onClick={() => setShowTplForm(false)} className="px-3 py-2 rounded-xl bg-slate-100 text-slate-500 text-sm">Отмена</button>
                </div>
              </div>
            )}

            {templates.map((t) => {
              const Icon = getIcon(t.icon);
              return (
                <div key={t.id} className={`flex items-center gap-4 px-5 py-3.5 border-b border-sky-50 ${t.is_active ? '' : 'opacity-40'}`}>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1"
                    style={{ background: COLOR_HEX[t.color]?.bg || '#f8fafc', borderColor: COLOR_HEX[t.color]?.ring || '#cbd5e1', boxShadow: `0 0 0 1px ${COLOR_HEX[t.color]?.ring || '#cbd5e1'}` }}>
                    <Icon size={18} style={{ color: COLOR_HEX[t.color]?.text || '#475569' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-800">{t.title}</div>
                    <div className="text-[11px] text-slate-400">
                      {t.recurrence_type === 'monthly_day' ? (t.recurrence_value === 0 ? 'Последний день месяца' : `${t.recurrence_value}-е число`) : DOW_NAMES[t.recurrence_value]}
                      {t.description && ` · ${t.description}`}
                    </div>
                  </div>
                  <button onClick={() => toggleTpl(t.id, t.is_active)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold ${t.is_active ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-slate-100 text-slate-400 ring-1 ring-slate-200'}`}>
                    {t.is_active ? 'Вкл' : 'Выкл'}
                  </button>
                  <button onClick={() => deleteTpl(t.id)} className="text-slate-400 hover:text-red-600 transition-colors">
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* ═══ ONE-OFF EVENTS ═══ */}
          <div className={`${cardCls} overflow-hidden`}>
            <div className="px-5 py-4 flex items-center justify-between border-b border-sky-100/50">
              <div className="text-sm font-bold text-slate-800">Разовые события</div>
              <button onClick={() => setShowEvForm(!showEvForm)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-teal-400 to-cyan-400 text-white text-[13px] font-semibold shadow-sm">
                <Plus size={14} /> Добавить
              </button>
            </div>

            {showEvForm && (
              <div className="px-5 py-4 border-b border-sky-100/50 bg-sky-50/30">
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <input type="text" value={evTitle} onChange={(e) => setEvTitle(e.target.value)} placeholder="Название"
                    className="px-3 py-2 rounded-xl border border-sky-200 bg-white text-sm text-slate-900 outline-none focus:ring-2 focus:ring-cyan-400" />
                  <input type="text" value={evDesc} onChange={(e) => setEvDesc(e.target.value)} placeholder="Описание"
                    className="px-3 py-2 rounded-xl border border-sky-200 bg-white text-sm text-slate-900 outline-none focus:ring-2 focus:ring-cyan-400" />
                  <input type="date" value={evDate} onChange={(e) => setEvDate(e.target.value)}
                    onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
                    className="px-3 py-2 rounded-xl border border-sky-200 bg-white text-sm text-slate-900 outline-none focus:ring-2 focus:ring-cyan-400 cursor-pointer" />
                </div>
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <div className="flex gap-1">
                    {ICONS.slice(0, 12).map((ic) => { const I = ic.icon; return (
                      <button key={ic.name} onClick={() => setEvIcon(ic.name)}
                        className={`h-7 w-7 rounded-lg flex items-center justify-center ${evIcon === ic.name ? 'bg-sky-100 ring-2 ring-sky-400' : 'bg-slate-50 hover:bg-slate-100'}`}>
                        <I size={13} className="text-slate-600" />
                      </button>
                    ); })}
                  </div>
                  <div className="flex gap-1">
                    {COLORS.map((c) => (
                      <button key={c} onClick={() => setEvColor(c)}
                        className={`h-7 w-7 rounded-full ${COLOR_BG[c]} ${evColor === c ? 'ring-2 ring-offset-1 ring-slate-800' : ''}`} />
                    ))}
                  </div>
                  <select value={evBranch ?? ''} onChange={(e) => setEvBranch(e.target.value ? Number(e.target.value) : null)}
                    className="px-3 py-1.5 rounded-xl border border-sky-200 bg-white text-sm text-slate-900 outline-none">
                    <option value="">Все</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
                    <input type="checkbox" checked={evNotify} onChange={(e) => setEvNotify(e.target.checked)} className="rounded" />
                    Уведомить
                  </label>
                </div>
                <div className="flex gap-2">
                  <button onClick={saveEv} className="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-400 to-cyan-400 text-white text-sm font-semibold shadow-sm">Создать</button>
                  <button onClick={() => setShowEvForm(false)} className="px-3 py-2 rounded-xl bg-slate-100 text-slate-500 text-sm">Отмена</button>
                </div>
              </div>
            )}

            {events.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-400">Нет разовых событий</div>
            ) : events.map((ev) => {
              const Icon = getIcon(ev.icon);
              return (
                <div key={ev.id} className="flex items-center gap-4 px-5 py-3 border-b border-sky-50">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1"
                    style={{ background: COLOR_HEX[ev.color]?.bg || '#f8fafc', boxShadow: `0 0 0 1px ${COLOR_HEX[ev.color]?.ring || '#cbd5e1'}` }}>
                    <Icon size={16} style={{ color: COLOR_HEX[ev.color]?.text || '#475569' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-800">{ev.title}</div>
                    <div className="text-[11px] text-slate-400">{ev.event_date} · {ev.branch_name}</div>
                  </div>
                  <button onClick={() => deleteEv(ev.id)} className="text-slate-400 hover:text-red-600 transition-colors">
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
