'use client';

import React, { useState } from 'react';
import { Smartphone, BarChart3, Bell } from 'lucide-react';
import OverviewTab from './OverviewTab';
import NotificationsTab from './NotificationsTab';

type Tab = 'overview' | 'notifications';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Обзор', icon: BarChart3 },
  { id: 'notifications', label: 'Уведомления', icon: Bell },
];

export default function MobileAppPage() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="text-slate-50">
      {/* Header (бренд-стандарт) */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
            <Smartphone className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-50">Мобильное приложение</div>
            <div className="mt-0.5 text-[12px] text-cyan-300/50">Скачивания, пользователи и push-уведомления</div>
          </div>
        </div>

        {/* Сегментные вкладки */}
        <div className="inline-flex rounded-xl bg-slate-800/60 p-1 ring-1 ring-slate-700/60">
          {TABS.map((t) => {
            const active = tab === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={
                  'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ' +
                  (active
                    ? 'bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
                    : 'text-slate-300 hover:bg-slate-700/50')
                }
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'overview' ? <OverviewTab /> : <NotificationsTab />}
    </div>
  );
}
