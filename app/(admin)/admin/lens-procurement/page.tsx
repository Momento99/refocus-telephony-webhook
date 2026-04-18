// app/(admin)/admin/lens-procurement/page.tsx
'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import type { EChartsOption } from 'echarts';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import Link from 'next/link';
import {
  AlertTriangle,
  BarChart3,
  Clipboard,
  Download,
  RefreshCw,
  Search,
  Store,
  Package,
  Truck,
  CheckCircle2,
  Plus,
  MapPin,
  MessageCircle,
  Info,
  X,
  ChevronDown,
  ChevronUp,
  Filter,
  FileSpreadsheet,
  ExternalLink,
  Trash2,
} from 'lucide-react';

// ECharts без SSR
const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

/* ===================== consts ===================== */

const PLAN_DAYS = 60;
// Диапазон отображения SPH на графике (все диоптрии)
const SPH_MIN = -10;
const SPH_MAX = 10;
const SPH_STEP = 0.25;

// ✅ SPH limits per family (procurement scope)
// Добавили:
// - chame* (хамелеоны): пока в закупе держим разумный диапазон
// - pc_159_hmc: -6..+6 (49 SKU)
// - myopia_control: -6..0 (25 SKU)
const SPH_LIMITS: Record<string, { min: number; max: number }> = {
  bb: { min: -7, max: 5 }, // BlueCut HMC  –7 … +5
  white: { min: -6, max: 6 }, // UC           –6 … +6
  ar: { min: -6, max: 6 }, // HMC          –6 … +6

  chame: { min: -6, max: 3 }, // Chameleon (цветные) — пока закуп-диапазон
  pc_159_hmc: { min: -6, max: 6 }, // Polycarbonate 1.59 HMC
  myopia_control: { min: -6, max: 0 }, // Myopia Control (kids) — только минус и 0
};

// ✅ detect limits by selected family (uses your normalizeFamilyKey/lowerKey)
function getSphLimitsForFamily(famRaw: string): { min: number; max: number } {
  const k = lowerKey(famRaw);

  // exact keys first
  if (SPH_LIMITS[k]) return SPH_LIMITS[k];

  // chameleon variants (CHAME_BLACK / CHAME_BROWN / CHAME_*)
  if (k.startsWith('chame')) return SPH_LIMITS.chame;

  // polycarbonate 1.59 HMC family
  if (k === 'pc_159_hmc' || k.startsWith('pc_159_hmc') || (k.includes('pc') && k.includes('1.59') && k.includes('hmc'))) {
    return SPH_LIMITS.pc_159_hmc;
  }

  // myopia control family
  if (k.includes('myopia')) return SPH_LIMITS.myopia_control;

  // fallback heuristics (если прилетит что-то вроде "WHITE 1.56" и т.п.)
  if (k.includes('bb')) return SPH_LIMITS.bb;
  if (k.includes('white')) return SPH_LIMITS.white;
  if (k === 'ar' || k.includes(' ar')) return SPH_LIMITS.ar;

  // default (если появится новое семейство)
  return { min: SPH_MIN, max: SPH_MAX };
}

// RPC, которая отдаёт план+склад+в пути+к купить
const RPC_PROCUREMENT_FN = 'lens_procurement_by_family';

// Закупочные RPC
const RPC_CREATE_BATCH_FN = 'lens_purchase_create_batch_from_to_buy';
const RPC_MARK_ORDERED_FN = 'lens_purchase_mark_ordered';
const RPC_MARK_RECEIVED_FN = 'lens_purchase_mark_received';
// ✅ NEW: hard clear stock for location
const RPC_CLEAR_STOCK_HARD_FN = 'lens_lots_clear_location_hard';

// ✅ NEW: hard delete batch (test/cancel cleanup)
const RPC_DELETE_BATCH_HARD_FN = 'lens_purchase_delete_batch_hard';

// Твоя статистика “по истории”
const RPC_STATS_FAMILIES_FN = 'stats_lens_families_all_time';

// Куда вести “Перейти к SKU”
const SKU_ADMIN_URL = '/admin/lens-skus';

// Источники “семейств” (важно: mapping — канон)
const FAMILY_SOURCES = [
  { kind: 'table', name: 'lens_family_map', col: 'family' },

  // fallback
  { kind: 'table', name: 'lens_families', col: 'name' },
  { kind: 'table', name: 'lens_families', col: 'lens_family' },
  { kind: 'table', name: 'lens_catalog', col: 'lens_family' },
  { kind: 'table', name: 'lens_skus', col: 'lens_family' },
  { kind: 'view', name: 'v_lens_skus', col: 'lens_family' },
  { kind: 'view', name: 'v_lens_catalog', col: 'lens_family' },
] as const;

// Excel branding
const BRAND_NAME = 'Refocus';
const LS_PROC_SETTINGS_KEY = 'refocus:lens_procurement:settings:v1';

function clampNum(n: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/* ===================== helpers ===================== */

function nf(n: number) {
  return Number.isFinite(+n) ? Number(n).toLocaleString('ru-RU') : '0';
}

function onlyDateISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

// формат как в закупочном Excel: -10, -0.5, 0, +0.25, +1.5
function fmtSph(v: number) {
  if (!Number.isFinite(v)) return '';
  if (Object.is(v, -0)) v = 0;
  if (v === 0) return '0';
  const abs = Math.abs(v);
  const s = abs.toFixed(2).replace(/\.?0+$/, '');
  return (v > 0 ? '+' : '-') + s;
}

function safeSheetName(name: string) {
  const cleaned = String(name || '')
    .replace(/[:\\/?*\[\]]/g, ' ')
    .trim();
  return (cleaned.length > 31 ? cleaned.slice(0, 31) : cleaned) || 'Sheet';
}

function sumBy<T>(arr: T[], pick: (x: T) => number) {
  return arr.reduce((a, x) => a + (Number(pick(x)) || 0), 0);
}

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

async function isOwner(): Promise<boolean> {
  const sb = getBrowserSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return false;

  const { data } = await sb.from('profiles').select('role').eq('id', u.user.id).single();
  return data?.role === 'owner';
}

function isFnNotFoundError(msg: string) {
  const s = (msg || '').toLowerCase();
  return s.includes('could not find the function') || s.includes('schema cache');
}

function prettifyRpcError(e: any) {
  const msg = String(e?.message ?? e ?? '');
  if (!isFnNotFoundError(msg)) return msg;

  return (
    msg +
    `\n\nПохоже, PostgREST не обновил schema cache.\n` +
    `Сделай одно из:\n` +
    `1) SQL Editor: NOTIFY pgrst, 'reload schema';\n` +
    `2) Dashboard → Settings → API → Reload schema cache.\n\n` +
    `Ожидаемая сигнатура create_batch:\n` +
    `lens_purchase_create_batch_from_to_buy(\n` +
    `  p_lens_family text,\n` +
    `  p_to_location_id uuid,\n` +
    `  p_plan_days integer,\n` +
    `  p_safety numeric,\n` +
    `  p_min_each integer,\n` +
    `  p_apply_min_to_all boolean,\n` +
    `  p_comment text\n` +
    `)`
  );
}

function uniqStrings(arr: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const v = String(x || '').trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function shouldHideFamily(family: string) {
  const n = String(family || '').toLowerCase();
  if (!n) return true;
  if (n.includes('ast')) return true;
  if (n.includes('астиг')) return true;
  if (n.includes('контакт')) return true;
  if (n.includes('жидк')) return true;
  return false;
}

// ================= Vendor naming (UI/Excel) =================
// DB remains the same. We only change labels shown to humans.

const VENDOR_FAMILY_LABELS: Record<string, string> = {
  white: 'UC', // Uncoated
  ar: 'HMC', // AR = HMC
  bb: 'BlueCut HMC', // BlueBlock = BlueCut HMC

  // ✅ новые
  chame: 'Chameleon',
  pc_159_hmc: 'PC 1.59 HMC',
  myopia_control: 'Myopia Control 1.56',
};

function chameColorSuffix(k: string) {
  const s = String(k || '').toLowerCase();
  if (s.includes('black')) return 'Black';
  if (s.includes('brown')) return 'Brown';
  if (s.includes('green')) return 'Green';
  if (s.includes('purple')) return 'Purple';
  if (s.includes('blue')) return 'Blue';
  return '';
}

// Универсальная функция: на вход — как угодно (WHITE, WHITE [..], bb, AR_PLUS...)
// на выход — как показывает поставщик (UC / HMC / BlueCut HMC / Chameleon / PC 1.59 HMC / Myopia Control)
function vendorFamilyLabel(famRaw: string) {
  const k = lowerKey(famRaw);

  if (!k) return '—';

  // BB / BlueBlock
  if (k === 'bb' || k.startsWith('bb ') || k.startsWith('bb:') || k.includes('blueblock')) {
    return VENDOR_FAMILY_LABELS.bb;
  }

  // WHITE -> UC
  if (k.includes('white')) return VENDOR_FAMILY_LABELS.white;

  // AR -> HMC
  if (k === 'ar' || k.includes(' ar')) return VENDOR_FAMILY_LABELS.ar;

  // ✅ PC 1.59 HMC (не путать с обычным HMC/AR)
  if (k === 'pc_159_hmc' || k.startsWith('pc_159_hmc') || (k.includes('pc') && k.includes('1.59') && k.includes('hmc'))) {
    return VENDOR_FAMILY_LABELS.pc_159_hmc;
  }

  // ✅ Myopia Control
  if (k.includes('myopia')) return VENDOR_FAMILY_LABELS.myopia_control;

  // ✅ Chameleon colors (CHAME / CHAME_BLACK / CHAME_BROWN ...)
  if (k.startsWith('chame')) {
    const c = chameColorSuffix(k);
    return c ? `${VENDOR_FAMILY_LABELS.chame} ${c}` : VENDOR_FAMILY_LABELS.chame;
  }

  // Если появится новое семейство — покажем как есть (без переименования)
  return normalizeFamilyKey(famRaw) || '—';
}

/**
 * ✅ ЕДИНАЯ нормализация ключа семейства (синхронизирована с базой):
 * - обрезаем хвост "[...]" (WHITE [0–2.75] -> WHITE)
 * - склеиваем *_PLUS/_MINUS (AR_PLUS -> AR, CHAME_MINUS -> CHAME)
 * - трим, схлопываем пробелы
 */
function normalizeFamilyKey(raw: string) {
  const s0 = String(raw || '').trim();
  if (!s0) return '';
  const noBracket = s0.replace(/\s*\[.*$/g, '').trim();
  const collapsed = noBracket.replace(/\s+/g, ' ').trim();
  const noSuffix = collapsed.replace(/_(PLUS|MINUS)$/i, '').trim();
  return noSuffix;
}

function lowerKey(raw: string) {
  return normalizeFamilyKey(raw).toLowerCase();
}
function isSokolukName(name: string) {
  const n = String(name || '').toLowerCase();
  return n.includes('sokuluk') || n.includes('сокулук');
}

function locationKindLabel(l: LocationRow) {
  // В Сокулуке “2 в 1”: мастерская + магазин (центральный склад)
  if (isSokolukName(l.name)) return 'центральный склад + магазин';
  return l.kind; // остальные показываем как есть
}

// === Excel: vendor-friendly lens name mapping ===
function isBlueBlockFamily(fam: string) {
  const s = String(fam || '').trim().toLowerCase();
  if (!s) return false;
  if (s === 'bb') return true;
  if (s.startsWith('bb ')) return true;
  if (s.startsWith('bb:')) return true;
  if (s.includes('blueblock')) return true;
  return false;
}

function prettyLensFamilyName(fam: string) {
  return vendorFamilyLabel(fam);
}

/* ===================== ✅ FAMILY FILTER (keep only requested) ===================== */
/**
 * Оставляем:
 * - BB, AR, WHITE
 * - CHAME* (CHAME_BLACK / CHAME_BROWN / ...)
 * - PC_159_HMC (поликарбонат 1.59 HMC)
 * - MYOPIA_CONTROL (детский контроль миопии)
 *
 * Убираем:
 * - BBH, WHITE 1.67, CLEAR, PHOTO (и всё остальное скрываем)
 */
const ALLOWED_FAMILY_KEYS = new Set(['bb', 'ar', 'white', 'pc_159_hmc', 'myopia_control']);

function isAllowedFamily(raw: string) {
  const key = lowerKey(raw);

  // точечные исключения
  if (key === 'bbh') return false;
  if (key.includes('clear')) return false;
  if (key.includes('photo')) return false;

  // WHITE 1.67 (разные варианты написания)
  if (key.includes('white') && key.includes('1.67')) return false;

  // ✅ Chameleon: показываем только цветные (убираем "просто CHAME")
if (key === 'chame' || key === 'chameleon') return false;

if (key.startsWith('chame')) {
  const okColor =
    key.includes('black') ||
    key.includes('brown') ||
    key.includes('blue') ||
    key.includes('green') ||
    key.includes('purple');

  return okColor;
}

  // ✅ explicit new families
  if (key === 'pc_159_hmc') return true;
  if (key.includes('myopia')) return true;

  // allowlist
  return ALLOWED_FAMILY_KEYS.has(key);
}

/* ===================== ✅ SPH normalization / de-dup ===================== */
/**
 * Важно: в БД иногда прилетает -0 и 0 как разные строки (или дубли по SPH),
 * из-за этого:
 * - ломаются "переключашки" (таб/график), появляются десятки/сотни ошибок,
 * - React ругается на дубли key, ECharts может путаться по категориям.
 *
 * Решение:
 * 1) нормализуем SPH: -0 -> 0, округление до 0.01
 * 2) агрегируем возможные дубли по SPH, суммируем метрики, SKU берём если есть
 */
function normSph(v: number): number {
  if (!Number.isFinite(v)) return NaN;
  if (Object.is(v, -0)) v = 0;
  // стабильно к 0.01 (как toFixed(2), но числом)
  return Math.round(v * 100) / 100;
}
function buildSphGrid(min = SPH_MIN, max = SPH_MAX, _step = SPH_STEP) {
  // Правильная сетка SPH для очковых линз:
  // |SPH| < 4.00  -> шаг 0.25
  // |SPH| >= 4.00 -> шаг 0.50
  const fineStep = 0.25;
  const coarseStep = 0.5;
  const fineLimit = 4.0;

  const out: number[] = [];

  // 1) От min до -4.00 шагом 0.5 (например -10.00 ... -4.00)
  for (let v = min; v <= -fineLimit + 1e-9; v += coarseStep) {
    out.push(normSph(v));
  }

  // 2) От -3.75 до -0.25 шагом 0.25
  for (let v = -fineLimit + fineStep; v < 0 - 1e-9; v += fineStep) {
    out.push(normSph(v));
  }

  // 3) 0
  out.push(0);

  // 4) От +0.25 до +3.75 шагом 0.25
  for (let v = fineStep; v < fineLimit - 1e-9; v += fineStep) {
    out.push(normSph(v));
  }

  // 5) +4.00
  out.push(normSph(fineLimit));

  // 6) От +4.50 до max шагом 0.5
  for (let v = fineLimit + coarseStep; v <= max + 1e-9; v += coarseStep) {
    out.push(normSph(v));
  }

  // Чистим дубли/выход за диапазон (на всякий)
  const uniq = Array.from(new Set(out.map((x) => normSph(x))))
    .filter((x) => x >= min - 1e-9 && x <= max + 1e-9)
    .sort((a, b) => a - b);

  return uniq;
}

type ProcRow = {
  sph: number;
  sign?: string | null;
  hist_qty: number;
  hist_days: number;
  daily_avg?: number | null;
  plan_qty: number;
  on_hand: number;
  in_transit: number;
  to_buy: number;
  lens_sku_id: string | null;
};

function aggregateBySph(rr: ProcRow[]): ProcRow[] {
  const map = new Map<string, ProcRow>();

  for (const r of rr) {
    const sphN = normSph(Number(r.sph));
    if (!Number.isFinite(sphN)) continue;

    const key = sphN.toFixed(2);
    const prev = map.get(key);

    if (!prev) {
      map.set(key, {
        ...r,
        sph: sphN,
        hist_qty: Number(r.hist_qty || 0),
        hist_days: Number(r.hist_days || 0),
        daily_avg: r.daily_avg == null ? null : Number(r.daily_avg),
        plan_qty: Number(r.plan_qty || 0),
        on_hand: Number(r.on_hand || 0),
        in_transit: Number(r.in_transit || 0),
        to_buy: Number(r.to_buy || 0),
        lens_sku_id: r.lens_sku_id ? String(r.lens_sku_id) : null,
      });
      continue;
    }

    prev.hist_qty = (Number(prev.hist_qty) || 0) + (Number(r.hist_qty) || 0);
    prev.hist_days = Math.max(Number(prev.hist_days) || 0, Number(r.hist_days) || 0);

    const a = prev.daily_avg == null ? null : Number(prev.daily_avg);
    const b = r.daily_avg == null ? null : Number(r.daily_avg);
    if (a == null) prev.daily_avg = b;
    else if (b != null) prev.daily_avg = Math.max(a, b);

    prev.plan_qty = (Number(prev.plan_qty) || 0) + (Number(r.plan_qty) || 0);
    prev.on_hand = (Number(prev.on_hand) || 0) + (Number(r.on_hand) || 0);
    prev.in_transit = (Number(prev.in_transit) || 0) + (Number(r.in_transit) || 0);
    prev.to_buy = (Number(prev.to_buy) || 0) + (Number(r.to_buy) || 0);

    if (!prev.lens_sku_id && r.lens_sku_id) prev.lens_sku_id = String(r.lens_sku_id);
  }

  return Array.from(map.values()).sort((a, b) => a.sph - b.sph);
}

/* ===================== Excel styling helpers ===================== */

type XLSXStyleModule = any;

function cellAddr(r1: number, c1: number) {
  // r1/c1 are 1-based (Excel)
  const col = (() => {
    let n = c1;
    let s = '';
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  })();
  return `${col}${r1}`;
}

function applyRangeStyle(ws: any, r1: number, c1: number, r2: number, c2: number, style: any) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const a = cellAddr(r, c);
      if (!ws[a]) ws[a] = { t: 's', v: '' };
      ws[a].s = { ...(ws[a].s || {}), ...(style || {}) };
    }
  }
}

function ensureMerges(ws: any) {
  if (!ws['!merges']) ws['!merges'] = [];
  return ws['!merges'] as any[];
}

function addMerge(ws: any, r1: number, c1: number, r2: number, c2: number) {
  const merges = ensureMerges(ws);
  merges.push({ s: { r: r1 - 1, c: c1 - 1 }, e: { r: r2 - 1, c: c2 - 1 } });
}

type RefocusStyleMeta = {
  lastRow: number;
  dataEndRow: number;
  totalRow: number;
  grandRow: number;
};

function applyRefocusExcelStyle(ws: any, meta: RefocusStyleMeta) {
  const TEAL = '22D3EE';
  const SKY = '38BDF8';
  const DARK = '0F172A';
  const SLATE = '334155';
  const LIGHT = 'F8FAFC';
  const BORDER = 'E2E8F0';
  const WHITE = 'FFFFFF';

  const borderAll = {
    border: {
      top: { style: 'thin', color: { rgb: BORDER } },
      bottom: { style: 'thin', color: { rgb: BORDER } },
      left: { style: 'thin', color: { rgb: BORDER } },
      right: { style: 'thin', color: { rgb: BORDER } },
    },
  };

  const titleStyle = {
    font: { name: 'Calibri', bold: true, sz: 22, color: { rgb: WHITE } },
    fill: { patternType: 'solid', fgColor: { rgb: DARK } },
    alignment: { vertical: 'center', horizontal: 'left' },
  };

  const subTitleStyle = {
    font: { name: 'Calibri', bold: true, sz: 18, color: { rgb: WHITE } },
    fill: { patternType: 'solid', fgColor: { rgb: SLATE } },
    alignment: { vertical: 'center', horizontal: 'left' },
  };

  const exportDateCell = {
    font: { name: 'Calibri', bold: true, sz: 12, color: { rgb: WHITE } },
    fill: { patternType: 'solid', fgColor: { rgb: SLATE } },
    alignment: { vertical: 'center', horizontal: 'right', wrapText: false },
  };

  const metaLabel = {
    font: { name: 'Calibri', bold: true, sz: 11, color: { rgb: SLATE } },
    alignment: { vertical: 'center', horizontal: 'left', wrapText: true },
  };

  const metaValue = {
    font: { name: 'Calibri', sz: 11, color: { rgb: DARK } },
    alignment: { vertical: 'center', horizontal: 'left', wrapText: true },
  };

  const headerNeg = {
    font: { name: 'Calibri', bold: true, sz: 12, color: { rgb: WHITE } },
    fill: { patternType: 'solid', fgColor: { rgb: DARK } },
    alignment: { vertical: 'center', horizontal: 'center' },
  };

  const headerPos = {
    font: { name: 'Calibri', bold: true, sz: 12, color: { rgb: WHITE } },
    fill: { patternType: 'solid', fgColor: { rgb: TEAL } },
    alignment: { vertical: 'center', horizontal: 'center' },
  };

  const bandLeft = {
    fill: { patternType: 'solid', fgColor: { rgb: 'FDE68A' } },
    alignment: { vertical: 'center', horizontal: 'center' },
  };

  const bandRight = {
    fill: { patternType: 'solid', fgColor: { rgb: 'CFFAFE' } },
    alignment: { vertical: 'center', horizontal: 'center' },
  };

  const dataCell = {
    font: { name: 'Calibri', sz: 12, color: { rgb: DARK } },
    alignment: { vertical: 'center', horizontal: 'center' },
  };

  const totalBar = {
    font: { name: 'Calibri', bold: true, sz: 12, color: { rgb: WHITE } },
    fill: { patternType: 'solid', fgColor: { rgb: SKY } },
    alignment: { vertical: 'center', horizontal: 'left' },
  };

  const totalVal = {
    font: { name: 'Calibri', bold: true, sz: 12, color: { rgb: WHITE } },
    fill: { patternType: 'solid', fgColor: { rgb: SKY } },
    alignment: { vertical: 'center', horizontal: 'right' },
  };

  const grandBar = {
    font: { name: 'Calibri', bold: true, sz: 13, color: { rgb: WHITE } },
    fill: { patternType: 'solid', fgColor: { rgb: DARK } },
    alignment: { vertical: 'center', horizontal: 'left' },
  };

  const grandVal = {
    font: { name: 'Calibri', bold: true, sz: 16, color: { rgb: WHITE } },
    fill: { patternType: 'solid', fgColor: { rgb: DARK } },
    alignment: { vertical: 'center', horizontal: 'right' },
  };

  const { lastRow, dataEndRow, totalRow, grandRow } = meta;

  applyRangeStyle(ws, 1, 1, lastRow, 5, {
    fill: { patternType: 'solid', fgColor: { rgb: LIGHT } },
  });

  applyRangeStyle(ws, 1, 1, 1, 5, titleStyle);
  applyRangeStyle(ws, 2, 1, 2, 5, subTitleStyle);
  applyRangeStyle(ws, 2, 5, 2, 5, exportDateCell);

  applyRangeStyle(ws, 3, 1, 5, 1, metaLabel);
  applyRangeStyle(ws, 3, 2, 5, 5, metaValue);
  applyRangeStyle(ws, 3, 1, 5, 5, borderAll);

  applyRangeStyle(ws, 7, 1, 7, 2, headerNeg);
  applyRangeStyle(ws, 7, 4, 7, 5, headerPos);
  applyRangeStyle(ws, 7, 3, 7, 3, { fill: { patternType: 'solid', fgColor: { rgb: LIGHT } } });

  if (dataEndRow >= 8) {
    applyRangeStyle(ws, 8, 1, dataEndRow, 1, { ...bandLeft, ...borderAll });
    applyRangeStyle(ws, 8, 4, dataEndRow, 4, { ...bandRight, ...borderAll });

    applyRangeStyle(ws, 8, 2, dataEndRow, 2, { ...dataCell, ...borderAll });
    applyRangeStyle(ws, 8, 5, dataEndRow, 5, { ...dataCell, ...borderAll });

    applyRangeStyle(ws, 8, 3, dataEndRow, 3, { fill: { patternType: 'solid', fgColor: { rgb: LIGHT } } });
  }

  if (totalRow > 0) {
    applyRangeStyle(ws, totalRow, 1, totalRow, 1, { ...totalBar, ...borderAll });
    applyRangeStyle(ws, totalRow, 2, totalRow, 2, { ...totalVal, ...borderAll });
    applyRangeStyle(ws, totalRow, 4, totalRow, 4, { ...totalBar, ...borderAll });
    applyRangeStyle(ws, totalRow, 5, totalRow, 5, { ...totalVal, ...borderAll });
    applyRangeStyle(ws, totalRow, 3, totalRow, 3, {
      fill: { patternType: 'solid', fgColor: { rgb: LIGHT } },
      ...borderAll,
    });
  }

  if (grandRow > 0) {
    applyRangeStyle(ws, grandRow, 1, grandRow, 4, { ...grandBar, ...borderAll });
    applyRangeStyle(ws, grandRow, 5, grandRow, 5, { ...grandVal, ...borderAll });
  }

  applyRangeStyle(ws, 1, 1, lastRow, 5, borderAll);
}

/* ===================== types ===================== */

type LensFamilyRow = {
  lens_family: string; // UI label
  rpc_family: string; // canonical key
  items_cnt: number;
  first_day?: string | null;
  last_day?: string | null;
  days_span?: number | null;
  source?: 'db' | 'stats' | 'merged';
};

type LocationRow = {
  id: string;
  name: string;
  kind: string;
};

type BatchRow = {
  id: string;
  created_at: string;
  status: string;
  ordered_at?: string | null;
  received_at?: string | null;
  comment?: string | null;
  to_location_id: string;
  lens_family: string;
  plan_days?: number | null;
  safety?: number | null;
  min_each?: number | null;
  apply_min_to_all?: boolean | null;

  items_cnt?: number;
  qty_total?: number;
};

/* ===================== ✅ MIN-EACH enforcement (CLIENT) ===================== */

function applyMinEachClient(rr: ProcRow[], minEach: number, applyMinToAll: boolean): ProcRow[] {
  const min = Math.max(0, Math.floor(Number(minEach || 0)));
  if (min <= 0) return rr;

  return rr.map((r) => {
    const planRaw = Number(r.plan_qty || 0);
    const onHand = Number(r.on_hand || 0);
    const inTransit = Number(r.in_transit || 0);
    const hist = Number(r.hist_qty || 0);

    const shouldApply = applyMinToAll || hist > 0;
    const planEff = shouldApply ? Math.max(Math.ceil(planRaw), min) : Math.ceil(planRaw);

    const calc = Math.max(0, planEff - onHand - inTransit);
    const toBuyEff = Math.max(Number(r.to_buy || 0), calc);

    return {
      ...r,
      plan_qty: planEff,
      to_buy: toBuyEff,
    };
  });
}

/* ===================== UI primitives ===================== */

function SoftPrimaryButton({
  children,
  onClick,
  disabled,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white',
        'bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400',
        'shadow-[0_16px_40px_rgba(34,211,238,0.35)]',
        'hover:opacity-95 active:opacity-90',
        'focus:outline-none focus:ring-2 focus:ring-teal-300/70',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function SoftGhostButton({
  children,
  onClick,
  disabled,
  className = '',
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium',
        'bg-white/85 hover:bg-white',
        'text-teal-700',
        'ring-1 ring-teal-200',
        'shadow-[0_12px_35px_rgba(15,23,42,0.18)]',
        'focus:outline-none focus:ring-2 focus:ring-teal-300/70',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  rightIcon,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  rightIcon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="relative">
      <input
        value={value}
        type={type}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={[
          'w-full rounded-[14px] bg-white/90 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400',
          'ring-1 ring-sky-200/80',
          'shadow-[0_18px_45px_rgba(15,23,42,0.18)]',
          'focus:outline-none focus:ring-2 focus:ring-cyan-400/80',
          className,
        ].join(' ')}
      />
      {rightIcon && (
        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
          {rightIcon}
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[11px] font-medium text-slate-500">{children}</div>;
}

function LightCard({
  title,
  aside,
  children,
  className = '',
}: {
  title?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const hasHeader = title || aside;
  return (
    <section
      className={[
        'rounded-3xl p-5 sm:p-6',
        'bg-gradient-to-br from-white via-slate-50 to-sky-50/85',
        'ring-1 ring-sky-200/70',
        'shadow-[0_22px_70px_rgba(15,23,42,0.20)]',
        'backdrop-blur-xl',
        'text-slate-900',
        className,
      ].join(' ')}
    >
      {hasHeader && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
              {title}
            </div>
          )}
          {aside && <div className="text-[11px] text-slate-500">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = String(status || '').toLowerCase();
  const cls =
    s === 'received'
      ? 'bg-emerald-500/10 text-emerald-800 ring-emerald-300/40'
      : s === 'in_transit'
        ? 'bg-sky-500/10 text-sky-800 ring-sky-300/40'
        : s === 'draft'
          ? 'bg-slate-900/5 text-slate-700 ring-slate-200'
          : 'bg-amber-500/10 text-amber-900 ring-amber-300/40';

  return <span className={['rounded-full px-2 py-0.5 text-[10px] ring-1', cls].join(' ')}>{status}</span>;
}

function Modal({
  open,
  title,
  children,
  onClose,
  footer,
}: {
  open: boolean;
  title: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[50] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-xl rounded-3xl bg-white ring-1 ring-slate-200 shadow-[0_30px_120px_rgba(15,23,42,0.35)]">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900/5 ring-1 ring-slate-200 hover:bg-slate-900/10"
          >
            <X className="h-4 w-4 text-slate-700" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">{footer}</div>
        )}
      </div>
    </div>
  );
}

function CheckLine({ ok, text, hint }: { ok: boolean; text: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div
        className={[
          'mt-0.5 grid h-5 w-5 place-items-center rounded-full ring-1',
          ok ? 'bg-emerald-500/10 ring-emerald-300/40' : 'bg-rose-500/10 ring-rose-300/40',
        ].join(' ')}
      >
        {ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
        )}
      </div>
      <div className="min-w-0">
        <div className={['text-[12px] font-medium', ok ? 'text-emerald-800' : 'text-rose-700'].join(' ')}>
          {text}
        </div>
        {hint ? <div className="mt-0.5 text-[11px] text-slate-600">{hint}</div> : null}
      </div>
    </div>
  );
}

/* ===================== page ===================== */

export default function LensProcurementPage() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const todayISO = React.useMemo(() => onlyDateISO(new Date()), []);
  const [gate, setGate] = React.useState<'pending' | 'ok' | 'denied'>('pending');

  // настройки закупа
  const [safetyFactor, setSafetyFactor] = React.useState<number>(1.35);
  const [minEach, setMinEach] = React.useState<number>(2);
  const [applyMinToAll, setApplyMinToAll] = React.useState<boolean>(true);

  // ✅ ВОТ СЮДА ПОДНИМАЕМ locationId (до useEffect где он используется)
  const [locationId, setLocationId] = React.useState<string>('');

  // ✅ restore settings on mount
  React.useEffect(() => {
    if (!mounted) return;
    try {
      const raw = localStorage.getItem(LS_PROC_SETTINGS_KEY);
      if (!raw) return;

      const s = JSON.parse(raw);

      if (typeof s?.safetyFactor === 'number') {
        setSafetyFactor(clampNum(Number(s.safetyFactor), 1, 10, 1.35));
      }
      if (typeof s?.minEach === 'number') {
        setMinEach(Math.max(0, Math.floor(Number(s.minEach))));
      }
      if (typeof s?.applyMinToAll === 'boolean') {
        setApplyMinToAll(Boolean(s.applyMinToAll));
      }
      if (typeof s?.locationId === 'string' && s.locationId) {
        setLocationId(String(s.locationId));
      }
    } catch {
      // ignore
    }
  }, [mounted]);

  // ✅ persist settings on change
  React.useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(
        LS_PROC_SETTINGS_KEY,
        JSON.stringify({
          safetyFactor,
          minEach,
          applyMinToAll,
          locationId, // ✅ теперь переменная уже объявлена выше
        }),
      );
    } catch {
      // ignore
    }
  }, [mounted, safetyFactor, minEach, applyMinToAll, locationId]);

  // Excel ship-to
  const [shipToAddress, setShipToAddress] = React.useState<string>(
    `钱先生V3396-S4214
13250150777
广东省佛山市南海区里水镇和顺鹤峰1号仓315库B3396-S4214 (996555244966)`,
  );

  // UI: свернуть/развернуть подсказку
  const [infoOpen, setInfoOpen] = React.useState(false);

  // список семейств
  const [families, setFamilies] = React.useState<LensFamilyRow[]>([]);
  const [loadingFamilies, setLoadingFamilies] = React.useState(false);

  // TO_BUY totals по семействам (для левого списка)
  const [toBuyTotals, setToBuyTotals] = React.useState<Record<string, number>>({});
  const [loadingToBuyTotals, setLoadingToBuyTotals] = React.useState(false);

  // locations
  const [locations, setLocations] = React.useState<LocationRow[]>([]);
  const [loadingLocations, setLoadingLocations] = React.useState(false);

  // выбранное семейство
  const [selected, setSelected] = React.useState<string>(''); // label
  const [selectedRpc, setSelectedRpc] = React.useState<string>(''); // canonical key for RPC/batches

  // строки закупа
  const [rows, setRows] = React.useState<ProcRow[]>([]);
  const [loadingRows, setLoadingRows] = React.useState(false);

  // поиск слева
  const [q, setQ] = React.useState('');

  // вкладка справа
  const [tab, setTab] = React.useState<'to_buy' | 'stock' | 'transit'>('to_buy');

  const [err, setErr] = React.useState<string | null>(null);

  // партии
  const [batches, setBatches] = React.useState<BatchRow[]>([]);
  const [loadingBatches, setLoadingBatches] = React.useState(false);
  const [busyBatchId, setBusyBatchId] = React.useState<string>('');

  // UI: создание партии (панель внутри карточки партий)
  const [createOpen, setCreateOpen] = React.useState(false);
  const [creatingBatch, setCreatingBatch] = React.useState(false);
  const [createComment, setCreateComment] = React.useState<string>('');
  const [createExtraOpen, setCreateExtraOpen] = React.useState(false);
  const [batchStatusFilter, setBatchStatusFilter] = React.useState<'all' | 'draft' | 'in_transit' | 'received'>('all');

  // модалка комментария для статуса
  const [commentOpen, setCommentOpen] = React.useState(false);
  const [commentBatchId, setCommentBatchId] = React.useState<string>('');
  const [commentAction, setCommentAction] = React.useState<'ordered' | 'received'>('ordered');
  const [commentText, setCommentText] = React.useState<string>('');

  // ✅ Автофикс SKU (создание недостающих сферических SKU из UI)
  const [autoFixingSku, setAutoFixingSku] = React.useState(false);
  const [autoFixSkuMsg, setAutoFixSkuMsg] = React.useState<string | null>(null);

  // ✅ Delete batch modal
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteBatchId, setDeleteBatchId] = React.useState<string>('');
  const [deleteTyped, setDeleteTyped] = React.useState<string>('');
  const [deleteAlsoLots, setDeleteAlsoLots] = React.useState<boolean>(true);
  const [deletingBatch, setDeletingBatch] = React.useState<boolean>(false);
  // ✅ Clear stock modal
  const [clearStockOpen, setClearStockOpen] = React.useState(false);
  const [clearStockTyped, setClearStockTyped] = React.useState('');
  const [clearingStock, setClearingStock] = React.useState(false);

  // responsive chart height
  const [vw, setVw] = React.useState<number>(0);
  React.useEffect(() => {
    if (!mounted) return;
    const onResize = () => setVw(window.innerWidth || 0);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mounted]);

  const chartHeight = React.useMemo(() => {
    if (!vw) return 420;
    if (vw >= 1024) return 460;
    if (vw >= 768) return 380;
    return 280;
  }, [vw]);

  /* ---------- access gate ---------- */

  React.useEffect(() => {
    if (!mounted) return;
    (async () => {
      try {
        setGate((await isOwner()) ? 'ok' : 'denied');
      } catch {
        setGate('denied');
      }
    })();
  }, [mounted]);

  /* ---------- families: load canonical (mapping) + merge with stats (grouped) ---------- */

  async function tryFetchAllFamiliesFromDb(): Promise<string[] | null> {
    const sb = getBrowserSupabase();

    for (const src of FAMILY_SOURCES) {
      try {
        const { data, error } = await sb.from(src.name as any).select(src.col as any).limit(5000);
        if (error) continue;

        const vals = (data || [])
          .map((r: any) => r?.[src.col])
          .filter(Boolean)
          .map((x: any) => String(x));

        const cleaned = uniqStrings(vals)
          .map(normalizeFamilyKey)
          .filter((x) => x && !shouldHideFamily(x))
          .filter((x) => isAllowedFamily(x));

        if (cleaned.length) return cleaned;
      } catch {
        // ignore, try next
      }
    }

    return null;
  }

  async function fetchFamilyStats(): Promise<LensFamilyRow[]> {
    const sb = getBrowserSupabase();
    const { data, error } = await sb.rpc(RPC_STATS_FAMILIES_FN, {});
    if (error) throw new Error(error.message);

    const parsedRaw = Array.isArray(data)
      ? data.map((r: any) => ({
          raw: String(r.lens_family ?? r.family ?? '—'),
          items_cnt: Number(r.items_cnt ?? r.qty_sum ?? r.count ?? 0),
          first_day: (r.first_day ?? null) as string | null,
          last_day: (r.last_day ?? null) as string | null,
          days_span: r.days_span === undefined || r.days_span === null ? null : Number(r.days_span),
        }))
      : [];

    // ✅ группируем историю по каноническому ключу + фильтр allowlist
    const map = new Map<string, LensFamilyRow>();
    for (const x of parsedRaw) {
      const key = normalizeFamilyKey(x.raw);
      if (!key) continue;
      if (shouldHideFamily(key)) continue;
      if (!isAllowedFamily(key)) continue;

      const lk = key.toLowerCase();
      const prev = map.get(lk);
      if (!prev) {
        map.set(lk, {
          lens_family: key,
          rpc_family: key,
          items_cnt: Number(x.items_cnt || 0),
          first_day: x.first_day ?? null,
          last_day: x.last_day ?? null,
          days_span: x.days_span ?? null,
          source: 'stats',
        });
      } else {
        prev.items_cnt = Number(prev.items_cnt || 0) + Number(x.items_cnt || 0);

        const a = prev.first_day ? String(prev.first_day) : null;
        const b = x.first_day ? String(x.first_day) : null;
        if (!a) prev.first_day = b;
        else if (b && b < a) prev.first_day = b;

        const c = prev.last_day ? String(prev.last_day) : null;
        const d = x.last_day ? String(x.last_day) : null;
        if (!c) prev.last_day = d;
        else if (d && d > c) prev.last_day = d;

        const dsPrev = prev.days_span == null ? null : Number(prev.days_span);
        const dsNew = x.days_span == null ? null : Number(x.days_span);
        if (dsPrev == null) prev.days_span = dsNew;
        else if (dsNew != null) prev.days_span = Math.max(dsPrev, dsNew);

        prev.source = 'stats';
      }
    }

    return Array.from(map.values());
  }

  const loadFamilies = React.useCallback(async () => {
    if (!mounted) return;
    setLoadingFamilies(true);
    setErr(null);

    try {
      const [allFromDb, stats] = await Promise.all([
        tryFetchAllFamiliesFromDb(),
        fetchFamilyStats().catch(() => [] as LensFamilyRow[]),
      ]);

      const statsMap = new Map<string, LensFamilyRow>();
      for (const s of stats) statsMap.set(lowerKey(s.rpc_family), s);

      const merged: LensFamilyRow[] = [];

      if (allFromDb && allFromDb.length) {
        for (const famRaw of allFromDb) {
          const rpc = normalizeFamilyKey(famRaw);
          if (!rpc) continue;
          if (shouldHideFamily(rpc)) continue;
          if (!isAllowedFamily(rpc)) continue;

          const key = rpc.toLowerCase();
          const st = statsMap.get(key);

          merged.push({
            lens_family: rpc,
            rpc_family: rpc,
            items_cnt: st?.items_cnt ?? 0,
            first_day: st?.first_day ?? null,
            last_day: st?.last_day ?? null,
            days_span: st?.days_span ?? null,
            source: st ? 'merged' : 'db',
          });
        }

        for (const st of stats) {
          const key = st.rpc_family.toLowerCase();
          if (!merged.some((m) => m.rpc_family.toLowerCase() === key)) merged.push({ ...st, source: 'stats' });
        }
      } else {
        merged.push(...stats);
      }

      const uniq = new Map<string, LensFamilyRow>();
      for (const m of merged) {
        const k = m.rpc_family.toLowerCase();
        if (!uniq.has(k)) uniq.set(k, m);
      }

      let list = Array.from(uniq.values());

      // ✅ финальный фильтр allowlist (на всякий)
      list = list.filter((x) => isAllowedFamily(x.rpc_family));

      list.sort((a, b) => {
        const da = Number(a.items_cnt || 0);
        const db = Number(b.items_cnt || 0);
        if (db !== da) return db - da;
        return String(a.lens_family).localeCompare(String(b.lens_family), 'ru');
      });

      setFamilies(list);

      // сохранить выбор/переехать на канон
      setSelected((prevLabel) => {
        const prevKey = normalizeFamilyKey(prevLabel);
        const found =
          (prevKey && list.find((x) => x.rpc_family.toLowerCase() === prevKey.toLowerCase())) ?? list[0] ?? null;

        if (found) {
          setSelectedRpc(found.rpc_family);
          return vendorFamilyLabel(found.rpc_family);
        }

        setSelectedRpc('');
        return '';
      });
    } catch (e: any) {
      setFamilies([]);
      setSelected('');
      setSelectedRpc('');
      setErr(prettifyRpcError(e));
    } finally {
      setLoadingFamilies(false);
    }
  }, [mounted]);

  React.useEffect(() => {
    if (gate !== 'ok') return;
    void loadFamilies();
  }, [gate, loadFamilies]);

  /* ---------- load locations ---------- */

  const loadLocations = React.useCallback(async () => {
    if (!mounted) return;
    setLoadingLocations(true);
    setErr(null);

    try {
      const sb = getBrowserSupabase();
      const { data, error } = await sb
        .from('locations')
        .select('id,name,kind')
        .order('kind', { ascending: false })
        .order('name', { ascending: true });

      if (error) throw new Error(error.message);

      const list: LocationRow[] = Array.isArray(data)
        ? data.map((r: any) => ({
            id: String(r.id),
            name: String(r.name ?? ''),
            kind: String(r.kind ?? ''),
          }))
        : [];

      // 1) убираем “центральный склад” из выпадашки (и любые warehouse)
      const filtered = list.filter((x) => {
        const kind = String(x.kind || '').toLowerCase();
        const name = String(x.name || '').toLowerCase();

        if (kind === 'warehouse') return false; // убираем warehouse целиком
        if (name.includes('централ')) return false; // "центральный..."
        if (name.includes('central')) return false; // "central..."
        if (name.includes('центральный склад')) return false; // явное
        return true;
      });

      setLocations(filtered);

      // 2) по умолчанию выбираем Sokoluk; если в localStorage был удалённый id — переедем
      setLocationId((prev) => {
        const prevOk = prev && filtered.some((x) => x.id === prev);
        if (prevOk) return prev;

        const sok = filtered.find((x) => isSokolukName(x.name));
        const fallback = filtered[0];

        return (sok ?? fallback)?.id ? String((sok ?? fallback)!.id) : '';
      });
    } catch (e: any) {
      setLocations([]);
      setErr(prettifyRpcError(e));
    } finally {
      setLoadingLocations(false);
    }
  }, [mounted]);

  React.useEffect(() => {
    if (gate !== 'ok') return;
    void loadLocations();
  }, [gate, loadLocations]);

  /* ---------- RPC row parser (robust to column renames) ---------- */

  function pickSkuId(r: any): string | null {
    const v =
      r?.lens_sku_id ??
      r?.sku_id ??
      r?.out_lens_sku_id ??
      r?.out_sku_id ??
      r?.lensSkuId ??
      r?.skuId ??
      null;
    return v ? String(v) : null;
  }

  function pickNum(r: any, keys: string[], fallback = 0): number {
    for (const k of keys) {
      const v = r?.[k];
      if (v === null || v === undefined) continue;
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return fallback;
  }

  function pickSph(r: any): number {
    return pickNum(r, ['sph', 'out_sph', 'p_sph', 'sph_value', 'sph_num'], NaN);
  }

  function pickToBuy(r: any): number {
    return pickNum(r, ['to_buy', 'out_to_buy', 'need_buy', 'need_to_buy'], 0);
  }

  function pickOnHand(r: any): number {
    return pickNum(r, ['on_hand', 'out_on_hand', 'stock', 'qty_on_hand'], 0);
  }

  function pickInTransit(r: any): number {
    return pickNum(r, ['in_transit', 'out_in_transit', 'transit', 'qty_in_transit'], 0);
  }

  function pickPlanQty(r: any): number {
    return pickNum(r, ['plan_qty', 'out_plan_qty', 'plan', 'target_qty'], 0);
  }

  function pickHistQty(r: any): number {
    return pickNum(r, ['hist_qty', 'out_hist_qty', 'demand_qty', 'demand_90', 'qty_hist'], 0);
  }

  function pickHistDays(r: any): number {
    return pickNum(r, ['hist_days', 'out_hist_days', 'days', 'demand_days'], 1);
  }

  function pickDailyAvg(r: any): number | null {
    for (const k of ['daily_avg', 'out_daily_avg', 'avg_per_day', 'daily']) {
      const v = r?.[k];
      if (v === null || v === undefined) continue;
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  /* ---------- load procurement rows ---------- */

  const loadProcRows = React.useCallback(async () => {
    if (!mounted) return;
    if (!selectedRpc || !locationId) return;

    setLoadingRows(true);
    setErr(null);
    setAutoFixSkuMsg(null);

    try {
      const sb = getBrowserSupabase();
      const { data, error } = await sb.rpc(RPC_PROCUREMENT_FN, {
        p_lens_family: selectedRpc,
        p_location_id: locationId,
        p_plan_days: PLAN_DAYS,
        p_safety: safetyFactor,
        p_min_each: minEach,
        p_apply_min_to_all: applyMinToAll,
      });

      if (error) throw new Error(error.message);

      const parsedRaw: ProcRow[] = Array.isArray(data)
        ? data
            .map((r: any) => {
              const sph0 = pickSph(r);
              const sph = normSph(sph0);
              return {
                sph,
                sign: r.sign ?? r.out_sign ?? null,
                hist_qty: pickHistQty(r),
                hist_days: pickHistDays(r),
                daily_avg: pickDailyAvg(r),
                plan_qty: pickPlanQty(r),
                on_hand: pickOnHand(r),
                in_transit: pickInTransit(r),
                to_buy: pickToBuy(r),
                lens_sku_id: pickSkuId(r),
              };
            })
            .filter((r) => Number.isFinite(r.sph))
        : [];

      const parsed = aggregateBySph(parsedRaw);
      const adjusted = applyMinEachClient(parsed, minEach, applyMinToAll);

      // ✅ apply SPH range limit by family
      const lim = getSphLimitsForFamily(selectedRpc);
      const ranged = adjusted.filter((r) => r.sph >= lim.min - 1e-9 && r.sph <= lim.max + 1e-9);

      setRows(ranged);
    } catch (e: any) {
      setRows([]);
      setErr(prettifyRpcError(e));
    } finally {
      setLoadingRows(false);
    }
  }, [mounted, selectedRpc, locationId, safetyFactor, minEach, applyMinToAll]);

  React.useEffect(() => {
    if (gate !== 'ok') return;
    void loadProcRows();
  }, [gate, loadProcRows]);

  /* ---------- ✅ load TO_BUY totals for left list ---------- */

  const loadToBuyTotalsForFamilies = React.useCallback(async () => {
    if (!mounted) return;
    if (!locationId) return;

    if (!families.length) {
      setToBuyTotals({});
      return;
    }

    setLoadingToBuyTotals(true);
    setErr(null);

    let cancelled = false;

    const sb = getBrowserSupabase();
    const out: Record<string, number> = {};

    const CONCURRENCY = 3;
    const queue = [...families];

    async function worker() {
      while (!cancelled) {
        const f = queue.shift();
        if (!f) return;

        const fam = normalizeFamilyKey(f.rpc_family);
        if (!fam) continue;

        try {
          const { data, error } = await sb.rpc(RPC_PROCUREMENT_FN, {
            p_lens_family: fam,
            p_location_id: locationId,
            p_plan_days: PLAN_DAYS,
            p_safety: safetyFactor,
            p_min_each: minEach,
            p_apply_min_to_all: applyMinToAll,
          });

          if (error) throw new Error(error.message);

          const rrRaw: ProcRow[] = Array.isArray(data)
            ? data
                .map((r: any) => {
                  const sph = normSph(pickSph(r));
                  return {
                    sph,
                    sign: r.sign ?? r.out_sign ?? null,
                    hist_qty: pickHistQty(r),
                    hist_days: pickHistDays(r),
                    daily_avg: pickDailyAvg(r),
                    plan_qty: pickPlanQty(r),
                    on_hand: pickOnHand(r),
                    in_transit: pickInTransit(r),
                    to_buy: pickToBuy(r),
                    lens_sku_id: pickSkuId(r),
                  };
                })
                .filter((x) => Number.isFinite(x.sph))
            : [];

          const rrAgg = aggregateBySph(rrRaw);
          const adjusted = applyMinEachClient(rrAgg, minEach, applyMinToAll);

          // ✅ ВАЖНО: применяем тот же SPH-диапазон, что и справа (как в loadProcRows)
          const lim = getSphLimitsForFamily(fam);
          const ranged = adjusted.filter((r) => r.sph >= lim.min - 1e-9 && r.sph <= lim.max + 1e-9);

          const totalToBuy = ranged.reduce((a, r) => a + (Number(r.to_buy) || 0), 0);

          out[lowerKey(fam)] = Math.round(totalToBuy);
        } catch {
          out[lowerKey(fam)] = out[lowerKey(fam)] ?? 0;
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    if (!cancelled) {
      setToBuyTotals(out);
      setLoadingToBuyTotals(false);
    }

    return () => {
      cancelled = true;
    };
  }, [mounted, locationId, families, safetyFactor, minEach, applyMinToAll]);

  React.useEffect(() => {
    if (gate !== 'ok') return;

    let cleanup: any;
    (async () => {
      cleanup = await loadToBuyTotalsForFamilies();
    })();

    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  }, [gate, loadToBuyTotalsForFamilies]);

  /* ---------- load batches ---------- */

  const loadBatches = React.useCallback(async () => {
    if (!mounted) return;
    if (!selectedRpc || !locationId) return;

    setLoadingBatches(true);
    setErr(null);

    try {
      const sb = getBrowserSupabase();

      const { data: b, error: be } = await sb
        .from('lens_purchase_batches')
        .select(
          'id,created_at,status,ordered_at,received_at,comment,to_location_id,lens_family,plan_days,safety,min_each,apply_min_to_all',
        )
        .eq('lens_family', selectedRpc)
        .eq('to_location_id', locationId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (be) throw new Error(be.message);

      const base: BatchRow[] = Array.isArray(b)
        ? b.map((x: any) => ({
            id: String(x.id),
            created_at: String(x.created_at),
            status: String(x.status ?? ''),
            ordered_at: x.ordered_at ?? null,
            received_at: x.received_at ?? null,
            comment: x.comment ?? null,
            to_location_id: String(x.to_location_id),
            lens_family: String(x.lens_family),
            plan_days: x.plan_days ?? null,
            safety: x.safety ?? null,
            min_each: x.min_each ?? null,
            apply_min_to_all: x.apply_min_to_all ?? null,
          }))
        : [];

      const ids = base.map((x) => x.id);
      if (ids.length) {
        const { data: it, error: ite } = await sb.from('lens_purchase_batch_items').select('batch_id,qty').in('batch_id', ids);
        if (ite) throw new Error(ite.message);

        const mapCnt = new Map<string, number>();
        const mapQty = new Map<string, number>();

        (it || []).forEach((r: any) => {
          const bid = String(r.batch_id);
          mapCnt.set(bid, (mapCnt.get(bid) ?? 0) + 1);
          mapQty.set(bid, (mapQty.get(bid) ?? 0) + (Number(r.qty) || 0));
        });

        base.forEach((x) => {
          x.items_cnt = mapCnt.get(x.id) ?? 0;
          x.qty_total = mapQty.get(x.id) ?? 0;
        });
      }

      setBatches(base);
    } catch (e: any) {
      setBatches([]);
      setErr(prettifyRpcError(e));
    } finally {
      setLoadingBatches(false);
    }
  }, [mounted, selectedRpc, locationId]);

  React.useEffect(() => {
    if (gate !== 'ok') return;
    void loadBatches();
  }, [gate, loadBatches]);

  /* ===================== derived ===================== */

  const familiesFiltered = React.useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return families;
    return families.filter((f) => {
      const a = String(f.lens_family || '').toLowerCase();
      const b = vendorFamilyLabel(f.rpc_family).toLowerCase();
      return a.includes(qq) || b.includes(qq);
    });
  }, [families, q]);

  const selectedMeta = React.useMemo(() => {
    if (!selectedRpc) return null;
    return families.find((f) => f.rpc_family === selectedRpc) ?? null;
  }, [families, selectedRpc]);

  const selectedLocation = React.useMemo(() => locations.find((l) => l.id === locationId) ?? null, [locations, locationId]);

  const histDays = React.useMemo(() => {
    const d = rows[0]?.hist_days;
    if (d && Number.isFinite(d) && d > 0) return d;
    return 1;
  }, [rows, selectedRpc]);

  const totals = React.useMemo(() => {
    return {
      on_hand: sumBy(rows, (r) => r.on_hand),
      in_transit: sumBy(rows, (r) => r.in_transit),
      to_buy: sumBy(rows, (r) => r.to_buy),
    };
  }, [rows, selectedRpc]);

  function metricOf(r: ProcRow) {
    switch (tab) {
      case 'stock':
        return r.on_hand;
      case 'transit':
        return r.in_transit;
      case 'to_buy':
      default:
        return r.to_buy;
    }
  }

  const table = React.useMemo(() => {
    const base = rows.map((r) => ({
      sph: normSph(r.sph),
      v: Number(metricOf(r) || 0),
      plan_qty: r.plan_qty,
      on_hand: r.on_hand,
      in_transit: r.in_transit,
      to_buy: r.to_buy,
      hist_qty: r.hist_qty,
      daily_avg: r.daily_avg,
      hasSku: !!r.lens_sku_id,
    }));

    const total = base.reduce((a, x) => a + (Number.isFinite(x.v) ? x.v : 0), 0);
    const withShare = base.map((x) => ({ ...x, share: total > 0 ? x.v / total : 0 }));
    return withShare.sort((a, b) => a.sph - b.sph);
  }, [rows, tab]);

  const chartDataFull = React.useMemo(() => {
    const lim = getSphLimitsForFamily(selectedRpc);
    const grid = buildSphGrid(lim.min, lim.max);

    // Мапа фактических строк из rows по sph
    const by = new Map<string, ProcRow>();
    for (const r of rows) {
      const k = normSph(r.sph).toFixed(2);
      by.set(k, r);
    }

    // Собираем полный ряд: если какой-то SPH отсутствует в rows — показываем нули
    return grid.map((sph) => {
      const k = sph.toFixed(2);
      const r = by.get(k);

      const stock = Number(r?.on_hand ?? 0) || 0;
      const transit = Number(r?.in_transit ?? 0) || 0;
      const buy = Number(r?.to_buy ?? 0) || 0;

      return {
        sph,
        sphLabel: fmtSph(sph),
        stock,
        transit,
        buy,
      };
    });
  }, [rows, selectedRpc]);

  const chartKey = React.useMemo(() => {
    const sig = chartDataFull.map((x) => `${x.sph.toFixed(2)}:${x.buy}:${x.stock}:${x.transit}`).join('|');
    return `${selectedRpc}|${locationId}|${tab}|${hashStr(sig)}`;
  }, [selectedRpc, locationId, tab, chartDataFull]);

  const optionFull: EChartsOption = React.useMemo(() => {
    // Что рисуем на текущей вкладке
    const pick = (x: any) => {
      switch (tab) {
        case 'stock':
          return x.stock;
        case 'transit':
          return x.transit;
        case 'to_buy':
        default:
          return x.buy;
      }
    };

    const cats = chartDataFull.map((x) => x.sphLabel);
    const vals = chartDataFull.map((x) => pick(x));

    const title = tab === 'to_buy' ? 'Купить' : tab === 'stock' ? 'Склад' : 'В пути';

    return {
      animation: false,
      grid: { top: 18, right: 14, bottom: 70, left: 54 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        confine: true,
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const idx = p?.dataIndex ?? 0;
          const x = chartDataFull[idx];
          if (!x) return '';

          // Показываем ВСЕ метрики для выбранной диоптрии
          return (
            `<div style="min-width:180px">` +
            `<div><b>SPH ${x.sphLabel}</b></div>` +
            `<div style="margin-top:6px">` +
            `Купить: <b>${nf(x.buy)} шт</b><br/>` +
            `Склад: <b>${nf(x.stock)} шт</b><br/>` +
            `В пути: <b>${nf(x.transit)} шт</b><br/>` +
            `</div>` +
            `</div>`
          );
        },
      },
      xAxis: {
        type: 'category',
        data: cats,
        axisLabel: {
          interval: 3, // показываем не каждую подпись, чтобы не было каши
          rotate: 0,
        },
      },
      yAxis: {
        type: 'value',
        name: title,
        nameGap: 12,
        axisLabel: {
          formatter: (v: any) => nf(Number(v) || 0),
        },
      },
      series: [
        {
          type: 'bar',
          name: title,
          data: vals,
          barMaxWidth: 14,
        },
      ],
    };
  }, [tab, chartDataFull]);

  const skuMissingCnt = React.useMemo(() => rows.filter((r) => (r.to_buy || 0) > 0 && !r.lens_sku_id).length, [rows]);
  const anyToBuy = React.useMemo(() => rows.some((r) => (r.to_buy || 0) > 0), [rows]);

  const missingSkuSph = React.useMemo(() => {
    return rows
      .filter((r) => (r.to_buy || 0) > 0 && !r.lens_sku_id)
      .map((r) => normSph(r.sph))
      .filter((x) => Number.isFinite(x))
      .sort((a, b) => a - b);
  }, [rows, selectedRpc]);

  const missingSkuText = React.useMemo(() => missingSkuSph.map((s) => fmtSph(s)).join('\n'), [missingSkuSph]);

  const toBuyLines = React.useMemo(() => rows.filter((r) => (r.to_buy || 0) > 0), [rows]);
  const skuCoveredCnt = React.useMemo(() => toBuyLines.filter((r) => !!r.lens_sku_id).length, [toBuyLines]);
  const skuCoverageLabel = React.useMemo(
    () => `${nf(skuCoveredCnt)}/${nf(toBuyLines.length)}`,
    [skuCoveredCnt, toBuyLines.length],
  );

  const createSummary = React.useMemo(() => {
    const lines = rows.filter((r) => (r.to_buy || 0) > 0);
    return {
      lines: lines.length,
      pcs: sumBy(lines, (r) => r.to_buy || 0),
    };
  }, [rows, selectedRpc]);

  const createDisabledReason = React.useMemo(() => {
    if (!selectedRpc) return 'Выбери семейство';
    if (!locationId) return 'Выбери локацию';
    if (loadingRows) return 'Идёт загрузка';
    if (!anyToBuy) return 'TO_BUY = 0';
    if (skuMissingCnt > 0) return `Нет SKU для ${skuMissingCnt} диоптрий`;
    return null;
  }, [selectedRpc, locationId, loadingRows, anyToBuy, skuMissingCnt]);

  const batchesFiltered = React.useMemo(() => {
    if (batchStatusFilter === 'all') return batches;
    return batches.filter((b) => String(b.status || '').toLowerCase() === batchStatusFilter);
  }, [batches, batchStatusFilter]);

  const uiBusy = loadingFamilies || loadingRows || loadingLocations;

  /* ===================== actions ===================== */

  async function smartRefresh() {
    void loadFamilies();
    void loadLocations();
    void loadProcRows();
    void loadBatches();
    void loadToBuyTotalsForFamilies();
  }

  async function copySelectedToClipboard() {
    const payload = table
      .filter((r) => (r.to_buy || 0) > 0)
      .map((r) => `${fmtSph(r.sph)}\t${r.to_buy}`)
      .join('\n');

    const title = selected ? `Линзы: ${selected}` : 'Линзы';
    const loc = selectedLocation?.name ? `Куда придёт: ${selectedLocation.name}` : '';
    const text =
      `${title}\n` +
      `${loc}\n` +
      `Расчёт: ${PLAN_DAYS} дней · Запас x${safetyFactor} · Мин/диоптрия ${minEach}\n` +
      `История: ${histDays} дней\n\n` +
      `SPH\tTO_BUY (pcs)\n` +
      payload +
      `\n`;

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }

  async function copyMissingSkuToClipboard() {
    const text = missingSkuText || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }

  async function autoCreateMissingSkuForSelected() {
    if (!selectedRpc) return;
    if (!missingSkuSph.length) return;

    setAutoFixingSku(true);
    setAutoFixSkuMsg(null);
    setErr(null);

    try {
      const sb = getBrowserSupabase();
      const fam = normalizeFamilyKey(selectedRpc);

      const { data: mapRows, error: me } = await sb.from('lens_family_map').select('coating,refractive_index').eq('family', fam);
      if (me) throw new Error(me.message);

      const combosRaw = Array.isArray(mapRows) ? mapRows : [];
      if (!combosRaw.length) throw new Error(`Нет записей в lens_family_map для family="${fam}"`);

      const comboKey = (c: any) => `${String(c.coating)}|${String(c.refractive_index)}`;
      const seen = new Set<string>();
      const combos = combosRaw.filter((c: any) => {
        const k = comboKey(c);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      const inserts: any[] = [];

      for (const row of combos) {
        const coating = row.coating;
        const refractive_index = Number(row.refractive_index);

        if (!coating || !Number.isFinite(refractive_index)) continue;

        const { data: ex, error: ee } = await sb
          .from('lens_skus')
          .select('sph')
          .eq('coating', coating as any)
          .eq('refractive_index', refractive_index as any)
          .eq('cyl', 0 as any)
          .in('sph', missingSkuSph as any);

        if (ee) throw new Error(ee.message);

        const existing = new Set<number>((ex || []).map((r: any) => normSph(Number(r.sph))).filter((n: any) => Number.isFinite(n)));

        for (const sph of missingSkuSph) {
          const n = normSph(Number(sph));
          if (!Number.isFinite(n)) continue;
          if (existing.has(n)) continue;

          inserts.push({
            coating,
            refractive_index,
            sph: n,
            cyl: 0,
          });
        }
      }

      if (!inserts.length) {
        setAutoFixSkuMsg('SKU уже существуют (для выбранных SPH). Обновляю расчёт…');
        await loadProcRows();
        void loadToBuyTotalsForFamilies();
        setAutoFixSkuMsg('Готово.');
        return;
      }

      const { error: ie } = await sb.from('lens_skus').insert(inserts as any);
      if (ie) throw new Error(ie.message);

      setAutoFixSkuMsg(`Создано SKU: ${inserts.length}. Обновляю расчёт…`);

      await loadProcRows();
      void loadToBuyTotalsForFamilies();

      setAutoFixSkuMsg(`Создано SKU: ${inserts.length}. Готово.`);
    } catch (e: any) {
      setErr(
        prettifyRpcError(e) +
          `\n\nЕсли вставка запрещена RLS, сделай это через SQL Editor (как мы делали ранее) или разреши insert для owner.`,
      );
    } finally {
      setAutoFixingSku(false);
    }
  }

  // ================= Excel export (FIXED: apply family SPH limits everywhere) =================

  async function exportExcelFromRowsSingle(famRpc: string, rr: ProcRow[], fileSuffix?: string) {
    setErr(null);

    let XLSX: XLSXStyleModule | null = null;
    try {
      XLSX = (await import('xlsx-js-style')) as any;
    } catch {
      setErr(
        `Для цветного Excel нужен пакет "xlsx-js-style".\n` + `Установи: npm i xlsx-js-style\n\n` + `Если оставить обычный "xlsx" — файл будет без цветов.`,
      );
      return;
    }

    const wb = XLSX.utils.book_new();

    const exportDateISO = todayISO;
    const fileDate = todayISO.replaceAll('-', '.');
    const shipTo = shipToAddress.trim();

    const rpcFam = normalizeFamilyKey(famRpc);

    // ✅ 1) агрегация + сортировка
    const dataRows0 = aggregateBySph([...rr])
      .filter((x) => Number.isFinite(x.sph))
      .sort((a, b) => a.sph - b.sph);

    // ✅ 2) применяем лимиты SPH по семейству (как в UI)
    const lim = getSphLimitsForFamily(rpcFam);
    const dataRows = dataRows0.filter((r) => r.sph >= lim.min - 1e-9 && r.sph <= lim.max + 1e-9);

    // ✅ 3) в Excel показываем только строки, где реально есть TO_BUY
    const minus = dataRows.filter((r) => r.sph < 0 && (r.to_buy || 0) > 0).sort((a, b) => b.sph - a.sph);
    const plus = dataRows.filter((r) => r.sph >= 0 && (r.to_buy || 0) > 0).sort((a, b) => a.sph - b.sph);

    const lensType = prettyLensFamilyName(rpcFam);
    const blueBlock = isBlueBlockFamily(rpcFam);

    const aoa: any[][] = [];

    aoa.push([BRAND_NAME, '', '', '', '']);
    aoa.push(['LENS SALES ORDER', '', '', '', `Export date: ${exportDateISO}`]);

    aoa.push(['Lens type:', blueBlock ? `${lensType} (BlueBlock)` : lensType, '', '', '']);
    aoa.push(['Ship-to address:', shipTo || '—', '', '', '']);
    aoa.push(['', '', '', '', '']);
    aoa.push(['', '', '', '', '']);

    aoa.push([
      blueBlock ? 'SPH (−) BlueBlock' : 'SPH (−)',
      'QTY (pcs)',
      '',
      blueBlock ? 'SPH (+) BlueBlock' : 'SPH (+)',
      'QTY (pcs)',
    ]);

    const maxLen = Math.max(minus.length, plus.length);

    for (let i = 0; i < maxLen; i++) {
      const m = minus[i];
      const p = plus[i];

      // ✅ qty в Excel лучше как число -> округлим
      const mQty = m ? Math.round(Number(m.to_buy) || 0) : '';
      const pQty = p ? Math.round(Number(p.to_buy) || 0) : '';

      aoa.push([m ? fmtSph(m.sph) : '', m ? mQty : '', '', p ? fmtSph(p.sph) : '', p ? pQty : '']);
    }

    aoa.push(['', '', '', '', '']);
    const totalMinus = minus.reduce((a, r) => a + (Number(r.to_buy) || 0), 0);
    const totalPlus = plus.reduce((a, r) => a + (Number(r.to_buy) || 0), 0);
    aoa.push(['Total (−) (pcs)', Math.round(totalMinus), '', 'Total (+) (pcs)', Math.round(totalPlus)]);
    aoa.push(['Grand Total (pcs)', Math.round(totalMinus + totalPlus), '', '', '']);

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    const headerRow = 7;
    const dataEndRow = maxLen > 0 ? headerRow + maxLen : headerRow;
    const blankAfterDataRow = dataEndRow + 1;
    const totalRow = dataEndRow + 2;
    const grandRow = dataEndRow + 3;
    const lastRow = grandRow;

    ws['!ref'] = `A1:E${lastRow}`;
    ws['!cols'] = [{ wch: 20 }, { wch: 16 }, { wch: 3 }, { wch: 20 }, { wch: 26 }];

    const rowsHeights: any[] = [];
    rowsHeights[0] = { hpt: 28 };
    rowsHeights[1] = { hpt: 24 };
    rowsHeights[2] = { hpt: 18 };
    rowsHeights[3] = { hpt: 54 };
    rowsHeights[4] = { hpt: 10 };
    rowsHeights[5] = { hpt: 20 };
    for (let r = headerRow + 1; r <= dataEndRow; r++) rowsHeights[r - 1] = { hpt: 18 };
    rowsHeights[blankAfterDataRow - 1] = { hpt: 10 };
    rowsHeights[totalRow - 1] = { hpt: 20 };
    rowsHeights[grandRow - 1] = { hpt: 22 };
    ws['!rows'] = rowsHeights;

    addMerge(ws, 1, 1, 1, 5);
    addMerge(ws, 2, 1, 2, 4);
    addMerge(ws, 3, 2, 3, 5);
    addMerge(ws, 4, 2, 5, 5);
    addMerge(ws, grandRow, 1, grandRow, 4);

    try {
      applyRefocusExcelStyle(ws, {
        lastRow,
        dataEndRow: maxLen > 0 ? dataEndRow : 0,
        totalRow,
        grandRow,
      });
    } catch {
      // ignore
    }

    const sheetName = safeSheetName(lensType);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    const wbout = XLSX.write(wb, {
      bookType: 'xlsx',
      type: 'array',
      cellStyles: true,
      sheetStubs: true,
    });

    const blob = new Blob([wbout], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);

    const suffix = fileSuffix ? `_${fileSuffix}` : '';
    a.download = `Refocus_Lenses_${safeSheetName(lensType)}${suffix}_${fileDate}.xlsx`;

    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  async function exportExcelInternal(familyList: string[]) {
    setErr(null);

    let XLSX: XLSXStyleModule | null = null;
    try {
      XLSX = (await import('xlsx-js-style')) as any;
    } catch {
      setErr(
        `Для цветного Excel нужен пакет "xlsx-js-style".\n` + `Установи: npm i xlsx-js-style\n\n` + `Если оставить обычный "xlsx" — файл будет без цветов.`,
      );
      return;
    }

    const sb = getBrowserSupabase();
    const wb = XLSX.utils.book_new();

    const exportDateISO = todayISO;
    const fileDate = todayISO.replaceAll('-', '.');
    const shipTo = shipToAddress.trim();

    for (const fam of familyList) {
      const rpcFam = normalizeFamilyKey(fam);

      const { data, error } = await sb.rpc(RPC_PROCUREMENT_FN, {
        p_lens_family: rpcFam,
        p_location_id: locationId,
        p_plan_days: PLAN_DAYS,
        p_safety: safetyFactor,
        p_min_each: minEach,
        p_apply_min_to_all: applyMinToAll,
      });

      if (error) {
        setErr(prettifyRpcError(error));
        continue;
      }

      const rrRaw: ProcRow[] = Array.isArray(data)
        ? data
            .map((r: any) => {
              const sph = normSph(pickSph(r));
              return {
                sph,
                hist_qty: pickHistQty(r),
                hist_days: pickHistDays(r),
                daily_avg: pickDailyAvg(r),
                plan_qty: pickPlanQty(r),
                on_hand: pickOnHand(r),
                in_transit: pickInTransit(r),
                to_buy: pickToBuy(r),
                lens_sku_id: pickSkuId(r),
              };
            })
            .filter((x) => Number.isFinite(x.sph))
        : [];

      const rrAgg = aggregateBySph(rrRaw);
      const rrAdj = applyMinEachClient(rrAgg, minEach, applyMinToAll);

      // ✅ apply SPH limits in exportAll too (same as UI)
      const lim = getSphLimitsForFamily(rpcFam);
      const rr = rrAdj.filter((r) => r.sph >= lim.min - 1e-9 && r.sph <= lim.max + 1e-9);

      const minus = rr.filter((r) => r.sph < 0 && (r.to_buy || 0) > 0).sort((a, b) => b.sph - a.sph);
      const plus = rr.filter((r) => r.sph >= 0 && (r.to_buy || 0) > 0).sort((a, b) => a.sph - b.sph);

      const lensType = prettyLensFamilyName(rpcFam);
      const blueBlock = isBlueBlockFamily(rpcFam);

      const aoa: any[][] = [];

      aoa.push([BRAND_NAME, '', '', '', '']);
      aoa.push(['LENS SALES ORDER', '', '', '', `Export date: ${exportDateISO}`]);

      aoa.push(['Lens type:', blueBlock ? `${lensType} (BlueBlock)` : lensType, '', '', '']);
      aoa.push(['Ship-to address:', shipTo || '—', '', '', '']);
      aoa.push(['', '', '', '', '']);
      aoa.push(['', '', '', '', '']);

      aoa.push([
        blueBlock ? 'SPH (−) BlueBlock' : 'SPH (−)',
        'QTY (pcs)',
        '',
        blueBlock ? 'SPH (+) BlueBlock' : 'SPH (+)',
        'QTY (pcs)',
      ]);

      const maxLen = Math.max(minus.length, plus.length);

      for (let i = 0; i < maxLen; i++) {
        const m = minus[i];
        const p = plus[i];

        const mQty = m ? Math.round(Number(m.to_buy) || 0) : '';
        const pQty = p ? Math.round(Number(p.to_buy) || 0) : '';

        aoa.push([m ? fmtSph(m.sph) : '', m ? mQty : '', '', p ? fmtSph(p.sph) : '', p ? pQty : '']);
      }

      aoa.push(['', '', '', '', '']);
      const totalMinus = minus.reduce((a, r) => a + (Number(r.to_buy) || 0), 0);
      const totalPlus = plus.reduce((a, r) => a + (Number(r.to_buy) || 0), 0);
      aoa.push(['Total (−)', Math.round(totalMinus), '', 'Total (+)', Math.round(totalPlus)]);
      aoa.push(['Grand Total (pcs)', Math.round(totalMinus + totalPlus), '', '', '']);

      const ws = XLSX.utils.aoa_to_sheet(aoa);

      const headerRow = 7;
      const dataEndRow = maxLen > 0 ? headerRow + maxLen : headerRow;
      const totalRow = dataEndRow + 2;
      const grandRow = dataEndRow + 3;
      const lastRow = grandRow;

      ws['!ref'] = `A1:E${lastRow}`;
      ws['!cols'] = [{ wch: 20 }, { wch: 16 }, { wch: 3 }, { wch: 20 }, { wch: 26 }];

      addMerge(ws, 1, 1, 1, 5);
      addMerge(ws, 2, 1, 2, 4);
      addMerge(ws, 3, 2, 3, 5);
      addMerge(ws, 4, 2, 5, 5);
      addMerge(ws, grandRow, 1, grandRow, 4);

      try {
        applyRefocusExcelStyle(ws, {
          lastRow,
          dataEndRow: maxLen > 0 ? dataEndRow : 0,
          totalRow,
          grandRow,
        });
      } catch {
        // ignore
      }

      const sheetName = safeSheetName(lensType);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    const wbout = XLSX.write(wb, {
      bookType: 'xlsx',
      type: 'array',
      cellStyles: true,
      sheetStubs: true,
    });

    const blob = new Blob([wbout], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download =
      familyList.length === 1
        ? `Refocus_Lenses_${safeSheetName(prettyLensFamilyName(normalizeFamilyKey(familyList[0])))}_${fileDate}.xlsx`
        : `Refocus_Lenses_${fileDate}.xlsx`;

    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  async function exportExcelSelected() {
    if (!selectedRpc) return;
    if (loadingRows) return;

    // rows уже отфильтрованы по лимитам в loadProcRows, но exportExcelFromRowsSingle тоже повторно страхует
    await exportExcelFromRowsSingle(selectedRpc, rows);
  }

  async function exportExcelAll() {
    // families уже отфильтрованы allowlist'ом
    await exportExcelInternal(families.map((f) => f.rpc_family));
  }

  async function createBatchFromToBuy() {
    if (!selectedRpc || !locationId) return;
    if (loadingRows) return;

    if (skuMissingCnt > 0) {
      setErr(`Есть ${skuMissingCnt} строк(и) TO_BUY без SKU.\n` + `Нажми “Автосоздать SKU (cyl=0)” или создай SKU через SQL Editor.`);
      return;
    }

    if (!anyToBuy) {
      setErr('Нет строк TO_BUY > 0.');
      return;
    }

    setCreatingBatch(true);
    setErr(null);

    try {
      const sb = getBrowserSupabase();
      const { data, error } = await sb.rpc(RPC_CREATE_BATCH_FN, {
        p_lens_family: selectedRpc,
        p_to_location_id: locationId,
        p_plan_days: PLAN_DAYS,
        p_safety: safetyFactor,
        p_min_each: minEach,
        p_apply_min_to_all: applyMinToAll,
        p_comment: createComment?.trim() ? createComment.trim() : null,
      });

      if (error) throw new Error(error.message);

      console.log('Created batch id:', data);

      setCreateComment('');
      setCreateExtraOpen(false);
      setCreateOpen(false);
      await loadBatches();
      await loadProcRows();
      void loadToBuyTotalsForFamilies();
    } catch (e: any) {
      setErr(prettifyRpcError(e));
    } finally {
      setCreatingBatch(false);
    }
  }

  function openCommentModal(batchId: string, action: 'ordered' | 'received') {
    const b = batches.find((x) => x.id === batchId);
    setCommentBatchId(batchId);
    setCommentAction(action);
    setCommentText(b?.comment ?? '');
    setCommentOpen(true);
  }

  async function confirmCommentModal() {
    const batchId = commentBatchId;
    const comment = commentText?.trim() ? commentText.trim() : null;

    setBusyBatchId(batchId);
    setErr(null);

    try {
      const sb = getBrowserSupabase();

      if (commentAction === 'ordered') {
        const { error } = await sb.rpc(RPC_MARK_ORDERED_FN, { p_batch_id: batchId, p_comment: comment });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await sb.rpc(RPC_MARK_RECEIVED_FN, { p_batch_id: batchId, p_comment: comment });
        if (error) throw new Error(error.message);
      }

      setCommentOpen(false);
      setCommentBatchId('');
      setCommentText('');
      await loadBatches();
      await loadProcRows();
      void loadToBuyTotalsForFamilies();
    } catch (e: any) {
      setErr(prettifyRpcError(e));
    } finally {
      setBusyBatchId('');
    }
  }

  async function exportExcelForBatch(batchId: string) {
    setErr(null);
    try {
      const sb = getBrowserSupabase();

      const { data: it, error: ite } = await sb.from('lens_purchase_batch_items').select('lens_sku_id,qty').eq('batch_id', batchId);
      if (ite) throw new Error(ite.message);

      const items = Array.isArray(it) ? it : [];
      const skuIds = items
        .map((x: any) => x?.lens_sku_id)
        .filter(Boolean)
        .map((x: any) => String(x));

      if (!skuIds.length) {
        setErr('В партии нет строк или нет lens_sku_id.');
        return;
      }

      const { data: skus, error: ske } = await sb.from('lens_skus').select('id,sph').in('id', skuIds);
      if (ske) throw new Error(ske.message);

      const sphBySku = new Map<string, number>();
      (skus || []).forEach((r: any) => {
        const id = String(r.id);
        const sph = normSph(Number(r.sph));
        if (Number.isFinite(sph)) sphBySku.set(id, sph);
      });

      const bySph = new Map<number, number>();
      for (const x of items) {
        const sku = String(x.lens_sku_id || '');
        const qty = Number(x.qty) || 0;
        const sph = sphBySku.get(sku);
        if (!Number.isFinite(sph as any)) continue;
        bySph.set(sph as number, (bySph.get(sph as number) ?? 0) + qty);
      }

      if (!bySph.size) {
        setErr('Не смог сопоставить SPH для SKU партии (проверь lens_skus.sph).');
        return;
      }

      const rr: ProcRow[] = Array.from(bySph.entries())
        .map(([sph, qty]) => ({
          sph: normSph(sph),
          hist_qty: 0,
          hist_days: histDays,
          daily_avg: null,
          plan_qty: 0,
          on_hand: 0,
          in_transit: 0,
          to_buy: qty,
          lens_sku_id: 'batch',
        }))
        .filter((x) => Number.isFinite(x.sph))
        .sort((a, b) => a.sph - b.sph);

      await exportExcelFromRowsSingle(selectedRpc || 'Lenses', rr, `BATCH_${batchId.slice(0, 6)}`);
    } catch (e: any) {
      setErr(prettifyRpcError(e));
    }
  }

  // ✅ delete batch (hard)
  function openDeleteModal(batchId: string) {
    setDeleteBatchId(batchId);
    setDeleteTyped('');
    setDeleteAlsoLots(true);
    setDeleteOpen(true);
  }

  async function confirmDeleteBatch() {
    if (!deleteBatchId) return;

    if (deleteTyped.trim() !== 'DELETE') {
      setErr('Для удаления введи подтверждение: DELETE');
      return;
    }

    setDeletingBatch(true);
    setBusyBatchId(deleteBatchId);
    setErr(null);

    try {
      const sb = getBrowserSupabase();
      const { error } = await sb.rpc(RPC_DELETE_BATCH_HARD_FN, {
        p_batch_id: deleteBatchId,
        p_delete_lots: deleteAlsoLots,
        p_confirm: 'DELETE',
      });

      if (error) throw new Error(error.message);

      setDeleteOpen(false);
      setDeleteBatchId('');
      setDeleteTyped('');

      await loadBatches();
      await loadProcRows();
      void loadToBuyTotalsForFamilies();
    } catch (e: any) {
      setErr(prettifyRpcError(e));
    } finally {
      setDeletingBatch(false);
      setBusyBatchId('');
    }
  }

  // ✅ clear stock (hard) for current location
  function openClearStockModal() {
    setClearStockTyped('');
    setClearStockOpen(true);
  }

  async function confirmClearStock() {
    if (!locationId) {
      setErr('Не выбрана локация.');
      return;
    }
    if (clearStockTyped.trim() !== 'DELETE') {
      setErr('Для очистки склада введи подтверждение: DELETE');
      return;
    }

    setClearingStock(true);
    setErr(null);

    try {
      const sb = getBrowserSupabase();

      const { error } = await sb.rpc(RPC_CLEAR_STOCK_HARD_FN, {
        p_location_id: locationId,
        p_confirm: 'DELETE',
      });

      if (error) throw new Error(error.message);

      setClearStockOpen(false);
      setClearStockTyped('');

      await loadProcRows();
      await loadBatches();
      void loadToBuyTotalsForFamilies();
    } catch (e: any) {
      setErr(prettifyRpcError(e));
    } finally {
      setClearingStock(false);
    }
  }

  /* ===================== render ===================== */

  if (!mounted || gate === 'pending') {
    return (
      <div className="min-h-[100dvh] bg-transparent px-5 pt-8 pb-10">
        <div className="mx-auto max-w-7xl">
          <LightCard title={<span>Проверяю доступ…</span>}>
            <div className="text-sm text-slate-600">Загрузка…</div>
          </LightCard>
        </div>
      </div>
    );
  }

  if (gate === 'denied') {
    return (
      <div className="min-h-[100dvh] bg-transparent px-5 pt-8 pb-10">
        <div className="mx-auto max-w-7xl">
          <LightCard title={<span>Закуп линз</span>}>
            <div className="inline-flex items-start gap-2 rounded-2xl bg-rose-500/10 px-4 py-3 ring-1 ring-rose-300/40">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-rose-500" />
              <div className="text-sm text-rose-700">Доступ только владельцу.</div>
            </div>
          </LightCard>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-transparent px-5 pt-8 pb-10">
      <div className="mx-auto w-full max-w-7xl">
        {/* Header */}
        <LightCard
          title={
            <span className="inline-flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 shadow-[0_0_30px_rgba(34,211,238,0.35)]">
                <Store className="h-5 w-5 text-white" />
              </span>
              <span className="text-[18px] sm:text-[20px] font-semibold text-slate-900">Закуп линз</span>
            </span>
          }
          aside={
            <span className="text-[11px] text-slate-500">
              Период расчёта: <span className="font-medium text-slate-700">{PLAN_DAYS} д.</span> · История:{' '}
              <span className="font-medium text-slate-700">{histDays} д.</span>
            </span>
          }
        >
          <div className="grid gap-3 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-8 grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-1">
                <Label>Локация назначения</Label>
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className={[
                    'w-full rounded-[14px] bg-white/90 px-3 py-2 text-sm text-slate-900',
                    'ring-1 ring-sky-200/80',
                    'shadow-[0_18px_45px_rgba(15,23,42,0.12)]',
                    'focus:outline-none focus:ring-2 focus:ring-cyan-400/80',
                  ].join(' ')}
                >
                  {loadingLocations && <option>Загрузка…</option>}
                  {!loadingLocations &&
                    locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({locationKindLabel(l)})
                      </option>
                    ))}
                </select>
                {selectedLocation?.name && (
                  <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500">
                    <MapPin className="h-3.5 w-3.5" />
                    <span className="truncate max-w-[320px]">
                      Назначение:{' '}
                      <span className="font-medium text-slate-700">
                        {selectedLocation.name} · {locationKindLabel(selectedLocation)}
                      </span>
                    </span>
                  </div>
                )}
              </div>

              <div>
                <Label>Запас (коэфф.)</Label>
                <input
                  type="number"
                  step="0.05"
                  min="1"
                  value={safetyFactor}
                  onChange={(e) => setSafetyFactor(Number(e.target.value || 1))}
                  className={[
                    'w-full rounded-[14px] bg-white/90 px-3 py-2 text-sm text-slate-900',
                    'ring-1 ring-sky-200/80',
                    'shadow-[0_18px_45px_rgba(15,23,42,0.12)]',
                    'focus:outline-none focus:ring-2 focus:ring-cyan-400/80',
                  ].join(' ')}
                />
              </div>

              <div>
                <Label>Мин/диоптрия</Label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={minEach}
                  onChange={(e) => setMinEach(Math.max(0, Math.floor(Number(e.target.value || 0))))}
                  className={[
                    'w-full rounded-[14px] bg-white/90 px-3 py-2 text-sm text-slate-900',
                    'ring-1 ring-sky-200/80',
                    'shadow-[0_18px_45px_rgba(15,23,42,0.12)]',
                    'focus:outline-none focus:ring-2 focus:ring-cyan-400/80',
                  ].join(' ')}
                />
              </div>
            </div>

            <div className="lg:col-span-4 flex flex-wrap items-center justify-end gap-2">
              <SoftGhostButton onClick={smartRefresh} disabled={uiBusy} className="min-w-[120px]">
                <RefreshCw className="h-4 w-4" />
                {uiBusy ? 'Обновляю…' : 'Обновить'}
              </SoftGhostButton>

              <SoftPrimaryButton onClick={exportExcelAll} disabled={!families.length || !locationId || uiBusy}>
                <Download className="h-4 w-4" />
                Excel (всё)
              </SoftPrimaryButton>
            </div>
          </div>

          {/* режим минимума + тоталы */}
          <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="flex flex-wrap gap-2">
              <SoftPrimaryButton onClick={() => setApplyMinToAll(true)} className={applyMinToAll ? '' : 'opacity-70'}>
                Мин. ко всем
              </SoftPrimaryButton>
              <SoftGhostButton onClick={() => setApplyMinToAll(false)} className={!applyMinToAll ? '' : 'opacity-80'}>
                Мин. только при спросе
              </SoftGhostButton>
            </div>

            <div className="lg:ml-auto flex flex-wrap gap-2">
              <div className="rounded-2xl bg-slate-900/5 px-3 py-2 text-[12px] ring-1 ring-slate-200">
                Купить: <span className="font-semibold">{nf(totals.to_buy)}</span> шт
              </div>
              <div className="rounded-2xl bg-slate-900/5 px-3 py-2 text-[12px] ring-1 ring-slate-200">
                Склад: <span className="font-semibold">{nf(totals.on_hand)}</span> шт
              </div>
              <div className="rounded-2xl bg-slate-900/5 px-3 py-2 text-[12px] ring-1 ring-slate-200">
                В пути: <span className="font-semibold">{nf(totals.in_transit)}</span> шт
              </div>
            </div>
          </div>

          {/* компактная подсказка (сворачиваемая) */}
          <div className="mt-3 rounded-2xl bg-sky-500/5 ring-1 ring-sky-200/70">
            <button
              type="button"
              onClick={() => setInfoOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="inline-flex items-center gap-2 text-[12px] text-sky-900/80">
                <Info className="h-4 w-4 text-sky-700" />
                Формула и источник данных
              </span>
              {infoOpen ? <ChevronUp className="h-4 w-4 text-sky-700" /> : <ChevronDown className="h-4 w-4 text-sky-700" />}
            </button>

            {infoOpen && (
              <div className="px-4 pb-4 text-[12px] text-sky-900/80">
                <div className="leading-relaxed">
                  <b>TO_BUY = max(0, plan − on_hand − in_transit)</b>.
                  <br />
                  План строит RPC <b>{RPC_PROCUREMENT_FN}</b> по спросу за <b>{histDays}</b> дней с параметрами:
                  <b> {PLAN_DAYS}</b> дней, запас <b>x{safetyFactor}</b>, минимум <b>{minEach}</b>.
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label>Ship-to address (Excel)</Label>
                    <textarea
                      value={shipToAddress}
                      onChange={(e) => setShipToAddress(e.target.value)}
                      placeholder="Name / Code, phone, full address"
                      className={[
                        'min-h-[72px] w-full rounded-[14px] bg-white/90 px-3 py-2 text-sm text-slate-900',
                        'ring-1 ring-sky-200/80',
                        'shadow-[0_18px_45px_rgba(15,23,42,0.10)]',
                        'focus:outline-none focus:ring-2 focus:ring-cyan-400/80',
                      ].join(' ')}
                    />
                  </div>
                  <div className="text-[11px] text-slate-500 leading-relaxed">
                    Нормализация семейств:
                    <div className="mt-1">
                      <span className="font-medium text-slate-700">AR_PLUS/AR_MINUS → AR</span>
                      <br />
                      <span className="font-medium text-slate-700">WHITE [0–2.75] → WHITE</span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 text-[11px] text-slate-600">
                  Семейства на этой странице: <b>BB, AR, WHITE, CHAME*</b> + <b>PC 1.59 HMC</b> + <b>Myopia Control</b>.
                </div>
              </div>
            )}
          </div>

          {err && (
            <div className="mt-4 inline-flex items-start gap-2 rounded-2xl bg-rose-500/10 px-4 py-3 ring-1 ring-rose-300/40">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-rose-500" />
              <div className="text-sm text-rose-700 whitespace-pre-line">{err}</div>
            </div>
          )}
        </LightCard>

        {/* Master–detail */}
        <div className="mt-5 lg:flex lg:items-start lg:gap-4">
          {/* LEFT */}
          <LightCard
            className="w-full lg:w-[340px] lg:shrink-0 lg:sticky lg:top-5"
            title={<span>Виды линз</span>}
            aside={
              <span className="text-[11px]">
                {loadingToBuyTotals ? 'Считаю…' : 'Всего:'}{' '}
                <span className="font-medium text-slate-700">{nf(families.length)}</span>
              </span>
            }
          >
            <div className="mb-3">
              <Input value={q} onChange={setQ} placeholder="Поиск…" rightIcon={<Search className="h-4 w-4" />} />
            </div>

            <div className="overflow-auto pr-1 max-h-[calc(100dvh-220px)] space-y-2">
              {familiesFiltered.map((f) => {
                const active = f.rpc_family === selectedRpc;
                const k = lowerKey(f.rpc_family);
                const toBuy = toBuyTotals[k];

                return (
                  <button
                    key={f.rpc_family}
                    type="button"
                    onClick={() => {
                      setSelected(vendorFamilyLabel(f.rpc_family)); // UI label
                      setSelectedRpc(f.rpc_family); // canonical for RPC/DB
                      setTab('to_buy');
                    }}
                    className={[
                      'w-full rounded-2xl border px-3 py-2 text-left transition',
                      active ? 'border-cyan-300 bg-cyan-50/70 shadow-sm' : 'border-slate-200 bg-white/80 hover:bg-white',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{vendorFamilyLabel(f.rpc_family)}</div>
                        <div className="mt-0.5 text-[10px] text-slate-500 truncate">
                          История: <span className="font-medium text-slate-700">{nf(f.items_cnt)}</span>
                          {f.days_span != null ? (
                            <>
                              {' '}
                              · Дней: <span className="font-medium text-slate-700">{nf(Number(f.days_span))}</span>
                            </>
                          ) : null}
                          {f.source === 'db' && (
                            <span className="ml-2 rounded-full bg-slate-900/5 px-2 py-0.5 text-[10px] ring-1 ring-slate-200">
                              в базе
                            </span>
                          )}
                          {f.source === 'merged' && (
                            <span className="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] ring-1 ring-emerald-300/40 text-emerald-800">
                              база+история
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 rounded-xl bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-800 ring-1 ring-slate-200">
                        {toBuy === undefined && loadingToBuyTotals ? '…' : nf(Number(toBuy ?? 0))}
                      </div>
                    </div>
                  </button>
                );
              })}

              {!familiesFiltered.length && (
                <div className="rounded-2xl bg-slate-100/70 px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
                  Ничего не найдено.
                </div>
              )}
            </div>
          </LightCard>

          {/* RIGHT */}
          <div className="mt-4 lg:mt-0 flex-1 min-w-0 space-y-4">
            {/* Plan card */}
            <LightCard
              title={
                <span className="inline-flex items-center gap-2 min-w-0">
                  <BarChart3 className="h-4 w-4 text-slate-500" />
                  <span className="truncate">{selected ? `${selected} — склад / в пути / купить` : 'Выбери вид линз'}</span>
                </span>
              }
              aside={
                selectedMeta ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="hidden sm:inline text-slate-500">Период:</span>
                    <span className="font-medium text-slate-700">
                      {(selectedMeta.first_day ?? '—') + ' — ' + (selectedMeta.last_day ?? todayISO)}
                    </span>
                  </span>
                ) : (
                  <span />
                )
              }
            >
              {!selectedRpc ? (
                <div className="rounded-3xl bg-slate-100/70 px-5 py-8 text-center text-slate-700 ring-1 ring-slate-200">
                  Слева выбери вид линз.
                </div>
              ) : (
                <>
                  {/* Top bar: tabs + tools */}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-[11px] text-slate-500">
                      {tab === 'to_buy' && 'Топ по TO_BUY'}
                      {tab === 'stock' && 'Топ по складу'}
                      {tab === 'transit' && 'Топ по пути'}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {(
                        [
                          ['to_buy', 'Купить'],
                          ['stock', 'Склад'],
                          ['transit', 'В пути'],
                        ] as const
                      ).map(([k, label]) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setTab(k)}
                          className={[
                            'rounded-full px-3 py-1 text-xs font-semibold ring-1 transition whitespace-nowrap select-none',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80',
                            'active:scale-[0.98]',
                            tab === k
                              ? 'bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 text-white ring-cyan-200 shadow-[0_10px_30px_rgba(34,211,238,0.35)]'
                              : 'bg-white/90 text-slate-700 ring-slate-200 hover:bg-white hover:ring-slate-300',
                          ].join(' ')}
                        >
                          {label}
                        </button>
                      ))}

                      <div className="w-px h-6 bg-slate-200 mx-1 hidden sm:block" />

                      <SoftGhostButton onClick={copySelectedToClipboard} disabled={!rows.length || loadingRows} className="px-3 py-1.5 text-xs">
                        <Clipboard className="h-3.5 w-3.5" />
                        Копировать
                      </SoftGhostButton>

                      <SoftPrimaryButton onClick={exportExcelSelected} disabled={!rows.length || loadingRows} className="px-3 py-1.5 text-xs">
                        <Download className="h-3.5 w-3.5" />
                        Excel
                      </SoftPrimaryButton>
                    </div>
                  </div>

                  {/* Chart */}
                  <div className="mt-3 rounded-2xl bg-white/90 ring-1 ring-sky-200/70 shadow-[0_20px_60px_rgba(15,23,42,0.12)] p-2">
                    <div style={{ height: chartHeight }}>
                      <ReactECharts
                        key={chartKey}
                        option={optionFull}
                        notMerge={true}
                        lazyUpdate={true}
                        style={{ height: '100%', width: '100%' }}
                        opts={{ renderer: 'svg' }}
                      />
                    </div>
                  </div>

                  {/* Table */}
                  <div className="mt-4 overflow-auto max-h-[360px] rounded-2xl bg-white/90 ring-1 ring-sky-200/70 shadow-[0_20px_60px_rgba(15,23,42,0.12)]">
                    <table className="w-full text-[13px]">
                      <thead className="bg-slate-50 text-slate-600 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">SPH</th>
                          <th className="px-3 py-2 text-right font-medium">
                            {tab === 'to_buy' && 'Купить (шт)'}
                            {tab === 'stock' && 'Склад (шт)'}
                            {tab === 'transit' && 'В пути (шт)'}
                          </th>
                          <th className="px-3 py-2 text-right font-medium hidden sm:table-cell">Склад (шт)</th>
                          <th className="px-3 py-2 text-right font-medium hidden sm:table-cell">В пути (шт)</th>
                          <th className="px-3 py-2 text-right font-medium">TO_BUY (шт)</th>
                          <th className="px-3 py-2 text-right font-medium">Доля</th>
                        </tr>
                      </thead>
                      <tbody>
                        {table.map((r, idx) => (
                          <tr key={`${r.sph.toFixed(2)}:${idx}`} className="odd:bg-white even:bg-slate-50/40">
                            <td className="px-3 py-1.5 font-medium text-slate-900 whitespace-nowrap">
                              {fmtSph(r.sph)}
                              {!r.hasSku && (r.to_buy || 0) > 0 && (
                                <span className="ml-2 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-700 ring-1 ring-rose-300/40">
                                  нет SKU
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-right text-slate-900">{nf(r.v)}</td>
                            <td className="px-3 py-1.5 text-right text-slate-700 hidden sm:table-cell">{nf(r.on_hand)}</td>
                            <td className="px-3 py-1.5 text-right text-slate-700 hidden sm:table-cell">{nf(r.in_transit)}</td>
                            <td className="px-3 py-1.5 text-right text-slate-900 font-semibold">{nf(r.to_buy)}</td>
                            <td className="px-3 py-1.5 text-right text-slate-700">{Math.round((r.share || 0) * 100)}%</td>
                          </tr>
                        ))}

                        {loadingRows && (
                          <tr>
                            <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                              Загружаю…
                            </td>
                          </tr>
                        )}

                        {!loadingRows && rows.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                              Нет данных. Проверь RPC <span className="font-medium">{RPC_PROCUREMENT_FN}</span>.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-2 text-[11px] text-slate-500">
                    Экспорт/копирование формируют <span className="font-medium">TO_BUY</span>. Создание партии — в блоке ниже.
                  </div>
                </>
              )}
            </LightCard>

            {/* batches */}
            <LightCard
              title={
                <span className="inline-flex items-center gap-2 min-w-0">
                  <Package className="h-4 w-4 text-slate-500" />
                  <span className="truncate">
                    Партии закупа · <span className="font-semibold">{selectedLocation?.name ?? '—'}</span>
                  </span>
                </span>
              }
              aside={<span className="inline-flex items-center gap-2"><span className="text-slate-500">Последние 10</span></span>}
            >
              {/* header actions */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <SoftPrimaryButton onClick={() => setCreateOpen((v) => !v)} disabled={!selectedRpc || !locationId} className="px-3 py-1.5 text-xs">
                    <Plus className="h-3.5 w-3.5" />
                    Создать партию
                  </SoftPrimaryButton>

                  <SoftGhostButton onClick={() => void loadBatches()} disabled={loadingBatches} className="px-3 py-1.5 text-xs">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Обновить партии
                  </SoftGhostButton>
                </div>

                <button
                  type="button"
                  onClick={openClearStockModal}
                  disabled={!locationId || clearingStock}
                  className={[
                    'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ring-1 transition',
                    'bg-rose-600 text-white ring-rose-700 hover:opacity-95',
                    !locationId || clearingStock ? 'opacity-50 cursor-not-allowed' : '',
                  ].join(' ')}
                  title="Жёстко очистить склад по выбранной локации (удалит движения/остатки)"
                >
                  <Trash2 className="h-4 w-4" />
                  {clearingStock ? 'Очищаю склад…' : 'Очистить склад'}
                </button>

                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center gap-2 rounded-xl bg-white/80 px-3 py-2 ring-1 ring-slate-200 shadow-[0_12px_35px_rgba(15,23,42,0.10)]">
                    <Filter className="h-4 w-4 text-slate-500" />
                    <select
                      value={batchStatusFilter}
                      onChange={(e) => setBatchStatusFilter(e.target.value as any)}
                      className="bg-transparent text-sm text-slate-800 focus:outline-none"
                    >
                      <option value="all">Все</option>
                      <option value="draft">draft</option>
                      <option value="in_transit">in_transit</option>
                      <option value="received">received</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* ✅ create panel */}
              {createOpen && (
                <div className="mt-3 rounded-2xl bg-sky-500/5 ring-1 ring-sky-200/70 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] text-slate-700 font-semibold">Создание партии из TO_BUY</div>
                      <div className="mt-1 text-[11px] text-slate-600 whitespace-pre-line leading-relaxed">
                        Семейство: <b>{selectedRpc || '—'}</b>
                        {'\n'}
                        Локация: <b>{selectedLocation?.name || '—'}</b>
                        {'\n'}
                        Строк: <strong>{nf(createSummary.lines)}</strong> · Шт: <strong>{nf(createSummary.pcs)}</strong>
                        {'\n'}
                        Параметры: <b>{PLAN_DAYS}</b> д · запас <b>x{safetyFactor}</b> · мин/диоптрия <b>{minEach}</b> · режим{' '}
                        <b>{applyMinToAll ? 'мин. ко всем' : 'мин. только при спросе'}</b>
                      </div>

                      {createDisabledReason && (
                        <div className="mt-2 rounded-xl bg-rose-500/10 px-3 py-2 text-[11px] text-rose-700 ring-1 ring-rose-300/40">
                          Нельзя создать: <b>{createDisabledReason}</b>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 sm:w-[320px]">
                      <Label>Комментарий (необязательно)</Label>
                      <textarea
                        value={createComment}
                        onChange={(e) => setCreateComment(e.target.value)}
                        placeholder="Taobao # / продавец / ссылка / примечание…"
                        className={[
                          'min-h-[84px] w-full rounded-2xl bg-white px-3 py-2 text-sm text-slate-900',
                          'ring-1 ring-sky-200/80 shadow-[0_18px_45px_rgba(15,23,42,0.10)]',
                          'focus:outline-none focus:ring-2 focus:ring-cyan-400/80',
                        ].join(' ')}
                      />

                      <div className="flex items-center justify-end gap-2">
                        <SoftGhostButton
                          onClick={() => {
                            setCreateOpen(false);
                            setCreateComment('');
                            setCreateExtraOpen(false);
                          }}
                          disabled={creatingBatch}
                        >
                          Закрыть
                        </SoftGhostButton>

                        <SoftPrimaryButton onClick={createBatchFromToBuy} disabled={creatingBatch || !!createDisabledReason}>
                          {creatingBatch ? 'Создаю…' : 'Создать'}
                        </SoftPrimaryButton>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* list */}
              <div className="mt-3 space-y-2">
                {batchesFiltered.map((b) => {
                  const isBusy = busyBatchId === b.id;

                  return (
                    <div key={b.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-slate-900">{new Date(b.created_at).toLocaleString('ru-RU')}</div>
                            <StatusPill status={b.status} />
                            <div className="text-[11px] text-slate-500">
                              Строк: <span className="font-medium text-slate-700">{nf(b.items_cnt ?? 0)}</span> · Шт:{' '}
                              <span className="font-medium text-slate-700">{nf(b.qty_total ?? 0)}</span>
                            </div>
                          </div>

                          <div className="mt-1 text-[11px] text-slate-500">
                            {b.ordered_at ? `В пути: ${new Date(b.ordered_at).toLocaleDateString('ru-RU')}` : 'В пути: —'}
                            {' · '}
                            {b.received_at ? `Прибыло: ${new Date(b.received_at).toLocaleDateString('ru-RU')}` : 'Прибыло: —'}
                          </div>

                          {b.comment && (
                            <div className="mt-2 rounded-2xl bg-slate-900/5 px-3 py-2 text-[12px] text-slate-700 ring-1 ring-slate-200 break-words">
                              <span className="font-medium">Комментарий:</span> {b.comment}
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {/* draft -> in_transit */}
                          <button
                            type="button"
                            className={[
                              'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ring-1 transition',
                              'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50',
                              isBusy || b.status !== 'draft' ? 'opacity-50 cursor-not-allowed' : '',
                            ].join(' ')}
                            disabled={isBusy || b.status !== 'draft'}
                            onClick={() => openCommentModal(b.id, 'ordered')}
                            title="Перевести партию в статус in_transit"
                          >
                            <Truck className="h-4 w-4" />
                            В пути
                          </button>

                          {/* in_transit -> received */}
                          <button
                            type="button"
                            className={[
                              'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ring-1 transition',
                              'bg-slate-900 text-white ring-slate-900 hover:opacity-95',
                              isBusy || b.status !== 'in_transit' ? 'opacity-50 cursor-not-allowed' : '',
                            ].join(' ')}
                            disabled={isBusy || b.status !== 'in_transit'}
                            onClick={() => openCommentModal(b.id, 'received')}
                            title="Перевести партию в статус received"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Прибыло
                          </button>

                          <SoftGhostButton
                            onClick={() => void exportExcelForBatch(b.id)}
                            disabled={!selectedRpc}
                            className="px-3 py-2 text-xs"
                            title="Экспортирует содержимое партии (агрегация по SPH из lens_skus)"
                          >
                            <FileSpreadsheet className="h-4 w-4" />
                            Excel по партии
                          </SoftGhostButton>

                          {/* ✅ delete */}
                          <button
                            type="button"
                            className={[
                              'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ring-1 transition',
                              'bg-rose-600 text-white ring-rose-700 hover:opacity-95',
                              isBusy ? 'opacity-50 cursor-not-allowed' : '',
                            ].join(' ')}
                            disabled={isBusy}
                            onClick={() => openDeleteModal(b.id)}
                            title="Удалить партию (тест/отмена): обнулит in_transit, и при включении — почистит lens_lots по comment"
                          >
                            <Trash2 className="h-4 w-4" />
                            Удалить
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {!loadingBatches && !batchesFiltered.length && (
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200">
                    Пока нет партий по этому семейству и локации (или фильтр скрывает).
                  </div>
                )}
              </div>
            </LightCard>
          </div>
        </div>
      </div>

      {/* comment modal */}
      <Modal
        open={commentOpen}
        title={
          <span className="inline-flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-slate-500" />
            {commentAction === 'ordered' ? 'Отметить “В пути”' : 'Отметить “Прибыло”'}
          </span>
        }
        onClose={() => {
          setCommentOpen(false);
          setCommentBatchId('');
          setCommentText('');
        }}
        footer={
          <>
            <SoftGhostButton
              onClick={() => {
                setCommentOpen(false);
                setCommentBatchId('');
                setCommentText('');
              }}
            >
              Отмена
            </SoftGhostButton>
            <SoftPrimaryButton onClick={confirmCommentModal} disabled={!commentBatchId || busyBatchId === commentBatchId}>
              {busyBatchId === commentBatchId ? 'Сохраняю…' : 'Подтвердить'}
            </SoftPrimaryButton>
          </>
        }
      >
        <div className="text-[12px] text-slate-600">Комментарий необязательный: трек-номер, продавец, номер заказа, ссылка, примечания.</div>
        <div className="mt-3">
          <Label>Комментарий</Label>
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Tracking / Taobao #… / Продавец…"
            className={[
              'min-h-[110px] w-full rounded-2xl bg-white px-3 py-2 text-sm text-slate-900',
              'ring-1 ring-sky-200/80 shadow-[0_18px_45px_rgba(15,23,42,0.12)]',
              'focus:outline-none focus:ring-2 focus:ring-cyan-400/80',
            ].join(' ')}
          />
        </div>
      </Modal>

      {/* ✅ delete modal */}
      <Modal
        open={deleteOpen}
        title={
          <span className="inline-flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-rose-600" />
            Удалить партию
          </span>
        }
        onClose={() => {
          setDeleteOpen(false);
          setDeleteBatchId('');
          setDeleteTyped('');
        }}
        footer={
          <>
            <SoftGhostButton
              onClick={() => {
                setDeleteOpen(false);
                setDeleteBatchId('');
                setDeleteTyped('');
              }}
            >
              Отмена
            </SoftGhostButton>
            <button
              type="button"
              onClick={confirmDeleteBatch}
              disabled={deletingBatch || deleteTyped.trim() !== 'DELETE' || !deleteBatchId}
              className={[
                'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white',
                'bg-rose-600 ring-1 ring-rose-700 hover:opacity-95',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              ].join(' ')}
            >
              <Trash2 className="h-4 w-4" />
              {deletingBatch ? 'Удаляю…' : 'Удалить'}
            </button>
          </>
        }
      >
        <div className="rounded-2xl bg-rose-500/10 px-4 py-3 ring-1 ring-rose-300/40">
          <div className="text-[12px] text-rose-800 font-medium">Это жёсткое удаление. Используй только для тестов/отмен.</div>
          <div className="mt-1 text-[11px] text-rose-800/80 leading-relaxed">
            Удалит партию и её позиции. Если включено ниже — удалит также складские движения в <b>lens_lots</b>, где <b>comment</b> содержит uuid партии.
          </div>
        </div>

        <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={deleteAlsoLots} onChange={(e) => setDeleteAlsoLots(e.target.checked)} className="mt-1" />
            <span className="text-[12px] text-slate-700">
              Также удалить из <b>lens_lots</b> строки, где <b>comment</b> содержит id партии (обнуление склада)
            </span>
          </label>
        </div>

        <div className="mt-3">
          <Label>Подтверждение (введи DELETE)</Label>
          <Input value={deleteTyped} onChange={setDeleteTyped} placeholder="DELETE" />
          <div className="mt-2 text-[11px] text-slate-500">Без этого подтверждения удаление не выполнится.</div>
        </div>
      </Modal>

      {/* ✅ clear stock modal */}
      <Modal
        open={clearStockOpen}
        title={
          <span className="inline-flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-rose-600" />
            Очистить склад (жёстко)
          </span>
        }
        onClose={() => {
          setClearStockOpen(false);
          setClearStockTyped('');
        }}
        footer={
          <>
            <SoftGhostButton
              onClick={() => {
                setClearStockOpen(false);
                setClearStockTyped('');
              }}
              disabled={clearingStock}
            >
              Отмена
            </SoftGhostButton>

            <button
              type="button"
              onClick={confirmClearStock}
              disabled={clearingStock || clearStockTyped.trim() !== 'DELETE' || !locationId}
              className={[
                'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white',
                'bg-rose-600 ring-1 ring-rose-700 hover:opacity-95',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              ].join(' ')}
            >
              <Trash2 className="h-4 w-4" />
              {clearingStock ? 'Очищаю…' : 'Очистить'}
            </button>
          </>
        }
      >
        <div className="rounded-2xl bg-rose-500/10 px-4 py-3 ring-1 ring-rose-300/40">
          <div className="text-[12px] text-rose-800 font-medium">Это жёсткая очистка склада по выбранной локации.</div>
          <div className="mt-1 text-[11px] text-rose-800/80 leading-relaxed">
            Будут удалены складские движения/остатки (по реализации твоей RPC) для локации:
            <br />
            <b>{selectedLocation?.name ?? '—'}</b>
          </div>
        </div>

        <div className="mt-3">
          <Label>Подтверждение (введи DELETE)</Label>
          <Input value={clearStockTyped} onChange={setClearStockTyped} placeholder="DELETE" />
          <div className="mt-2 text-[11px] text-slate-500">Без этого подтверждения очистка не выполнится.</div>
        </div>
      </Modal>
    </div>
  );
}