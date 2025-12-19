'use client';

import { useEffect, useState } from 'react';

/* ===============================
   Типы и константы
   =============================== */
type KeyItem = {
  id: string;
  name: string;
  desc: string;
  value: string;
};

const DEFAULTS: KeyItem[] = [
  { id: 'whatsapp_token', name: 'WhatsApp API Token', desc: 'Ключ для отправки сообщений через WhatsApp Business API или провайдера.', value: '' },
  { id: 'payment_api_key', name: 'Платёжный API Key', desc: 'Ключ для подключения к эквайрингу/QR-провайдеру.', value: '' },
  { id: 'payment_api_secret', name: 'Платёжный Secret', desc: 'Секрет для проверки подписи вебхуков. Должен храниться только на сервере.', value: '' },
];

const LS_KEY = 'refocus.integrations.keys.v1';

/* ===============================
   Утилиты
   =============================== */
function loadKeys(): KeyItem[] {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return DEFAULTS.map((d) => parsed.find((p: KeyItem) => p.id === d.id) || d);
  } catch {
    return DEFAULTS;
  }
}

function saveKeys(keys: KeyItem[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_KEY, JSON.stringify(keys));
}

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

/* ===============================
   UI-компоненты
   =============================== */
function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200/60 bg-white/80 shadow-sm p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {desc ? <p className="text-slate-600 text-sm mb-3">{desc}</p> : null}
      {children}
    </section>
  );
}

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
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

function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }) {
  const base =
    'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition focus:outline-none disabled:opacity-50';
  const map = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    ghost: 'bg-white border border-slate-300 hover:bg-slate-50',
  };
  return (
    <button {...props} className={classNames(base, map[variant], props.className)}>
      {children}
    </button>
  );
}

/* ===============================
   Основная страница
   =============================== */
export default function KeysPage() {
  const [keys, setKeys] = useState<KeyItem[]>(DEFAULTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setKeys(loadKeys());
  }, []);

  function updateValue(id: string, val: string) {
    setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, value: val } : k)));
  }

  async function handleSave() {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 400));
    saveKeys(keys);
    setSaving(false);
  }

  function handleReset() {
    setKeys(DEFAULTS);
    saveKeys(DEFAULTS);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">API и ключи</h1>
      <p className="text-slate-600 mb-6">
        Здесь хранятся токены и ключи для интеграций. Сейчас они сохраняются локально (для отладки).
        В реальной системе должны храниться на сервере с ограниченным доступом.
      </p>

      <div className="grid grid-cols-1 gap-4">
        {keys.map((k) => (
          <Section key={k.id} title={k.name} desc={k.desc}>
            <Input
              type="password"
              value={k.value}
              onChange={(e) => updateValue(k.id, e.target.value)}
              placeholder="Введите ключ"
            />
          </Section>
        ))}
      </div>

      <div className="mt-6 flex gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Сохраняю…' : 'Сохранить (локально)'}
        </Button>
        <Button variant="ghost" onClick={handleReset}>
          Сбросить
        </Button>
      </div>

      <div className="mt-6 text-xs text-slate-500">
        ⚠️ Важно: секретные ключи не должны храниться в браузере. Это демо-версия. В продакшене
        вынеси хранение в Supabase или другой защищённый бэкенд.
      </div>
    </div>
  );
}
