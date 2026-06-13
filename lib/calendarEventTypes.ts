import {
  PartyPopper, Banknote, Sun, ClipboardCheck, Boxes,
  Cake, GraduationCap, Users, CalendarDays, Bell,
  Clock, CalendarOff, Sparkles,
  // Старые иконки оставлены для бэк-совместимости с уже созданными событиями:
  DollarSign, Coffee, Package,
  type LucideIcon,
} from 'lucide-react';

export type CalendarEventType =
  | 'holiday'
  | 'short_day'
  | 'closed'
  | 'payday'
  | 'dayoff'
  | 'task'
  | 'recount'
  | 'birthday'
  | 'training'
  | 'meeting'
  | 'custom';

export type CalendarAudience = 'franchise' | 'employee' | 'both';

export type CalendarColorKey =
  | 'amber' | 'sky' | 'teal' | 'violet' | 'indigo'
  | 'red' | 'emerald' | 'pink' | 'slate' | 'cyan';

export interface EventTypeDef {
  key: CalendarEventType;
  label: string;
  iconName: string;
  icon: LucideIcon;
  color: CalendarColorKey;
}

export const EVENT_TYPES: EventTypeDef[] = [
  { key: 'holiday',   label: 'Праздник',       iconName: 'PartyPopper',    icon: PartyPopper,     color: 'violet'  },
  { key: 'short_day', label: 'Сокращённый день', iconName: 'Clock',        icon: Clock,           color: 'amber'   },
  { key: 'closed',    label: 'Не работаем',    iconName: 'CalendarOff',    icon: CalendarOff,     color: 'red'     },
  { key: 'payday',   label: 'Зарплата',      iconName: 'Banknote',        icon: Banknote,        color: 'emerald' },
  { key: 'dayoff',   label: 'Выходной',      iconName: 'Sun',             icon: Sun,             color: 'sky'     },
  { key: 'task',     label: 'Задание',       iconName: 'ClipboardCheck',  icon: ClipboardCheck,  color: 'amber'   },
  { key: 'recount',  label: 'Пересчёт',      iconName: 'Boxes',           icon: Boxes,           color: 'indigo'  },
  { key: 'birthday', label: 'День рождения', iconName: 'Cake',            icon: Cake,            color: 'pink'    },
  { key: 'training', label: 'Обучение',      iconName: 'GraduationCap',   icon: GraduationCap,   color: 'teal'    },
  { key: 'meeting',  label: 'Собрание',      iconName: 'Users',           icon: Users,           color: 'cyan'    },
  { key: 'custom',   label: 'Своё',          iconName: 'CalendarDays',    icon: CalendarDays,    color: 'slate'   },
];

export const EVENT_TYPE_MAP: Record<CalendarEventType, EventTypeDef> =
  EVENT_TYPES.reduce((acc, t) => { acc[t.key] = t; return acc; }, {} as Record<CalendarEventType, EventTypeDef>);

const ICON_MAP: Record<string, LucideIcon> = {
  PartyPopper, Banknote, Sun, ClipboardCheck, Boxes,
  Cake, GraduationCap, Users, CalendarDays, Bell,
  Clock, CalendarOff, Sparkles,
  // Legacy — события созданные до смены иконок:
  DollarSign, Coffee, Package,
};

export function getIconByName(name: string | null | undefined): LucideIcon {
  if (!name) return CalendarDays;
  return ICON_MAP[name] || CalendarDays;
}

export interface ColorStyle {
  text: string;
  bg: string;
  ring: string;
  dot: string;
  badge: string;
}

export const COLOR_STYLES: Record<CalendarColorKey, ColorStyle> = {
  amber:   { text: 'text-amber-700',   bg: 'bg-amber-50',   ring: 'ring-amber-200',   dot: 'bg-amber-400',   badge: 'bg-amber-50 text-amber-700 ring-amber-200' },
  sky:     { text: 'text-sky-700',     bg: 'bg-sky-50',     ring: 'ring-sky-200',     dot: 'bg-sky-400',     badge: 'bg-sky-50 text-sky-700 ring-sky-200' },
  teal:    { text: 'text-teal-700',    bg: 'bg-teal-50',    ring: 'ring-teal-200',    dot: 'bg-teal-400',    badge: 'bg-teal-50 text-teal-700 ring-teal-200' },
  violet:  { text: 'text-violet-700',  bg: 'bg-violet-50',  ring: 'ring-violet-200',  dot: 'bg-violet-400',  badge: 'bg-violet-50 text-violet-700 ring-violet-200' },
  indigo:  { text: 'text-indigo-700',  bg: 'bg-indigo-50',  ring: 'ring-indigo-200',  dot: 'bg-indigo-400',  badge: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  red:     { text: 'text-red-700',     bg: 'bg-red-50',     ring: 'ring-red-200',     dot: 'bg-red-400',     badge: 'bg-red-50 text-red-700 ring-red-200' },
  emerald: { text: 'text-emerald-700', bg: 'bg-emerald-50', ring: 'ring-emerald-200', dot: 'bg-emerald-400', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  pink:    { text: 'text-pink-700',    bg: 'bg-pink-50',    ring: 'ring-pink-200',    dot: 'bg-pink-400',    badge: 'bg-pink-50 text-pink-700 ring-pink-200' },
  slate:   { text: 'text-slate-600',   bg: 'bg-slate-50',   ring: 'ring-slate-200',   dot: 'bg-slate-400',   badge: 'bg-slate-100 text-slate-600 ring-slate-200' },
  cyan:    { text: 'text-cyan-700',    bg: 'bg-cyan-50',    ring: 'ring-cyan-200',    dot: 'bg-cyan-400',    badge: 'bg-cyan-50 text-cyan-700 ring-cyan-200' },
};

export function getColor(name: string | null | undefined): ColorStyle {
  if (!name) return COLOR_STYLES.sky;
  return (COLOR_STYLES as Record<string, ColorStyle>)[name] || COLOR_STYLES.sky;
}

export const COLOR_KEYS: CalendarColorKey[] = [
  'amber', 'sky', 'teal', 'violet', 'indigo', 'red', 'emerald', 'pink', 'slate', 'cyan',
];

export const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

export const DAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const DOW_NAMES_RU = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

export function pad2(n: number): string { return String(n).padStart(2, '0'); }

export function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
