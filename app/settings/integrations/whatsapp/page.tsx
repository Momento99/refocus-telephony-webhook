'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

type Config = {
  id: number;
  waba_id: string | null;
  phone_number_id: string | null;
  business_phone: string | null;
  display_name: string | null;
  webhook_verify_token: string | null;
  is_active: boolean;
  has_access_token: boolean;
  updated_at: string;
};

const TEMPLATE_NAME = 'aftercare_day3_generic_ru';
const TEMPLATE_CATEGORY = 'UTILITY';
const TEMPLATE_LANGUAGE = 'Russian (ru)';
const TEMPLATE_BODY = `Здравствуйте, {{1}}! Это Refocus, {{2}}.

Как ваши новые очки — всё ли удобно, нет ли дискомфорта?

Если что-то беспокоит по зрению, посадке или ощущениям — просто ответьте на это сообщение, продавец поможет.

Хорошего дня!`;

const TEMPLATE_SAMPLE_1 = 'Алексей';
const TEMPLATE_SAMPLE_2 = 'Токмок';

export default function WhatsAppIntegrationPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);

  const [wabaId, setWabaId] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [isActive, setIsActive] = useState(false);

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

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Скопировано');
    } catch {
      toast.error('Не удалось скопировать');
    }
  }

  if (loading) {
    return <div className="max-w-3xl mx-auto p-6 text-slate-600">Загрузка…</div>;
  }

  return (
    <div className="min-h-screen bg-transparent text-slate-900">
      <div className="max-w-3xl mx-auto space-y-5">
        <header>
          <h1 className="text-[20px] font-bold text-white tracking-tight flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500 ring-1 ring-white/20">
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="currentColor">
                <path d="M20.52 3.48A11.83 11.83 0 0 0 12.02 0C5.42 0 .04 5.38.04 11.98c0 2.11.55 4.17 1.6 5.99L0 24l6.17-1.62a11.95 11.95 0 0 0 5.85 1.49h.01c6.6 0 11.98-5.38 11.99-11.98 0-3.2-1.25-6.21-3.5-8.41zM12.02 21.85h-.01a9.86 9.86 0 0 1-5.03-1.38l-.36-.21-3.66.96.98-3.57-.23-.37a9.87 9.87 0 0 1-1.52-5.3c0-5.47 4.45-9.92 9.93-9.92 2.65 0 5.14 1.03 7.02 2.91a9.86 9.86 0 0 1 2.9 7.02c-.01 5.48-4.46 9.86-9.92 9.86z" />
              </svg>
            </span>
            WhatsApp Business (Cloud API)
          </h1>
          <p className="text-[12px] text-slate-400 mt-0.5">
            Подключение сервисных сообщений Refocus через Meta Cloud API
          </p>
        </header>

      <section className="rounded-2xl border border-slate-200/60 bg-white/90 shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Учётные данные Meta</h2>
          <span
            className={`text-xs px-2 py-1 rounded-full ${
              config?.is_active
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {config?.is_active ? 'Активно' : 'Не активно'}
          </span>
        </div>

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
            <Input value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} placeholder="refocus_wa_verify_2026" />
            <button
              type="button"
              onClick={() => setVerifyToken(`refocus_wa_${Math.random().toString(36).slice(2, 14)}`)}
              className="shrink-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
            >
              Сгенерировать
            </button>
          </div>
        </Field>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 accent-emerald-600"
          />
          <span className="text-sm">Интеграция активна (шедулер начнёт отправлять follow-up)</span>
        </label>

        <div className="pt-2">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
          {config?.updated_at && (
            <span className="text-xs text-slate-500 ml-3">
              Обновлено: {new Date(config.updated_at).toLocaleString('ru-RU')}
            </span>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200/60 bg-white/90 shadow-sm p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Шаблон для подачи в Мету</h2>
          <p className="text-slate-600 text-sm mt-1">
            Первый service-шаблон. Подавайте в Meta Business Manager → WhatsApp Manager → Message Templates → Create Template.
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3 text-sm">
          <Row label="Name" value={TEMPLATE_NAME} onCopy={() => copy(TEMPLATE_NAME)} />
          <Row label="Category" value={TEMPLATE_CATEGORY} />
          <Row label="Language" value={TEMPLATE_LANGUAGE} />
          <div>
            <div className="text-slate-500 text-xs uppercase tracking-wide mb-1">Body</div>
            <pre className="whitespace-pre-wrap font-sans text-slate-800 text-sm bg-white rounded-lg border border-slate-200 p-3">
{TEMPLATE_BODY}
            </pre>
            <button
              onClick={() => copy(TEMPLATE_BODY)}
              className="mt-2 text-xs text-blue-600 hover:underline"
            >
              Скопировать body
            </button>
          </div>
          <div>
            <div className="text-slate-500 text-xs uppercase tracking-wide mb-1">Sample values (для Меты)</div>
            <div className="text-slate-700">
              <div>{'{{1}}'} → <span className="font-mono">{TEMPLATE_SAMPLE_1}</span></div>
              <div>{'{{2}}'} → <span className="font-mono">{TEMPLATE_SAMPLE_2}</span></div>
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-500 leading-relaxed">
          <strong>Советы при подаче:</strong> категория обязательно <span className="font-mono">UTILITY</span>,
          не <span className="font-mono">MARKETING</span> — иначе отклонят. Sample values подставьте реальные примеры,
          иначе Мета не примет форму. Апрув обычно 1–3 дня.
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200/60 bg-white/90 shadow-sm p-5 space-y-2">
        <h2 className="text-lg font-semibold">Webhook URL</h2>
        <p className="text-slate-600 text-sm">
          В настройках вебхука в Meta укажите этот URL (подключим, когда появится токен):
        </p>
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 font-mono text-sm break-all">
          https://<span className="text-slate-400">ваш-домен</span>/api/whatsapp/webhook
        </div>
        <p className="text-xs text-slate-500">
          Verify Token для подтверждения вебхука — тот, что задан выше в форме.
        </p>
      </section>
      </div>
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
      <label className="block text-sm font-medium mb-1">{label}</label>
      {children}
      {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${props.className ?? ''}`}
    />
  );
}

function Row({ label, value, onCopy }: { label: string; value: string; onCopy?: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-slate-500 text-xs uppercase tracking-wide w-24 shrink-0">{label}</div>
      <div className="font-mono text-slate-800 break-all flex-1">{value}</div>
      {onCopy && (
        <button onClick={onCopy} className="text-xs text-blue-600 hover:underline shrink-0">
          Копировать
        </button>
      )}
    </div>
  );
}
