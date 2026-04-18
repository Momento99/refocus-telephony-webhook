'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Megaphone,
  RefreshCw,
  Save,
  Send,
  Play,
  Clock3,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

type RuleCode = 'orders_ready' | 'checkup_reminder' | 'news_campaign';

type NotificationRule = {
  id: string;
  code: RuleCode;
  title: string;
  description: string | null;
  is_enabled: boolean;
  channel: 'push';
  template_title: string;
  template_body: string;
  send_delay_minutes: number;
  repeat_after_days: number | null;
  checkup_interval_months: number | null;
  quiet_hours: { from: string; to: string };
  updated_at: string;
};

type NotificationCampaign = {
  id: string;
  kind: 'news' | 'promo';
  title: string;
  body: string;
  status: 'draft' | 'scheduled' | 'queued' | 'sent' | 'cancelled';
  send_at: string | null;
  audience_mode: 'all_opted_in' | 'branches_only';
  branch_ids: number[];
  sent_count: number;
  failed_count: number;
  created_at: string;
};

type QueueItem = {
  id: string;
  status: 'queued' | 'processing' | 'sent' | 'failed' | 'cancelled';
  kind: RuleCode;
  scheduled_at: string;
  created_at: string;
  campaign_id: string | null;
  order_id?: number | null;
  customer_id?: number | null;
};

type NotificationLog = {
  id: number;
  source: string;
  source_id: string | null;
  kind: string;
  status: 'info' | 'success' | 'warning' | 'error';
  message: string | null;
  created_at: string;
};

type DashboardResponse = {
  ok: boolean;
  rules: NotificationRule[];
  campaigns: NotificationCampaign[];
  queueStats: {
    queued: number;
    processing: number;
    sent: number;
    failed: number;
  };
  recentQueue: QueueItem[];
  logs: NotificationLog[];
  error?: string;
};

type EditableRule = {
  code: RuleCode;
  title: string;
  description: string;
  is_enabled: boolean;
  template_title: string;
  template_body: string;
  send_delay_minutes: number;
  repeat_after_days: number | null;
  checkup_interval_months: number | null;
  quiet_hours: { from: string; to: string };
  country_id: string | null;
};

type CountryOption = { id: string; name: string; flag: string };

const COUNTRY_FLAGS: Record<string, string> = {
  kg: '🇰🇬', kz: '🇰🇿', uz: '🇺🇿', ru: '🇷🇺',
};

const ruleLabels: Record<RuleCode, string> = {
  orders_ready: 'Ваш заказ готов',
  checkup_reminder: 'Напоминание о диагностике',
  news_campaign: 'Новости и акции',
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(d);
}

function toDatetimeLocalValue(value?: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');

  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function StatusChip({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'ok'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : tone === 'danger'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : 'border-cyan-200 bg-cyan-50 text-cyan-700';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
        toneClass
      )}
    >
      {children}
    </span>
  );
}

function SoftPrimaryButton({
  children,
  onClick,
  disabled,
  className,
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
    >
      {children}
    </button>
  );
}

function SoftGhostButton({
  children,
  onClick,
  disabled,
  className,
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-xl ring-1 ring-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
    >
      {children}
    </button>
  );
}

function StatBox({
  title,
  value,
  sub,
}: {
  title: string;
  value: React.ReactNode;
  sub: string;
  tone?: 'sky' | 'emerald' | 'amber' | 'rose';
}) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-4">
      <div className="text-[11px] text-slate-500 font-medium">{title}</div>
      <div className="mt-1 text-[22px] font-bold text-slate-900">{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>
    </div>
  );
}

function SectionCard({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      {title && (
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[14px] font-semibold text-white">{title}</div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  min,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  min?: number;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] text-slate-500 font-medium">{label}</div>
      <input
        type={type}
        min={min}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-200 outline-none transition placeholder:text-slate-400 focus:ring-2 focus:ring-[#22d3ee]/50 focus:bg-white"
      />
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] text-slate-500 font-medium">{label}</div>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-200 outline-none transition placeholder:text-slate-400 focus:ring-2 focus:ring-[#22d3ee]/50 focus:bg-white"
      />
    </label>
  );
}

export default function NotificationsPage() {
  const [loading, setLoading] = useState(true);
  const [savingRule, setSavingRule] = useState<RuleCode | null>(null);
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [busyCampaignId, setBusyCampaignId] = useState<string | null>(null);
  const [checkupRunning, setCheckupRunning] = useState(false);
  const [checkupTesting, setCheckupTesting] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const [rules, setRules] = useState<Record<RuleCode, EditableRule>>({
    orders_ready: {
      code: 'orders_ready',
      title: 'Ваш заказ готов',
      description: '',
      is_enabled: true,
      template_title: '',
      template_body: '',
      send_delay_minutes: 0,
      repeat_after_days: 1,
      checkup_interval_months: null,
      quiet_hours: { from: '21:00', to: '10:00' },
      country_id: null,
    },
    checkup_reminder: {
      code: 'checkup_reminder',
      title: 'Напоминание о диагностике',
      description: '',
      is_enabled: true,
      template_title: '',
      template_body: '',
      send_delay_minutes: 0,
      repeat_after_days: null,
      checkup_interval_months: 12,
      quiet_hours: { from: '21:00', to: '10:00' },
      country_id: null,
    },
    news_campaign: {
      code: 'news_campaign',
      title: 'Новости и акции',
      description: '',
      is_enabled: true,
      template_title: '',
      template_body: '',
      send_delay_minutes: 0,
      repeat_after_days: null,
      checkup_interval_months: null,
      quiet_hours: { from: '21:00', to: '10:00' },
      country_id: null,
    },
  });

  const [campaigns, setCampaigns] = useState<NotificationCampaign[]>([]);
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueStats, setQueueStats] = useState({
    queued: 0,
    processing: 0,
    sent: 0,
    failed: 0,
  });

  const [countries, setCountries] = useState<CountryOption[]>([]);

  const [testCustomerId, setTestCustomerId] = useState('681');
const [testOrderId, setTestOrderId] = useState('1006');
const [orderTesting, setOrderTesting] = useState(false);

const [newsTesting, setNewsTesting] = useState(false);
const [newsTestTitle, setNewsTestTitle] = useState('Тестовая новость Refocus');
const [newsTestBody, setNewsTestBody] = useState(
  'Это тестовое push-уведомление новостей и акций.'
);
  const [campaignForm, setCampaignForm] = useState({
    kind: 'news' as 'news' | 'promo',
    title: '',
    body: '',
    status: 'draft' as 'draft' | 'scheduled',
    send_at: '',
    audience_mode: 'all_opted_in' as 'all_opted_in' | 'branches_only',
    branch_ids: '',
  });

  const enabledCount = useMemo(
    () => Object.values(rules).filter((r) => r.is_enabled).length,
    [rules]
  );

  async function loadDashboard() {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/notifications', {
        cache: 'no-store',
      });
      const json = (await res.json()) as DashboardResponse;

      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Не удалось загрузить центр уведомлений');
      }

      const nextRules = { ...rules };

      for (const r of json.rules) {
        nextRules[r.code] = {
          code: r.code,
          title: r.title,
          description: r.description ?? '',
          is_enabled: r.is_enabled,
          template_title: r.template_title ?? '',
          template_body: r.template_body ?? '',
          send_delay_minutes: r.send_delay_minutes ?? 0,
          repeat_after_days: r.repeat_after_days ?? null,
          checkup_interval_months: r.checkup_interval_months ?? null,
          quiet_hours:
            typeof r.quiet_hours === 'object' && r.quiet_hours
              ? r.quiet_hours
              : { from: '21:00', to: '10:00' },
          country_id: (r as any).country_id ?? null,
        };
      }

      setRules(nextRules);

      if (json.countries) {
        setCountries(
          (json.countries as any[]).map((c: any) => ({
            id: c.id,
            name: c.name,
            flag: COUNTRY_FLAGS[c.id] ?? '🌐',
          }))
        );
      }

      setCampaigns(json.campaigns ?? []);
      setLogs(json.logs ?? []);
      setQueue(json.recentQueue ?? []);
      setQueueStats(
        json.queueStats ?? {
          queued: 0,
          processing: 0,
          sent: 0,
          failed: 0,
        }
      );
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateRule(code: RuleCode, patch: Partial<EditableRule>) {
    setRules((prev) => ({
      ...prev,
      [code]: {
        ...prev[code],
        ...patch,
      },
    }));
  }

  async function saveRule(code: RuleCode) {
    const rule = rules[code];
    setSavingRule(code);
    setError('');
    setInfo('');

    try {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'saveRule', rule }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Не удалось сохранить сценарий');
      }

      setInfo(`Сценарий «${ruleLabels[code]}» сохранён`);
      await loadDashboard();
    } catch (e: any) {
      setError(e?.message || 'Ошибка сохранения');
    } finally {
      setSavingRule(null);
    }
  }

  async function createCampaign() {
    setCreatingCampaign(true);
    setError('');
    setInfo('');

    try {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createCampaign',
          campaign: {
            kind: campaignForm.kind,
            title: campaignForm.title,
            body: campaignForm.body,
            status: campaignForm.status,
            send_at: campaignForm.status === 'scheduled' ? campaignForm.send_at : null,
            audience_mode: campaignForm.audience_mode,
            branch_ids:
              campaignForm.audience_mode === 'branches_only'
                ? campaignForm.branch_ids
                    .split(',')
                    .map((x) => Number(x.trim()))
                    .filter((x) => Number.isFinite(x))
                : [],
          },
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Не удалось создать кампанию');
      }

      setCampaignForm({
        kind: 'news',
        title: '',
        body: '',
        status: 'draft',
        send_at: '',
        audience_mode: 'all_opted_in',
        branch_ids: '',
      });

      setInfo('Кампания сохранена');
      await loadDashboard();
    } catch (e: any) {
      setError(e?.message || 'Ошибка создания кампании');
    } finally {
      setCreatingCampaign(false);
    }
  }

  async function changeCampaignStatus(id: string, status: NotificationCampaign['status']) {
    setBusyCampaignId(id);
    setError('');
    setInfo('');

    try {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'changeCampaignStatus', id, status }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Не удалось изменить статус');
      }

      setInfo(`Статус кампании изменён на ${status}`);
      await loadDashboard();
    } catch (e: any) {
      setError(e?.message || 'Ошибка изменения статуса');
    } finally {
      setBusyCampaignId(null);
    }
  }

  async function queueCampaignNow(id: string) {
    setBusyCampaignId(id);
    setError('');
    setInfo('');

    try {
      const queueRes = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'queueCampaignNow', id }),
      });

      const queueJson = await queueRes.json();
      if (!queueRes.ok || !queueJson.ok) {
        throw new Error(queueJson.error || 'Не удалось поставить кампанию в очередь');
      }

      const dispatchRes = await fetch('/api/admin/notifications/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: 100,
          kind: 'news_campaign',
          campaignId: id,
        }),
      });

      const dispatchJson = await dispatchRes.json().catch(() => null);

      if (!dispatchRes.ok || !dispatchJson?.ok) {
        throw new Error(dispatchJson?.error || 'Кампания поставлена в очередь, но dispatch не выполнился');
      }

      if (Number(dispatchJson.sent || 0) > 0 && Number(dispatchJson.failed || 0) === 0) {
        await fetch('/api/admin/notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'changeCampaignStatus', id, status: 'sent' }),
        });
      }

      setInfo(
        Number(dispatchJson.sent || 0) > 0
          ? `Кампания отправлена: ${dispatchJson.sent}`
          : 'Кампания поставлена в очередь, получателей пока нет'
      );

      await loadDashboard();
    } catch (e: any) {
      setError(e?.message || 'Ошибка отправки кампании');
    } finally {
      setBusyCampaignId(null);
    }
  }

  async function runCheckupNow() {
    setCheckupRunning(true);
    setError('');
    setInfo('');

    try {
      const queueRes = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'runCheckupNow' }),
      });

      const queueJson = await queueRes.json();
      if (!queueRes.ok || !queueJson.ok) {
        throw new Error(queueJson.error || 'Не удалось запустить напоминания о диагностике');
      }

      const dispatchRes = await fetch('/api/admin/notifications/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: 100,
          kind: 'checkup_reminder',
        }),
      });

      const dispatchJson = await dispatchRes.json().catch(() => null);

      if (!dispatchRes.ok || !dispatchJson?.ok) {
        throw new Error(dispatchJson?.error || 'Напоминания поставлены в очередь, но dispatch не выполнился');
      }

      setInfo(
        Number(dispatchJson.sent || 0) > 0
          ? `Напоминания о диагностике отправлены: ${dispatchJson.sent}`
          : `Клиентов в очереди: ${queueJson.queuedCount ?? 0}`
      );

      await loadDashboard();
    } catch (e: any) {
      setError(e?.message || 'Ошибка запуска диагностики');
    } finally {
      setCheckupRunning(false);
    }
  }

  async function sendCheckupTest() {
  setCheckupTesting(true);
  setError('');
  setInfo('');

  try {
    const customerId = Number(testCustomerId);
    if (!Number.isFinite(customerId) || customerId <= 0) {
      throw new Error('Укажи корректный customer_id для теста');
    }

    const queueRes = await fetch('/api/admin/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sendCheckupTest',
        customerId,
      }),
    });

    const queueJson = await queueRes.json();
    if (!queueRes.ok || !queueJson.ok) {
      throw new Error(queueJson.error || 'Не удалось поставить тест в очередь');
    }

    const dispatchRes = await fetch('/api/admin/notifications/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        limit: 10,
        kind: 'checkup_reminder',
        customerId,
      }),
    });

    const dispatchJson = await dispatchRes.json().catch(() => null);

    if (!dispatchRes.ok || !dispatchJson?.ok) {
      throw new Error(
        dispatchJson?.error || 'Тест поставлен в очередь, но dispatch не выполнился'
      );
    }

    setInfo(
      Number(dispatchJson.sent || 0) > 0
        ? 'Тестовое напоминание о диагностике отправлено'
        : 'Тест поставлен в очередь, но отправка пока не произошла'
    );

    await loadDashboard();
  } catch (e: any) {
    setError(e?.message || 'Ошибка тестового push-напоминания');
  } finally {
    setCheckupTesting(false);
  }
}
async function sendOrderReadyTest() {
  setOrderTesting(true);
  setError('');
  setInfo('');

  try {
    const orderId = Number(testOrderId);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      throw new Error('Укажи корректный order_id для теста');
    }

    const queueRes = await fetch('/api/admin/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sendOrderReadyTest',
        orderId,
      }),
    });

    const queueJson = await queueRes.json();
    if (!queueRes.ok || !queueJson.ok) {
      throw new Error(queueJson.error || 'Не удалось поставить тест заказа в очередь');
    }

    const dispatchRes = await fetch('/api/admin/notifications/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        limit: 10,
        kind: 'orders_ready',
        orderId,
      }),
    });

    const dispatchJson = await dispatchRes.json().catch(() => null);

    if (!dispatchRes.ok || !dispatchJson?.ok) {
      throw new Error(
        dispatchJson?.error || 'Тест заказа поставлен в очередь, но dispatch не выполнился'
      );
    }

    setInfo(
      Number(dispatchJson.sent || 0) > 0
        ? 'Тестовое уведомление "Ваш заказ готов" отправлено'
        : 'Тест заказа поставлен в очередь, но отправка пока не произошла'
    );

    await loadDashboard();
  } catch (e: any) {
    setError(e?.message || 'Ошибка тестового уведомления по заказу');
  } finally {
    setOrderTesting(false);
  }
}

async function sendNewsTest() {
  setNewsTesting(true);
  setError('');
  setInfo('');

  try {
    const customerId = Number(testCustomerId);
    if (!Number.isFinite(customerId) || customerId <= 0) {
      throw new Error('Укажи корректный customer_id для теста');
    }

    const queueRes = await fetch('/api/admin/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sendNewsTest',
        customerId,
        title: newsTestTitle,
        body: newsTestBody,
      }),
    });

    const queueJson = await queueRes.json();
    if (!queueRes.ok || !queueJson.ok) {
      throw new Error(queueJson.error || 'Не удалось поставить тест новости в очередь');
    }

    const dispatchRes = await fetch('/api/admin/notifications/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        limit: 10,
        kind: 'news_campaign',
        customerId,
      }),
    });

    const dispatchJson = await dispatchRes.json().catch(() => null);

    if (!dispatchRes.ok || !dispatchJson?.ok) {
      throw new Error(
        dispatchJson?.error || 'Тест новости поставлен в очередь, но dispatch не выполнился'
      );
    }

    setInfo(
      Number(dispatchJson.sent || 0) > 0
        ? 'Тестовая новость/акция отправлена'
        : 'Тест новости поставлен в очередь, но отправка пока не произошла'
    );

    await loadDashboard();
  } catch (e: any) {
    setError(e?.message || 'Ошибка тестовой новости/акции');
  } finally {
    setNewsTesting(false);
  }
}
  return (
    <div className="min-h-screen bg-transparent text-slate-900">
      <div className="mx-auto max-w-7xl px-5 pb-10 pt-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-bold text-white tracking-tight">Уведомления</h1>
            <p className="text-[12px] text-slate-400 mt-0.5">Push-сценарии и кампании</p>
          </div>
          <button onClick={() => void loadDashboard()} disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 text-slate-300 text-[13px] font-medium hover:bg-white/15 disabled:opacity-50 transition-all">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            Обновить
          </button>
        </div>

        {error && <div className="mb-4 rounded-xl bg-red-500/15 ring-1 ring-red-500/20 px-4 py-2.5 text-sm text-red-400">{error}</div>}
        {info && <div className="mb-4 rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/20 px-4 py-2.5 text-sm text-emerald-400">{info}</div>}

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatBox
            title="Активные сценарии"
            value={enabledCount}
            sub="Из трёх сценариев"
            tone="emerald"
          />
          <StatBox
            title="В очереди"
            value={queueStats.queued}
            sub="Ожидают отправки"
            tone="sky"
          />
          <StatBox
            title="Отправлено"
            value={queueStats.sent}
            sub="Через Expo"
            tone="emerald"
          />
          <StatBox
            title="Ошибки"
            value={queueStats.failed}
            sub="Проверь лог"
            tone={queueStats.failed > 0 ? 'rose' : 'amber'}
          />
        </div>

        <div className="grid grid-cols-1 gap-6">
          <SectionCard
            title="Сценарии уведомлений"
            right={
              <div className="flex flex-wrap gap-2">
                <StatusChip tone="ok">Push включён</StatusChip>
                <StatusChip tone="neutral">Адресная отправка</StatusChip>
              </div>
            }
          >
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
              {(['orders_ready', 'checkup_reminder', 'news_campaign'] as RuleCode[]).map(
                (code) => {
                  const rule = rules[code];
                  const isCheckup = code === 'checkup_reminder';
                  const isOrders = code === 'orders_ready';
                  const isNewsRule = code === 'news_campaign';

                  return (
                    <div
                      key={code}
                      className="rounded-2xl bg-white ring-1 ring-slate-200 p-5"
                    >
                      {/* Шапка */}
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">
                          {isOrders ? <Bell className="h-4 w-4 text-cyan-500" /> : isCheckup ? <Clock3 className="h-4 w-4 text-cyan-500" /> : <Megaphone className="h-4 w-4 text-cyan-500" />}
                          {rule.title || ruleLabels[code]}
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <span className="text-[11px] text-slate-400">{rule.is_enabled ? 'Вкл' : 'Выкл'}</span>
                          <input type="checkbox" checked={rule.is_enabled} onChange={(e) => updateRule(code, { is_enabled: e.target.checked })} className="h-4 w-4 accent-cyan-500" />
                        </label>
                      </div>

                      <div className="space-y-3">
                        <Input
                          label="Заголовок push"
                          value={rule.template_title}
                          onChange={(value) => updateRule(code, { template_title: value })}
                          placeholder="Например: Ваш заказ готов"
                        />

                        <Textarea
                          label="Текст push"
                          value={rule.template_body}
                          onChange={(value) => updateRule(code, { template_body: value })}
                          rows={3}
                          placeholder="Короткий текст уведомления"
                        />

                        {/* Настройки — сворачиваемый блок */}
                        <details className="rounded-xl bg-slate-50">
                          <summary className="px-3 py-2 text-[11px] text-slate-500 cursor-pointer hover:text-slate-700 transition-colors select-none">Настройки отправки</summary>
                          <div className="px-3 pb-3 space-y-3">

                            {/* Страна */}
                            <div>
                              <div className="text-[11px] font-medium text-slate-500 mb-1.5">Страна</div>
                              <div className="flex flex-wrap gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => updateRule(code, { country_id: null })}
                                  className={cn(
                                    'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
                                    !rule.country_id
                                      ? 'bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 text-white shadow-sm'
                                      : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100',
                                  )}
                                >
                                  🌍 Все
                                </button>
                                {countries.map((c) => (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => updateRule(code, { country_id: c.id })}
                                    className={cn(
                                      'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
                                      rule.country_id === c.id
                                        ? 'bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 text-white shadow-sm'
                                        : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100',
                                    )}
                                  >
                                    {c.flag} {c.name}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <Input
                                label="Задержка, мин"
                                type="number"
                                min={0}
                                value={rule.send_delay_minutes ?? 0}
                                onChange={(value) => updateRule(code, { send_delay_minutes: Number(value || 0) })}
                              />
                              {isCheckup ? (
                                <Input
                                  label="Интервал, мес"
                                  type="number"
                                  min={1}
                                  value={rule.checkup_interval_months ?? 12}
                                  onChange={(value) => updateRule(code, { checkup_interval_months: Number(value || 12) })}
                                />
                              ) : (
                                <Input
                                  label="Повтор, дней"
                                  type="number"
                                  min={0}
                                  value={rule.repeat_after_days ?? 0}
                                  onChange={(value) => updateRule(code, { repeat_after_days: Number(value || 0) })}
                                />
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <Input
                                label="Тихие часы: с"
                                value={rule.quiet_hours?.from ?? '21:00'}
                                onChange={(value) => updateRule(code, { quiet_hours: { ...rule.quiet_hours, from: value } })}
                              />
                              <Input
                                label="Тихие часы: до"
                                value={rule.quiet_hours?.to ?? '10:00'}
                                onChange={(value) => updateRule(code, { quiet_hours: { ...rule.quiet_hours, to: value } })}
                              />
                            </div>
                          </div>
                        </details>

                        {isOrders && (
  <details className="rounded-xl bg-slate-50">
    <summary className="px-3 py-2 text-[11px] text-slate-500 cursor-pointer hover:text-slate-300 transition-colors select-none">Тестовая отправка</summary>
    <div className="space-y-3 px-3 pb-3">
      <Input label="order_id" value={testOrderId} onChange={setTestOrderId} type="number" min={1} />
      <SoftGhostButton onClick={() => void sendOrderReadyTest()} disabled={orderTesting}>
        <Send className="mr-1.5 inline h-3.5 w-3.5" />
        {orderTesting ? 'Отправка…' : 'Отправить тест'}
      </SoftGhostButton>
    </div>
  </details>
)}

                        {isCheckup && (
                          <details className="rounded-xl bg-slate-50">
                            <summary className="px-3 py-2 text-[11px] text-slate-500 cursor-pointer hover:text-slate-300 transition-colors select-none">Тестовая отправка</summary>
                            <div className="space-y-3 px-3 pb-3">
                              <Input label="customer_id" value={testCustomerId} onChange={setTestCustomerId} type="number" min={1} />
                              <div className="flex gap-2">
                                <SoftGhostButton onClick={() => void sendCheckupTest()} disabled={checkupTesting}>
                                  <Send className="mr-1.5 inline h-3.5 w-3.5" />
                                  {checkupTesting ? 'Отправка…' : 'Тест'}
                                </SoftGhostButton>
                                <SoftPrimaryButton onClick={() => void runCheckupNow()} disabled={checkupRunning}>
                                  <Play className="mr-1.5 inline h-3.5 w-3.5" />
                                  {checkupRunning ? 'Запуск…' : 'Запустить все'}
                                </SoftPrimaryButton>
                              </div>
                            </div>
                          </details>
                        )}

                        {isNewsRule && (
  <details className="rounded-xl bg-slate-50">
    <summary className="px-3 py-2 text-[11px] text-slate-500 cursor-pointer hover:text-slate-300 transition-colors select-none">Тестовая отправка</summary>
    <div className="space-y-3 px-3 pb-3">
      <Input label="customer_id" value={testCustomerId} onChange={setTestCustomerId} type="number" min={1} />
      <Input label="Заголовок" value={newsTestTitle} onChange={setNewsTestTitle} />
      <Textarea label="Текст" value={newsTestBody} onChange={setNewsTestBody} rows={2} />
      <SoftGhostButton onClick={() => void sendNewsTest()} disabled={newsTesting}>
        <Send className="mr-1.5 inline h-3.5 w-3.5" />
        {newsTesting ? 'Отправка…' : 'Отправить тест'}
      </SoftGhostButton>
    </div>
  </details>
)}

                        <div className="flex gap-2 pt-1">
                          <SoftPrimaryButton
                            onClick={() => void saveRule(code)}
                            disabled={savingRule === code}
                            className="flex-1"
                          >
                            <Save className="mr-2 inline h-4 w-4" />
                            {savingRule === code ? 'Сохранение…' : 'Сохранить'}
                          </SoftPrimaryButton>
                          <SoftGhostButton
                            onClick={() => void loadDashboard()}
                            disabled={loading}
                            className="flex-1"
                          >
                            Сбросить
                          </SoftGhostButton>
                        </div>
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Новости и акции"
            right={
              <div className="flex flex-wrap gap-2">
                <StatusChip tone="neutral">Только opt-in</StatusChip>
                <StatusChip tone="warn">Не смешивается с другими сценариями</StatusChip>
              </div>
            }
          >
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-5">
                <div className="mb-4 text-base font-semibold text-slate-900">
                  Новая кампания
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="block">
                    <div className="mb-1 text-[10px] text-slate-500 font-medium">Тип кампании</div>
                    <select
                      value={campaignForm.kind}
                      onChange={(e) =>
                        setCampaignForm((prev) => ({
                          ...prev,
                          kind: e.target.value as 'news' | 'promo',
                        }))
                      }
                      className="w-full rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-cyan-500/50 focus:bg-white"
                    >
                      <option value="news">Новость</option>
                      <option value="promo">Акция</option>
                    </select>
                  </label>

                  <label className="block">
                    <div className="mb-1 text-[10px] text-slate-500 font-medium">Режим</div>
                    <select
                      value={campaignForm.status}
                      onChange={(e) =>
                        setCampaignForm((prev) => ({
                          ...prev,
                          status: e.target.value as 'draft' | 'scheduled',
                        }))
                      }
                      className="w-full rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-cyan-500/50 focus:bg-white"
                    >
                      <option value="draft">Черновик</option>
                      <option value="scheduled">Запланировать</option>
                    </select>
                  </label>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4">
                  <Input
                    label="Заголовок"
                    value={campaignForm.title}
                    onChange={(value) =>
                      setCampaignForm((prev) => ({ ...prev, title: value }))
                    }
                    placeholder="Например: Скидка на хамелеоны"
                  />

                  <Textarea
                    label="Текст"
                    rows={5}
                    value={campaignForm.body}
                    onChange={(value) =>
                      setCampaignForm((prev) => ({ ...prev, body: value }))
                    }
                    placeholder="Короткое содержание push-уведомления"
                  />

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="block">
                      <div className="mb-1 text-[10px] text-slate-500 font-medium">Аудитория</div>
                      <select
                        value={campaignForm.audience_mode}
                        onChange={(e) =>
                          setCampaignForm((prev) => ({
                            ...prev,
                            audience_mode: e.target.value as
                              | 'all_opted_in'
                              | 'branches_only',
                          }))
                        }
                        className="w-full rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-cyan-500/50 focus:bg-white"
                      >
                        <option value="all_opted_in">Все, кто включил новости</option>
                        <option value="branches_only">Только выбранные филиалы</option>
                      </select>
                    </label>

                    {campaignForm.status === 'scheduled' ? (
                      <label className="block">
                        <div className="mb-1 text-[10px] text-slate-500 font-medium">
                          Дата и время отправки
                        </div>
                        <input
                          type="datetime-local"
                          value={campaignForm.send_at}
                          onChange={(e) =>
                            setCampaignForm((prev) => ({
                              ...prev,
                              send_at: e.target.value,
                            }))
                          }
                          className="w-full rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-cyan-500/50 focus:bg-white"
                        />
                      </label>
                    ) : null}
                  </div>

                  {campaignForm.audience_mode === 'branches_only' ? (
                    <Input
                      label="ID филиалов через запятую"
                      value={campaignForm.branch_ids}
                      onChange={(value) =>
                        setCampaignForm((prev) => ({ ...prev, branch_ids: value }))
                      }
                      placeholder="Например: 1,2,4"
                    />
                  ) : null}
                </div>

                <div className="mt-5 flex gap-2">
                  <SoftPrimaryButton
                    onClick={() => void createCampaign()}
                    disabled={creatingCampaign}
                    className="flex-1"
                  >
                    {creatingCampaign
                      ? 'Сохранение…'
                      : campaignForm.status === 'scheduled'
                      ? 'Создать запланированную'
                      : 'Создать черновик'}
                  </SoftPrimaryButton>
                  <SoftGhostButton
                    onClick={() =>
                      setCampaignForm({
                        kind: 'news',
                        title: '',
                        body: '',
                        status: 'draft',
                        send_at: '',
                        audience_mode: 'all_opted_in',
                        branch_ids: '',
                      })
                    }
                    className="flex-1"
                  >
                    Очистить
                  </SoftGhostButton>
                </div>
              </div>

              <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="text-base font-semibold text-slate-900">
                    Последние кампании
                  </div>
                  <StatusChip tone="neutral">{campaigns.length} записей</StatusChip>
                </div>

                <div className="space-y-3">
                  {campaigns.length === 0 ? (
                    <div className="rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-400">
                      Пока нет ни одной кампании.
                    </div>
                  ) : (
                    campaigns.map((campaign) => (
                      <div
                        key={campaign.id}
                        className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-100"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-slate-900">
                              {campaign.title}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {campaign.kind === 'promo' ? 'Акция' : 'Новость'} •{' '}
                              {campaign.audience_mode === 'branches_only'
                                ? 'По филиалам'
                                : 'Все opt-in пользователи'}
                            </div>
                          </div>

                          <StatusChip
                            tone={
                              campaign.status === 'sent'
                                ? 'ok'
                                : campaign.status === 'cancelled'
                                ? 'danger'
                                : campaign.status === 'scheduled' ||
                                  campaign.status === 'queued'
                                ? 'warn'
                                : 'neutral'
                            }
                          >
                            {campaign.status}
                          </StatusChip>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-600 md:grid-cols-4">
                          <div>
                            <div className="uppercase tracking-wide text-slate-400">
                              Создано
                            </div>
                            <div className="mt-1">{formatDate(campaign.created_at)}</div>
                          </div>
                          <div>
                            <div className="uppercase tracking-wide text-slate-400">
                              Отправка
                            </div>
                            <div className="mt-1">{formatDate(campaign.send_at)}</div>
                          </div>
                          <div>
                            <div className="uppercase tracking-wide text-slate-400">
                              Успешно
                            </div>
                            <div className="mt-1">{campaign.sent_count}</div>
                          </div>
                          <div>
                            <div className="uppercase tracking-wide text-slate-400">
                              Ошибки
                            </div>
                            <div className="mt-1">{campaign.failed_count}</div>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {campaign.status !== 'cancelled' && campaign.status !== 'sent' ? (
                            <SoftPrimaryButton
                              onClick={() => void queueCampaignNow(campaign.id)}
                              disabled={busyCampaignId === campaign.id}
                            >
                              <Send className="mr-2 inline h-4 w-4" />
                              {busyCampaignId === campaign.id
                                ? 'Отправка…'
                                : 'Отправить сейчас'}
                            </SoftPrimaryButton>
                          ) : null}

                          {campaign.status !== 'cancelled' ? (
                            <SoftGhostButton
                              onClick={() =>
                                void changeCampaignStatus(campaign.id, 'cancelled')
                              }
                              disabled={busyCampaignId === campaign.id}
                            >
                              Отменить
                            </SoftGhostButton>
                          ) : null}

                          {campaign.status === 'cancelled' ? (
                            <SoftGhostButton
                              onClick={() =>
                                void changeCampaignStatus(campaign.id, 'draft')
                              }
                              disabled={busyCampaignId === campaign.id}
                            >
                              Вернуть в черновик
                            </SoftGhostButton>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </SectionCard>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <SectionCard title="Последние элементы очереди">
              <div className="space-y-3">
                {queue.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-400">
                    Очередь пока пустая.
                  </div>
                ) : (
                  queue.slice(0, 4).map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-100"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            {ruleLabels[item.kind]}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {formatDate(item.scheduled_at)}
                          </div>
                        </div>

                        <StatusChip
                          tone={
                            item.status === 'sent'
                              ? 'ok'
                              : item.status === 'failed'
                              ? 'danger'
                              : item.status === 'processing'
                              ? 'warn'
                              : 'neutral'
                          }
                        >
                          {item.status}
                        </StatusChip>
                      </div>

                      <div className="mt-2 text-xs text-slate-500">
                        {item.order_id ? `order_id: ${item.order_id}` : null}
                        {item.customer_id ? ` customer_id: ${item.customer_id}` : null}
                        {item.campaign_id ? ` campaign_id: ${item.campaign_id}` : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </SectionCard>

            <SectionCard title="Журнал действий">
              <div className="space-y-3">
                {logs.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-400">
                    Журнал пока пустой.
                  </div>
                ) : (
                  logs.slice(0, 4).map((log) => (
                    <div
                      key={log.id}
                      className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-100"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-slate-900">
                            {log.message || 'Событие без текста'}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {log.source} • {log.kind}
                          </div>
                        </div>

                        <StatusChip
                          tone={
                            log.status === 'success'
                              ? 'ok'
                              : log.status === 'warning'
                              ? 'warn'
                              : log.status === 'error'
                              ? 'danger'
                              : 'neutral'
                          }
                        >
                          {log.status}
                        </StatusChip>
                      </div>

                      <div className="mt-2 text-xs text-slate-500">
                        {formatDate(log.created_at)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
}