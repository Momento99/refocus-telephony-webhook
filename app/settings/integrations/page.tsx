'use client';

import Link from 'next/link';
import Script from 'next/script';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

declare global {
  interface Window {
    zadarmaWidgetFn?: (
      webrtcKey: string,
      sipLogin: string,
      shape: 'square' | 'rounded',
      lang: string,
      isHidden: boolean,
      pos: { right?: string; left?: string; top?: string; bottom?: string }
    ) => void;
  }
}

export default function IntegrationsIndex() {
  // SIP (внутренний номер/логин) лучше хранить в env как NEXT_PUBLIC_ZADARMA_SIP
  const sipFromEnv = useMemo(() => process.env.NEXT_PUBLIC_ZADARMA_SIP ?? '', []);
  const [sip, setSip] = useState<string>(sipFromEnv);

  const [webrtcKey, setWebrtcKey] = useState<string>('');
  const [scriptsReady, setScriptsReady] = useState(false);
  const initOnceRef = useRef(false);

  const tryInit = useCallback(() => {
    if (initOnceRef.current) return;
    if (!scriptsReady) return;
    if (!window.zadarmaWidgetFn) return;
    if (!sip) return;
    if (!webrtcKey) return;

    initOnceRef.current = true;

    window.zadarmaWidgetFn(
      webrtcKey,
      sip,
      'square',
      'ru',
      true, // hidden by default (как у Zadarma в примере)
      { right: '10px', bottom: '5px' }
    );
  }, [scriptsReady, sip, webrtcKey]);

  // 1) Получаем WebRTC key с сервера
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const r = await fetch('/api/zadarma/webrtc-key', { cache: 'no-store' });
        const data = await r.json();

        if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);

        if (cancelled) return;

        if (typeof data?.key === 'string') setWebrtcKey(data.key);
        if (typeof data?.sip === 'string' && data.sip) setSip(data.sip);
      } catch (e) {
        // Виджет не инициализируем, пока нет ключа/ошибка API
        console.error('[Zadarma] failed to fetch webrtc key:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 2) Когда ключ + скрипты готовы — инициализируем
  useEffect(() => {
    tryInit();
  }, [tryInit]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Скрипты Zadarma */}
      <Script
        src="https://my.zadarma.com/webphoneWebRTCWidget/v9/js/loader-phone-lib.js?sub_v=1"
        strategy="afterInteractive"
      />
      <Script
        src="https://my.zadarma.com/webphoneWebRTCWidget/v9/js/loader-phone-fn.js?sub_v=1"
        strategy="afterInteractive"
        onLoad={() => setScriptsReady(true)}
      />

      <h1 className="text-2xl font-bold mb-2">Интеграции</h1>
      <p className="text-slate-600 mb-6">
        Подключение внешних сервисов для Refocus: платежи, уведомления, печать и хранение ключей.
        Доступно только админам.
      </p>

      {/* Небольшая подсказка по статусу */}
      <div className="rounded-xl border border-slate-200/60 bg-white/70 p-4 mb-6 text-sm text-slate-700">
        <div className="font-semibold mb-1">Zadarma WebRTC</div>
        <div>Скрипты: {scriptsReady ? 'загружены' : 'загружаются…'}</div>
        <div>WEBRTC key: {webrtcKey ? 'получен' : 'нет (проверь /api/zadarma/webrtc-key)'}</div>
        <div>SIP: {sip ? sip : 'не задан (NEXT_PUBLIC_ZADARMA_SIP)'}</div>
      </div>

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
          title="WhatsApp Business (Cloud API)"
          desc="Сервисные сообщения через Meta Cloud API: креды, шаблоны, webhook."
          href="/settings/integrations/whatsapp"
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
