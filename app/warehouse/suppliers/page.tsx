// app/settings/warehouse/suppliers/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clipboard,
  ExternalLink,
  Package,
  Plus,
  ShoppingBag,
  Sparkles,
  Star,
  StarOff,
  Trash2,
  Truck,
  ArrowLeft,
  Pencil,
  Save,
  X,
  Tag,
  Award,
  Monitor,
  Image as ImageIcon,
  Layers,
  FileText,
  Calculator as CalcIcon,
  Settings2,
} from 'lucide-react';

/* ───────────────── Routing ───────────────── */
const ROUTE_WAREHOUSE = '/warehouse';

/* ───────────────── FX ───────────────── */
const USD_TO_KGS = 88;

/* ───────────────── Supabase ───────────────── */
function getSb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!url || !anon) throw new Error('Нет ENV: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return createBrowserClient(url, anon);
}

/* ───────────────── Utils ───────────────── */
function cls(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(' ');
}
function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function nInt(v: string) {
  const x = parseInt(v, 10);
  return Number.isFinite(x) ? x : NaN;
}
function clampNum(v: any, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}
function fmt(n: number) {
  const x = Number(n ?? 0);
  return Number.isFinite(x) ? String(x) : '0';
}

/** ✅ Для дробных полей: разрешаем ввод "0.", "0.0", запятую и т.п. без схлопывания */
function acceptDecimalTyping(raw: string): string | null {
  const next = String(raw ?? '').replace(',', '.');
  if (!/^\d*(\.\d*)?$/.test(next)) return null;
  return next;
}
function parseDecimalOrNull(raw: string): number | null {
  const t = String(raw ?? '').trim().replace(',', '.');
  if (!t) return null;
  if (t === '.' || t.endsWith('.')) return null; // промежуточное состояние ввода
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}

function dtFmt(d: Date) {
  try {
    const pad = (x: number) => String(x).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return d.toISOString();
  }
}
function fmtMoneyUSD(n: number, digits = 2) {
  const x = Number(n ?? 0);
  if (!Number.isFinite(x)) return '0.00';
  if (x === 0) return '0.00';
  // For very small values, show enough significant digits
  if (Math.abs(x) > 0 && Math.abs(x) < Math.pow(10, -digits)) {
    // Find how many decimals we need for 2 significant digits
    const mag = Math.floor(Math.log10(Math.abs(x)));
    const needed = Math.max(digits, -mag + 1);
    return x.toFixed(Math.min(needed, 8));
  }
  return x.toFixed(digits);
}
function fmtMoneyKGSFromUSD(usd: number) {
  const x = Number(usd ?? 0);
  const rate = Number(USD_TO_KGS);
  if (!Number.isFinite(x) || !Number.isFinite(rate)) return '0';
  const kgs = x * rate;
  if (kgs === 0) return '0';
  if (Math.abs(kgs) < 0.5) {
    // Show decimal for sub-1 som values
    const mag = Math.floor(Math.log10(Math.abs(kgs)));
    const needed = Math.max(2, -mag + 1);
    return kgs.toFixed(Math.min(needed, 6));
  }
  return String(Math.round(kgs));
}
function safeStr(x: any) {
  return String(x ?? '').trim();
}
async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-10000px';
      ta.style.top = '-10000px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

/* ───────────────── UI (Refocus: dark layout bg, white cards, cyan/teal accents) ── */
const UI = {
  shell: 'min-h-screen bg-transparent text-slate-200',
  container: 'relative mx-auto w-full max-w-7xl px-5 md:px-6 pt-8 pb-10 space-y-5',

  headerCard:
    'rounded-3xl p-5 sm:p-6',

  sectionCard:
    'space-y-4',

  innerCard:
    'rounded-2xl p-5 bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]',

  badgeIcon:
    'h-11 w-11 rounded-2xl grid place-items-center bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.35)]',

  input:
    'w-full rounded-xl px-3 py-2.5 text-sm bg-white text-slate-900 placeholder:text-slate-400 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-400/60 disabled:bg-slate-50 disabled:text-slate-400 transition',
  textarea:
    'w-full rounded-xl px-3 py-2.5 text-sm bg-white text-slate-900 placeholder:text-slate-400 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-400/60 disabled:bg-slate-50 disabled:text-slate-400 transition',
  select:
    'w-full rounded-xl px-3 py-2.5 text-sm bg-white text-slate-900 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-400/60 transition',

  btnBase: 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition active:translate-y-[0.5px] focus:outline-none',
  btnPrimary:
    'text-white font-semibold bg-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.30)] hover:bg-cyan-400 focus:ring-2 focus:ring-cyan-300/70',
  btnGhost:
    'text-slate-600 bg-white ring-1 ring-slate-200 shadow-sm hover:bg-slate-50 hover:text-slate-900',
  btnWarn:
    'text-white bg-gradient-to-r from-amber-500 to-orange-500 shadow-[0_4px_16px_rgba(245,158,11,0.25)] hover:brightness-110 focus:ring-2 focus:ring-amber-300/70',
  btnDanger:
    'text-rose-600 bg-white ring-1 ring-rose-200 shadow-sm hover:bg-rose-50 focus:ring-2 focus:ring-rose-300/70',
  btnDisabled: 'bg-slate-100 text-slate-400 ring-1 ring-slate-200 cursor-not-allowed',
};

/* ───────────────── Domain types ───────────────── */
type AccType = string;

type ItemGroup = 'consumable' | 'asset';

type ItemTypeIconKey =
  | 'bag'
  | 'case'
  | 'cloth'
  | 'tag'
  | 'award'
  | 'logo'
  | 'pos'
  | 'calculator'
  | 'shelves'
  | 'leaflets'
  | 'package'
  | 'generic';

type ItemTypeDef = {
  key: string;
  ru: string;
  ru_singular: string;
  cn: string;
  icon?: ItemTypeIconKey;
  group?: ItemGroup; // ✅ расходник / инвентарь
};

type IconKey = 'wechat' | 'taobao' | '1688' | 'alibaba' | 'pinduoduo' | 'other';

type Supplier = {
  id: string;
  type: AccType;
  display_name: string;
  description?: string;
  icon_key: IconKey;
  link_url: string;
  unit_price_usd?: number;
  unit_weight_kg?: number;
  is_default?: boolean;
  sort_order?: number;
  last_order_at?: string;
  last_order_qty?: number;
  last_order_template_id?: string;
};

type SupplierLogEntry = {
  id: string;
  ts: string;
  supplier_id: string;
  supplier_name: string;
  type: AccType;
  qty: number;
  template_id: string;
  cargo_name: string;
  cargo_addr_preview: string;
};

type SupplierTemplate = {
  id: string;
  name: string;
  is_default?: boolean;
  cn_template: string;
  ru_template: string;
  types?: AccType[];
};

type SuppliersSettings = {
  version: 1;
  item_types: ItemTypeDef[];
  suppliers: Record<string, Supplier[]>;
  templates: SupplierTemplate[];
  logs: Record<string, SupplierLogEntry[]>;
  removed_item_types?: string[];
};

type ChinaCargo = {
  id: string;
  name: string;
  address: string;
  price_per_kg: number; // USD/kg
};

type ConsumablesSettings = {
  version?: number;
  china_cargos?: ChinaCargo[];
  china_cargo_default_id?: string;
  cargo_per_type?: Record<string, string>;
  [k: string]: any;
};

/* ───────────────── Category rules ───────────────── */
const CONSUMABLE_KEYS = new Set<string>(['bag', 'case', 'cloth', 'lenses', 'frames', 'price_tags', 'leaflets']);

function inferGroupByKey(key: string): ItemGroup {
  return CONSUMABLE_KEYS.has(String(key)) ? 'consumable' : 'asset';
}

function normalizeGroup(raw: any, key: string): ItemGroup {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'consumable' || v === 'consumables' || v === 'расходник' || v === 'расходники') return 'consumable';
  if (v === 'asset' || v === 'assets' || v === 'inventory' || v === 'инвентарь' || v === 'нерасходник' || v === 'нерасходники') return 'asset';
  return inferGroupByKey(key);
}

function itemGroupOf(def: ItemTypeDef | null | undefined): ItemGroup {
  const key = String(def?.key ?? '');
  return normalizeGroup((def as any)?.group, key);
}

function typeTileClasses(active: boolean, group: ItemGroup) {
  if (active) {
    return group === 'consumable'
      ? 'bg-gradient-to-r from-cyan-500 to-teal-500 text-white ring-cyan-400/30 shadow-[0_4px_16px_rgba(34,211,238,0.30)]'
      : 'bg-gradient-to-r from-cyan-500 to-indigo-500 text-white ring-indigo-400/30 shadow-[0_4px_16px_rgba(99,102,241,0.25)]';
  }
  return group === 'consumable'
    ? 'bg-gradient-to-r from-cyan-100/70 to-teal-100/70 text-slate-700 ring-1 ring-cyan-200 hover:from-cyan-100 hover:to-teal-100 hover:ring-cyan-300 hover:text-slate-900'
    : 'bg-gradient-to-r from-cyan-100/70 to-indigo-100/70 text-slate-700 ring-1 ring-indigo-200 hover:from-cyan-100 hover:to-indigo-100 hover:ring-indigo-300 hover:text-slate-900';
}

function typeMiniIconBg(active: boolean, _group: ItemGroup) {
  if (active) return 'bg-white/25 ring-white/30';
  return 'bg-slate-50 ring-slate-200';
}

const GROUP_LABEL: Record<ItemGroup, string> = {
  consumable: 'Расходники',
  asset: 'Инвентарь',
};

const GROUP_CHOICE_LABEL: Record<ItemGroup, string> = {
  consumable: 'Расходник',
  asset: 'Инвентарь',
};

const ITEM_TYPE_ICON_OPTIONS: { key: ItemTypeIconKey; label: string }[] = [
  { key: 'package', label: 'Общее' },
  { key: 'bag', label: 'Пакет' },
  { key: 'case', label: 'Футляр' },
  { key: 'cloth', label: 'Платочек' },
  { key: 'tag', label: 'Ценник' },
  { key: 'leaflets', label: 'Листовки' },
  { key: 'shelves', label: 'Полки' },
  { key: 'pos', label: 'POS' },
  { key: 'calculator', label: 'Калькулятор' },
  { key: 'logo', label: 'Logo' },
  { key: 'award', label: 'Награда' },
  { key: 'generic', label: 'Упаковка' },
];

/* ───────────────── Constants ───────────────── */
const CONSUMABLES_KEY = 'refocus.consumables.v1';
const SUPPLIERS_KEY = 'refocus.suppliers.v1';
const QUICK_PREFS_KEY = 'refocus.suppliers.quickPrefs.v1';

type QuickPrefs = Record<string, { qty: string; templateId: string }>;

const DEFAULT_ITEM_TYPES: ItemTypeDef[] = [
  { key: 'bag', ru: 'Пакеты', ru_singular: 'пакет', cn: '眼镜袋（包装袋）', icon: 'bag', group: 'consumable' },
  { key: 'case', ru: 'Футляры', ru_singular: 'футляр', cn: '眼镜盒', icon: 'case', group: 'consumable' },
  { key: 'cloth', ru: 'Платочки', ru_singular: 'платочек', cn: '擦镜布', icon: 'cloth', group: 'consumable' },

  { key: 'refractometer', ru: 'Рефрактометр', ru_singular: 'рефрактометр', cn: '自动验光仪', icon: 'package', group: 'asset' },
  { key: 'lenses', ru: 'Линзы', ru_singular: 'линза', cn: '镜片', icon: 'package', group: 'consumable' },
  { key: 'frames', ru: 'Оправы', ru_singular: 'оправа', cn: '眼镜框', icon: 'package', group: 'consumable' },
  { key: 'price_tags', ru: 'Ценники', ru_singular: 'ценник', cn: '价签（价格标签）', icon: 'tag', group: 'consumable' },

  { key: 'pos', ru: 'Кассовый аппарат', ru_singular: 'кассовый аппарат', cn: '收银机', icon: 'pos', group: 'asset' },
  { key: 'logo', ru: 'Логотип', ru_singular: 'логотип', cn: '品牌标志（Logo）', icon: 'logo', group: 'asset' },
  { key: 'calculator', ru: 'Калькулятор', ru_singular: 'калькулятор', cn: '计算器', icon: 'calculator', group: 'asset' },
  { key: 'shelves', ru: 'Полки', ru_singular: 'полка', cn: '货架', icon: 'shelves', group: 'asset' },
  { key: 'award', ru: 'Награда', ru_singular: 'награда', cn: '奖杯', icon: 'award', group: 'asset' },
  { key: 'uniform', ru: 'Униформа', ru_singular: 'униформа', cn: '工作服', icon: 'package', group: 'asset' },
  { key: 'leaflets', ru: 'Листовки', ru_singular: 'листовка', cn: '传单', icon: 'leaflets', group: 'consumable' },
  { key: 'other', ru: 'Прочее', ru_singular: 'прочее', cn: '其他', icon: 'package', group: 'asset' },
];

const ICON_OPTIONS: { key: IconKey; label: string }[] = [
  { key: 'taobao', label: 'Taobao' },
  { key: '1688', label: '1688.com' },
  { key: 'alibaba', label: 'Alibaba' },
  { key: 'pinduoduo', label: 'Pinduoduo' },
  { key: 'wechat', label: 'WeChat' },
  { key: 'other', label: 'Другое' },
];

function IconPick({ k, className }: { k: IconKey; className?: string }) {
  const c = className ?? 'h-4 w-4';
  switch (k) {
    case 'taobao':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={c}>
          <rect width="24" height="24" rx="6" fill="#FF5000" />
          <text x="12" y="16.5" textAnchor="middle" fontSize="11" fontWeight="800" fill="white" fontFamily="system-ui">TB</text>
        </svg>
      );
    case '1688':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={c}>
          <rect width="24" height="24" rx="6" fill="#FF6A00" />
          <text x="12" y="15.5" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="white" fontFamily="system-ui">1688</text>
        </svg>
      );
    case 'alibaba':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={c}>
          <rect width="24" height="24" rx="6" fill="#FF6A00" />
          <text x="12" y="16.5" textAnchor="middle" fontSize="11" fontWeight="800" fill="white" fontFamily="system-ui">Ali</text>
        </svg>
      );
    case 'pinduoduo':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={c}>
          <rect width="24" height="24" rx="6" fill="#E02E24" />
          <text x="12" y="15.5" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="white" fontFamily="system-ui">PDD</text>
        </svg>
      );
    case 'wechat':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={c}>
          <rect width="24" height="24" rx="6" fill="#07C160" />
          <ellipse cx="10" cy="11" rx="5.5" ry="4.5" fill="white" />
          <ellipse cx="15" cy="13.5" rx="4.5" ry="3.5" fill="white" />
          <circle cx="8.5" cy="10.5" r="0.8" fill="#07C160" />
          <circle cx="11.5" cy="10.5" r="0.8" fill="#07C160" />
          <circle cx="13.5" cy="13" r="0.7" fill="#07C160" />
          <circle cx="16.5" cy="13" r="0.7" fill="#07C160" />
        </svg>
      );
    case 'other':
    default:
      return <Package className={c} />;
  }
}

function ItemTypeIcon({ def, className }: { def: ItemTypeDef | null | undefined; className?: string }) {
  const c = className ?? 'h-5 w-5';

  const iconKey = String(def?.icon ?? '').trim();
  switch (iconKey) {
    case 'bag':
      return <ShoppingBag className={c} />;
    case 'case':
      return <Package className={c} />;
    case 'cloth':
      return <Sparkles className={c} />;
    case 'tag':
      return <Tag className={c} />;
    case 'award':
      return <Award className={c} />;
    case 'logo':
      return <ImageIcon className={c} />;
    case 'pos':
      return <Monitor className={c} />;
    case 'calculator':
      return <CalcIcon className={c} />;
    case 'shelves':
      return <Layers className={c} />;
    case 'leaflets':
      return <FileText className={c} />;
    case 'package':
      return <Package className={c} />;
    case 'generic':
      return <Package className={c} />;
  }

  // fallback (старое поведение — по key)
  const key = String(def?.key ?? '');
  switch (key) {
    case 'bag':
      return <ShoppingBag className={c} />;
    case 'case':
      return <Package className={c} />;
    case 'cloth':
      return <Sparkles className={c} />;
    case 'price_tags':
      return <Tag className={c} />;
    case 'award':
      return <Award className={c} />;
    case 'logo':
      return <ImageIcon className={c} />;
    case 'pos':
      return <Monitor className={c} />;
    case 'calculator':
      return <CalcIcon className={c} />;
    case 'shelves':
      return <Layers className={c} />;
    case 'leaflets':
      return <FileText className={c} />;
    default:
      return <Package className={c} />;
  }
}

/* ───────────────── Templates ───────────────── */
function defaultTemplates(): SupplierTemplate[] {
  const t1: SupplierTemplate = {
    id: 'tpl_order',
    name: 'Заказ (быстрый)',
    is_default: true,
    cn_template: ['你好！', '我想订购：{item_cn} {qty} 个。', '{cargo_addr_line}', '麻烦发一下订单（下单链接），谢谢！'].join('\n'),
    ru_template: ['Здравствуйте! Хочу у вас заказать {item_ru_singular}. Количество: {qty} шт.', '{cargo_addr_line_ru}', 'Отправьте, пожалуйста, ордер на заказ.'].join(
      '\n',
    ),
  };

  const t2: SupplierTemplate = {
    id: 'tpl_price',
    name: 'Запрос цены/наличия',
    cn_template: ['你好！', '请问 {item_cn} 现在有货吗？{qty_hint_cn}', '请发一下价格、最小起订量（MOQ）和发货时间，谢谢！'].join('\n'),
    ru_template: ['Здравствуйте! Подскажите, пожалуйста, {item_ru} сейчас в наличии?{qty_hint_ru}', 'Пришлите цену, минимальную партию (MOQ) и сроки отправки. Спасибо!'].join('\n'),
  };

  const t3: SupplierTemplate = {
    id: 'tpl_repeat',
    name: 'Повторный заказ (мы уже брали)',
    cn_template: ['你好！我们之前买过你们的产品。', '这次我想再订购：{item_cn} {qty} 个。', '{cargo_addr_line}', '麻烦发一下下单链接/订单，谢谢！'].join('\n'),
    ru_template: ['Здравствуйте! Мы раньше уже заказывали у вас.', 'Сейчас хотим повторить заказ: {item_ru}. Количество: {qty} шт.', '{cargo_addr_line_ru}', 'Пришлите ссылку/ордер на оплату, пожалуйста.'].join(
      '\n',
    ),
  };

  return [t1, t2, t3];
}

function renderTemplate(tpl: string, vars: Record<string, string>) {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

/* ───────────────── Calculator ───────────────── */
function calcOrderUSD(args: { qty: number; supplier?: Supplier | null; cargo?: ChinaCargo | null }) {
  const qty = Number.isFinite(args.qty) ? Math.max(0, args.qty) : 0;
  const unitPrice = Number(args.supplier?.unit_price_usd ?? 0);
  const unitWeight = Number(args.supplier?.unit_weight_kg ?? 0);
  const pricePerKg = Number(args.cargo?.price_per_kg ?? 0);

  const safeUnitPrice = Number.isFinite(unitPrice) ? Math.max(0, unitPrice) : 0;
  const safeUnitWeight = Number.isFinite(unitWeight) ? Math.max(0, unitWeight) : 0;
  const safePricePerKg = Number.isFinite(pricePerKg) ? Math.max(0, pricePerKg) : 0;

  const itemsCost = qty * safeUnitPrice;
  const weightKg = qty * safeUnitWeight;
  const shipCost = weightKg * safePricePerKg;
  const total = itemsCost + shipCost;

  return { qty, unitPrice: safeUnitPrice, unitWeight: safeUnitWeight, pricePerKg: safePricePerKg, itemsCost, weightKg, shipCost, total };
}

/* ───────────────── Normalizers ───────────────── */
function normalizeCargos(input: any): { cargos: ChinaCargo[]; defId: string } {
  const fallback: ChinaCargo[] = [
    { id: 'cargo_1', name: 'Карго #1', address: '', price_per_kg: 0 },
    { id: 'cargo_2', name: 'Карго #2', address: '', price_per_kg: 0 },
    { id: 'cargo_3', name: 'Карго #3', address: '', price_per_kg: 0 },
  ];

  const raw = Array.isArray(input?.china_cargos) ? input.china_cargos : null;

  let cargos: ChinaCargo[] = fallback.map((c) => ({ ...c }));
  if (raw) {
    cargos = raw.slice(0, 3).map((x: any, i: number) => ({
      id: typeof x?.id === 'string' ? x.id : fallback[i]?.id ?? uid(),
      name: String(x?.name ?? `Карго #${i + 1}`),
      address: String(x?.address ?? ''),
      price_per_kg: Number.isFinite(Number(x?.price_per_kg)) ? Number(x.price_per_kg) : 0,
    }));
    while (cargos.length < 3) {
      const i = cargos.length;
      cargos.push({ id: fallback[i]?.id ?? uid(), name: `Карго #${i + 1}`, address: '', price_per_kg: 0 });
    }
  }

  const defIdRaw = typeof input?.china_cargo_default_id === 'string' ? input.china_cargo_default_id : '';
  const defId = cargos.some((c) => c.id === defIdRaw) ? defIdRaw : cargos[0]?.id ?? 'cargo_1';

  return { cargos, defId };
}

function safeItemType(x: any, fallbackKey?: string): ItemTypeDef | null {
  const key = String(x?.key ?? fallbackKey ?? '').trim();
  if (!key) return null;

  const ru = String(x?.ru ?? x?.label_ru ?? key).trim() || key;
  const ru_singular = String(x?.ru_singular ?? x?.label_ru_singular ?? ru.toLowerCase()).trim() || ru.toLowerCase();
  const cn = String(x?.cn ?? x?.label_cn ?? ru).trim() || ru;

  const iconRaw = String(x?.icon ?? '').trim();
  const icon: ItemTypeDef['icon'] =
    iconRaw === 'bag' ||
    iconRaw === 'case' ||
    iconRaw === 'cloth' ||
    iconRaw === 'tag' ||
    iconRaw === 'award' ||
    iconRaw === 'logo' ||
    iconRaw === 'pos' ||
    iconRaw === 'calculator' ||
    iconRaw === 'shelves' ||
    iconRaw === 'leaflets' ||
    iconRaw === 'package' ||
    iconRaw === 'generic'
      ? (iconRaw as any)
      : 'package';

  const group = normalizeGroup(x?.group, key);

  return { key, ru, ru_singular, cn, icon, group };
}

function normalizeSuppliersSettings(input: any): SuppliersSettings {
  const removedDefaults = Array.isArray(input?.removed_item_types)
    ? input.removed_item_types.map((x: any) => String(x)).filter(Boolean)
    : [];

  const defaultFiltered = DEFAULT_ITEM_TYPES.filter((d) => !removedDefaults.includes(d.key)).map((t) => ({ ...t }));

  let types: ItemTypeDef[] = [];
  const rawTypes = Array.isArray(input?.item_types) ? input.item_types : null;

  if (rawTypes) {
    for (const row of rawTypes) {
      const v = safeItemType(row);
      if (v) types.push(v);
    }
  }

  for (const d of DEFAULT_ITEM_TYPES) {
    if (removedDefaults.includes(d.key)) continue;
    if (!types.some((x) => x.key === d.key)) types.push({ ...d });
  }

  if (!types.length) types = defaultFiltered.slice();

  const rawSup = input?.suppliers && typeof input.suppliers === 'object' ? input.suppliers : null;
  if (rawSup) {
    for (const k of Object.keys(rawSup)) {
      if (!types.some((x) => x.key === k)) {
        types.push({
          key: k,
          ru: k,
          ru_singular: k.toLowerCase(),
          cn: k,
          icon: 'package',
          group: inferGroupByKey(k),
        });
      }
    }
  }

  {
    const seen = new Set<string>();
    types = types
      .map((t) => ({ ...t, group: normalizeGroup((t as any)?.group, t.key) }))
      .filter((t) => {
        if (!t.key) return false;
        if (seen.has(t.key)) return false;
        seen.add(t.key);
        return true;
      });
  }

  const base: SuppliersSettings = {
    version: 1,
    item_types: types,
    suppliers: Object.fromEntries(types.map((t) => [t.key, []])),
    templates: defaultTemplates(),
    logs: {},
    removed_item_types: removedDefaults,
  };

  if (rawSup) {
    const out: Record<string, Supplier[]> = {};

    for (const it of types) {
      const t = it.key;
      const arr = Array.isArray(rawSup[t]) ? rawSup[t] : [];
      const mapped: Supplier[] = arr.map((x: any, i: number) => {
        const id = typeof x?.id === 'string' ? x.id : uid();
        const display_name = String(x?.display_name ?? `Поставщик ${i + 1}`);
        const rawIcon = String(x?.icon_key ?? '');
        const LEGACY_ICON_MAP: Record<string, IconKey> = { chat: 'other', store: 'taobao', truck: 'other', link: 'other', spark: 'other' };
        const icon_key = (ICON_OPTIONS.some((k) => k.key === rawIcon) ? rawIcon : LEGACY_ICON_MAP[rawIcon] ?? 'other') as IconKey;
        const link_url = String(x?.link_url ?? x?.chat_url ?? x?.store_url ?? '').trim();

        const unit_price_usd = Number.isFinite(Number(x?.unit_price_usd)) ? Number(x.unit_price_usd) : 0;
        const unit_weight_kg = Number.isFinite(Number(x?.unit_weight_kg)) ? Number(x.unit_weight_kg) : 0;

        return {
          id,
          type: t,
          display_name,
          description: typeof x?.description === 'string' ? x.description : '',
          icon_key,
          link_url,
          unit_price_usd,
          unit_weight_kg,
          is_default: !!x?.is_default,
          sort_order: Number.isFinite(Number(x?.sort_order)) ? Number(x?.sort_order) : i,
          last_order_at: typeof x?.last_order_at === 'string' ? x.last_order_at : undefined,
          last_order_qty: Number.isFinite(Number(x?.last_order_qty)) ? Number(x?.last_order_qty) : undefined,
          last_order_template_id: typeof x?.last_order_template_id === 'string' ? x?.last_order_template_id : undefined,
        };
      });

      const normalized = mapped
        .slice()
        .sort((a, b) => {
          const ao = Number.isFinite(a.sort_order as any) ? Number(a.sort_order) : 9999;
          const bo = Number.isFinite(b.sort_order as any) ? Number(b.sort_order) : 9999;
          if (ao !== bo) return ao - bo;
          return String(a.display_name ?? '').localeCompare(String(b.display_name ?? ''), 'ru');
        })
        .map((s, idx) => ({ ...s, sort_order: idx, type: t }));

      const defIdx = normalized.findIndex((x) => x.is_default);
      if (defIdx >= 0) normalized.forEach((x, i) => (x.is_default = i === defIdx));

      out[t] = normalized;
    }

    base.suppliers = out;
  }

  const rawTpl = input?.templates;
  if (Array.isArray(rawTpl) && rawTpl.length) {
    const mapped = rawTpl.map((x: any, i: number) => ({
      id: typeof x?.id === 'string' ? x.id : `tpl_${i}_${uid()}`,
      name: String(x?.name ?? `Шаблон ${i + 1}`),
      is_default: !!x?.is_default,
      cn_template: String(x?.cn_template ?? ''),
      ru_template: String(x?.ru_template ?? ''),
      types: Array.isArray(x?.types) ? x.types.map((z: any) => String(z)).filter(Boolean) : undefined,
    })) as SupplierTemplate[];

    if (!mapped.some((t) => t.is_default)) {
      if (mapped[0]) mapped[0].is_default = true;
    } else {
      const first = mapped.find((t) => t.is_default);
      mapped.forEach((t) => (t.is_default = t.id === first?.id));
    }

    const def = defaultTemplates()[0];
    base.templates = mapped.map((t) => ({
      ...t,
      cn_template: t.cn_template || def.cn_template,
      ru_template: t.ru_template || def.ru_template,
    }));
  }

  const rawLogs = input?.logs;
  if (rawLogs && typeof rawLogs === 'object') {
    const out: Record<string, SupplierLogEntry[]> = {};
    const fallbackType = base.item_types[0]?.key ?? 'bag';

    for (const [sid, list] of Object.entries(rawLogs)) {
      if (!sid || !Array.isArray(list)) continue;
      out[sid] = (list as any[])
        .map((x) => ({
          id: typeof x?.id === 'string' ? x.id : uid(),
          ts: typeof x?.ts === 'string' ? x.ts : new Date().toISOString(),
          supplier_id: typeof x?.supplier_id === 'string' ? x.supplier_id : String(sid),
          supplier_name: String(x?.supplier_name ?? ''),
          type: typeof x?.type === 'string' ? x.type : fallbackType,
          qty: Number.isFinite(Number(x?.qty)) ? Number(x.qty) : 0,
          template_id: String(x?.template_id ?? ''),
          cargo_name: String(x?.cargo_name ?? ''),
          cargo_addr_preview: String(x?.cargo_addr_preview ?? ''),
        }))
        .slice(0, 50);
    }
    base.logs = out;
  }

  return base;
}

function importLegacySuppliers(legacy: any): SuppliersSettings | null {
  const raw = legacy?.suppliers;
  if (!raw || typeof raw !== 'object') return null;

  const out: SuppliersSettings = {
    version: 1,
    item_types: DEFAULT_ITEM_TYPES.map((t) => ({ ...t, group: normalizeGroup((t as any)?.group, t.key) })),
    suppliers: Object.fromEntries(DEFAULT_ITEM_TYPES.map((t) => [t.key, []])),
    templates: defaultTemplates(),
    logs: {},
    removed_item_types: [],
  };

  let anyFound = false;

  for (const it of out.item_types) {
    const t = it.key;
    const arr = Array.isArray(raw?.[t]) ? raw[t] : [];
    if (arr.length) anyFound = true;

    const mapped: Supplier[] = arr.map((x: any, i: number) => ({
      id: typeof x?.id === 'string' ? x.id : uid(),
      type: t,
      display_name: String(x?.display_name ?? `Поставщик ${i + 1}`),
      description: typeof x?.description === 'string' ? x.description : '',
      icon_key: (() => { const ri = String(x?.icon_key ?? ''); const LM: Record<string, IconKey> = { chat: 'other', store: 'taobao', truck: 'other', link: 'other', spark: 'other' }; return (ICON_OPTIONS.some((k) => k.key === ri) ? ri : LM[ri] ?? 'other') as IconKey; })(),
      link_url: String(x?.chat_url ?? x?.store_url ?? x?.link_url ?? '').trim(),
      unit_price_usd: Number.isFinite(Number(x?.unit_price_usd)) ? Number(x.unit_price_usd) : 0,
      unit_weight_kg: Number.isFinite(Number(x?.unit_weight_kg)) ? Number(x.unit_weight_kg) : 0,
      is_default: !!x?.is_default,
      sort_order: Number.isFinite(Number(x?.sort_order)) ? Number(x.sort_order) : i,
    }));

    out.suppliers[t] = mapped
      .slice()
      .sort((a, b) => Number(a.sort_order ?? 9999) - Number(b.sort_order ?? 9999))
      .map((s, idx) => ({ ...s, sort_order: idx, type: t }));
  }

  return anyFound ? out : null;
}

/* ───────────────── Cards (outside page) ───────────────── */
type SupplierCardProps = {
  s: Supplier;
  typeDef?: ItemTypeDef | null;
  typeLabel: string;
  onPatch: (id: string, patch: Partial<Supplier>) => void;
  onRemove: (id: string) => void;
  onMakeDefault: (id: string) => void;
};

function SupplierCard({ s, typeDef, typeLabel, onPatch, onRemove, onMakeDefault }: SupplierCardProps) {
  const lastAt = s.last_order_at ? new Date(s.last_order_at) : null;
  const lastText = lastAt ? `${dtFmt(lastAt)} • ${fmt(s.last_order_qty ?? 0)} шт.` : '—';

  // ✅ FIX: дробные поля — строковый ввод + commit onBlur/Enter
  const [priceTxt, setPriceTxt] = useState(() => fmt(Number.isFinite(Number(s.unit_price_usd)) ? Number(s.unit_price_usd) : 0));
  const [weightTxt, setWeightTxt] = useState(() => fmt(Number.isFinite(Number(s.unit_weight_kg)) ? Number(s.unit_weight_kg) : 0));

  useEffect(() => {
    setPriceTxt(fmt(Number.isFinite(Number(s.unit_price_usd)) ? Number(s.unit_price_usd) : 0));
  }, [s.id, s.unit_price_usd]);

  useEffect(() => {
    setWeightTxt(fmt(Number.isFinite(Number(s.unit_weight_kg)) ? Number(s.unit_weight_kg) : 0));
  }, [s.id, s.unit_weight_kg]);

  const commitPrice = useCallback(() => {
    const n = parseDecimalOrNull(priceTxt);
    onPatch(s.id, { unit_price_usd: n ?? 0 });
    setPriceTxt(fmt(n ?? 0));
  }, [priceTxt, onPatch, s.id]);

  const commitWeight = useCallback(() => {
    const n = parseDecimalOrNull(weightTxt);
    onPatch(s.id, { unit_weight_kg: n ?? 0 });
    setWeightTxt(fmt(n ?? 0));
  }, [weightTxt, onPatch, s.id]);

  const grp = itemGroupOf(typeDef);
  const grpBadge =
    grp === 'consumable'
      ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
      : 'bg-violet-50 text-violet-800 ring-1 ring-violet-200';

  return (
    <div className="rounded-3xl bg-white ring-1 ring-sky-100 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="h-11 w-11 rounded-3xl grid place-items-center bg-gradient-to-tr from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_16px_46px_rgba(34,211,238,0.22)] ring-1 ring-white/50 shrink-0">
            <IconPick k={s.icon_key} className="h-5 w-5" />
          </span>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-bold text-slate-900 truncate max-w-[320px]">{s.display_name}</div>

              {s.is_default && (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-sky-50 text-sky-700 ring-1 ring-sky-200">
                  <Star className="h-3.5 w-3.5" /> По умолчанию
                </span>
              )}

              <span className={cls('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold', grpBadge)}>
                {grp === 'consumable' ? 'Расходник' : 'Инвентарь'}
              </span>

              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-slate-50 text-slate-700 ring-1 ring-slate-200">
                <ItemTypeIcon def={typeDef} className="h-3.5 w-3.5" /> {typeLabel}
              </span>
            </div>

            <div className="mt-1 text-[11px] text-slate-600">
              Последний заказ: <span className="font-semibold text-slate-900 tabular-nums">{lastText}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button type="button" className={cls(UI.btnBase, UI.btnGhost, 'px-3 py-2 text-xs')} onClick={() => onMakeDefault(s.id)} title="Сделать по умолчанию">
            {s.is_default ? <Star className="h-4 w-4" /> : <StarOff className="h-4 w-4" />}
            Default
          </button>

          <button type="button" className={cls(UI.btnBase, UI.btnDanger, 'px-3 py-2 text-xs')} onClick={() => onRemove(s.id)} title="Удалить поставщика">
            <Trash2 className="h-4 w-4" />
            Удалить
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="grid gap-1">
          <div className="text-[11px] font-semibold text-slate-400">Название (RU)</div>
          <input className={UI.input} value={s.display_name} onChange={(e) => onPatch(s.id, { display_name: e.target.value })} />
        </div>

        <div className="grid gap-1">
          <div className="text-[11px] font-semibold text-slate-400">Ссылка</div>
          <input
            className={UI.input}
            value={s.link_url ?? ''}
            onChange={(e) => onPatch(s.id, { link_url: e.target.value })}
            placeholder="Одна ссылка (чат / магазин / контакт)"
          />
        </div>

        <div className="grid gap-3 lg:col-span-2 sm:grid-cols-2">
          <div className="grid gap-1">
            <div className="text-[11px] font-semibold text-slate-400">Цена за 1 шт (USD)</div>
            <input
              className={UI.input}
              type="text"
              inputMode="decimal"
              value={priceTxt}
              onChange={(e) => {
                const v = acceptDecimalTyping(e.target.value);
                if (v !== null) setPriceTxt(v);
              }}
              onBlur={commitPrice}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
              }}
              placeholder="0.18"
            />
          </div>

          <div className="grid gap-1">
            <div className="text-[11px] font-semibold text-slate-400">Вес 1 шт (кг)</div>
            <input
              className={UI.input}
              type="text"
              inputMode="decimal"
              value={weightTxt}
              onChange={(e) => {
                const v = acceptDecimalTyping(e.target.value);
                if (v !== null) setWeightTxt(v);
              }}
              onBlur={commitWeight}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
              }}
              placeholder="0.012"
            />
          </div>

          <div className="sm:col-span-2 text-[11px] text-slate-400">
            Используется в расчёте: <span className="font-semibold text-slate-900">себестоимость + доставка по весу</span>.
          </div>
        </div>

        <div className="grid gap-1 lg:col-span-2">
          <div className="text-[11px] font-semibold text-slate-400">Комментарий</div>
          <textarea
            className={cls(UI.textarea, 'min-h-[110px] resize-y')}
            value={s.description ?? ''}
            onChange={(e) => onPatch(s.id, { description: e.target.value })}
            placeholder="Нюансы: качество, сроки, риски..."
          />
        </div>

        <div className="grid gap-1 lg:col-span-2">
          <div className="text-[11px] font-semibold text-slate-400">Иконка</div>
          <select className={UI.select} value={s.icon_key} onChange={(e) => onPatch(s.id, { icon_key: e.target.value as IconKey })}>
            {ICON_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

/* ───────────────── Cargo Card (fix decimal input) ───────────────── */
type CargoCardProps = {
  c: ChinaCargo;
  isDef: boolean;
  onPickDefault: (id: string) => void;
  onPatch: (id: string, patch: Partial<ChinaCargo>) => void;
};

function CargoCard({ c, isDef, onPickDefault, onPatch }: CargoCardProps) {
  const [shipTxt, setShipTxt] = useState(() => fmt(Number.isFinite(Number(c.price_per_kg)) ? Number(c.price_per_kg) : 0));

  useEffect(() => {
    setShipTxt(fmt(Number.isFinite(Number(c.price_per_kg)) ? Number(c.price_per_kg) : 0));
  }, [c.id, c.price_per_kg]);

  const commitShip = useCallback(() => {
    const n = parseDecimalOrNull(shipTxt);
    onPatch(c.id, { price_per_kg: n ?? 0 });
    setShipTxt(fmt(n ?? 0));
  }, [shipTxt, onPatch, c.id]);

  return (
    <div className="rounded-3xl bg-white ring-1 ring-sky-100 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900 truncate">{(c.name ?? '').trim() || '—'}</div>
        </div>

        <button type="button" className={cls(UI.btnBase, isDef ? UI.btnPrimary : UI.btnGhost, 'px-3 py-2')} onClick={() => onPickDefault(c.id)} title="Выбрать для сообщений">
          {isDef ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {isDef ? 'Выбрано' : 'Выбрать'}
        </button>
      </div>

      <div className="mt-4 grid gap-3">
        <div className="grid gap-1">
          <div className="text-[11px] font-semibold text-slate-400">Название</div>
          <input className={UI.input} value={c.name ?? ''} onChange={(e) => onPatch(c.id, { name: e.target.value })} placeholder="Напр. Карго Guangdong" />
        </div>

        <div className="grid gap-1">
          <div className="text-[11px] font-semibold text-slate-400">Адрес (Китай)</div>
          <textarea
            className={cls(UI.textarea, 'min-h-[110px] resize-y')}
            value={c.address ?? ''}
            onChange={(e) => onPatch(c.id, { address: e.target.value })}
            placeholder="Вставь адрес карго полностью"
          />
        </div>

        <div className="grid gap-1">
          <div className="text-[11px] font-semibold text-slate-400">Доставка (USD / кг)</div>
          <input
            className={UI.input}
            type="text"
            inputMode="decimal"
            value={shipTxt}
            onChange={(e) => {
              const v = acceptDecimalTyping(e.target.value);
              if (v !== null) setShipTxt(v);
            }}
            onBlur={commitShip}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
            }}
            placeholder="3.2"
          />
        </div>
      </div>
    </div>
  );
}

/* ───────────────── Quick Supplier (Edit by button) ───────────────── */
type QuickSupplierEditorProps = {
  s: Supplier;
  typeLabel: string;
  qty: number;
  cargo: ChinaCargo;
  allCargos: ChinaCargo[];
  onSelectCargo: (cargoId: string) => void;

  onPatch: (id: string, patch: Partial<Supplier>) => void;
  onPatchCargo: (cargoId: string, patch: Partial<ChinaCargo>) => void;
  onRemove: (id: string) => void;

  onOrder: () => void;
};

function QuickSupplierEditor({ s, typeLabel, qty, cargo, allCargos, onSelectCargo, onPatch, onPatchCargo, onRemove, onOrder }: QuickSupplierEditorProps) {
  const [editing, setEditing] = useState(false);

  const [draftLink, setDraftLink] = useState<string>(s.link_url ?? '');
  const [draftDesc, setDraftDesc] = useState<string>(s.description ?? '');
  const [draftPrice, setDraftPrice] = useState<string>(String(Number.isFinite(Number(s.unit_price_usd)) ? s.unit_price_usd : 0));
  const [draftWeight, setDraftWeight] = useState<string>(String(Number.isFinite(Number(s.unit_weight_kg)) ? s.unit_weight_kg : 0));
  const [draftShip, setDraftShip] = useState<string>(String(Number.isFinite(Number(cargo?.price_per_kg)) ? cargo.price_per_kg : 0));

  useEffect(() => {
    if (editing) return;
    setDraftLink(s.link_url ?? '');
    setDraftDesc(s.description ?? '');
    setDraftPrice(String(Number.isFinite(Number(s.unit_price_usd)) ? s.unit_price_usd : 0));
    setDraftWeight(String(Number.isFinite(Number(s.unit_weight_kg)) ? s.unit_weight_kg : 0));
    setDraftShip(String(Number.isFinite(Number(cargo?.price_per_kg)) ? cargo.price_per_kg : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id, s.link_url, s.description, s.unit_price_usd, s.unit_weight_kg, cargo?.id, cargo?.price_per_kg, editing]);

  const effSupplier: Supplier = useMemo(() => {
    if (!editing) return s;
    return {
      ...s,
      link_url: draftLink,
      description: draftDesc,
      unit_price_usd: clampNum(draftPrice, 0),
      unit_weight_kg: clampNum(draftWeight, 0),
    };
  }, [editing, s, draftLink, draftDesc, draftPrice, draftWeight]);

  const effCargo: ChinaCargo = useMemo(() => {
    if (!editing) return cargo;
    return { ...cargo, price_per_kg: clampNum(draftShip, 0) };
  }, [editing, cargo, draftShip]);

  const c = useMemo(() => calcOrderUSD({ qty, supplier: effSupplier, cargo: effCargo }), [qty, effSupplier, effCargo]);

  const openLink = useCallback(() => {
    const link = safeStr(s.link_url);
    if (!link) return;
    window.open(link, '_blank', 'noopener,noreferrer');
  }, [s.link_url]);

  const startEdit = useCallback(() => {
    setDraftLink(s.link_url ?? '');
    setDraftDesc(s.description ?? '');
    setDraftPrice(String(Number.isFinite(Number(s.unit_price_usd)) ? s.unit_price_usd : 0));
    setDraftWeight(String(Number.isFinite(Number(s.unit_weight_kg)) ? s.unit_weight_kg : 0));
    setDraftShip(String(Number.isFinite(Number(cargo?.price_per_kg)) ? cargo.price_per_kg : 0));
    setEditing(true);
  }, [s, cargo]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraftLink(s.link_url ?? '');
    setDraftDesc(s.description ?? '');
    setDraftPrice(String(Number.isFinite(Number(s.unit_price_usd)) ? s.unit_price_usd : 0));
    setDraftWeight(String(Number.isFinite(Number(s.unit_weight_kg)) ? s.unit_weight_kg : 0));
    setDraftShip(String(Number.isFinite(Number(cargo?.price_per_kg)) ? cargo.price_per_kg : 0));
  }, [s, cargo]);

  const saveEdit = useCallback(() => {
    onPatch(s.id, {
      link_url: safeStr(draftLink),
      description: draftDesc ?? '',
      unit_price_usd: clampNum(draftPrice, 0),
      unit_weight_kg: clampNum(draftWeight, 0),
    });

    setEditing(false);
  }, [onPatch, s.id, draftLink, draftDesc, draftPrice, draftWeight]);

  const hasLink = !!safeStr(s.link_url);

  const usdWithKgs = useCallback((usd: number, digits = 2) => {
    return `$${fmtMoneyUSD(usd, digits)}  ·  ${fmtMoneyKGSFromUSD(usd)} сом`;
  }, []);

  return (
    <div className="rounded-3xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] overflow-hidden max-w-full">
      <div className="p-4 sm:p-5">
        <div className="grid gap-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3 min-w-0">
              <span className="mt-0.5 h-10 w-10 rounded-2xl grid place-items-center bg-gradient-to-tr from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_14px_38px_rgba(34,211,238,0.22)] ring-1 ring-white/50 shrink-0">
                <IconPick k={s.icon_key} className="h-5 w-5" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="text-base font-extrabold text-slate-900 truncate whitespace-nowrap">{s.display_name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {s.is_default && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-sky-50 text-sky-700 ring-1 ring-sky-200">
                      <Star className="h-3.5 w-3.5" /> Default
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-slate-50 text-slate-700 ring-1 ring-slate-200">{typeLabel}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {hasLink && (
                <button type="button" className={cls(UI.btnBase, UI.btnGhost, 'px-3 py-2 text-xs whitespace-nowrap')} onClick={openLink} title="Открыть ссылку">
                  <ExternalLink className="h-4 w-4" />
                  Открыть
                </button>
              )}

              <button type="button" onClick={onOrder} className={cls(UI.btnBase, UI.btnPrimary, 'px-3 py-2 text-xs whitespace-nowrap')}>
                <Clipboard className="h-4 w-4" />
                Скопировать
              </button>

              {!editing ? (
                <>
                  <button type="button" onClick={startEdit} className={cls(UI.btnBase, UI.btnGhost, 'px-3 py-2 text-xs whitespace-nowrap')}>
                    <Pencil className="h-4 w-4" />
                    Изменить
                  </button>
                  <button type="button" onClick={() => onRemove(s.id)} className={cls(UI.btnBase, UI.btnDanger, 'px-3 py-2 text-xs whitespace-nowrap')} title="Удалить поставщика">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={saveEdit} className={cls(UI.btnBase, UI.btnPrimary, 'px-3 py-2 text-xs whitespace-nowrap')}>
                    <Save className="h-4 w-4" />
                    Сохранить
                  </button>
                  <button type="button" onClick={cancelEdit} className={cls(UI.btnBase, UI.btnGhost, 'px-3 py-2 text-xs whitespace-nowrap')}>
                    <X className="h-4 w-4" />
                    Отмена
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/80 ring-1 ring-sky-200/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-slate-400">
              Кол-во: <span className="font-extrabold text-cyan-600 tabular-nums">{fmt(c.qty)}</span>
            </div>
            <div className="text-[11px] text-slate-400">Курс: 1$ = {USD_TO_KGS} сом</div>
          </div>

          <div className="mt-3 grid gap-2">
            <Row label="Цена за 1 шт" value={usdWithKgs(c.unitPrice)} />
            <Row label="Себестоимость товара" value={usdWithKgs(c.itemsCost)} />
            <Row label="Вес 1 шт" value={`${fmtMoneyUSD(c.unitWeight, 5)} кг`} />
            <Row label="Общий вес" value={`${fmtMoneyUSD(c.weightKg, 4)} кг`} />
            <Row label="Доставка ($/кг)" value={`$${fmtMoneyUSD(c.pricePerKg)} (${String(Math.round(c.pricePerKg * USD_TO_KGS))} сом/кг)`} />
            <Row label="Стоимость доставки" value={usdWithKgs(c.shipCost)} />
          </div>

          <div className="mt-3 rounded-2xl bg-cyan-50 ring-1 ring-cyan-200 p-3 flex items-center justify-between gap-3">
            <div className="text-sm font-bold text-slate-700">Итого</div>
            <div className="flex items-baseline gap-3">
              <div className="text-[20px] font-extrabold text-cyan-700 tabular-nums whitespace-nowrap">{`$${fmtMoneyUSD(c.total)}`}</div>
              <div className="text-[20px] font-extrabold text-slate-800 tabular-nums whitespace-nowrap">{`${fmtMoneyKGSFromUSD(c.total)} сом`}</div>
            </div>
          </div>

          {c.qty > 0 && c.total > 0 && (
            <div className="mt-3 rounded-2xl bg-slate-50 ring-1 ring-slate-200 px-3 py-2 flex items-center justify-between gap-3">
              <div className="text-[12px] text-slate-500">1 шт (товар + доставка)</div>
              <div className="text-[12px] font-extrabold text-slate-700 tabular-nums">
                ${fmtMoneyUSD(c.total / c.qty)}  ·  {fmtMoneyKGSFromUSD(c.total / c.qty)} сом
              </div>
            </div>
          )}

          {(c.unitPrice === 0 || c.unitWeight === 0 || c.pricePerKg === 0) && (
            <div className="mt-3 rounded-2xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-[11px] text-amber-800">
              Заполни цену / вес / доставку — иначе итог будет неверным.
            </div>
          )}
        </div>

        {!editing && safeStr(s.description) && (
          <div className="mt-3 text-[12px] text-slate-700 break-words">
            <span className="text-slate-500 font-semibold">Комментарий:</span> {s.description}
          </div>
        )}

        {editing && (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="grid gap-1 md:col-span-2">
              <div className="text-[11px] font-semibold text-slate-400">Ссылка</div>
              <input className={UI.input} value={draftLink} onChange={(e) => setDraftLink(e.target.value)} placeholder="WeChat / Taobao / любая ссылка" />
            </div>

            <div className="grid gap-1 md:col-span-2">
              <div className="text-[11px] font-semibold text-slate-400">Маркетплейс</div>
              <div className="flex flex-wrap gap-1.5">
                {ICON_OPTIONS.map((o) => {
                  const active = s.icon_key === o.key;
                  return (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => onPatch(s.id, { icon_key: o.key })}
                      className={cls(
                        'flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium ring-1 transition',
                        active
                          ? 'bg-cyan-50 text-cyan-800 ring-cyan-300 shadow-sm'
                          : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50',
                      )}
                    >
                      <IconPick k={o.key} className="h-5 w-5" />
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-1 md:col-span-2">
              <div className="text-[11px] font-semibold text-slate-400">Комментарий</div>
              <textarea className={cls(UI.textarea, 'min-h-[90px] resize-y')} value={draftDesc} onChange={(e) => setDraftDesc(e.target.value)} />
            </div>

            <div className="grid gap-1">
              <div className="text-[11px] font-semibold text-slate-400">Цена за 1 шт (USD)</div>
              <input
                className={UI.input}
                type="text"
                inputMode="decimal"
                value={draftPrice}
                onChange={(e) => {
                  const v = acceptDecimalTyping(e.target.value);
                  if (v !== null) setDraftPrice(v);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                }}
              />
            </div>

            <div className="grid gap-1">
              <div className="text-[11px] font-semibold text-slate-400">Вес 1 шт (кг)</div>
              <input
                className={UI.input}
                type="text"
                inputMode="decimal"
                value={draftWeight}
                onChange={(e) => {
                  const v = acceptDecimalTyping(e.target.value);
                  if (v !== null) setDraftWeight(v);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                }}
              />
            </div>

            <div className="grid gap-1 md:col-span-2">
              <div className="text-[11px] font-semibold text-slate-400">Карго для доставки</div>
              <select
                className={UI.select}
                value={cargo?.id ?? ''}
                onChange={(e) => {
                  onSelectCargo(e.target.value);
                  const picked = allCargos.find((c) => c.id === e.target.value);
                  if (picked) setDraftShip(String(Number.isFinite(Number(picked.price_per_kg)) ? picked.price_per_kg : 0));
                }}
              >
                {allCargos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.id} — ${fmtMoneyUSD(c.price_per_kg)}/кг
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 px-3 py-2 flex items-center justify-between gap-3">
      <div className="text-[12px] text-slate-700 min-w-0">
        <span className="break-words">{label}</span>
      </div>
      <div className="text-[12px] font-extrabold text-cyan-600 tabular-nums whitespace-nowrap">{value}</div>
    </div>
  );
}

/* ───────────────── Page ───────────────── */
export default function SuppliersPage() {
  const sb = useMemo(getSb, []);
  const mountedRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((s: string) => {
    setToast(s);
    window.setTimeout(() => setToast(null), 1600);
  }, []);

  const consumablesRawRef = useRef<ConsumablesSettings>({});

  /* cargo */
  const [chinaCargos, setChinaCargos] = useState<ChinaCargo[]>([
    { id: 'cargo_1', name: 'Карго #1', address: '', price_per_kg: 0 },
    { id: 'cargo_2', name: 'Карго #2', address: '', price_per_kg: 0 },
    { id: 'cargo_3', name: 'Карго #3', address: '', price_per_kg: 0 },
  ]);
  const [chinaCargoDefaultId, setChinaCargoDefaultId] = useState<string>('cargo_1');
  const [cargoPerType, setCargoPerType] = useState<Record<string, string>>({});

  // ✅ по умолчанию свернуто
  const [cargoOpen, setCargoOpen] = useState(false);

  const defaultCargo = useMemo(() => {
    const found = chinaCargos.find((c) => c.id === chinaCargoDefaultId);
    return found ?? chinaCargos[0] ?? { id: 'cargo_1', name: 'Карго', address: '', price_per_kg: 0 };
  }, [chinaCargos, chinaCargoDefaultId]);

  const getCargoForType = useCallback(
    (t: string): ChinaCargo => {
      const id = cargoPerType[t] || chinaCargoDefaultId;
      return chinaCargos.find((c) => c.id === id) ?? chinaCargos[0] ?? { id: 'cargo_1', name: 'Карго', address: '', price_per_kg: 0 };
    },
    [cargoPerType, chinaCargoDefaultId, chinaCargos],
  );

  /* suppliers settings */
  const [itemTypes, setItemTypes] = useState<ItemTypeDef[]>(DEFAULT_ITEM_TYPES.map((t) => ({ ...t })));
  const [suppliers, setSuppliers] = useState<Record<string, Supplier[]>>(() => Object.fromEntries(DEFAULT_ITEM_TYPES.map((t) => [t.key, []])));
  const [templates, setTemplates] = useState<SupplierTemplate[]>(defaultTemplates());
  const [logs, setLogs] = useState<Record<string, SupplierLogEntry[]>>({});

  const itemByKey = useMemo(() => {
    const m: Record<string, ItemTypeDef> = {};
    for (const t of itemTypes ?? []) m[t.key] = t;
    return m;
  }, [itemTypes]);

  const itemRu = useCallback((k: string) => itemByKey[k]?.ru ?? k, [itemByKey]);
  const itemRuSingular = useCallback((k: string) => itemByKey[k]?.ru_singular ?? k, [itemByKey]);
  const itemCn = useCallback((k: string) => itemByKey[k]?.cn ?? itemRu(k), [itemByKey, itemRu]);

  const groupedTypes = useMemo(() => {
    const cons: ItemTypeDef[] = [];
    const asset: ItemTypeDef[] = [];
    for (const t of itemTypes ?? []) {
      const g = itemGroupOf(t);
      if (g === 'consumable') cons.push(t);
      else asset.push(t);
    }
    return { consumable: cons, asset };
  }, [itemTypes]);

  /* autosave */
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const saveTimer = useRef<number | null>(null);

  /* ui controls */
  const [quickType, setQuickType] = useState<AccType>('bag');
  const [dirTab, setDirTab] = useState<AccType>('bag');
  const [quickPrefs, setQuickPrefs] = useState<QuickPrefs>({});
  const [copyMode, setCopyMode] = useState<'cn' | 'ru' | 'both'>('cn');

  const [preview, setPreview] = useState<{ cn: string; ru: string; supplier?: Supplier; template?: SupplierTemplate } | null>(null);

  const [deleteTypeOpen, setDeleteTypeOpen] = useState(false);
  const [deleteTypeKey, setDeleteTypeKey] = useState<string>('');

  // ✅ Добавление позиции: модалка (только расходник/инвентарь + название + иконка)
  const [addTypeOpen, setAddTypeOpen] = useState(false);
  const [addTypeGroup, setAddTypeGroup] = useState<ItemGroup>('consumable');
  const [addTypeName, setAddTypeName] = useState('');
  const [addTypeIcon, setAddTypeIcon] = useState<ItemTypeIconKey>('package');

  // ✅ Шаблоны: сворачиваемый блок (по умолчанию свернут)
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const templatesForType = useCallback((t: AccType) => templates.filter((x) => !x.types?.length || x.types.includes(t)), [templates]);

  const defaultTemplate = useMemo(() => {
    const found = templates.find((t) => t.is_default);
    return found ?? templates[0] ?? defaultTemplates()[0];
  }, [templates]);

  const defaultTemplateForType = useCallback(
    (t: AccType) => {
      const list = templatesForType(t);
      return list.find((x) => x.is_default) ?? list[0] ?? defaultTemplate;
    },
    [templatesForType, defaultTemplate],
  );

  const quickQty = useMemo(() => {
    const v = quickPrefs?.[quickType]?.qty;
    return typeof v === 'string' && v.trim() ? v : '1';
  }, [quickPrefs, quickType]);

  const quickTemplateId = useMemo(() => {
    const v = quickPrefs?.[quickType]?.templateId;
    if (typeof v === 'string' && v.trim()) return v;
    return defaultTemplateForType(quickType)?.id ?? 'tpl_order';
  }, [quickPrefs, quickType, defaultTemplateForType]);

  const persistQuickPrefsNow = useCallback((prefs: QuickPrefs) => {
    try {
      localStorage.setItem(`wh.settings.${QUICK_PREFS_KEY}`, JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, []);

  const setQuickPref = useCallback(
    (t: AccType, patch: Partial<{ qty: string; templateId: string }>) => {
      setQuickPrefs((prev) => {
        const base = prev?.[t] ?? { qty: '1', templateId: defaultTemplateForType(t)?.id ?? 'tpl_order' };
        const next: QuickPrefs = { ...(prev ?? {}), [t]: { ...base, ...patch } };
        persistQuickPrefsNow(next);
        return next;
      });
    },
    [defaultTemplateForType, persistQuickPrefsNow],
  );

  const safeQuickQty = useMemo(() => {
    const q = nInt(quickQty);
    if (!Number.isFinite(q) || q <= 0) return 0;
    return q;
  }, [quickQty]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const list = templatesForType(quickType);
    const curId = quickPrefs?.[quickType]?.templateId ?? '';
    const ok = !!curId && list.some((x) => x.id === curId);
    if (!ok) {
      const def = defaultTemplateForType(quickType);
      const nextId = def?.id ?? 'tpl_order';
      setQuickPref(quickType, { templateId: nextId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickType, templates, templatesForType, defaultTemplateForType]);

  /* ───────────────── CRITICAL FIX: avoid stale closures on save ───────────────── */
  const latestRef = useRef({
    itemTypes: DEFAULT_ITEM_TYPES.map((t) => ({ ...t })) as ItemTypeDef[],
    suppliers: Object.fromEntries(DEFAULT_ITEM_TYPES.map((t) => [t.key, []])) as Record<string, Supplier[]>,
    templates: defaultTemplates() as SupplierTemplate[],
    logs: {} as Record<string, SupplierLogEntry[]>,
    chinaCargos: [
      { id: 'cargo_1', name: 'Карго #1', address: '', price_per_kg: 0 },
      { id: 'cargo_2', name: 'Карго #2', address: '', price_per_kg: 0 },
    ] as ChinaCargo[],
    chinaCargoDefaultId: 'cargo_1' as string,
    cargoPerType: {} as Record<string, string>,
  });

  useEffect(() => {
    latestRef.current.itemTypes = itemTypes ?? [];
  }, [itemTypes]);
  useEffect(() => {
    latestRef.current.suppliers = suppliers ?? {};
  }, [suppliers]);
  useEffect(() => {
    latestRef.current.templates = templates ?? [];
  }, [templates]);
  useEffect(() => {
    latestRef.current.logs = logs ?? {};
  }, [logs]);
  useEffect(() => {
    latestRef.current.chinaCargos = chinaCargos ?? [];
  }, [chinaCargos]);
  useEffect(() => {
    latestRef.current.chinaCargoDefaultId = chinaCargoDefaultId ?? 'cargo_1';
  }, [chinaCargoDefaultId]);
  useEffect(() => {
    latestRef.current.cargoPerType = cargoPerType ?? {};
  }, [cargoPerType]);

  function makeSuppliersPayloadFromRef(): SuppliersSettings {
    const safeTypes = (latestRef.current.itemTypes ?? []).length
      ? (latestRef.current.itemTypes ?? []).slice()
      : DEFAULT_ITEM_TYPES.map((t) => ({ ...t }));

    const sup = latestRef.current.suppliers ?? {};
    const tplIn = (latestRef.current.templates ?? []).slice();
    const lg = latestRef.current.logs ?? {};

    const normalized: Record<string, Supplier[]> = {};
    for (const it of safeTypes) {
      const t = it.key;
      const arr = (sup[t] ?? []).slice();
      const sorted = arr
        .slice()
        .sort((a, b) => {
          const ao = Number.isFinite(a.sort_order as any) ? Number(a.sort_order) : 9999;
          const bo = Number.isFinite(b.sort_order as any) ? Number(b.sort_order) : 9999;
          if (ao !== bo) return ao - bo;
          return String(a.display_name ?? '').localeCompare(String(b.display_name ?? ''), 'ru');
        })
        .map((s, i) => ({
          ...s,
          type: t,
          sort_order: i,
          unit_price_usd: Number.isFinite(Number(s.unit_price_usd)) ? Number(s.unit_price_usd) : 0,
          unit_weight_kg: Number.isFinite(Number(s.unit_weight_kg)) ? Number(s.unit_weight_kg) : 0,
        }));

      const firstDef = sorted.find((x) => x.is_default);
      if (firstDef) sorted.forEach((x) => (x.is_default = x.id === firstDef.id));

      normalized[t] = sorted;
    }

    let tpl = tplIn;
    if (!tpl.length) tpl = defaultTemplates();
    if (!tpl.some((t) => t.is_default)) {
      tpl = tpl.map((t, i) => ({ ...t, is_default: i === 0 }));
    } else {
      const first = tpl.find((t) => t.is_default)!;
      tpl = tpl.map((t) => ({ ...t, is_default: t.id === first.id }));
    }

    const curKeys = new Set(safeTypes.map((x) => x.key));
    const removed_item_types = DEFAULT_ITEM_TYPES.map((x) => x.key).filter((k) => !curKeys.has(k));

    return { version: 1, item_types: safeTypes, suppliers: normalized, templates: tpl, logs: lg, removed_item_types };
  }

  function makeConsumablesPayloadFromRef(): ConsumablesSettings {
    const base =
      consumablesRawRef.current && typeof consumablesRawRef.current === 'object'
        ? ({ ...consumablesRawRef.current } as ConsumablesSettings)
        : ({} as ConsumablesSettings);

    const cargosIn = (latestRef.current.chinaCargos ?? []).slice(0, 3);
    const cargos = cargosIn.map((c, i) => ({
      id: typeof c.id === 'string' ? c.id : `cargo_${i + 1}`,
      name: String(c.name ?? `Карго #${i + 1}`),
      address: String(c.address ?? ''),
      price_per_kg: Number.isFinite(Number(c.price_per_kg)) ? Number(c.price_per_kg) : 0,
    }));

    while (cargos.length < 2) {
      const i = cargos.length;
      cargos.push({ id: `cargo_${i + 1}`, name: `Карго #${i + 1}`, address: '', price_per_kg: 0 });
    }

    const defIdIn = latestRef.current.chinaCargoDefaultId;
    const defId = cargos.some((x) => x.id === defIdIn) ? defIdIn : cargos[0]?.id ?? 'cargo_1';

    base.version = base.version ?? 1;
    base.china_cargos = cargos;
    base.china_cargo_default_id = defId;
    base.cargo_per_type = latestRef.current.cargoPerType ?? {};

    return base;
  }

  const persistLocalNow = useCallback(() => {
    try {
      const suppliersPayload = makeSuppliersPayloadFromRef();
      const consumablesPayload = makeConsumablesPayloadFromRef();
      localStorage.setItem(`wh.settings.${SUPPLIERS_KEY}`, JSON.stringify(suppliersPayload));
      localStorage.setItem(`wh.settings.${CONSUMABLES_KEY}`, JSON.stringify(consumablesPayload));
    } catch {
      // ignore
    }
  }, []);

  const saveSoon = useCallback(() => {
    persistLocalNow();
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveAllNow().catch(() => {});
    }, 650);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistLocalNow]);

  useEffect(() => {
    return () => {
      try {
        if (saveTimer.current) {
          window.clearTimeout(saveTimer.current);
          saveTimer.current = null;
        }
        void flushSaveToDbBestEffort();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setCargoForType = useCallback(
    (t: string, cargoId: string) => {
      setCargoPerType((prev) => ({ ...prev, [t]: cargoId }));
      saveSoon();
    },
    [saveSoon],
  );

  async function upsertSettings(key: string, payload: any) {
    try {
      const { error } = await sb.from('app_settings').upsert({ key, value_json: payload } as any, { onConflict: 'key' } as any);
      if (error) throw error;
      return { ok: true as const, mode: 'db_json' as const };
    } catch (e1: any) {
      try {
        const { error } = await sb.from('app_settings').upsert({ key, value: JSON.stringify(payload) } as any, { onConflict: 'key' } as any);
        if (error) throw error;
        return { ok: true as const, mode: 'db_text' as const };
      } catch (e2: any) {
        localStorage.setItem(`wh.settings.${key}`, JSON.stringify(payload));
        return { ok: false as const, mode: 'local' as const, error: e2?.message ?? e1?.message ?? 'ошибка' };
      }
    }
  }

  async function flushSaveToDbBestEffort() {
    try {
      const suppliersPayload = makeSuppliersPayloadFromRef();
      const consumablesPayload = makeConsumablesPayloadFromRef();
      await upsertSettings(SUPPLIERS_KEY, suppliersPayload);
      await upsertSettings(CONSUMABLES_KEY, consumablesPayload);
      consumablesRawRef.current = consumablesPayload;
    } catch {
      // ignore
    }
  }

  async function saveAllNow() {
    if (mountedRef.current) {
      setSaveErr(null);
      setBusy(true);
    }

    const suppliersPayload = makeSuppliersPayloadFromRef();
    const consumablesPayload = makeConsumablesPayloadFromRef();

    try {
      try {
        localStorage.setItem(`wh.settings.${SUPPLIERS_KEY}`, JSON.stringify(suppliersPayload));
        localStorage.setItem(`wh.settings.${CONSUMABLES_KEY}`, JSON.stringify(consumablesPayload));
      } catch {
        // ignore
      }

      const r1 = await upsertSettings(SUPPLIERS_KEY, suppliersPayload);
      const r2 = await upsertSettings(CONSUMABLES_KEY, consumablesPayload);

      consumablesRawRef.current = consumablesPayload;

      const errs: string[] = [];
      if (!r1.ok) errs.push(`Поставщики: сохранено локально (${(r1 as any).error})`);
      if (!r2.ok) errs.push(`Карго: сохранено локально (${(r2 as any).error})`);
      if (errs.length && mountedRef.current) setSaveErr(errs.join(' • '));
      if (!errs.length && mountedRef.current) setLastSavedAt(new Date());
    } catch (e: any) {
      if (mountedRef.current) setSaveErr(e?.message ?? 'Не удалось сохранить настройки');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function loadKey(key: string): Promise<any | null> {
    try {
      const { data, error } = await sb.from('app_settings').select('key,value_json,value').eq('key', key).maybeSingle();
      if (!error) {
        const raw: any = (data as any)?.value_json ?? (data as any)?.value ?? null;
        if (raw) return typeof raw === 'string' ? JSON.parse(raw) : raw;
      }
    } catch {
      // ignore
    }
    try {
      const raw = localStorage.getItem(`wh.settings.${key}`);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    return null;
  }

  function buildDefaultQuickPrefs(types: ItemTypeDef[], tpl: SupplierTemplate[]) {
    const listFor = (t: string) => tpl.filter((x) => !x.types?.length || x.types.includes(t));
    const pickDef = (t: string) => listFor(t).find((x) => x.is_default) ?? listFor(t)[0] ?? tpl.find((x) => x.is_default) ?? tpl[0] ?? defaultTemplates()[0];

    const out: QuickPrefs = {};
    for (const it of types) {
      out[it.key] = { qty: '1', templateId: pickDef(it.key)?.id ?? 'tpl_order' };
    }
    return out;
  }

  function normalizeQuickPrefs(raw: any, types: ItemTypeDef[], tpl: SupplierTemplate[]) {
    const base = buildDefaultQuickPrefs(types, tpl);
    if (!raw || typeof raw !== 'object') return base;

    const listFor = (t: string) => tpl.filter((x) => !x.types?.length || x.types.includes(t));
    const validTplId = (t: string, id: string) => listFor(t).some((x) => x.id === id);

    const out: QuickPrefs = { ...base };

    for (const it of types) {
      const k = it.key;
      const row = (raw as any)[k];
      if (!row || typeof row !== 'object') continue;

      const qty = typeof row.qty === 'string' ? row.qty : out[k].qty;
      const templateId = typeof row.templateId === 'string' ? row.templateId : out[k].templateId;

      out[k] = {
        qty: qty && qty.trim() ? qty : out[k].qty,
        templateId: templateId && templateId.trim() && validTplId(k, templateId) ? templateId : out[k].templateId,
      };
    }

    return out;
  }

  async function loadAll() {
    setErr(null);

    const [consumablesRaw, suppliersRaw] = await Promise.all([loadKey(CONSUMABLES_KEY), loadKey(SUPPLIERS_KEY)]);

    consumablesRawRef.current = (consumablesRaw && typeof consumablesRaw === 'object' ? consumablesRaw : {}) as ConsumablesSettings;

    const { cargos, defId } = normalizeCargos(consumablesRawRef.current);
    setChinaCargos(cargos);
    setChinaCargoDefaultId(defId);

    const cptRaw = consumablesRawRef.current?.cargo_per_type;
    if (cptRaw && typeof cptRaw === 'object') {
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(cptRaw)) {
        if (typeof v === 'string' && cargos.some((c) => c.id === v)) cleaned[k] = v;
      }
      setCargoPerType(cleaned);
    }

    let s = normalizeSuppliersSettings(suppliersRaw);

    const legacyImported = !Object.values(s.suppliers ?? {}).some((arr) => (arr ?? []).length) ? importLegacySuppliers(consumablesRawRef.current) : null;

    if (legacyImported) {
      s = legacyImported;
      setItemTypes(s.item_types);
      setSuppliers(s.suppliers);
      setTemplates(s.templates);
      setLogs(s.logs);

      try {
        await upsertSettings(SUPPLIERS_KEY, s);
        showToast('Поставщики импортированы');
      } catch {
        // ignore
      }
      try {
        localStorage.setItem(`wh.settings.${SUPPLIERS_KEY}`, JSON.stringify(s));
      } catch {
        // ignore
      }
    } else {
      setItemTypes(s.item_types);
      setSuppliers(s.suppliers);
      setTemplates(s.templates);
      setLogs(s.logs);
    }

    const keys = (s.item_types ?? []).map((x) => x.key);
    if (keys.length) {
      if (!keys.includes(String(dirTab))) setDirTab(keys[0]);
      if (!keys.includes(String(quickType))) setQuickType(keys[0]);
    }

    try {
      const rawPrefsStr = localStorage.getItem(`wh.settings.${QUICK_PREFS_KEY}`);
      const rawPrefs = rawPrefsStr ? JSON.parse(rawPrefsStr) : null;
      const normalized = normalizeQuickPrefs(rawPrefs, s.item_types ?? DEFAULT_ITEM_TYPES, s.templates ?? defaultTemplates());
      setQuickPrefs(normalized);
      persistQuickPrefsNow(normalized);
    } catch {
      const normalized = buildDefaultQuickPrefs(s.item_types ?? DEFAULT_ITEM_TYPES, s.templates ?? defaultTemplates());
      setQuickPrefs(normalized);
      persistQuickPrefsNow(normalized);
    }

    try {
      localStorage.setItem(`wh.settings.${SUPPLIERS_KEY}`, JSON.stringify(s));
      localStorage.setItem(`wh.settings.${CONSUMABLES_KEY}`, JSON.stringify(consumablesRawRef.current));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        await loadAll();
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? 'Ошибка загрузки');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ───────────────── Mutations ───────────────── */
  const patchCargo = useCallback(
    (id: string, patch: Partial<ChinaCargo>) => {
      setChinaCargos((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      saveSoon();
    },
    [saveSoon],
  );

  const pickDefaultCargo = useCallback(
    (id: string) => {
      setChinaCargoDefaultId(id);
      saveSoon();
    },
    [saveSoon],
  );

  // ✅ вместо prompt — открываем модалку
  const openAddItemTypeModal = useCallback(() => {
    setAddTypeGroup('consumable');
    setAddTypeName('');
    setAddTypeIcon('package');
    setAddTypeOpen(true);
  }, []);

  const confirmAddItemType = useCallback(() => {
    const ru = safeStr(addTypeName);
    if (!ru) {
      showToast('Введи название');
      return;
    }

    const key = `custom_${uid().slice(0, 6)}`;
    const nextType: ItemTypeDef = {
      key,
      ru,
      ru_singular: ru.toLowerCase(),
      cn: ru,
      icon: addTypeIcon,
      group: addTypeGroup,
    };

    setItemTypes((prev) => {
      const list = (prev ?? []).slice();
      list.push(nextType);
      return list;
    });

    setSuppliers((prev) => ({ ...(prev ?? {}), [key]: prev?.[key] ?? [] }));
    setDirTab(key);
    setQuickType((qt) => (qt ? qt : key));

    setQuickPref(key, { qty: '1', templateId: defaultTemplateForType(key)?.id ?? 'tpl_order' });

    setAddTypeOpen(false);
    saveSoon();
    showToast('Позиция добавлена');
  }, [addTypeName, addTypeGroup, addTypeIcon, defaultTemplateForType, saveSoon, setQuickPref, showToast]);

  const removeItemType = useCallback(
    (key: string) => {
      const typesNow = (latestRef.current.itemTypes ?? []).slice();
      const t = typesNow.find((x) => x.key === key);
      if (!t) return;

      if (typesNow.length <= 1) {
        showToast('Нельзя удалить последнюю позицию');
        return;
      }

      const ok = window.confirm(
        `Удалить позицию "${t.ru}"?\n\nЭто удалит:\n• саму позицию\n• всех поставщиков внутри неё\n• настройки быстрых сообщений для неё\n\nДействие необратимо.`,
      );
      if (!ok) return;

      setItemTypes((prev) => (prev ?? []).filter((x) => x.key !== key));

      setSuppliers((prev) => {
        const next = { ...(prev ?? {}) };
        delete next[key];
        return next;
      });

      setQuickPrefs((prev) => {
        const next = { ...(prev ?? {}) };
        delete next[key];
        persistQuickPrefsNow(next);
        return next;
      });

      const remaining = typesNow.filter((x) => x.key !== key);
      const fallbackKey = remaining[0]?.key ?? 'bag';

      setDirTab((cur) => (String(cur) === key ? fallbackKey : cur));
      setQuickType((cur) => (String(cur) === key ? fallbackKey : cur));

      setPreview((p) => {
        if (!p) return p;
        if (p.supplier?.type === key) return null;
        return p;
      });

      saveSoon();
      showToast('Позиция удалена');
    },
    [persistQuickPrefsNow, saveSoon, showToast],
  );

  const patchSupplier = useCallback(
    (t: AccType, id: string, patch: Partial<Supplier>) => {
      setSuppliers((prev) => {
        const arr = (prev[t] ?? []).slice();
        const next = arr.map((x) => (x.id === id ? { ...x, ...patch, type: t } : x));

        const normalized = next
          .slice()
          .sort((a, b) => {
            const ao = Number.isFinite(a.sort_order as any) ? Number(a.sort_order) : 9999;
            const bo = Number.isFinite(b.sort_order as any) ? Number(b.sort_order) : 9999;
            if (ao !== bo) return ao - bo;
            return String(a.display_name ?? '').localeCompare(String(b.display_name ?? ''), 'ru');
          })
          .map((x, i) => ({
            ...x,
            sort_order: i,
            type: t,
            unit_price_usd: Number.isFinite(Number(x.unit_price_usd)) ? Number(x.unit_price_usd) : 0,
            unit_weight_kg: Number.isFinite(Number(x.unit_weight_kg)) ? Number(x.unit_weight_kg) : 0,
          }));

        const firstDef = normalized.find((x) => x.is_default);
        if (firstDef) normalized.forEach((x) => (x.is_default = x.id === firstDef.id));

        return { ...prev, [t]: normalized };
      });

      saveSoon();
    },
    [saveSoon],
  );

  const setDefaultSupplier = useCallback(
    (t: AccType, id: string) => {
      setSuppliers((prev) => {
        const arr = (prev[t] ?? []).slice().map((x) => ({ ...x, is_default: x.id === id }));
        return { ...prev, [t]: arr };
      });
      saveSoon();
    },
    [saveSoon],
  );

  const removeSupplier = useCallback(
    (t: AccType, id: string) => {
      setSuppliers((prev) => {
        const arr = (prev[t] ?? []).slice().filter((x) => x.id !== id);
        const normalized = arr.map((x, i) => ({ ...x, sort_order: i, type: t }));
        return { ...prev, [t]: normalized };
      });

      setLogs((prev) => {
        const next = { ...(prev ?? {}) };
        delete next[id];
        return next;
      });

      saveSoon();
    },
    [saveSoon],
  );

  const addSupplier = useCallback(
    (t: AccType) => {
      setSuppliers((prev) => {
        const list = (prev[t] ?? []).slice();
        const nextOne: Supplier = {
          id: uid(),
          type: t,
          display_name: `Поставщик ${list.length + 1}`,
          description: '',
          icon_key: 'taobao',
          link_url: '',
          unit_price_usd: 0,
          unit_weight_kg: 0,
          is_default: list.length === 0,
          sort_order: list.length,
        };
        const next = [...list, nextOne].map((x, i) => ({ ...x, sort_order: i, type: t }));
        return { ...prev, [t]: next };
      });
      saveSoon();
    },
    [saveSoon],
  );

  const patchTemplate = useCallback(
    (id: string, patch: Partial<SupplierTemplate>) => {
      setTemplates((prev) => {
        const arr = (prev ?? []).slice();
        const next = arr.map((t) => (t.id === id ? { ...t, ...patch } : t));
        const first = next.find((x) => x.is_default);
        if (first) next.forEach((x) => (x.is_default = x.id === first.id));
        return next;
      });
      saveSoon();
    },
    [saveSoon],
  );

  const addTemplate = useCallback(() => {
    setTemplates((prev) => {
      const list = (prev ?? []).slice();
      const t = defaultTemplates()[0];
      const nextOne: SupplierTemplate = {
        id: `tpl_${uid()}`,
        name: `Шаблон ${list.length + 1}`,
        is_default: list.length === 0,
        cn_template: t.cn_template,
        ru_template: t.ru_template,
      };
      const next = [...list, nextOne];
      if (!next.some((x) => x.is_default)) next[0].is_default = true;
      return next;
    });
    saveSoon();
  }, [saveSoon]);

  const removeTemplate = useCallback(
    (id: string) => {
      setTemplates((prev) => {
        const list = (prev ?? []).slice().filter((x) => x.id !== id);
        if (list.length && !list.some((x) => x.is_default)) list[0].is_default = true;
        return list.length ? list : defaultTemplates();
      });
      saveSoon();
    },
    [saveSoon],
  );

  /* ───────────────── Build message + order ───────────────── */
  function buildVars(t: AccType, qty: number, cargo: ChinaCargo) {
    const addr = (cargo?.address ?? '').trim();

    const cargo_addr_line = addr ? `转运仓地址：${addr}` : '转运仓地址：稍后发你';
    const cargo_addr_line_ru = addr ? `Адрес карго: ${addr}` : 'Адрес карго: пришлю позже';

    const qty_hint_cn = qty > 0 ? ` 我大概需要 ${qty} 个。` : '';
    const qty_hint_ru = qty > 0 ? ` Примерно нужно ${qty} шт.` : '';

    return {
      item_cn: itemCn(t),
      item_ru: itemRu(t).toLowerCase(),
      item_ru_singular: itemRuSingular(t),
      qty: String(qty),
      cargo_name: String(cargo?.name ?? ''),
      cargo_addr: addr,
      cargo_addr_line,
      cargo_addr_line_ru,
      qty_hint_cn,
      qty_hint_ru,
    };
  }

  function pickTemplateById(t: AccType, id: string) {
    const list = templatesForType(t);
    const found = list.find((x) => x.id === id);
    return found ?? list.find((x) => x.is_default) ?? list[0] ?? defaultTemplate;
  }

  async function runOrder(args: { t: AccType; qty: number; supplier: Supplier; templateId: string; cargoId: string }) {
    const { t, qty, supplier, templateId, cargoId } = args;

    const safeQty = Number.isFinite(Number(qty)) ? Math.max(0, Number(qty)) : NaN;
    if (!Number.isFinite(safeQty) || safeQty <= 0) {
      showToast('Количество должно быть > 0');
      return;
    }

    const cargo = chinaCargos.find((c) => c.id === cargoId) ?? defaultCargo;
    const tpl = pickTemplateById(t, templateId);

    const vars = buildVars(t, safeQty, cargo);

    const cn = renderTemplate(tpl.cn_template, vars);
    const ru = renderTemplate(tpl.ru_template, vars);

    const toCopy = copyMode === 'cn' ? cn : copyMode === 'ru' ? ru : `${ru}\n\n────────────\n\n${cn}`;
    const ok = await copyToClipboard(toCopy);

    showToast(ok ? (copyMode === 'cn' ? 'CN скопировано' : copyMode === 'ru' ? 'RU скопировано' : 'RU+CN скопировано') : 'Не удалось скопировать');

    const link = (supplier.link_url ?? '').trim();
    if (link) window.open(link, '_blank', 'noopener,noreferrer');

    setPreview({ cn, ru, supplier, template: tpl });

    const nowIso = new Date().toISOString();
    patchSupplier(supplier.type, supplier.id, {
      last_order_at: nowIso,
      last_order_qty: safeQty,
      last_order_template_id: tpl.id,
    });

    const addrPreview = (cargo?.address ?? '').trim();
    const entry: SupplierLogEntry = {
      id: uid(),
      ts: nowIso,
      supplier_id: supplier.id,
      supplier_name: supplier.display_name,
      type: t,
      qty: safeQty,
      template_id: tpl.id,
      cargo_name: cargo?.name ?? '',
      cargo_addr_preview: addrPreview ? addrPreview.slice(0, 140) : '(пусто)',
    };

    setLogs((prev) => {
      const next = { ...(prev ?? {}) };
      const arr = (next[supplier.id] ?? []).slice();
      arr.unshift(entry);
      next[supplier.id] = arr.slice(0, 20);
      return next;
    });

    saveSoon();
  }

  const openDeleteTypeModal = useCallback(() => {
    const first = (itemTypes ?? [])[0]?.key ?? '';
    setDeleteTypeKey(String(dirTab || first || ''));
    setDeleteTypeOpen(true);
  }, [dirTab, itemTypes]);

  const confirmDeleteType = useCallback(() => {
    const k = safeStr(deleteTypeKey);
    if (!k) return;
    setDeleteTypeOpen(false);
    setDeleteTypeKey('');
    removeItemType(k);
  }, [deleteTypeKey, removeItemType]);

  /* ───────────────── Render ───────────────── */
  return (
    <div className={UI.shell}>
      <div className={UI.container}>
        {/* Header */}
        <div className={UI.headerCard}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className={UI.badgeIcon}>
                <Truck className="h-5 w-5 text-white drop-shadow" />
              </div>
              <div className="min-w-0">
                <h1 className="text-[26px] md:text-[30px] font-extrabold tracking-tight text-white">Поставщики</h1>
                <p className="mt-0.5 text-[13px] text-slate-400">Карго, справочник и быстрые заказы</p>
                {loading && <div className="mt-1 text-xs text-cyan-600 font-medium">Загрузка…</div>}
                {err && <div className="mt-2 rounded-xl bg-rose-50 text-rose-700 ring-1 ring-rose-200 px-3 py-2 text-xs">{err}</div>}
                {saveErr && <div className="mt-1 rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-200 px-3 py-2 text-xs">{saveErr}</div>}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {busy ? (
                <span className="text-xs text-indigo-500 font-medium animate-pulse">Сохранение…</span>
              ) : lastSavedAt ? (
                <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {dtFmt(lastSavedAt)}
                </span>
              ) : null}
              <button type="button" onClick={() => saveAllNow()} disabled={busy} className={cls(UI.btnBase, UI.btnPrimary, 'px-3 py-2')}>
                <Save className="h-4 w-4" /> Сохранить
              </button>
              <Link href={ROUTE_WAREHOUSE} className={cls(UI.btnBase, UI.btnGhost)}>
                <ArrowLeft className="h-4 w-4" /> Назад
              </Link>
            </div>
          </div>
        </div>

        {/* Cargo */}
        <div className={UI.sectionCard}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl grid place-items-center bg-cyan-500 shadow-[0_4px_12px_rgba(34,211,238,0.30)]">
                <Truck className="h-4 w-4 text-white" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-100">Карго-компании</div>
                <div className="text-[11px] text-slate-500">Адреса и тарифы доставки</div>
              </div>
            </div>

            <button type="button" className={cls(UI.btnBase, UI.btnGhost, 'px-3 py-1.5 text-xs')} onClick={() => setCargoOpen((v) => !v)}>
              {cargoOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {cargoOpen ? 'Свернуть' : 'Развернуть'}
            </button>
          </div>

          {cargoOpen && (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {chinaCargos.slice(0, 3).map((c) => (
                <CargoCard
                  key={c.id}
                  c={c}
                  isDef={c.id === chinaCargoDefaultId}
                  onPickDefault={pickDefaultCargo}
                  onPatch={patchCargo}
                />
              ))}
            </div>
          )}
        </div>

        {/* Main */}
        <div className={UI.sectionCard}>
          <div className="flex items-center gap-2.5 mb-4">
            <div className="h-8 w-8 rounded-xl grid place-items-center bg-cyan-500 shadow-[0_4px_12px_rgba(34,211,238,0.30)]">
              <Package className="h-4 w-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-100">Поставщики и заказы</div>
              <div className="text-[11px] text-slate-500">Быстрый заказ слева, справочник справа</div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Quick order */}
            <div className={UI.innerCard}>
              <div className="flex items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-lg grid place-items-center bg-cyan-50 ring-1 ring-cyan-200">
                    <ShoppingBag className="h-3.5 w-3.5 text-cyan-600" />
                  </div>
                  <div className="text-xs font-bold text-slate-700 uppercase tracking-wide">Быстрый заказ</div>
                </div>
                <select
                  className="rounded-lg px-2 py-1 text-[11px] font-semibold bg-white text-slate-700 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
                  value={cargoPerType[quickType] || chinaCargoDefaultId}
                  onChange={(e) => setCargoForType(quickType, e.target.value)}
                >
                  {chinaCargos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.id}{c.id === chinaCargoDefaultId ? ' (глобальн.)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-4 grid gap-4">
                {/* ✅ Позиции: разделили на расходники / инвентарь */}
                <div className="grid gap-4">
                  {(['consumable', 'asset'] as ItemGroup[]).map((g) => {
                    const list = (groupedTypes as any)[g] as ItemTypeDef[];
                    if (!list?.length) return null;
                    return (
                      <div key={g}>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="text-[11px] font-semibold text-slate-600">{GROUP_LABEL[g]}</div>
                          <div className="text-[11px] text-slate-400">{fmt(list.length)} шт.</div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {list.map((t) => {
                            const active = quickType === t.key;
                            const grp = itemGroupOf(t);
                            return (
                              <div key={t.key} className={cls('relative rounded-2xl p-3 text-left transition ring-1 group', typeTileClasses(active, grp))}>
                                <button
                                  type="button"
                                  onClick={() => setQuickType(t.key)}
                                  className="w-full text-left"
                                >
                                  <div className="flex items-center gap-3">
                                    <span className={cls('h-10 w-10 rounded-2xl grid place-items-center ring-1 shrink-0', typeMiniIconBg(active, grp))}>
                                      <ItemTypeIcon def={t} className={cls('h-5 w-5', active ? 'text-white' : 'text-slate-700')} />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <div className={cls('text-sm font-extrabold truncate', active ? 'text-white' : 'text-slate-900')}>{t.ru}</div>
                                    </div>
                                  </div>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); removeItemType(t.key); }}
                                  className="absolute top-1 right-1 h-5 w-5 rounded-full grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 hover:bg-rose-500 text-white"
                                  title={`Удалить "${t.ru}"`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* qty + template */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <input className={UI.input} type="number" min={1} step={1} value={quickQty} onChange={(e) => setQuickPref(quickType, { qty: e.target.value })} placeholder="Кол-во" />
                  <select className={UI.select} value={quickTemplateId} onChange={(e) => setQuickPref(quickType, { templateId: e.target.value })}>
                    {templatesForType(quickType).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.is_default ? `⭐ ${t.name}` : t.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Copy mode */}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={cls(UI.btnBase, copyMode === 'cn' ? UI.btnPrimary : UI.btnGhost, 'px-3 py-2')} onClick={() => setCopyMode('cn')}>
                    CN
                  </button>
                  <button type="button" className={cls(UI.btnBase, copyMode === 'ru' ? UI.btnPrimary : UI.btnGhost, 'px-3 py-2')} onClick={() => setCopyMode('ru')}>
                    RU
                  </button>
                  <button type="button" className={cls(UI.btnBase, copyMode === 'both' ? UI.btnPrimary : UI.btnGhost, 'px-3 py-2')} onClick={() => setCopyMode('both')}>
                    RU+CN
                  </button>
                </div>

                {/* Suppliers list */}
                <div className="grid gap-2">
                  <div className="flex items-end justify-between gap-2">
                    <div className="text-[12px] font-semibold text-slate-700">{itemRu(quickType)}</div>
                    <div className="text-[11px] text-slate-400">
                      Всего: <span className="font-extrabold text-cyan-600 tabular-nums">{fmt((suppliers[quickType] ?? []).length)}</span>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    {(suppliers[quickType] ?? []).length === 0 ? (
                      <div className="rounded-3xl bg-gradient-to-br from-white via-slate-50 to-sky-50/85 ring-1 ring-slate-200 p-6 text-center shadow-sm">
                        <div className="text-slate-700 font-semibold">Для этой позиции нет поставщиков</div>
                        <div className="mt-1 text-sm text-slate-400">Добавь справа в Справочнике.</div>
                      </div>
                    ) : (
                      (suppliers[quickType] ?? [])
                        .slice()
                        .sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default) || Number(a.sort_order ?? 9999) - Number(b.sort_order ?? 9999))
                        .map((s) => (
                          <QuickSupplierEditor
                            key={s.id}
                            s={s}
                            typeLabel={itemRu(quickType)}
                            qty={safeQuickQty || 0}
                            cargo={getCargoForType(quickType)}
                            allCargos={chinaCargos}
                            onSelectCargo={(cid) => setCargoForType(quickType, cid)}
                            onPatch={(id, patch) => patchSupplier(quickType, id, patch)}
                            onPatchCargo={(cargoId, patch) => patchCargo(cargoId, patch)}
                            onRemove={(id) => removeSupplier(quickType, id)}
                            onOrder={() => {
                              const qty = nInt(quickQty);
                              runOrder({ t: quickType, qty, supplier: s, templateId: quickTemplateId, cargoId: cargoPerType[quickType] || chinaCargoDefaultId });
                            }}
                          />
                        ))
                    )}
                  </div>
                </div>

                {preview && (
                  <div className="mt-1 rounded-3xl bg-white ring-1 ring-sky-100 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-extrabold text-slate-900">Предпросмотр</div>
                      <div className="text-xs text-slate-400">
                        {preview.supplier?.display_name ?? '—'} • {preview.template?.name ?? '—'}
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3">
                      <div>
                        <div className="text-[11px] font-semibold text-slate-500 mb-1">RU</div>
                        <div className="whitespace-pre-wrap rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-3 text-sm text-slate-800 min-h-[110px]">{preview.ru}</div>
                      </div>

                      <div>
                        <div className="text-[11px] font-semibold text-slate-500 mb-1">CN</div>
                        <div className="whitespace-pre-wrap rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-3 text-sm text-slate-800 min-h-[110px]">{preview.cn}</div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={cls(UI.btnBase, UI.btnGhost)} onClick={async () => showToast((await copyToClipboard(preview.cn)) ? 'CN скопировано' : 'Не удалось скопировать')}>
                          <Clipboard className="h-4 w-4" />
                          CN
                        </button>

                        <button type="button" className={cls(UI.btnBase, UI.btnGhost)} onClick={async () => showToast((await copyToClipboard(preview.ru)) ? 'RU скопировано' : 'Не удалось скопировать')}>
                          <Clipboard className="h-4 w-4" />
                          RU
                        </button>

                        <button
                          type="button"
                          className={cls(UI.btnBase, UI.btnGhost)}
                          onClick={async () => showToast((await copyToClipboard(`${preview.ru}\n\n────────────\n\n${preview.cn}`)) ? 'RU+CN скопировано' : 'Не удалось скопировать')}
                        >
                          <Clipboard className="h-4 w-4" />
                          RU+CN
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Directory + Templates */}
            <div className="grid gap-4">
              {/* Directory — collapsible groups */}
              <div className={UI.innerCard}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-lg grid place-items-center bg-sky-50 ring-1 ring-sky-200">
                      <Layers className="h-3.5 w-3.5 text-sky-600" />
                    </div>
                    <div className="text-xs font-bold text-slate-700 uppercase tracking-wide">Справочник</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={openAddItemTypeModal} className="h-8 w-8 rounded-xl grid place-items-center text-slate-500 hover:bg-emerald-50 hover:text-emerald-600 transition" title="Добавить позицию">
                      <Plus className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={openDeleteTypeModal} className="h-8 w-8 rounded-xl grid place-items-center text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition" title="Удалить позицию">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid gap-2">
                  {(['consumable', 'asset'] as ItemGroup[]).map((g) => {
                    const list = (groupedTypes as any)[g] as ItemTypeDef[];
                    if (!list?.length) return null;
                    const isOpen = g === 'consumable' ? dirTab === '__cons__' || list.some((t) => t.key === dirTab) : dirTab === '__asset__' || list.some((t) => t.key === dirTab);
                    const groupCls = g === 'consumable'
                      ? 'bg-gradient-to-r from-cyan-500 to-teal-500 text-white ring-cyan-400/30 shadow-[0_4px_16px_rgba(34,211,238,0.25)]'
                      : 'bg-gradient-to-r from-cyan-500 to-indigo-500 text-white ring-indigo-400/30 shadow-[0_4px_16px_rgba(99,102,241,0.20)]';

                    return (
                      <div key={g}>
                        {/* Group header — clickable to expand */}
                        <button
                          type="button"
                          onClick={() => {
                            const first = list[0]?.key;
                            if (isOpen && dirTab !== '__none__') {
                              setDirTab('__none__');
                            } else if (first) {
                              setDirTab(first);
                            }
                          }}
                          className={cls(
                            'w-full flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left transition ring-1',
                            isOpen ? `${groupCls} font-semibold` : 'bg-slate-50 text-slate-600 ring-slate-200 hover:bg-slate-100 hover:text-slate-800',
                          )}
                        >
                          {isOpen ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                          <span className="text-sm font-semibold flex-1">{GROUP_LABEL[g]}</span>
                          <span className={cls('text-xs font-medium', isOpen ? 'text-white/70' : 'text-slate-400')}>{list.length}</span>
                        </button>

                        {/* Expanded items */}
                        {isOpen && (
                          <div className="mt-1.5 ml-2 grid gap-1">
                            {list.map((t) => {
                              const active = dirTab === t.key;
                              const supCount = (suppliers[t.key] ?? []).length;
                              return (
                                <button
                                  key={t.key}
                                  type="button"
                                  onClick={() => setDirTab(t.key)}
                                  className={cls(
                                    'flex items-center gap-2.5 rounded-xl px-3 py-2 text-left transition ring-1 text-sm',
                                    active
                                      ? 'bg-cyan-50 text-cyan-800 ring-cyan-300'
                                      : 'bg-white text-slate-600 ring-slate-200 hover:bg-cyan-50/40 hover:text-slate-800',
                                  )}
                                >
                                  <ItemTypeIcon def={t} className={cls('h-4 w-4 shrink-0', active ? 'text-cyan-400' : 'text-slate-500')} />
                                  <span className={cls('flex-1 truncate', active ? 'font-semibold' : 'font-medium')}>{t.ru}</span>
                                  {supCount > 0 && <span className={cls('text-[11px] tabular-nums font-medium rounded-full px-1.5 py-0.5', active ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-500')}>{supCount}</span>}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Supplier list for selected type */}
                {dirTab && dirTab !== '__none__' && !dirTab.startsWith('__') && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="text-xs font-semibold text-slate-700">{itemRu(dirTab)}</div>
                      <button type="button" className={cls(UI.btnBase, UI.btnGhost, 'px-2.5 py-1.5 text-xs')} onClick={() => addSupplier(dirTab)}>
                        <Plus className="h-3.5 w-3.5" /> Добавить
                      </button>
                    </div>

                    <div className="grid gap-3">
                      {(suppliers[dirTab] ?? [])
                        .slice()
                        .sort((a, b) => Number(a.sort_order ?? 9999) - Number(b.sort_order ?? 9999))
                        .map((s) => (
                          <SupplierCard
                            key={s.id}
                            s={s}
                            typeDef={itemByKey[s.type]}
                            typeLabel={itemRu(s.type)}
                            onPatch={(id, p) => patchSupplier(s.type, id, p)}
                            onRemove={(id) => removeSupplier(s.type, id)}
                            onMakeDefault={(id) => setDefaultSupplier(s.type, id)}
                          />
                        ))}

                      {(suppliers[dirTab] ?? []).length === 0 && (
                        <div className="rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-6 text-center">
                          <div className="text-slate-500 text-sm">Нет поставщиков</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Templates (collapsible) */}
              <div className={UI.innerCard}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-lg grid place-items-center bg-teal-50 ring-1 ring-teal-200">
                        <FileText className="h-3.5 w-3.5 text-teal-600" />
                      </div>
                      <div className="text-xs font-bold text-slate-700 uppercase tracking-wide">Шаблоны</div>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      Всего: <span className="font-extrabold text-cyan-600 tabular-nums">{fmt((templates ?? []).length)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={cls(UI.btnBase, UI.btnGhost, 'px-3 py-2 text-xs')}
                      onClick={() => setTemplatesOpen((v) => !v)}
                      title={templatesOpen ? 'Свернуть' : 'Развернуть'}
                    >
                      {templatesOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      {templatesOpen ? 'Свернуть' : 'Развернуть'}
                    </button>

                    {templatesOpen && (
                      <button type="button" className={cls(UI.btnBase, UI.btnGhost, 'px-3 py-2 text-xs')} onClick={() => addTemplate()}>
                        <Plus className="h-4 w-4" />
                        Добавить
                      </button>
                    )}
                  </div>
                </div>

                {templatesOpen && (
                  <div className="mt-4 grid gap-3">
                    {(templates ?? []).map((t) => (
                      <div key={t.id} className="rounded-3xl bg-white ring-1 ring-slate-200 p-4 shadow-[0_12px_32px_rgba(15,23,42,0.08)]">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-bold text-slate-900 truncate max-w-[420px]">{t.name}</div>
                              {t.is_default && (
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-sky-50 text-sky-700 ring-1 ring-sky-200">
                                  <Star className="h-3.5 w-3.5" /> Default
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button type="button" className={cls(UI.btnBase, UI.btnGhost, 'px-3 py-2')} onClick={() => patchTemplate(t.id, { is_default: true })} title="Сделать по умолчанию">
                              <Star className="h-4 w-4" />
                              Default
                            </button>

                            <button type="button" className={cls(UI.btnBase, UI.btnDanger, 'px-3 py-2')} onClick={() => removeTemplate(t.id)} title="Удалить">
                              <Trash2 className="h-4 w-4" />
                              Удалить
                            </button>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-2">
                          <div className="grid gap-1">
                            <div className="text-[11px] font-semibold text-slate-400">Название</div>
                            <input className={UI.input} value={t.name} onChange={(e) => patchTemplate(t.id, { name: e.target.value })} />
                          </div>

                          <div className="grid gap-1">
                            <div className="text-[11px] font-semibold text-slate-400">RU</div>
                            <textarea className={cls(UI.textarea, 'min-h-[110px] resize-y')} value={t.ru_template} onChange={(e) => patchTemplate(t.id, { ru_template: e.target.value })} />
                          </div>

                          <div className="grid gap-1">
                            <div className="text-[11px] font-semibold text-slate-400">CN</div>
                            <textarea className={cls(UI.textarea, 'min-h-[110px] resize-y')} value={t.cn_template} onChange={(e) => patchTemplate(t.id, { cn_template: e.target.value })} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!templatesOpen && (
                  <div className="mt-4 rounded-2xl bg-slate-50 ring-1 ring-slate-200 px-3 py-2 text-[12px] text-slate-400">
                    Шаблоны свернуты. Нажми «Развернуть», чтобы редактировать.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        {/* Modal: Add item type */}
        {addTypeOpen && (
          <div className="fixed inset-0 z-[260] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-[720px] rounded-2xl bg-white ring-1 ring-slate-200 shadow-[0_30px_100px_rgba(0,0,0,0.30)] overflow-hidden">
              <div className="p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900">Новая позиция</div>
                    <div className="mt-1 text-xs text-slate-400">Только тип (расходник/инвентарь), название и иконка.</div>
                  </div>
                  <button type="button" className="h-9 w-9 rounded-xl grid place-items-center hover:bg-slate-100" onClick={() => setAddTypeOpen(false)} title="Закрыть">
                    <X className="h-5 w-5 text-slate-500" />
                  </button>
                </div>

                <div className="mt-4 grid gap-4">
                  {/* Group */}
                  <div className="grid gap-2">
                    <div className="text-[11px] font-semibold text-slate-400">Тип</div>
                    <div className="flex flex-wrap gap-2">
                      {(['consumable', 'asset'] as ItemGroup[]).map((g) => {
                        const active = addTypeGroup === g;
                        return (
                          <button
                            key={g}
                            type="button"
                            className={cls(UI.btnBase, active ? UI.btnPrimary : UI.btnGhost, 'px-3 py-2')}
                            onClick={() => setAddTypeGroup(g)}
                          >
                            {GROUP_CHOICE_LABEL[g]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Name */}
                  <div className="grid gap-2">
                    <div className="text-[11px] font-semibold text-slate-400">Название</div>
                    <input className={UI.input} value={addTypeName} onChange={(e) => setAddTypeName(e.target.value)} placeholder="Напр.: Полки / Рефрактометр / Листовки" />
                  </div>

                  {/* Icon */}
                  <div className="grid gap-2">
                    <div className="text-[11px] font-semibold text-slate-400">Иконка</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {ITEM_TYPE_ICON_OPTIONS.map((o) => {
                        const active = addTypeIcon === o.key;
                        return (
                          <button
                            key={o.key}
                            type="button"
                            onClick={() => setAddTypeIcon(o.key)}
                            className={cls(
                              'rounded-2xl p-3 text-left ring-1 transition',
                              active ? 'bg-cyan-50 ring-cyan-200' : 'bg-white ring-slate-200 hover:bg-slate-50',
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <span className={cls('h-10 w-10 rounded-2xl grid place-items-center ring-1', active ? 'bg-cyan-50 ring-cyan-200' : 'bg-slate-50 ring-slate-200')}>
                                <ItemTypeIcon def={{ key: 'x', ru: 'x', ru_singular: 'x', cn: 'x', icon: o.key, group: addTypeGroup }} className="h-5 w-5 text-slate-500" />
                              </span>
                              <div className="min-w-0">
                                <div className="text-sm font-bold text-slate-900 truncate">{o.label}</div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    <button type="button" className={cls(UI.btnBase, UI.btnGhost)} onClick={() => setAddTypeOpen(false)}>
                      Отмена
                    </button>
                    <button type="button" className={cls(UI.btnBase, UI.btnPrimary)} onClick={confirmAddItemType}>
                      <Plus className="h-4 w-4" />
                      Добавить
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Delete item type */}
        {deleteTypeOpen && (
          <div className="fixed inset-0 z-[260] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-[640px] rounded-2xl bg-white ring-1 ring-slate-200 shadow-[0_30px_100px_rgba(0,0,0,0.30)] overflow-hidden">
              <div className="p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900">Удалить позицию</div>
                    <div className="mt-1 text-xs text-slate-400">Выбери позицию справочника. Это удалит и её поставщиков, и быстрые настройки.</div>
                  </div>
                  <button type="button" className="h-9 w-9 rounded-xl grid place-items-center hover:bg-slate-100" onClick={() => setDeleteTypeOpen(false)} title="Закрыть">
                    <X className="h-5 w-5 text-slate-500" />
                  </button>
                </div>

                <div className="mt-4 grid gap-2">
                  <div className="text-[11px] font-semibold text-slate-400">Позиции</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(itemTypes ?? []).map((t) => {
                      const active = deleteTypeKey === t.key;
                      const grp = itemGroupOf(t);
                      return (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setDeleteTypeKey(t.key)}
                          className={cls('rounded-2xl p-3 text-left ring-1 transition', typeTileClasses(active, grp))}
                        >
                          <div className="flex items-center gap-3">
                            <span className={cls('h-10 w-10 rounded-2xl grid place-items-center ring-1', typeMiniIconBg(active, grp))}>
                              <ItemTypeIcon def={t} className={cls('h-5 w-5', active ? 'text-white' : 'text-slate-700')} />
                            </span>
                            <div className="min-w-0">
                              <div className={cls('text-sm font-extrabold truncate', active ? 'text-white' : 'text-slate-900')}>{t.ru}</div>
                              <div className={cls('mt-0.5 text-[11px]', active ? 'text-white/80' : 'text-slate-500')}>{GROUP_LABEL[grp]}</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <button type="button" className={cls(UI.btnBase, UI.btnGhost)} onClick={() => setDeleteTypeOpen(false)}>
                      Отмена
                    </button>
                    <button type="button" className={cls(UI.btnBase, UI.btnDanger)} onClick={confirmDeleteType} disabled={!safeStr(deleteTypeKey)}>
                      <Trash2 className="h-4 w-4" />
                      Удалить выбранную
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[300]">
            <div className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 shadow-[0_8px_30px_rgba(15,23,42,0.20)]">{toast}</div>
          </div>
        )}
      </div>
    </div>
  );
}
