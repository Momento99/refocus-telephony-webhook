'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Inbox, MapPin, Phone, MessageCircle,
  Clock, AlertTriangle, Calendar, Bell, Globe, ChevronRight,
} from 'lucide-react';

type App = {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  status: string;
  source: string | null;
  created_at: string;
  updated_at: string;
  first_contact_at: string | null;
  last_activity_at: string | null;
  reminder_at: string | null;
  reminder_note: string | null;
  reminder_fired_at: string | null;
  meeting_at: string | null;
  conversation_log: string | null;
  admin_note: string | null;
};

type Event = {
  id: string;
  application_id: string;
  event_type: string;
  note: string | null;
  created_at: string;
};

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  new:               { label: 'Новая',         cls: 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200' },
  confirmed:         { label: 'Подтверждена',  cls: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  contacted:         { label: 'Связались',     cls: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  qualified:         { label: 'Квалифицирован',cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  meeting_scheduled: { label: 'Встреча назн.', cls: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200' },
  meeting_done:      { label: 'После встречи', cls: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200' },
  negotiation:       { label: 'Переговоры',    cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  converted:         { label: 'Партнёр 🎉',    cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  cold:              { label: 'Остыл',         cls: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200' },
  unqualified:       { label: 'Не подходит',   cls: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200' },
  lost:              { label: 'Потерян',       cls: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200' },
  // legacy
  rejected:          { label: 'Отклонена',     cls: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200' },
};

const SOURCE_MAP: Record<string, string> = {
  'landing': 'Лендинг',
  'pdf-gate': 'PDF-форма',
  'instagram-inbound': 'Instagram',
  'whatsapp-inbound': 'WhatsApp',
  'referral': 'Рекомендация',
};

type ActionVariant = 'primary' | 'accent' | 'success' | 'neutral' | 'danger';
type StatusAction = { label: string; to: string; variant: ActionVariant };

// Контекстные «следующие шаги» в зависимости от текущего статуса.
function nextStatusActions(current: string): StatusAction[] {
  switch (current) {
    case 'new':
    case 'confirmed':
      return [
        { label: 'Связались', to: 'contacted', variant: 'primary' },
        { label: 'Не подходит', to: 'unqualified', variant: 'neutral' },
      ];
    case 'contacted':
      return [
        { label: 'Квалифицирован', to: 'qualified', variant: 'primary' },
        { label: 'Остыл', to: 'cold', variant: 'neutral' },
        { label: 'Не подходит', to: 'unqualified', variant: 'neutral' },
      ];
    case 'qualified':
      return [
        { label: 'Встречу назначил', to: 'meeting_scheduled', variant: 'primary' },
        { label: 'Остыл', to: 'cold', variant: 'neutral' },
      ];
    case 'meeting_scheduled':
      return [
        { label: 'Встреча прошла', to: 'meeting_done', variant: 'primary' },
        { label: 'Потерян', to: 'lost', variant: 'danger' },
      ];
    case 'meeting_done':
      return [
        { label: 'Переговоры', to: 'negotiation', variant: 'primary' },
        { label: 'Партнёр 🎉', to: 'converted', variant: 'success' },
        { label: 'Потерян', to: 'lost', variant: 'danger' },
      ];
    case 'negotiation':
      return [
        { label: 'Партнёр 🎉', to: 'converted', variant: 'success' },
        { label: 'Потерян', to: 'lost', variant: 'danger' },
      ];
    case 'cold':
    case 'unqualified':
    case 'lost':
      return [
        { label: 'Вернуть в работу', to: 'contacted', variant: 'accent' },
      ];
    default:
      return [];
  }
}

const ACTION_VARIANT_CLS: Record<ActionVariant, string> = {
  primary: 'bg-cyan-500 text-white hover:bg-cyan-600 ring-cyan-500',
  accent:  'bg-violet-500 text-white hover:bg-violet-600 ring-violet-500',
  success: 'bg-emerald-500 text-white hover:bg-emerald-600 ring-emerald-500',
  neutral: 'bg-white text-slate-700 hover:bg-slate-50 ring-slate-300',
  danger:  'bg-white text-rose-700 hover:bg-rose-50 ring-rose-300',
};

const STATUS_FILTER_GROUPS = [
  { key: 'all', label: 'Все' },
  { key: 'active', label: 'Активные', subset: ['new', 'confirmed', 'contacted', 'qualified', 'meeting_scheduled', 'meeting_done', 'negotiation'] },
  { key: 'new', label: 'Новые' },
  { key: 'contacted', label: 'Связались' },
  { key: 'qualified', label: 'Квалифицирован' },
  { key: 'meeting_scheduled', label: 'Встречи' },
  { key: 'negotiation', label: 'Переговоры' },
  { key: 'converted', label: 'Партнёры' },
  { key: 'closed', label: 'Закрытые', subset: ['cold', 'unqualified', 'lost', 'rejected'] },
];

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtRelative(s: string) {
  const diffMs = Date.now() - new Date(s).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} ч назад`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD} дн назад`;
  return new Date(s).toLocaleDateString('ru-RU');
}

function fmtUpcoming(s: string) {
  const diffMs = new Date(s).getTime() - Date.now();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 0) return 'просрочено';
  if (diffMin < 60) return `через ${diffMin} мин`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `через ${diffH} ч`;
  const diffD = Math.floor(diffH / 24);
  return `через ${diffD} дн`;
}

function cleanPhone(p: string) {
  return p.replace(/[^+\d]/g, '');
}

// SLA: новая заявка не должна висеть >2 часов
function isSLABreach(app: App): boolean {
  if (app.status !== 'new' && app.status !== 'confirmed') return false;
  const ageMs = Date.now() - new Date(app.created_at).getTime();
  return ageMs > 2 * 60 * 60 * 1000;
}

function eventIcon(type: string): string {
  if (type === 'application_received') return '📥';
  if (type.includes('whatsapp_sent') || type.includes('whatsapp_queued')) return '💬';
  if (type.includes('owner_alert')) return '🔔';
  if (type === 'call_made') return '📞';
  if (type === 'meeting_scheduled') return '📅';
  if (type === 'meeting_reminder_24h_queued' || type === 'meeting_reminder_2h_queued') return '⏰';
  if (type === 'reminder_fired') return '⏰';
  if (type === 'status_changed') return '↪';
  if (type === 'stale_alert_queued') return '⚠️';
  if (type === 'whatsapp_send_failed') return '❌';
  return '•';
}

export default function FranchiseApplicationsPage() {
  const router = useRouter();
  const [apps, setApps] = useState<App[]>([]);
  const [eventsByApp, setEventsByApp] = useState<Record<string, Event[]>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('active');

  function sb() { return getBrowserSupabase(); }

  async function load() {
    setLoading(true);
    const { data: appsData } = await sb()
      .from('franchise_applications')
      .select('*')
      .order('created_at', { ascending: false });
    const list = (appsData || []) as App[];
    setApps(list);

    // Подгружаем последние 3 события для каждой заявки одним запросом
    if (list.length > 0) {
      const ids = list.map(a => a.id);
      const { data: evData } = await sb()
        .from('franchise_application_events')
        .select('id, application_id, event_type, note, created_at')
        .in('application_id', ids)
        .order('created_at', { ascending: false });
      const grouped: Record<string, Event[]> = {};
      for (const ev of (evData || []) as Event[]) {
        if (!grouped[ev.application_id]) grouped[ev.application_id] = [];
        if (grouped[ev.application_id].length < 3) grouped[ev.application_id].push(ev);
      }
      setEventsByApp(grouped);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function updateStatus(id: string, status: string) {
    const updates: Record<string, any> = {
      status,
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    };
    // Сбрасываем stale alert если статус изменился — лид опять активен
    updates.stale_alert_sent_at = null;
    // Если перешёл в contacted и first_contact_at не записано — записываем сейчас
    const app = apps.find(a => a.id === id);
    if (app && status === 'contacted' && !app.first_contact_at) {
      updates.first_contact_at = new Date().toISOString();
    }
    await sb().from('franchise_applications').update(updates).eq('id', id);
    await sb().from('franchise_application_events').insert({
      application_id: id,
      event_type: 'status_changed',
      note: `Статус: ${app?.status} → ${status}`,
      payload: { from: app?.status, to: status },
    });
    setApps(prev => prev.map(a => a.id === id ? { ...a, ...updates } as App : a));
    toast.success('Статус обновлён');
    load(); // перезагрузить чтобы события обновились
  }

  function counts(status: string | string[]): number {
    if (Array.isArray(status)) return apps.filter(a => status.includes(a.status)).length;
    return apps.filter(a => a.status === status).length;
  }

  const filtered = (() => {
    if (filter === 'all') return apps;
    const group = STATUS_FILTER_GROUPS.find(g => g.key === filter);
    if (group?.subset) return apps.filter(a => group.subset!.includes(a.status));
    return apps.filter(a => a.status === filter);
  })();

  const newCount = counts('new');
  const slaBreachCount = apps.filter(isSLABreach).length;

  return (
    <div className="mx-auto max-w-6xl px-5 pt-8 pb-12">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/admin/franchise-map" className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/15 transition-colors">
            <ArrowLeft size={16} className="text-slate-400" />
          </Link>
          <div>
            <h1 className="text-[22px] font-bold text-white tracking-tight">Заявки на франшизу</h1>
            <p className="text-[12px] text-slate-400">
              {apps.length} всего
              {newCount > 0 && <span className="text-cyan-400"> · {newCount} новых</span>}
              {slaBreachCount > 0 && <span className="text-rose-400"> · {slaBreachCount} просрочено SLA</span>}
            </p>
          </div>
        </div>
        <button onClick={load} disabled={loading}
          className="px-4 py-2.5 rounded-xl bg-white/10 text-slate-300 text-[13px] font-medium hover:bg-white/15 disabled:opacity-50 transition-all">
          {loading ? 'Загрузка...' : 'Обновить'}
        </button>
      </div>

      {/* SLA Warning Banner */}
      {slaBreachCount > 0 && (
        <div className="mb-4 rounded-xl bg-rose-50/10 ring-1 ring-rose-500/30 px-4 py-3 flex items-center gap-3">
          <AlertTriangle size={18} className="text-rose-400 shrink-0" />
          <div className="text-[13px] text-rose-200">
            <strong>{slaBreachCount}</strong> {slaBreachCount === 1 ? 'заявка висит' : 'заявок висят'} больше 2 часов без контакта.
            Свяжитесь — клиенты остывают.
          </div>
        </div>
      )}

      {/* Фильтры */}
      <div className="flex flex-wrap gap-2 mb-5">
        {STATUS_FILTER_GROUPS.map(f => {
          const count = f.subset ? counts(f.subset) : (f.key === 'all' ? apps.length : counts(f.key));
          if (count === 0 && f.key !== 'all' && f.key !== 'active') return null;
          return (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3.5 py-2 rounded-xl text-[12px] font-semibold transition-all ${
                filter === f.key
                  ? 'bg-[#22d3ee] text-[#0f172a] shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
                  : 'bg-white/10 text-slate-400 hover:bg-white/15 hover:text-white'
              }`}>
              {f.label}{count > 0 ? ` (${count})` : ''}
            </button>
          );
        })}
      </div>

      {/* Список */}
      {loading ? (
        <div className="text-center py-16 text-slate-500 text-sm">Загрузка...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Inbox size={32} className="mx-auto text-slate-600 mb-3" />
          <p className="text-slate-400 text-sm">{filter === 'all' ? 'Пока нет заявок' : 'Нет заявок в этой категории'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(app => {
            const st = STATUS_MAP[app.status] || STATUS_MAP.new;
            const isNew = app.status === 'new';
            const slaBreach = isSLABreach(app);
            const events = eventsByApp[app.id] || [];

            return (
              <div
                key={app.id}
                role="link"
                tabIndex={0}
                onClick={() => router.push(`/admin/franchise-applications/${app.id}`)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    router.push(`/admin/franchise-applications/${app.id}`);
                  }
                }}
                className={`block rounded-2xl bg-white ring-1 ring-slate-200 p-5 transition-all hover:shadow-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
                  slaBreach
                    ? 'shadow-[0_0_0_2px_rgba(244,63,94,0.4),0_4px_20px_rgba(244,63,94,0.12)]'
                    : isNew
                    ? 'shadow-[0_0_0_2px_rgba(34,211,238,0.2),0_4px_20px_rgba(34,211,238,0.08)]'
                    : 'shadow-sm'
                }`}
              >
                {/* Верхняя строка */}
                <div className="flex items-start justify-between gap-4 mb-2">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-[15px] font-bold shrink-0 ${
                      slaBreach
                        ? 'bg-gradient-to-br from-rose-500 to-rose-600 text-white'
                        : isNew
                        ? 'bg-gradient-to-br from-[#22d3ee] to-cyan-500 text-[#0f172a]'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {app.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-[15px] font-semibold text-slate-900">{app.name}</div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {app.source && (
                          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-700 font-semibold ring-1 ring-cyan-100">
                            <Globe size={9} /> {SOURCE_MAP[app.source] || app.source}
                          </span>
                        )}
                        {app.city && (
                          <span className="flex items-center gap-1 text-[11px] text-slate-400">
                            <MapPin size={10} /> {app.city}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          <Clock size={10} /> {fmtRelative(app.created_at)}
                        </span>
                        {slaBreach && (
                          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-bold uppercase tracking-wide">
                            SLA нарушен
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${st.cls}`}>
                      {st.label}
                    </span>
                    <ChevronRight size={16} className="text-slate-300" />
                  </div>
                </div>

                {/* Action buttons row + reminders/meetings */}
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <a
                    onClick={e => e.stopPropagation()}
                    href={`https://wa.me/${cleanPhone(app.phone).replace(/^\+/, '')}`}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 ring-1 ring-emerald-200 text-emerald-700 text-[11px] font-semibold hover:bg-emerald-100"
                  >
                    <MessageCircle size={11} /> WhatsApp
                  </a>
                  <a
                    onClick={e => e.stopPropagation()}
                    href={`tel:${cleanPhone(app.phone)}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 ring-1 ring-slate-200 text-slate-700 text-[11px] font-semibold hover:bg-slate-100"
                  >
                    <Phone size={11} /> {app.phone}
                  </a>

                  {app.meeting_at && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 ring-1 ring-violet-200 text-violet-700 text-[11px] font-semibold">
                      <Calendar size={11} /> Встреча {fmtUpcoming(app.meeting_at)}
                    </span>
                  )}

                  {app.reminder_at && !app.reminder_fired_at && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 ring-1 ring-amber-200 text-amber-700 text-[11px] font-semibold">
                      <Bell size={11} /> Напомнить {fmtUpcoming(app.reminder_at)}
                    </span>
                  )}
                </div>

                {/* Timeline preview */}
                {events.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">События:</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {events.map(ev => (
                        <span
                          key={ev.id}
                          className="inline-flex items-center gap-1 text-[10px] text-slate-500 px-1.5 py-0.5 rounded bg-slate-50"
                          title={`${ev.event_type}: ${ev.note || ''}`}
                        >
                          <span>{eventIcon(ev.event_type)}</span>
                          <span className="font-medium">{fmtRelative(ev.created_at)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Quick status change — контекстные кнопки следующих шагов */}
                {(() => {
                  const actions = nextStatusActions(app.status);
                  if (actions.length === 0) return null;
                  return (
                    <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mr-1">
                        Следующий шаг:
                      </span>
                      {actions.map(a => (
                        <button
                          key={a.to}
                          onClick={e => { e.stopPropagation(); updateStatus(app.id, a.to); }}
                          className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg ring-1 transition-colors ${ACTION_VARIANT_CLS[a.variant]}`}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
