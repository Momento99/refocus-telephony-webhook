'use client';

import { useEffect, useMemo, useState } from 'react';

/** ===============================
 *  Типы и константы
 *  =============================== */
type Provider = 'none' | 'mbank' | 'elcart' | 'other';

type FormState = {
  provider: Provider;
  merchantId: string;
  apiKey: string;
  apiSecret: string;
  qrEnabled: boolean;
  qrExpiryMin: number; // срок жизни QR в минутах
  testMode: boolean;
};

const DEFAULTS: FormState = {
  provider: 'none',
  merchantId: '',
  apiKey: '',
  apiSecret: '',
  qrEnabled: true,
  qrExpiryMin: 10,
  testMode: false,
};

const LS_KEY = 'refocus.integrations.payments.v1';

/** ===============================
 *  Утилиты
 *  =============================== */
function loadState(): FormState {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function saveState(s: FormState) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

/** ===============================
 *  Компоненты-строители
 *  =============================== */

function Section({ title, children, desc }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200/60 bg-white/80 shadow-sm p-5">
      <div className="mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {desc ? <p className="text-slate-600 text-sm mt-1">{desc}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium mb-1">
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={classNames(
        'w-full rounded-xl border px-3 py-2 text-sm outline-none transition',
        'border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100',
        props.className
      )}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={classNames(
        'w-full rounded-xl border px-3 py-2 text-sm outline-none transition',
        'border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100',
        props.className
      )}
    />
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={classNames(
        'inline-flex items-center rounded-full px-1 py-1 transition border',
        checked ? 'bg-blue-600 border-blue-600' : 'bg-slate-200 border-slate-300'
      )}
      aria-pressed={checked}
    >
      <span
        className={classNames(
          'inline-block h-5 w-5 rounded-full bg-white shadow transform transition',
          checked ? 'translate-x-5' : 'translate-x-0'
        )}
      />
      <span className={classNames('ml-2 text-sm', checked ? 'text-white' : 'text-slate-700')}>{label}</span>
    </button>
  );
}

function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const base =
    'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed';
  const map = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    ghost: 'bg-white border border-slate-300 hover:bg-slate-50',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
  };
  return (
    <button {...props} className={classNames(base, map[variant], props.className)}>
      {children}
    </button>
  );
}

/** ===============================
 *  Основная страница
 *  =============================== */

export default function PaymentsPage() {
  const [state, setState] = useState<FormState>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [pingOk, setPingOk] = useState<boolean | null>(null);
  const [lastPingAt, setLastPingAt] = useState<string | null>(null);

  useEffect(() => {
    setState(loadState());
  }, []);

  const webhookUrl = useMemo(() => {
    // В реальном проекте это должен быть публичный URL сервера, здесь даём путь.
    return '/api/payments/webhook';
  }, []);

  function update<K extends keyof FormState>(key: K, val: FormState[K]) {
    setState((s) => ({ ...s, [key]: val }));
  }

  async function handleSave() {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 400)); // имитация задержки, чтобы не казалось магией
    saveState(state);
    setSaving(false);
  }

  async function handlePing() {
    setPinging(true);
    setPingOk(null);
    // Фейковая проверка подключения: если заполнены provider + merchantId + apiKey → "успех"
    await new Promise((r) => setTimeout(r, 1000));
    const ok = state.provider !== 'none' && !!state.merchantId && !!state.apiKey;
    setPingOk(ok);
    setLastPingAt(new Date().toLocaleString());
    setPinging(false);
  }

  function handleReset() {
    const next = { ...DEFAULTS };
    setState(next);
    saveState(next);
    setPingOk(null);
    setLastPingAt(null);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Заголовок */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Платежи</h1>
        <p className="text-slate-600">
          Подключение эквайринга и QR-оплаты. Настройки хранятся локально для отладки. В проде
          ключи должны храниться на сервере, а не в браузере.
        </p>
      </div>

      {/* Грид секций */}
      <div className="grid grid-cols-1 gap-4">
        {/* Провайдер */}
        <Section
          title="Провайдер эквайринга"
          desc="Выбери провайдера. Если его нет в списке, выбери «Другое»."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="provider">Провайдер</Label>
              <Select
                id="provider"
                value={state.provider}
                onChange={(e) => update('provider', e.target.value as Provider)}
              >
                <option value="none">Не выбран</option>
                <option value="mbank">mBank</option>
                <option value="elcart">ЭЛКАРТ</option>
                <option value="other">Другое</option>
              </Select>
            </div>
            <div className="pt-6">
              <Switch
                checked={state.testMode}
                onChange={(v) => update('testMode', v)}
                label="Тестовый режим"
              />
            </div>
          </div>
        </Section>

        {/* Ключи и реквизиты */}
        <Section
          title="Реквизиты подключения"
          desc="Эти поля нужны для связи CRM с платёжным провайдером. В реальном режиме они должны храниться на сервере."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="merchantId">ID магазина / ТСП</Label>
              <Input
                id="merchantId"
                placeholder="Например, 70000012345"
                value={state.merchantId}
                onChange={(e) => update('merchantId', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                placeholder="Ключ доступа"
                value={state.apiKey}
                onChange={(e) => update('apiKey', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="apiSecret">API Secret</Label>
              <Input
                id="apiSecret"
                placeholder="Секрет (хранить только на сервере)"
                type="password"
                value={state.apiSecret}
                onChange={(e) => update('apiSecret', e.target.value)}
              />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Сохраняю...' : 'Сохранить (локально)'}
            </Button>
            <Button variant="ghost" onClick={handleReset}>
              Сбросить
            </Button>
          </div>
        </Section>

        {/* QR-оплата */}
        <Section
          title="QR-оплата"
          desc="Если включено, на экране клиента можно показать QR со суммой и назначением. QR должен иметь ограниченный срок жизни."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center gap-3">
              <Switch
                checked={state.qrEnabled}
                onChange={(v) => update('qrEnabled', v)}
                label={state.qrEnabled ? 'Включено' : 'Выключено'}
              />
            </div>
            <div>
              <Label htmlFor="qrExpiry">Срок жизни QR (мин)</Label>
              <Input
                id="qrExpiry"
                type="number"
                min={1}
                max={60}
                value={state.qrExpiryMin}
                onChange={(e) => update('qrExpiryMin', Math.max(1, Math.min(60, Number(e.target.value || 1))))}
              />
            </div>
          </div>
        </Section>

        {/* Вебхук и проверка */}
        <Section
          title="Вебхук подтверждения платежа"
          desc="Провайдер будет отправлять подтверждения на этот URL. Настраивается в личном кабинете провайдера."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div>
              <Label>URL для провайдера</Label>
              <Input value={webhookUrl} readOnly />
              <p className="text-xs text-slate-500 mt-1">
                В продакшене это должен быть публичный адрес твоего бэкенда, не «localhost».
              </p>
            </div>
            <div className="flex gap-3">
              <Button onClick={handlePing} disabled={pinging}>
                {pinging ? 'Проверяю…' : 'Проверить подключение'}
              </Button>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 p-4 bg-slate-50">
            <div className="flex items-center gap-2 text-sm">
              <span
                className={classNames(
                  'inline-block h-2.5 w-2.5 rounded-full',
                  pingOk === null ? 'bg-slate-300' : pingOk ? 'bg-emerald-500' : 'bg-rose-500'
                )}
              />
              <span className="font-medium">
                Состояние: {pingOk === null ? 'не проверялось' : pingOk ? 'подключено' : 'ошибка'}
              </span>
              {lastPingAt ? <span className="text-slate-500 ml-2">время проверки: {lastPingAt}</span> : null}
            </div>
            <div className="text-xs text-slate-500 mt-2">
              Последний webhook: не получали. После реальной интеграции здесь будет время последнего успешного
              подтверждения платежа.
            </div>
          </div>
        </Section>

        {/* Безопасность */}
        <Section title="Безопасность">
          <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
            <li>Никогда не храни секретные ключи в браузере. Здесь это сделано только для отладки.</li>
            <li>Сервер должен принимать webhook и сверять подпись/хеш провайдера.</li>
            <li>Не сохраняй PAN карты и персональные данные клиента. Храни только маску и идентификатор транзакции.</li>
            <li>Для оффлайна используй статус «ожидает подтверждение», потом догружай оплату по вебхуку.</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
