'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  Ban,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Clock3,
  Eye,
  FileText,
  Globe,
  Layers,
  MapPin,
  MessageSquare,
  Minus,
  Phone,
  Send,
  ShieldAlert,
  Star,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import toast from 'react-hot-toast';

// ─── Типы ──────────────────────────────────────────────────────────────────────

type FranchiseeStatus =
  | 'candidate'
  | 'reviewing'
  | 'approved'
  | 'searching_location'
  | 'renovation'
  | 'training'
  | 'active'
  | 'enhanced_control'
  | 'frozen'
  | 'termination';

type Zone = 'green' | 'yellow' | 'red';
type SortKey = 'name' | 'revenue' | 'plan_pct' | 'service' | 'violations' | 'zone';
type SortDir = 'asc' | 'desc';
type ContactStatus = 'ok' | 'low' | 'critical';

type LaunchStep = {
  label: string;
  done: boolean;
  deadline?: string;
  responsible?: string;
};

type Violation = {
  date: string;
  type: string;
  severity: 'low' | 'medium' | 'critical';
  fixed: boolean;
  comment: string;
};

type StaffMember = {
  name: string;
  role: string;
  trained: boolean;
  hasQa: boolean;
  serviceRating: number | null;
  hasWarning: boolean;
};

type Franchisee = {
  id: number;
  name: string;
  company: string;
  country: string;
  city: string;
  phone: string;
  email: string;
  manager: string;
  startDate: string;
  status: FranchiseeStatus;
  points: number;
  zone: Zone;
  revenueMonth: number | null;
  revenueLastMonth: number | null;
  revenuePlan: number | null;
  avgCheck: number | null;
  ordersMonth: number;
  serviceRating: number | null;
  violations: number;
  openTasks: number;
  canExpand: boolean;
  needsApproval: boolean;
  supplyStatus: 'ok' | 'low' | 'critical';
  contactStatus: ContactStatus;
  launchSteps: LaunchStep[];
  violationList: Violation[];
  staff: StaffMember[];
  lastInspection: string | null;
  hasFreshQa: boolean;
  hasContactGap: boolean;
  notes: string;
};

type BranchRow = {
  id: number;
  name: string | null;
  country_id: string | null;
  franchise_countries:
    | { name: string | null }
    | Array<{ name: string | null }>
    | null;
};

type BranchSettingsRow = {
  branch_id: number;
  branch_name: string | null;
  address: string | null;
  whatsapp_status_phone: string | null;
  seller_phones: string[] | null;
  updated_at: string | null;
};

type OrderRow = {
  branch_id: number | null;
  total_amount: number | string | null;
  created_at: string;
};

type EmployeeRow = {
  id: number;
  full_name: string | null;
  phone: string | null;
  branch_id: number | null;
};

type UserRoleRow = {
  user_id: string;
  email: string | null;
  branch_id: number | null;
  branch_name: string | null;
  role: 'owner' | 'manager' | 'seller' | 'master' | null;
};

type QaReportRow = {
  report_date: string;
  branch_id: number | null;
  employee_id: number | null;
  overall_score: number | null;
  analyzed_chunks: number | null;
  rude_count: number | null;
  pushy_count: number | null;
  interrupted_count: number | null;
};

type QaEmployeeAgg = {
  sum: number;
  count: number;
  hasWarning: boolean;
};

type OrderAgg = {
  revenueMonth: number;
  revenueLastMonth: number;
  ordersMonth: number;
};

// ─── Данные ────────────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);

const ZONE_PRIORITY: Record<Zone, number> = { red: 3, yellow: 2, green: 1 };

const COUNTRY_LABELS: Record<string, string> = {
  kg: 'Кыргызстан',
  kz: 'Казахстан',
  ru: 'Россия',
  uz: 'Узбекистан',
};

/* const FRANCHISEES: Franchisee[] = [
  {
    id: 1,
    name: 'Айгерим Сатыбалдиева',
    company: 'ОсОО «Рефокус Ош»',
    country: 'Кыргызстан',
    city: 'Ош',
    phone: '+996 700 123 456',
    email: 'osh@refocus.kg',
    manager: 'Болот (ГО)',
    startDate: '2024-03-15',
    status: 'active',
    points: 2,
    zone: 'green',
    revenueMonth: 1_240_000,
    revenueLastMonth: 1_090_000,
    revenuePlan: 1_100_000,
    avgCheck: 4_800,
    serviceRating: 87,
    violations: 0,
    openTasks: 1,
    canExpand: true,
    needsApproval: false,
    supplyStatus: 'ok',
    lastInspection: '2026-03-10',
    notes: 'Сильный партнёр. Стабильно выполняет план, сервис выше нормы. Готова к открытию третьей точки.',
    launchSteps: [],
    violationList: [],
    staff: [
      { name: 'Гүлнара Исакова', role: 'Продавец', trained: true, serviceRating: 89, hasWarning: false },
      { name: 'Чолпон Тойчуева', role: 'Мастер', trained: true, serviceRating: 84, hasWarning: false },
      { name: 'Айдай Орозбекова', role: 'Управляющая', trained: true, serviceRating: 91, hasWarning: false },
    ],
  },
  {
    id: 2,
    name: 'Данияр Эргешев',
    company: 'ИП Эргешев Д.К.',
    country: 'Кыргызстан',
    city: 'Джалал-Абад',
    phone: '+996 555 987 654',
    email: 'jalal@refocus.kg',
    manager: 'Болот (ГО)',
    startDate: '2024-11-01',
    status: 'active',
    points: 1,
    zone: 'yellow',
    revenueMonth: 620_000,
    revenueLastMonth: 710_000,
    revenuePlan: 900_000,
    avgCheck: 3_900,
    serviceRating: 64,
    violations: 2,
    openTasks: 4,
    canExpand: false,
    needsApproval: false,
    supplyStatus: 'low',
    lastInspection: '2026-01-20',
    notes: 'Не выполняет план 3 месяца подряд. Сервис ниже нормы. Нужен звонок с разбором.',
    launchSteps: [],
    violationList: [
      { date: '2026-02-14', type: 'Несогласованная реклама в Instagram', severity: 'medium', fixed: false, comment: 'Размещал акции без согласования с ГО' },
      { date: '2026-03-05', type: 'Отклонение по ценам на оправы', severity: 'critical', fixed: false, comment: 'Цены завышены на 15% vs прайс-лист' },
    ],
    staff: [
      { name: 'Улан Момунов', role: 'Продавец', trained: false, serviceRating: 58, hasWarning: true },
      { name: 'Нурзат Кадырова', role: 'Мастер', trained: true, serviceRating: 70, hasWarning: false },
    ],
  },
  {
    id: 3,
    name: 'Мадина Токтосунова',
    company: 'ОсОО «Вижн Плюс»',
    country: 'Казахстан',
    city: 'Алматы',
    phone: '+7 707 456 7890',
    email: 'almaty@refocus.kz',
    manager: 'Болот (ГО)',
    startDate: '2026-01-10',
    status: 'renovation',
    points: 0,
    zone: 'yellow',
    revenueMonth: null,
    revenueLastMonth: null,
    revenuePlan: null,
    avgCheck: null,
    serviceRating: null,
    violations: 0,
    openTasks: 3,
    canExpand: false,
    needsApproval: true,
    supplyStatus: 'ok',
    lastInspection: null,
    notes: 'Ждёт согласования проекта дизайна от ГО. Просит ускорить. Дедлайн открытия — июнь 2026.',
    launchSteps: [
      { label: 'Заявка получена', done: true },
      { label: 'Кандидат одобрен', done: true },
      { label: 'Помещение найдено', done: true },
      { label: 'Помещение согласовано', done: true },
      { label: 'Проект дизайна согласован', done: false, deadline: '2026-04-10', responsible: 'Болот' },
      { label: 'Ремонт начат', done: false, deadline: '2026-04-20', responsible: 'Мадина' },
      { label: 'Ремонт завершён', done: false, deadline: '2026-05-20', responsible: 'Мадина' },
      { label: 'Оборудование заказано', done: false, deadline: '2026-04-25', responsible: 'ГО' },
      { label: 'Поставка линз отправлена', done: false, deadline: '2026-05-15', responsible: 'ГО' },
      { label: 'Персонал нанят', done: false, deadline: '2026-05-01', responsible: 'Мадина' },
      { label: 'Персонал обучен', done: false, deadline: '2026-05-20', responsible: 'ГО' },
      { label: 'Точка открыта', done: false, deadline: '2026-06-01', responsible: 'Мадина' },
    ],
    violationList: [],
    staff: [],
  },
  {
    id: 4,
    name: 'Тимур Абдрахманов',
    company: 'ИП Абдрахманов Т.',
    country: 'Кыргызстан',
    city: 'Каракол',
    phone: '+996 770 222 333',
    email: 'karakol@refocus.kg',
    manager: 'Болот (ГО)',
    startDate: '2025-12-20',
    status: 'enhanced_control',
    points: 1,
    zone: 'red',
    revenueMonth: 340_000,
    revenueLastMonth: 390_000,
    revenuePlan: 750_000,
    avgCheck: 2_800,
    serviceRating: 48,
    violations: 5,
    openTasks: 7,
    canExpand: false,
    needsApproval: false,
    supplyStatus: 'critical',
    lastInspection: '2026-02-28',
    notes: 'Критическая ситуация. Выручка 45% от плана. Сервис провален по QA. Готовится письменное предупреждение.',
    launchSteps: [],
    violationList: [
      { date: '2026-03-01', type: 'Грубость сотрудника с клиентом', severity: 'critical', fixed: false, comment: 'Зафиксировано через Service QA' },
      { date: '2026-03-08', type: 'Неутверждённые материалы на стенде', severity: 'medium', fixed: true, comment: 'Убрали после первого предупреждения' },
      { date: '2026-03-12', type: 'Нарушение матрицы оправ', severity: 'critical', fixed: false, comment: 'Продаёт неутверждённые бренды' },
      { date: '2026-03-18', type: 'Отклонение цен на линзы', severity: 'critical', fixed: false, comment: 'Демпинг — цены ниже прайса на 20%' },
      { date: '2026-03-25', type: 'Нет диагностики при продаже', severity: 'critical', fixed: false, comment: 'Service QA: 0 из 5 продаж с диагностикой' },
    ],
    staff: [
      { name: 'Азамат Джумалиев', role: 'Продавец', trained: false, serviceRating: 42, hasWarning: true },
      { name: 'Бегимай Сыдыкова', role: 'Мастер', trained: false, serviceRating: 55, hasWarning: true },
    ],
  },
  {
    id: 5,
    name: 'Нурлан Беков',
    company: 'ИП Беков Н.О.',
    country: 'Кыргызстан',
    city: 'Нарын',
    phone: '+996 700 777 888',
    email: 'naryn@refocus.kg',
    manager: 'Болот (ГО)',
    startDate: '2026-03-01',
    status: 'reviewing',
    points: 0,
    zone: 'yellow',
    revenueMonth: null,
    revenueLastMonth: null,
    revenuePlan: null,
    avgCheck: null,
    serviceRating: null,
    violations: 0,
    openTasks: 0,
    canExpand: false,
    needsApproval: false,
    supplyStatus: 'ok',
    lastInspection: null,
    notes: 'Кандидат на рассмотрении. Подал заявку на город Нарын. Нужно принять решение по одобрению.',
    launchSteps: [
      { label: 'Заявка получена', done: true },
      { label: 'Кандидат одобрен', done: false, deadline: '2026-04-15', responsible: 'Болот' },
      { label: 'Помещение найдено', done: false },
      { label: 'Помещение согласовано', done: false },
      { label: 'Проект дизайна согласован', done: false },
      { label: 'Ремонт начат', done: false },
      { label: 'Ремонт завершён', done: false },
      { label: 'Оборудование заказано', done: false },
      { label: 'Поставка линз отправлена', done: false },
      { label: 'Персонал нанят', done: false },
      { label: 'Персонал обучен', done: false },
      { label: 'Точка открыта', done: false },
    ],
    violationList: [],
    staff: [],
  },
]; */

// ─── Справочники ───────────────────────────────────────────────────────────────

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

function fmt(v: number | null) {
  if (v === null) return '—';
  return nf.format(v) + ' с';
}

function ratioPct(actual: number | null, base: number | null): number | null {
  if (actual === null || base === null || base <= 0) return null;
  return Math.round((actual / base) * 100);
}

function planPct(actual: number | null, plan: number | null): number | null {
  return ratioPct(actual, plan);
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstPhone(values: Array<string | null | undefined>) {
  return firstNonEmpty(...values);
}

function toDateOnly(value: string | null | undefined) {
  return value ? value.slice(0, 10) : null;
}

function avgRounded(values: Array<number | null | undefined>) {
  const nums = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!nums.length) return null;
  return Math.round(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function branchCountryName(branch: BranchRow) {
  const relation = Array.isArray(branch.franchise_countries)
    ? branch.franchise_countries[0]
    : branch.franchise_countries;
  const byRelation = firstNonEmpty(relation?.name);
  if (byRelation) return byRelation;
  const code = branch.country_id?.toLowerCase() ?? '';
  return COUNTRY_LABELS[code] ?? branch.country_id?.toUpperCase() ?? '—';
}

function buildViolationList(reports: QaReportRow[]) {
  const items: Violation[] = [];
  const ordered = [...reports].sort((a, b) => b.report_date.localeCompare(a.report_date));

  for (const row of ordered) {
    const rude = Number(row.rude_count ?? 0);
    const pushy = Number(row.pushy_count ?? 0);
    const interrupted = Number(row.interrupted_count ?? 0);
    const score = row.overall_score;

    if (rude > 0) {
      items.push({
        date: row.report_date,
        type: 'Грубость в общении',
        severity: 'critical',
        fixed: false,
        comment: `${rude} сигнал(ов) Service QA по грубости`,
      });
    }
    if (pushy > 0) {
      items.push({
        date: row.report_date,
        type: 'Давление на клиента',
        severity: pushy >= 2 ? 'critical' : 'medium',
        fixed: false,
        comment: `${pushy} сигнал(ов) Service QA по давлению`,
      });
    }
    if (interrupted > 0) {
      items.push({
        date: row.report_date,
        type: 'Перебивание клиента',
        severity: interrupted >= 2 ? 'critical' : 'medium',
        fixed: false,
        comment: `${interrupted} сигнал(ов) Service QA по перебиванию`,
      });
    }
    if (typeof score === 'number' && score < 60) {
      items.push({
        date: row.report_date,
        type: 'Низкий общий рейтинг сервиса',
        severity: score < 50 ? 'critical' : 'medium',
        fixed: false,
        comment: `Итоговый рейтинг ${Math.round(score)}/100`,
      });
    }
  }

  return items.slice(0, 6);
}

function deriveZone(params: {
  revenueMonth: number | null;
  revenueLastMonth: number | null;
  serviceRating: number | null;
  criticalOpenViolations: number;
  hasFreshQa: boolean;
}) {
  const salesPct = ratioPct(params.revenueMonth, params.revenueLastMonth);

  if (
    params.criticalOpenViolations > 0 ||
    (params.serviceRating !== null && params.serviceRating < 60) ||
    (salesPct !== null && salesPct < 70)
  ) {
    return 'red' as const;
  }

  if (
    !params.hasFreshQa ||
    (params.serviceRating !== null && params.serviceRating < 75) ||
    (salesPct !== null && salesPct < 95)
  ) {
    return 'yellow' as const;
  }

  return 'green' as const;
}

function deriveStatus(params: {
  zone: Zone;
  revenueMonth: number | null;
  revenueLastMonth: number | null;
  serviceRating: number | null;
  staffCount: number;
  hasFreshQa: boolean;
}) {
  const currentRevenue = params.revenueMonth ?? 0;
  const previousRevenue = params.revenueLastMonth ?? 0;

  if (params.zone === 'red') return 'enhanced_control' as const;
  if (currentRevenue === 0 && previousRevenue === 0 && params.staffCount === 0) return 'frozen' as const;
  if (!params.hasFreshQa || params.serviceRating === null) return 'reviewing' as const;
  if (currentRevenue === 0 && previousRevenue === 0) return 'reviewing' as const;
  return 'active' as const;
}

function buildNote(params: {
  address: string | null;
  revenueMonth: number | null;
  revenueLastMonth: number | null;
  serviceRating: number | null;
  openViolations: number;
  hasContactGap: boolean;
  hasFreshQa: boolean;
}) {
  const parts: string[] = [];
  const salesPct = ratioPct(params.revenueMonth, params.revenueLastMonth);

  if (params.address) parts.push(params.address);
  if ((params.revenueMonth ?? 0) > 0) parts.push(`Выручка за месяц ${fmt(params.revenueMonth)}.`);
  else parts.push('В этом месяце пока без выручки.');
  if (salesPct !== null) parts.push(`${salesPct}% к прошлому месяцу.`);
  if (params.serviceRating !== null) parts.push(`Service QA ${params.serviceRating}/100.`);
  else if (!params.hasFreshQa) parts.push('Свежих данных Service QA пока нет.');
  if (params.openViolations > 0) parts.push(`Открытых сигналов по QA: ${params.openViolations}.`);
  if (params.hasContactGap) parts.push('Контакты точки заполнены не полностью.');

  return parts.join(' ');
}

function isOverdue(deadline?: string): boolean {
  if (!deadline) return false;
  return deadline < TODAY;
}

const STATUS_LABELS: Record<FranchiseeStatus, string> = {
  candidate: 'Кандидат',
  reviewing: 'На рассмотрении',
  approved: 'Одобрен',
  searching_location: 'Поиск помещения',
  renovation: 'Ремонт',
  training: 'Обучение',
  active: 'Активный',
  enhanced_control: 'Усиленный контроль',
  frozen: 'Заморожен',
  termination: 'Расторжение',
};

const STATUS_BADGE: Record<FranchiseeStatus, string> = {
  candidate: 'bg-slate-100/90 text-slate-600 ring-1 ring-slate-200/80',
  reviewing: 'bg-sky-50/90 text-sky-700 ring-1 ring-sky-200/80',
  approved: 'bg-cyan-50/90 text-cyan-700 ring-1 ring-cyan-200/80',
  searching_location: 'bg-violet-50/90 text-violet-700 ring-1 ring-violet-200/80',
  renovation: 'bg-amber-50/90 text-amber-700 ring-1 ring-amber-200/80',
  training: 'bg-indigo-50/90 text-indigo-700 ring-1 ring-indigo-200/80',
  active: 'bg-emerald-50/90 text-emerald-700 ring-1 ring-emerald-200/80',
  enhanced_control: 'bg-orange-50/90 text-orange-700 ring-1 ring-orange-200/80',
  frozen: 'bg-slate-100/90 text-slate-500 ring-1 ring-slate-200/80',
  termination: 'bg-rose-50/90 text-rose-700 ring-1 ring-rose-200/80',
};

const ZONE_LEFT_BORDER: Record<Zone, string> = {
  green: 'border-l-[3px] border-emerald-400',
  yellow: 'border-l-[3px] border-amber-400',
  red: 'border-l-[3px] border-rose-400',
};

const ZONE_DOT: Record<Zone, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  red: 'bg-rose-500',
};

const CONTACT_INFO: Record<ContactStatus, { label: string; cls: string }> = {
  ok: { label: 'Контакт ок', cls: 'bg-emerald-50/90 text-emerald-700 ring-1 ring-emerald-200/80' },
  low: { label: 'Пробелы', cls: 'bg-amber-50/90 text-amber-700 ring-1 ring-amber-200/80' },
  critical: { label: 'Критично', cls: 'bg-rose-50/90 text-rose-700 ring-1 ring-rose-200/80 font-semibold' },
};

// ─── Мини-компоненты ───────────────────────────────────────────────────────────

const SUMMARY_COLOR_MAP: Record<string, { icon: string; glow: string; value: string }> = {
  sky: {
    icon: 'from-sky-400 via-cyan-400 to-teal-400',
    glow: 'from-sky-200/70 via-cyan-200/55 to-teal-200/45',
    value: 'text-slate-900',
  },
  emerald: {
    icon: 'from-emerald-400 via-teal-400 to-cyan-400',
    glow: 'from-emerald-200/70 via-teal-200/55 to-cyan-200/45',
    value: 'text-slate-900',
  },
  amber: {
    icon: 'from-amber-400 via-orange-300 to-rose-300',
    glow: 'from-amber-200/75 via-orange-200/55 to-rose-200/45',
    value: 'text-slate-900',
  },
  red: {
    icon: 'from-rose-400 via-orange-300 to-amber-300',
    glow: 'from-rose-200/75 via-orange-200/60 to-amber-200/45',
    value: 'text-rose-700',
  },
  violet: {
    icon: 'from-violet-400 via-indigo-400 to-sky-400',
    glow: 'from-violet-200/70 via-indigo-200/55 to-sky-200/45',
    value: 'text-slate-900',
  },
  slate: {
    icon: 'from-slate-700 via-slate-800 to-slate-900',
    glow: 'from-slate-200/75 via-slate-200/55 to-slate-100/45',
    value: 'text-slate-900',
  },
};

function SummaryCard({
  label, value, sub, icon: Icon, color = 'sky',
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color?: 'sky' | 'emerald' | 'amber' | 'red' | 'violet' | 'slate';
}) {
  const tone = SUMMARY_COLOR_MAP[color];
  return (
    <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/80 p-4 ring-1 ring-sky-200/55 shadow-[0_18px_60px_rgba(15,23,42,0.16)] backdrop-blur-xl transition hover:shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
      <div className={`pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full bg-gradient-to-br ${tone.glow} opacity-80 blur-2xl transition group-hover:opacity-100`} />
      <div className="relative z-10 flex items-start gap-3">
        <div className={`mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-[0_14px_40px_rgba(15,23,42,0.16)] ${tone.icon}`}>
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500/90">{label}</div>
          <div className={`mt-1 text-[22px] font-semibold leading-tight ${tone.value}`}>{value}</div>
          {sub && <div className="mt-1 text-[11px] text-slate-500">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

function AttentionCard({
  icon: Icon, iconCls, ringCls, title, items,
}: {
  icon: React.ElementType; iconCls: string; ringCls: string;
  title: string; items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div className={`rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/75 p-4 ring-1 shadow-[0_18px_55px_rgba(15,23,42,0.14)] backdrop-blur-xl ${ringCls}`}>
      <div className="mb-3 flex items-center gap-3">
        <div className={`grid h-10 w-10 place-items-center rounded-2xl bg-white/85 shadow-[0_12px_32px_rgba(15,23,42,0.10)] ring-1 ${ringCls}`}>
          <Icon size={16} className={iconCls} />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-slate-800">{title}</div>
          <div className="text-[11px] text-slate-500">{items.length} в списке</div>
        </div>
        <span className="ml-auto rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/70">
          {items.length}
        </span>
      </div>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 rounded-2xl bg-white/70 px-3 py-2 text-[12px] text-slate-600 ring-1 ring-white/70 shadow-[0_10px_26px_rgba(15,23,42,0.06)]">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RevTrend({ cur, prev }: { cur: number | null; prev: number | null }) {
  if (!cur || !prev) return null;
  const delta = cur - prev;
  const pct = Math.round(Math.abs(delta / prev) * 100);
  if (pct < 1) return <Minus size={11} className="text-slate-400" />;
  if (delta > 0)
    return (
      <span className="flex items-center gap-0.5 text-[10px] font-medium text-emerald-600">
        <ArrowUpRight size={10} />+{pct}%
      </span>
    );
  return (
    <span className="flex items-center gap-0.5 text-[10px] font-medium text-rose-600">
      <ArrowDownRight size={10} />-{pct}%
    </span>
  );
}

function LaunchProgress({ steps }: { steps: LaunchStep[] }) {
  const done = steps.filter((s) => s.done).length;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
  const overdueCount = steps.filter((s) => !s.done && isOverdue(s.deadline)).length;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] text-slate-600">Прогресс запуска</span>
        <div className="flex items-center gap-3">
          {overdueCount > 0 && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-rose-600">
              <AlertTriangle size={11} /> {overdueCount} просроченных
            </span>
          )}
          <span className="text-[12px] font-semibold text-slate-800">{done}/{steps.length} ({pct}%)</span>
        </div>
      </div>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-200/80">
        <div
          className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : overdueCount > 0 ? 'bg-red-500' : 'bg-sky-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
        {steps.map((step, i) => {
          const overdue = !step.done && isOverdue(step.deadline);
          return (
            <div
              key={i}
              className={`flex items-start gap-2.5 rounded-2xl px-3 py-2 ring-1 ${
                overdue
                  ? 'bg-rose-50/90 ring-rose-200/80'
                  : 'bg-white/80 ring-sky-100/80'
              }`}
            >
              {step.done ? (
                <CheckCircle2 size={13} className="mt-0.5 text-emerald-500 shrink-0" />
              ) : overdue ? (
                <AlertTriangle size={13} className="mt-0.5 text-rose-500 shrink-0" />
              ) : (
                <CircleDot size={13} className="mt-0.5 text-sky-500 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <span className={`text-[12px] ${step.done ? 'text-slate-400 line-through' : overdue ? 'text-rose-700' : 'text-slate-700'}`}>
                  {step.label}
                </span>
                {!step.done && step.deadline && (
                  <span className={`ml-2 text-[10px] ${overdue ? 'font-semibold text-rose-600' : 'text-amber-600'}`}>
                    {overdue ? '⚠ просрочено' : `до ${step.deadline}`}
                  </span>
                )}
              </div>
              {!step.done && step.responsible && (
                <span className="text-[10px] text-slate-500 shrink-0">{step.responsible}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ViolationList({ violations }: { violations: Violation[] }) {
  const sevCls = { low: 'text-slate-500', medium: 'text-amber-700', critical: 'text-rose-700' };
  const sevLabel = { low: 'Низкий', medium: 'Средний', critical: 'Критический' };
  if (violations.length === 0)
    return (
      <div className="inline-flex items-center gap-2 rounded-2xl bg-emerald-50/90 px-4 py-3 text-[12px] font-medium text-emerald-700 ring-1 ring-emerald-200/80">
        <CheckCircle2 size={13} /> Нарушений нет
      </div>
    );
  return (
    <div className="space-y-2">
      {violations.map((v, i) => (
        <div
          key={i}
          className={`rounded-2xl px-4 py-3 ring-1 shadow-[0_12px_32px_rgba(15,23,42,0.08)] ${
            v.fixed
              ? 'bg-white/80 ring-sky-100/80'
              : 'bg-gradient-to-br from-white via-rose-50/80 to-amber-50/70 ring-rose-200/80'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <span className={`text-[11px] font-semibold ${sevCls[v.severity]}`}>[{sevLabel[v.severity]}]</span>
              <span className="ml-1.5 text-[12px] text-slate-800">{v.type}</span>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${v.fixed ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80' : 'bg-rose-50 text-rose-700 ring-1 ring-rose-200/80'}`}>
              {v.fixed ? 'Исправлено' : 'Открыто'}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">{v.date} · {v.comment}</div>
        </div>
      ))}
    </div>
  );
}

function StaffTable({ staff }: { staff: StaffMember[] }) {
  if (staff.length === 0)
    return <div className="text-[12px] text-slate-500">Персонал ещё не добавлен</div>;
  return (
    <div className="space-y-1.5">
      {staff.map((s, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl bg-white/80 px-3 py-2.5 ring-1 ring-sky-100/80 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium text-slate-800">{s.name}</div>
            <div className="text-[10px] text-slate-500">{s.role}</div>
          </div>
          <div className="flex items-center gap-2.5 text-[11px]">
            <span className={s.hasQa ? 'text-emerald-600' : 'text-amber-600'}>
              {s.hasQa ? 'QA есть' : 'Без QA'}
            </span>
            {s.serviceRating !== null && (
              <span className={
                s.serviceRating >= 75 ? 'text-emerald-600' :
                s.serviceRating >= 60 ? 'text-amber-600' : 'text-rose-600'
              }>
                ★ {s.serviceRating}
              </span>
            )}
            {s.hasWarning && <AlertTriangle size={11} className="text-rose-500" />}
          </div>
        </div>
      ))}
    </div>
  );
}

const ACTION_BTN_MAP: Record<string, string> = {
  sky: 'bg-sky-50/90 text-sky-700 ring-sky-200/80 hover:bg-sky-100/90',
  amber: 'bg-amber-50/90 text-amber-700 ring-amber-200/80 hover:bg-amber-100/90',
  emerald: 'bg-emerald-50/90 text-emerald-700 ring-emerald-200/80 hover:bg-emerald-100/90',
  red: 'bg-rose-50/90 text-rose-700 ring-rose-200/80 hover:bg-rose-100/90',
  violet: 'bg-violet-50/90 text-violet-700 ring-violet-200/80 hover:bg-violet-100/90',
  slate: 'bg-slate-100/90 text-slate-700 ring-slate-200/80 hover:bg-slate-200/80',
};

function SortTh({
  label, k, sort, onSort,
}: {
  label: string; k: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
}) {
  const active = sort.key === k;
  return (
    <button
      onClick={() => onSort(k)}
      className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest transition-colors ${active ? 'text-sky-700' : 'text-slate-500 hover:text-slate-700'}`}
    >
      {label}
      {active && (sort.dir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />)}
    </button>
  );
}

function NoteArea() {
  const [note, setNote] = useState('');
  return (
    <div className="mt-3">
      <div className="mb-1.5 text-[11px] text-slate-500">Внутренняя заметка</div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Запишите решение или наблюдение..."
        rows={3}
        className="w-full resize-none rounded-2xl bg-white/90 px-3 py-2 text-[12px] text-slate-800 placeholder:text-slate-400 ring-1 ring-sky-200/80 shadow-[0_14px_40px_rgba(15,23,42,0.08)] focus:outline-none focus:ring-2 focus:ring-cyan-400/70"
      />
    </div>
  );
}

// ─── Главный компонент ─────────────────────────────────────────────────────────

type FilterZone = 'all' | 'red' | 'yellow' | 'green';

export default function FranchisePage() {
  const [franchisees, setFranchisees] = useState<Franchisee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataWarning, setDataWarning] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [tabMap, setTabMap] = useState<Record<number, string>>({});
  const [filterZone, setFilterZone] = useState<FilterZone>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'zone', dir: 'desc' });
  const supabaseRef = useRef<ReturnType<typeof getBrowserSupabase> | null>(null);

  function sb() {
    if (!supabaseRef.current) supabaseRef.current = getBrowserSupabase();
    return supabaseRef.current;
  }

  function getTab(id: number) { return tabMap[id] ?? 'passport'; }
  function setTab(id: number, tab: string) { setTabMap((p) => ({ ...p, [id]: tab })); }

  /* ── Модалка создания франчайзи ── */
  const [showCreateModal, setShowCreateModal] = useState(false);

  async function handleCreateFranchisee(form: {
    orgName: string; branchName: string; countryId: string; city: string;
    contactName: string; contactPhone: string; contactEmail: string; workHours: string;
  }) {
    const TZ_MAP: Record<string, string> = { kg: 'Asia/Bishkek', uz: 'Asia/Tashkent', kz: 'Asia/Almaty', ru: 'Europe/Moscow' };
    const PH_MAP: Record<string, { code: string; mask: string }> = {
      kg: { code: '996', mask: '+996 000 000 000' },
      uz: { code: '998', mask: '+998 00 000 00 00' },
      kz: { code: '7', mask: '+7 000 000 00 00' },
      ru: { code: '7', mask: '+7 000 000 00 00' },
    };

    try {
      const supabase = sb();

      const { data: org, error: orgErr } = await supabase
        .from('organizations')
        .insert({ name: form.orgName, country_id: form.countryId })
        .select('id')
        .single();
      if (orgErr) throw orgErr;

      const ph = PH_MAP[form.countryId] ?? PH_MAP.kg;
      const { error: brErr } = await supabase.from('branches').insert({
        name: form.branchName,
        city: form.city || null,
        country_id: form.countryId,
        organization_id: org.id,
        timezone: TZ_MAP[form.countryId] ?? 'Asia/Bishkek',
        phone_code: ph.code,
        phone_mask: ph.mask,
        work_hours: form.workHours || '09:00-18:00',
      });
      if (brErr) throw brErr;

      toast.success(`Франчайзи "${form.orgName}" создан`);
      setShowCreateModal(false);
      window.location.reload();
    } catch (e: any) {
      toast.error(e?.message ?? 'Ошибка создания');
      throw e;
    }
  }

  function toggleSort(key: SortKey) {
    setSort((s) => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });
  }

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setLoadError(null);
      setDataWarning(null);

      try {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
        const qaSince = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const freshQaCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        const [
          branchesRes,
          settingsRes,
          ordersRes,
          employeesRes,
          rolesRes,
          qaRes,
        ] = await Promise.all([
          sb()
            .from('branches')
            .select('id, name, country_id, franchise_countries ( name )')
            .order('id', { ascending: true }),
          sb()
            .from('branches_with_settings')
            .select('branch_id, branch_name, address, whatsapp_status_phone, seller_phones, updated_at'),
          sb()
            .from('orders')
            .select('branch_id, total_amount, created_at')
            .gte('created_at', prevMonthStart),
          sb()
            .from('employees')
            .select('id, full_name, phone, branch_id')
            .eq('is_active', true)
            .neq('full_name', 'TEST SERVICE QA WEEKLY')
            .order('branch_id', { ascending: true }),
          sb().rpc('users_with_roles_list'),
          sb()
            .schema('service_qa')
            .from('daily_employee_reports')
            .select('report_date, branch_id, employee_id, overall_score, analyzed_chunks, rude_count, pushy_count, interrupted_count')
            .gte('report_date', qaSince)
            .order('report_date', { ascending: false }),
        ]);

        if (branchesRes.error) throw branchesRes.error;

        const warnings: string[] = [];
        if (settingsRes.error) warnings.push('контакты филиалов');
        if (ordersRes.error) warnings.push('выручка и заказы');
        if (employeesRes.error) warnings.push('сотрудники');
        if (rolesRes.error) warnings.push('ответственные пользователи');
        if (qaRes.error) warnings.push('Service QA');

        const branches = (branchesRes.data ?? []) as BranchRow[];
        const settingsRows = settingsRes.error ? [] : ((settingsRes.data ?? []) as BranchSettingsRow[]);
        const orders = ordersRes.error ? [] : ((ordersRes.data ?? []) as OrderRow[]);
        const employees = employeesRes.error ? [] : ((employeesRes.data ?? []) as EmployeeRow[]);
        const roleRows = rolesRes.error ? [] : ((rolesRes.data ?? []) as UserRoleRow[]);
        const qaRows = qaRes.error ? [] : ((qaRes.data ?? []) as QaReportRow[]);

        const settingsByBranch = new Map<number, BranchSettingsRow>();
        for (const row of settingsRows) settingsByBranch.set(row.branch_id, row);

        const employeesByBranch = new Map<number, EmployeeRow[]>();
        for (const row of employees) {
          if (row.branch_id === null) continue;
          const existing = employeesByBranch.get(row.branch_id) ?? [];
          existing.push(row);
          employeesByBranch.set(row.branch_id, existing);
        }

        const rolesByBranch = new Map<number, UserRoleRow[]>();
        for (const row of roleRows) {
          if (row.branch_id === null) continue;
          const existing = rolesByBranch.get(row.branch_id) ?? [];
          existing.push(row);
          rolesByBranch.set(row.branch_id, existing);
        }

        const ordersByBranch = new Map<number, OrderAgg>();
        for (const row of orders) {
          if (row.branch_id === null) continue;
          const existing = ordersByBranch.get(row.branch_id) ?? { revenueMonth: 0, revenueLastMonth: 0, ordersMonth: 0 };
          const amount = Number(row.total_amount) || 0;
          if (row.created_at >= monthStart) {
            existing.revenueMonth += amount;
            existing.ordersMonth += 1;
          } else {
            existing.revenueLastMonth += amount;
          }
          ordersByBranch.set(row.branch_id, existing);
        }

        const qaByBranch = new Map<number, QaReportRow[]>();
        const qaByEmployee = new Map<number, QaEmployeeAgg>();
        for (const row of qaRows) {
          if (row.branch_id !== null) {
            const existing = qaByBranch.get(row.branch_id) ?? [];
            existing.push(row);
            qaByBranch.set(row.branch_id, existing);
          }

          if (row.employee_id !== null) {
            const current = qaByEmployee.get(row.employee_id) ?? { sum: 0, count: 0, hasWarning: false };
            if (typeof row.overall_score === 'number') {
              current.sum += row.overall_score;
              current.count += 1;
            }
            const hasSignal =
              Number(row.rude_count ?? 0) > 0 ||
              Number(row.pushy_count ?? 0) > 0 ||
              Number(row.interrupted_count ?? 0) > 0 ||
              (typeof row.overall_score === 'number' && row.overall_score < 60);
            current.hasWarning = current.hasWarning || hasSignal;
            qaByEmployee.set(row.employee_id, current);
          }
        }

        const mapped = branches.map((branch) => {
          const settings = settingsByBranch.get(branch.id);
          const branchEmployees = employeesByBranch.get(branch.id) ?? [];
          const branchRoles = rolesByBranch.get(branch.id) ?? [];
          const branchQa = [...(qaByBranch.get(branch.id) ?? [])].sort((a, b) => b.report_date.localeCompare(a.report_date));
          const orderAgg = ordersByBranch.get(branch.id) ?? { revenueMonth: 0, revenueLastMonth: 0, ordersMonth: 0 };

          const ownerEmail = branchRoles.find((row) => row.role === 'owner')?.email ?? null;
          const managerEmail = branchRoles.find((row) => row.role === 'manager')?.email ?? null;
          const fallbackEmail = branchRoles.find((row) => firstNonEmpty(row.email))?.email ?? null;

          const serviceRating = avgRounded(branchQa.map((row) => row.overall_score));
          const violationList = buildViolationList(branchQa);
          const openViolations = violationList.filter((row) => !row.fixed).length;
          const criticalOpenViolations = violationList.filter((row) => !row.fixed && row.severity === 'critical').length;
          const latestQaDate = branchQa[0]?.report_date ?? null;
          const hasFreshQa = latestQaDate ? latestQaDate >= freshQaCutoff : false;

          const fallbackEmployeePhone = branchEmployees.find((row) => firstNonEmpty(row.phone))?.phone ?? null;
          const phone = firstPhone([settings?.whatsapp_status_phone, ...(settings?.seller_phones ?? []), fallbackEmployeePhone]) ?? '—';
          const email = firstNonEmpty(ownerEmail, managerEmail, fallbackEmail) ?? '—';
          const manager = firstNonEmpty(managerEmail, ownerEmail, fallbackEmail) ?? '—';
          const hasContactGap = phone === '—' || email === '—';

          const staff = branchEmployees
            .map((row) => {
              const qaAgg = qaByEmployee.get(row.id);
              const hasQa = Boolean((qaAgg?.count ?? 0) > 0);
              return {
                name: firstNonEmpty(row.full_name) ?? `Сотрудник #${row.id}`,
                role: 'Сотрудник',
                trained: hasQa,
                hasQa,
                serviceRating: qaAgg && qaAgg.count > 0 ? Math.round(qaAgg.sum / qaAgg.count) : null,
                hasWarning: qaAgg?.hasWarning ?? false,
              } satisfies StaffMember;
            })
            .sort((a, b) => (b.serviceRating ?? -1) - (a.serviceRating ?? -1));

          const zone = deriveZone({
            revenueMonth: orderAgg.revenueMonth,
            revenueLastMonth: orderAgg.revenueLastMonth,
            serviceRating,
            criticalOpenViolations,
            hasFreshQa,
          });

          const status = deriveStatus({
            zone,
            revenueMonth: orderAgg.revenueMonth,
            revenueLastMonth: orderAgg.revenueLastMonth,
            serviceRating,
            staffCount: staff.length,
            hasFreshQa,
          });

          return {
            id: branch.id,
            name: firstNonEmpty(branch.name, settings?.branch_name) ?? `Точка #${branch.id}`,
            company: firstNonEmpty(settings?.address) ?? 'Адрес не заполнен',
            country: branchCountryName(branch),
            city: firstNonEmpty(branch.name) ?? `Точка #${branch.id}`,
            phone,
            email,
            manager,
            startDate: toDateOnly(settings?.updated_at) ?? '—',
            status,
            points: staff.length,
            zone,
            revenueMonth: orderAgg.revenueMonth,
            revenueLastMonth: orderAgg.revenueLastMonth,
            revenuePlan: orderAgg.revenueLastMonth,
            avgCheck: orderAgg.ordersMonth > 0 ? Math.round(orderAgg.revenueMonth / orderAgg.ordersMonth) : null,
            ordersMonth: orderAgg.ordersMonth,
            serviceRating,
            violations: openViolations,
            openTasks: openViolations + (hasContactGap ? 1 : 0) + (hasFreshQa ? 0 : 1),
            canExpand: false,
            needsApproval: hasContactGap,
            supplyStatus: hasContactGap ? 'low' : 'ok',
            contactStatus: hasContactGap ? 'low' : 'ok',
            launchSteps: [],
            violationList,
            staff,
            lastInspection: latestQaDate,
            hasFreshQa,
            hasContactGap,
            notes: buildNote({
              address: settings?.address ?? null,
              revenueMonth: orderAgg.revenueMonth,
              revenueLastMonth: orderAgg.revenueLastMonth,
              serviceRating,
              openViolations,
              hasContactGap,
              hasFreshQa,
            }),
          } satisfies Franchisee;
        });

        if (!cancelled) {
          setFranchisees(
            mapped.sort((a, b) => {
              const revenueDiff = (b.revenueMonth ?? 0) - (a.revenueMonth ?? 0);
              if (revenueDiff !== 0) return revenueDiff;
              return a.name.localeCompare(b.name, 'ru');
            }),
          );
          setDataWarning(
            warnings.length
              ? `Часть источников не подтянулась: ${warnings.join(', ')}. Остальная страница собрана из доступных данных.`
              : 'Финансы, контакты, сотрудники и Service QA подтягиваются из базы. Данные запуска и поставок к этой странице пока не подключены.',
          );
        }
      } catch (error: any) {
        if (!cancelled) setLoadError(error?.message || 'Не удалось загрузить реальные данные по филиалам');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Агрегаты ──
  const totalPoints = franchisees.reduce((s, f) => s + f.points, 0);
  const activeCount = franchisees.filter((f) => (f.revenueMonth ?? 0) > 0).length;
  const greenCount = franchisees.filter((f) => f.zone === 'green').length;
  const yellowCount = franchisees.filter((f) => f.zone === 'yellow').length;
  const redCount = franchisees.filter((f) => f.zone === 'red').length;
  const totalRevenue = franchisees.reduce((s, f) => s + (f.revenueMonth ?? 0), 0);
  const totalOrders = franchisees.reduce((s, f) => s + f.ordersMonth, 0);
  const avgRevenue = franchisees.length ? totalRevenue / franchisees.length : 0;
  const avgCheck = totalOrders ? Math.round(totalRevenue / totalOrders) : 0;
  const withService = franchisees.filter((f) => f.serviceRating !== null);
  const avgService = withService.length
    ? withService.reduce((s, f) => s + (f.serviceRating ?? 0), 0) / withService.length
    : 0;
  const critViolations = franchisees.reduce(
    (s, f) => s + f.violationList.filter((v) => v.severity === 'critical' && !v.fixed).length, 0
  );
  const openTasksTotal = franchisees.reduce((s, f) => s + f.openTasks, 0);
  const needsApprovalList = franchisees.filter((f) => f.hasContactGap);
  const qaGapList = franchisees.filter((f) => !f.hasFreshQa);

  // ── Тревоги ──
  const salesDropAlerts = franchisees
    .filter((f) => {
      const pct = ratioPct(f.revenueMonth, f.revenueLastMonth);
      return pct !== null && pct < 70;
    })
    .map((f) => `${f.name} (${f.city}) — ${planPct(f.revenueMonth, f.revenuePlan)}% к прошлому месяцу`);
  const lowServiceAlerts = franchisees
    .filter((f) => f.serviceRating != null && f.serviceRating < 65)
    .map((f) => `${f.name} (${f.city}) — рейтинг сервиса ${f.serviceRating}`);
  const criticalAlerts = franchisees
    .filter((f) => f.violations > 0)
    .map((f) => `${f.name} (${f.city}) — ${f.violations} открытых сигналов QA`);
  const supplyAlerts = franchisees
    .filter((f) => f.hasContactGap)
    .map((f) => f.phone === '—' && f.email === '—' ? `${f.name} (${f.city}) — не заполнены телефон и email` : f.phone === '—' ? `${f.name} (${f.city}) — не заполнен телефон` : `${f.name} (${f.city}) — не заполнен email ответственного`);
  const approvalAlerts = qaGapList
    .map((f) => f.lastInspection ? `${f.name} — последний QA ${f.lastInspection}` : `${f.name} — нет свежих данных Service QA`);
  const expandAlerts = franchisees
    .filter((f) => (f.revenueMonth ?? 0) === 0)
    .map((f) => `${f.name} (${f.city}) — в этом месяце пока без выручки`);
  const overdueAlerts = franchisees.flatMap((f) =>
    f.launchSteps
      .filter((s) => !s.done && isOverdue(s.deadline))
      .map((s) => `${f.name} — "${s.label}" (дедлайн ${s.deadline})`)
  );
  const hasAnyAlert = [salesDropAlerts, lowServiceAlerts, criticalAlerts, supplyAlerts, approvalAlerts, expandAlerts, overdueAlerts].some(a => a.length > 0);

  // ── Фильтр + сортировка ──
  const filtered = useMemo(() => {
    const base = filterZone === 'all' ? franchisees : franchisees.filter((f) => f.zone === filterZone);
    return [...base].sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1;
      switch (sort.key) {
        case 'name':
          return a.name.localeCompare(b.name, 'ru') * dir;
        case 'revenue':
          return ((a.revenueMonth ?? -1) - (b.revenueMonth ?? -1)) * dir;
        case 'plan_pct':
          return ((planPct(a.revenueMonth, a.revenuePlan) ?? -1) - (planPct(b.revenueMonth, b.revenuePlan) ?? -1)) * dir;
        case 'service':
          return ((a.serviceRating ?? -1) - (b.serviceRating ?? -1)) * dir;
        case 'violations':
          return (a.violations - b.violations) * dir;
        case 'zone':
          return (ZONE_PRIORITY[a.zone] - ZONE_PRIORITY[b.zone]) * dir;
      }
    });
  }, [filterZone, franchisees, sort]);

  if (loading && franchisees.length === 0 && !loadError) {
    return (
      <div className="min-h-[100dvh] bg-transparent px-5 py-8 text-slate-900">
        <div className="mx-auto max-w-7xl rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/80 p-8 ring-1 ring-sky-200/45 shadow-[0_22px_70px_rgba(15,23,42,0.18)] backdrop-blur-xl">
          <div className="text-sm font-semibold text-slate-900">Загружаю реальные данные по филиалам...</div>
          <div className="mt-2 text-sm text-slate-500">Поднимаю branches, contacts, orders, employees и Service QA.</div>
        </div>
      </div>
    );
  }

  if (loadError && franchisees.length === 0) {
    return (
      <div className="min-h-[100dvh] bg-transparent px-5 py-8 text-slate-900">
        <div className="mx-auto max-w-7xl rounded-3xl bg-gradient-to-br from-white via-rose-50/70 to-amber-50/60 p-8 ring-1 ring-rose-200/65 shadow-[0_18px_60px_rgba(15,23,42,0.16)]">
          <div className="text-sm font-semibold text-slate-900">Не удалось загрузить реальные данные</div>
          <div className="mt-2 text-sm text-slate-600">{loadError}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-transparent text-slate-900">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -left-24 -top-20 h-72 w-72 rounded-full bg-gradient-to-br from-teal-300/30 via-cyan-300/22 to-sky-300/18 blur-3xl" />
        <div className="absolute -right-28 top-24 h-80 w-80 rounded-full bg-gradient-to-br from-sky-300/22 via-indigo-300/16 to-violet-300/16 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-gradient-to-br from-emerald-300/18 via-teal-300/14 to-cyan-300/16 blur-3xl" />
      </div>

      <div className="mx-auto w-full max-w-7xl space-y-6 px-5 pb-10 pt-8">
        <header className="rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/80 p-5 ring-1 ring-sky-200/55 shadow-[0_22px_80px_rgba(15,23,42,0.22)] backdrop-blur-2xl sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_18px_55px_rgba(34,211,238,0.55)]">
                <Layers className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-[22px] font-semibold leading-tight text-slate-900 md:text-[28px]">Центр управления франшизами</h1>
                <p className="mt-1 text-xs text-slate-600/90 md:text-sm">Реальный срез по точкам сети: выручка, контакты, команда и Service QA.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 whitespace-nowrap rounded-2xl bg-gradient-to-r from-[#22d3ee] via-cyan-400 to-sky-400 px-5 py-3 text-[13px] font-semibold text-[#0f172a] shadow-[0_4px_22px_rgba(34,211,238,0.35)] hover:brightness-105 transition-all"
              >
                <Zap size={15} />
                + Франчайзи
              </button>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl bg-white/85 px-4 py-3 ring-1 ring-sky-200/70 shadow-[0_14px_40px_rgba(15,23,42,0.10)]">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500/90">На сегодня</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{TODAY}</div>
              </div>
              <div className="rounded-2xl bg-white/85 px-4 py-3 ring-1 ring-sky-200/70 shadow-[0_14px_40px_rgba(15,23,42,0.10)]">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500/90">С выручкой</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{activeCount} из {franchisees.length}</div>
              </div>
              <div className="rounded-2xl bg-white/85 px-4 py-3 ring-1 ring-sky-200/70 shadow-[0_14px_40px_rgba(15,23,42,0.10)]">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500/90">Красная зона</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{redCount} точек</div>
              </div>
            </div>
            </div>
          </div>
        </header>

        {loadError && (
          <section className="rounded-3xl bg-gradient-to-br from-white via-rose-50/70 to-amber-50/60 p-5 ring-1 ring-rose-200/65 shadow-[0_18px_60px_rgba(15,23,42,0.16)]">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-rose-50 text-rose-600 ring-1 ring-rose-200/80">
                <AlertTriangle size={18} />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">Не удалось загрузить реальные данные</div>
                <div className="mt-1 text-sm text-slate-600">{loadError}</div>
              </div>
            </div>
          </section>
        )}

        {!loadError && dataWarning && (
          <section className="rounded-3xl bg-gradient-to-br from-white via-amber-50/70 to-sky-50/60 p-5 ring-1 ring-amber-200/65 shadow-[0_18px_60px_rgba(15,23,42,0.16)]">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-amber-50 text-amber-700 ring-1 ring-amber-200/80">
                <Clock3 size={18} />
              </div>
              <div className="text-sm text-slate-600">{dataWarning}</div>
            </div>
          </section>
        )}

        {loading && !loadError && (
          <section className="rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/80 p-8 ring-1 ring-sky-200/45 shadow-[0_22px_70px_rgba(15,23,42,0.18)] backdrop-blur-xl">
            <div className="text-sm font-semibold text-slate-900">Загружаю реальные данные по филиалам...</div>
            <div className="mt-2 text-sm text-slate-500">Поднимаю branches, contacts, orders, employees и Service QA.</div>
          </section>
        )}

        <section className="rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/80 p-5 ring-1 ring-sky-200/45 shadow-[0_22px_70px_rgba(15,23,42,0.18)] backdrop-blur-xl">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Сводка сети</div>
              <p className="mt-1 text-xs text-slate-500">Ключевые показатели по точкам, команде и качеству сервиса.</p>
            </div>
            <div className="text-xs text-slate-500">Всего точек: {franchisees.length}</div>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <SummaryCard label="Всего точек" value={franchisees.length} sub={`${activeCount} с выручкой · ${totalPoints} сотрудников`} icon={Users} color="sky" />
          <SummaryCard label="Сотрудников" value={totalPoints} icon={Building2} color="sky" />
          <SummaryCard
            label="Зоны"
            value={`${greenCount} · ${yellowCount} · ${redCount}`}
            sub="зел / жёл / красн"
            icon={CircleDot}
            color={redCount > 0 ? 'red' : yellowCount > 0 ? 'amber' : 'emerald'}
          />
          <SummaryCard label="Выручка сети / мес" value={fmt(totalRevenue)} sub={`ср. на точку ${fmt(Math.round(avgRevenue))}`} icon={TrendingUp} color="emerald" />
          <SummaryCard label="Средний чек" value={avgCheck ? fmt(avgCheck) : '—'} icon={TrendingUp} color="emerald" />
          <SummaryCard
            label="Средний сервис"
            value={avgService ? `${Math.round(avgService)} / 100` : '—'}
            icon={Star}
            color={avgService >= 75 ? 'emerald' : avgService >= 60 ? 'amber' : 'red'}
          />
          <SummaryCard label="Критических нарушений" value={critViolations} icon={ShieldAlert} color={critViolations > 0 ? 'red' : 'emerald'} />
          <SummaryCard label="Открытых рисков" value={openTasksTotal} icon={FileText} color={openTasksTotal > 5 ? 'amber' : 'slate'} />
          <SummaryCard label="Без контакта" value={needsApprovalList.length} icon={BadgeCheck} color={needsApprovalList.length > 0 ? 'amber' : 'slate'} />
          <SummaryCard label="Без свежего QA" value={qaGapList.length} icon={Clock3} color={qaGapList.length > 0 ? 'red' : 'slate'} />
        </div>
      </section>

      {/* ── Блок 2: Тревоги ── */}
      <section className="rounded-3xl bg-gradient-to-br from-white via-slate-50 to-rose-50/70 p-5 ring-1 ring-rose-200/55 shadow-[0_22px_70px_rgba(15,23,42,0.18)] backdrop-blur-xl">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Требует внимания сегодня</div>
            <p className="mt-1 text-xs text-slate-500">Сигналы по продажам, сервису, качеству QA и заполненности контактов.</p>
          </div>
          <div className="text-xs text-slate-500">Активные сигналы по сети</div>
        </div>
        {hasAnyAlert ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AttentionCard icon={TrendingDown} iconCls="text-rose-600" ringCls="ring-rose-200/80" title="Падение продаж" items={salesDropAlerts} />
            <AttentionCard icon={Star} iconCls="text-amber-700" ringCls="ring-amber-200/80" title="Низкий сервис" items={lowServiceAlerts} />
            <AttentionCard icon={ShieldAlert} iconCls="text-rose-600" ringCls="ring-rose-200/80" title="Критические нарушения" items={criticalAlerts} />
            <AttentionCard icon={Phone} iconCls="text-amber-700" ringCls="ring-amber-200/80" title="Пробелы в контактах" items={supplyAlerts} />
            <AttentionCard icon={AlertTriangle} iconCls="text-rose-600" ringCls="ring-rose-200/80" title="Просроченные шаги запуска" items={overdueAlerts} />
            <AttentionCard icon={BadgeCheck} iconCls="text-sky-700" ringCls="ring-sky-200/80" title="Без свежего QA" items={approvalAlerts} />
            <AttentionCard icon={ArrowUpRight} iconCls="text-emerald-700" ringCls="ring-emerald-200/80" title="Без выручки в месяце" items={expandAlerts} />
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-2xl bg-emerald-50/90 px-4 py-3 text-[13px] font-medium text-emerald-700 ring-1 ring-emerald-200/80">
            <CheckCircle2 size={15} /> Всё в порядке — нет активных тревог по сети
          </div>
        )}
      </section>

      {/* ── Блок 3: Таблица ── */}
      <section className="rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/80 p-5 ring-1 ring-sky-200/45 shadow-[0_22px_70px_rgba(15,23,42,0.18)] backdrop-blur-xl">
        <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Все точки</div>
            <p className="mt-1 text-xs text-slate-500">Паспорт, запуск, финансы, сервис и решения по каждой точке.</p>
          </div>
          {/* Фильтр по зоне */}
          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'red', 'yellow', 'green'] as FilterZone[]).map((z) => {
              const labels = { all: 'Все', red: 'Красные', yellow: 'Жёлтые', green: 'Зелёные' };
              const clsActive = {
                all: 'bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 text-white ring-sky-200/40',
                red: 'bg-rose-50/95 text-rose-700 ring-rose-200/80',
                yellow: 'bg-amber-50/95 text-amber-700 ring-amber-200/80',
                green: 'bg-emerald-50/95 text-emerald-700 ring-emerald-200/80',
              };
              const clsInactive = 'bg-white/80 text-slate-600 ring-slate-200/70 hover:bg-white hover:text-slate-900';
              return (
                <button
                  key={z}
                  onClick={() => setFilterZone(z)}
                  className={`rounded-full px-3 py-2 text-xs font-semibold transition shadow-[0_12px_32px_rgba(15,23,42,0.08)] ring-1 ${filterZone === z ? clsActive[z] : clsInactive}`}
                >
                  {labels[z]}
                  {z !== 'all' && <span className="ml-1 text-[10px] opacity-70">
                    {z === 'red' ? redCount : z === 'yellow' ? yellowCount : greenCount}
                  </span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl bg-white/70 ring-1 ring-sky-200/40 shadow-[0_20px_60px_rgba(15,23,42,0.14)] backdrop-blur-xl">
          {/* Шапка */}
          <div className="overflow-x-auto">
            <div className="min-w-[700px]">
              <div className="grid grid-cols-[2fr_60px_130px_110px_70px_70px_80px_90px_28px] gap-x-3 border-b border-sky-100/80 bg-gradient-to-r from-slate-50 via-white to-sky-50/70 px-4 py-3">
                <SortTh label="Франчайзи" k="name" sort={sort} onSort={toggleSort} />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Штат</span>
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Статус</span>
                <SortTh label="Выручка" k="revenue" sort={sort} onSort={toggleSort} />
                <SortTh label="% к пред. мес." k="plan_pct" sort={sort} onSort={toggleSort} />
                <SortTh label="Сервис" k="service" sort={sort} onSort={toggleSort} />
                <SortTh label="Нарушения" k="violations" sort={sort} onSort={toggleSort} />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Контакты</span>
                <span />
              </div>

              {/* Строки */}
              {filtered.map((f) => {
                const isOpen = expandedId === f.id;
                const pct = planPct(f.revenueMonth, f.revenuePlan);
                const tab = getTab(f.id);
                const openViolations = f.violationList.filter((v) => !v.fixed).length;

                return (
                  <div key={f.id} className={`border-b border-sky-100/80 last:border-0 ${ZONE_LEFT_BORDER[f.zone]}`}>
                    {/* Строка */}
                    <button
                      className={`w-full min-w-[700px] text-left grid grid-cols-[2fr_60px_130px_110px_70px_70px_80px_90px_28px] gap-x-3 px-4 py-3 transition-colors ${isOpen ? 'bg-sky-50/70' : 'hover:bg-sky-50/50'}`}
                      onClick={() => setExpandedId(isOpen ? null : f.id)}
                    >
                      {/* Франчайзи */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${ZONE_DOT[f.zone]}`} />
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-slate-800 truncate">{f.name}</div>
                          <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                            <MapPin size={9} />{f.city}, {f.country}
                            {f.needsApproval && <span className="ml-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200/80">Контакт</span>}
                          </div>
                        </div>
                      </div>
                      {/* Точек */}
                      <div className="self-center text-center text-[13px] text-slate-700">{f.points}</div>
                      {/* Статус */}
                      <div className="self-center">
                        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${STATUS_BADGE[f.status]}`}>
                          {STATUS_LABELS[f.status]}
                        </span>
                      </div>
                      {/* Выручка */}
                      <div className="self-center">
                        <div className="text-[13px] text-slate-800">{fmt(f.revenueMonth)}</div>
                        <RevTrend cur={f.revenueMonth} prev={f.revenueLastMonth} />
                      </div>
                      {/* % плана */}
                      <div className={`text-[13px] font-semibold self-center ${
                        pct == null ? 'text-slate-400' : pct >= 100 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-rose-600'
                      }`}>
                        {pct != null ? `${pct}%` : '—'}
                      </div>
                      {/* Сервис */}
                      <div className={`text-[13px] self-center ${
                        f.serviceRating == null ? 'text-slate-400' : f.serviceRating >= 75 ? 'text-emerald-600' : f.serviceRating >= 60 ? 'text-amber-600' : 'text-rose-600'
                      }`}>
                        {f.serviceRating != null ? `★ ${f.serviceRating}` : '—'}
                      </div>
                      {/* Нарушения */}
                      <div className={`text-[13px] self-center ${openViolations > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                        {openViolations > 0 ? `⚠ ${openViolations}` : '—'}
                      </div>
                      {/* Поставки */}
                      <div className="self-center">
                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${CONTACT_INFO[f.contactStatus].cls}`}>
                          {CONTACT_INFO[f.contactStatus].label}
                        </span>
                      </div>
                      {/* Стрелка */}
                      <div className="self-center text-slate-400">
                        {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </div>
                    </button>

                    {/* Раскрытая карточка */}
                    {isOpen && (
                      <div className="border-t border-sky-100/80 bg-slate-50/70 px-4 py-5">
                        {/* Табы */}
                        <div className="mb-5 flex flex-wrap gap-2 border-b border-sky-100/80 pb-3">
                          {[
                            { id: 'passport', label: 'Паспорт' },
                            { id: 'launch', label: `Запуск${f.launchSteps.length ? ` ${f.launchSteps.filter(s=>s.done).length}/${f.launchSteps.length}` : ''}` },
                            { id: 'finance', label: 'Финансы' },
                            { id: 'service', label: `Сервис${f.serviceRating ? ` ★${f.serviceRating}` : ''}` },
                            { id: 'violations', label: `Нарушения${openViolations > 0 ? ` (${openViolations})` : ''}` },
                            { id: 'staff', label: 'Персонал' },
                            { id: 'decisions', label: 'Решения' },
                          ].map((t) => (
                            <button
                              key={t.id}
                              onClick={() => setTab(f.id, t.id)}
                              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                                tab === t.id
                                  ? 'bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 text-white ring-1 ring-sky-200/40 shadow-[0_12px_30px_rgba(34,211,238,0.28)]'
                                  : 'bg-white/80 text-slate-500 ring-1 ring-transparent hover:bg-white hover:text-slate-800'
                              }`}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>

                        {/* Паспорт */}
                        {tab === 'passport' && (
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                            <div className="space-y-2 rounded-2xl bg-white/80 p-4 ring-1 ring-sky-100/80 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
                              <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Контакты</div>
                              <Row icon={Users} label={f.name} />
                              <Row icon={Building2} label={f.company} />
                              <Row icon={Phone} label={f.phone} />
                              <Row icon={Globe} label={f.email} />
                              <Row icon={MapPin} label={`${f.city}, ${f.country}`} />
                            </div>
                            <div className="space-y-2 rounded-2xl bg-white/80 p-4 ring-1 ring-sky-100/80 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
                              <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Параметры</div>
                              <KV k="Менеджер ГО" v={f.manager} />
                              <KV k="Дата старта" v={f.startDate} />
                              <KV k="Сотрудников" v={f.points} />
                              <KV k="Последняя проверка" v={f.lastInspection ?? '—'} />
                              <KV k="Свежий QA" v={f.hasFreshQa ? '✓ Да' : '✗ Нет'} vCls={f.hasFreshQa ? 'text-emerald-600' : 'text-slate-500'} />
                              <KV k="Статус" v={STATUS_LABELS[f.status]} />
                            </div>
                            <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-sky-100/80 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
                              <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Заметки</div>
                              <p className="text-[12px] leading-relaxed text-slate-600">{f.notes}</p>
                            </div>
                          </div>
                        )}

                        {/* Запуск */}
                        {tab === 'launch' && (
                          f.launchSteps.length > 0
                            ? <LaunchProgress steps={f.launchSteps} />
                            : <div className="rounded-2xl bg-white/80 px-4 py-3 text-[12px] text-slate-600 ring-1 ring-sky-100/80 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
                                Данные запуска для этой страницы пока не подключены. Здесь показываются только реальные операционные данные: выручка, контакты, команда и Service QA.
                              </div>
                        )}

                        {/* Финансы */}
                        {tab === 'finance' && (
                          <div className="space-y-4">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                              <FinCard label="Выручка / мес" value={fmt(f.revenueMonth)} />
                              <FinCard label="Прошлый месяц" value={fmt(f.revenueLastMonth)} />
                              <FinCard label="Заказов / мес" value={f.ordersMonth} />
                              <FinCard
                                label="% к прошлому мес."
                                value={pct != null ? `${pct}%` : '—'}
                                cls={pct == null ? 'text-slate-400' : pct >= 100 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-rose-600'}
                              />
                              <FinCard label="Средний чек" value={fmt(f.avgCheck)} />
                              <FinCard label="Сотрудников" value={f.points} />
                            </div>
                            {f.revenueMonth && f.revenueLastMonth && (
                              <div className="flex items-center gap-2 text-[12px] text-slate-600">
                                <RevTrend cur={f.revenueMonth} prev={f.revenueLastMonth} />
                                <span>
                                  {f.revenueMonth > f.revenueLastMonth
                                    ? `+${fmt(f.revenueMonth - f.revenueLastMonth)} к прошлому месяцу`
                                    : `${fmt(f.revenueMonth - f.revenueLastMonth)} к прошлому месяцу`}
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Сервис */}
                        {tab === 'service' && (
                          <div className="space-y-3">
                            {f.serviceRating != null ? (
                              <>
                                <div className="flex items-center gap-3">
                                  <div className={`text-4xl font-bold ${f.serviceRating >= 75 ? 'text-emerald-600' : f.serviceRating >= 60 ? 'text-amber-600' : 'text-rose-600'}`}>
                                    {f.serviceRating}
                                  </div>
                                  <div className="text-[12px] text-slate-500">средний рейтинг<br />сервиса по точке</div>
                                </div>
                                <div className="h-2 w-48 overflow-hidden rounded-full bg-slate-200/80">
                                  <div
                                    className={`h-full rounded-full ${f.serviceRating >= 75 ? 'bg-emerald-500' : f.serviceRating >= 60 ? 'bg-amber-500' : 'bg-rose-500'}`}
                                    style={{ width: `${f.serviceRating}%` }}
                                  />
                                </div>
                                <div className="mt-2 text-[12px] text-slate-600">
                                  {f.serviceRating >= 75
                                    ? 'Сервис в норме — нет критических замечаний.'
                                    : f.serviceRating >= 60
                                    ? 'Сервис ниже нормы — рекомендуется разбор с командой.'
                                    : 'Сервис критически низкий — требуется немедленное вмешательство.'}
                                </div>
                                <div className="mt-3">
                                  <StaffTable staff={f.staff} />
                                </div>
                              </>
                            ) : (
                              <div className="rounded-2xl bg-white/80 px-4 py-3 text-[12px] text-slate-600 ring-1 ring-sky-100/80 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">Данные Service QA пока недоступны — точка ещё не открылась.</div>
                            )}
                          </div>
                        )}

                        {/* Нарушения */}
                        {tab === 'violations' && <ViolationList violations={f.violationList} />}

                        {/* Персонал */}
                        {tab === 'staff' && <StaffTable staff={f.staff} />}

                        {/* Решения */}
                        {tab === 'decisions' && (
                          <div className="space-y-4">
                            <div className="text-[12px] text-slate-600">
                              Быстрые решения по <span className="text-slate-900">{f.name}</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <ActionBtn icon={MessageSquare} label="Написать" cls="sky" />
                              <ActionBtn icon={Send} label="Назначить звонок" cls="sky" />
                              <ActionBtn icon={Eye} label="Проверить точку" cls="amber" />
                              <ActionBtn icon={BadgeCheck} label="Обновить контакт" cls="emerald" />
                              <ActionBtn icon={ArrowUpRight} label="Разобрать QA" cls="emerald" />
                              <ActionBtn icon={Ban} label="Эскалировать риск" cls="red" />
                              <ActionBtn icon={Zap} label="Поставить задачу" cls="violet" />
                              <ActionBtn icon={FileText} label="Выгрузить отчёт" cls="slate" />
                            </div>
                            <NoteArea />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {filtered.length === 0 && (
                <div className="px-4 py-10 text-center text-[13px] text-slate-500">
                  Нет точек в выбранной зоне
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Модалка создания франчайзи ── */}
      {showCreateModal && (
        <CreateFranchiseeModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateFranchisee}
        />
      )}

      </div>
    </div>
  );
}

// ─── Модальное окно создания франчайзи ───────────────────────────────────────

const COUNTRIES = [
  { id: 'kg', name: 'Кыргызстан', flag: '\u{1F1F0}\u{1F1EC}', currency: 'KGS', symbol: 'с' },
  { id: 'uz', name: 'Узбекистан', flag: '\u{1F1FA}\u{1F1FF}', currency: 'UZS', symbol: 'сўм' },
  { id: 'kz', name: 'Казахстан',  flag: '\u{1F1F0}\u{1F1FF}', currency: 'KZT', symbol: '₸' },
  { id: 'ru', name: 'Россия',     flag: '\u{1F1F7}\u{1F1FA}', currency: 'RUB', symbol: '₽' },
];

function CreateFranchiseeModal({ onClose, onSubmit }: {
  onClose: () => void;
  onSubmit: (form: {
    orgName: string; branchName: string; countryId: string; city: string;
    contactName: string; contactPhone: string; contactEmail: string; workHours: string;
  }) => Promise<void>;
}) {
  const [orgName, setOrgName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [countryId, setCountryId] = useState('kg');
  const [city, setCity] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [workHours, setWorkHours] = useState('09:00-18:00');
  const [saving, setSaving] = useState(false);

  const selectedCountry = COUNTRIES.find(c => c.id === countryId) ?? COUNTRIES[0];
  const canSubmit = orgName.trim().length > 0 && branchName.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      await onSubmit({ orgName: orgName.trim(), branchName: branchName.trim(), countryId, city: city.trim(), contactName: contactName.trim(), contactPhone: contactPhone.trim(), contactEmail: contactEmail.trim(), workHours });
    } catch {
      // error handled in parent
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[#0f172a]/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl mx-4 rounded-3xl bg-white shadow-[0_32px_100px_rgba(15,23,42,0.35)] ring-1 ring-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-[#0f172a] via-slate-800 to-slate-900">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#22d3ee] to-cyan-400 flex items-center justify-center shadow-[0_4px_22px_rgba(34,211,238,0.4)]">
              <Zap size={22} className="text-[#0f172a]" />
            </div>
            <div>
              <h2 className="text-[20px] font-bold text-white">Новый франчайзи</h2>
              <p className="text-[12px] text-slate-400 mt-0.5">Заполни данные — система создаст организацию, филиал и настройки</p>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5 max-h-[65vh] overflow-y-auto">

          {/* Страна */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Страна</label>
            <div className="grid grid-cols-4 gap-2">
              {COUNTRIES.map(c => (
                <button key={c.id} type="button" onClick={() => setCountryId(c.id)}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium ring-1 transition-all ${
                    countryId === c.id
                      ? 'bg-[#22d3ee]/10 ring-[#22d3ee] text-[#0f172a] shadow-sm'
                      : 'bg-white ring-slate-200 text-slate-600 hover:ring-slate-300'
                  }`}>
                  <span className="text-lg">{c.flag}</span>
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-slate-400">
              Валюта: <span className="font-semibold text-slate-600">{selectedCountry.currency} ({selectedCountry.symbol})</span>
            </div>
          </div>

          {/* Организация и Филиал */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Название организации <span className="text-rose-400">*</span>
              </label>
              <input value={orgName} onChange={e => setOrgName(e.target.value)}
                placeholder='ОсОО «Рефокус Ташкент»'
                className="w-full rounded-xl bg-white px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-[#22d3ee] placeholder:text-slate-400 shadow-sm" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Название филиала <span className="text-rose-400">*</span>
              </label>
              <input value={branchName} onChange={e => setBranchName(e.target.value)}
                placeholder='Ташкент-Центр'
                className="w-full rounded-xl bg-white px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-[#22d3ee] placeholder:text-slate-400 shadow-sm" />
            </div>
          </div>

          {/* Город и Часы работы */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Город</label>
              <input value={city} onChange={e => setCity(e.target.value)}
                placeholder='Ташкент'
                className="w-full rounded-xl bg-white px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-[#22d3ee] placeholder:text-slate-400 shadow-sm" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Часы работы</label>
              <input value={workHours} onChange={e => setWorkHours(e.target.value)}
                placeholder='09:00-18:00'
                className="w-full rounded-xl bg-white px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-[#22d3ee] placeholder:text-slate-400 shadow-sm" />
            </div>
          </div>

          {/* Разделитель */}
          <div className="border-t border-slate-100 pt-4">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Контактное лицо (необязательно)</div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">ФИО</label>
                <input value={contactName} onChange={e => setContactName(e.target.value)}
                  placeholder='Иванов Иван'
                  className="w-full rounded-xl bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-[#22d3ee] placeholder:text-slate-400 shadow-sm" />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">Телефон</label>
                <input value={contactPhone} onChange={e => setContactPhone(e.target.value)}
                  placeholder='+998 90 123 45 67'
                  className="w-full rounded-xl bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-[#22d3ee] placeholder:text-slate-400 shadow-sm" />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">Email</label>
                <input value={contactEmail} onChange={e => setContactEmail(e.target.value)}
                  placeholder='partner@email.com'
                  className="w-full rounded-xl bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-[#22d3ee] placeholder:text-slate-400 shadow-sm" />
              </div>
            </div>
          </div>

          {/* Превью настроек */}
          <div className="rounded-2xl bg-slate-50 ring-1 ring-slate-200 px-4 py-3">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Будет создано автоматически</div>
            <div className="grid grid-cols-3 gap-3 text-[12px]">
              <div>
                <div className="text-slate-400">Таймзона</div>
                <div className="font-medium text-slate-800">
                  {{ kg: 'Asia/Bishkek', uz: 'Asia/Tashkent', kz: 'Asia/Almaty', ru: 'Europe/Moscow' }[countryId]}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Код телефона</div>
                <div className="font-medium text-slate-800">
                  +{{ kg: '996', uz: '998', kz: '7', ru: '7' }[countryId]}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Валюта</div>
                <div className="font-medium text-slate-800">
                  {selectedCountry.symbol} ({selectedCountry.currency})
                </div>
              </div>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <button onClick={onClose} type="button"
            className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition-all">
            Отмена
          </button>
          <button onClick={handleSubmit as any} disabled={!canSubmit || saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#22d3ee] via-cyan-400 to-sky-400 text-[#0f172a] text-sm font-semibold shadow-md hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
            {saving ? (
              <><div className="w-4 h-4 rounded-full border-2 border-[#0f172a]/30 border-t-[#0f172a] animate-spin" /> Создаю...</>
            ) : (
              <><CheckCircle2 size={16} /> Создать франчайзи</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Вспомогательные мини-компоненты ──────────────────────────────────────────

function Row({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-slate-700">
      <Icon size={11} className="shrink-0 text-slate-400" />
      <span className="truncate">{label}</span>
    </div>
  );
}

function KV({ k, v, vCls }: { k: string; v: string | number; vCls?: string }) {
  return (
    <div className="flex items-start justify-between gap-2 text-[12px]">
      <span className="text-slate-500">{k}</span>
      <span className={vCls ?? 'text-slate-800'}>{v}</span>
    </div>
  );
}

function FinCard({ label, value, cls }: { label: string; value: string | number; cls?: string }) {
  return (
    <div className="rounded-2xl bg-white/80 px-3 py-3 ring-1 ring-sky-100/80 shadow-[0_14px_36px_rgba(15,23,42,0.08)]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500/90">{label}</div>
      <div className={`mt-1 text-[15px] font-semibold ${cls ?? 'text-slate-900'}`}>{value}</div>
    </div>
  );
}

function ActionBtn({ icon: Icon, label, cls }: { icon: React.ElementType; label: string; cls: string }) {
  return (
    <button className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-semibold ring-1 shadow-[0_12px_30px_rgba(15,23,42,0.08)] transition-colors ${ACTION_BTN_MAP[cls]}`}>
      <Icon size={12} /> {label}
    </button>
  );
}
