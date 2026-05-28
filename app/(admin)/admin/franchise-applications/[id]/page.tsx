'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Phone, MessageCircle, Calendar, Bell, MapPin, Clock,
  User, Globe, AlertTriangle, BookOpen, Send, Check,
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

const STATUS_PILL_CLS: Record<string, string> = {
  new:               'bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-500/30',
  confirmed:         'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30',
  contacted:         'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30',
  qualified:         'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
  meeting_scheduled: 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30',
  meeting_done:      'bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30',
  negotiation:       'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
  converted:         'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
  cold:              'bg-slate-700/40 text-slate-400 ring-1 ring-slate-600/40',
  unqualified:       'bg-slate-700/40 text-slate-400 ring-1 ring-slate-600/40',
  lost:              'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30',
};

type StatusAction = { label: string; to: string; tone: 'primary' | 'success' | 'neutral' | 'danger' | 'accent' };
function nextStatusActions(current: string): StatusAction[] {
  switch (current) {
    case 'new':
    case 'confirmed':
      return [
        { label: 'Связались', to: 'contacted', tone: 'primary' },
        { label: 'Не подходит', to: 'unqualified', tone: 'neutral' },
      ];
    case 'contacted':
      return [
        { label: 'Квалифицирован', to: 'qualified', tone: 'primary' },
        { label: 'Остыл', to: 'cold', tone: 'neutral' },
        { label: 'Не подходит', to: 'unqualified', tone: 'neutral' },
      ];
    case 'qualified':
      return [
        { label: 'Встречу назначил', to: 'meeting_scheduled', tone: 'primary' },
        { label: 'Остыл', to: 'cold', tone: 'neutral' },
      ];
    case 'meeting_scheduled':
      return [
        { label: 'Встреча прошла', to: 'meeting_done', tone: 'primary' },
        { label: 'Потерян', to: 'lost', tone: 'danger' },
      ];
    case 'meeting_done':
      return [
        { label: 'Переговоры', to: 'negotiation', tone: 'primary' },
        { label: 'Партнёр', to: 'converted', tone: 'success' },
        { label: 'Потерян', to: 'lost', tone: 'danger' },
      ];
    case 'negotiation':
      return [
        { label: 'Партнёр', to: 'converted', tone: 'success' },
        { label: 'Потерян', to: 'lost', tone: 'danger' },
      ];
    case 'cold':
    case 'unqualified':
    case 'lost':
      return [{ label: 'Вернуть в работу', to: 'contacted', tone: 'accent' }];
    default:
      return [];
  }
}

const ACTION_TONE_CLS: Record<StatusAction['tone'], string> = {
  primary: 'bg-cyan-500 text-slate-950 hover:bg-cyan-400 shadow-[0_4px_20px_rgba(34,211,238,0.25)]',
  accent:  'bg-violet-500 text-white hover:bg-violet-400',
  success: 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-[0_4px_20px_rgba(16,185,129,0.25)]',
  neutral: 'bg-slate-800 text-slate-200 hover:bg-slate-700 ring-1 ring-slate-700',
  danger:  'bg-slate-800 text-rose-300 hover:bg-rose-500/15 ring-1 ring-rose-500/30',
};

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
  if (type === 'welcome_sent_manually') return '✉️';
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

function welcomeText(name: string): string {
  return [
    `Здравствуйте, ${name}!`,
    '',
    'Получили вашу заявку на франшизу Refocus. Спасибо, что заинтересовались.',
    '',
    'Свяжусь с вами в ближайшие пару часов — обсудим город, подходящий пакет и когда удобно созвониться на 15–20 минут для знакомства.',
    '',
    'Если есть вопросы прямо сейчас — пишите сюда, отвечу.',
    '',
    '— Команда Refocus · refocus.asia',
  ].join('\n');
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

  async function sendWelcomeManually(force = false) {
    if (!app) return;
    const phoneDigits = cleanPhone(app.phone).replace(/^\+/, '');
    if (!phoneDigits) {
      toast.error('Не могу разобрать номер лида');
      return;
    }
    const link = `https://wa.me/${phoneDigits}?text=${encodeURIComponent(welcomeText(app.name))}`;
    window.open(link, '_blank', 'noopener');

    await sb().from('franchise_application_events').insert({
      application_id: app.id,
      event_type: 'welcome_sent_manually',
      note: force ? 'Welcome отправлен повторно через wa.me' : 'Welcome отправлен через wa.me (с 555)',
    });

    const updates: Record<string, any> = {
      last_activity_at: new Date().toISOString(),
      stale_alert_sent_at: null,
    };
    if (app.status === 'new' || app.status === 'confirmed') updates.status = 'contacted';
    if (!app.first_contact_at) updates.first_contact_at = new Date().toISOString();
    await sb().from('franchise_applications').update(updates).eq('id', app.id);

    toast.success(force ? 'WhatsApp открыт повторно' : 'WhatsApp открыт — нажми Отправить');
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

  const welcomeEvent = events.find(e => e.event_type === 'welcome_sent_manually');
  const statusOption = STATUS_OPTIONS.find(o => o.v === app.status);
  const nextActions = nextStatusActions(app.status);
  const phoneE164 = cleanPhone(app.phone).replace(/^\+/, '');

  // более понятные русские названия событий в timeline
  const EVENT_LABEL: Record<string, string> = {
    application_received: 'Заявка получена',
    welcome_sent_manually: 'Welcome отправлен',
    welcome_whatsapp_queued: 'Welcome в очереди (старое)',
    owner_alert_queued: 'Alert тебе поставлен',
    owner_alert_sent: 'Alert отправлен',
    call_made: 'Звонок зафиксирован',
    note_added: 'Заметка',
    meeting_scheduled: 'Встреча назначена',
    meeting_reminder_24h_queued: 'Напоминание за 24ч',
    meeting_reminder_2h_queued: 'Напоминание за 2ч',
    reminder_set: 'Напоминание установлено',
    reminder_fired: 'Напоминание сработало',
    status_changed: 'Статус изменён',
    stale_alert_queued: 'Лид завис >7 дней',
    whatsapp_send_failed: 'Ошибка отправки WhatsApp',
  };

  return (
    <div className="mx-auto max-w-5xl px-5 pt-8 pb-12">

      {/* ═══════════ HERO HEADER ═══════════ */}
      <div className="mb-6">
        <Link href="/admin/franchise-applications" className="inline-flex items-center gap-1.5 text-[12px] text-slate-400 hover:text-cyan-300 transition mb-4">
          <ArrowLeft size={13} /> К списку заявок
        </Link>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-400 to-cyan-600 grid place-items-center text-[22px] font-bold text-slate-950 shrink-0">
              {app.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-[26px] font-bold text-white tracking-tight leading-none">{app.name}</h1>
              <div className="flex items-center gap-3 mt-2 text-[12px] text-slate-400 flex-wrap">
                {app.source && <span className="inline-flex items-center gap-1"><Globe size={12} className="text-cyan-400/70" /> {sourceLabel[app.source] || app.source}</span>}
                {app.city && <span className="inline-flex items-center gap-1"><MapPin size={12} /> {app.city}</span>}
                <span className="inline-flex items-center gap-1"><Clock size={12} /> {fmt(app.created_at)}</span>
                <a href={`tel:${cleanPhone(app.phone)}`} className="inline-flex items-center gap-1 text-slate-200 hover:text-cyan-300"><Phone size={12} /> {app.phone}</a>
                {app.pd_consent_at && <span className="inline-flex items-center gap-1 text-emerald-400/80" title={`Согласие на ПД ${fmt(app.pd_consent_at)}`}>✓ Согласие на ПД</span>}
              </div>
            </div>
          </div>

          {/* Статус-пилл с inline select */}
          <div className="relative">
            <select
              value={app.status}
              onChange={e => patch({ status: e.target.value })}
              className={`appearance-none pr-8 pl-3 py-2 rounded-xl text-[12px] font-semibold cursor-pointer outline-none focus:ring-2 focus:ring-cyan-500/40 ${STATUS_PILL_CLS[app.status] ?? STATUS_PILL_CLS.new} [&>option]:text-slate-900 [&>option]:bg-white`}
              title="Сменить статус"
            >
              {STATUS_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
            <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] opacity-70">▼</div>
          </div>
        </div>
      </div>

      {/* ═══════════ NEXT-STEP STRIP ═══════════ */}
      {nextActions.length > 0 && (
        <div className="mb-5 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 mr-1">Следующий шаг</span>
          {nextActions.map(a => (
            <button
              key={a.to}
              onClick={() => patch({ status: a.to }).then(() => load())}
              className={`text-[12px] font-semibold px-3.5 py-2 rounded-lg transition-colors ${ACTION_TONE_CLS[a.tone]}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* ═══════════ WELCOME / CONTACT BAR ═══════════ */}
      <div className="mb-5 rounded-2xl ring-1 ring-slate-700 bg-slate-800 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] p-4 flex flex-wrap items-center gap-3">
        {/* Welcome — главная CTA либо подтверждение */}
        {!welcomeEvent ? (
          <button
            onClick={() => sendWelcomeManually(false)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 text-slate-950 text-[13px] font-bold hover:bg-emerald-400 shadow-[0_4px_20px_rgba(16,185,129,0.3)] transition"
            title="Откроет WhatsApp с твоего 555 и готовым текстом welcome"
          >
            <Send size={14} /> Отправить welcome через WhatsApp
          </button>
        ) : (
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/30 text-emerald-300 text-[12px]">
            <Check size={14} />
            <span className="font-semibold">Welcome отправлен</span>
            <span className="text-emerald-400/70">· {fmt(welcomeEvent.created_at)}</span>
            <button
              onClick={() => { if (confirm('Отправить welcome ещё раз?')) sendWelcomeManually(true); }}
              className="ml-2 text-[11px] underline hover:text-emerald-200"
            >
              Ещё раз
            </button>
          </div>
        )}

        <div className="flex-1" />

        <a
          href={`https://wa.me/${phoneE164}`}
          target="_blank" rel="noopener"
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-700 ring-1 ring-slate-600 text-slate-200 text-[12px] font-semibold hover:bg-slate-600 hover:text-emerald-300 transition"
          title="Открыть WhatsApp-чат с лидом"
        >
          <MessageCircle size={14} /> WhatsApp
        </a>
        <button
          onClick={recordCall}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-700 ring-1 ring-slate-600 text-slate-200 text-[12px] font-semibold hover:bg-slate-600 hover:text-cyan-300 transition"
        >
          <Phone size={14} /> Зафиксировать звонок
        </button>
        <button
          onClick={() => setShowScript(s => !s)}
          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg ring-1 text-[12px] font-semibold transition ${
            showScript
              ? 'bg-violet-500/15 ring-violet-500/40 text-violet-200'
              : 'bg-slate-700 ring-slate-600 text-slate-200 hover:bg-slate-600 hover:text-violet-300'
          }`}
        >
          <BookOpen size={14} /> {showScript ? 'Скрыть скрипт' : 'Скрипт звонка'}
        </button>
      </div>

      {/* ═══════════ SCRIPT (collapsible) ═══════════ */}
      {showScript && (
        <div className="mb-5 rounded-2xl bg-slate-800 ring-1 ring-violet-500/40 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] p-5">
          <h3 className="text-[13px] font-bold text-violet-300 uppercase tracking-[0.12em] mb-4">Скрипт первого звонка · 15–20 мин</h3>
          <div className="text-[12.5px] text-slate-300 space-y-3 leading-relaxed">
            <div>
              <span className="font-bold text-white">1. Открытие</span> <span className="text-slate-500">· 1–2 мин</span><br/>
              <span className="text-slate-400">«Здравствуйте, {app.name}! Я из Refocus. Вы оставили заявку на нашу франшизу оптики. Удобно сейчас 15–20 минут пообщаться?»</span>
            </div>
            <div>
              <span className="font-bold text-white">2. Квалификация</span> <span className="text-slate-500">· 5–7 мин</span><br/>
              <span className="text-slate-400">4 вопроса: мотивация / бюджет и сроки / опыт / город и помещение. Поля квалификации заполняй прямо ниже на странице.</span>
            </div>
            <div>
              <span className="font-bold text-white">3. Презентация</span> <span className="text-slate-500">· 5–7 мин</span><br/>
              <span className="text-slate-400">5 пунктов: что Refocus, 4 пакета (COMPACT $18.5k · STANDARD $32k · PREMIUM $39.7k · CUSTOM), прибыль $1.4k–$3.8k/мес, окуп. 10–13 мес, что включено.</span>
            </div>
            <div>
              <span className="font-bold text-white">4. Closing</span> <span className="text-slate-500">· 2–3 мин</span><br/>
              <span className="text-slate-400">«Что у нас дальше: назначим детальную встречу на Zoom 30 мин, когда вам удобно — [день/время X] или [день/время Y]?»</span>
            </div>
            <div className="pt-3 mt-3 border-t border-slate-800 text-[11px] text-slate-500">
              Полный текст: <code className="text-slate-400">docs/franchise-sales/02-call-script.md</code>
              <span className="mx-2">·</span>
              <code className="text-slate-400">03-objections.md</code>
              <span className="mx-2">·</span>
              <code className="text-slate-400">07-pricing-reference.md</code>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ 2-COLUMN GRID ═══════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* LEFT — log + qualification (3 cols) */}
        <div className="lg:col-span-3 space-y-5">

          {/* Журнал разговоров */}
          <section className="rounded-2xl bg-slate-800 ring-1 ring-slate-700 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] p-5">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 mb-4">Журнал разговоров</h3>
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="Что обсудили / договорились / решили…"
                value={newLogEntry}
                onChange={e => setNewLogEntry(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addLogEntry(); }}
                className="flex-1 px-3.5 py-2.5 rounded-lg bg-slate-900/70 ring-1 ring-slate-700/70 text-[13px] text-slate-100 placeholder:text-slate-500 outline-none focus:ring-cyan-500/60 transition"
              />
              <button
                onClick={addLogEntry}
                disabled={!newLogEntry.trim()}
                className="px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-[12px] font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-cyan-400 transition"
              >
                Добавить
              </button>
            </div>
            {app.conversation_log ? (
              <pre className="text-[12px] text-slate-300 whitespace-pre-wrap font-mono leading-relaxed bg-slate-950/60 rounded-lg p-3.5 ring-1 ring-slate-800 max-h-72 overflow-auto">
                {app.conversation_log}
              </pre>
            ) : (
              <div className="text-[12px] text-slate-500 italic px-1">
                Пока пусто. Запиши первую заметку после звонка — что обсудили, чего хочет лид, какой пакет рассматривает.
              </div>
            )}
          </section>

          {/* Квалификация */}
          <section className="rounded-2xl bg-slate-800 ring-1 ring-slate-700 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] p-5">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 mb-4">Квалификация</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">Бюджет · пакет</label>
                <select
                  value={app.qualified_budget || ''}
                  onChange={e => patch({ qualified_budget: e.target.value || null })}
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-900/70 ring-1 ring-slate-700/70 text-[13px] text-slate-100 outline-none focus:ring-cyan-500/60 transition [&>option]:text-slate-900 [&>option]:bg-white"
                >
                  {BUDGET_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">Опыт в бизнесе</label>
                <select
                  value={app.qualified_experience || ''}
                  onChange={e => patch({ qualified_experience: e.target.value || null })}
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-900/70 ring-1 ring-slate-700/70 text-[13px] text-slate-100 outline-none focus:ring-cyan-500/60 transition [&>option]:text-slate-900 [&>option]:bg-white"
                >
                  {EXPERIENCE_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">Готовность к открытию</label>
                <select
                  value={app.readiness_window || ''}
                  onChange={e => patch({ readiness_window: e.target.value || null })}
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-900/70 ring-1 ring-slate-700/70 text-[13px] text-slate-100 outline-none focus:ring-cyan-500/60 transition [&>option]:text-slate-900 [&>option]:bg-white"
                >
                  {READINESS_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer rounded-lg px-3 py-2.5 ring-1 ring-slate-700/70 bg-slate-900/70 hover:bg-slate-900 transition">
                <input
                  type="checkbox"
                  checked={app.has_premises ?? false}
                  onChange={e => patch({ has_premises: e.target.checked })}
                  className="w-4 h-4 accent-cyan-500"
                />
                <span className="text-[13px] text-slate-200 font-medium">Есть помещение</span>
              </label>
              {(app.status === 'unqualified' || app.status === 'lost' || app.status === 'cold') && (
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">Причина потери</label>
                  <select
                    value={app.lost_reason || ''}
                    onChange={e => patch({ lost_reason: e.target.value || null })}
                    className="w-full px-3 py-2.5 rounded-lg bg-slate-900/70 ring-1 ring-slate-700/70 text-[13px] text-slate-100 outline-none focus:ring-cyan-500/60 transition [&>option]:text-slate-900 [&>option]:bg-white"
                  >
                    {LOST_REASON_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                  </select>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* RIGHT — reminder/meeting/timeline (2 cols) */}
        <div className="lg:col-span-2 space-y-5">

          {/* Напоминание */}
          <section className="rounded-2xl bg-slate-800 ring-1 ring-slate-700 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] p-5">
            <div className="flex items-center gap-2 mb-4">
              <Bell size={14} className="text-amber-400" />
              <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Напоминание</h3>
            </div>
            {app.reminder_at && !app.reminder_fired_at && (
              <div className="text-[12px] text-amber-300 bg-amber-500/10 ring-1 ring-amber-500/30 rounded-lg p-3 mb-3">
                <div className="font-semibold">{fmt(app.reminder_at)}</div>
                {app.reminder_note && <div className="text-amber-400/80 mt-1">{app.reminder_note}</div>}
                <button
                  onClick={() => patch({ reminder_at: null, reminder_note: null })}
                  className="mt-2 text-[11px] text-amber-300/80 hover:text-amber-200 underline"
                >
                  Удалить
                </button>
              </div>
            )}
            <input
              type="datetime-local"
              value={reminderTime}
              onChange={e => setReminderTime(e.target.value)}
              className="w-full mb-2 px-3 py-2.5 rounded-lg bg-slate-900/70 ring-1 ring-slate-700/70 text-[13px] text-slate-100 outline-none focus:ring-cyan-500/60 transition [color-scheme:dark]"
            />
            <input
              type="text"
              placeholder="Что напомнить (опционально)"
              value={reminderNote}
              onChange={e => setReminderNote(e.target.value)}
              className="w-full mb-3 px-3 py-2.5 rounded-lg bg-slate-900/70 ring-1 ring-slate-700/70 text-[13px] text-slate-100 placeholder:text-slate-500 outline-none focus:ring-cyan-500/60 transition"
            />
            <button
              onClick={setReminder}
              disabled={!reminderTime}
              className="w-full px-4 py-2.5 rounded-lg bg-amber-500 text-slate-950 text-[12px] font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-amber-400 transition"
            >
              Установить напоминание
            </button>
          </section>

          {/* Встреча */}
          <section className="rounded-2xl bg-slate-800 ring-1 ring-slate-700 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] p-5">
            <div className="flex items-center gap-2 mb-4">
              <Calendar size={14} className="text-violet-400" />
              <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Встреча</h3>
            </div>
            {app.meeting_at && (
              <div className="text-[12px] text-violet-300 bg-violet-500/10 ring-1 ring-violet-500/30 rounded-lg p-3 mb-3">
                <div className="font-semibold">{fmt(app.meeting_at)}</div>
                <button
                  onClick={() => patch({ meeting_at: null })}
                  className="mt-2 text-[11px] text-violet-300/80 hover:text-violet-200 underline"
                >
                  Отменить
                </button>
              </div>
            )}
            <input
              type="datetime-local"
              value={meetingTime}
              onChange={e => setMeetingTime(e.target.value)}
              className="w-full mb-3 px-3 py-2.5 rounded-lg bg-slate-900/70 ring-1 ring-slate-700/70 text-[13px] text-slate-100 outline-none focus:ring-cyan-500/60 transition [color-scheme:dark]"
            />
            <button
              onClick={setMeeting}
              disabled={!meetingTime}
              className="w-full px-4 py-2.5 rounded-lg bg-violet-500 text-white text-[12px] font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-violet-400 transition"
            >
              Назначить встречу
            </button>
          </section>

          {/* Timeline */}
          <section className="rounded-2xl bg-slate-800 ring-1 ring-slate-700 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">История событий</h3>
              <span className="text-[10px] text-slate-500">{events.length}</span>
            </div>
            <div className="space-y-1 max-h-96 overflow-auto pr-1 -mr-1">
              {events.length === 0 ? (
                <div className="text-[12px] text-slate-500 italic">Событий пока нет</div>
              ) : (
                events.map(ev => (
                  <div key={ev.id} className="flex items-start gap-2.5 py-2 border-b border-slate-800/60 last:border-0">
                    <span className="text-[14px] mt-0.5 shrink-0">{eventIcon(ev.event_type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold text-slate-200">{EVENT_LABEL[ev.event_type] ?? ev.event_type}</div>
                      {ev.note && <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">{ev.note}</div>}
                    </div>
                    <div className="text-[10px] text-slate-500 whitespace-nowrap mt-0.5">{fmt(ev.created_at)}</div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
