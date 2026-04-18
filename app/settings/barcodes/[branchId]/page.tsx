'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import getSupabase from '@/lib/supabaseClient';
import { ArrowLeft, Barcode, Printer } from 'lucide-react';
import {
  BUCKET_STEP,
  COUNTRIES,
  computeBranchTotalCount,
  computeSectionPrices,
  computeSectionSlotCount,
  getBranchCountry,
  getBranchCurrency,
  getBranchCurrencySymbol,
  getBranchPremiumShare,
  getBranchTotalSlots,
  setBranchTotalSlots,
  getCityIndex,
  isBranchUsingFormula,
  type FrameTypeCode as FormulaFrameType,
  type GenderCode as FormulaGenderCode,
} from '@/lib/framePricingFormula';

/* ────────── корзины и настройки ────────── */

type BucketId = 1 | 2 | 3 | 4 | 5;

const BUCKETS = [
  { id: 1 as BucketId, name: 'Бюджет', min: 800, max: 1299 },
  { id: 2 as BucketId, name: 'Нижний средний', min: 1300, max: 1799 },
  { id: 3 as BucketId, name: 'Средний', min: 1800, max: 2499 },
  { id: 4 as BucketId, name: 'Верхний средний', min: 2500, max: 3499 },
  { id: 5 as BucketId, name: 'Премиум', min: 3500, max: 10000 },
] as const;

/** проценты по ценовым корзинам (по слотам): 16 / 38 / 28 / 12 / 6 */
const PCT = { b1: 16, b2: 38, b3: 28, b4: 12, b5: 6 } as const;

/**
 * Дефолтная ёмкость витрин по названию филиала — для legacy-логики
 * (филиалы без формулы: Кант, Сокулук, Беловодск, Кара-Балта).
 * Филиалы с формулой (Токмок и новые) — ёмкость берётся из BRANCH_TOTAL_SLOTS
 * в lib/framePricingFormula.ts.
 */
const BRANCH_CAPACITY: Record<string, number> = {
  Сокулук: 120,
  Беловодск: 100,
  'Кара-Балта': 168,
  Кант: 120,
};

/** Филиалы, где не используем автоматическую «допечатку по продажам» */
const BRANCHES_WITHOUT_AUTO_REPLENISH: string[] = ['Кант', 'Токмок'];

/* ────────── типы оправ и правила цен ────────── */

type FrameTypeCode = 'RP' | 'RM' | 'KD' | 'PA' | 'MA';
type GenderCode = 'F' | 'M';

type TypeKey = `${FrameTypeCode}_${GenderCode}`;

function makeTypeKey(type: FrameTypeCode, gender: GenderCode): TypeKey {
  return `${type}_${gender}`;
}

const FRAME_TYPES: { code: FrameTypeCode; label: string; description: string }[] = [
  { code: 'RP', label: 'Чтение · пластик', description: 'Женские, пластик, 800–2200' },
  { code: 'RM', label: 'Чтение · металл', description: 'Женские, металл, 1000–2400' },
  { code: 'KD', label: 'Детские', description: 'М/Ж, 800–3500' },
  { code: 'PA', label: 'Пластик (взрослый)', description: 'М/Ж, 1000–3200' },
  { code: 'MA', label: 'Металл (взрослый)', description: 'М/Ж, 1200–10000' },
];

/** Жёсткие границы цен по каждому типу */
const FRAME_TYPE_PRICE_RULES: Record<FrameTypeCode, { min: number; max: number }> = {
  RP: { min: 800, max: 2200 },
  RM: { min: 1000, max: 2400 },
  KD: { min: 800, max: 3500 },
  PA: { min: 1000, max: 3200 },
  MA: { min: 1200, max: 10000 },
};

/** Границы цен с учётом типа И пола (одна точка правды) */
function getTypePriceBounds(type: FrameTypeCode, gender: GenderCode): { min: number; max: number } {
  const base = FRAME_TYPE_PRICE_RULES[type];
  if (!base) return { min: 0, max: 0 };

  let { min, max } = base;

  if (type === 'RP') {
    min = 800;
    max = 2200;
  }
  if (type === 'RM') {
    min = 1000;
    max = 2400;
  }
  if (type === 'KD') {
    min = 800;
    max = 3500;
  }
  if (type === 'PA') {
    if (gender === 'F') {
      min = 1000;
      max = 3000;
    } else {
      min = 1200;
      max = 3200;
    }
  }
  if (type === 'MA') {
    if (gender === 'F') {
      min = 1200;
      max = 9000;
    } else {
      min = 1400;
      max = 10000;
    }
  }

  return { min, max };
}

/* ────────── лог ────────── */

function useLogger() {
  const [lines, setLines] = useState<string[]>([]);
  const log = useCallback((msg: string) => {
    const t = new Date().toLocaleTimeString();
    setLines((p) => [...p.slice(-400), `[${t}] ${msg}`]);
    console.log(msg);
  }, []);
  return { lines, log };
}

/* ────────── qz-tray ────────── */

function loadScript(src: string) {
  return new Promise<void>((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error(`Failed ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureQZLoaded(log: (m: string) => void) {
  if ((window as any).qz?.version) return (window as any).qz;
  const urls = [
    'https://localhost:8181/qz-tray.js',
    'https://localhost:8181/js/qz-tray.js',
    'http://localhost:8182/qz-tray.js',
    'http://localhost:8182/js/qz-tray.js',
    'https://cdn.jsdelivr.net/npm/qz-tray@2.2.5/qz-tray.js',
  ];
  for (const u of urls) {
    try {
      log(`Загружаю ${u}`);
      await loadScript(u);
      break;
    } catch (e: any) {
      log(String(e?.message || e));
    }
  }
  const qz = (window as any).qz;
  if (!qz?.version) throw new Error('qz-tray.js не загрузился');
  qz.api?.setPromiseType?.((resolver: any) => new Promise(resolver));
  return qz;
}

async function ensureQZSecurity() {
  const qz = (window as any).qz;
  if (!qz?.version) throw new Error('QZ не загружен');
  qz.security.setCertificatePromise((resolve: any, reject: any) => {
    fetch('/qz-public.pem').then((r) => r.text()).then(resolve).catch(reject);
  });
  qz.security.setSignatureAlgorithm('SHA512');
  qz.security.setSignaturePromise(async (toSign: string) => {
    const res = await fetch('/api/qz/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: toSign }),
    });
    const json = await res.json();
    if (!res.ok || !json?.signature) throw new Error(json?.error || 'sign failed');
    return json.signature;
  });
}

/* ────────── barcode inference (для диагностики "тип/пол читаются неверно") ────────── */

const KNOWN_TYPES: FrameTypeCode[] = ['RP', 'RM', 'KD', 'PA', 'MA'];

function inferFromBarcode(barcodeRaw: string): {
  branchCode: string;
  typeCode: FrameTypeCode;
  gender: GenderCode;
  year2: number;
  serial: number;
} | null {
  const barcode = String(barcodeRaw || '').trim().toUpperCase();
  // BR(2) + TYPE(2) + G(1) + YY(2) + SERIAL(3..5) — допускаем чуть гибче по хвосту
  const m = barcode.match(/^([A-Z]{2})([A-Z]{2})([FM])(\d{2})(\d{3,5})$/);
  if (!m) return null;
  const [, br, t, g, yy, ser] = m;
  if (!KNOWN_TYPES.includes(t as FrameTypeCode)) return null;
  const year2 = Number.parseInt(yy, 10);
  const serial = Number.parseInt(ser, 10);
  if (!Number.isFinite(year2) || !Number.isFinite(serial)) return null;
  return {
    branchCode: br,
    typeCode: t as FrameTypeCode,
    gender: g as GenderCode,
    year2,
    serial,
  };
}

/* ────────── цены ────────── */

const PRICE_ALPHA = 3.4;

function generatePriceLadder(count: number, minPrice: number, maxPrice: number, alpha = PRICE_ALPHA): number[] {
  if (count <= 0 || maxPrice <= minPrice) return [];
  const prices: number[] = [];

  for (let i = 1; i <= count; i++) {
    const q = (i - 0.5) / count;
    const raw = minPrice + (maxPrice - minPrice) * Math.pow(q, alpha);
    let p = 10 * Math.round(raw / 10);

    if (p < 3000 && p % 100 === 0) p += 10;
    if (p >= 3000) p = 100 * Math.round(p / 100);

    if (p < minPrice) p = minPrice;
    if (p > maxPrice) p = maxPrice;

    prices.push(p);
  }

  for (let i = 1; i < prices.length; i++) {
    if (prices[i] <= prices[i - 1]) {
      const prev = prices[i - 1];
      const step = prev >= 3000 ? 100 : 10;
      let next = prev + step;
      if (next > maxPrice) next = maxPrice;
      prices[i] = next;
    }
  }

  return prices;
}

const ENDINGS_BELOW_3000 = [10, 20, 30, 40, 50, 60, 70, 80, 90];

function takeEndingsPyramid(endings: number[], k: number): number[] {
  if (k >= endings.length) return [...endings];
  if (k <= 0) return [];
  const drop = endings.length - k;
  const left = Math.floor(drop / 2);
  const right = Math.ceil(drop / 2);
  return endings.slice(left, endings.length - right);
}

function generateOptionsForHundred(base: number, count: number, min: number, max: number): number[] {
  const hi = base + 99;

  if (hi < 3000) {
    const endings = takeEndingsPyramid(ENDINGS_BELOW_3000, count);
    const candidates = endings.map((e) => base + e);
    return candidates.filter((p) => p >= min && p <= max);
  }

  const price = base;
  if (price < min || price > max) return [];
  return [price];
}

function normalizeCountsToTarget(counts: number[], target: number, minPerSeg = 1): number[] {
  const out = counts.map((c) => Math.max(minPerSeg, Math.floor(c)));
  if (out.length === 0 || target <= 0) return new Array(counts.length).fill(0);
  let sum = out.reduce((a, c) => a + c, 0);
  const guard = 5000;
  let tick = 0;

  while (sum < target && tick++ < guard) {
    for (let i = 0; i < out.length && sum < target; i++) {
      out[i] += 1;
      sum += 1;
    }
  }
  while (sum > target && tick++ < guard) {
    let cut = false;
    for (let i = out.length - 1; i >= 0 && sum > target; i--) {
      if (out[i] > minPerSeg) {
        out[i] -= 1;
        sum -= 1;
        cut = true;
      }
    }
    if (!cut) break;
  }
  return out;
}

/* ────────── непрерывная «горка» по цене ────────── */

const GLOBAL_PRICE_MIN = BUCKETS[0].min;
const GLOBAL_PRICE_MAX = BUCKETS[BUCKETS.length - 1].max;
const GLOBAL_PRICE_SPAN = GLOBAL_PRICE_MAX - GLOBAL_PRICE_MIN;

function priceToRel(p: number): number {
  if (GLOBAL_PRICE_SPAN <= 0) return 0.5;
  const t = (p - GLOBAL_PRICE_MIN) / GLOBAL_PRICE_SPAN;
  return Math.min(1, Math.max(0, t));
}

function priceDensity01(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  const alpha = 3;
  const beta = 7;
  return Math.pow(t, alpha - 1) * Math.pow(1 - t, beta - 1);
}

function priceWeight(p: number): number {
  return priceDensity01(priceToRel(p));
}

/* ────────── геометрия/bitmap ────────── */

const DPI = 203;
const mmToDots = (mm: number) => Math.round((mm * DPI) / 25.4);
const LABEL_W_MM = 70;
const LABEL_H_MM = 12;

async function ensureCanvasFonts() {
  try {
    await (document as any).fonts?.ready?.catch?.(() => undefined);

    // Явно подгружаем Onest 400 через FontFace API с jsDelivr —
    // надёжнее любых @import / @fontsource, т.к. минует CSS-кэш браузера.
    if (!(window as any).__priceFontForCanvasLoaded) {
      try {
        const ff = new FontFace(
          'Onest',
          "url('https://cdn.jsdelivr.net/npm/@fontsource/onest@5/files/onest-cyrillic-400-normal.woff2') format('woff2'),url('https://cdn.jsdelivr.net/npm/@fontsource/onest@5/files/onest-latin-400-normal.woff2') format('woff2')",
          { weight: '400', style: 'normal' },
        );
        await ff.load();
        (document as any).fonts.add(ff);
        (window as any).__priceFontForCanvasLoaded = true;
        console.log('[pricelabel] Onest 400 loaded via FontFace API');
      } catch (e) {
        console.warn('[pricelabel] Onest FontFace load failed:', e);
      }
    }

    await Promise.all([
      (document as any).fonts.load('24px "pavelt-jrjpm"'),
      (document as any).fonts.load('400 46px "Onest"'),
    ]);

    // Диагностика: реально ли шрифт доступен canvas
    const ok = (document as any).fonts.check('400 46px "Onest"');
    console.log('[pricelabel] document.fonts.check("400 46px Onest") =', ok);
  } catch {
    /* ignore */
  }
}

function canvasToMonoBytes(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  threshold = 200,
  invert = true,
): Uint8Array {
  const src = ctx.getImageData(0, 0, w, h).data;
  const pitch = Math.ceil(w / 8);
  const bytes = new Uint8Array(pitch * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = src[idx];
      const g = src[idx + 1];
      const b = src[idx + 2];
      const a = src[idx + 3];
      const lum = a === 0 ? 255 : 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const bitRaw = lum < threshold ? 1 : 0;
      const bit = invert ? bitRaw ^ 1 : bitRaw;
      const byteIndex = y * pitch + (x >> 3);
      const shift = 7 - (x & 7);
      bytes[byteIndex] |= bit << shift;
    }
  }
  return bytes;
}

const ascii = (s: string) => new TextEncoder().encode(s);

const concatBytes = (...arrs: Uint8Array[]) => {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};

/* ────────── штрихкод ────────── */

const SERIAL_LEN = 4;
const DEFAULT_SERIAL = 1;

async function fetchDbNextSerial(
  branchId: number | null,
  typeCode: FrameTypeCode,
  gender: GenderCode,
  year: number,
): Promise<number> {
  if (!branchId) return DEFAULT_SERIAL;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('frame_barcodes')
    .select('serial')
    .eq('branch_id', branchId)
    .eq('type_code', typeCode)
    .eq('gender', gender)
    .eq('year', year)
    .order('serial', { ascending: false })
    .limit(1);

  if (error) throw error;

  const last = data?.[0]?.serial as number | null | undefined;
  return last && Number.isFinite(last) ? Number(last) + 1 : DEFAULT_SERIAL;
}

/* ────────── bitmap этикетки ────────── */

function buildBitmapJobBase64(priceText: string, barcode: string, currencySymbol: string = ''): string {
  const labelWmm = LABEL_W_MM;
  const labelHmm = LABEL_H_MM;
  const labelW = mmToDots(labelWmm);

  let blockW = Math.floor((labelW * 0.46) / 8) * 8;
  const blockH = 74;
  if (blockW < 160) blockW = 160;

  const cvs = document.createElement('canvas');
  cvs.width = blockW;
  cvs.height = blockH;
  const ctx = cvs.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, blockW, blockH);

  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';

  // Логотип — фирменный шрифт Refocus (pavelt-jrjpm)
  const LOGO_X = 3;
  ctx.font = '24px "pavelt-jrjpm"';
  const logoWidth = ctx.measureText('Refocus').width;
  ctx.fillText('Refocus', LOGO_X, 0);
  const logoCenterX = LOGO_X + logoWidth / 2;

  // Цена — Onest 400 Regular. Центрируется ПОД логотипом «Refocus».
  const PRICE_FONT = '400 46px "Onest"';
  ctx.font = PRICE_FONT;
  const priceWidth = ctx.measureText(priceText).width;

  // Валюта — маленькими буквами справа от цены, того же шрифта.
  const CURRENCY_GAP = 4;
  const CURRENCY_FONT = '400 22px "Onest"';
  ctx.font = CURRENCY_FONT;
  const currWidth = currencySymbol ? ctx.measureText(currencySymbol).width : 0;

  // Считаем полную ширину (цена + промежуток + валюта) и центрируем под логотипом
  const totalWidth = priceWidth + (currencySymbol ? CURRENCY_GAP + currWidth : 0);
  const priceX = Math.max(0, Math.round(logoCenterX - totalWidth / 2));
  const priceY = 26;

  ctx.font = PRICE_FONT;
  ctx.fillText(priceText, priceX, priceY);

  if (currencySymbol) {
    ctx.font = CURRENCY_FONT;
    // baseline top. Выравниваем валюту по нижней кромке цены: низ 46px цены = priceY + 46,
    // низ 22px символа = y_curr + 22, отсюда y_curr = priceY + 46 - 22 = priceY + 24.
    // Приподнимем на 2 пикселя для оптического баланса.
    ctx.fillText(currencySymbol, priceX + priceWidth + CURRENCY_GAP, priceY + 24 - 2);
  }

  const mono = canvasToMonoBytes(ctx, blockW, blockH, 200, true);
  const wBytes = Math.ceil(blockW / 8);

  // Глобальные сдвиги всей композиции (логотип + цена + штрихкод)
  const GLOBAL_SHIFT_LEFT = mmToDots(1.5); // сдвиг влево от исходных координат
  // ⚠️ GLOBAL_SHIFT_UP = 0. Нельзя поднимать Y ближе чем на ~1.5 мм к верхнему
  // краю этикетки: у TSPL-принтеров там «мёртвая зона», и каждое задание делает
  // микро-backfeed ~0.2–0.3 мм. На 6-й этикетке накапливается 1.5–2 мм смещения вверх.
  const GLOBAL_SHIFT_UP = 0;

  const SHIFT_TEXT_LEFT = mmToDots(15) + GLOBAL_SHIFT_LEFT;
  const SHIFT_BC_LEFT = mmToDots(7) + GLOBAL_SHIFT_LEFT;
  const SHIFT_BC_DOWN = mmToDots(2);

  const BASE_LEFT_X = 160;
  const BASE_LEFT_Y = 12;

  const BASE_BC_X = 460;
  const BASE_BC_Y = 8;
  const BC_H = 30;
  const BC_NARROW = 1;
  const BC_WIDE = 2;

  // Итоговые координаты. Глобальные сдвиги применяются и к тексту, и к штрихкоду.
  const LEFT_X = Math.max(0, BASE_LEFT_X - SHIFT_TEXT_LEFT);
  const LEFT_Y = Math.max(0, BASE_LEFT_Y - GLOBAL_SHIFT_UP);

  const BC_X = Math.max(0, BASE_BC_X - SHIFT_BC_LEFT);
  const BC_Y = Math.max(0, BASE_BC_Y + SHIFT_BC_DOWN - GLOBAL_SHIFT_UP);

  const before = ascii(
    `SIZE ${labelWmm} mm,${labelHmm} mm\r\n` +
      `GAP 2 mm,0\r\n` +
      `DENSITY 10\r\n` +
      `SPEED 2\r\n` +
      `DIRECTION 1\r\n` +
      `REFERENCE 0,0\r\n` +
      `SET TEAR ON\r\n` +
      `CLS\r\n` +
      `BITMAP ${LEFT_X},${LEFT_Y},${wBytes},${blockH},0,`,
  );
  const after = ascii(
    `\r\nSET BARCODE TEXT 1\r\nBARCODE-TEXT FONT 0\r\nBARCODE-TEXT ABOVE 0\r\n` +
      `BARCODE ${BC_X},${BC_Y},"128",${BC_H},1,0,${BC_NARROW},${BC_WIDE},"${barcode}"\r\n` +
      `PRINT 1,1\r\n`,
  );

  const job = concatBytes(before, mono, after);
  return btoa(String.fromCharCode(...job));
}

/* ────────── типы данных ────────── */

type Branch = { id: number; name: string; code: string | null; country_id?: string | null; currency_symbol?: string | null };
type TypeActiveMap = Record<string, Record<number, number>>;

type BucketCounts = {
  totalByBucket: Record<BucketId, number>;
  totalOverall: number;
  perHundred: Record<string, number>;
};

type HundredShortage = {
  bucketId: BucketId;
  priceRange: string;
  hundredBase: number;
  shortage: number;
};

type BucketShortage = {
  bucket: (typeof BUCKETS)[number];
  targetBucket: number;
  haveBucket: number;
  needBucket: number;
  segments: {
    label: string;
    segKey: string;
    countGoal: number;
    have: number;
    need: number;
    quickPrices: number[];
  }[];
};

/* ────────── секции ────────── */

const TYPE_SECTIONS = [
  { id: 'RD_PL_F', title: 'Для чтения · Женские пластик', typeCode: 'RP' as FrameTypeCode, gender: 'F' as GenderCode },
  { id: 'RD_MT_F', title: 'Для чтения · Женские металл', typeCode: 'RM' as FrameTypeCode, gender: 'F' as GenderCode },
  { id: 'KD_F', title: 'Детские · Девочки', typeCode: 'KD' as FrameTypeCode, gender: 'F' as GenderCode },
  { id: 'KD_M', title: 'Детские · Мальчики', typeCode: 'KD' as FrameTypeCode, gender: 'M' as GenderCode },
  { id: 'PA_F', title: 'Взрослый пластик · Женские', typeCode: 'PA' as FrameTypeCode, gender: 'F' as GenderCode },
  { id: 'PA_M', title: 'Взрослый пластик · Мужские', typeCode: 'PA' as FrameTypeCode, gender: 'M' as GenderCode },
  { id: 'MA_F', title: 'Взрослый металл · Женские', typeCode: 'MA' as FrameTypeCode, gender: 'F' as GenderCode },
  { id: 'MA_M', title: 'Взрослый металл · Мужские', typeCode: 'MA' as FrameTypeCode, gender: 'M' as GenderCode },
] as const;

type TypeSection = (typeof TYPE_SECTIONS)[number];
type TypeSectionId = TypeSection['id'];

const TYPE_SLOT_SHARE: Record<TypeSectionId, number> = {
  RD_PL_F: 14 / 168,
  RD_MT_F: 14 / 168,
  KD_F: 7 / 168,
  KD_M: 7 / 168,
  PA_F: 35 / 168,
  PA_M: 28 / 168,
  MA_F: 35 / 168,
  MA_M: 28 / 168,
};

type SectionVariant = 'default' | 'female' | 'male';

function getSectionVariant(sec: TypeSection): SectionVariant {
  if (sec.gender === 'F') return 'female';
  if (sec.gender === 'M') return 'male';
  return 'default';
}

/* ────────── страница ────────── */



export default function BranchBarcodesPage() {
  const params = useParams<{ branchId: string }>();
  const branchId = Number(params.branchId);

  const { lines, log } = useLogger();

  const [branch, setBranch] = useState<Branch | null>(null);
  const [branchLoading, setBranchLoading] = useState(true);
  const [branchError, setBranchError] = useState<string | null>(null);

  const disableAutoSuggest = useMemo(
    () => branch != null && BRANCHES_WITHOUT_AUTO_REPLENISH.includes(branch.name),
    [branch],
  );

  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [, setPrinters] = useState<string[]>([]);
  const [printer, setPrinter] = useState<string>('');
  const connecting = useRef(false);


  // текущий YY (2 цифры)
  const yy = useMemo(() => String(new Date().getFullYear()).slice(2), []);
  const yearNumCurrent = useMemo(() => Number(yy) || (new Date().getFullYear() % 100), [yy]);


  // Всегда учитываем текущий + все предыдущие года
  const yearsForShelf = useMemo(() => {
    const years: number[] = [];
    for (let y = yearNumCurrent; y >= 24; y--) years.push(y);
    return years;
  }, [yearNumCurrent]);

  const branchCode = useMemo(() => branch?.code || 'RF', [branch?.code]);

  const [frameType] = useState<FrameTypeCode>('PA');
  const [gender, setGender] = useState<GenderCode>('F');

  const [printedByType, setPrintedByType] = useState<Record<string, number>>({});
  const [typeActive, setTypeActive] = useState<TypeActiveMap>({});
  const [typeSuggest, setTypeSuggest] = useState<Record<string, number[]>>({});

  // Диагностика "тип/пол не совпадает с barcode"
  const [, setBarcodeIssues] = useState<{ total: number; mismatched: number; unparsable: number }>({
    total: 0,
    mismatched: 0,
    unparsable: 0,
  });

  const [serial, setSerial] = useState<number>(DEFAULT_SERIAL);

  const [totalSlots, setTotalSlots] = useState<number>(0);

  const [counts, setCounts] = useState<BucketCounts>(() => ({
    totalByBucket: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    totalOverall: 0,
    perHundred: {},
  }));

  const [hundredShortages, setHundredShortages] = useState<HundredShortage[]>([]);

  useEffect(() => {
    if (!branchId || Number.isNaN(branchId)) {
      setBranchError('Некорректный ID филиала');
      setBranchLoading(false);
      return;
    }

    (async () => {
      try {
        const sb = getSupabase();
        const { data, error } = await sb.from('branches').select('id, name, code, country_id').eq('id', branchId).maybeSingle();
        if (error) throw error;
        if (!data) setBranchError('Филиал не найден');
        else {
          // Подтягиваем символ валюты по стране филиала (KG → «с», RU → «₽», KZ → «₸», UZ → «сўм»)
          let currency_symbol: string | null = null;
          const cid = (data as any).country_id;
          if (cid) {
            try {
              const { data: cRow } = await sb
                .from('franchise_countries')
                .select('currency_symbol')
                .eq('id', cid)
                .maybeSingle();
              currency_symbol = (cRow as any)?.currency_symbol ?? null;
            } catch {
              /* ignore */
            }
          }
          setBranch({ ...(data as any), currency_symbol } as Branch);
        }
      } catch (e: any) {
        setBranchError(e?.message || 'Ошибка загрузки филиала');
      } finally {
        setBranchLoading(false);
      }
    })();
  }, [branchId]);

  useEffect(() => {
    if (frameType === 'RP' || frameType === 'RM') setGender('F');
  }, [frameType]);

  // Источник истины для ёмкости витрины — БД (branches.frame_total_slots).
  // Для формульных филиалов читаем из API, для legacy — остаётся localStorage.
  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;

    (async () => {
      // 1) Для формульных филиалов приоритет — БД
      if (branch?.name && isBranchUsingFormula(branch.name)) {
        try {
          const r = await fetch(`/api/frame-config?branch_id=${branchId}`, { cache: 'no-store' });
          const j = await r.json();
          if (!cancelled && j?.ok && Number.isFinite(j.frame_total_slots) && j.frame_total_slots > 0) {
            setTotalSlots(j.frame_total_slots);
            setBranchTotalSlots(branch.name, j.frame_total_slots);
            return;
          }
        } catch {
          /* падаем на fallback ниже */
        }
        // Fallback: константа из формулы
        const fallback = getBranchTotalSlots(branch.name);
        if (!cancelled && fallback > 0) setTotalSlots(fallback);
        return;
      }

      // 2) Legacy-филиалы: localStorage → BRANCH_CAPACITY
      try {
        const saved = localStorage.getItem(`ui.branchSlots.${branchId}`);
        if (saved != null) {
          const parsed = Number(JSON.parse(saved));
          if (Number.isFinite(parsed) && parsed > 0) {
            if (!cancelled) setTotalSlots(parsed);
            return;
          }
        }
        if (branch?.name) {
          const def = BRANCH_CAPACITY[branch.name] ?? 0;
          if (!cancelled && def > 0) setTotalSlots(def);
        }
      } catch {
        /* ignore */
      }
    })();

    return () => { cancelled = true; };
  }, [branchId, branch?.name]);

  // Сохранение изменений ёмкости:
  //  • формульные филиалы — в БД (debounced), runtime override обновляем сразу
  //  • legacy — в localStorage, как было
  useEffect(() => {
    if (!branchId) return;
    if (!Number.isFinite(totalSlots) || totalSlots <= 0) return;

    const isFormula = !!(branch?.name && isBranchUsingFormula(branch.name));

    if (isFormula && branch?.name) {
      // обновляем формулу сразу, чтобы UI не прыгал
      setBranchTotalSlots(branch.name, totalSlots);
      // debounce на запись в БД — чтобы не дёргать API на каждый тап
      const h = window.setTimeout(() => {
        fetch('/api/frame-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branch_id: branchId, frame_total_slots: totalSlots }),
        }).catch((e) => console.warn('save frame-config failed:', e));
      }, 600);
      return () => window.clearTimeout(h);
    }

    try {
      localStorage.setItem(`ui.branchSlots.${branchId}`, JSON.stringify(totalSlots));
    } catch {
      /* ignore */
    }
  }, [branchId, totalSlots, branch?.name]);

  // next serial — ТОЛЬКО по текущему году
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!branchId || Number.isNaN(branchId)) return;
        const dbNext = await fetchDbNextSerial(branchId, frameType, gender, yearNumCurrent);
        if (!cancelled) setSerial((s) => Math.max(s, dbNext));
      } catch (e: any) {
        console.error('sync serial error', e?.message || e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branchId, frameType, gender, yearNumCurrent]);

  // printedByType (учёт лет витрины: current or current+prev)
  useEffect(() => {
    if (!branchId || Number.isNaN(branchId)) return;

    const loadPrintedByType = async () => {
      try {
        const sb = getSupabase();

        const { data, error } = await sb
          .from('frame_barcodes')
          .select('type_code, gender, barcode, voided_at, year')
          .eq('branch_id', branchId)
          .in('year', yearsForShelf)
          .is('voided_at', null);

        if (error) throw error;

        const map: Record<string, number> = {};
        let total = 0;
        let mismatched = 0;
        let unparsable = 0;

        for (const row of (data || []) as any[]) {
          total += 1;

          const inferred = inferFromBarcode(row.barcode);
          if (!inferred) {
            unparsable += 1;
          }

          const tStored = row.type_code as FrameTypeCode | null | undefined;
          const gStored = row.gender as GenderCode | null | undefined;

          let t: FrameTypeCode | null = tStored ?? null;
          let g: GenderCode | null = gStored ?? null;

          // если barcode парсится — считаем его "истиной" и ловим расхождения
          if (inferred) {
            if (tStored && tStored !== inferred.typeCode) mismatched += 1;
            if (gStored && gStored !== inferred.gender) mismatched += 1;

            t = inferred.typeCode;
            g = inferred.gender;
          }

          if (!t || !g) continue;
          const key = makeTypeKey(t, g);
          map[key] = (map[key] || 0) + 1;
        }

        setPrintedByType(map);
        setBarcodeIssues((prev) => ({
          ...prev,
          total,
          mismatched,
          unparsable,
        }));
      } catch (e: any) {
        console.error('load printedByType error', e?.message || e);
      }
    };

    void loadPrintedByType();
  }, [branchId, yearsForShelf]);

  const bucketTargets = useMemo(() => {
    const t = totalSlots;
    const n = (pct: number) => Math.round((t * pct) / 100);
    return {
      1: n(PCT.b1),
      2: n(PCT.b2),
      3: n(PCT.b3),
      4: n(PCT.b4),
      5: n(PCT.b5),
    } as Record<BucketId, number>;
  }, [totalSlots]);

  const bucketOfPriceLocal = (p: number): BucketId | null => {
    for (const b of BUCKETS) if (p >= b.min && p <= b.max) return b.id;
    return null;
  };

  const hundredKey = (p: number) => {
    const base = Math.floor(p / 100) * 100;
    return `${base}-${base + 99}`;
  };

  // counts (учёт лет витрины)
  const fetchCounts = useCallback(async () => {
    if (!branchId) return;

    try {
      const sb = getSupabase();

      const { data, error } = await sb
        .from('frame_barcodes')
        .select('price, sold_at, voided_at, year')
        .eq('branch_id', branchId)
        .in('year', yearsForShelf)
        .is('voided_at', null);

      if (error) throw error;

      const totalByBucket: Record<BucketId, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      const perHundred: Record<string, number> = {};
      let totalOverall = 0;

      for (const row of (data || []) as any[]) {
        // считаем только активные на витрине
        if (row.sold_at) continue;

        const priceNum = Number(row.price);
        if (!Number.isFinite(priceNum) || priceNum <= 0) continue;

        const bId = bucketOfPriceLocal(priceNum);
        if (!bId) continue;

        totalByBucket[bId] = (totalByBucket[bId] || 0) + 1;
        totalOverall += 1;

        const base = Math.floor(priceNum / 100) * 100;
        const rangeKey = `${base}-${base + 99}`;
        perHundred[rangeKey] = (perHundred[rangeKey] || 0) + 1;
      }

      setCounts({ totalByBucket, totalOverall, perHundred });
      setHundredShortages([]); // после reset "проданные диапазоны" не нужны
    } catch (e: any) {
      console.error(e);
      log(`Ошибка загрузки баланса: ${e?.message || String(e)}`);
    }
  }, [branchId, yearsForShelf, log]);

  // Активные ценники и "пустые крючки" по типам (учёт лет витрины)
  const fetchTypeActive = useCallback(async () => {
    if (!branchId || Number.isNaN(branchId)) return;

    try {
      const sb = getSupabase();

      const { data, error } = await sb
        .from('frame_barcodes')
        .select('type_code, gender, price, sold_at, voided_at, barcode, year')
        .eq('branch_id', branchId)
        .in('year', yearsForShelf)
        .is('voided_at', null);

      if (error) throw error;

      const activeMap: TypeActiveMap = {};
      const totalMap: TypeActiveMap = {};

      let total = 0;
      let mismatched = 0;
      let unparsable = 0;

      for (const row of (data || []) as any[]) {
        total += 1;

        const priceNum = Number(row.price);
        if (!Number.isFinite(priceNum) || priceNum <= 0) continue;

        const inferred = inferFromBarcode(row.barcode);
        if (!inferred) {
          unparsable += 1;
        }

        const tStored = row.type_code as FrameTypeCode | null | undefined;
        const gStored = row.gender as GenderCode | null | undefined;

        let t: FrameTypeCode | null = tStored ?? null;
        let g: GenderCode | null = gStored ?? null;

        if (inferred) {
          if (tStored && tStored !== inferred.typeCode) mismatched += 1;
          if (gStored && gStored !== inferred.gender) mismatched += 1;

          // используем то, что зашито в barcode — для "истинного" вида
          t = inferred.typeCode;
          g = inferred.gender;
        }

        if (!t || !g) continue;

        const key = makeTypeKey(t, g);

        if (!totalMap[key]) totalMap[key] = {};
        if (!activeMap[key]) activeMap[key] = {};

        totalMap[key][priceNum] = (totalMap[key][priceNum] || 0) + 1;

        if (!row.sold_at) {
          activeMap[key][priceNum] = (activeMap[key][priceNum] || 0) + 1;
        }
      }

      const suggestMap: Record<string, number[]> = {};

      for (const key of Object.keys(totalMap)) {
        const totalPrices = totalMap[key];
        const activePrices = activeMap[key] || {};
        const list: number[] = [];

        for (const priceStr of Object.keys(totalPrices)) {
          const priceNum = Number(priceStr);
          if (!Number.isFinite(priceNum)) continue;

          const totalC = totalPrices[priceNum] || 0;
          const activeC = activePrices[priceNum] || 0;
          const sold = Math.max(totalC - activeC, 0);

          if (sold > 0 && activeC === 0) list.push(priceNum);
        }

        if (list.length) suggestMap[key] = list.sort((a, b) => a - b);
      }

      setTypeActive(activeMap);
      setTypeSuggest(disableAutoSuggest ? {} : suggestMap);

      setBarcodeIssues({ total, mismatched, unparsable });
      if (mismatched > 0) log(`⚠️ Несовпадений type/gender с barcode: ${mismatched}`);
      if (unparsable > 0) log(`⚠️ Нераспарсенных barcode: ${unparsable}`);
    } catch (e: any) {
      console.error('load typeActive error', e?.message || e);
      log(`Ошибка загрузки активных цен по видам: ${e?.message || String(e)}`);
    }
  }, [branchId, yearsForShelf, log, disableAutoSuggest]);

  useEffect(() => void fetchCounts(), [fetchCounts]);
  useEffect(() => void fetchTypeActive(), [fetchTypeActive]);

  const bucketShortages = useMemo<BucketShortage[]>(() => {
    if (disableAutoSuggest) return [];

    const out: BucketShortage[] = [];

    for (const b of BUCKETS) {
      const targetBucket = bucketTargets[b.id] ?? 0;
      const haveBucket = counts.totalByBucket[b.id] || 0;
      const needBucket = Math.max(0, targetBucket - haveBucket);

      if (targetBucket <= 0) continue;

      const segDefs: { label: string; base: number; segKey: string }[] = [];
      for (let base = Math.ceil(b.min / 100) * 100; base <= b.max; base += 100) {
        const hi = Math.min(base + 99, b.max);
        segDefs.push({
          label: `${base}–${hi}`,
          base,
          segKey: `${base}-${base + 99}`,
        });
      }

      const weights = segDefs.map((seg) => {
        const hi = Number(seg.label.split('–')[1]) || seg.base + 99;
        const midPrice = (seg.base + hi) / 2;
        return priceWeight(midPrice);
      });

      const sumW = weights.reduce((s, w) => s + w, 0);
      let rawCounts: number[];
      if (sumW <= 0) rawCounts = segDefs.map(() => 1);
      else rawCounts = weights.map((w) => (w / sumW) * Math.max(0, targetBucket));

      const desiredCounts = normalizeCountsToTarget(rawCounts, Math.max(0, targetBucket), 1);

      const segments: BucketShortage['segments'] = [];

      segDefs.forEach((segDef, idx) => {
        const countGoal = Math.min(desiredCounts[idx] ?? 0, 9);
        if (countGoal <= 0) return;

        const haveSeg = counts.perHundred[segDef.segKey] || 0;
        const needSeg = Math.max(0, countGoal - haveSeg);
        if (needSeg <= 0) return;

        const quickPrices = generateOptionsForHundred(segDef.base, needSeg, b.min, b.max);
        if (!quickPrices.length) return;

        segments.push({
          label: segDef.label,
          segKey: segDef.segKey,
          countGoal,
          have: haveSeg,
          need: needSeg,
          quickPrices,
        });
      });

      out.push({ bucket: b, targetBucket, haveBucket, needBucket, segments });
    }

    return out;
  }, [bucketTargets, counts, disableAutoSuggest]);

  const shortagesTotal = useMemo(
    () => Math.max(0, totalSlots - counts.totalOverall),
    [totalSlots, counts.totalOverall],
  );

  const isFormulaBranch = branch?.name ? isBranchUsingFormula(branch.name) : false;
  const branchName = branch?.name ?? '';
  const formulaBranchTotal = isFormulaBranch
    ? computeBranchTotalCount(branchName)
    : 0;

  /*
   * Как подключить AI-формулу к новому филиалу:
   * 1) В lib/framePricingFormula.ts → CITY_INDEX добавь филиал со страной и индексом
   * 2) В BRANCH_TOTAL_SLOTS укажи физическую ёмкость витрины
   * 3) В FORMULA_ENABLED_BRANCHES добавь название
   * Всё — формула заработает сразу, UI покажет план и цены автоматически.
   */
  const typePlans = useMemo(() => {
    const res: Record<TypeSectionId, { slots: number; pct: number }> = {} as any;
    TYPE_SECTIONS.forEach((sec) => {
      // Филиалы с формулой: слоты вычисляются формулой в lib/framePricingFormula.ts
      if (isFormulaBranch) {
        const fixedSlots = computeSectionSlotCount(
          sec.typeCode as FormulaFrameType,
          sec.gender as FormulaGenderCode,
          branchName,
        );
        const pct = formulaBranchTotal > 0
          ? Math.round((fixedSlots / formulaBranchTotal) * 1000) / 10
          : 0;
        res[sec.id] = { slots: fixedSlots, pct };
        return;
      }
      // Legacy-филиалы: стандартное пропорциональное распределение
      const share = TYPE_SLOT_SHARE[sec.id] ?? 0;
      const slots = Math.round(totalSlots * share);
      const pct = Math.round(share * 1000) / 10;
      res[sec.id] = { slots, pct };
    });
    return res;
  }, [totalSlots, isFormulaBranch, branchName, formulaBranchTotal]);

  const connectQZ = useCallback(async () => {
    if (connecting.current) return;
    connecting.current = true;
    try {
      setStatus('connecting');
      const qz = await ensureQZLoaded(log);
      await ensureQZSecurity();

      qz.websocket?.setClosed?.(() => {
        setStatus('idle');
        log('QZ: соединение закрыто');
      });
      qz.websocket?.setError?.((e: any) => {
        setStatus('error');
        log(`QZ: ошибка сокета: ${e}`);
      });

      if (qz.websocket?.isActive?.()) {
        setStatus('connected');
      } else {
        await qz.websocket.connect();
        setStatus('connected');
      }

      const list: string[] = await qz.printers.find();
      setPrinters(list);
      const chosen = list.find((n) => /RAW|TSPL|DIRECT|GENERIC/i.test(n)) || list[0] || '';
      setPrinter(chosen);
      if (chosen) log(`Принтер: ${chosen}`);
    } catch (e: any) {
      setStatus('error');
      log(e?.message || String(e));
    } finally {
      connecting.current = false;
    }
  }, [log]);

  const doPrint = useCallback(
    async (priceValue: number, overrides?: { typeCode?: FrameTypeCode; gender?: GenderCode }) => {
      const p = Number(priceValue);
      if (!p || p <= 0) throw new Error('Введите корректную цену');
      if (!branchId || Number.isNaN(branchId)) throw new Error('Неизвестный филиал (branchId).');

      const actualType = overrides?.typeCode ?? frameType;
      const actualGender = overrides?.gender ?? gender;

      const typeRules = FRAME_TYPE_PRICE_RULES[actualType];
      const frameTypeMeta = FRAME_TYPES.find((t) => t.code === actualType);
      if (!typeRules) throw new Error(`Неизвестный тип оправы: ${actualType}`);

      const qz = (window as any).qz;

      if (status !== 'connected') {
        throw new Error('Печать недоступна: QZ не подключён. Нажмите «Подключиться к QZ» и дождитесь статуса "подключено".');
      }
      if (!qz?.version) throw new Error('QZ не загружен. Нажмите «Подключиться к QZ» и попробуйте ещё раз.');
      if (!printer) throw new Error('Не выбран принтер. Сначала выберите принтер вверху.');

      if (p < typeRules.min || p > typeRules.max) {
        throw new Error(`Для типа «${frameTypeMeta?.label ?? actualType}» допустимы цены от ${typeRules.min} до ${typeRules.max} сом.`);
      }

      if (actualType === 'RP') {
        if (actualGender !== 'F') throw new Error('«Чтение · пластик» доступно только в женском варианте.');
        if (p < 800 || p > 2200) throw new Error('Для «Чтение · пластик» допустимы цены от 800 до 2200 сом.');
      }
      if (actualType === 'RM') {
        if (actualGender !== 'F') throw new Error('«Чтение · металл» доступно только в женском варианте.');
        if (p < 1000 || p > 2400) throw new Error('Для «Чтение · металл» допустимы цены от 1000 до 2400 сом.');
      }
      if (actualType === 'KD') {
        if (p < 800 || p > 3500) throw new Error('Для детских оправ допустимы цены от 800 до 3500 сом.');
      }
      if (actualType === 'PA') {
        if (actualGender === 'F') {
          if (p < 1000 || p > 3000) throw new Error('Для женских пластиковых оправ допустимы цены от 1000 до 3000 сом.');
        } else {
          if (p < 1200 || p > 3200) throw new Error('Для мужских пластиковых оправ допустимы цены от 1200 до 3200 сом.');
        }
      }
      if (actualType === 'MA') {
        if (actualGender === 'F') {
          if (p < 1200 || p > 9000) throw new Error('Для женских металлических оправ допустимы цены от 1200 до 9000 сом.');
        } else {
          if (p < 1400 || p > 10000) throw new Error('Для мужских металлических оправ допустимы цены от 1400 до 10000 сом.');
        }
      }

      const sb = getSupabase();

      /* ===================== NEW: жесткое правило 1 цена = 1 ценник (на витрине) ===================== */
      {
        const { data: existing, error: exErr } = await sb
          .from('frame_barcodes')
          .select('barcode, year, serial')
          .eq('branch_id', branchId)
          .eq('type_code', actualType)
          .eq('gender', actualGender)
          .eq('price', p as any)
          .is('sold_at', null)
          .is('voided_at', null)
          .limit(5);

        if (exErr) throw exErr;

        if ((existing || []).length > 0) {
          const list = (existing || [])
            .map((r: any) => `${r.barcode} (yy=${String(r.year).padStart(2, '0')}, serial=${r.serial})`)
            .join(', ');
          throw new Error(
            `Нельзя печатать дубль цены.\n` +
              `В этом филиале уже есть активный ценник для ${actualType}/${actualGender} по цене ${p} сом: ${list}.\n` +
              `Если ценник потерян — сначала погаси (void) этот штрих-код в БД, потом печатай заново.`,
          );
        }
      }
      /* ============================================================================================== */

      // ВСТАВКА — ТОЛЬКО В ТЕКУЩИЙ ГОД
      const makeBarcode = (serialNum: number) =>
        `${branchCode}${actualType}${actualGender}${yy}${String(serialNum).padStart(SERIAL_LEN, '0')}`;

      let currentSerial = Math.max(serial, await fetchDbNextSerial(branchId, actualType, actualGender, yearNumCurrent));

      let usedBarcode = '';
      const ATTEMPTS = 5000;
      for (let i = 0; i < ATTEMPTS; i++) {
        const candidate = makeBarcode(currentSerial);
        const { error } = await sb.from('frame_barcodes').insert({
          frame_id: null as any,
          barcode: candidate,
          price: p,
          branch_id: branchId,
          type_code: actualType,
          gender: actualGender,
          year: yearNumCurrent,
          serial: currentSerial,
        });
        if (!error) {
          usedBarcode = candidate;
          setSerial(currentSerial + 1);
          break;
        }
        const msg = String((error as any)?.message || '');
        const code = (error as any)?.code;
        if (code === '23505' || /duplicate|unique|exists|constraint/i.test(msg)) {
          currentSerial += 1;
          continue;
        }
        throw error;
      }
      if (!usedBarcode) throw new Error('Не удалось подобрать свободный штрихкод');

      const typeKey = makeTypeKey(actualType, actualGender);
      setPrintedByType((prev) => ({ ...prev, [typeKey]: (prev[typeKey] || 0) + 1 }));
      setTypeActive((prev) => {
        const prevMap = prev[typeKey] || {};
        return { ...prev, [typeKey]: { ...prevMap, [p]: (prevMap[p] || 0) + 1 } };
      });
      setTypeSuggest((prev) => {
        const arr = prev[typeKey] || [];
        const idx = arr.indexOf(p);
        if (idx === -1) return prev;
        const nextArr = [...arr];
        nextArr.splice(idx, 1);
        return { ...prev, [typeKey]: nextArr };
      });

      await ensureCanvasFonts();
      const b64 = buildBitmapJobBase64(String(p), usedBarcode);
      const cfg = qz.configs.create(printer, { legacy: true, altPrinting: true, rasterize: false, scaleContent: false });
      await qz.print(cfg, [{ type: 'raw', format: 'base64', data: b64 }]);
      log(`Отпечатано: ${usedBarcode}`);

      const b = bucketOfPriceLocal(p);
      if (b) {
        setCounts((prev) => {
          const totalByBucket = { ...prev.totalByBucket, [b]: (prev.totalByBucket[b] || 0) + 1 };
          const totalOverall = prev.totalOverall + 1;
          const key = hundredKey(p);
          const perHundred = { ...prev.perHundred, [key]: (prev.perHundred[key] || 0) + 1 };
          return { totalByBucket, totalOverall, perHundred };
        });
      }

      const base = Math.floor(p / 100) * 100;
      setHundredShortages((prev) =>
        prev
          .map((h) => (h.hundredBase === base ? { ...h, shortage: Math.max(0, h.shortage - 1) } : h))
          .filter((h) => h.shortage > 0),
      );
    },
    [branchId, branchCode, frameType, gender, yy, serial, printer, status, log, yearNumCurrent],
  );

  /* ── Последние напечатанные ценники (для отмены) ── */
  const [recentPrints, setRecentPrints] = useState<{ barcode: string; price: number; typeCode: FrameTypeCode; gender: GenderCode; ts: string }[]>([]);

  useEffect(() => {
    if (!branchId) return;
    // Загружаем ВСЕ ценники, напечатанные сегодня (Asia/Bishkek), не проданные и не отменённые
    const todayYMD = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bishkek' });
    const startOfTodayIso = `${todayYMD}T00:00:00+06:00`;

    const sb = getSupabase();
    sb.from('frame_barcodes')
      .select('barcode, price, type_code, gender, created_at')
      .eq('branch_id', branchId)
      .is('sold_at', null)
      .is('voided_at', null)
      .gte('created_at', startOfTodayIso)
      .order('created_at', { ascending: false })
      .limit(500) // safety cap на случай очень большой смены
      .then(({ data }) => {
        if (data) {
          setRecentPrints(data.map((r: any) => ({
            barcode: String(r.barcode ?? ''),
            price: Number(r.price ?? 0),
            typeCode: (r.type_code ?? '') as FrameTypeCode,
            gender: (r.gender ?? '') as GenderCode,
            ts: String(r.created_at ?? ''),
          })));
        }
      });
  }, [branchId]);

  const addToRecent = useCallback((barcode: string, price: number, typeCode: FrameTypeCode, g: GenderCode) => {
    // Без slice — показываем ВСЕ ценники за сегодня, в порядке от новых к старым
    setRecentPrints((prev) => [{ barcode, price, typeCode, gender: g, ts: new Date().toISOString() }, ...prev]);
  }, []);

  const doPrintWithRecent = useCallback(
    async (p: number, overrides?: { typeCode: FrameTypeCode; gender: GenderCode }) => {
      await doPrint(p, overrides);
      const t = overrides?.typeCode ?? frameType;
      const g = overrides?.gender ?? gender;
      const sb = getSupabase();
      const { data } = await sb.from('frame_barcodes')
        .select('barcode')
        .eq('branch_id', branchId)
        .eq('price', p as any)
        .eq('type_code', t)
        .eq('gender', g)
        .is('sold_at', null)
        .is('voided_at', null)
        .order('created_at', { ascending: false })
        .limit(1);
      if (data?.[0]) {
        addToRecent(String(data[0].barcode), p, t, g);
      }
    },
    [doPrint, frameType, gender, branchId, addToRecent],
  );

  const voidBarcode = useCallback(
    async (barcode: string) => {
      if (!window.confirm(`Отменить ценник ${barcode}? Он снова станет доступен для печати.`)) return;
      const sb = getSupabase();
      const { error } = await sb.from('frame_barcodes')
        .update({ voided_at: new Date().toISOString() })
        .eq('barcode', barcode)
        .is('voided_at', null);
      if (error) {
        log(`Ошибка отмены: ${error.message}`);
        return;
      }
      log(`Отменён: ${barcode}`);
      setRecentPrints((prev) => prev.filter((r) => r.barcode !== barcode));
      window.location.reload();
    },
    [log],
  );

  const quickPrint = useCallback(
    async (priceValue: number, typeCode: FrameTypeCode, g: GenderCode) => {
      try {
        await doPrintWithRecent(priceValue, { typeCode, gender: g });
      } catch (e: any) {
        log(e?.message || String(e));
        throw e;
      }
    },
    [doPrintWithRecent, log],
  );

  /**
   * Тестовая печать — не трогает БД, просто отправляет демо-этикетку на принтер.
   * Цена 2580 сом, штрихкод TEST2580MA. Используется для проверки шрифтов и вёрстки.
   */
  const testPrint = useCallback(async () => {
    if (status !== 'connected' || !printer) {
      log('Тестовая печать: QZ не подключён');
      return;
    }
    try {
      const qz = await ensureQZLoaded(log);
      if (!qz?.version) throw new Error('QZ не загружен');

      await ensureCanvasFonts();
      const testPrice = '2580';
      const testBarcode = 'TEST2580MA';
      const b64 = buildBitmapJobBase64(testPrice, testBarcode);
      const cfg = qz.configs.create(printer, {
        legacy: true,
        altPrinting: true,
        rasterize: false,
        scaleContent: false,
      });
      await qz.print(cfg, [{ type: 'raw', format: 'base64', data: b64 }]);
      log(`Тестовый ценник отпечатан (цена ${testPrice}, штрихкод ${testBarcode}) — в БД НЕ записан`);
    } catch (e: any) {
      log(`Тестовая печать: ${e?.message || String(e)}`);
    }
  }, [status, printer, log]);

  if (branchError) {
    return (
      <div className="mx-auto min-h-screen max-w-5xl p-6 text-sm text-slate-900">
        <header className="mb-4 flex items-center gap-3 rounded-2xl bg-white ring-1 ring-sky-100 px-5 py-3 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <Link
            href="/settings/barcodes/overview"
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200 transition"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Назад
          </Link>
          <h1 className="text-base font-bold tracking-tight text-slate-900">{branch?.name ?? 'Филиал'}</h1>
        </header>
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-800 shadow-sm">
          {branchError}
        </div>
      </div>
    );
  }

  if (branchLoading) {
    return <div className="mx-auto min-h-screen max-w-5xl p-6 text-sm text-slate-900">Загрузка филиала…</div>;
  }

  return (
    <div className="mx-auto min-h-screen max-w-7xl p-4 text-sm text-slate-900 md:p-6">
      {/* Невидимые preloader-элементы — заставляют браузер реально подгрузить шрифты,
          которые потом использует canvas (через @import они объявлены, но
          не загружаются, пока кто-то их не «использует» в DOM) */}
      <span aria-hidden="true" style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', fontFamily: 'Onest', fontWeight: 400, fontSize: 1 }}>0123456789</span>
      <span aria-hidden="true" style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', fontFamily: 'pavelt-jrjpm', fontSize: 1 }}>Refocus</span>

      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl bg-white ring-1 ring-sky-100 px-5 py-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
        <div className="flex items-center gap-3">
          <Link
            href="/settings/barcodes/overview"
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200 transition"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Назад
          </Link>
          <div className="h-5 w-px bg-slate-200" />
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.35)]">
              <Barcode className="h-4 w-4 text-white" />
            </div>
            <h1 className="text-base font-bold tracking-tight text-slate-900">{branch?.name ?? 'Филиал'}</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
              status === 'connected'
                ? 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200'
                : status === 'connecting'
                ? 'bg-sky-50 text-sky-600 ring-1 ring-sky-200'
                : 'bg-slate-50 text-slate-500 ring-1 ring-slate-200'
            }`}
          >
            {status === 'connected' ? 'QZ подключён' : status === 'connecting' ? 'подключение…' : 'QZ не подключён'}
          </span>

          <button
            onClick={connectQZ}
            className="rounded-xl bg-cyan-500 px-3 py-2 text-xs font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.30)] hover:bg-cyan-400 active:scale-[.98] transition"
          >
            Подключить QZ
          </button>

          <button
            onClick={testPrint}
            disabled={status !== 'connected' || !printer}
            title="Печатает демо-этикетку (2580 сом, TEST2580MA). В базе не сохраняется."
            className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 active:scale-[.98] transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Тестовая печать
          </button>
        </div>
      </header>

      <div className="mb-5">
        <Section title={branch ? `Филиал «${branch.name}»` : 'Филиал'}>
          <div className="grid gap-3 md:grid-cols-4">
            <PlanSlotsInput value={totalSlots} onChange={setTotalSlots} />
            <Stat label="На витрине" value={counts.totalOverall} />
            <Stat label="Не хватает" value={shortagesTotal} />
            <Stat label="Принтер" value={<span className="block truncate">{printer || 'не выбран'}</span>} />
          </div>

          {isFormulaBranch && branch?.name && (
            <FormulaInfoStrip branchName={branch.name} />
          )}
        </Section>
      </div>


      <div className="mt-5 space-y-4">
        {TYPE_SECTIONS.map((sec) => {
          const plan = typePlans[sec.id];
          return (
            <Section
              key={sec.id}
              title={sec.title}
              variant={getSectionVariant(sec)}
              aside={
                <div className="flex items-center gap-2 text-[11px]">
                  {plan && plan.slots > 0 ? (
                    <>
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700">план {plan.slots}</span>
                      <span className="rounded-md bg-cyan-50 px-1.5 py-0.5 font-semibold text-cyan-700">на полке {Object.values(typeActive[makeTypeKey(sec.typeCode, sec.gender)] || {}).reduce((s, v) => s + (Number.isFinite(v) ? Number(v) : 0), 0)}</span>
                      <span className="rounded-md bg-sky-50 px-1.5 py-0.5 font-semibold text-sky-700">к печати {Math.max(0, plan.slots - Object.values(typeActive[makeTypeKey(sec.typeCode, sec.gender)] || {}).reduce((s, v) => s + (Number.isFinite(v) ? Number(v) : 0), 0))}</span>
                    </>
                  ) : (
                    <span className="text-slate-400">без плана</span>
                  )}
                </div>
              }
            >
              <TypeShortageGrid
                bucketShortages={bucketShortages}
                hundredShortages={hundredShortages}
                frameType={sec.typeCode}
                gender={sec.gender}
                typePlanSlots={plan?.slots ?? 0}
                totalSlots={totalSlots}
                printedCount={printedByType[makeTypeKey(sec.typeCode, sec.gender)] || 0}
                typeActivePrices={typeActive[makeTypeKey(sec.typeCode, sec.gender)] || {}}
                typeSuggestPrices={typeSuggest[makeTypeKey(sec.typeCode, sec.gender)] || []}
                onQuickPrint={(p) => quickPrint(p, sec.typeCode, sec.gender)}
                printingAvailable={status === 'connected' && !!printer}
                fixedPrices={
                  isFormulaBranch && branch?.name
                    ? computeSectionPrices(
                        sec.typeCode as FormulaFrameType,
                        sec.gender as FormulaGenderCode,
                        branch.name,
                      )
                    : undefined
                }
              />
            </Section>
          );
        })}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {/* Последние ценники — отмена */}
        <Section title="Последние ценники">
          {recentPrints.length > 0 ? (
            <div className="grid gap-1 max-h-48 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {recentPrints.map((r) => (
                <div key={r.barcode} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 ring-1 ring-slate-100 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900 tabular-nums">{r.price} сом</div>
                    <div className="mt-0.5 text-[12px] font-mono font-medium text-slate-600 truncate">{r.barcode}</div>
                  </div>
                  <button
                    onClick={() => voidBarcode(r.barcode)}
                    className="shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200 hover:bg-slate-200 hover:text-slate-700 transition"
                  >
                    Отменить
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-400">Нет ценников</div>
          )}
        </Section>

        {/* Лог */}
        <Section title="Лог печати">
          <textarea
            readOnly
            className="h-48 w-full resize-none rounded-xl border border-slate-200 bg-white p-2 font-mono text-[10px] text-slate-600"
            value={lines.join('\n')}
          />
        </Section>
      </div>
    </div>
  );
}

/* ────────── график (УДАЛЁН) ────────── */

function _PriceDistributionChart_UNUSED({ perHundred }: { perHundred: Record<string, number> }) {
  const BIN_STEP = 400;

  const bins = React.useMemo(() => {
    const res: { from: number; to: number; count: number }[] = [];
    for (let start = GLOBAL_PRICE_MIN; start <= GLOBAL_PRICE_MAX; start += BIN_STEP) {
      const end = Math.min(start + BIN_STEP - 1, GLOBAL_PRICE_MAX);
      let count = 0;
      for (let p = start; p <= end; p += 100) {
        const key = `${p}-${p + 99}`;
        count += perHundred[key] || 0;
      }
      res.push({ from: start, to: end, count });
    }
    return res;
  }, [perHundred]);

  const total = React.useMemo(() => bins.reduce((s, b) => s + b.count, 0), [bins]);
  const maxCount = React.useMemo(() => bins.reduce((m, b) => (b.count > m ? b.count : m), 0), [bins]);

  if (!total || !maxCount) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white/80 px-3 py-3 text-[11px] text-slate-500">
        Пока нет активных ценников в матрице этого филиала. График появится, когда вы повесите ценники на витрину.
      </div>
    );
  }

  const viewW = 100;
  const viewH = 70;
  const marginLeft = 4;
  const marginRight = 4;
  const marginTop = 6;
  const marginBottom = 14;

  const plotW = viewW - marginLeft - marginRight;
  const plotH = viewH - marginTop - marginBottom;

  const n = bins.length;

  const bars = bins.map((b, idx) => {
    const norm = b.count / maxCount;
    const h = norm * plotH;
    const xStep = plotW / n;

    const barWidth = xStep * 0.7;
    const x = marginLeft + idx * xStep + (xStep - barWidth) / 2;
    const y = marginTop + (plotH - h);

    return { x, y, width: barWidth, height: h, ...b };
  });

  let peak = bars[0];
  for (const b of bars) if (b.count > peak.count) peak = b;

  const midPrice = Math.round((GLOBAL_PRICE_MIN + GLOBAL_PRICE_MAX) / 2 / 100) * 100;

  return (
    <div className="rounded-2xl border border-sky-100 bg-white/90 p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between text-[11px] text-slate-600">
        <span>Каждый столбец показывает, сколько оправ в диапазоне цен.</span>
        <span>
          Всего активных: <span className="font-semibold text-slate-900">{total.toLocaleString('ru-RU')}</span>
        </span>
      </div>

      <div className="h-40 w-full">
        <svg viewBox={`0 0 ${viewW} ${viewH}`} preserveAspectRatio="none" className="h-full w-full">
          <defs>
            <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.3" />
            </linearGradient>
            <linearGradient id="barFillPeak" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="1" />
              <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.6" />
            </linearGradient>
          </defs>

          <rect x={0} y={0} width={viewW} height={viewH} fill="#f8fafc" opacity={0.7} />

          {[0.25, 0.5, 0.75, 1].map((k) => {
            const y = marginTop + plotH * (1 - k);
            return (
              <line key={k} x1={marginLeft} y1={y} x2={viewW - marginRight} y2={y} stroke="#e2e8f0" strokeWidth={0.3} strokeDasharray="1.5 2" />
            );
          })}

          <line x1={marginLeft} y1={marginTop + plotH} x2={viewW - marginRight} y2={marginTop + plotH} stroke="#cbd5f5" strokeWidth={0.6} />

          {bars.map((b, idx) => {
            const isPeak = b.from === peak.from && b.to === peak.to;
            return (
              <rect
                key={idx}
                x={b.x}
                y={b.y}
                width={b.width}
                height={b.height || 0.4}
                rx={0.7}
                fill={isPeak ? 'url(#barFillPeak)' : 'url(#barFill)'}
                opacity={isPeak ? 1 : 0.85}
              />
            );
          })}

          <rect x={peak.x - 0.4} y={peak.y - 0.6} width={peak.width + 0.8} height={peak.height + 1.2} fill="none" stroke="#0f172a" strokeWidth={0.6} opacity={0.7} />
        </svg>
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
        <span>{GLOBAL_PRICE_MIN.toLocaleString('ru-RU')} сом</span>
        <span>~{midPrice.toLocaleString('ru-RU')} сом</span>
        <span>{GLOBAL_PRICE_MAX.toLocaleString('ru-RU')} сом</span>
      </div>

      <div className="mt-1 text-[10px] text-slate-500">
        Пик: <span className="font-semibold text-slate-900">{peak.from.toLocaleString('ru-RU')}–{peak.to.toLocaleString('ru-RU')} сом</span> · {peak.count.toLocaleString('ru-RU')} оправ.
      </div>
    </div>
  );
}

/* ────────── UI helpers ────────── */

/** Компактная read-only строка с параметрами формулы — вставляется внутрь блока филиала. */
function FormulaInfoStrip({ branchName }: { branchName: string }) {
  const country = getBranchCountry(branchName);
  const countryName = country ? COUNTRIES[country].name : '—';
  const currency = getBranchCurrency(branchName);
  const currencySymbol = getBranchCurrencySymbol(branchName);
  const cityIndex = getCityIndex(branchName);
  const totalSlots = getBranchTotalSlots(branchName);
  const premiumShare = getBranchPremiumShare(branchName);
  const premiumPct = (premiumShare * 100).toFixed(1);
  const approxPremium = Math.round(totalSlots * premiumShare * 0.6);
  const premiumThreshold = country ? COUNTRIES[country].premiumThreshold : 4000;

  const chipCls =
    'inline-flex items-center gap-1 rounded-md bg-cyan-50/70 px-2 py-0.5 ring-1 ring-cyan-200/70 text-[11px] font-medium text-cyan-800';

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          <span className="text-cyan-500">●</span>
          Формула
        </span>
        <span className={chipCls}>
          <span className="text-cyan-500">страна</span>
          <b>{countryName}</b>
          <span className="text-cyan-400/80">· {currency}</span>
        </span>
        <span className={chipCls}>
          <span className="text-cyan-500">город</span>
          <b>×{cityIndex.toFixed(2)}</b>
        </span>
        <span className={chipCls}>
          <span className="text-cyan-500">премиум</span>
          <b>{premiumPct}%</b>
          <span className="text-cyan-400/80">≈{approxPremium} ≥ {premiumThreshold.toLocaleString('ru-RU')} {currencySymbol}</span>
        </span>
        <span className="ml-auto font-mono text-[10.5px] text-slate-400 hidden md:inline">
          База × пол × {BUCKET_STEP.toFixed(2)}^(бакет−1) × {cityIndex.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function PlanSlotsInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(String(value));

  React.useEffect(() => { setDraft(String(value)); }, [value]);

  const handleSave = () => {
    const n = Number(draft || 0);
    if (n !== value) {
      if (!window.confirm(`Изменить план слотов с ${value} на ${n}?`)) {
        setDraft(String(value));
        setEditing(false);
        return;
      }
      onChange(n);
    }
    setEditing(false);
  };

  return (
    <div className="rounded-xl bg-slate-50 ring-1 ring-slate-100 p-3">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">План слотов</div>
      {editing ? (
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') { setDraft(String(value)); setEditing(false); } }}
            className="w-full rounded-lg border border-cyan-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
          />
          <button onClick={handleSave} className="rounded-lg bg-cyan-500 px-2 py-1 text-xs font-semibold text-white hover:bg-cyan-400">OK</button>
          <button onClick={() => { setDraft(String(value)); setEditing(false); }} className="rounded-lg bg-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-300">X</button>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="mt-0.5 text-lg font-bold text-slate-900 hover:text-cyan-600 transition">{value}</button>
      )}
    </div>
  );
}

const SECTION_VARIANT_CLASSES: Record<SectionVariant, string> = {
  default: 'border-sky-100 bg-white',
  female: 'border-teal-300 bg-gradient-to-r from-teal-100 via-teal-50 to-cyan-50',
  male: 'border-sky-300 bg-gradient-to-r from-sky-100 via-sky-50 to-white',
};

const GENDER_BADGE: Record<SectionVariant, { label: string; cls: string } | undefined> = {
  default: undefined,
  female: { label: 'Ж', cls: 'bg-teal-100 text-teal-700 ring-teal-200' },
  male: { label: 'М', cls: 'bg-sky-100 text-sky-700 ring-sky-200' },
};

const Section = ({
  title,
  aside,
  action,
  children,
  variant = 'default',
}: {
  title: string;
  aside?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  variant?: SectionVariant;
}) => {
  const badge = GENDER_BADGE[variant];
  return (
    <section
      className={`mb-4 rounded-2xl ring-1 shadow-[0_8px_30px_rgba(15,23,42,0.45)] ${SECTION_VARIANT_CLASSES[variant]}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          {badge && (
            <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold ring-1 ${badge.cls}`}>
              {badge.label}
            </span>
          )}
          <h2 className="text-sm font-bold text-slate-900 md:text-base">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          {aside && <div className="flex items-center gap-1 text-[11px] text-slate-600">{aside}</div>}
          {action}
        </div>
      </div>
      <div className="px-4 pb-3 pt-2">{children}</div>
    </section>
  );
};

const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="rounded-xl bg-slate-50 ring-1 ring-slate-100 px-3 py-2.5 text-slate-900">
    <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
    <div className="mt-1 flex items-baseline gap-1.5 text-lg font-bold text-slate-900">{value}</div>
  </div>
);

function PriceChip({
  p,
  disabled,
  onClick,
}: {
  p: number;
  warn?: boolean;
  disabled?: boolean;
  onClick: (p: number) => void | Promise<void>;
}) {
  return (
    <button
      aria-label={`Печать ${p}`}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        void onClick(p);
      }}
      className={`rounded-xl px-3.5 py-1.5 text-[13px] font-bold tabular-nums tracking-tight
        transition-all duration-150 focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-1
        ${
          disabled
            ? 'cursor-not-allowed opacity-30 bg-slate-100 text-slate-400 ring-1 ring-slate-200'
            : 'bg-gradient-to-b from-cyan-400 to-cyan-500 text-white shadow-[0_2px_8px_rgba(34,211,238,0.35)] hover:from-cyan-300 hover:to-cyan-400 hover:shadow-[0_4px_14px_rgba(34,211,238,0.45)] active:scale-[0.97]'
        }`}
    >
      {p}
    </button>
  );
}

/* ────────── грид дефицитов ────────── */

function TypeShortageGrid({
  bucketShortages: _bs,
  hundredShortages: _hs,
  frameType,
  gender,
  typePlanSlots,
  totalSlots: _ts,
  printedCount,
  typeActivePrices,
  typeSuggestPrices,
  onQuickPrint,
  printingAvailable,
  fixedPrices,
}: {
  bucketShortages: BucketShortage[];
  hundredShortages: HundredShortage[];
  frameType: FrameTypeCode;
  gender: GenderCode;
  typePlanSlots?: number;
  totalSlots: number;
  printedCount: number;
  typeActivePrices: Record<number, number>;
  typeSuggestPrices: number[];
  onQuickPrint: (price: number) => Promise<void> | void;
  printingAvailable: boolean;
  /** Если передан — эти цены используются вместо formulaPrices (например, AI-сетка Токмока). */
  fixedPrices?: number[];
}) {
  const planSlots = typePlanSlots ?? 0;

  const rules = getTypePriceBounds(frameType, gender);
  if (!rules.min || !rules.max || rules.max <= rules.min) {
    return (
      <div className="text-xs text-slate-500">
        Неизвестный или некорректный диапазон цен для типа {frameType}. Проверь getTypePriceBounds.
      </div>
    );
  }

  const activeSum = Object.values(typeActivePrices || {}).reduce((s, v) => s + (Number.isFinite(v) ? Number(v) : 0), 0);

  /* ===================== NEW: подсветка дублей активных цен ===================== */
  const dupActivePrices = Object.entries(typeActivePrices || {})
    .map(([k, v]) => ({ p: Number(k), c: Number(v) }))
    .filter((x) => Number.isFinite(x.p) && Number.isFinite(x.c) && x.c > 1)
    .sort((a, b) => a.p - b.p);
  /* ============================================================================ */

  const soldSuggestAll = (typeSuggestPrices || []).filter((p) => {
    if (!Number.isFinite(p)) return false;
    if (p < rules.min || p > rules.max) return false;
    if ((typeActivePrices[p] || 0) > 0) return false;
    return true;
  });

  const soldSuggestUniq = Array.from(new Set(soldSuggestAll)).sort((a, b) => a - b);
  const soldSet = new Set(soldSuggestUniq);

  const remainingByPlan = planSlots > 0 ? Math.max(planSlots - activeSum, 0) : 0;
  const slotsForFormula = planSlots > 0 ? Math.max(remainingByPlan - soldSuggestUniq.length, 0) : 0;

  let formulaPrices: number[] = [];
  if (planSlots > 0 && slotsForFormula > 0) {
    const used = new Set<number>();
    Object.keys(typeActivePrices || {}).forEach((k) => {
      const num = Number(k);
      if (Number.isFinite(num)) used.add(num);
    });
    soldSuggestUniq.forEach((p) => used.add(p));

    // Если для филиала задана фиксированная сетка (например, Токмок) — берём из неё.
    // Иначе — генерируем по старой «лестнице».
    const ladderAll =
      fixedPrices && fixedPrices.length > 0
        ? [...fixedPrices]
        : generatePriceLadder(planSlots, rules.min, rules.max, PRICE_ALPHA);

    const free = ladderAll.filter((p) => !used.has(p));
    formulaPrices = free.slice(0, slotsForFormula);
  }

  const visiblePrices = planSlots > 0 ? [...soldSuggestUniq, ...formulaPrices] : soldSuggestUniq;

  const [bulk, setBulk] = useState<{ running: boolean; done: number; total: number }>({ running: false, done: 0, total: 0 });
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const handlePrintAll = async () => {
    if (!printingAvailable) return;
    if (bulk.running) return;
    if (!visiblePrices.length) return;

    const list = [...visiblePrices];
    setBulk({ running: true, done: 0, total: list.length });

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      try {
        await onQuickPrint(p);
        setBulk((prev) => ({ ...prev, done: i + 1 }));
      } catch {
        break;
      }
      await sleep(120);
    }

    setBulk((prev) => ({ ...prev, running: false }));
  };

  if (planSlots <= 0 && visiblePrices.length === 0) {
    return <div className="text-xs text-slate-500">Для этого вида сейчас нет плана и нет проданных оправ без нового ценника.</div>;
  }

  if (planSlots > 0 && remainingByPlan <= 0 && visiblePrices.length === 0) {
    return (
      <div className="text-xs text-cyan-700">
        План по этому виду выполнен: на полке {activeSum} из {planSlots} слотов. Напечатано всего {printedCount}. Новые цены можно печатать вручную выше.
      </div>
    );
  }

  if (visiblePrices.length === 0) {
    return (
      <div className="text-xs text-slate-500">
        Сейчас по этому виду нет проданных оправ без нового ценника, а формула не смогла подобрать новые значения в заданном диапазоне. Можно печатать цены вручную выше.
      </div>
    );
  }

  const handleChipClick = async (p: number) => {
    try {
      await onQuickPrint(p);
    } catch {
      /* logged выше */
    }
  };

  return (
    <div className="space-y-3">
      {dupActivePrices.length > 0 && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-800">
          <div className="font-semibold">Найдены дубли активных ценников (нарушение «1 цена = 1 ценник»):</div>
          <div className="mt-1">
            {dupActivePrices.map((x) => (
              <span key={x.p} className="mr-2 inline-flex rounded-xl border border-sky-200 bg-white px-2 py-0.5 font-mono">
                {x.p}×{x.c}
              </span>
            ))}
          </div>
          <div className="mt-1 text-[10px] text-sky-700">
            Удали лишние (void) в БД по дубликатам и физически убери лишний ценник с витрины.
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="flex flex-wrap gap-2 flex-1">
          {visiblePrices.map((p) => (
            <PriceChip key={p} p={p} warn={soldSet.has(p)} disabled={!printingAvailable || bulk.running} onClick={handleChipClick} />
          ))}
        </div>
        <button
          onClick={() => {
            if (!window.confirm(`Распечатать все ${visiblePrices.length} ценников?`)) return;
            void handlePrintAll();
          }}
          disabled={!printingAvailable || bulk.running || visiblePrices.length === 0}
          title={`Печатать все ${visiblePrices.length} ценников`}
          className="inline-flex items-center justify-center h-8 w-8 rounded-xl bg-cyan-500 text-white shadow-[0_2px_8px_rgba(34,211,238,0.30)] hover:bg-cyan-400 active:scale-[.95] disabled:opacity-30 disabled:cursor-not-allowed transition shrink-0"
        >
          {bulk.running ? <span className="text-[10px] font-bold">{bulk.done}/{bulk.total}</span> : <Printer className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
