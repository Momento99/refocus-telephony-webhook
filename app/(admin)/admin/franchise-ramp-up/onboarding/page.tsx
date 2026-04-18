'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  CheckCircle2, Circle, ChevronDown, ChevronUp, ExternalLink, ArrowLeft,
  Building2, MapPin, Monitor, Smartphone, KeyRound, Users, Package, Rocket,
  Wifi, Download, Settings2, ShieldCheck, ShieldOff, FileText, GraduationCap, Zap,
} from 'lucide-react';

/* ─── Types ─── */

type SubStep = {
  id: string;
  title: string;
  detail: string;
  link?: { href: string; label: string };
};

type Step = {
  id: string;
  icon: React.ElementType;
  title: string;
  subtitle: string;
  color: string;
  substeps: SubStep[];
  link?: { href: string; label: string };  // ссылка на страницу блока
};

/* ─── Steps Data ─── */

const STEPS: Step[] = [
  {
    id: 'setup',
    icon: Settings2,
    title: 'Настройка франшизы',
    subtitle: 'Организация, филиал, склад, PIN',
    color: 'from-[#22d3ee] to-cyan-500',
    substeps: [
      { id: 'setup-1', title: 'Создать организацию', detail: 'Нажми «+ Организация». Укажи название компании франчайзи и код страны. Валюта и таймзона подтянутся автоматически.' },
      { id: 'setup-2', title: 'Создать филиал', detail: 'Раскрой организацию, нажми «+ Филиал». Укажи название точки, город и часы работы.' },
      { id: 'setup-3', title: 'Назначить PIN филиала', detail: 'Кликни на поле «PIN филиала» и введи 4 цифры. Этот PIN нужен для входа в кассу и для привязки киоска.' },
      { id: 'setup-4', title: 'Создать склад линз (если нужен)', detail: 'Нажми «+ Склад». Выбери менеджера — он сможет редактировать остатки. Остальные филиалы получат только просмотр.' },
    ],
    link: { href: '/admin/franchise-ramp-up/setup', label: 'Открыть: Настройка франшизы' },
  },
  {
    id: 'devices',
    icon: Monitor,
    title: 'Центр устройств',
    subtitle: 'Терминалы, сборка, деплой по странам',
    color: 'from-emerald-400 to-teal-500',
    substeps: [
      { id: 'dev-1', title: 'Собрать инсталляторы', detail: 'В секции «Сборка и обновления» нажми «Патч-фикс» (или «Фича» / «Мажор») для POS и для Киоска. Дождись пока инсталляторы будут готовы.' },
      { id: 'dev-2', title: 'Загрузить обновления для страны', detail: 'В секции «Деплой по странам» нажми «Загрузить» на карточке нужной страны — для POS и для Киоска. Файлы уйдут в GitHub Releases.' },
      { id: 'dev-3', title: 'Создать терминалы', detail: 'Нажми «+ Терминал» в шапке. Создай кассовый аппарат и киоск для нового филиала.' },
      { id: 'dev-4', title: 'Проверить что устройства включены', detail: 'Внизу страницы в секции «Управление терминалами» убедись что все терминалы зелёные (включены).' },
    ],
    link: { href: '/admin/devices', label: 'Открыть: Центр устройств' },
  },
  {
    id: 'install',
    icon: Download,
    title: 'Установка на устройства',
    subtitle: 'Физическая установка POS и Киоска',
    color: 'from-sky-400 to-blue-500',
    substeps: [
      { id: 'inst-1', title: 'Скачать инсталляторы', detail: 'В «Центре устройств» нажми иконку папки у готового инсталлятора. Скопируй .exe на флешку.' },
      { id: 'inst-2', title: 'Установить POS на кассу', detail: 'Запусти .exe на кассовом компьютере. Автозапуск настроится автоматически. При первом входе сотрудника система определит терминал и загрузит настройки.' },
      { id: 'inst-3', title: 'Установить Киоск на тач-экран', detail: 'Запусти .exe на тач-экране. При первом запуске нужно ввести логин сотрудника + PIN филиала, затем выбрать киоск из списка.' },
      { id: 'inst-4', title: 'Последующие обновления', detail: 'После первой установки все обновления приходят автоматически из CRM. Флешка больше не нужна.' },
    ],
  },
  {
    id: 'portal',
    icon: KeyRound,
    title: 'Доступы франчайзи',
    subtitle: 'Логин и PIN для портала',
    color: 'from-amber-400 to-orange-500',
    substeps: [
      { id: 'portal-1', title: 'Создать логин для портала', detail: 'Создай учётную запись: логин, PIN, филиал и разрешения (заказы, клиенты, зарплата и т.д.).' },
      { id: 'portal-2', title: 'Отправить доступ франчайзи', detail: 'Отправь франчайзи ссылку portal.refocus.asia, логин и PIN. Через портал он сам добавит сотрудников.' },
    ],
    link: { href: '/admin/franchise-portal', label: 'Открыть: Доступы франчайзи' },
  },
  {
    id: 'docs',
    icon: FileText,
    title: 'Документы и материалы',
    subtitle: 'Пакет документов для франчайзи',
    color: 'from-slate-500 to-slate-700',
    substeps: [
      { id: 'docs-1', title: 'Проверить пакет HQ', detail: 'Убедись что все пункты заполнены: договор, бренд-бук, инструкции, видео.' },
      { id: 'docs-2', title: 'Загрузить подписанные документы', detail: 'Договор, лицензии, регистрации — загрузи в раздел «Документы».' },
    ],
    link: { href: '/admin/franchise-hq', label: 'Открыть: Документы и материалы' },
  },
  {
    id: 'launch',
    icon: Rocket,
    title: 'Запуск!',
    subtitle: 'Всё готово \u2014 финальная проверка',
    color: 'from-[#22d3ee] to-cyan-400',
    substeps: [
      { id: 'go-1', title: 'Финальный чеклист', detail: '\u2022 Касса открывает смену с правильной валютой\n\u2022 Киоск показывает каталог в нужной валюте\n\u2022 Портал доступен франчайзи\n\u2022 Обновления настроены для страны' },
      { id: 'go-2', title: 'Статус \u2192 Активный', detail: 'Поздравляю \u2014 франшиза запущена!' },
    ],
  },
];

/* ─── Persistence ─── */
const STORAGE_KEY = 'franchise_onboarding_checked';

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

export default function OnboardingPage() {
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
        <div className="rounded-3xl bg-white ring-1 ring-slate-200 shadow-[0_8px_32px_rgba(15,23,42,0.08)] px-6 py-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#22d3ee] to-cyan-500 flex items-center justify-center shadow-[0_4px_22px_rgba(34,211,238,0.4)] shrink-0">
                <Rocket size={24} className="text-[#0f172a]" />
              </div>
              <div>
                <h1 className="text-[24px] font-bold text-[#0f172a] leading-tight tracking-tight">
                  Запуск франшизы
                </h1>
                <p className="text-[13px] text-slate-500 mt-0.5">
                  Пошаговый путь от договора до первого заказа
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/admin/franchise-ramp-up/offboarding"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-50 ring-1 ring-rose-200 text-rose-600 text-sm font-medium hover:bg-rose-100 transition-all">
                <ShieldOff size={15} />
                Отключение
              </Link>
              <Link href="/admin/franchise-map"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-50 ring-1 ring-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-100 transition-all">
                <ArrowLeft size={15} />
                Назад
              </Link>
            </div>
          </div>

          {/* Progress */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#22d3ee] to-cyan-400 transition-all duration-500"
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
                  {/* Кнопка-ссылка на страницу */}
                  {step.link && (
                    <Link href={step.link.href}
                      className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3 mb-2 bg-gradient-to-r from-[#22d3ee]/10 to-cyan-50 ring-1 ring-[#22d3ee]/30 text-[#0f172a] text-[13px] font-semibold hover:ring-[#22d3ee] hover:shadow-sm transition-all">
                      <ExternalLink size={14} className="text-[#22d3ee]" />
                      {step.link.label}
                    </Link>
                  )}

                  {step.substeps.map(ss => {
                    const done = checked.has(ss.id);
                    return (
                      <div key={ss.id}
                        className={`rounded-2xl px-4 py-3 transition-all ${done ? 'bg-emerald-50/50' : 'bg-slate-50/50 hover:bg-slate-50'}`}>
                        <div className="flex items-start gap-3">
                          <button onClick={() => toggle(ss.id)} className="mt-0.5 shrink-0">
                            {done
                              ? <CheckCircle2 size={20} className="text-emerald-500" />
                              : <Circle size={20} className="text-slate-300 hover:text-[#22d3ee] transition-colors" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className={`font-semibold text-[13px] ${done ? 'text-slate-400 line-through' : 'text-[#0f172a]'}`}>
                              {ss.title}
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
