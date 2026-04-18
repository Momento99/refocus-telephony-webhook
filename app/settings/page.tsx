'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

/* ========= Inline SVG icons ========= */

const ArrowRightIcon = (props: any) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
    <path
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M5 12h14M13 5l7 7-7 7"
    />
  </svg>
);


const UsersIcon = (props: any) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
    <path strokeWidth="2" d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" strokeWidth="2" />
    <path strokeWidth="2" d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path strokeWidth="2" d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const CpuIcon = (props: any) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
    <rect x="7" y="7" width="10" height="10" rx="2" strokeWidth="2" />
    <path strokeWidth="2" d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4" />
  </svg>
);


const ShieldIcon = (props: any) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
    <path strokeWidth="2" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path strokeWidth="2" d="M9 12l2 2 4-4" />
  </svg>
);

/* на будущее, пусть лежит */
const PayrollIcon = (props: any) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
    <rect x="3" y="4" width="18" height="14" rx="3" strokeWidth="2" />
    <path d="M7 9h10M7 13h6" strokeWidth="2" strokeLinecap="round" />
    <circle cx="17" cy="13" r="1.5" fill="currentColor" />
  </svg>
);


/* ========= Плитка ========= */

function SettingsTile({
  title,
  desc,
  href,
  icon,
  accent,
}: {
  title: string;
  desc: string;
  href: string;
  icon: ReactNode;
  accent: string;
}) {
  return (
    <Link href={href} className="group block h-full">
      <div className="relative h-full rounded-3xl">
        {/* мягкое свечение под карточкой */}
        <div className="pointer-events-none absolute inset-x-6 bottom-0 h-6 rounded-full bg-sky-500/25 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

        {/* сама карточка */}
        <div
          className={[
            'relative h-full overflow-hidden rounded-3xl border border-white/60',
            'bg-[radial-gradient(circle_at_top_left,#ffffff,rgba(239,246,255,0.96))]',
            'shadow-[0_24px_70px_-40px_rgba(15,23,42,1)]',
            'px-5 py-4 sm:px-6 sm:py-5',
            'transition-transform duration-150 group-hover:-translate-y-0.5',
          ].join(' ')}
        >
          {/* цветной слой при ховере */}
          <div
            className={[
              'pointer-events-none absolute inset-0 opacity-0',
              'bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_55%),',
              'radial-gradient(circle_at_bottom_right,rgba(45,212,191,0.16),transparent_55%)]',
              'transition-opacity duration-200 group-hover:opacity-100',
            ].join(' ')}
          />

          <div className="relative flex h-full flex-col justify-between gap-3">
            <div className="flex items-start gap-4">
              <div
                className={[
                  'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white',
                  'shadow-[0_18px_40px_-18px_rgba(15,23,42,0.9)]',
                  accent,
                ].join(' ')}
              >
                {icon}
              </div>

              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-slate-900">
                  {title}
                </div>
                <p className="mt-1 text-xs text-slate-500 sm:text-[13px]">
                  {desc}
                </p>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between text-[11px] font-medium text-slate-400">
              <span className="uppercase tracking-[0.16em]">
                открыть модуль
              </span>
              <ArrowRightIcon className="h-4 w-4 text-slate-300 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-slate-500" />
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

/* ========= Страница настроек ========= */

export default function SettingsHome() {
  return (
    <div className="min-h-full px-4 py-6 sm:px-6 lg:px-10">
      <div className="mx-auto w-full max-w-6xl">
        {/* подсветка фона за контентом, но без рамок-матрёшек */}
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-[-120px] top-[-40px] h-72 w-72 rounded-full bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.35),transparent_65%)] blur-3xl" />
          <div className="absolute right-[-120px] bottom-[-40px] h-80 w-80 rounded-full bg-[radial-gradient(circle_at_center,rgba(129,140,248,0.40),transparent_65%)] blur-3xl" />
        </div>

        {/* Заголовок: теперь его хотя бы видно */}
        <header className="mb-6">
          <div className="inline-flex items-center rounded-full border border-sky-400/50 bg-sky-500/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-100">
            панель управления
          </div>
          <h1 className="mt-3 text-[26px] font-semibold leading-tight text-slate-50 md:text-[30px]">
            Настройки
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Выбери модуль, который нужно настроить: пользователи, интеграции,
            безопасность и правила кассы.
          </p>
        </header>

        {/* Сетка модулей */}
        <section>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <SettingsTile
              title="Пользователи и роли"
              desc="Владелец, менеджеры, продавцы. Права доступа и видимость разделов."
              href="/settings/users"
              icon={<UsersIcon className="h-6 w-6" />}
              accent="bg-gradient-to-br from-fuchsia-500 to-violet-500"
            />

            <SettingsTile
              title="Интеграции"
              desc="Касса/эквайринг, QR, мессенджеры, web-hook-и и статус подключения."
              href="/settings/integrations"
              icon={<CpuIcon className="h-6 w-6" />}
              accent="bg-gradient-to-br from-emerald-500 to-sky-400"
            />

            <SettingsTile
              title="Безопасность"
              desc="Пароли, сессии, выход на всех устройствах, журнал входов и действий."
              href="/settings/security"
              icon={<ShieldIcon className="h-6 w-6" />}
              accent="bg-gradient-to-br from-amber-400 to-orange-500"
            />

          </div>
        </section>
      </div>
    </div>
  );
}
