'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  CheckCircle2, Circle, ChevronDown, ChevronUp, ExternalLink, ArrowLeft,
  ShieldOff, Monitor, KeyRound, Trash2, AlertTriangle, PowerOff,
  DatabaseZap, UserX, FolderX, Ban,
} from 'lucide-react';

/* ─── Types ─── */

type SubStep = {
  id: string;
  title: string;
  detail: string;
  link?: { href: string; label: string };
  danger?: boolean;
};

type Step = {
  id: string;
  icon: React.ElementType;
  title: string;
  subtitle: string;
  color: string;
  substeps: SubStep[];
  link?: { href: string; label: string };
};

/* ─── Steps Data ─── */

const STEPS: Step[] = [
  {
    id: 'devices',
    icon: PowerOff,
    title: 'Отключить устройства',
    subtitle: 'Заблокировать все терминалы франчайзи',
    color: 'from-rose-400 to-red-500',
    substeps: [
      { id: 'off-dev-1', title: 'Отключить все терминалы филиала', detail: 'Центр устройств → Управление терминалами → найди филиал франчайзи → нажми «Отключить филиал». Все кассы и киоски мгновенно заблокируются.' },
      { id: 'off-dev-2', title: 'Убедиться что терминалы красные', detail: 'В списке терминалов все устройства франчайзи должны быть серыми / «Отключён». Касса покажет экран блокировки, киоск перестанет работать.' },
      { id: 'off-dev-3', title: 'Удалить терминалы (если навсегда)', detail: 'Если франчайзи уходит окончательно — удали терминалы из базы. Supabase → terminals → удалить строки с branch_id этого филиала.', danger: true },
    ],
    link: { href: '/admin/devices', label: 'Открыть: Центр устройств' },
  },
  {
    id: 'portal',
    icon: KeyRound,
    title: 'Закрыть доступ к порталу',
    subtitle: 'Отключить учётные записи франчайзи',
    color: 'from-orange-400 to-amber-500',
    substeps: [
      { id: 'off-portal-1', title: 'Деактивировать логин портала', detail: 'Доступы франчайзи → найди учётную запись → отключи или удали. После этого франчайзи не сможет войти в портал.' },
      { id: 'off-portal-2', title: 'Сменить PIN филиала', detail: 'Настройка франшизы → филиал → измени PIN на случайный. Старый PIN перестанет работать на всех устройствах.' },
    ],
    link: { href: '/admin/franchise-portal', label: 'Открыть: Доступы франчайзи' },
  },
  {
    id: 'employees',
    icon: UserX,
    title: 'Сотрудники',
    subtitle: 'Убрать доступ сотрудникам франчайзи',
    color: 'from-violet-400 to-purple-500',
    substeps: [
      { id: 'off-emp-1', title: 'Деактивировать всех сотрудников филиала', detail: 'Сотрудники → отфильтруй по филиалу → отключи каждого. Они не смогут войти в кассу и портал.' },
      { id: 'off-emp-2', title: 'Проверить что нет активных смен', detail: 'Если у кого-то открыта смена — закрой её принудительно, чтобы данные не копились.' },
    ],
  },
  {
    id: 'data',
    icon: DatabaseZap,
    title: 'Данные и заказы',
    subtitle: 'Решить что делать с данными',
    color: 'from-slate-500 to-slate-700',
    substeps: [
      { id: 'off-data-1', title: 'Экспорт данных (если нужен)', detail: 'Если по договору нужно передать данные — выгрузи заказы, клиентов и финансы из Supabase в CSV/Excel.' },
      { id: 'off-data-2', title: 'Архивировать филиал', detail: 'Настройка франшизы → филиал → отключи (is_active = false). Данные сохранятся для отчётности, но филиал пропадёт из всех списков.' },
      { id: 'off-data-3', title: 'Удалить данные (если навсегда)', detail: 'Supabase → удалить заказы, клиентов, остатки склада для этого branch_id. Необратимое действие — сначала сделай бэкап.', danger: true },
    ],
  },
  {
    id: 'infra',
    icon: FolderX,
    title: 'Инфраструктура',
    subtitle: 'Каналы обновлений, склады, организация',
    color: 'from-red-500 to-rose-600',
    substeps: [
      { id: 'off-infra-1', title: 'Отвязать склад', detail: 'Если за франчайзи был закреплён склад — убери привязку warehouse_id у филиала или удали склад.' },
      { id: 'off-infra-2', title: 'Удалить филиал из организации', detail: 'Настройка франшизы → удали филиал. Все привязки (терминалы, сотрудники) должны быть уже отключены к этому моменту.', danger: true },
      { id: 'off-infra-3', title: 'Удалить организацию', detail: 'Если у организации нет других филиалов — удали саму организацию. Это последний шаг.', danger: true },
    ],
    link: { href: '/admin/franchise-ramp-up/setup', label: 'Открыть: Настройка франшизы' },
  },
  {
    id: 'confirm',
    icon: Ban,
    title: 'Финальная проверка',
    subtitle: 'Убедиться что доступ полностью закрыт',
    color: 'from-slate-800 to-slate-900',
    substeps: [
      { id: 'off-fin-1', title: 'Попробовать войти от имени франчайзи', detail: 'Открой портал → введи старый логин/PIN. Должен быть отказ в доступе.' },
      { id: 'off-fin-2', title: 'Проверить устройства', detail: 'Если есть физический доступ — запусти кассу и киоск. Оба должны показать экран блокировки.' },
      { id: 'off-fin-3', title: 'Проверить карту франшиз', detail: 'Франчайзи не должен отображаться на карте как активный.' },
    ],
    link: { href: '/admin/franchise-map', label: 'Открыть: Карта франшиз' },
  },
];

/* ─── Persistence ─── */
const STORAGE_KEY = 'franchise_offboarding_checked';

function loadChecked(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveChecked(s: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...s]));
}

/* ─── Page ─── */

export default function OffboardingPage() {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(STEPS[0].id);

  useEffect(() => { setChecked(loadChecked()); }, []);

  function toggle(id: string) {
    setChecked(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      saveChecked(next);
      return next;
    });
  }

  const totalSubs = STEPS.reduce((s, st) => s + st.substeps.length, 0);
  const doneSubs = STEPS.reduce((s, st) => s + st.substeps.filter(ss => checked.has(ss.id)).length, 0);
  const pct = totalSubs > 0 ? Math.round((doneSubs / totalSubs) * 100) : 0;

  return (
    <div className="min-h-[100dvh] bg-transparent text-slate-900">

      {/* ═══ HEADER ═══ */}
      <div className="px-5 pt-8 pb-6 max-w-4xl mx-auto">
        <div className="rounded-3xl bg-white ring-1 ring-rose-200 shadow-[0_8px_32px_rgba(15,23,42,0.08)] px-6 py-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 flex items-center justify-center shadow-[0_4px_22px_rgba(244,63,94,0.4)] shrink-0">
                <ShieldOff size={24} className="text-white" />
              </div>
              <div>
                <h1 className="text-[24px] font-bold text-[#0f172a] leading-tight tracking-tight">
                  Отключение франшизы
                </h1>
                <p className="text-[13px] text-slate-500 mt-0.5">
                  Пошаговое отключение доступа франчайзи к системе
                </p>
              </div>
            </div>
            <Link href="/admin/franchise-map"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-50 ring-1 ring-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-100 transition-all">
              <ArrowLeft size={15} />
              Назад
            </Link>
          </div>

          {/* Warning */}
          <div className="rounded-2xl bg-rose-50 ring-1 ring-rose-200 px-4 py-3 mb-4 flex items-start gap-3">
            <AlertTriangle size={18} className="text-rose-500 mt-0.5 shrink-0" />
            <div className="text-[12px] text-rose-700 leading-relaxed">
              <span className="font-bold">Внимание:</span> эти действия отключают франчайзи от системы.
              Шаги помеченные <span className="inline-block w-2 h-2 rounded-full bg-red-500 mx-0.5 align-middle" /> необратимы.
              Выполняй по порядку сверху вниз.
            </div>
          </div>

          {/* Progress */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-rose-400 to-red-500 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-sm font-bold text-[#0f172a] tabular-nums w-14 text-right">{pct}%</span>
          </div>
          <div className="mt-1.5 text-[11px] text-slate-400">
            {doneSubs} из {totalSubs} шагов выполнено
          </div>
        </div>
      </div>

      {/* ═══ STEPS ═══ */}
      <div className="px-5 max-w-4xl mx-auto pb-12 space-y-3">
        {STEPS.map((step, idx) => {
          const stepDone = step.substeps.filter(ss => checked.has(ss.id)).length;
          const allDone = stepDone === step.substeps.length;
          const isExpanded = expanded === step.id;
          const Icon = step.icon;

          return (
            <div key={step.id} className={`rounded-3xl bg-white ring-1 ${allDone ? 'ring-emerald-200' : 'ring-slate-200'} shadow-[0_4px_24px_rgba(15,23,42,0.06)] overflow-hidden transition-all`}>

              {/* Step header */}
              <div
                className="px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-slate-50/50 transition-all"
                onClick={() => setExpanded(isExpanded ? null : step.id)}
              >
                <div className="flex items-center gap-3.5">
                  <div className="relative">
                    <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${step.color} flex items-center justify-center shadow-md shrink-0 ${allDone ? 'opacity-50' : ''}`}>
                      <Icon size={18} className="text-white" />
                    </div>
                    {allDone && (
                      <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm">
                        <CheckCircle2 size={12} className="text-white" />
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Шаг {idx + 1}</span>
                      <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ring-1 ${
                        allDone
                          ? 'text-emerald-700 bg-emerald-50 ring-emerald-200'
                          : stepDone > 0
                          ? 'text-amber-700 bg-amber-50 ring-amber-200'
                          : 'text-slate-400 bg-slate-50 ring-slate-200'
                      }`}>
                        {stepDone}/{step.substeps.length}
                      </span>
                    </div>
                    <div className={`font-bold text-[15px] ${allDone ? 'text-slate-400 line-through' : 'text-[#0f172a]'}`}>
                      {step.title}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{step.subtitle}</div>
                  </div>
                </div>
                {isExpanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
              </div>

              {/* Substeps */}
              {isExpanded && (
                <div className="border-t border-slate-100 px-5 py-3 space-y-1">
                  {step.link && (
                    <Link href={step.link.href}
                      className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3 mb-2 bg-gradient-to-r from-rose-500/10 to-red-50 ring-1 ring-rose-300/50 text-[#0f172a] text-[13px] font-semibold hover:ring-rose-400 hover:shadow-sm transition-all">
                      <ExternalLink size={14} className="text-rose-500" />
                      {step.link.label}
                    </Link>
                  )}

                  {step.substeps.map(ss => {
                    const done = checked.has(ss.id);
                    return (
                      <div key={ss.id}
                        className={`rounded-2xl px-4 py-3 transition-all ${
                          done ? 'bg-emerald-50/50' : ss.danger ? 'bg-rose-50/50 hover:bg-rose-50' : 'bg-slate-50/50 hover:bg-slate-50'
                        }`}>
                        <div className="flex items-start gap-3">
                          <button onClick={() => toggle(ss.id)} className="mt-0.5 shrink-0">
                            {done
                              ? <CheckCircle2 size={20} className="text-emerald-500" />
                              : <Circle size={20} className={`${ss.danger ? 'text-rose-300 hover:text-rose-500' : 'text-slate-300 hover:text-rose-400'} transition-colors`} />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`font-semibold text-[13px] ${done ? 'text-slate-400 line-through' : 'text-[#0f172a]'}`}>
                                {ss.title}
                              </span>
                              {ss.danger && !done && (
                                <span className="text-[9px] font-bold text-red-600 bg-red-100 ring-1 ring-red-200 rounded-full px-1.5 py-0.5 uppercase">
                                  необратимо
                                </span>
                              )}
                            </div>
                            <div className="text-[12px] text-slate-500 mt-1 whitespace-pre-line leading-relaxed">
                              {ss.detail}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
