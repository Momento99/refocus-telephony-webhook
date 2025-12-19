'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/* ===============================
   Типы и константы
   =============================== */
type ReceiptSettings = {
  branchName: string;
  branchAddress: string;
  branchPhone: string;
  logoText: string;          // что писать сверху вместо лого
  showQr: boolean;           // показывать ли QR-зону
  footerText: string;        // низ чека
  lineWidth: number;         // ширина строки в символах для 80мм (моноширинный)
};

const DEFAULTS: ReceiptSettings = {
  branchName: 'Кант, ТЦ «Мээрим»',
  branchAddress: 'Кант, -1 этаж, отдел C08',
  branchPhone: '+996 555 000 000',
  logoText: 'REFOCUS',
  showQr: true,
  footerText: 'Спасибо, что выбрали Refocus! Диагностика — через 6 месяцев.',
  lineWidth: 30,
};

const LS_KEY = 'refocus.integrations.printers.receipt.v1';

/* ===============================
   Утилиты
   =============================== */
function loadSettings(): ReceiptSettings {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function saveSettings(s: ReceiptSettings) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

function padRight(s: string, n: number) {
  return (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
}
function padLeft(s: string, n: number) {
  return (s.length >= n ? s.slice(0, n) : ' '.repeat(n - s.length) + s);
}

function formatMoney(v: number) {
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KGS', maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${v} сом`;
  }
}

/* ===============================
   Демо-данные для предпросмотра
   =============================== */
type DemoOrder = {
  orderNo: string;
  clientName: string;
  clientPhone: string;
  items: { title: string; price: number }[];
  total: number;
  advance: number;
  debt: number;
  statusUrl: string; // ссылка для QR
};

function makeDemoOrder(): DemoOrder {
  const items = [
    { title: 'Оправа TestBrand X1', price: 2480 },
    { title: 'Линзы BlueBlock AR', price: 1800 },
    { title: 'Работа мастера', price: 300 },
  ];
  const total = items.reduce((a, b) => a + b.price, 0);
  const advance = 1500;
  const debt = total - advance;
  return {
    orderNo: 'RF-25KT100010',
    clientName: 'Иванов И.',
    clientPhone: '+996 555 111 222',
    items,
    total,
    advance,
    debt,
    statusUrl: 'https://refocus.kg/o/RF-25KT100010',
  };
}

/* ===============================
   Мелкие UI-компоненты
   =============================== */
function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
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

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
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
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }) {
  const base =
    'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed';
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
   Генерация текстового чека
   =============================== */
function buildReceiptText(s: ReceiptSettings, o: DemoOrder) {
  const w = s.lineWidth;
  const lines: string[] = [];
  const dateStr = new Date().toLocaleString('ru-RU');

  const center = (t: string) => {
    const len = Math.min(t.length, w);
    const pad = Math.max(0, Math.floor((w - len) / 2));
    return ' '.repeat(pad) + t.slice(0, w);
  };

  lines.push(center(s.logoText));
  lines.push(center(`Филиал: ${s.branchName}`));
  lines.push(center(s.branchAddress));
  lines.push(center(`Тел: ${s.branchPhone}`));
  lines.push(center(`Дата: ${dateStr}`));
  lines.push('-'.repeat(w));
  lines.push(`Заказ: ${o.orderNo}`);
  lines.push(`Клиент: ${o.clientName}`);
  lines.push(`Тел: ${o.clientPhone}`);
  lines.push('-'.repeat(w));
  for (const it of o.items) {
    const left = it.title;
    const right = formatMoney(it.price);
    const leftSpace = Math.max(1, w - right.length - 1);
    lines.push(padRight(left, leftSpace) + ' ' + right);
  }
  lines.push('-'.repeat(w));
  const addMoney = (label: string, val: number) => {
    const r = formatMoney(val);
    const left = `${label}:`;
    const leftSpace = Math.max(1, w - r.length - 1);
    lines.push(padRight(left, leftSpace) + ' ' + r);
  };
  addMoney('Итого', o.total);
  addMoney('Аванс', o.advance);
  addMoney('Остаток', o.debt);
  lines.push('-'.repeat(w));

  if (s.showQr) {
    // Вместо реального QR — читаемый блок с URL.
    lines.push(center('[ QR — статус заказа ]'));
    // Разбиваем длинный URL на строки.
    const urlChunks: string[] = [];
    const chunkLen = w;
    for (let i = 0; i < o.statusUrl.length; i += chunkLen) {
      urlChunks.push(o.statusUrl.slice(i, i + chunkLen));
    }
    urlChunks.forEach(u => lines.push(u));
    lines.push('-'.repeat(w));
  }

  // Низ чека
  const footer = s.footerText.trim();
  if (footer) {
    // Разбить на слова и переносить по ширине
    const words = footer.split(/\s+/);
    let cur = '';
    for (const w1 of words) {
      if ((cur + ' ' + w1).trim().length > w) {
        lines.push(cur.trim());
        cur = w1;
      } else {
        cur = (cur + ' ' + w1).trim();
      }
    }
    if (cur) lines.push(cur);
  }

  return lines.join('\n');
}

/* ===============================
   Основная страница
   =============================== */
export default function PrintersAndReceiptsPage() {
  const [s, setS] = useState<ReceiptSettings>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const demoOrder = useMemo(() => makeDemoOrder(), []);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setS(loadSettings());
  }, []);

  const receiptText = useMemo(() => buildReceiptText(s, demoOrder), [s, demoOrder]);

  function update<K extends keyof ReceiptSettings>(key: K, val: ReceiptSettings[K]) {
    setS(prev => ({ ...prev, [key]: val }));
  }

  async function handleSave() {
    setSaving(true);
    await new Promise(r => setTimeout(r, 300));
    saveSettings(s);
    setSaving(false);
  }

  function handleReset() {
    setS(DEFAULTS);
    saveSettings(DEFAULTS);
  }

  function handlePrint() {
    // Печатаем только блок предпросмотра
    const w = window.open('', '_blank', 'width=480,height=800');
    if (!w) return;
    const css = `
      <style>
        @page { size: 80mm auto; margin: 5mm; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
        pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.3; }
      </style>
    `;
    w.document.write(`<html><head><title>Чек — предпросмотр</title>${css}</head><body><pre>${receiptText}</pre></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Принтеры и чеки</h1>
      <p className="text-slate-600 mb-6">
        Настрой макет «Чек клиента» для 80 мм термоленты. Филиал, адрес и телефон редактируются здесь.
        Дата ставится автоматически по времени устройства.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Настройки */}
        <div className="space-y-4">
          <Section title="Данные филиала" desc="Эти поля попадут в шапку чека.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="branchName">Филиал</Label>
                <Input
                  id="branchName"
                  value={s.branchName}
                  onChange={(e) => update('branchName', e.target.value)}
                  placeholder="Напр.: Кант, ТЦ «Мээрим»"
                />
              </div>
              <div>
                <Label htmlFor="branchPhone">Телефон</Label>
                <Input
                  id="branchPhone"
                  value={s.branchPhone}
                  onChange={(e) => update('branchPhone', e.target.value)}
                  placeholder="+996 ..."
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="branchAddress">Адрес</Label>
                <Input
                  id="branchAddress"
                  value={s.branchAddress}
                  onChange={(e) => update('branchAddress', e.target.value)}
                  placeholder="Адрес филиала"
                />
              </div>
            </div>
          </Section>

          <Section title="Оформление чека">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="logoText">Текст вверху (логотип)</Label>
                <Input
                  id="logoText"
                  value={s.logoText}
                  onChange={(e) => update('logoText', e.target.value)}
                  placeholder="REFOCUS"
                />
              </div>
              <div>
                <Label htmlFor="lineWidth">Ширина строки (символы)</Label>
                <Input
                  id="lineWidth"
                  type="number"
                  min={20}
                  max={42}
                  value={s.lineWidth}
                  onChange={(e) => update('lineWidth', Math.max(20, Math.min(42, Number(e.target.value || 30))))}
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="footerText">Низ чека</Label>
                <Textarea
                  id="footerText"
                  rows={2}
                  value={s.footerText}
                  onChange={(e) => update('footerText', e.target.value)}
                  placeholder="Спасибо, что выбрали Refocus! ..."
                />
              </div>
              <div className="md:col-span-2">
                <Switch
                  checked={s.showQr}
                  onChange={(v) => update('showQr', v)}
                  label={s.showQr ? 'Показывать QR-зону (ссылка на статус заказа)' : 'Скрыть QR-зону'}
                />
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <Button onClick={handleSave} disabled={saving}>{saving ? 'Сохраняю…' : 'Сохранить (локально)'}</Button>
              <Button variant="ghost" onClick={handleReset}>Сбросить</Button>
            </div>
          </Section>
        </div>

        {/* Предпросмотр */}
        <div className="space-y-4">
          <Section
            title="Предпросмотр чека"
            desc="Это пример. При печати дата подставится текущая, данные заказа возьмутся из CRM."
          >
            <div ref={previewRef} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.3]">
{receiptText}
              </pre>
            </div>
            <div className="mt-4 flex gap-3">
              <Button onClick={handlePrint}>Печать теста</Button>
              <Button
                variant="ghost"
                onClick={() => navigator.clipboard?.writeText(receiptText)}
                title="Скопировать текст предпросмотра"
              >
                Копировать текст
              </Button>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              Принтер по умолчанию берётся системный. Для 80 мм установи ширину бумаги в драйвере и не забудь про кириллицу.
            </p>
          </Section>

          <Section title="Заметки по принтерам">
            <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
              <li>Чек печатается моноширинным шрифтом. Ширина строки регулируется (обычно 30–32 символа для 80 мм).</li>
              <li>QR в предпросмотре показан как ссылка. Реальный QR будет генерироваться на сервере и печататься картинкой.</li>
              <li>Дата в чеке — системная, меняется автоматически при печати.</li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
