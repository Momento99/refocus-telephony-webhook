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
} from 'lucide-react';

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

            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 accent-cyan-500"
              />
              <span className="text-sm text-slate-700">
                Интеграция активна (шедулер начнёт отправлять follow-up)
              </span>
            </label>

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

          {/* Шаблон для подачи в Мету */}
          <section className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] p-5 space-y-4">
            <div>
              <div className="text-base font-semibold text-slate-900">Шаблон для подачи в Мету</div>
              <p className="mt-1 text-[12px] text-slate-500">
                Первый service-шаблон. Подавайте в Meta Business Manager → WhatsApp Manager → Message Templates → Create Template.
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
                  Sample values (для Меты)
                </div>
                <div className="text-slate-700 space-y-0.5 text-[13px]">
                  <div>
                    {'{{1}}'} → <span className="font-mono text-slate-900">{TEMPLATE_SAMPLE_1}</span>
                  </div>
                  <div>
                    {'{{2}}'} → <span className="font-mono text-slate-900">{TEMPLATE_SAMPLE_2}</span>
                  </div>
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
