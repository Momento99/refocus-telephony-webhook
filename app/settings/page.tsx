'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Settings2, Users, MessageCircle, ShieldCheck, ChevronRight } from 'lucide-react';

const InstagramIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);

function SettingsTile({
  title,
  desc,
  href,
  icon,
}: {
  title: string;
  desc: string;
  href: string;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] px-5 py-4 transition hover:ring-cyan-300/40"
    >
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.28)]">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-slate-900">{title}</div>
        <div className="mt-0.5 text-[12px] text-slate-500">{desc}</div>
      </div>
      <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-cyan-500 transition-colors" />
    </Link>
  );
}

export default function SettingsHome() {
  return (
    <div className="text-slate-50">
      {/* Header (бренд-стандарт) */}
      <div className="mb-6 flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
          <Settings2 className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-2xl font-bold tracking-tight text-slate-50">Настройки</div>
          <div className="mt-0.5 text-[12px] text-cyan-300/50">
            Пользователи, интеграции и правила безопасности
          </div>
        </div>
      </div>

      {/* Сетка модулей */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SettingsTile
          title="Пользователи и роли"
          desc="Владелец, менеджеры, продавцы. Права доступа и видимость разделов."
          href="/settings/users"
          icon={<Users className="h-5 w-5 text-white" />}
        />

        <SettingsTile
          title="WhatsApp Business"
          desc="Meta Cloud API: креды, шаблоны сообщений и webhook для сервисных уведомлений."
          href="/settings/integrations/whatsapp"
          icon={<MessageCircle className="h-5 w-5 text-white" />}
        />

        <SettingsTile
          title="Instagram Direct"
          desc="Meta Graph API: переписка с клиентами из Instagram прямо в POS-инбоксе."
          href="/settings/integrations/instagram"
          icon={<InstagramIcon className="h-5 w-5 text-white" />}
        />

        <SettingsTile
          title="Безопасность"
          desc="Пароли, сессии, выход на всех устройствах, журнал входов и действий."
          href="/settings/security"
          icon={<ShieldCheck className="h-5 w-5 text-white" />}
        />
      </div>
    </div>
  );
}
