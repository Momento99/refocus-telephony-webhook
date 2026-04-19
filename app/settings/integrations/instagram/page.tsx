'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Instagram,
  CheckCircle2,
  CircleDashed,
  RefreshCw,
  Save,
  Loader2,
  Link2,
  Power,
} from 'lucide-react';

type Config = {
  id: number;
  ig_business_account_id: string | null;
  fb_page_id: string | null;
  display_name: string | null;
  webhook_verify_token: string | null;
  is_active: boolean;
  has_page_access_token: boolean;
  has_app_secret: boolean;
  updated_at: string;
};

export default function InstagramIntegrationPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);

  const [igBusinessAccountId, setIgBusinessAccountId] = useState('');
  const [fbPageId, setFbPageId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [pageAccessToken, setPageAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [isActive, setIsActive] = useState(false);

  const canToggle = !!config?.has_page_access_token && !!config?.ig_business_account_id;

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/admin/instagram/config', { cache: 'no-store' });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e.error || `HTTP ${r.status}`);
        }
        const data = await r.json();
        const c: Config | null = data.config ?? null;
        setConfig(c);
        if (c) {
          setIgBusinessAccountId(c.ig_business_account_id ?? '');
          setFbPageId(c.fb_page_id ?? '');
          setDisplayName(c.display_name ?? '');
          setVerifyToken(c.webhook_verify_token ?? '');
          setIsActive(c.is_active);
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
        ig_business_account_id: igBusinessAccountId,
        fb_page_id: fbPageId,
        display_name: displayName,
        webhook_verify_token: verifyToken,
        is_active: isActive,
      };
      if (pageAccessToken.trim()) body.page_access_token = pageAccessToken.trim();
      if (appSecret.trim()) body.app_secret = appSecret.trim();

      const r = await fetch('/api/admin/instagram/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      toast.success('Сохранено');
      setPageAccessToken('');
      setAppSecret('');
      const refresh = await fetch('/api/admin/instagram/config', { cache: 'no-store' });
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
      toast.error('Сначала заполните Instagram Business Account ID и Page Access Token');
      return;
    }
    setTogglingActive(true);
    const prev = isActive;
    setIsActive(next);
    try {
      const r = await fetch('/api/admin/instagram/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: next }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      toast.success(next ? 'Интеграция включена' : 'Интеграция выключена');
      const refresh = await fetch('/api/admin/instagram/config', { cache: 'no-store' });
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

  return (
    <div className="text-slate-50">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
            <Instagram className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-50">Instagram Direct</div>
            <div className="mt-0.5 text-[12px] text-cyan-300/50">
              Переписка с клиентами через Meta Graph API
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
                      ? 'Ответы продавцов из POS уходят клиенту в Instagram Direct через Graph API.'
                      : canToggle
                        ? 'Включите, чтобы ответы из POS-инбокса уходили в Instagram через Graph API.'
                        : 'Заполните Instagram Business Account ID и Page Access Token ниже, чтобы разрешить включение.'}
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

          <section className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] p-5 space-y-4">
            <div className="text-base font-semibold text-slate-900">Учётные данные Meta</div>

            <Field label="Instagram Business Account ID" hint="Числовой ID бизнес-аккаунта Instagram. Берётся из Graph API Explorer → /me/accounts → ваша Page → instagram_business_account.id">
              <Input
                value={igBusinessAccountId}
                onChange={(e) => setIgBusinessAccountId(e.target.value)}
                placeholder="напр. 17841400123456789"
              />
            </Field>

            <Field label="Facebook Page ID" hint="ID Business Page, к которой привязан Instagram. Обязательно Business Page, не personal profile.">
              <Input
                value={fbPageId}
                onChange={(e) => setFbPageId(e.target.value)}
                placeholder="напр. 615721387361619"
              />
            </Field>

            <Field label="Display Name">
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Refocus"
              />
            </Field>

            <Field
              label="Page Access Token (long-lived)"
              hint={
                config?.has_page_access_token
                  ? '✓ Токен сохранён. Оставьте поле пустым, чтобы не менять. Введите новое значение, чтобы перезаписать.'
                  : 'Токен страницы с правами instagram_manage_messages. Сгенерируйте через Meta for Developers → System Users или Graph API Explorer.'
              }
            >
              <Input
                type="password"
                value={pageAccessToken}
                onChange={(e) => setPageAccessToken(e.target.value)}
                placeholder={config?.has_page_access_token ? '••••••••••••••••' : 'EAAG...'}
                autoComplete="off"
              />
            </Field>

            <Field
              label="App Secret"
              hint={
                config?.has_app_secret
                  ? '✓ App Secret сохранён. Используется для проверки подписи Meta webhook. Оставьте пустым, чтобы не менять.'
                  : 'App Secret вашего Meta App. Нужен для HMAC-валидации webhook-запросов. Без него webhook будет принимать любые запросы.'
              }
            >
              <Input
                type="password"
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                placeholder={config?.has_app_secret ? '••••••••••••••••' : 'напр. 1a2b3c...'}
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
                  placeholder="refocus_ig_verify_2026"
                />
                <button
                  type="button"
                  onClick={() => setVerifyToken(`refocus_ig_${Math.random().toString(36).slice(2, 14)}`)}
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

          <section className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-cyan-600" />
              <div className="text-base font-semibold text-slate-900">Webhook URL</div>
            </div>
            <p className="text-[12px] text-slate-500">
              В настройках вебхука Instagram Product в Meta App укажите этот URL:
            </p>
            <div className="rounded-xl bg-slate-50/60 ring-1 ring-sky-100 p-3 font-mono text-sm text-slate-800 break-all">
              https://<span className="text-slate-400">ваш-домен</span>/api/instagram/webhook
            </div>
            <p className="text-[11px] text-slate-500">
              Verify Token для подтверждения вебхука — тот, что задан выше. Подпишитесь на поле{' '}
              <span className="font-mono">messages</span>, <span className="font-mono">messaging_postbacks</span>,{' '}
              <span className="font-mono">message_reactions</span>, <span className="font-mono">messaging_seen</span>.
            </p>
          </section>

          <section className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] p-5 space-y-3">
            <div className="text-base font-semibold text-slate-900">Требования Meta для включения</div>
            <ol className="list-decimal pl-5 text-[13px] text-slate-700 space-y-1.5">
              <li>Instagram — <b>Professional Account</b> (Business или Creator), не personal.</li>
              <li>Facebook <b>Business Page</b> (не personal profile), связана с Instagram.</li>
              <li>Meta App с продуктами <b>Instagram Graph API</b> + <b>Webhooks</b>.</li>
              <li>
                Разрешения, прошедшие App Review: <span className="font-mono">instagram_basic</span>,{' '}
                <span className="font-mono">instagram_manage_messages</span>,{' '}
                <span className="font-mono">pages_manage_metadata</span>.
              </li>
              <li>Long-lived Page Access Token, сгенерированный через System User этой Meta App.</li>
            </ol>
            <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 text-[12px] text-amber-800 leading-relaxed">
              <b>Окно ответа:</b> 7 дней после последнего сообщения клиента (Standard Messaging).
              Проактивные сообщения запрещены — клиент всегда инициирует. Для сервисных кейсов &gt; 7 дней
              можно использовать Human Agent Tag (+7 дней).
            </div>
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
