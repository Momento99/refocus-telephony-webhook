'use client';

import React from 'react';
import Link from 'next/link';
import AICenterTabs from './AICenterTabs';
import { Bot, Trophy, Brain, Building2, MessageCircleHeart, BookOpen, ShieldAlert, ArrowRight } from 'lucide-react';

/* AI-центр — чистый минималистичный хаб: видно, что есть и куда нажимать.
   Главный акцент — «Субботний разбор». */

const TOOLS: Array<{ href: string; icon: React.ComponentType<{ className?: string }>; title: string; desc: string }> = [
  { href: '/admin/ai-employee-messages/advisor',      icon: Brain,              title: 'Бизнес-советник',     desc: 'Спросить ИИ по реальным цифрам сети.' },
  { href: '/admin/ai-employee-messages/branch-notes', icon: Building2,          title: 'Заметки по филиалам', desc: 'Контекст филиалов для ИИ (расположение, конкуренты).' },
  { href: '/admin/ai-employee-messages/feedback',     icon: MessageCircleHeart, title: 'Фидбэк сотрудников',  desc: 'Голосовой фидбэк со смен и дайджест.' },
  { href: '/admin/ai-employee-messages/library',      icon: BookOpen,           title: 'Библиотека',          desc: 'База знаний для бизнес-советника.' },
  { href: '/settings/service-qa',                     icon: ShieldAlert,        title: 'Контроль сервиса',    desc: 'Оценка качества обслуживания.' },
];

export default function AICenterPage() {
  return (
    <div className="text-slate-50">
      {/* header */}
      <div className="mb-6 flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
          <Bot className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-2xl font-bold tracking-tight text-slate-50">AI-центр</div>
          <div className="mt-0.5 text-[12px] text-cyan-300/50">Инструменты на базе ИИ — выберите, что открыть</div>
        </div>
      </div>

      <AICenterTabs />

      {/* главный акцент */}
      <Link
        href="/admin/ai-employee-messages/weekly-recap"
        className="group mb-4 flex items-center gap-4 rounded-2xl bg-white p-5 ring-2 ring-cyan-300 shadow-[0_8px_30px_rgba(15,23,42,0.45)] transition hover:ring-cyan-400"
      >
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-cyan-500 text-white shadow-[0_4px_16px_rgba(34,211,238,0.4)]">
          <Trophy className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-bold text-slate-900">Отчёты на кассу</span>
            <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-700 ring-1 ring-cyan-200">начните здесь</span>
          </div>
          <div className="mt-0.5 text-[13px] text-slate-600">Разбор каждому продавцу → показ на кассе при открытии смены → ответы продавцов видны здесь.</div>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 text-cyan-500 transition group-hover:translate-x-0.5" />
      </Link>

      {/* остальные инструменты */}
      <div className="grid gap-3 sm:grid-cols-2">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className="group flex items-start gap-3 rounded-2xl bg-white p-4 ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] transition hover:ring-sky-200"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cyan-50 text-cyan-600 ring-1 ring-cyan-200">
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold text-slate-900">{t.title}</div>
                <div className="mt-0.5 text-[12px] text-slate-500">{t.desc}</div>
              </div>
              <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-cyan-500" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
