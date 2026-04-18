'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Brain, MessageSquare, BookOpen, Building2, Bot, MessageCircleHeart } from 'lucide-react';

const TABS = [
  { href: '/admin/ai-employee-messages',               label: 'AI контроль',         icon: Bot },
  { href: '/admin/ai-employee-messages/advisor',       label: 'Бизнес-советник',     icon: Brain },
  { href: '/admin/ai-employee-messages/branch-notes',  label: 'Заметки по филиалам', icon: Building2 },
  { href: '/admin/ai-employee-messages/feedback',      label: 'Фидбэк сотрудников',  icon: MessageCircleHeart },
  { href: '/admin/ai-employee-messages/library',       label: 'Библиотека',          icon: BookOpen },
] as const;

function classNames(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(' ');
}

export default function AICenterTabs() {
  const pathname = usePathname() || '';

  return (
    <nav className="flex gap-1 rounded-2xl bg-white/95 p-1.5 ring-1 ring-slate-200/80 shadow-sm backdrop-blur-xl overflow-x-auto">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const active = pathname === tab.href || (tab.href !== '/admin/ai-employee-messages' && pathname.startsWith(tab.href));
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={classNames(
              'inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium whitespace-nowrap transition',
              active
                ? 'bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_8px_20px_rgba(14,165,233,0.25)]'
                : 'text-slate-600 hover:bg-slate-100',
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
