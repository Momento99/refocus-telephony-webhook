'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import toast from 'react-hot-toast';
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2, X,
  AlertTriangle, Globe, Building2, User2, Repeat, Clock, RefreshCw,
} from 'lucide-react';
import {
  EVENT_TYPES, EVENT_TYPE_MAP, COLOR_STYLES, COLOR_KEYS,
  MONTHS_RU, DAYS_SHORT, DOW_NAMES_RU,
  getColor, getIconByName, pad2, todayDateString,
  type CalendarEventType, type CalendarColorKey, type CalendarAudience,
} from '@/lib/calendarEventTypes';

type DbTemplate = {
  id: number; title: string; description: string | null;
  icon: string; color: string; event_type: string;
  recurrence_type: string; recurrence_value: number; recurrence_month: number | null;
  branch_id: number | null; employee_id: number | null;
  audience: CalendarAudience; country_id: string | null; is_active: boolean;
};

type DbEvent = {
  id: number; title: string; description: string | null;
  event_date: string; event_type: string;
  icon: string; color: string;
  branch_id: number | null; employee_id: number | null;
  audience: CalendarAudience; notify: boolean | null;
};

type Branch = { id: number; name: string };
type Employee = { id: number; full_name: string; branch_id: number | null; is_active: boolean };

type GridDay = { date: string; day: number; isCurrentMonth: boolean; isToday: boolean; isDayOff: boolean };

type DisplayEvent = {
  key: string;
  realId: number | null;        // null если виртуальное (из шаблона)
  templateId: number | null;
  title: string;
  description: string | null;
  event_date: string;
  event_type: string;
  icon: string;
  color: string;
  branch_id: number | null;
  employee_id: number | null;
  audience: CalendarAudience;
  is_recurring: boolean;
};

const sb = () => getBrowserSupabase();

function expandTemplates(tpls: DbTemplate[], year: number, month: number): DisplayEvent[] {
  const out: DisplayEvent[] = [];
  const lastDay = new Date(year, month + 1, 0).getDate();
  const p = (d: number) => `${year}-${pad2(month + 1)}-${pad2(d)}`;

  for (const t of tpls) {
    if (!t.is_active) continue;
    if (t.recurrence_type === 'monthly_day') {
      const day = t.recurrence_value === 0 ? lastDay : Math.min(t.recurrence_value, lastDay);
      out.push({
        key: `t${t.id}-${day}`,
        realId: null, templateId: t.id,
        title: t.title, description: t.description,
        event_date: p(day), event_type: t.event_type || 'custom',
        icon: t.icon, color: t.color,
        branch_id: t.branch_id, employee_id: t.employee_id,
        audience: t.audience, is_recurring: true,
      });
    } else if (t.recurrence_type === 'weekly_dow') {
      for (let d = 1; d <= lastDay; d++) {
        if (new Date(year, month, d).getDay() === t.recurrence_value) {
          out.push({
            key: `t${t.id}-${d}`,
            realId: null, templateId: t.id,
            title: t.title, description: t.description,
            event_date: p(d), event_type: t.event_type || 'custom',
            icon: t.icon, color: t.color,
            branch_id: t.branch_id, employee_id: t.employee_id,
            audience: t.audience, is_recurring: true,
          });
        }
      }
    } else if (t.recurrence_type === 'yearly_md') {
      // recurrence_month: 1-12; month здесь 0-indexed
      if (t.recurrence_month === month + 1) {
        const day = Math.min(Math.max(t.recurrence_value, 1), lastDay);
        out.push({
          key: `t${t.id}-${day}`,
          realId: null, templateId: t.id,
          title: t.title, description: t.description,
          event_date: p(day), event_type: t.event_type || 'custom',
          icon: t.icon, color: t.color,
          branch_id: t.branch_id, employee_id: t.employee_id,
          audience: t.audience, is_recurring: true,
        });
      }
    }
  }
  return out;
}

// Тон плитки дня по режиму/событиям. Явные классы — чтобы Tailwind их собрал.
type TileToneKey = 'rose' | 'amber' | 'violet' | 'sky';
const TILE_TONE: Record<TileToneKey, {
  bg: string; bgStrong: string; ring: string; ringStrong: string; num: string; dot: string;
}> = {
  rose:   { bg: 'bg-rose-50',   bgStrong: 'bg-rose-100',   ring: 'ring-rose-300',   ringStrong: 'ring-rose-500',   num: 'text-rose-600',   dot: 'bg-rose-500' },
  amber:  { bg: 'bg-amber-50',  bgStrong: 'bg-amber-100',  ring: 'ring-amber-300',  ringStrong: 'ring-amber-500',  num: 'text-amber-700',  dot: 'bg-amber-500' },
  violet: { bg: 'bg-violet-50', bgStrong: 'bg-violet-100', ring: 'ring-violet-300', ringStrong: 'ring-violet-500', num: 'text-violet-700', dot: 'bg-violet-500' },
  sky:    { bg: 'bg-sky-50',    bgStrong: 'bg-sky-100',    ring: 'ring-sky-300',    ringStrong: 'ring-sky-500',    num: 'text-sky-700',    dot: 'bg-sky-500' },
};
// Доминирующий тон дня: выходной > сокращённый > праздник > прочие события.
function dayToneOf(evs: DisplayEvent[]): TileToneKey | null {
  if (evs.some(e => e.event_type === 'closed')) return 'rose';
  if (evs.some(e => e.event_type === 'short_day')) return 'amber';
  if (evs.some(e => e.event_type === 'holiday')) return 'violet';
  if (evs.length > 0) return 'sky';
  return null;
}

export default function EmployeeCalendarPage() {
  const [templates, setTemplates] = useState<DbTemplate[]>([]);
  const [dbEvents, setDbEvents] = useState<DbEvent[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // фильтры
  const [filterBranch, setFilterBranch] = useState<number | 'all'>('all');
  // Выходные дни выбранного филиала (подсветка). null = выбраны «все» (графики разные — не красим)
  const [branchDayOff, setBranchDayOff] = useState<Set<number> | null>(null);

  const [showEventModal, setShowEventModal] = useState(false);
  const [showTplModal, setShowTplModal] = useState(false);
  const [confirmDeleteEvent, setConfirmDeleteEvent] = useState<DbEvent | null>(null);
  const [confirmDeleteTpl, setConfirmDeleteTpl] = useState<DbTemplate | null>(null);

  const todayStr = useMemo(() => todayDateString(), []);
  const branchMap = useMemo(() => new Map(branches.map(b => [b.id, b.name])), [branches]);
  const employeeMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  const load = useCallback(async () => {
    setLoading(true);
    const s = sb();
    const monthStart = `${viewYear}-${pad2(viewMonth + 1)}-01`;
    const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
    const monthEnd = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(lastDay)}`;

    const [{ data: tpl }, { data: ev }, { data: br }, { data: emp }] = await Promise.all([
      s.from('franchise_calendar_templates').select('*').in('audience', ['employee', 'both']),
      s.from('franchise_calendar_events').select('*')
        .in('audience', ['employee', 'both'])
        .gte('event_date', monthStart).lte('event_date', monthEnd),
      s.from('branches').select('id, name').order('name'),
      s.from('employees').select('id, full_name, branch_id, is_active').eq('is_active', true).order('full_name'),
    ]);

    setTemplates((tpl as DbTemplate[]) || []);
    setDbEvents((ev as DbEvent[]) || []);
    setBranches((br as Branch[]) || []);
    setEmployees((emp as Employee[]) || []);
    setLoading(false);
  }, [viewYear, viewMonth]);

  useEffect(() => { void load(); }, [load]);

  // График выбранного филиала — для подсветки его нерабочих дней
  useEffect(() => {
    if (filterBranch === 'all') { setBranchDayOff(null); return; }
    let cancelled = false;
    void (async () => {
      const { data } = await sb().from('branch_workhours').select('dow, is_day_off').eq('branch_id', filterBranch);
      if (cancelled) return;
      const offs = new Set<number>();
      for (const r of (data as Array<{ dow: number; is_day_off: boolean }> | null) || []) {
        if (r.is_day_off) offs.add(r.dow);
      }
      setBranchDayOff(offs);
    })();
    return () => { cancelled = true; };
  }, [filterBranch]);

  // Слияние реальных + виртуальных, плюс фильтры
  const allEvents: DisplayEvent[] = useMemo(() => {
    const real: DisplayEvent[] = dbEvents.map(e => ({
      key: `e${e.id}`, realId: e.id, templateId: null,
      title: e.title, description: e.description,
      event_date: e.event_date, event_type: e.event_type || 'custom',
      icon: e.icon || 'CalendarDays', color: e.color || 'sky',
      branch_id: e.branch_id, employee_id: e.employee_id,
      audience: e.audience, is_recurring: false,
    }));
    const virtual = expandTemplates(templates, viewYear, viewMonth);
    let combined = [...real, ...virtual];
    if (filterBranch !== 'all') combined = combined.filter(x => x.branch_id === null || x.branch_id === filterBranch);
    return combined.sort((a, b) => a.event_date.localeCompare(b.event_date));
  }, [dbEvents, templates, viewYear, viewMonth, filterBranch]);

  const calendarDays: GridDay[] = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    let startDow = firstDay.getDay(); if (startDow === 0) startDow = 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrev = new Date(viewYear, viewMonth, 0).getDate();
    const days: GridDay[] = [];

    const isOff = (dow: number) => (branchDayOff ? branchDayOff.has(dow) : false);

    for (let i = startDow - 1; i > 0; i--) {
      const d = daysInPrev - i + 1;
      const m = viewMonth === 0 ? 12 : viewMonth;
      const y = viewMonth === 0 ? viewYear - 1 : viewYear;
      const dow = new Date(y, m - 1, d).getDay();
      days.push({ date: `${y}-${pad2(m)}-${pad2(d)}`, day: d, isCurrentMonth: false, isToday: false, isDayOff: isOff(dow) });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(d)}`;
      const dow = new Date(viewYear, viewMonth, d).getDay();
      days.push({ date, day: d, isCurrentMonth: true, isToday: date === todayStr, isDayOff: isOff(dow) });
    }
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const m = viewMonth === 11 ? 1 : viewMonth + 2;
      const y = viewMonth === 11 ? viewYear + 1 : viewYear;
      const dow = new Date(y, m - 1, d).getDay();
      days.push({ date: `${y}-${pad2(m)}-${pad2(d)}`, day: d, isCurrentMonth: false, isToday: false, isDayOff: isOff(dow) });
    }
    return days;
  }, [viewYear, viewMonth, todayStr, branchDayOff]);

  const eventsByDate = useMemo(() => {
    const m = new Map<string, DisplayEvent[]>();
    for (const ev of allEvents) {
      const arr = m.get(ev.event_date) || [];
      arr.push(ev);
      m.set(ev.event_date, arr);
    }
    return m;
  }, [allEvents]);

  const selectedEvents = selectedDate ? (eventsByDate.get(selectedDate) || []) : [];
  const upcomingEvents = allEvents.filter(e => e.event_date >= todayStr).slice(0, 6);

  function shiftMonth(dir: number) {
    let m = viewMonth + dir, y = viewYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setViewMonth(m); setViewYear(y); setSelectedDate(null);
  }

  function jumpToToday() {
    const now = new Date();
    setViewYear(now.getFullYear()); setViewMonth(now.getMonth()); setSelectedDate(todayStr);
  }

  function scopeLabel(e: DisplayEvent): { icon: typeof Globe; text: string; cls: string } {
    if (e.employee_id !== null) {
      const emp = employeeMap.get(e.employee_id);
      return { icon: User2, text: emp?.full_name || `Сотрудник #${e.employee_id}`, cls: 'bg-cyan-50 text-cyan-700 ring-cyan-200' };
    }
    if (e.branch_id !== null) {
      return { icon: Building2, text: branchMap.get(e.branch_id) || `Филиал #${e.branch_id}`, cls: 'bg-sky-50 text-sky-700 ring-sky-200' };
    }
    return { icon: Globe, text: 'Вся сеть', cls: 'bg-violet-50 text-violet-700 ring-violet-200' };
  }

  return (
    <div className="text-slate-50">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
              <CalendarDays className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold tracking-tight text-slate-50">Календарь сотрудников</div>
              <div className="mt-0.5 text-[12px] text-cyan-300/50">
                События для POS · {allEvents.length} в {MONTHS_RU[viewMonth].toLowerCase()}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void load()}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-300 ring-1 ring-slate-700/60 transition hover:bg-white/5"
              title="Обновить"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              onClick={() => setShowTplModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 ring-1 ring-slate-200 shadow-[0_4px_16px_rgba(15,23,42,0.25)] transition hover:bg-slate-50 hover:ring-slate-300"
            >
              <Repeat className="h-4 w-4 text-slate-500" /> Шаблон
            </button>
            <button
              onClick={() => setShowEventModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400"
            >
              <Plus className="h-4 w-4" /> Событие
            </button>
          </div>
        </div>

        {/* Переключатель филиалов */}
        <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-3.5 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <div className="mb-2 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-slate-400" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Филиал</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilterBranch('all')}
              className={
                'inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold transition ' +
                (filterBranch === 'all'
                  ? 'bg-cyan-500 text-white ring-1 ring-cyan-400 shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
                  : 'bg-white text-slate-600 ring-1 ring-sky-200 hover:bg-sky-50')
              }
            >
              <Globe className="h-3.5 w-3.5" /> Все филиалы
            </button>
            {branches.map(b => {
              const active = filterBranch === b.id;
              return (
                <button
                  key={b.id}
                  onClick={() => setFilterBranch(b.id)}
                  className={
                    'rounded-xl px-3 py-1.5 text-sm font-semibold transition ' +
                    (active
                      ? 'bg-cyan-500 text-white ring-1 ring-cyan-400 shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
                      : 'bg-white text-slate-600 ring-1 ring-sky-200 hover:bg-sky-50')
                  }
                >
                  {b.name}
                </button>
              );
            })}
          </div>

          {filterBranch !== 'all' && (
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-sky-100 pt-3">
              <span className="text-[12px] text-slate-500">
                Показаны события филиала <span className="font-semibold text-slate-700">{branchMap.get(filterBranch as number)}</span> + общесетевые
              </span>
              <button
                onClick={() => setFilterBranch('all')}
                className="ml-auto text-[12px] text-slate-500 hover:text-slate-900 underline"
              >
                Сбросить
              </button>
            </div>
          )}
        </div>

        {/* Main grid: calendar + side panel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* CALENDAR GRID */}
          <div className="lg:col-span-2 rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between border-b border-sky-100">
              <button
                onClick={() => shiftMonth(-1)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button onClick={jumpToToday} className="text-center group">
                <div className="text-xl font-bold text-slate-900 group-hover:text-cyan-600 transition-colors">
                  {MONTHS_RU[viewMonth]}
                </div>
                <div className="text-[12px] text-slate-500 mt-0.5">{viewYear}</div>
              </button>
              <button
                onClick={() => shiftMonth(1)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            <div className="m-3 rounded-2xl bg-slate-100 p-2.5">
              <div className="grid grid-cols-7 mb-1.5">
                {DAYS_SHORT.map(d => (
                  <div key={d} className="text-center text-[11px] font-bold text-slate-500 py-1.5 uppercase tracking-wider">{d}</div>
                ))}
              </div>

              {loading ? (
                <div className="p-10 text-center text-slate-400">Загрузка…</div>
              ) : (
                <div className="grid grid-cols-7 gap-1.5">
                  {calendarDays.map((day, i) => {
                    const dayEvs = eventsByDate.get(day.date) || [];
                    const isSelected = selectedDate === day.date;
                    const hasEvs = dayEvs.length > 0 && day.isCurrentMonth;
                    const tone = day.isCurrentMonth ? dayToneOf(dayEvs) : null;
                    const t = tone ? TILE_TONE[tone] : null;
                    const cls =
                      !day.isCurrentMonth
                        ? 'bg-white/40 ring-1 ring-slate-200/50 opacity-40'
                        : isSelected
                          ? `${t?.bgStrong ?? 'bg-cyan-100'} ring-2 ${t?.ringStrong ?? 'ring-cyan-500'} z-10 shadow-lg`
                          : day.isToday
                            ? `${t?.bg ?? 'bg-cyan-50'} ring-2 ${t?.ringStrong ?? 'ring-cyan-500'} shadow-md`
                            : t
                              ? `${t.bg} ring-1 ${t.ring} shadow-[0_1px_4px_rgba(15,23,42,0.10)] hover:shadow-md hover:-translate-y-0.5`
                              : day.isDayOff
                                ? 'bg-rose-50/70 ring-1 ring-rose-200 shadow-[0_1px_4px_rgba(15,23,42,0.08)] hover:shadow-md hover:-translate-y-0.5'
                                : 'bg-white ring-1 ring-slate-200 shadow-[0_1px_4px_rgba(15,23,42,0.10)] hover:shadow-md hover:-translate-y-0.5 hover:ring-slate-300';
                    return (
                      <button
                        key={i}
                        onClick={() => setSelectedDate(day.date === selectedDate ? null : day.date)}
                        className={`relative min-h-[108px] p-2 text-left transition-all rounded-xl ${cls}`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          {day.isToday ? (
                            <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-white text-[13px] font-bold shadow-sm ${t?.dot ?? (day.isDayOff ? 'bg-rose-500' : 'bg-cyan-500')}`}>
                              {day.day}
                            </span>
                          ) : (
                            <span className={`text-[15px] font-bold leading-7 ${
                              !day.isCurrentMonth ? 'text-slate-300'
                              : t ? t.num
                              : day.isDayOff ? 'text-rose-500' : 'text-slate-800'
                            }`}>
                              {day.day}
                            </span>
                          )}
                          {hasEvs && (
                            <div className="flex flex-wrap gap-1 justify-end max-w-[80%]">
                              {dayEvs.slice(0, 3).map((ev) => {
                                const Icon = getIconByName(ev.icon);
                                const cs = getColor(ev.color);
                                return (
                                  <div
                                    key={ev.key}
                                    className={`flex h-7 w-7 items-center justify-center rounded-lg bg-white ring-1 ${cs.ring} shadow-sm`}
                                    title={`${ev.title}${ev.is_recurring ? ' · повтор' : ''}`}
                                  >
                                    <Icon className={`h-4 w-4 ${cs.text}`} strokeWidth={2} />
                                  </div>
                                );
                              })}
                              {dayEvs.length > 3 && (
                                <div className="flex h-7 px-1.5 items-center justify-center rounded-lg bg-slate-200 text-[10px] font-bold text-slate-600 ring-1 ring-slate-300">
                                  +{dayEvs.length - 3}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Legend — что значат цвета плиток */}
            <div className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-sky-100">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Цвета</span>
              <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-600">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Сокращённый
              </span>
              <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-600">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Не работаем
              </span>
              <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-600">
                <span className="h-2.5 w-2.5 rounded-full bg-violet-400" /> Праздник
              </span>
              <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-600">
                <span className="h-2.5 w-2.5 rounded-full bg-sky-400" /> События / задачи
              </span>
              {branchDayOff && (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-600">
                  <span className="h-2.5 w-2.5 rounded-full bg-white ring-1 ring-rose-300" /> Выходной филиала
                </span>
              )}
            </div>
          </div>

          {/* SIDE PANEL */}
          <div className="space-y-4">
            {/* Selected day */}
            {selectedDate && (
              <div className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] overflow-hidden">
                <div className="px-5 py-4 border-b border-sky-100 flex items-center justify-between">
                  <div>
                    <div className="text-base font-bold text-slate-900">
                      {new Date(selectedDate + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                    </div>
                    <div className="text-[12px] text-slate-500 mt-0.5 capitalize">
                      {new Date(selectedDate + 'T00:00:00').toLocaleDateString('ru-RU', { weekday: 'long' })}
                    </div>
                  </div>
                  <button onClick={() => setSelectedDate(null)} className="text-slate-400 hover:text-slate-700">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {selectedEvents.length === 0 ? (
                  <div className="p-6 text-center text-sm text-slate-400">Нет событий</div>
                ) : (
                  <div className="p-3 space-y-2 max-h-[400px] overflow-y-auto">
                    {selectedEvents.map(ev => {
                      const Icon = getIconByName(ev.icon);
                      const cs = getColor(ev.color);
                      const sc = scopeLabel(ev);
                      const ScopeIcon = sc.icon;
                      const realEvent = ev.realId ? dbEvents.find(d => d.id === ev.realId) : null;
                      const realTpl = ev.templateId ? templates.find(t => t.id === ev.templateId) : null;
                      return (
                        <div key={ev.key} className={`rounded-xl ${cs.bg} ring-1 ${cs.ring} p-3.5`}>
                          <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/80 shadow-sm">
                              <Icon className={`h-5 w-5 ${cs.text}`} strokeWidth={2} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm font-bold ${cs.text}`}>{ev.title}</div>
                              {ev.description && (
                                <div className="text-[12px] text-slate-600 mt-1 leading-relaxed">{ev.description}</div>
                              )}
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${sc.cls}`}>
                                  <ScopeIcon className="h-3 w-3" /> {sc.text}
                                </span>
                                {ev.is_recurring && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">
                                    <Repeat className="h-3 w-3" /> Повтор
                                  </span>
                                )}
                              </div>
                            </div>
                            {realEvent && (
                              <button
                                onClick={() => setConfirmDeleteEvent(realEvent)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                            {realTpl && !realEvent && (
                              <button
                                onClick={() => setConfirmDeleteTpl(realTpl)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                title="Удалить шаблон целиком"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Upcoming */}
            <div className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] overflow-hidden">
              <div className="px-5 py-4 flex items-center gap-2.5 border-b border-sky-100">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-500 shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
                  <Clock className="h-4 w-4 text-white" />
                </div>
                <div className="text-sm font-semibold text-slate-800">Ближайшие события</div>
              </div>
              {upcomingEvents.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-400">Нет предстоящих</div>
              ) : (
                <div className="p-3 space-y-1.5">
                  {upcomingEvents.map(ev => {
                    const Icon = getIconByName(ev.icon);
                    const cs = getColor(ev.color);
                    const daysUntil = Math.ceil(
                      (new Date(ev.event_date + 'T00:00:00').getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000
                    );
                    const urgent = daysUntil <= 3 ? 'bg-rose-50 ring-rose-200 text-rose-700' :
                                   daysUntil <= 7 ? 'bg-amber-50 ring-amber-200 text-amber-700' :
                                                    'bg-slate-50 ring-slate-200 text-slate-600';
                    return (
                      <button
                        key={ev.key}
                        onClick={() => { setViewYear(Number(ev.event_date.slice(0,4))); setViewMonth(Number(ev.event_date.slice(5,7)) - 1); setSelectedDate(ev.event_date); }}
                        className="w-full flex items-center gap-3 rounded-xl bg-white ring-1 ring-slate-100 px-3 py-2.5 hover:shadow-sm transition-all text-left"
                      >
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${cs.bg} ring-1 ${cs.ring}`}>
                          <Icon className={`h-4 w-4 ${cs.text}`} strokeWidth={2} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold text-slate-900 truncate">{ev.title}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {new Date(ev.event_date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                          </div>
                        </div>
                        <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ring-1 shrink-0 ${urgent}`}>
                          {daysUntil === 0 ? 'Сегодня' : daysUntil === 1 ? 'Завтра' : `${daysUntil} дн.`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* MODALS */}
      {showEventModal && (
        <EventFormModal
          branches={branches}
          employees={employees}
          defaultDate={selectedDate || todayStr}
          onClose={() => setShowEventModal(false)}
          onSaved={() => { setShowEventModal(false); void load(); }}
        />
      )}
      {showTplModal && (
        <TemplateFormModal
          branches={branches}
          employees={employees}
          onClose={() => setShowTplModal(false)}
          onSaved={() => { setShowTplModal(false); void load(); }}
        />
      )}
      {confirmDeleteEvent && (
        <ConfirmModal
          title="Удалить событие?"
          subtitle={confirmDeleteEvent.title}
          onCancel={() => setConfirmDeleteEvent(null)}
          onConfirm={async () => {
            await sb().from('franchise_calendar_events').delete().eq('id', confirmDeleteEvent.id);
            toast.success('Событие удалено');
            setConfirmDeleteEvent(null);
            void load();
          }}
        />
      )}
      {confirmDeleteTpl && (
        <ConfirmModal
          title="Удалить шаблон?"
          subtitle={`${confirmDeleteTpl.title} · повторяющееся событие будет удалено навсегда`}
          onCancel={() => setConfirmDeleteTpl(null)}
          onConfirm={async () => {
            await sb().from('franchise_calendar_templates').delete().eq('id', confirmDeleteTpl.id);
            toast.success('Шаблон удалён');
            setConfirmDeleteTpl(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

/* ─────────────────── MODALS ─────────────────── */

type ModalAddress = 'global' | 'branch' | 'employee';

function ScopePicker({
  value, branchId, employeeId, branches, employees,
  onChange, onBranchChange, onEmployeeChange,
}: {
  value: ModalAddress;
  branchId: number | null;
  employeeId: number | null;
  branches: Branch[];
  employees: Employee[];
  onChange: (v: ModalAddress) => void;
  onBranchChange: (b: number | null) => void;
  onEmployeeChange: (e: number | null) => void;
}) {
  const opts: { key: ModalAddress; label: string; Icon: typeof Globe }[] = [
    { key: 'global', label: 'Вся сеть', Icon: Globe },
    { key: 'branch', label: 'Филиал', Icon: Building2 },
    { key: 'employee', label: 'Сотрудник', Icon: User2 },
  ];

  const filteredEmployees = branchId
    ? employees.filter(e => e.branch_id === branchId)
    : employees;

  return (
    <div>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Кому показывать</span>
      <div className="grid grid-cols-3 gap-2">
        {opts.map(o => (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition ${
              value === o.key
                ? 'bg-cyan-500 text-white ring-1 ring-cyan-400 shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
                : 'bg-white text-slate-600 ring-1 ring-sky-200 hover:bg-sky-50'
            }`}
          >
            <o.Icon className="h-4 w-4" /> {o.label}
          </button>
        ))}
      </div>
      {value === 'branch' && (
        <select
          value={branchId ?? ''}
          onChange={(e) => onBranchChange(e.target.value ? Number(e.target.value) : null)}
          className="mt-2 w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
        >
          <option value="">— выберите филиал —</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      {value === 'employee' && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select
            value={branchId ?? ''}
            onChange={(e) => { const b = e.target.value ? Number(e.target.value) : null; onBranchChange(b); onEmployeeChange(null); }}
            className="rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
          >
            <option value="">Все филиалы</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select
            value={employeeId ?? ''}
            onChange={(e) => onEmployeeChange(e.target.value ? Number(e.target.value) : null)}
            className="rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
          >
            <option value="">— выберите сотрудника —</option>
            {filteredEmployees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

function EventTypePicker({ value, onChange }: { value: CalendarEventType; onChange: (v: CalendarEventType) => void }) {
  return (
    <div>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Тип события</span>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {EVENT_TYPES.map(t => {
          const Icon = t.icon;
          const cs = getColor(t.color);
          const active = value === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange(t.key)}
              className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-[11px] font-semibold transition ring-1 ${
                active ? `${cs.bg} ${cs.ring} ${cs.text} ring-2` : 'bg-white text-slate-600 ring-sky-200 hover:bg-sky-50'
              }`}
            >
              <Icon className={`h-4 w-4 ${active ? cs.text : 'text-slate-500'}`} />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: CalendarColorKey; onChange: (v: CalendarColorKey) => void }) {
  return (
    <div>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Цвет</span>
      <div className="flex flex-wrap gap-2">
        {COLOR_KEYS.map(c => {
          const cs = COLOR_STYLES[c];
          return (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              className={`h-8 w-8 rounded-full ${cs.dot} transition ${value === c ? 'ring-2 ring-offset-2 ring-slate-900 scale-110' : 'hover:scale-105'}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function ModalShell({
  title, subtitle, onClose, children, icon: Icon = CalendarDays,
}: {
  title: string; subtitle?: string; onClose: () => void;
  children: React.ReactNode; icon?: typeof CalendarDays;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.4)] ring-1 ring-sky-100 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.3)]">
              <Icon className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight text-slate-900">{title}</div>
              {subtitle && <div className="text-[12px] text-slate-500">{subtitle}</div>}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EventFormModal({
  branches, employees, defaultDate, onClose, onSaved,
}: {
  branches: Branch[]; employees: Employee[];
  defaultDate: string; onClose: () => void; onSaved: () => void;
}) {
  const [type, setType] = useState<CalendarEventType>('custom');
  const typeDef = EVENT_TYPE_MAP[type];
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [color, setColor] = useState<CalendarColorKey>(typeDef.color);
  const [scope, setScope] = useState<ModalAddress>('global');
  const [branchId, setBranchId] = useState<number | null>(null);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [notify, setNotify] = useState(false);
  const [alsoFranchise, setAlsoFranchise] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setColor(EVENT_TYPE_MAP[type].color); }, [type]);

  async function save() {
    if (!title.trim()) { toast.error('Введите название'); return; }
    if (!date) { toast.error('Выберите дату'); return; }
    if (scope === 'branch' && !branchId) { toast.error('Выберите филиал'); return; }
    if (scope === 'employee' && !employeeId) { toast.error('Выберите сотрудника'); return; }

    setSaving(true);
    const audience: CalendarAudience = alsoFranchise ? 'both' : 'employee';
    const finalBranch = scope === 'global' ? null : (scope === 'employee'
      ? (employeeId ? employees.find(e => e.id === employeeId)?.branch_id ?? null : null)
      : branchId);
    const finalEmployee = scope === 'employee' ? employeeId : null;

    const { error } = await sb().from('franchise_calendar_events').insert({
      title: title.trim(),
      description: desc.trim() || null,
      event_date: date,
      event_type: type,
      icon: typeDef.iconName,
      color,
      branch_id: finalBranch,
      employee_id: finalEmployee,
      audience,
      is_recurring: false,
      notify,
    });

    setSaving(false);
    if (error) { toast.error('Ошибка: ' + error.message); return; }
    toast.success('Событие создано');
    onSaved();
  }

  return (
    <ModalShell title="Новое событие" subtitle="Появится в календаре сотрудников POS" icon={Plus} onClose={onClose}>
      <div className="space-y-4">
        <EventTypePicker value={type} onChange={setType} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Заголовок</span>
            <input
              type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder={typeDef.label} autoFocus
              className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
            />
          </div>
          <div>
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Дата</span>
            <input
              type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
            />
          </div>
        </div>

        <div>
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Описание</span>
          <textarea
            value={desc} onChange={(e) => setDesc(e.target.value)} rows={2}
            placeholder="Опционально"
            className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70 resize-none"
          />
        </div>

        <ColorPicker value={color} onChange={setColor} />

        <ScopePicker
          value={scope} branchId={branchId} employeeId={employeeId}
          branches={branches} employees={employees}
          onChange={setScope}
          onBranchChange={setBranchId}
          onEmployeeChange={setEmployeeId}
        />

        <div className="flex flex-wrap items-center gap-4 pt-1">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="rounded" />
            Отправить уведомление
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" checked={alsoFranchise} onChange={(e) => setAlsoFranchise(e.target.checked)} className="rounded" />
            Показать также в франчайзи-портале
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
            Отмена
          </button>
          <button
            onClick={save} disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] hover:bg-cyan-400 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Создать
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function TemplateFormModal({
  branches, employees, onClose, onSaved,
}: {
  branches: Branch[]; employees: Employee[];
  onClose: () => void; onSaved: () => void;
}) {
  const [type, setType] = useState<CalendarEventType>('payday');
  const typeDef = EVENT_TYPE_MAP[type];
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [color, setColor] = useState<CalendarColorKey>(typeDef.color);
  const [recurType, setRecurType] = useState<'monthly_day' | 'weekly_dow' | 'yearly_md'>('monthly_day');
  const [recurValue, setRecurValue] = useState(15);
  const [recurMonth, setRecurMonth] = useState(1);
  const [scope, setScope] = useState<ModalAddress>('global');
  const [branchId, setBranchId] = useState<number | null>(null);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [alsoFranchise, setAlsoFranchise] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setColor(EVENT_TYPE_MAP[type].color); }, [type]);
  useEffect(() => { if (recurType === 'weekly_dow' && recurValue > 6) setRecurValue(1); }, [recurType, recurValue]);

  async function save() {
    if (!title.trim()) { toast.error('Введите название'); return; }
    if (scope === 'branch' && !branchId) { toast.error('Выберите филиал'); return; }
    if (scope === 'employee' && !employeeId) { toast.error('Выберите сотрудника'); return; }

    setSaving(true);
    const audience: CalendarAudience = alsoFranchise ? 'both' : 'employee';
    const finalBranch = scope === 'global' ? null : (scope === 'employee'
      ? (employeeId ? employees.find(e => e.id === employeeId)?.branch_id ?? null : null)
      : branchId);
    const finalEmployee = scope === 'employee' ? employeeId : null;

    const { error } = await sb().from('franchise_calendar_templates').insert({
      title: title.trim(),
      description: desc.trim() || null,
      event_type: type,
      icon: typeDef.iconName,
      color,
      recurrence_type: recurType,
      recurrence_value: recurValue,
      recurrence_month: recurType === 'yearly_md' ? recurMonth : null,
      branch_id: finalBranch,
      employee_id: finalEmployee,
      audience,
      is_active: true,
    });

    setSaving(false);
    if (error) { toast.error('Ошибка: ' + error.message); return; }
    toast.success('Шаблон создан');
    onSaved();
  }

  return (
    <ModalShell title="Новый шаблон" subtitle="Повторяющееся событие — каждый месяц, неделю или год" icon={Repeat} onClose={onClose}>
      <div className="space-y-4">
        <EventTypePicker value={type} onChange={setType} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Заголовок</span>
            <input
              type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder={typeDef.label} autoFocus
              className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
            />
          </div>
          <div className="sm:col-span-2">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Описание</span>
            <textarea
              value={desc} onChange={(e) => setDesc(e.target.value)} rows={2}
              className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70 resize-none"
            />
          </div>
        </div>

        <div>
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Повторение</span>
          <div className="flex flex-wrap gap-2">
            <select
              value={recurType}
              onChange={(e) => setRecurType(e.target.value as 'monthly_day' | 'weekly_dow' | 'yearly_md')}
              className="rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
            >
              <option value="monthly_day">Каждый месяц</option>
              <option value="weekly_dow">Каждую неделю</option>
              <option value="yearly_md">Каждый год</option>
            </select>
            {recurType === 'monthly_day' && (
              <select
                value={recurValue} onChange={(e) => setRecurValue(Number(e.target.value))}
                className="rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
              >
                <option value={0}>Последний день месяца</option>
                {Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}-е число</option>)}
              </select>
            )}
            {recurType === 'weekly_dow' && (
              <select
                value={recurValue} onChange={(e) => setRecurValue(Number(e.target.value))}
                className="rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
              >
                {DOW_NAMES_RU.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            )}
            {recurType === 'yearly_md' && (
              <>
                <select
                  value={recurMonth} onChange={(e) => setRecurMonth(Number(e.target.value))}
                  className="rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
                >
                  {MONTHS_RU.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
                <select
                  value={recurValue} onChange={(e) => setRecurValue(Number(e.target.value))}
                  className="rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
                >
                  {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}-е число</option>)}
                </select>
              </>
            )}
          </div>
        </div>

        <ColorPicker value={color} onChange={setColor} />

        <ScopePicker
          value={scope} branchId={branchId} employeeId={employeeId}
          branches={branches} employees={employees}
          onChange={setScope}
          onBranchChange={setBranchId}
          onEmployeeChange={setEmployeeId}
        />

        <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer pt-1">
          <input type="checkbox" checked={alsoFranchise} onChange={(e) => setAlsoFranchise(e.target.checked)} className="rounded" />
          Показать также в франчайзи-портале
        </label>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
            Отмена
          </button>
          <button
            onClick={save} disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] hover:bg-cyan-400 disabled:opacity-50"
          >
            <Repeat className="h-4 w-4" /> Создать шаблон
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ConfirmModal({
  title, subtitle, onCancel, onConfirm,
}: {
  title: string; subtitle?: string; onCancel: () => void; onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.4)] ring-1 ring-sky-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-rose-500 shadow-[0_4px_16px_rgba(244,63,94,0.28)]">
            <AlertTriangle className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-lg font-bold tracking-tight text-slate-900">{title}</div>
            {subtitle && <div className="text-[12px] text-slate-500 mt-0.5">{subtitle}</div>}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button onClick={onCancel} className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
            Отмена
          </button>
          <button
            disabled={busy}
            onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(244,63,94,0.28)] hover:bg-rose-400 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" /> Удалить
          </button>
        </div>
      </div>
    </div>
  );
}
