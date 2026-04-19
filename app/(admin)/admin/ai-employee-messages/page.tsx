'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AICenterTabs from './AICenterTabs';
import {
  AlertTriangle,
  Bot,
  Brain,
  Building2,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Loader2,
  Sparkles,
  Target,
  TrendingUp,
  UserRound,
  XCircle,
} from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';

type DraftRow = {
  id: number;
  employee_id: number;
  branch_id: number;
  report_type: string;
  period_type: string;
  period_start: string;
  status: string;
  prompt_version: string | null;
  model_provider: string | null;
  model_name: string | null;
  message_text: string | null;
  message_parts: string[] | null;
  generation_error: string | null;
  updated_at: string | null;
};

type ContextRow = {
  employee_id: number;
  branch_id: number;
  week_start: string;
  employee_name: string | null;
  branch_name: string | null;
  base_llm_payload: unknown;
  previous_messages_same_employee: unknown;
  recent_messages_all_employees: unknown;
  banned_phrases: unknown;
};

type UiStatus = 'generated' | 'pending' | 'failed';

type MetricSignals = {
  revenue: number | null;
  newOrders: number | null;
  returningClients: number | null;
  avgCheckDeltaPct: number | null;
  penalties: number | null;
  lateMinutes: number | null;
  shipmentCount: number | null;
};

type UiRow = {
  draft_id: number | null;
  employee_id: number;
  branch_id: number;
  employee_name: string;
  branch_name: string;
  week_start: string;
  status: string;
  logical_status: UiStatus;
  prompt_version: string | null;
  model_name: string | null;
  message_text: string | null;
  message_parts: string[] | null;
  generation_error: string | null;
  updated_at: string | null;
  base_llm_payload: unknown;
  signals: MetricSignals;
};

type NoticeState =
  | {
      type: 'success' | 'error' | 'info';
      text: string;
    }
  | null;

type InsightPack = {
  strengths: string[];
  risks: string[];
  focus: string[];
  forecast: string;
};

const STATUS_META: Record<
  UiStatus,
  {
    label: string;
    cardRing: string;
    cardBg: string;
    chipClass: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  generated: {
    label: 'Готово',
    cardRing: 'ring-emerald-200',
    cardBg: 'from-white via-emerald-50/80 to-sky-50/80',
    chipClass:
      'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    icon: CheckCircle2,
  },
  pending: {
    label: 'Ожидает',
    cardRing: 'ring-sky-200',
    cardBg: 'from-white via-slate-50 to-sky-50/80',
    chipClass: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
    icon: Clock3,
  },
  failed: {
    label: 'Ошибка',
    cardRing: 'ring-rose-200',
    cardBg: 'from-white via-rose-50/80 to-amber-50/80',
    chipClass: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
    icon: XCircle,
  },
};

function classNames(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(' ');
}

function deriveStatus(draft?: DraftRow | null): UiStatus {
  if (draft && (draft.message_text ?? '').trim()) return 'generated';
  if (draft && (draft.status === 'failed' || (draft.generation_error ?? '').trim())) {
    return 'failed';
  }
  return 'pending';
}

function formatWeekRange(weekStart: string) {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const fmt = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
  });

  const fmtYear = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return `${fmt.format(start)} — ${fmtYear.format(end)}`;
}

function formatDateTime(value: string | null) {
  if (!value) return '—';

  const date = new Date(value);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatMoney(value: number | null) {
  if (value === null || Number.isNaN(value)) return '—';
  return `${new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 1,
  }).format(value)} тыс.`;
}

function formatPlainNumber(value: number | null) {
  if (value === null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(0)}%`;
}

function splitParagraphs(text: string | null) {
  return (text ?? '')
    .split(/\n\s*\n/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeKey(input: string) {
  return input.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
}

function flattenPayload(
  value: unknown,
  bucket: Array<{ key: string; value: unknown }>,
  parentKey = '',
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      flattenPayload(item, bucket, `${parentKey}[${index}]`);
    });
    return;
  }

  if (value && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, val]) => {
      const nextKey = parentKey ? `${parentKey}.${key}` : key;
      bucket.push({ key: nextKey, value: val });
      flattenPayload(val, bucket, nextKey);
    });
  }
}

function pickNumberFromPayload(payload: unknown, aliases: string[]) {
  if (!payload || typeof payload !== 'object') return null;

  const flat: Array<{ key: string; value: unknown }> = [];
  flattenPayload(payload, flat);

  const normalizedAliases = aliases.map(normalizeKey);

  for (const item of flat) {
    const itemKey = normalizeKey(item.key);
    const numeric =
      typeof item.value === 'number'
        ? item.value
        : typeof item.value === 'string'
          ? Number(item.value.replace(',', '.'))
          : NaN;

    if (Number.isNaN(numeric)) continue;

    if (normalizedAliases.some((alias) => itemKey.endsWith(alias) || itemKey.includes(alias))) {
      return numeric;
    }
  }

  return null;
}

function extractSignals(payload: unknown): MetricSignals {
  return {
    revenue:
      pickNumberFromPayload(payload, [
        'paid_total',
        'paid_amount',
        'paid_sum',
        'payments_total',
        'revenue_total',
        'turnover_total',
        'turnover',
      ]) ?? null,
    newOrders:
      pickNumberFromPayload(payload, [
        'new_orders_count',
        'orders_new_count',
        'new_orders',
      ]) ?? null,
    returningClients:
      pickNumberFromPayload(payload, [
        'returning_clients_count',
        'repeat_clients_count',
        'return_clients_count',
        'returning_count',
      ]) ?? null,
    avgCheckDeltaPct:
      pickNumberFromPayload(payload, [
        'avg_check_change_pct',
        'avg_check_delta_pct',
        'average_check_change_pct',
        'average_check_delta_pct',
        'avgcheckchangepct',
      ]) ?? null,
    penalties:
      pickNumberFromPayload(payload, [
        'penalties_sum',
        'penalty_total',
        'penalties_total',
        'total_penalties',
        'penalties_amount',
      ]) ?? null,
    lateMinutes:
      pickNumberFromPayload(payload, [
        'late_minutes',
        'lateness_minutes',
        'total_late_minutes',
        'late_total_minutes',
      ]) ?? null,
    shipmentCount:
      pickNumberFromPayload(payload, [
        'shipment_count',
        'delivered_count',
        'shipments_count',
      ]) ?? null,
  };
}

function textHas(text: string, pattern: RegExp) {
  return pattern.test(text.toLowerCase());
}

function buildEmployeeFlags(row: UiRow) {
  const text = `${row.message_text ?? ''} ${row.generation_error ?? ''}`.toLowerCase();

  const disciplineRisk =
    (row.signals.lateMinutes ?? 0) >= 180 ||
    textHas(text, /опоздан|дисциплин|минут|сдвиг|приход в смену/);

  const avgCheckRisk =
    (row.signals.avgCheckDeltaPct ?? 0) <= -10 ||
    textHas(text, /чек просел|средний чек|допродаж|минимальн(ом|ый) варианте/);

  const penaltiesRisk =
    (row.signals.penalties ?? 0) > 0 ||
    textHas(text, /штраф/);

  const revenueStrength =
    (row.signals.revenue ?? 0) > 0 ||
    textHas(text, /сильн|хороший результат|лучше|рост|прибавил|подрос/);

  const clientsStrength =
    (row.signals.returningClients ?? 0) > 0 ||
    textHas(text, /возвратн|клиент(ов|ы) стало больше/);

  return {
    disciplineRisk,
    avgCheckRisk,
    penaltiesRisk,
    revenueStrength,
    clientsStrength,
  };
}

function buildOverallInsights(rows: UiRow[]): InsightPack {
  if (rows.length === 0) {
    return {
      strengths: ['Данных по неделе пока нет.'],
      risks: ['AI-картина появится после загрузки контекста и draft.'],
      focus: ['Сначала нужно получить хотя бы один рабочий набор данных по неделе.'],
      forecast: 'Без данных прогноз пока делать нельзя.',
    };
  }

  const generatedRows = rows.filter((row) => row.logical_status === 'generated');
  const failedRows = rows.filter((row) => row.logical_status === 'failed');
  const pendingRows = rows.filter((row) => row.logical_status === 'pending');

  const flags = rows.map(buildEmployeeFlags);

  const disciplineCount = flags.filter((f) => f.disciplineRisk).length;
  const avgCheckCount = flags.filter((f) => f.avgCheckRisk).length;
  const penaltiesCount = flags.filter((f) => f.penaltiesRisk).length;
  const revenueCount = flags.filter((f) => f.revenueStrength).length;
  const clientGrowthCount = flags.filter((f) => f.clientsStrength).length;

  const revenueTotal = rows.reduce((sum, row) => {
    return sum + ((row.signals.revenue ?? 0) > 0 ? (row.signals.revenue ?? 0) : 0);
  }, 0);

  const strengths: string[] = [];
  const risks: string[] = [];
  const focus: string[] = [];

  if (revenueCount > 0) {
    strengths.push(
      `По части выручки и оплат есть живое движение: сильный денежный сигнал виден у ${revenueCount} сотрудников.`,
    );
  }

  if (clientGrowthCount > 0) {
    strengths.push(
      `Возвратные клиенты и повторные продажи тоже дают хороший фон как минимум у ${clientGrowthCount} сотрудников.`,
    );
  }

  if (generatedRows.length === rows.length) {
    strengths.push('Все сообщения по выбранной неделе уже собраны и готовы к дальнейшей работе.');
  } else {
    strengths.push(
      `AI-контур уже живой: готово ${generatedRows.length} из ${rows.length} сообщений по неделе.`,
    );
  }

  if (disciplineCount > 0) {
    risks.push(
      `Главный риск недели — дисциплина и опоздания. Красный сигнал есть у ${disciplineCount} сотрудников.`,
    );
  }

  if (avgCheckCount > 0) {
    risks.push(
      `Второй риск — средний чек и недосбор суммы заказа. Это проседает у ${avgCheckCount} сотрудников.`,
    );
  }

  if (penaltiesCount > 0) {
    risks.push(
      `Штрафы и потери по дисциплине продолжают съедать результат. Проблема заметна у ${penaltiesCount} сотрудников.`,
    );
  }

  if (failedRows.length > 0) {
    risks.push(`Есть ${failedRows.length} проблемных AI-сообщений, которые требуют ручной проверки.`);
  }

  if (disciplineCount > 0) {
    focus.push('Первым делом давить опоздания и любые сдвиги по приходу в смену.');
  }

  if (avgCheckCount > 0) {
    focus.push('Второй фокус — поднимать средний чек и не отпускать клиента на минимальном сценарии.');
  }

  if (pendingRows.length > 0) {
    focus.push(`Добить оставшиеся pending-сообщения: сейчас их ${pendingRows.length}.`);
  } else {
    focus.push('Следующий слой — approve/send flow и сводный AI-разбор по бизнесу.');
  }

  let forecast = 'Ситуация управляемая, но без дисциплины и без роста среднего чека результат будет нестабильным.';
  if (disciplineCount === 0 && avgCheckCount === 0 && generatedRows.length === rows.length) {
    forecast =
      'Фон по неделе ровный. Если сохранить дисциплину и не просадить чек, следующая неделя должна быть сильнее текущей.';
  } else if (disciplineCount > 0 && avgCheckCount > 0) {
    forecast =
      'Если не вмешаться, следующая неделя упрётся в те же две стены: опоздания и слабый чек. Рост выручки будет съедаться внутренними потерями.';
  }

  if (strengths.length === 0) strengths.push('Пока сильные стороны лучше читать после накопления ещё одной недели истории.');
  if (risks.length === 0) risks.push('Критических красных флагов по текущему набору данных не видно.');
  if (focus.length === 0) focus.push('Поддерживать текущий уровень и копить следующую неделю для сравнения.');

  if (revenueTotal > 0) {
    strengths.unshift(`По видимым данным через AI-контекст проходит около ${formatMoney(revenueTotal)} оплаченной выручки по выбранной неделе.`);
  }

  return { strengths, risks, focus, forecast };
}

function SoftPrimaryButton({
  children,
  className,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={classNames(
        'inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white',
        'shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400',
        'focus:outline-none focus:ring-2 focus:ring-cyan-300/70',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {children}
    </button>
  );
}

function SoftGhostButton({
  children,
  className,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={classNames(
        'inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-700',
        'ring-1 ring-slate-200 transition hover:bg-slate-50',
        'focus:outline-none focus:ring-2 focus:ring-cyan-300/70',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {children}
    </button>
  );
}

function StatBox({
  title,
  value,
  hint,
  tone = 'sky',
}: {
  title: string;
  value: string | number;
  hint: string;
  tone?: 'sky' | 'emerald' | 'amber' | 'rose';
}) {
  const ring =
    tone === 'emerald' ? 'ring-emerald-200' :
    tone === 'amber'   ? 'ring-amber-200' :
    tone === 'rose'    ? 'ring-rose-200' :
                         'ring-sky-100';

  return (
    <div className={classNames('rounded-2xl bg-white px-4 py-3 ring-1 shadow-[0_8px_30px_rgba(15,23,42,0.45)]', ring)}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-500">{hint}</div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        'rounded-full px-3 py-1.5 text-xs font-semibold transition',
        active
          ? 'bg-cyan-500 text-white ring-0 shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
          : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50',
      )}
    >
      {label}
    </button>
  );
}

function InsightCard({
  icon,
  title,
  lines,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  lines: string[];
  tone: 'sky' | 'emerald' | 'amber' | 'rose';
}) {
  const ring =
    tone === 'emerald' ? 'ring-emerald-200' :
    tone === 'amber'   ? 'ring-amber-200' :
    tone === 'rose'    ? 'ring-rose-200' :
                         'ring-sky-100';

  return (
    <div className={classNames('rounded-2xl bg-white p-4 ring-1 shadow-[0_8px_30px_rgba(15,23,42,0.45)]', ring)}>
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-500 text-white shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
          {icon}
        </div>
        <div className="text-sm font-semibold text-slate-900">{title}</div>
      </div>

      <div className="mt-2.5 space-y-1.5 text-[13px] leading-5 text-slate-700">
        {lines.map((line, index) => (
          <p key={`${title}-${index}`}>{line}</p>
        ))}
      </div>
    </div>
  );
}

export default function AIControlPage() {
  const supabase = useMemo(() => getBrowserSupabase(), []);

  const [rows, setRows] = useState<UiRow[]>([]);
  const [availableWeeks, setAvailableWeeks] = useState<string[]>([]);
  const [selectedWeek, setSelectedWeek] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | UiStatus>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [busyDraftId, setBusyDraftId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const loadRows = useCallback(
    async (forcedWeek?: string) => {
      setLoading(true);
      setNotice(null);

      try {
        const { data: draftData, error: draftError } = await supabase
          .from('ai_employee_message_drafts')
          .select(
            'id, employee_id, branch_id, report_type, period_type, period_start, status, prompt_version, model_provider, model_name, message_text, message_parts, generation_error, updated_at',
          )
          .eq('report_type', 'employee_latest_closed_week_message')
          .order('period_start', { ascending: false })
          .order('id', { ascending: true });

        if (draftError) throw new Error(draftError.message);

        const { data: contextData, error: contextError } = await supabase
          .from('v_ai_employee_message_generation_context')
          .select(
            'employee_id, branch_id, week_start, employee_name, branch_name, base_llm_payload, previous_messages_same_employee, recent_messages_all_employees, banned_phrases',
          )
          .order('week_start', { ascending: false })
          .order('employee_id', { ascending: true });

        if (contextError) throw new Error(contextError.message);

        const drafts = (draftData ?? []) as DraftRow[];
        const contexts = (contextData ?? []) as ContextRow[];

        const weekSet = new Set<string>();
        drafts.forEach((item) => {
          if (item.period_start) weekSet.add(item.period_start);
        });
        contexts.forEach((item) => {
          if (item.week_start) weekSet.add(item.week_start);
        });

        const weeks = Array.from(weekSet).sort((a, b) => b.localeCompare(a));
        setAvailableWeeks(weeks);

        const chosenWeek = forcedWeek || selectedWeek || weeks[0] || '';

        if (!chosenWeek) {
          setSelectedWeek('');
          setRows([]);
          setLoading(false);
          return;
        }

        if (chosenWeek !== selectedWeek) {
          setSelectedWeek(chosenWeek);
        }

        const draftWeekRows = drafts.filter((item) => item.period_start === chosenWeek);
        const contextWeekRows = contexts.filter((item) => item.week_start === chosenWeek);

        const draftMap = new Map<number, DraftRow>();
        draftWeekRows.forEach((item) => {
          draftMap.set(item.employee_id, item);
        });

        const contextMap = new Map<number, ContextRow>();
        contextWeekRows.forEach((item) => {
          contextMap.set(item.employee_id, item);
        });

        const employeeIds = Array.from(
          new Set<number>([
            ...draftWeekRows.map((item) => item.employee_id),
            ...contextWeekRows.map((item) => item.employee_id),
          ]),
        );

        const mergedRows: UiRow[] = employeeIds
          .map((employeeId) => {
            const draft = draftMap.get(employeeId) ?? null;
            const context = contextMap.get(employeeId) ?? null;

            const branchId =
              context?.branch_id ??
              draft?.branch_id ??
              0;

            const row: UiRow = {
              draft_id: draft?.id ?? null,
              employee_id: employeeId,
              branch_id: branchId,
              employee_name:
                (context?.employee_name ?? '').trim() || `Сотрудник #${employeeId}`,
              branch_name:
                (context?.branch_name ?? '').trim() || `Филиал #${branchId}`,
              week_start: context?.week_start ?? draft?.period_start ?? chosenWeek,
              status: draft?.status ?? 'pending',
              logical_status: deriveStatus(draft),
              prompt_version: draft?.prompt_version ?? null,
              model_name: draft?.model_name ?? null,
              message_text: draft?.message_text ?? null,
              message_parts: draft?.message_parts ?? null,
              generation_error: draft?.generation_error ?? null,
              updated_at: draft?.updated_at ?? null,
              base_llm_payload: context?.base_llm_payload ?? null,
              signals: extractSignals(context?.base_llm_payload ?? null),
            };

            return row;
          })
          .sort((a, b) => {
            const byBranch = a.branch_name.localeCompare(b.branch_name, 'ru');
            if (byBranch !== 0) return byBranch;
            return a.employee_name.localeCompare(b.employee_name, 'ru');
          });

        setRows(mergedRows);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Не удалось загрузить AI-данные';
        setNotice({ type: 'error', text: message });
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [selectedWeek, supabase],
  );

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const handleRefresh = async () => {
    await loadRows(selectedWeek || undefined);
  };

  const handleGenerateOne = async (draftId: number | null) => {
    if (!draftId) return;

    setBusyDraftId(draftId);
    setNotice(null);

    try {
      const { data, error } = await supabase.functions.invoke(
        'ai-employee-message-generate',
        {
          body: {
            draftId,
            model: 'gpt-5.4',
            maxAttempts: 4,
          },
        },
      );

      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'Функция вернула ошибку');

      setNotice({
        type: 'success',
        text: `Сообщение обновлено. Draft ${draftId}, попыток: ${data.attempts_used ?? 1}.`,
      });

      await loadRows(selectedWeek || undefined);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Ошибка генерации';
      setNotice({ type: 'error', text: message });
    } finally {
      setBusyDraftId(null);
    }
  };

  const handleGenerateAll = async () => {
    if (!selectedWeek) return;

    setBulkBusy(true);
    setNotice(null);

    try {
      const { data, error } = await supabase.functions.invoke(
        'ai-employee-message-generate-all',
        {
          body: {
            periodStart: selectedWeek,
            model: 'gpt-5.4',
            maxAttempts: 4,
            limit: 20,
          },
        },
      );

      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'Функция вернула ошибку');

      setNotice({
        type: 'success',
        text: `Обработано: ${data.processed ?? 0}. Успешно: ${data.success_count ?? 0}. Ошибок: ${data.failed_count ?? 0}.`,
      });

      await loadRows(selectedWeek);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Ошибка массовой генерации';
      setNotice({ type: 'error', text: message });
    } finally {
      setBulkBusy(false);
    }
  };

  const handleCopy = async (text: string | null) => {
    if (!(text ?? '').trim()) return;

    try {
      await navigator.clipboard.writeText(text ?? '');
      setNotice({ type: 'success', text: 'Текст скопирован.' });
    } catch {
      setNotice({ type: 'error', text: 'Не удалось скопировать текст.' });
    }
  };

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.logical_status !== statusFilter) {
        return false;
      }

      if (!query) return true;

      const haystack = [
        row.employee_name,
        row.branch_name,
        row.message_text ?? '',
        row.generation_error ?? '',
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [rows, search, statusFilter]);

  const stats = useMemo(() => {
    const total = rows.length;
    const generated = rows.filter((row) => row.logical_status === 'generated').length;
    const pending = rows.filter((row) => row.logical_status === 'pending').length;
    const failed = rows.filter((row) => row.logical_status === 'failed').length;
    const branches = new Set(rows.map((row) => row.branch_name)).size;

    const flags = rows.map(buildEmployeeFlags);
    const riskyEmployees = flags.filter(
      (item) => item.disciplineRisk || item.avgCheckRisk || item.penaltiesRisk,
    ).length;

    return { total, generated, pending, failed, branches, riskyEmployees };
  }, [rows]);

  const overallInsights = useMemo(() => buildOverallInsights(rows), [rows]);

  const branchCards = useMemo(() => {
    const grouped = new Map<
      string,
      {
        branchName: string;
        rows: UiRow[];
      }
    >();

    rows.forEach((row) => {
      const current = grouped.get(row.branch_name);
      if (current) {
        current.rows.push(row);
      } else {
        grouped.set(row.branch_name, {
          branchName: row.branch_name,
          rows: [row],
        });
      }
    });

    return Array.from(grouped.values()).map((group) => {
      const generated = group.rows.filter((row) => row.logical_status === 'generated').length;
      const pending = group.rows.filter((row) => row.logical_status === 'pending').length;
      const failed = group.rows.filter((row) => row.logical_status === 'failed').length;

      const revenue = group.rows.reduce(
        (sum, row) => sum + ((row.signals.revenue ?? 0) > 0 ? (row.signals.revenue ?? 0) : 0),
        0,
      );

      const lateMinutes = group.rows.reduce(
        (sum, row) => sum + ((row.signals.lateMinutes ?? 0) > 0 ? (row.signals.lateMinutes ?? 0) : 0),
        0,
      );

      const penalties = group.rows.reduce(
        (sum, row) => sum + ((row.signals.penalties ?? 0) > 0 ? (row.signals.penalties ?? 0) : 0),
        0,
      );

      const issueTexts: string[] = [];
      if (lateMinutes > 0) issueTexts.push(`Опоздания: ${formatPlainNumber(lateMinutes)} мин`);
      if (penalties > 0) issueTexts.push(`Штрафы: ${formatPlainNumber(penalties)}`);
      if (pending > 0) issueTexts.push(`Pending: ${pending}`);
      if (failed > 0) issueTexts.push(`Ошибки: ${failed}`);
      if (issueTexts.length === 0) issueTexts.push('Критичных красных флагов не видно');

      return {
        branchName: group.branchName,
        rows: group.rows,
        generated,
        pending,
        failed,
        revenue,
        lateMinutes,
        penalties,
        issueSummary: issueTexts.join(' • '),
      };
    });
  }, [rows]);

  const pendingCount = rows.filter((row) => row.logical_status === 'pending').length;

  /* Group filtered rows by branch for visual sectioning */
  const groupedFiltered = useMemo(() => {
    const map = new Map<string, UiRow[]>();
    filteredRows.forEach((row) => {
      const list = map.get(row.branch_name);
      if (list) list.push(row);
      else map.set(row.branch_name, [row]);
    });
    return Array.from(map.entries()); // [branchName, rows[]]
  }, [filteredRows]);

  return (
    <div className="text-slate-50">
      <div>
        {/* Header (бренд-стандарт) */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
              <Brain className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold tracking-tight text-slate-50">AI контроль</div>
              <div className="mt-0.5 text-[12px] text-cyan-300/50">
                Еженедельные сообщения для сотрудников
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <select
                value={selectedWeek}
                onChange={(e) => { setSelectedWeek(e.target.value); void loadRows(e.target.value); }}
                className="appearance-none rounded-xl bg-white pl-3 pr-8 py-2 text-xs font-medium text-slate-700 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70"
              >
                {availableWeeks.map((w) => <option key={w} value={w}>{formatWeekRange(w)}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
            </div>

            <SoftPrimaryButton onClick={handleGenerateAll} disabled={!selectedWeek || loading || bulkBusy || pendingCount === 0}>
              {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {pendingCount > 0 ? `Сгенерировать (${pendingCount})` : 'Всё готово'}
            </SoftPrimaryButton>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          </div>
        </div>

        {/* ── Stats row ── */}
        <div className="mb-5 rounded-2xl bg-white p-4 ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <div className="grid grid-cols-4 gap-2">
            <div className="text-center"><div className="text-2xl font-bold text-slate-900">{stats.total}</div><div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 mt-0.5">в контуре</div></div>
            <div className="text-center"><div className="text-2xl font-bold text-emerald-600">{stats.generated}</div><div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 mt-0.5">готово</div></div>
            <div className="text-center"><div className="text-2xl font-bold text-amber-600">{stats.riskyEmployees}</div><div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 mt-0.5">риски</div></div>
            <div className="text-center"><div className="text-2xl font-bold text-slate-700">{stats.branches}</div><div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 mt-0.5">филиалов</div></div>
          </div>
        </div>

        <AICenterTabs />

        {notice && (
          <div className={classNames(
            'mb-3 rounded-xl px-4 py-2 text-xs ring-1',
            notice.type === 'success' && 'bg-emerald-50 text-emerald-700 ring-emerald-200',
            notice.type === 'error' && 'bg-rose-50 text-rose-700 ring-rose-200',
            notice.type === 'info' && 'bg-sky-50 text-sky-700 ring-sky-200',
          )}>
            {notice.text}
          </div>
        )}

        {/* ── AI Summary + Filters (one card) ── */}
        <section className="mb-4 rounded-2xl bg-white p-5 ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <div className="flex items-center gap-2 mb-3">
            <Bot className="h-4 w-4 text-cyan-600" />
            <span className="text-sm font-semibold text-slate-800">AI-сводка недели</span>
          </div>

          <div className="space-y-1.5 text-[13px] leading-5">
            <div className="flex gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
              <span className="text-slate-700">{overallInsights.strengths.join(' ')}</span>
            </div>
            <div className="flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500 mt-0.5" />
              <span className="text-slate-700">{overallInsights.risks.join(' ')}</span>
            </div>
            <div className="flex gap-2">
              <Target className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
              <span className="text-slate-700">{overallInsights.focus.join(' ')}</span>
            </div>
            <div className="flex gap-2">
              <TrendingUp className="h-4 w-4 shrink-0 text-sky-500 mt-0.5" />
              <span className="text-slate-700">{overallInsights.forecast}</span>
            </div>
          </div>

          {/* Filters inline */}
          <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1.5">
              <FilterChip label={`Все (${rows.length})`} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
              <FilterChip label={`Готово (${stats.generated})`} active={statusFilter === 'generated'} onClick={() => setStatusFilter('generated')} />
              <FilterChip label={`Ожидают (${stats.pending})`} active={statusFilter === 'pending'} onClick={() => setStatusFilter('pending')} />
              <FilterChip label={`Ошибки (${stats.failed})`} active={statusFilter === 'failed'} onClick={() => setStatusFilter('failed')} />
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск…"
              className="w-full sm:w-[240px] rounded-xl bg-white px-3 py-2 text-xs text-slate-900 ring-1 ring-sky-200 placeholder:text-slate-400 outline-none transition focus:ring-2 focus:ring-cyan-400/70"
            />
          </div>
        </section>

        {/* ── Employee cards grouped by branch ── */}
        <div className="mt-4">
          {loading && (
            <div className="space-y-3">
              {[1, 2, 3].map((k) => (
                <div key={k} className="animate-pulse rounded-2xl bg-white p-4 ring-1 ring-sky-100">
                  <div className="h-5 w-40 rounded bg-slate-200" />
                  <div className="mt-3 h-4 w-full rounded bg-slate-200" />
                  <div className="mt-2 h-4 w-3/4 rounded bg-slate-200" />
                </div>
              ))}
            </div>
          )}

          {!loading && filteredRows.length === 0 && (
            <div className="rounded-2xl bg-white px-5 py-8 text-center ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
              <div className="text-sm font-semibold text-slate-600">Нет данных по этой неделе</div>
            </div>
          )}

          {!loading && groupedFiltered.map(([branchName, branchRows]) => (
            <div key={branchName} className="mt-4 first:mt-0">
              {/* Branch divider */}
              <div className="flex items-center gap-2 mb-2">
                <Building2 className="h-4 w-4 text-cyan-600" />
                <span className="text-xs font-bold uppercase tracking-widest text-slate-500">{branchName}</span>
                <div className="flex-1 h-px bg-slate-200/80" />
                <span className="text-[10px] text-slate-400">{branchRows.filter(r => r.logical_status === 'generated').length}/{branchRows.length}</span>
              </div>

              <div className="space-y-2">
                {branchRows.map((row) => {
                  const meta = STATUS_META[row.logical_status];
                  const StatusIcon = meta.icon;
                  const flags = buildEmployeeFlags(row);

                  /* ── Pending / Failed: compact single-line row ── */
                  if (row.logical_status !== 'generated') {
                    return (
                      <div
                        key={`${row.employee_id}-${row.week_start}`}
                        className={classNames(
                          'flex items-center gap-3 rounded-xl px-4 py-2.5 ring-1',
                          meta.cardRing,
                          row.logical_status === 'failed' ? 'bg-rose-50/60' : 'bg-white',
                        )}
                      >
                        <UserRound className="h-4 w-4 text-slate-400 shrink-0" />
                        <span className="text-sm font-medium text-slate-800 truncate">{row.employee_name}</span>
                        <span className={classNames('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', meta.chipClass)}>
                          <StatusIcon className="h-3 w-3" />
                          {meta.label}
                        </span>
                        {row.generation_error && (
                          <span className="hidden sm:inline text-[11px] text-rose-600 truncate max-w-[200px]">{row.generation_error}</span>
                        )}
                        <span className="ml-auto" />
                        <SoftPrimaryButton
                          className="!px-3 !py-1 !text-xs"
                          onClick={() => void handleGenerateOne(row.draft_id)}
                          disabled={!row.draft_id || busyDraftId === row.draft_id || bulkBusy}
                        >
                          {busyDraftId === row.draft_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                          Сгенерировать
                        </SoftPrimaryButton>
                      </div>
                    );
                  }

                  /* ── Generated: full card with text ── */
                  const paragraphs = splitParagraphs(row.message_text);
                  const miniSignals: string[] = [];
                  if ((row.signals.revenue ?? 0) > 0) miniSignals.push(`${formatMoney(row.signals.revenue)}`);
                  if (row.signals.avgCheckDeltaPct !== null) miniSignals.push(`чек ${formatPercent(row.signals.avgCheckDeltaPct)}`);
                  if ((row.signals.penalties ?? 0) > 0) miniSignals.push(`штрафы: ${formatPlainNumber(row.signals.penalties)}`);
                  if ((row.signals.lateMinutes ?? 0) > 0) miniSignals.push(`опозд: ${formatPlainNumber(row.signals.lateMinutes)} мин`);

                  return (
                    <div
                      key={`${row.employee_id}-${row.week_start}`}
                      className="rounded-2xl bg-white p-4 ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]"
                    >
                      {/* Name + badges row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-900">{row.employee_name}</span>
                        {miniSignals.length > 0 && (
                          <span className="text-[11px] text-slate-500">{miniSignals.join(' · ')}</span>
                        )}
                        <span className="ml-auto" />
                        {flags.disciplineRisk && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 ring-1 ring-rose-200">Дисциплина</span>}
                        {flags.avgCheckRisk && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">Чек</span>}
                        {flags.penaltiesRisk && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 ring-1 ring-rose-200">Штрафы</span>}
                        {!flags.disciplineRisk && !flags.avgCheckRisk && !flags.penaltiesRisk && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">OK</span>
                        )}
                      </div>

                      {/* Message text */}
                      <div className="mt-2 text-[13px] leading-5 text-slate-700">
                        {paragraphs.map((p, i) => <p key={i} className={i > 0 ? 'mt-1.5' : ''}>{p}</p>)}
                      </div>

                      {/* Actions */}
                      <div className="mt-2.5 flex items-center gap-2">
                        <button
                          onClick={() => void handleCopy(row.message_text)}
                          disabled={!(row.message_text ?? '').trim()}
                          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 transition disabled:opacity-40"
                        >
                          <Copy className="h-3 w-3" /> Копировать
                        </button>
                        <button
                          onClick={() => void handleGenerateOne(row.draft_id)}
                          disabled={!row.draft_id || busyDraftId === row.draft_id || bulkBusy}
                          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium text-cyan-700 hover:bg-cyan-50 transition disabled:opacity-40"
                        >
                          {busyDraftId === row.draft_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                          Заново
                        </button>
                        <span className="ml-auto text-[10px] text-slate-400">{formatDateTime(row.updated_at)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}