'use client';

import { useEffect, useState } from 'react';

/* ===============================
   Типы и константы
   =============================== */
type ScenarioKey =
  | 'order_created'
  | 'order_ready'
  | 'order_debt'
  | 'order_reminder'
  | 'order_utilize'
  | 'diagnostic';

type Scenario = {
  key: ScenarioKey;
  title: string;
  desc: string;
  enabled: boolean;
  template: string;
};

const DEFAULTS: Scenario[] = [
  {
    key: 'order_created',
    title: 'Заказ принят',
    desc: 'Сообщение после оформления заказа.',
    enabled: true,
    template: 'Здравствуйте, {имя}! Ваш заказ №{номер} принят. Срок готовности: {дата}.',
  },
  {
    key: 'order_ready',
    title: 'Заказ готов',
    desc: 'Когда заказ перешёл в статус «Готов».',
    enabled: true,
    template: 'Ваши очки готовы к выдаче. Остаток к оплате: {сумма} сом. Адрес: {филиал}.',
  },
  {
    key: 'order_debt',
    title: 'Напоминание о долге',
    desc: 'Если у клиента долг при готовности.',
    enabled: true,
    template:
      'Напоминаем: по заказу №{номер} осталось оплатить {сумма} сом. Очки ждут вас в Refocus ({филиал}).',
  },
  {
    key: 'order_reminder',
    title: 'Через 3 дня не забрал',
    desc: 'Автопинг, если заказ не забрали в течение 3 дней.',
    enabled: true,
    template: 'Ваш заказ №{номер} всё ещё ждёт вас. Приходите забрать очки. Адрес: {филиал}.',
  },
  {
    key: 'order_utilize',
    title: 'Через 20 дней — утилизация',
    desc: 'Жёсткое предупреждение при долгом хранении.',
    enabled: true,
    template:
      'Ваш заказ №{номер} хранится уже 20 дней. В случае отсутствия оплаты и получения заказ может быть утилизирован. Обратитесь в Refocus ({филиал}).',
  },
  {
    key: 'diagnostic',
    title: 'Через 6 месяцев — диагностика',
    desc: 'Возврат клиента на бесплатную проверку зрения.',
    enabled: true,
    template:
      'Здравствуйте, {имя}! С момента вашей последней покупки прошло 6 месяцев. Приглашаем вас на бесплатную диагностику зрения в Refocus ({филиал}).',
  },
];

const LS_KEY = 'refocus.integrations.messengers.v1';

/* ===============================
   Утилиты
   =============================== */
function loadState(): Scenario[] {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return DEFAULTS.map((d) => parsed.find((p: Scenario) => p.key === d.key) || d);
  } catch {
    return DEFAULTS;
  }
}

function saveState(scenarios: Scenario[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_KEY, JSON.stringify(scenarios));
}

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

/* ===============================
   UI-компоненты
   =============================== */
function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200/60 bg-white/80 shadow-sm p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {desc ? <p className="text-slate-600 text-sm mb-3">{desc}</p> : null}
      {children}
    </section>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
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
    </button>
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
export default function MessengersPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>(DEFAULTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setScenarios(loadState());
  }, []);

  function updateScenario(key: ScenarioKey, patch: Partial<Scenario>) {
    setScenarios((prev) =>
      prev.map((s) => (s.key === key ? { ...s, ...patch } : s))
    );
  }

  async function handleSave() {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 400));
    saveState(scenarios);
    setSaving(false);
  }

  function handleReset() {
    setScenarios(DEFAULTS);
    saveState(DEFAULTS);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Мессенджеры</h1>
      <p className="text-slate-600 mb-6">
        Автоматические уведомления через WhatsApp. Настрой шаблоны сообщений и включи/выключи нужные
        сценарии.
      </p>

      <div className="grid grid-cols-1 gap-4">
        {scenarios.map((s) => (
          <Section key={s.key} title={s.title} desc={s.desc}>
            <div className="flex items-center gap-3 mb-3">
              <Switch
                checked={s.enabled}
                onChange={(v) => updateScenario(s.key, { enabled: v })}
              />
              <span className="text-sm text-slate-700">
                {s.enabled ? 'Включено' : 'Выключено'}
              </span>
            </div>
            <textarea
              value={s.template}
              onChange={(e) => updateScenario(s.key, { template: e.target.value })}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              rows={3}
            />
            <p className="text-xs text-slate-500 mt-1">
              Доступные переменные: {'{имя}'}, {'{номер}'}, {'{сумма}'}, {'{филиал}'}, {'{дата}'}.
            </p>
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
    </div>
  );
}
