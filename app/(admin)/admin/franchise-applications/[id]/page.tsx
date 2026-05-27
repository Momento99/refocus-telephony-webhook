'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Phone, MessageCircle, Calendar, Bell, MapPin, Clock,
  User, Globe, AlertTriangle, BookOpen,
} from 'lucide-react';

type App = {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  status: string;
  source: string | null;
  budget: string | null;
  comment: string | null;
  admin_note: string | null;
  conversation_log: string | null;
  created_at: string;
  updated_at: string;
  first_contact_at: string | null;
  last_activity_at: string | null;
  reminder_at: string | null;
  reminder_note: string | null;
  reminder_fired_at: string | null;
  meeting_at: string | null;
  qualified_budget: string | null;
  qualified_experience: string | null;
  has_premises: boolean | null;
  readiness_window: string | null;
  lost_reason: string | null;
  pd_consent_at: string | null;
  whatsapp_blocked: boolean | null;
};

type Event = {
  id: string;
  application_id: string;
  event_type: string;
  payload: any;
  note: string | null;
  created_at: string;
};

const STATUS_OPTIONS = [
  { v: 'new', label: 'Новая' },
  { v: 'confirmed', label: 'Подтверждена' },
  { v: 'contacted', label: 'Связались' },
  { v: 'qualified', label: 'Квалифицирован' },
  { v: 'meeting_scheduled', label: 'Встреча назначена' },
  { v: 'meeting_done', label: 'После встречи' },
  { v: 'negotiation', label: 'Переговоры' },
  { v: 'converted', label: 'Партнёр' },
  { v: 'cold', label: 'Остыл' },
  { v: 'unqualified', label: 'Не подходит' },
  { v: 'lost', label: 'Потерян' },
];

const BUDGET_OPTIONS = [
  { v: '', label: '—' },
  { v: 'compact', label: 'COMPACT ($18 500)' },
  { v: 'standard', label: 'STANDARD ($32 000)' },
  { v: 'premium', label: 'PREMIUM ($39 700)' },
  { v: 'custom', label: 'CUSTOM (от $43 500)' },
];

const EXPERIENCE_OPTIONS = [
  { v: '', label: '—' },
  { v: 'none', label: 'Нет опыта' },
  { v: '1-3', label: '1–3 года' },
  { v: '3+', label: 'Более 3 лет' },
  { v: 'franchise', label: 'Был в франшизе' },
];

const READINESS_OPTIONS = [
  { v: '', label: '—' },
  { v: 'asap', label: 'Как можно скорее' },
  { v: '1-3mo', label: '1–3 месяца' },
  { v: '3-6mo', label: '3–6 месяцев' },
  { v: 'exploring', label: 'Изучает варианты' },
];

const LOST_REASON_OPTIONS = [
  { v: '', label: '—' },
  { v: 'no-budget', label: 'Не хватает бюджета' },
  { v: 'wrong-city', label: 'Не наш город' },
  { v: 'no-experience', label: 'Нет опыта' },
  { v: 'wrong-timing', label: 'Не сейчас (тайминг)' },
  { v: 'chose-competitor', label: 'Выбрал конкурента' },
  { v: 'not-serious', label: 'Несерьёзно' },
  { v: 'pending-rf-tm', label: 'Ждёт регистрацию ТЗ в РФ' },
  { v: 'pending-funds', label: 'Копит деньги' },
  { v: 'unresponsive', label: 'Перестал отвечать' },
  { v: 'other', label: 'Другое' },
];

function fmt(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleString('ru-RU', {
    timeZone: 'Asia/Bishkek',
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function cleanPhone(p: string) {
  return p.replace(/[^+\d]/g, '');
}

function eventIcon(type: string): string {
  if (type === 'application_received') return '📥';
  if (type.includes('whatsapp_sent') || type.includes('whatsapp_queued')) return '💬';
  if (type === 'owner_alert_sent' || type === 'owner_alert_queued') return '🔔';
  if (type === 'call_made') return '📞';
  if (type === 'note_added') return '📝';
  if (type === 'meeting_scheduled') return '📅';
  if (type.includes('meeting_reminder')) return '⏰';
  if (type === 'reminder_set') return '⏰';
  if (type === 'reminder_fired') return '🔔';
  if (type === 'status_changed') return '↪';
  if (type === 'stale_alert_queued') return '⚠️';
  if (type === 'whatsapp_send_failed') return '❌';
  return '•';
}

export default function FranchiseApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [app, setApp] = useState<App | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLogEntry, setNewLogEntry] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  const [reminderNote, setReminderNote] = useState('');
  const [meetingTime, setMeetingTime] = useState('');
  const [showScript, setShowScript] = useState(false);

  function sb() { return getBrowserSupabase(); }

  const load = useCallback(async () => {
    setLoading(true);
    const { data: appData } = await sb()
      .from('franchise_applications')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    setApp(appData as App | null);

    const { data: evData } = await sb()
      .from('franchise_application_events')
      .select('*')
      .eq('application_id', id)
      .order('created_at', { ascending: false });
    setEvents((evData || []) as Event[]);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function patch(updates: Partial<App>) {
    if (!app) return;
    const full = { ...updates, updated_at: new Date().toISOString(), last_activity_at: new Date().toISOString() };
    await sb().from('franchise_applications').update(full).eq('id', app.id);
    setApp(prev => prev ? { ...prev, ...full } as App : prev);
  }

  async function addLogEntry() {
    if (!newLogEntry.trim() || !app) return;
    const now = new Date();
    const stamp = now.toLocaleString('ru-RU', {
      timeZone: 'Asia/Bishkek',
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    const entry = `[${stamp}] ${newLogEntry.trim()}`;
    const newLog = app.conversation_log ? `${app.conversation_log}\n${entry}` : entry;

    await sb().from('franchise_applications').update({
      conversation_log: newLog,
      updated_at: now.toISOString(),
      last_activity_at: now.toISOString(),
      stale_alert_sent_at: null,
    }).eq('id', app.id);

    await sb().from('franchise_application_events').insert({
      application_id: app.id,
      event_type: 'note_added',
      note: newLogEntry.trim(),
    });

    setApp(prev => prev ? { ...prev, conversation_log: newLog } as App : prev);
    setNewLogEntry('');
    toast.success('Запись добавлена');
    load();
  }

  async function recordCall() {
    if (!app) return;
    await sb().from('franchise_application_events').insert({
      application_id: app.id,
      event_type: 'call_made',
      note: 'Звонок зафиксирован',
    });

    const updates: Record<string, any> = {
      last_activity_at: new Date().toISOString(),
      stale_alert_sent_at: null,
    };
    if (!app.first_contact_at) updates.first_contact_at = new Date().toISOString();
    if (app.status === 'new' || app.status === 'confirmed') updates.status = 'contacted';

    await sb().from('franchise_applications').update(updates).eq('id', app.id);
    toast.success('Звонок зафиксирован');
    load();
  }

  async function setReminder() {
    if (!app || !reminderTime) return;
    const iso = new Date(reminderTime).toISOString();
    await patch({
      reminder_at: iso,
      reminder_note: reminderNote,
      reminder_fired_at: null,
    });
    await sb().from('franchise_application_events').insert({
      application_id: app.id,
      event_type: 'reminder_set',
      note: `Напоминание на ${fmt(iso)}: ${reminderNote}`,
    });
    setReminderTime('');
    setReminderNote('');
    toast.success('Напоминание установлено');
    load();
  }

  async function setMeeting() {
    if (!app || !meetingTime) return;
    const iso = new Date(meetingTime).toISOString();
    const updates: Partial<App> = {
      meeting_at: iso,
      // сбрасываем флаги напоминаний — пусть cron выставит новые
    };
    if (app.status === 'qualified' || app.status === 'contacted') {
      updates.status = 'meeting_scheduled';
    }
    await patch(updates);
    await sb().from('franchise_applications').update({
      meeting_reminder_24h_at: null,
      meeting_reminder_2h_at: null,
    }).eq('id', app.id);
    await sb().from('franchise_application_events').insert({
      application_id: app.id,
      event_type: 'meeting_scheduled',
      note: `Встреча назначена на ${fmt(iso)}`,
    });
    setMeetingTime('');
    toast.success('Встреча назначена');
    load();
  }

  if (loading) {
    return <div className="mx-auto max-w-4xl px-5 pt-8 text-slate-400">Загрузка...</div>;
  }

  if (!app) {
    return (
      <div className="mx-auto max-w-4xl px-5 pt-8">
        <p className="text-slate-400">Заявка не найдена.</p>
        <Link href="/admin/franchise-applications" className="text-cyan-400 underline">
          ← К списку
        </Link>
      </div>
    );
  }

  const sourceLabel: Record<string, string> = {
    'landing': 'Лендинг',
    'pdf-gate': 'PDF-форма',
    'instagram-inbound': 'Instagram',
    'whatsapp-inbound': 'WhatsApp',
    'referral': 'Рекомендация',
  };

  return (
    <div className="mx-auto max-w-4xl px-5 pt-8 pb-12">

      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Link href="/admin/franchise-applications" className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/15 transition">
          <ArrowLeft size={16} className="text-slate-400" />
        </Link>
        <div className="flex-1">
          <h1 className="text-[22px] font-bold text-white tracking-tight">{app.name}</h1>
          <div className="flex items-center gap-2 mt-1 text-[12px] text-slate-400 flex-wrap">
            {app.source && (
              <span className="flex items-center gap-1 text-cyan-400">
                <Globe size={11} /> {sourceLabel[app.source] || app.source}
              </span>
            )}
            {app.city && <span className="flex items-center gap-1"><MapPin size={11} /> {app.city}</span>}
            <span className="flex items-center gap-1"><Clock size={11} /> Подана {fmt(app.created_at)}</span>
            {app.pd_consent_at && (
              <span className="flex items-center gap-1 text-emerald-400">
                ✓ Согласие на ПД {fmt(app.pd_consent_at)}
              </span>
            )}
          </div>
        </div>
        <select
          value={app.status}
          onChange={e => patch({ status: e.target.value })}
          className="text-[12px] rounded-lg ring-1 ring-slate-200 px-3 py-2 bg-white cursor-pointer outline-none"
        >
          {STATUS_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
      </div>

      {/* Action row: phone + WhatsApp + record call */}
      <div className="flex flex-wrap gap-2 mb-5">
        <a
          href={`tel:${cleanPhone(app.phone)}`}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-50 ring-1 ring-slate-200 text-slate-700 text-[13px] font-semibold hover:bg-slate-100"
        >
          <Phone size={14} /> {app.phone}
        </a>
        <a
          href={`https://wa.me/${cleanPhone(app.phone).replace(/^\+/, '')}`}
          target="_blank" rel="noopener"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 ring-1 ring-emerald-200 text-emerald-700 text-[13px] font-semibold hover:bg-emerald-100"
        >
          <MessageCircle size={14} /> WhatsApp
        </a>
        <button
          onClick={recordCall}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-50 ring-1 ring-cyan-200 text-cyan-700 text-[13px] font-semibold hover:bg-cyan-100"
        >
          <Phone size={14} /> Зафиксировать звонок
        </button>
        <button
          onClick={() => setShowScript(s => !s)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-50 ring-1 ring-violet-200 text-violet-700 text-[13px] font-semibold hover:bg-violet-100"
        >
          <BookOpen size={14} /> {showScript ? 'Скрыть' : 'Скрипт звонка'}
        </button>
      </div>

      {/* Скрипт звонка inline */}
      {showScript && (
        <div className="mb-5 rounded-2xl bg-violet-50 ring-1 ring-violet-200 p-5">
          <h3 className="text-[14px] font-bold text-violet-900 mb-3">Скрипт первого звонка (15–20 мин)</h3>
          <div className="text-[12px] text-violet-900 space-y-3">
            <div>
              <strong>1. Открытие (1–2 мин):</strong><br/>
              «Здравствуйте, {app.name}! Я из Refocus. Вы оставили заявку на нашу франшизу оптики. Удобно сейчас 15–20 минут пообщаться?»
            </div>
            <div>
              <strong>2. Квалификация (5–7 мин):</strong> 4 вопроса —
              мотивация / бюджет и сроки / опыт / город и помещение.
              <em> Заполняй поля квалификации ниже на этой странице.</em>
            </div>
            <div>
              <strong>3. Презентация (5–7 мин):</strong> 5 пунктов — что Refocus, 4 пакета (COMPACT $18.5k / STANDARD $32k / PREMIUM $39.7k / CUSTOM), прибыль $1.4k–$3.8k/мес, окуп. 10–13 мес, что включено.
            </div>
            <div>
              <strong>4. Closing (2–3 мин):</strong> «Что у нас дальше: назначим встречу детальную на Zoom 30 мин, когда вам удобно — [день/время X] или [день/время Y]?»
            </div>
            <div className="text-[11px] mt-3 pt-3 border-t border-violet-200">
              Полные документы: <code>docs/franchise-sales/02-call-script.md</code>,
              {' '}<code>03-objections.md</code>, <code>07-pricing-reference.md</code>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* Left column */}
        <div className="space-y-5">

          {/* Журнал разговоров */}
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-5 shadow-sm">
            <h3 className="text-[14px] font-bold text-slate-900 mb-3">Журнал разговоров</h3>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="Что обсудили / договорились / решили..."
                value={newLogEntry}
                onChange={e => setNewLogEntry(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addLogEntry(); }}
                className="flex-1 px-3 py-2 rounded-lg ring-1 ring-slate-200 text-[13px] outline-none focus:ring-cyan-300"
              />
              <button
                onClick={addLogEntry}
                disabled={!newLogEntry.trim()}
                className="px-4 py-2 rounded-lg bg-cyan-500 text-white text-[12px] font-semibold disabled:opacity-50 hover:bg-cyan-600"
              >
                Добавить
              </button>
            </div>
            {app.conversation_log ? (
              <pre className="text-[12px] text-slate-700 whitespace-pre-wrap font-mono leading-relaxed bg-slate-50 rounded-lg p-3 ring-1 ring-slate-100 max-h-60 overflow-auto">
                {app.conversation_log}
              </pre>
            ) : (
              <div className="text-[11px] text-slate-400 italic">Пока пусто — добавь первую запись после звонка</div>
            )}
          </div>

          {/* Квалификация */}
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-5 shadow-sm">
            <h3 className="text-[14px] font-bold text-slate-900 mb-3">Квалификация</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Бюджет / пакет</label>
                <select
                  value={app.qualified_budget || ''}
                  onChange={e => patch({ qualified_budget: e.target.value || null })}
                  className="w-full px-3 py-2 rounded-lg ring-1 ring-slate-200 text-[13px] outline-none focus:ring-cyan-300"
                >
                  {BUDGET_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Опыт в бизнесе</label>
                <select
                  value={app.qualified_experience || ''}
                  onChange={e => patch({ qualified_experience: e.target.value || null })}
                  className="w-full px-3 py-2 rounded-lg ring-1 ring-slate-200 text-[13px] outline-none focus:ring-cyan-300"
                >
                  {EXPERIENCE_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="flex items-center gap-2 text-[12px] text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={app.has_premises ?? false}
                    onChange={e => patch({ has_premises: e.target.checked })}
                    className="w-4 h-4 accent-cyan-500"
                  />
                  Есть помещение
                </label>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Готовность к открытию</label>
                <select
                  value={app.readiness_window || ''}
                  onChange={e => patch({ readiness_window: e.target.value || null })}
                  className="w-full px-3 py-2 rounded-lg ring-1 ring-slate-200 text-[13px] outline-none focus:ring-cyan-300"
                >
                  {READINESS_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
              </div>
              {(app.status === 'unqualified' || app.status === 'lost' || app.status === 'cold') && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Причина потери</label>
                  <select
                    value={app.lost_reason || ''}
                    onChange={e => patch({ lost_reason: e.target.value || null })}
                    className="w-full px-3 py-2 rounded-lg ring-1 ring-slate-200 text-[13px] outline-none focus:ring-cyan-300"
                  >
                    {LOST_REASON_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-5">

          {/* Напоминание */}
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Bell size={16} className="text-amber-500" />
              <h3 className="text-[14px] font-bold text-slate-900">Напоминание</h3>
            </div>
            {app.reminder_at && !app.reminder_fired_at ? (
              <div className="text-[12px] text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-lg p-3 mb-3">
                <strong>{fmt(app.reminder_at)}</strong><br/>
                <span className="text-amber-600">{app.reminder_note || '—'}</span>
                <button
                  onClick={() => patch({ reminder_at: null, reminder_note: null })}
                  className="ml-2 text-[10px] text-amber-700 underline"
                >
                  Удалить
                </button>
              </div>
            ) : null}
            <input
              type="datetime-local"
              value={reminderTime}
              onChange={e => setReminderTime(e.target.value)}
              className="w-full mb-2 px-3 py-2 rounded-lg ring-1 ring-slate-200 text-[13px] outline-none focus:ring-cyan-300"
            />
            <input
              type="text"
              placeholder="Что напомнить (опционально)"
              value={reminderNote}
              onChange={e => setReminderNote(e.target.value)}
              className="w-full mb-2 px-3 py-2 rounded-lg ring-1 ring-slate-200 text-[13px] outline-none focus:ring-cyan-300"
            />
            <button
              onClick={setReminder}
              disabled={!reminderTime}
              className="w-full px-4 py-2 rounded-lg bg-amber-500 text-white text-[12px] font-semibold disabled:opacity-50 hover:bg-amber-600"
            >
              Установить напоминание
            </button>
          </div>

          {/* Встреча */}
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Calendar size={16} className="text-violet-500" />
              <h3 className="text-[14px] font-bold text-slate-900">Встреча</h3>
            </div>
            {app.meeting_at ? (
              <div className="text-[12px] text-violet-700 bg-violet-50 ring-1 ring-violet-200 rounded-lg p-3 mb-3">
                <strong>{fmt(app.meeting_at)}</strong>
                <button
                  onClick={() => patch({ meeting_at: null })}
                  className="ml-2 text-[10px] text-violet-700 underline"
                >
                  Отменить
                </button>
              </div>
            ) : null}
            <input
              type="datetime-local"
              value={meetingTime}
              onChange={e => setMeetingTime(e.target.value)}
              className="w-full mb-2 px-3 py-2 rounded-lg ring-1 ring-slate-200 text-[13px] outline-none focus:ring-cyan-300"
            />
            <button
              onClick={setMeeting}
              disabled={!meetingTime}
              className="w-full px-4 py-2 rounded-lg bg-violet-500 text-white text-[12px] font-semibold disabled:opacity-50 hover:bg-violet-600"
            >
              Назначить встречу
            </button>
          </div>

          {/* Timeline */}
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-5 shadow-sm">
            <h3 className="text-[14px] font-bold text-slate-900 mb-3">Timeline ({events.length})</h3>
            <div className="space-y-2 max-h-80 overflow-auto">
              {events.length === 0 ? (
                <div className="text-[11px] text-slate-400 italic">Событий пока нет</div>
              ) : (
                events.map(ev => (
                  <div key={ev.id} className="flex items-start gap-2 text-[11px] py-1.5 border-b border-slate-100 last:border-0">
                    <span className="text-[14px]">{eventIcon(ev.event_type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-700">{ev.event_type}</div>
                      {ev.note && <div className="text-slate-500 mt-0.5">{ev.note}</div>}
                    </div>
                    <div className="text-[10px] text-slate-400 whitespace-nowrap">{fmt(ev.created_at)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
