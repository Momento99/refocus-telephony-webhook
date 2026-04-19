'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Brain, BookOpen, Building2, Bot, MessageCircleHeart, ShieldAlert } from 'lucide-react';

const TABS = [
  { href: '/admin/ai-employee-messages',               label: 'AI контроль',         icon: Bot },
  { href: '/admin/ai-employee-messages/advisor',       label: 'Бизнес-советник',     icon: Brain },
  { href: '/admin/ai-employee-messages/branch-notes',  label: 'Заметки по филиалам', icon: Building2 },
  { href: '/admin/ai-employee-messages/feedback',      label: 'Фидбэк сотрудников',  icon: MessageCircleHeart },
  { href: '/admin/ai-employee-messages/library',       label: 'Библиотека',          icon: BookOpen },
  { href: '/settings/service-qa',                      label: 'Контроль сервиса',    icon: ShieldAlert },
] as const;

function classNames(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(' ');
}

export default function AICenterTabs() {
  const pathname = usePathname() || '';

  return (
    <nav className="mb-5 flex gap-1 rounded-2xl bg-white p-1 ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] overflow-x-auto w-fit max-w-full">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const active = pathname === tab.href || (tab.href !== '/admin/ai-employee-messages' && pathname.startsWith(tab.href));
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={classNames(
              'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold whitespace-nowrap transition',
              active
                ? 'bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50',
            )}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
