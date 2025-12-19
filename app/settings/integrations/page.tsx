'use client';

import Link from 'next/link';

type CardProps = { title: string; desc: string; href: string };

function Card({ title, desc, href }: CardProps) {
  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white/80 shadow-sm hover:shadow-md transition p-5">
      <div className="text-lg font-semibold mb-1">{title}</div>
      <div className="text-slate-600 text-sm mb-4">{desc}</div>
      <Link
        href={href}
        className="inline-flex items-center rounded-xl px-4 py-2 bg-blue-600 text-white text-sm hover:bg-blue-700 transition"
      >
        Открыть <span className="ml-2">→</span>
      </Link>
    </div>
  );
}

export default function IntegrationsIndex() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Интеграции</h1>
      <p className="text-slate-600 mb-6">
        Подключение внешних сервисов для Refocus: платежи, уведомления, печать и хранение ключей.
        Доступно только админам.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card
          title="Платежи"
          desc="Эквайринг (терминалы) и QR-оплата. Провайдер, ключи, статусы."
          href="/settings/integrations/payments"
        />
        <Card
          title="Мессенджеры"
          desc="WhatsApp/Telegram. Шаблоны: принят, готов, напоминание."
          href="/settings/integrations/messengers"
        />
        <Card
          title="Принтеры и чеки"
          desc="Настройка печати чеков/наклеек. Лого, QR статуса заказа."
          href="/settings/integrations/printers"
        />
        <Card
          title="API и ключи"
          desc="Хранение и проверка подключений. Логи изменений."
          href="/settings/integrations/keys"
        />
      </div>
    </div>
  );
}
