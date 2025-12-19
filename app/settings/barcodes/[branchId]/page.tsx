'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import getSupabase from '@/lib/supabaseClient';
import toast from 'react-hot-toast';

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

/** Дефолтная ёмкость витрин по названию филиала */
const BRANCH_CAPACITY: Record<string, number> = {
  Сокулук: 120,
  Беловодск: 100,
  'Кара-Балта': 168,
  Кант: 120,
  Токмок: 100,
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
  RP: { min: 800, max: 2200 }, // чтение пластик
  RM: { min: 1000, max: 2400 }, // чтение металл
  KD: { min: 800, max: 3500 }, // детские
  PA: { min: 1000, max: 3200 }, // пластик взрослый
  MA: { min: 1200, max: 10000 }, // металл взрослый (включая дорогие)
};

/** Границы цен с учётом типа И пола (одна точка правды) */
function getTypePriceBounds(
  type: FrameTypeCode,
  gender: GenderCode,
): { min: number; max: number } {
  const base = FRAME_TYPE_PRICE_RULES[type];
  if (!base) {
    return { min: 0, max: 0 };
  }

  let { min, max } = base;

  // Чтение пластик: только женские, 800–2200
  if (type === 'RP') {
    min = 800;
    max = 2200;
  }

  // Чтение металл: только женские, 1000–2400
  if (type === 'RM') {
    min = 1000;
    max = 2400;
  }

  // Детские: М/Ж, 800–3500
  if (type === 'KD') {
    min = 800;
    max = 3500;
  }

  // Пластик взрослый:
  //   F: 1000–3000
  //   M: 1200–3200
  if (type === 'PA') {
    if (gender === 'F') {
      min = 1000;
      max = 3000;
    } else {
      min = 1200;
      max = 3200;
    }
  }

  // Металл взрослый:
  //   F: 1200–9000
  //   M: 1400–10000
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

const PRICE_ALPHA = 3.4;

function generatePriceLadder(
  count: number,
  minPrice: number,
  maxPrice: number,
  alpha = PRICE_ALPHA,
): number[] {
  if (count <= 0 || maxPrice <= minPrice) return [];

  const prices: number[] = [];

  for (let i = 1; i <= count; i++) {
    // нормированный индекс (0..1)
    const q = (i - 0.5) / count;

    // ядро формулы:
    // p_raw = Pmin + (Pmax - Pmin) * q^alpha
    const raw = minPrice + (maxPrice - minPrice) * Math.pow(q, alpha);

    // базовое округление ДО ДЕСЯТКОВ:
    // 10 * round(p_raw / 10)
    let p = 10 * Math.round(raw / 10);

    // === fixRules ===

    // 1) До 3000 запрещаем ...00 (1200 → 1210, 2300 → 2310)
    if (p < 3000 && p % 100 === 0) {
      p += 10;
    }

    // 2) От 3000 и выше – только сотни (...00)
    if (p >= 3000) {
      p = 100 * Math.round(p / 100);
    }

    // 3) Жёсткие границы типа
    if (p < minPrice) p = minPrice;
    if (p > maxPrice) p = maxPrice;

    prices.push(p);
  }

  // 4) Строго растущий ряд:
  // шаг 10 до 3000, 100 после 3000
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

/**
 * Правило окончаний:
 *  - до 3000: только десятки (…10, …20, …90), без …00
 *  - от 3000 и выше: только сотни (…00),
 *    примеры: 3100, 4400, 7000, 7900, 8600, 9000.
 *
 * base — начало сотенного диапазона, например 1500 или 3700.
 */
// Окончания для цен ниже 3000: только десятки, без «00»
const ENDINGS_BELOW_3000 = [10, 20, 30, 40, 50, 60, 70, 80, 90];

/**
 * Делает "пирамиду" окончаний:
 * если нужно k < endings.length, обрезаем симметрично с краёв.
 *
 * Примеры:
 *  - takeEndingsPyramid([10,20,30,40,50,60,70,80,90], 5)
 *    → [20,30,40,50,60]
 *  - takeEndingsPyramid([...], 3)
 *    → [30,40,50]
 */
function takeEndingsPyramid(endings: number[], k: number): number[] {
  if (k >= endings.length) return [...endings];
  if (k <= 0) return [];
  const drop = endings.length - k;
  const left = Math.floor(drop / 2);
  const right = Math.ceil(drop / 2);
  return endings.slice(left, endings.length - right);
}

function generateOptionsForHundred(
  base: number,
  count: number,
  min: number,
  max: number,
): number[] {
  const hi = base + 99;

  // 1) Вся сотня лежит ниже 3000 → играем десятками
  if (hi < 3000) {
    const endings = takeEndingsPyramid(ENDINGS_BELOW_3000, count);
    const candidates = endings.map((e) => base + e);
    return candidates.filter((p) => p >= min && p <= max);
  }

  // 2) С 3000 и выше → только круглые сотни: 3000, 3100, 3200, …, 9000
  const price = base; // base кратен 100
  if (price < min || price > max) return [];
  return [price];
}

function normalizeCountsToTarget(
  counts: number[],
  target: number,
  minPerSeg = 1,
): number[] {
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

/* ────────── непрерывная «горка» по цене (бета-распределение) ────────── */

const GLOBAL_PRICE_MIN = BUCKETS[0].min;
const GLOBAL_PRICE_MAX = BUCKETS[BUCKETS.length - 1].max;
const GLOBAL_PRICE_SPAN = GLOBAL_PRICE_MAX - GLOBAL_PRICE_MIN;

/** Переводим цену в [0,1] */
function priceToRel(p: number): number {
  if (GLOBAL_PRICE_SPAN <= 0) return 0.5;
  const t = (p - GLOBAL_PRICE_MIN) / GLOBAL_PRICE_SPAN;
  return Math.min(1, Math.max(0, t));
}

/** Гладкая «горка»: мало очень дешёвых, максимум на низко-средних, длинный хвост в премиум */
function priceDensity01(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  const alpha = 3;
  const beta = 7;
  return Math.pow(t, alpha - 1) * Math.pow(1 - t, beta - 1);
}

/** Вес для конкретной цены (мы не нормируем, нам важны относительные веса) */
function priceWeight(p: number): number {
  return priceDensity01(priceToRel(p));
}
function pickSpreadSubset(sorted: number[], k: number): number[] {
  // 1) убираем дубликаты и сортируем
  const uniq = Array.from(new Set(sorted)).sort((a, b) => a - b);
  const n = uniq.length;

  if (k <= 0) return [];
  if (k >= n) return [...uniq];

  // 1 элемент → просто середина диапазона
  if (k === 1) {
    return [uniq[Math.floor((n - 1) / 2)]];
  }

  // 2+ элементов → всегда берём ПЕРВУЮ и ПОСЛЕДНЮЮ,
  // остальное равномерно растягиваем по всему диапазону
  const out: number[] = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.round((i * (n - 1)) / (k - 1));
    out.push(uniq[idx]);
  }

  return out;
}

/** Берём случайное подмножество цен, чтобы не плодить десятки кружков */
function pickRandomSubset<T>(arr: T[], k: number): T[] {
  if (k <= 0 || arr.length === 0) return [];
  const maxK = Math.min(k, arr.length);
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, maxK);
}

/* ────────── геометрия этикетки ────────── */

const DPI = 203;
const mmToDots = (mm: number) => Math.round((mm * DPI) / 25.4);
const LABEL_W_MM = 70;
const LABEL_H_MM = 12;

/* ────────── canvas → 1bpp ────────── */

async function ensureCanvasFonts() {
  try {
    await (document as any).fonts.load('22px "Kiona"');
    await (document as any).fonts.load('30px "Nunito"');
  } catch {
    /* ну и ладно */
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

/* ────────── helpers для штрихкода ────────── */

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

function buildBitmapJobBase64(priceText: string, barcode: string): string {
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
  ctx.font = '22px "Kiona"';
  ctx.textBaseline = 'top';
  ctx.fillText('REFOCUS+', 3, 0);

  ctx.font = '46px "Nunito"';
  ctx.textBaseline = 'top';
  ctx.fillText(priceText, 10, 26);

  const mono = canvasToMonoBytes(ctx, blockW, blockH, 200, true);
  const wBytes = Math.ceil(blockW / 8);

  const SHIFT_TEXT_LEFT = mmToDots(15);
  const SHIFT_BC_LEFT = mmToDots(7);
  const SHIFT_BC_DOWN = mmToDots(2);

  const BASE_LEFT_X = 160;
  const BASE_LEFT_Y = 12;

  const BASE_BC_X = 460;
  const BASE_BC_Y = 8;
  const BC_H = 30;
  const BC_NARROW = 1;
  const BC_WIDE = 2;

  const LEFT_X = Math.max(0, BASE_LEFT_X - SHIFT_TEXT_LEFT);
  const LEFT_Y = BASE_LEFT_Y;

  const BC_X = Math.max(0, BASE_BC_X - SHIFT_BC_LEFT);
  const BC_Y = BASE_BC_Y + SHIFT_BC_DOWN;

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

type Branch = { id: number; name: string; code: string | null };
type TypeActiveMap = Record<string, Record<number, number>>;
// key: "PA_F", value: { 1410: 1, 1530: 2, ... }

type BucketCounts = {
  totalByBucket: Record<BucketId, number>;
  totalOverall: number;
  perHundred: Record<string, number>;
};
type HundredShortage = {
  bucketId: BucketId;
  priceRange: string; // "1900-1999"
  hundredBase: number; // 1900
  shortage: number; // printed_count - active_count (>0)
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

/* ────────── секции по типам (тип + пол + вид) ────────── */
/* Чтение женские: делим на пластик 14 и металл 14 из 168 */

const TYPE_SECTIONS = [
  {
    id: 'RD_PL_F',
    title: 'Для чтения · Женские пластик',
    typeCode: 'RP' as FrameTypeCode,
    gender: 'F' as GenderCode,
  },
  {
    id: 'RD_MT_F',
    title: 'Для чтения · Женские металл',
    typeCode: 'RM' as FrameTypeCode,
    gender: 'F' as GenderCode,
  },
  {
    id: 'KD_F',
    title: 'Детские · Девочки',
    typeCode: 'KD' as FrameTypeCode,
    gender: 'F' as GenderCode,
  },
  {
    id: 'KD_M',
    title: 'Детские · Мальчики',
    typeCode: 'KD' as FrameTypeCode,
    gender: 'M' as GenderCode,
  },
  {
    id: 'PA_F',
    title: 'Взрослый пластик · Женские',
    typeCode: 'PA' as FrameTypeCode,
    gender: 'F' as GenderCode,
  },
  {
    id: 'PA_M',
    title: 'Взрослый пластик · Мужские',
    typeCode: 'PA' as FrameTypeCode,
    gender: 'M' as GenderCode,
  },
  {
    id: 'MA_F',
    title: 'Взрослый металл · Женские',
    typeCode: 'MA' as FrameTypeCode,
    gender: 'F' as GenderCode,
  },
  {
    id: 'MA_M',
    title: 'Взрослый металл · Мужские',
    typeCode: 'MA' as FrameTypeCode,
    gender: 'M' as GenderCode,
  },
] as const;

type TypeSection = (typeof TYPE_SECTIONS)[number];
type TypeSectionId = TypeSection['id'];

/** Видовая формула (из 168 мест Кара-Балты, масштабируется под totalSlots)
 * RD_PL_F 14, RD_MT_F 14,
 * KD_M 7, KD_F 7,
 * PA_F 35, MA_F 35,
 * PA_M 28, MA_M 28
 */
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

/* ────────── варианты оформления секций ────────── */

type SectionVariant =
  | 'default'
  | 'reading'
  | 'kidsGirls'
  | 'kidsBoys'
  | 'plasticF'
  | 'plasticM'
  | 'metalF'
  | 'metalM';

function getSectionVariant(sec: TypeSection): SectionVariant {
  if (sec.typeCode === 'RP' || sec.typeCode === 'RM') return 'reading';
  if (sec.typeCode === 'KD' && sec.gender === 'F') return 'kidsGirls';
  if (sec.typeCode === 'KD' && sec.gender === 'M') return 'kidsBoys';
  if (sec.typeCode === 'PA' && sec.gender === 'F') return 'plasticF';
  if (sec.typeCode === 'PA' && sec.gender === 'M') return 'plasticM';
  if (sec.typeCode === 'MA' && sec.gender === 'F') return 'metalF';
  if (sec.typeCode === 'MA' && sec.gender === 'M') return 'metalM';
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

  // Для этих филиалов отключаем автоматические подсказки «к допечатке»
  const disableAutoSuggest = useMemo(
    () =>
      branch != null &&
      BRANCHES_WITHOUT_AUTO_REPLENISH.includes(branch.name),
    [branch],
  );

  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>(
    'idle',
  );
  const [printers, setPrinters] = useState<string[]>([]);
  const [printer, setPrinter] = useState<string>('');
  const connecting = useRef(false);

  const [price, setPrice] = useState<string>('2500');
  const yy = useMemo(() => String(new Date().getFullYear()).slice(2), []);
  const branchCode = useMemo(() => branch?.code || 'RF', [branch?.code]);

  const [frameType, setFrameType] = useState<FrameTypeCode>('PA');
  const [gender, setGender] = useState<GenderCode>('F');

  // сколько ценников уже напечатано по (типу, полу) для этого филиала и года
  const [printedByType, setPrintedByType] = useState<Record<string, number>>({});
  const [typeActive, setTypeActive] = useState<TypeActiveMap>({});
  // Цены, по которым есть продажи, но нет ни одного активного ценника (крючок пустой)
  const [typeSuggest, setTypeSuggest] = useState<Record<string, number[]>>({});

  const barcodePrefix = useMemo(
    () => `${branchCode}${frameType}${gender}${yy}`,
    [branchCode, frameType, gender, yy],
  );

  const [serial, setSerial] = useState<number>(DEFAULT_SERIAL);
  const nextBarcode = useMemo(
    () => `${barcodePrefix}${String(serial).padStart(SERIAL_LEN, '0')}`,
    [barcodePrefix, serial],
  );

  const [totalSlots, setTotalSlots] = useState<number>(0);

  const [counts, setCounts] = useState<BucketCounts>(() => ({
    totalByBucket: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    totalOverall: 0,
    perHundred: {},
  }));

  const [hundredShortages, setHundredShortages] = useState<HundredShortage[]>([]);

  /* загрузка филиала */

  useEffect(() => {
    if (!branchId || Number.isNaN(branchId)) {
      setBranchError('Некорректный ID филиала');
      setBranchLoading(false);
      return;
    }

    (async () => {
      try {
        const sb = getSupabase();
        const { data, error } = await sb
          .from('branches')
          .select('id, name, code')
          .eq('id', branchId)
          .maybeSingle();

        if (error) throw error;
        if (!data) {
          setBranchError('Филиал не найден');
        } else {
          setBranch(data as Branch);
        }
      } catch (e: any) {
        setBranchError(e?.message || 'Ошибка загрузки филиала');
      } finally {
        setBranchLoading(false);
      }
    })();
  }, [branchId]);

  useEffect(() => {
    if (frameType === 'RP' || frameType === 'RM') {
      setGender('F');
    }
  }, [frameType]);

  /* totalSlots из localStorage / дефолт по филиалу */

  useEffect(() => {
    if (!branchId) return;

    try {
      const saved = localStorage.getItem(`ui.branchSlots.${branchId}`);

      // 1) Пытаемся взять сохранённое значение
      if (saved != null) {
        const parsed = Number(JSON.parse(saved));
        // считаем валидным ТОЛЬКО положительное число
        if (Number.isFinite(parsed) && parsed > 0) {
          setTotalSlots(parsed);
          return; // дефолт уже не нужен
        }
      }

      // 2) Если ничего нормального не сохранено — берём дефолт по филиалу
      if (branch?.name) {
        const def = BRANCH_CAPACITY[branch.name] ?? 0;
        if (def > 0) {
          setTotalSlots(def);
        }
      }
    } catch {
      /* пофиг */
    }
  }, [branchId, branch?.name]);

  // сохраняем только валидные значения (>0), чтобы не затирать дефолт нулями
  useEffect(() => {
    if (!branchId) return;
    if (!Number.isFinite(totalSlots) || totalSlots <= 0) return;

    try {
      localStorage.setItem(`ui.branchSlots.${branchId}`, JSON.stringify(totalSlots));
    } catch {
      /* пофиг */
    }
  }, [branchId, totalSlots]);

  /* серийник */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!branchId || Number.isNaN(branchId)) return;
        const yearNum = Number(yy) || (new Date().getFullYear() % 100);
        const dbNext = await fetchDbNextSerial(branchId, frameType, gender, yearNum);
        if (!cancelled) {
          setSerial((s) => Math.max(s, dbNext));
        }
      } catch (e: any) {
        console.error('sync serial error', e?.message || e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branchId, frameType, gender, yy]);

  // Подгружаем из БД уже напечатанные ценники по видам (тип + пол) для этого филиала и года
  useEffect(() => {
    if (!branchId || Number.isNaN(branchId)) return;

    const loadPrintedByType = async () => {
      try {
        const sb = getSupabase();
        const yearNum = Number(yy) || (new Date().getFullYear() % 100);

        const { data, error } = await sb
          .from('frame_barcodes')
          .select('type_code, gender')
          .eq('branch_id', branchId)
          .eq('year', yearNum);

        if (error) throw error;

        const map: Record<string, number> = {};

        for (const row of (data || []) as any[]) {
          const t = row.type_code as FrameTypeCode | null | undefined;
          const g = row.gender as GenderCode | null | undefined;
          if (!t || !g) continue;
          const key = makeTypeKey(t, g);
          map[key] = (map[key] || 0) + 1;
        }

        setPrintedByType(map);
      } catch (e: any) {
        console.error('load printedByType error', e?.message || e);
      }
    };

    void loadPrintedByType();
  }, [branchId, yy]);

  const BUCKET_PCT_MAP: Record<BucketId, number> = {
    1: PCT.b1,
    2: PCT.b2,
    3: PCT.b3,
    4: PCT.b4,
    5: PCT.b5,
  };

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

  /* загрузка матрицы по филиалу */

  const fetchCounts = useCallback(async () => {
    if (!branchId) return;

    try {
      const sb = getSupabase();

      const { data, error } = await sb
        .from('frame_price_matrix_branch_v2')
        .select('bucket_id, price_range, printed_count, sold_count, active_count')
        .eq('branch_id', branchId);

      if (error) throw error;

      const totalByBucket: Record<BucketId, number> = {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
      };
      const perHundred: Record<string, number> = {};
      let totalOverall = 0;

      const shortages: HundredShortage[] = [];

      for (const row of (data || []) as any[]) {
        const bId = Number(row.bucket_id) as BucketId;
        const printed = Number(row.printed_count) || 0;
        const sold = Number(row.sold_count) || 0;

        const activeRaw = row.active_count;
        const active = Number.isFinite(activeRaw)
          ? Number(activeRaw)
          : Math.max(printed - sold, 0);

        const rangeKey = String(row.price_range || '');

        if (![1, 2, 3, 4, 5].includes(bId)) continue;

        // активные ценники (то, что реально висит на полке)
        if (active > 0) {
          totalByBucket[bId] = (totalByBucket[bId] || 0) + active;
          totalOverall += active;
          if (rangeKey) {
            perHundred[rangeKey] = active;
          }
        }

        // дефицит по крючкам: printed_count > active_count
        if (printed > active && rangeKey) {
          const basePart = rangeKey.split('-')[0] ?? '';
          const base = Number.parseInt(basePart, 10);
          if (Number.isFinite(base)) {
            shortages.push({
              bucketId: bId,
              priceRange: rangeKey,
              hundredBase: base,
              shortage: printed - active,
            });
          }
        }
      }

      setCounts({ totalByBucket, totalOverall, perHundred });
      setHundredShortages(shortages);
    } catch (e: any) {
      console.error(e);
      log(`Ошибка загрузки баланса: ${e?.message || String(e)}`);
    }
  }, [branchId, log]);

  // Активные ценники и "пустые крючки" по типам (тип + пол + точная цена)
  const fetchTypeActive = useCallback(async () => {
    if (!branchId || Number.isNaN(branchId)) return;

    try {
      const sb = getSupabase();
      const yearNum = Number(yy) || (new Date().getFullYear() % 100);

      const { data, error } = await sb
        .from('frame_barcodes')
        .select('type_code, gender, price, sold_at')
        .eq('branch_id', branchId)
        .eq('year', yearNum);

      if (error) throw error;

      const activeMap: TypeActiveMap = {};
      const totalMap: TypeActiveMap = {};

      for (const row of (data || []) as any[]) {
        const t = row.type_code as FrameTypeCode | null | undefined;
        const g = row.gender as GenderCode | null | undefined;
        const priceNum = Number(row.price);

        if (!t || !g || !Number.isFinite(priceNum) || priceNum <= 0) continue;

        const key = makeTypeKey(t, g);

        if (!totalMap[key]) totalMap[key] = {};
        if (!activeMap[key]) activeMap[key] = {};

        // сколько всего ценников с такой ценой
        totalMap[key][priceNum] = (totalMap[key][priceNum] || 0) + 1;

        // активные (висят на витрине)
        if (!row.sold_at) {
          activeMap[key][priceNum] = (activeMap[key][priceNum] || 0) + 1;
        }
      }

      // считаем "пустые крючки": продали, а активного ценника нет
      const suggestMap: Record<string, number[]> = {};

      for (const key of Object.keys(totalMap)) {
        const totalPrices = totalMap[key];
        const activePrices = activeMap[key] || {};
        const list: number[] = [];

        for (const priceStr of Object.keys(totalPrices)) {
          const priceNum = Number(priceStr);
          if (!Number.isFinite(priceNum)) continue;

          const total = totalPrices[priceNum] || 0;
          const active = activePrices[priceNum] || 0;
          const sold = Math.max(total - active, 0);

          // есть продажи, но ни одного активного ценника → надо повесить
          if (sold > 0 && active === 0) {
            list.push(priceNum);
          }
        }

        if (list.length) {
          suggestMap[key] = list.sort((a, b) => a - b);
        }
      }

      setTypeActive(activeMap);

      // Для Канта/Токмока не показываем список «продали, но крючок пустой»
      setTypeSuggest(disableAutoSuggest ? {} : suggestMap);
    } catch (e: any) {
      console.error('load typeActive error', e?.message || e);
      log(`Ошибка загрузки активных цен по видам: ${e?.message || String(e)}`);
    }
  }, [branchId, yy, log, disableAutoSuggest]);

  useEffect(() => {
    void fetchCounts();
  }, [fetchCounts]);
  useEffect(() => {
    void fetchTypeActive();
  }, [fetchTypeActive]);

  /* дефициты по корзинам/соткам (общие для филиала, по ценам) */

  const bucketShortages = useMemo<BucketShortage[]>(() => {
    // Для Канта/Токмока не считаем дефицит по ценовым корзинам,
    // чтобы не подсказывать автоматическую «допечатку».
    if (disableAutoSuggest) {
      return [];
    }

    const out: BucketShortage[] = [];

    for (const b of BUCKETS) {
      const targetBucket = bucketTargets[b.id] ?? 0;
      const haveBucket = counts.totalByBucket[b.id] || 0;
      const needBucket = Math.max(0, targetBucket - haveBucket);

      if (targetBucket <= 0) continue;

      // делим корзину на сотенные сегменты
      const segDefs: { label: string; base: number; segKey: string }[] = [];
      for (let base = Math.ceil(b.min / 100) * 100; base <= b.max; base += 100) {
        const hi = Math.min(base + 99, b.max);
        segDefs.push({
          label: `${base}–${hi}`,
          base,
          segKey: `${base}-${base + 99}`,
        });
      }

      // веса по глобальной кривой для центра сегмента
      const weights = segDefs.map((seg) => {
        const hi = Number(seg.label.split('–')[1]) || seg.base + 99;
        const midPrice = (seg.base + hi) / 2;
        return priceWeight(midPrice);
      });

      const sumW = weights.reduce((s, w) => s + w, 0);
      let rawCounts: number[];
      if (sumW <= 0) {
        rawCounts = segDefs.map(() => 1);
      } else {
        rawCounts = weights.map((w) => (w / sumW) * Math.max(0, targetBucket));
      }

      const desiredCounts = normalizeCountsToTarget(
        rawCounts,
        Math.max(0, targetBucket),
        1,
      );

      const segments: BucketShortage['segments'] = [];

      segDefs.forEach((segDef, idx) => {
        const countGoal = Math.min(desiredCounts[idx] ?? 0, 9);
        if (countGoal <= 0) return;

        const haveSeg = counts.perHundred[segDef.segKey] || 0;
        const needSeg = Math.max(0, countGoal - haveSeg);
        if (needSeg <= 0) return;

        // генерируем варианты только на остаток, который ещё нужен
        const quickPrices = generateOptionsForHundred(
          segDef.base,
          needSeg,
          b.min,
          b.max,
        );
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

      out.push({
        bucket: b,
        targetBucket,
        haveBucket,
        needBucket,
        segments,
      });
    }

    return out;
  }, [bucketTargets, counts, disableAutoSuggest]);

  const shortagesTotal = useMemo(
    () => bucketShortages.reduce((sum, b) => sum + Math.max(0, b.needBucket), 0),
    [bucketShortages],
  );

  /* Видовой план (масштабируем пропорции Кара-Балты на текущие totalSlots) */

  const typePlans = useMemo(() => {
    const res: Record<TypeSectionId, { slots: number; pct: number }> = {} as any;
    TYPE_SECTIONS.forEach((sec) => {
      const share = TYPE_SLOT_SHARE[sec.id] ?? 0;
      const slots = Math.round(totalSlots * share);
      const pct = Math.round(share * 1000) / 10; // одна цифра после запятой
      res[sec.id] = { slots, pct };
    });
    return res;
  }, [totalSlots]);

  /* QZ подключение */

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
      const chosen =
        list.find((n) => /RAW|TSPL|DIRECT|GENERIC/i.test(n)) || list[0] || '';
      setPrinter(chosen);
      if (chosen) log(`Принтер: ${chosen}`);
    } catch (e: any) {
      setStatus('error');
      log(e?.message || String(e));
    } finally {
      connecting.current = false;
    }
  }, [log]);

  /* Печать ценника (общая функция) */

  const doPrint = useCallback(
    async (
      priceValue: number,
      overrides?: { typeCode?: FrameTypeCode; gender?: GenderCode },
    ) => {
      const p = Number(priceValue);
      if (!p || p <= 0) throw new Error('Введите корректную цену');
      if (!branchId || Number.isNaN(branchId)) {
        throw new Error('Неизвестный филиал (branchId).');
      }

      const actualType = overrides?.typeCode ?? frameType;
      const actualGender = overrides?.gender ?? gender;

      const typeRules = FRAME_TYPE_PRICE_RULES[actualType];
      const frameTypeMeta = FRAME_TYPES.find((t) => t.code === actualType);

      if (!typeRules) {
        throw new Error(`Неизвестный тип оправы: ${actualType}`);
      }

      // ==== НОВОЕ МЕСТО ПРОВЕРОК ПЕЧАТИ ====
      const qz = (window as any).qz;

      if (status !== 'connected') {
        throw new Error(
          'Печать недоступна: QZ не подключён. Нажмите «Подключиться к QZ» и дождитесь статуса "подключено".',
        );
      }

      if (!qz?.version) {
        throw new Error(
          'QZ не загружен. Нажмите «Подключиться к QZ» и попробуйте ещё раз.',
        );
      }

      if (!printer) {
        throw new Error('Не выбран принтер. Сначала выберите принтер вверху.');
      }
      // ==== КОНЕЦ НОВОГО БЛОКА ====

      // Базовый коридор по типу
      if (p < typeRules.min || p > typeRules.max) {
        throw new Error(
          `Для типа «${frameTypeMeta?.label ?? actualType}» допустимы цены от ${typeRules.min} до ${typeRules.max} сом.`,
        );
      }

      // Детализация по типу + полу
      if (actualType === 'RP') {
        if (actualGender !== 'F') {
          throw new Error('«Чтение · пластик» доступно только в женском варианте.');
        }
        if (p < 800 || p > 2200) {
          throw new Error('Для «Чтение · пластик» допустимы цены от 800 до 2200 сом.');
        }
      }

      if (actualType === 'RM') {
        if (actualGender !== 'F') {
          throw new Error('«Чтение · металл» доступно только в женском варианте.');
        }
        if (p < 1000 || p > 2400) {
          throw new Error('Для «Чтение · металл» допустимы цены от 1000 до 2400 сом.');
        }
      }

      if (actualType === 'KD') {
        if (p < 800 || p > 3500) {
          throw new Error('Для детских оправ допустимы цены от 800 до 3500 сом.');
        }
      }

      if (actualType === 'PA') {
        if (actualGender === 'F') {
          if (p < 1000 || p > 3000) {
            throw new Error(
              'Для женских пластиковых оправ допустимы цены от 1000 до 3000 сом.',
            );
          }
        } else {
          if (p < 1200 || p > 3200) {
            throw new Error(
              'Для мужских пластиковых оправ допустимы цены от 1200 до 3200 сом.',
            );
          }
        }
      }

      if (actualType === 'MA') {
        if (actualGender === 'F') {
          if (p < 1200 || p > 9000) {
            throw new Error(
              'Для женских металлических оправ допустимы цены от 1200 до 9000 сом.',
            );
          }
        } else {
          if (p < 1400 || p > 10000) {
            throw new Error(
              'Для мужских металлических оправ допустимы цены от 1400 до 10000 сом.',
            );
          }
        }
      }

      const sb = getSupabase();
      const yearNum = Number(yy) || (new Date().getFullYear() % 100);

      const makeBarcode = (serialNum: number) =>
        `${branchCode}${actualType}${actualGender}${yy}${String(serialNum).padStart(
          SERIAL_LEN,
          '0',
        )}`;

      let currentSerial = Math.max(
        serial,
        await fetchDbNextSerial(branchId, actualType, actualGender, yearNum),
      );

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
          year: yearNum,
          serial: currentSerial,
        });
        if (!error) {
          usedBarcode = candidate;
          setSerial(currentSerial + 1);
          break;
        }
        const msg = String(error?.message || '');
        const code = (error as any)?.code;
        if (code === '23505' || /duplicate|unique|exists|constraint/i.test(msg)) {
          currentSerial += 1;
          continue;
        }
        throw error;
      }
      if (!usedBarcode) throw new Error('Не удалось подобрать свободный штрихкод');

      // обновляем счётчики по видам (тип + пол)
      const typeKey = makeTypeKey(actualType, actualGender);
      setPrintedByType((prev) => ({
        ...prev,
        [typeKey]: (prev[typeKey] || 0) + 1,
      }));
      setTypeActive((prev) => {
        const key = makeTypeKey(actualType, actualGender);
        const prevMap = prev[key] || {};
        return {
          ...prev,
          [key]: {
            ...prevMap,
            [p]: (prevMap[p] || 0) + 1,
          },
        };
      });
      setTypeSuggest((prev) => {
        const key = makeTypeKey(actualType, actualGender);
        const arr = prev[key] || [];
        const idx = arr.indexOf(p);
        if (idx === -1) return prev;
        const nextArr = [...arr];
        nextArr.splice(idx, 1);
        return { ...prev, [key]: nextArr };
      });

      await ensureCanvasFonts();
      const b64 = buildBitmapJobBase64(String(p), usedBarcode);
      const cfg = qz.configs.create(printer, {
        legacy: true,
        altPrinting: true,
        rasterize: false,
        scaleContent: false,
      });
      await qz.print(cfg, [{ type: 'raw', format: 'base64', data: b64 }]);
      log(`Отпечатано: ${usedBarcode}`);

      const b = bucketOfPriceLocal(p);
      if (b) {
        setCounts((prev) => {
          const totalByBucket = {
            ...prev.totalByBucket,
            [b]: (prev.totalByBucket[b] || 0) + 1,
          };
          const totalOverall = prev.totalOverall + 1;
          const key = hundredKey(p);
          const perHundred = {
            ...prev.perHundred,
            [key]: (prev.perHundred[key] || 0) + 1,
          };
          return { totalByBucket, totalOverall, perHundred };
        });
      }

      const base = Math.floor(p / 100) * 100;
      setHundredShortages((prev) =>
        prev
          .map((h) =>
            h.hundredBase === base
              ? { ...h, shortage: Math.max(0, h.shortage - 1) }
              : h,
          )
          .filter((h) => h.shortage > 0),
      );
    },
    [branchId, branchCode, frameType, gender, yy, serial, printer, status, log],
  );

  const printRAW = useCallback(async () => {
    try {
      await doPrint(Number(price));
    } catch (e: any) {
      log(e?.message || String(e));
    }
  }, [price, doPrint, log]);

  const quickPrint = useCallback(
    async (priceValue: number, typeCode: FrameTypeCode, g: GenderCode) => {
      try {
        await doPrint(priceValue, { typeCode, gender: g });
      } catch (e: any) {
        log(e?.message || String(e));
        throw e; // важно: пробрасываем ошибку выше
      }
    },
    [doPrint, log],
  );

  const title = branch
    ? `Оправы и штрихкоды · ${branch.name}`
    : 'Оправы и штрихкоды · филиал';

  if (branchError) {
    return (
      <div className="mx-auto min-h-screen max-w-5xl p-6 text-sm text-slate-900">
        <header
          className="mb-4 flex items-center justify между rounded-3xl border border-sky-200 
                     bg-gradient-to-br from-white via-slate-50 to-sky-50/85 
                     px-5 py-3 shadow-[0_18px_50px_rgba(15,23,42,0.45)]"
        >
          <div className="flex items-center gap-3">
            <Link
              href="/settings/barcodes/overview"
              className="rounded-xl border border-sky-200 bg-white px-2 py-1 text-xs text-slate-800 hover:bg-sky-50"
            >
              ← Обзор по филиалам
            </Link>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">
              {title}
            </h1>
          </div>
        </header>
        <div className="rounded-2xl border border-rose-300 bg-gradient-to-r from-rose-50 via-rose-50 to-amber-50 px-4 py-3 text-xs text-rose-800 shadow-sm">
          {branchError}
        </div>
      </div>
    );
  }

  if (branchLoading) {
    return (
      <div className="mx-auto min-h-screen max-w-5xl p-6 text-sm text-slate-900">
        Загрузка филиала…
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-7xl p-4 text-sm text-slate-900 md:p-6">
      {/* Шапка */}
      <header
        className="mb-5 flex items-center justify-between rounded-3xl border border-sky-200 
                   bg-gradient-to-br from-white via-slate-50 to-sky-50 
                   px-5 py-3 shadow-[0_22px_60px_rgba(15,23,42,0.55)] 
                   backdrop-blur-xl"
      >
        <div className="flex items-center gap-3">
          <Link
            href="/settings/barcodes/overview"
            className="rounded-xl border border-sky-200 bg-white px-2 py-1 text-xs text-slate-800 hover:bg-sky-50"
          >
            ← Обзор по филиалам
          </Link>
          <div className="flex items-center gap-3">
            <div
              className="grid h-9 w-9 place-items-center rounded-2xl 
                         bg-gradient-to-br from-cyan-400 via-sky-400 to-indigo-500 
                         text-[11px] font-bold text-slate-900 
                         shadow-[0_0_18px_rgba(56,189,248,0.75)]"
            >
              RF
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight text-slate-900 md:text-lg">
                {title}
              </h1>
              <div className="text-[11px] text-slate-500">
                Печать ценников по видам и ценовым корзинам этого филиала
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-sky-100 bg-white/80 px-3 py-1.5 text-[11px] text-slate-600">
            Код филиала:&nbsp;
            <span className="font-mono font-semibold text-slate-900">
              {branchCode}
              {yy}
            </span>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-medium ${
              status === 'connected'
                ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                : status === 'error'
                  ? 'bg-rose-100 text-rose-700 border border-rose-200'
                  : status === 'connecting'
                    ? 'bg-sky-100 text-sky-700 border border-sky-200'
                    : 'bg-slate-100 text-slate-600 border border-slate-200'
            }`}
          >
            {status === 'connected'
              ? 'подключено'
              : status === 'connecting'
                ? 'подключение…'
                : status === 'error'
                  ? 'ошибка'
                  : 'ожидание'}
          </span>
          <button
            onClick={connectQZ}
            className="rounded-2xl bg-gradient-to-r from-cyan-500 via-sky-500 to-indigo-500 px-3 py-2 text-xs font-semibold text-white shadow-[0_0_12px_rgba(56,189,248,0.6)] hover:brightness-110 active:scale-[.97]"
          >
            Подключиться к QZ
          </button>
        </div>
      </header>

      {/* Верхняя панель */}
      <div className="mb-5">
        <Section
          title={branch ? `Филиал «${branch.name}»` : 'Филиал'}
          aside={
            <div className="text-[11px] text-slate-500">
              План по корзинам: {PCT.b1}% / {PCT.b2}% / {PCT.b3}% / {PCT.b4}% /{' '}
              {PCT.b5}%
            </div>
          }
        >
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-sky-100 bg-white/90 p-3 shadow-sm">
              <div className="mb-1 text-xs font-medium text-slate-700">
                Всего слотов витрины
              </div>
              <input
                type="number"
                min={0}
                value={totalSlots}
                onChange={(e) => setTotalSlots(Number(e.target.value || 0))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
              />
              <div className="mt-1 text-[11px] text-slate-500">
                Доли по ценам: {PCT.b1}% / {PCT.b2}% / {PCT.b3}% / {PCT.b4}% /{' '}
                {PCT.b5}%
              </div>
            </div>
            <Stat label="Напечатано всего" value={counts.totalOverall} />
            <Stat label="Не хватает ценников (по ценам)" value={shortagesTotal} />
            <Stat
              label="Активный принтер"
              value={<span className="block truncate">{printer || 'не выбран'}</span>}
            />
          </div>
        </Section>
      </div>

      {/* График ценовой политики (распределение оправ по цене) */}
      <div className="mb-5">
        <Section
          title="Ценовая картина витрины"
          aside={
            <div className="text-[11px] text-slate-500">
              Количество активных оправ по диапазонам цен от 800 до 10&nbsp;000 сом.
            </div>
          }
        >
          <PriceDistributionChart perHundred={counts.perHundred} />
        </Section>
      </div>

      {/* Ручная печать */}
      <Section title="Печать конкретной цены">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block md:col-span-2">
            <div className="mb-1 text-xs font-medium text-slate-700">
              Цена (на этикетке)
            </div>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="например, 2450"
              className="font-nunito w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base font-bold tracking-tight"
            />
          </label>
          <label className="block">
            <div className="mb-1 text-xs font-medium text-slate-700">
              Следующий штрих-код
            </div>
            <input
              readOnly
              value={nextBarcode}
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs"
            />
          </label>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="block">
            <div className="mb-1 text-xs font-medium text-slate-700">Тип оправы</div>
            <select
              value={frameType}
              onChange={(e) => setFrameType(e.target.value as FrameTypeCode)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {FRAME_TYPES.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
            <div className="mt-1 text-[11px] text-slate-500">
              {FRAME_TYPES.find((t) => t.code === frameType)?.description}
            </div>
          </label>
          <label className="block">
            <div className="mb-1 text-xs font-medium text-slate-700">Пол</div>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as GenderCode)}
              disabled={frameType === 'RP' || frameType === 'RM'}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500"
            >
              <option value="F">Женские</option>
              <option value="M">Мужские</option>
            </select>
            {(frameType === 'RP' || frameType === 'RM') && (
              <div className="mt-1 text-[11px] text-amber-700">
                Для оправ для чтения используются только женские оправы.
              </div>
            )}
          </label>
        </div>

        <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex-1">
            <div className="mb-1 text-xs font-medium text-slate-700">Принтер</div>
            <select
              value={printer}
              onChange={(e) => setPrinter(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">— выбрать —</option>
              {printers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={printRAW}
            className="mt-2 w-full rounded-2xl bg-gradient-to-r from-cyan-500 via-sky-500 to-indigo-500 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_0_14px_rgba(56,189,248,0.6)] hover:brightness-110 active:scale-[.99] md:mt-0 md:w-auto disabled:opacity-60"
            disabled={!printer || status !== 'connected'}
          >
            🖨️ Печатать этикетку
          </button>
        </div>
      </Section>

      {/* Разделы по видам: чтение/детские/пластик/металл (премиум внутри металла) */}
      <div className="mt-5 space-y-4">
        {TYPE_SECTIONS.map((sec) => {
          const plan = typePlans[sec.id];
          return (
            <Section
              key={sec.id}
              title={sec.title}
              variant={getSectionVariant(sec)}
              aside={
                plan && plan.slots > 0 ? (
                  <span className="text-[11px] text-slate-700">
                    план {plan.slots} мест · {plan.pct.toFixed(1)}%
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-400">план 0 мест · 0%</span>
                )
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
              />
            </Section>
          );
        })}
      </div>

      {/* Лог */}
      <div className="mt-5">
        <Section title="Лог печати и ошибок">
          <textarea
            readOnly
            className="mt-1 h-48 w-full resize-none rounded-xl border border-slate-300 bg-white p-2 font-mono text-xs"
            value={lines.join('\n')}
          />
          <div className="mt-2 text-[11px] text-slate-500">
            Лог ограничен последними 400 строками.
          </div>
        </Section>
      </div>
    </div>
  );
}

function PriceDistributionChart({
  perHundred,
}: {
  perHundred: Record<string, number>;
}) {
  // Шаг для бинов на графике (агрегируем по 400 сом)
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

  const maxCount = React.useMemo(
    () => bins.reduce((m, b) => (b.count > m ? b.count : m), 0),
    [bins],
  );

  if (!total || !maxCount) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white/80 px-3 py-3 text-[11px] text-slate-500">
        Пока нет активных ценников в матрице этого филиала. График появится, когда
        вы повесите ценники на витрину.
      </div>
    );
  }

  // SVG-геометрия
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

  // Пик распределения
  let peak = bars[0];
  for (const b of bars) {
    if (b.count > peak.count) peak = b;
  }

  const midPrice = Math.round((GLOBAL_PRICE_MIN + GLOBAL_PRICE_MAX) / 2 / 100) * 100;

  return (
    <div className="rounded-2xl border border-sky-100 bg-white/90 p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between text-[11px] text-slate-600">
        <span>Каждый столбец показывает, сколько оправ в диапазоне цен.</span>
        <span>
          Всего активных:{' '}
          <span className="font-semibold text-slate-900">{total.toLocaleString('ru-RU')}</span>
        </span>
      </div>

      <div className="h-40 w-full">
        <svg
          viewBox={`0 0 ${viewW} ${viewH}`}
          preserveAspectRatio="none"
          className="h-full w-full"
        >
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

          {/* фон */}
          <rect x={0} y={0} width={viewW} height={viewH} fill="#f8fafc" opacity={0.7} />

          {/* горизонтальные линии сетки */}
          {[0.25, 0.5, 0.75, 1].map((k) => {
            const y = marginTop + plotH * (1 - k);
            return (
              <line
                key={k}
                x1={marginLeft}
                y1={y}
                x2={viewW - marginRight}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth={0.3}
                strokeDasharray="1.5 2"
              />
            );
          })}

          {/* ось X */}
          <line
            x1={marginLeft}
            y1={marginTop + plotH}
            x2={viewW - marginRight}
            y2={marginTop + plotH}
            stroke="#cbd5f5"
            strokeWidth={0.6}
          />

          {/* столбцы */}
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

          {/* обводка пикового столбца для акцента */}
          <rect
            x={peak.x - 0.4}
            y={peak.y - 0.6}
            width={peak.width + 0.8}
            height={peak.height + 1.2}
            fill="none"
            stroke="#0f172a"
            strokeWidth={0.6}
            opacity={0.7}
          />
        </svg>
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
        <span>{GLOBAL_PRICE_MIN.toLocaleString('ru-RU')} сом</span>
        <span>~{midPrice.toLocaleString('ru-RU')} сом</span>
        <span>{GLOBAL_PRICE_MAX.toLocaleString('ru-RU')} сом</span>
      </div>

      <div className="mt-1 text-[10px] text-slate-500">
        Пик:{' '}
        <span className="font-semibold text-slate-900">
          {peak.from.toLocaleString('ru-RU')}–{peak.to.toLocaleString('ru-RU')} сом
        </span>{' '}
        · {peak.count.toLocaleString('ru-RU')} оправ.
      </div>
    </div>
  );
}

/* ────────── UI helpers ────────── */

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value * 100) / max)) : 0;
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200/80">
      <div
        className="h-1 rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-500 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

const SECTION_VARIANT_CLASSES: Record<SectionVariant, string> = {
  default: 'border-sky-200 bg-gradient-to-br from-white via-slate-50 to-sky-50',
  reading: 'border-pink-200 bg-gradient-to-br from-rose-50 via-amber-50 to-rose-50',
  kidsGirls: 'border-pink-300 bg-gradient-to-br from-pink-50 via-rose-50 to-indigo-100',
  kidsBoys: 'border-cyan-300 bg-gradient-to-br from-cyan-50 via-sky-50 to-indigo-100',
  plasticF: 'border-pink-300 bg-gradient-to-br from-pink-50 via-rose-50 to-indigo-100',
  plasticM: 'border-cyan-300 bg-gradient-to-br from-cyan-50 via-sky-50 to-indigo-100',
  metalF: 'border-rose-300 bg-gradient-to-br from-rose-50 via-slate-50 to-slate-200',
  metalM: 'border-cyan-300 bg-gradient-to-br from-cyan-50 via-slate-50 to-slate-200',
};

const Section = ({
  title,
  aside,
  children,
  variant = 'default',
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  variant?: SectionVariant;
}) => (
  <section
    className={`mb-4 rounded-3xl 
               shadow-[0_14px_40px_rgba(15,23,42,0.4)] backdrop-blur-xl
               ${SECTION_VARIANT_CLASSES[variant]}`}
  >
    <div className="flex items-center justify-between gap-2 border-b border-slate-200/60 px-4 py-2.5">
      <h2 className="text-xs font-semibold text-slate-900 md:text-sm">{title}</h2>
      {aside && <div className="flex items-center gap-1 text-[11px] text-slate-600">{aside}</div>}
    </div>
    <div className="px-4 pb-3 pt-2">{children}</div>
  </section>
);

const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="rounded-2xl border border-sky-100 bg-white/90 px-4 py-2.5 text-slate-900 shadow-sm">
    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
    <div className="mt-1 flex items-baseline gap-1.5 text-lg font-semibold text-slate-900">
      {value}
    </div>
  </div>
);

function PriceChip({
  p,
  warn,
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
      className={`font-nunito rounded-2xl px-3 py-1 text-[13px] font-bold tracking-tight border shadow-sm
        transition focus-visible:ring-2 focus-visible:ring-cyan-500 
        focus-visible:ring-offset-2 focus-visible:ring-offset-slate-100
        ${
          disabled
            ? 'cursor-not-allowed opacity-40 bg-slate-100 text-slate-400 border-slate-200'
            : warn
              ? 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
              : 'bg-white text-slate-900 border-sky-100 hover:bg-cyan-50 hover:border-cyan-400'
        }`}
    >
      {p}
    </button>
  );
}

/* ────────── грид дефицитов для КОНКРЕТНОГО типа оправы ────────── */

function TypeShortageGrid({
  bucketShortages,
  hundredShortages,
  frameType,
  gender,
  typePlanSlots,
  totalSlots,
  printedCount,
  typeActivePrices,
  typeSuggestPrices,
  onQuickPrint,
  printingAvailable,
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
}) {
  const planSlots = typePlanSlots ?? 0;

  // Жёсткий коридор по типу + полу (одна точка правды)
  const rules = getTypePriceBounds(frameType, gender);

  if (!rules.min || !rules.max || rules.max <= rules.min) {
    return (
      <div className="text-xs text-rose-700">
        Неизвестный или некорректный диапазон цен для типа {frameType}. Проверь
        getTypePriceBounds.
      </div>
    );
  }

  // Сколько реально висит на витрине по этому виду (активные ценники)
  const activeSum = Object.values(typeActivePrices || {}).reduce(
    (s, v) => s + (Number.isFinite(v) ? Number(v) : 0),
    0,
  );

  /* 1) Реальные "пустые крючки":
        есть продажи по цене, но нет активного ценника у этого вида. */

  const soldSuggestAll = (typeSuggestPrices || []).filter((p) => {
    if (!Number.isFinite(p)) return false;
    if (p < rules.min || p > rules.max) return false;
    if ((typeActivePrices[p] || 0) > 0) return false;
    return true;
  });

  const soldSuggestUniq = Array.from(new Set(soldSuggestAll)).sort((a, b) => a - b);
  const soldSet = new Set(soldSuggestUniq);

  /* 2) Сколько слотов ещё "разрешено" планом для этого вида */

  const remainingByPlan = planSlots > 0 ? Math.max(planSlots - activeSum, 0) : 0;

  /* 3) Сколько из этого остатка отдаём под математику (формулу "горки") */

  const slotsForFormula =
    planSlots > 0 ? Math.max(remainingByPlan - soldSuggestUniq.length, 0) : 0;

  let formulaPrices: number[] = [];

  if (planSlots > 0 && slotsForFormula > 0) {
    // Генерим "идеальную лестницу" по формуле p_i = fixRules(...)
    const ladderAll = generatePriceLadder(planSlots, rules.min, rules.max, PRICE_ALPHA);

    // Цены, которые уже заняты: активные + "обязательные" (проданные)
    const used = new Set<number>();

    Object.keys(typeActivePrices || {}).forEach((k) => {
      const num = Number(k);
      if (Number.isFinite(num)) used.add(num);
    });
    soldSuggestUniq.forEach((p) => used.add(p));

    // Берём только свободные значения из лестницы
    const free = ladderAll.filter((p) => !used.has(p));

    // И ограничиваем количеством слотов, которое остались под математику
    formulaPrices = free.slice(0, slotsForFormula);
  }

  /* 4) Итоговый список:
        сначала "обязательные" (реально проданные),
        потом авто-математика по формуле. */

  const visiblePrices = planSlots > 0 ? [...soldSuggestUniq, ...formulaPrices] : soldSuggestUniq;

  const have = activeSum;
  const need = visiblePrices.length;

  // ===== НОВОЕ: печать всех цен в секции =====
  const [bulk, setBulk] = useState<{ running: boolean; done: number; total: number }>({
    running: false,
    done: 0,
    total: 0,
  });

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const handlePrintAll = async () => {
    if (!printingAvailable) return;
    if (bulk.running) return;
    if (!visiblePrices.length) return;

    const list = [...visiblePrices]; // снимок на момент клика
    setBulk({ running: true, done: 0, total: list.length });

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      try {
        await onQuickPrint(p);
        setBulk((prev) => ({ ...prev, done: i + 1 }));
      } catch {
        // Ошибка уже залогирована в quickPrint/doPrint — просто стопаем массовую печать
        break;
      }
      // небольшая пауза, чтобы не перегружать очередь печати
      await sleep(120);
    }

    setBulk((prev) => ({ ...prev, running: false }));
  };
  // ===== КОНЕЦ НОВОГО =====

  // Нет плана и нечего печатать
  if (planSlots <= 0 && visiblePrices.length === 0) {
    return (
      <div className="text-xs text-slate-500">
        Для этого вида сейчас нет плана и нет проданных оправ без нового ценника.
      </div>
    );
  }

  // План есть, все слоты заняты, нечего рекомендовать
  if (planSlots > 0 && remainingByPlan <= 0 && visiblePrices.length === 0) {
    return (
      <div className="text-xs text-emerald-700">
        План по этому виду выполнен: на полке {activeSum} из {planSlots} слотов. Напечатано
        всего {printedCount}. Новые цены можно печатать вручную выше.
      </div>
    );
  }

  // Теоретически: план есть, но ни проданных, ни формулы (очень узкий коридор)
  if (visiblePrices.length === 0) {
    return (
      <div className="text-xs text-slate-500">
        Сейчас по этому виду нет проданных оправ без нового ценника, а формула не смогла
        подобрать новые значения в заданном диапазоне. Можно печатать цены вручную выше.
      </div>
    );
  }

  const handleChipClick = async (p: number) => {
    try {
      await onQuickPrint(p);
    } catch {
      // Ошибка уже залогирована внутри quickPrint/doPrint
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-[11px] text-slate-600">
        <span>Рекомендуемые цены для этого вида</span>

        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap">
            {planSlots > 0 ? (
              <>
                план {planSlots} • на полке {have} • к печати {need}
              </>
            ) : (
              <>на полке {have} • к печати {need}</>
            )}
          </span>

          <button
            onClick={() => void handlePrintAll()}
            disabled={!printingAvailable || bulk.running || visiblePrices.length === 0}
            className="rounded-xl border border-sky-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-800 shadow-sm hover:bg-sky-50 active:scale-[.99] disabled:opacity-50 disabled:cursor-not-allowed"
            title="Распечатать все текущие рекомендованные слоты в этой секции"
          >
            {bulk.running
              ? `Печать ${bulk.done}/${bulk.total}`
              : `🖨️ Печатать все (${visiblePrices.length})`}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white/90 p-2.5 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {visiblePrices.map((p, idx) => (
            <PriceChip
              key={`${p}-${idx}`}
              p={p}
              warn={soldSet.has(p)}
              disabled={!printingAvailable || bulk.running}
              onClick={handleChipClick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
