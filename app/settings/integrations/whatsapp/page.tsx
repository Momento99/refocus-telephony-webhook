'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  MessageCircle,
  CheckCircle2,
  CircleDashed,
  Copy,
  RefreshCw,
  Save,
  Loader2,
  Link2,
  Power,
} from 'lucide-react';

type Config = {
  id: number;
  waba_id: string | null;
  phone_number_id: string | null;
  business_phone: string | null;
  display_name: string | null;
  webhook_verify_token: string | null;
  is_active: boolean;
  customer_messaging_enabled: boolean;
  has_access_token: boolean;
  updated_at: string;
};

// Шаблон day 3 — «Как ваши очки?» (адаптация). Уже APPROVED в Meta.
const TEMPLATE_NAME = 'aftercare_day3_generic_ru';
const TEMPLATE_CATEGORY = 'UTILITY';
const TEMPLATE_LANGUAGE = 'Russian (ru)';
const TEMPLATE_BODY = `Здравствуйте, {{1}}! Это Refocus, {{2}}.

Как ваши новые очки — всё ли удобно, нет ли дискомфорта?

Если что-то беспокоит по зрению, посадке или ощущениям — просто ответьте на это сообщение, продавец поможет.

Хорошего дня!`;

const TEMPLATE_SAMPLE_1 = 'Алексей';
const TEMPLATE_SAMPLE_2 = 'Токмок';

// Шаблон day 12 — напоминание о праве на адаптационную замену
const DAY12_TEMPLATE_NAME = 'aftercare_day12_guarantee_ru';
const DAY12_TEMPLATE_CATEGORY = 'UTILITY';
const DAY12_TEMPLATE_LANGUAGE = 'Russian (ru)';
const DAY12_TEMPLATE_BODY = `Здравствуйте! Через 2 дня у вас заканчивается 14-дневная гарантия адаптации на очки. Если что-то всё-таки не подошло — стиль, посадка, ощущение — можем бесплатно поменять оправу и линзы в той же ценовой категории. Просто заходите без записи. А если всё хорошо — носите на здоровье.`;

// Шаблон «очки готовы»
const READY_TEMPLATE_NAME = 'order_ready_ru';
const READY_TEMPLATE_CATEGORY = 'UTILITY';
const READY_TEMPLATE_LANGUAGE = 'Russian (ru)';
const READY_TEMPLATE_BODY = `Здравствуйте, {{1}}! Ваши очки готовы.

Забрать можно в Refocus, {{2}}.
Часы работы: {{3}}.
К доплате при получении: {{4}}.

Будем ждать!`;

const READY_SAMPLE_1 = 'Алексей';
const READY_SAMPLE_2 = 'Беловодск';
const READY_SAMPLE_3 = 'Пн–Сб 09:00–17:00, Вс выходной';
const READY_SAMPLE_4 = '2 500 с';

export default function WhatsAppIntegrationPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);
  const [togglingMessaging, setTogglingMessaging] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);

  const [wabaId, setWabaId] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [messagingEnabled, setMessagingEnabled] = useState(false);

  const canToggle = !!config?.has_access_token && !!config?.waba_id && !!config?.phone_number_id;

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/admin/whatsapp/config', { cache: 'no-store' });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e.error || `HTTP ${r.status}`);
        }
        const data = await r.json();
        const c: Config | null = data.config ?? null;
        setConfig(c);
        if (c) {
          setWabaId(c.waba_id ?? '');
          setPhoneNumberId(c.phone_number_id ?? '');
          setBusinessPhone(c.business_phone ?? '');
          setDisplayName(c.display_name ?? '');
          setVerifyToken(c.webhook_verify_token ?? '');
          setIsActive(c.is_active);
          setMessagingEnabled(!!c.customer_messaging_enabled);
        }
      } catch (e: any) {
        toast.error(e?.message || 'Не удалось загрузить конфигурацию');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        waba_id: wabaId,
        phone_number_id: phoneNumberId,
        business_phone: businessPhone,
        display_name: displayName,
        webhook_verify_token: verifyToken,
        is_active: isActive,
      };
      if (accessToken.trim()) body.access_token = accessToken.trim();

      const r = await fetch('/api/admin/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      toast.success('Сохранено');
      setAccessToken('');
      const refresh = await fetch('/api/admin/whatsapp/config', { cache: 'no-store' });
      if (refresh.ok) {
        const data = await refresh.json();
        setConfig(data.config ?? null);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(next: boolean) {
    if (togglingActive) return;
    if (!canToggle) {
      toast.error('Сначала заполните WABA ID, Phone Number ID и токен');
      return;
    }
    setTogglingActive(true);
    const prev = isActive;
    setIsActive(next);
    try {
      const r = await fetch('/api/admin/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: next }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      toast.success(next ? 'Интеграция включена' : 'Интеграция выключена');
      const refresh = await fetch('/api/admin/whatsapp/config', { cache: 'no-store' });
      if (refresh.ok) {
        const data = await refresh.json();
        setConfig(data.config ?? null);
      }
    } catch (e: any) {
      setIsActive(prev);
      toast.error(e?.message || 'Не удалось переключить');
    } finally {
      setTogglingActive(false);
    }
  }

  async function toggleMessaging(next: boolean) {
    if (togglingMessaging) return;
    setTogglingMessaging(true);
    const prev = messagingEnabled;
    setMessagingEnabled(next);
    try {
      const r = await fetch('/api/admin/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_messaging_enabled: next }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      toast.success(next ? 'Автоматические сообщения включены' : 'Автоматические сообщения выключены');
      const refresh = await fetch('/api/admin/whatsapp/config', { cache: 'no-store' });
      if (refresh.ok) {
        const data = await refresh.json();
        setConfig(data.config ?? null);
      }
    } catch (e: any) {
      setMessagingEnabled(prev);
      toast.error(e?.message || 'Не удалось переключить');
    } finally {
      setTogglingMessaging(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Скопировано');
    } catch {
      toast.error('Не удалось скопировать');
    }
  }

  return (
    <div className="text-slate-50">
      {/* Header (бренд-стандарт) */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
            <MessageCircle className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-50">WhatsApp Business</div>
            <div className="mt-0.5 text-[12px] text-cyan-300/50">
              Сервисные сообщения через Meta Cloud API
            </div>
          </div>
        </div>

        {config?.is_active ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[12px] font-semibold text-emerald-400 ring-1 ring-emerald-400/20">
            <CheckCircle2 className="h-4 w-4" />
            Интеграция активна
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-500/10 px-3 py-1.5 text-[12px] font-semibold text-slate-400 ring-1 ring-slate-400/20">
            <CircleDashed className="h-4 w-4" />
            Не активна
          </span>
        )}
      </div>

      {loading ? (
        <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-6 text-sm text-slate-500 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-cyan-500" />
          <div className="text-center">Загрузка…</div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Главный переключатель */}
          <section
            className={`rounded-2xl p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)] ring-1 transition ${
              isActive
                ? 'bg-gradient-to-r from-emerald-50 to-teal-50 ring-emerald-200'
                : 'bg-white ring-sky-100'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div
                  className={`grid h-11 w-11 place-items-center rounded-2xl transition ${
                    isActive
                      ? 'bg-emerald-500 shadow-[0_4px_20px_rgba(16,185,129,0.45)]'
                      : 'bg-slate-300 shadow-[0_4px_20px_rgba(148,163,184,0.25)]'
                  }`}
                >
                  <Power className="h-5 w-5 text-white" />
                </div>
                <div>
                  <div className="text-base font-semibold text-slate-900">
                    {isActive ? 'Отправка включена' : 'Отправка выключена'}
                  </div>
                  <div className="mt-0.5 text-[12px] text-slate-600 max-w-md">
                    {isActive
                      ? 'Шедулер отправляет aftercare-сообщения через 3 дня после DELIVERED всем клиентам с согласием. Real customers.'
                      : canToggle
                      ? 'Включите, чтобы шедулер начал отправлять реальные сообщения клиентам через 3 дня после выдачи очков.'
                      : 'Заполните WABA ID, Phone Number ID и токен ниже, чтобы разрешить включение.'}
                  </div>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={isActive}
                onClick={() => toggleActive(!isActive)}
                disabled={!canToggle || togglingActive}
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition focus:outline-none focus:ring-2 focus:ring-cyan-400/70 ${
                  isActive ? 'bg-emerald-500' : 'bg-slate-300'
                } ${!canToggle || togglingActive ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    isActive ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
                {togglingActive && (
                  <Loader2 className="absolute inset-0 m-auto h-3.5 w-3.5 animate-spin text-white" />
                )}
              </button>
            </div>
          </section>

          {/* Главный мастер-выключатель автоматических сообщений клиентам */}
          <section
            className={`rounded-2xl p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)] ring-1 transition ${
              messagingEnabled
                ? 'bg-gradient-to-r from-cyan-50 to-sky-50 ring-cyan-200'
                : 'bg-white ring-amber-200'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div
                  className={`grid h-11 w-11 place-items-center rounded-2xl transition ${
                    messagingEnabled
                      ? 'bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.45)]'
                      : 'bg-amber-400 shadow-[0_4px_20px_rgba(251,191,36,0.40)]'
                  }`}
                >
                  <MessageCircle className="h-5 w-5 text-white" />
                </div>
                <div>
                  <div className="text-base font-semibold text-slate-900">
                    Автоматические сообщения клиентам — {messagingEnabled ? 'ВКЛЮЧЕНЫ' : 'ВЫКЛЮЧЕНЫ'}
                  </div>
                  <div className="mt-1 text-[12px] text-slate-700 max-w-xl leading-relaxed">
                    Один мастер-выключатель для трёх автоматических сообщений:
                    <ul className="mt-1 list-disc pl-5 space-y-0.5">
                      <li><strong>«Очки готовы»</strong> — при переходе заказа в статус READY;</li>
                      <li><strong>День 3 — «Как ваши очки?»</strong> — через 3 дня после выдачи;</li>
                      <li><strong>День 12 — напоминание о гарантии</strong> — за 2 дня до конца адаптационной гарантии.</li>
                    </ul>
                    {messagingEnabled
                      ? <span className="mt-2 inline-block text-cyan-700 font-medium">Все три сценария отправляются автоматически. Реальным клиентам.</span>
                      : <span className="mt-2 inline-block text-amber-700 font-medium">Ничего не отправляется. Очередь не наполняется. Включи когда Токмок готов начать сервис.</span>
                    }
                  </div>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={messagingEnabled}
                onClick={() => toggleMessaging(!messagingEnabled)}
                disabled={togglingMessaging}
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition focus:outline-none focus:ring-2 focus:ring-cyan-400/70 ${
                  messagingEnabled ? 'bg-cyan-500' : 'bg-amber-400'
                } ${togglingMessaging ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    messagingEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
                {togglingMessaging && (
                  <Loader2 className="absolute inset-0 m-auto h-3.5 w-3.5 animate-spin text-white" />
                )}
              </button>
            </div>
          </section>

          {/* Учётные данные Meta */}
          <section className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] p-5 space-y-4">
            <div className="text-base font-semibold text-slate-900">Учётные данные Meta</div>

            <Field label="WABA ID (WhatsApp Business Account ID)">
              <Input value={wabaId} onChange={(e) => setWabaId(e.target.value)} placeholder="напр. 1234567890123456" />
            </Field>

            <Field label="Phone Number ID">
              <Input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} placeholder="напр. 1098765432109876" />
            </Field>

            <Field label="Business Phone">
              <Input value={businessPhone} onChange={(e) => setBusinessPhone(e.target.value)} placeholder="+996705244966" />
            </Field>

            <Field label="Display Name">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Refocus" />
            </Field>

            <Field
              label="Permanent Access Token"
              hint={
                config?.has_access_token
                  ? '✓ Токен сохранён. Оставьте поле пустым, чтобы не менять. Введите новое значение, чтобы перезаписать.'
                  : 'Токен не задан. Сгенерируйте в Meta for Developers → System Users.'
              }
            >
              <Input
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={config?.has_access_token ? '••••••••••••••••' : 'EAAG...'}
                autoComplete="off"
              />
            </Field>

            <Field
              label="Webhook Verify Token"
              hint="Любая случайная строка. Понадобится при настройке вебхука в Meta Dashboard."
            >
              <div className="flex gap-2">
                <Input
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  placeholder="refocus_wa_verify_2026"
                />
                <button
                  type="button"
                  onClick={() => setVerifyToken(`refocus_wa_${Math.random().toString(36).slice(2, 14)}`)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  Сгенерировать
                </button>
              </div>
            </Field>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-300/70 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </button>
              {config?.updated_at && (
                <span className="text-[11px] text-slate-500">
                  Обновлено: {new Date(config.updated_at).toLocaleString('ru-RU')}
                </span>
              )}
            </div>
          </section>

          {/* Шаблон 1: follow-up через 3 дня — «Как ваши очки?» */}
          <section className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] p-5 space-y-4">
            <div>
              <div className="text-base font-semibold text-slate-900">Шаблон 1 · Follow-up день 3 — «Как ваши очки?»</div>
              <p className="mt-1 text-[12px] text-slate-500">
                Отправляется автоматически клиентам, у которых ровно 3 дня назад был выдан заказ.
                Дедуплицируется по (клиент + дата выдачи): несколько пар, выданных в один день, дают одно сообщение.
                Уже одобрен Meta — этот шаблон трогать не нужно.
              </p>
            </div>

            <div className="rounded-xl bg-slate-50/60 ring-1 ring-sky-100 p-4 space-y-3 text-sm">
              <Row label="Name" value={TEMPLATE_NAME} onCopy={() => copy(TEMPLATE_NAME)} />
              <Row label="Category" value={TEMPLATE_CATEGORY} />
              <Row label="Language" value={TEMPLATE_LANGUAGE} />
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Body</div>
                <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800 bg-white rounded-lg ring-1 ring-sky-100 p-3">
{TEMPLATE_BODY}
                </pre>
                <button
                  onClick={() => copy(TEMPLATE_BODY)}
                  className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-cyan-700 hover:text-cyan-800 transition"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Скопировать body
                </button>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                  Переменные шаблона
                </div>
                <div className="text-slate-700 space-y-0.5 text-[13px]">
                  <div>{'{{1}}'} → имя клиента (пример: <span className="font-mono text-slate-900">{TEMPLATE_SAMPLE_1}</span>)</div>
                  <div>{'{{2}}'} → название филиала (пример: <span className="font-mono text-slate-900">{TEMPLATE_SAMPLE_2}</span>)</div>
                </div>
              </div>
            </div>
          </section>

          {/* Шаблон 2: follow-up день 12 — напоминание о гарантии */}
          <section className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] p-5 space-y-4">
            <div>
              <div className="text-base font-semibold text-slate-900">Шаблон 2 · Follow-up день 12 — напоминание о гарантии</div>
              <p className="mt-1 text-[12px] text-slate-500">
                Отправляется автоматически клиентам, у которых ровно 12 дней назад был выдан заказ
                (за 2 дня до окончания 14-дневной адаптационной гарантии). Та же дедупликация: одно сообщение на (клиент + дата выдачи).
              </p>
            </div>

            <div className="rounded-xl bg-slate-50/60 ring-1 ring-sky-100 p-4 space-y-3 text-sm">
              <Row label="Name" value={DAY12_TEMPLATE_NAME} onCopy={() => copy(DAY12_TEMPLATE_NAME)} />
              <Row label="Category" value={DAY12_TEMPLATE_CATEGORY} />
              <Row label="Language" value={DAY12_TEMPLATE_LANGUAGE} />
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Body</div>
                <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800 bg-white rounded-lg ring-1 ring-sky-100 p-3">
{DAY12_TEMPLATE_BODY}
                </pre>
                <button
                  onClick={() => copy(DAY12_TEMPLATE_BODY)}
                  className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-cyan-700 hover:text-cyan-800 transition"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Скопировать body
                </button>
              </div>
              <div className="text-[12px] text-slate-500">
                Без переменных — Sample values при подаче в Мету не нужны.
              </div>
            </div>
          </section>

          {/* Шаблон 3: очки готовы */}
          <section className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] p-5 space-y-4">
            <div>
              <div className="text-base font-semibold text-slate-900">Шаблон 3 · «Очки готовы»</div>
              <p className="mt-1 text-[12px] text-slate-500">
                Отправляется сразу при переходе заказа в READY, если продавец отметил канал «WhatsApp» в new-order.
              </p>
            </div>

            <div className="rounded-xl bg-slate-50/60 ring-1 ring-sky-100 p-4 space-y-3 text-sm">
              <Row label="Name" value={READY_TEMPLATE_NAME} onCopy={() => copy(READY_TEMPLATE_NAME)} />
              <Row label="Category" value={READY_TEMPLATE_CATEGORY} />
              <Row label="Language" value={READY_TEMPLATE_LANGUAGE} />
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Body</div>
                <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800 bg-white rounded-lg ring-1 ring-sky-100 p-3">
{READY_TEMPLATE_BODY}
                </pre>
                <button
                  onClick={() => copy(READY_TEMPLATE_BODY)}
                  className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-cyan-700 hover:text-cyan-800 transition"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Скопировать body
                </button>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                  Sample values (для Меты)
                </div>
                <div className="text-slate-700 space-y-0.5 text-[13px]">
                  <div>{'{{1}}'} → <span className="font-mono text-slate-900">{READY_SAMPLE_1}</span></div>
                  <div>{'{{2}}'} → <span className="font-mono text-slate-900">{READY_SAMPLE_2}</span></div>
                  <div>{'{{3}}'} → <span className="font-mono text-slate-900">{READY_SAMPLE_3}</span></div>
                  <div>{'{{4}}'} → <span className="font-mono text-slate-900">{READY_SAMPLE_4}</span></div>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 text-[12px] text-amber-800 leading-relaxed">
              <span className="font-semibold">Советы при подаче:</span> категория обязательно{' '}
              <span className="font-mono">UTILITY</span>, не <span className="font-mono">MARKETING</span> —
              иначе отклонят. Sample values подставьте реальные примеры, иначе Мета не примет форму. Апрув обычно 1–3 дня.
            </div>
          </section>

          {/* Webhook URL */}
          <section className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-cyan-600" />
              <div className="text-base font-semibold text-slate-900">Webhook URL</div>
            </div>
            <p className="text-[12px] text-slate-500">
              В настройках вебхука в Meta укажите этот URL (подключим, когда появится токен):
            </p>
            <div className="rounded-xl bg-slate-50/60 ring-1 ring-sky-100 p-3 font-mono text-sm text-slate-800 break-all">
              https://<span className="text-slate-400">ваш-домен</span>/api/whatsapp/webhook
            </div>
            <p className="text-[11px] text-slate-500">
              Verify Token для подтверждения вебхука — тот, что задан выше в форме.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      {children}
      {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 ${props.className ?? ''}`}
    />
  );
}

function Row({ label, value, onCopy }: { label: string; value: string; onCopy?: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="flex-1 break-all font-mono text-[13px] text-slate-900">{value}</div>
      {onCopy && (
        <button
          onClick={onCopy}
          className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-cyan-700 hover:text-cyan-800 transition"
        >
          <Copy className="h-3.5 w-3.5" />
          Копировать
        </button>
      )}
    </div>
  );
}
