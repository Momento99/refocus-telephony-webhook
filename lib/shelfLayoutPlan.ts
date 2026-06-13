/**
 * РАСКЛАДКА ВИТРИНЫ ТОКМОКА (380 ячеек) — версия с центросимметрией
 * ================================================================
 *
 * Принципы:
 * - A3 (chunking)
 * - B1 (anchor price-ladder)
 * - B7 (Veblen — один декой 13к на металле)
 * - C3 (vertical golden zone)
 * - C6 (mass-special separation)
 * - C7 (adjacency: плавный price gradient)
 * - D1 (Gestalt proximity — материал-чанкинг)
 * - D2 (Gestalt similarity — премиум едины через bold)
 * - E2 (self-categorization Ж|М)
 * - **B2 (center-of-gravity): все самые дорогие цены тянутся к центру зала.**
 *   Центральная вертикаль — граница MA_F | MA_M (cols 11/12 длинной стены).
 *   Левая половина зала (вход + женский длинной) растёт L→R.
 *   Правая половина (мужской длинной + дальняя) растёт R→L (зеркало).
 *
 * ────────────────────────────────────────────────────────────────
 *  Зона                            Cells   Содержимое
 * ────────────────────────────────────────────────────────────────
 *  Полка у входа 1.20м (7 кол)       42
 *    Top 4 ряда (100-160см)          28    KIDS на parent eye-level (Ж: cols 0-3 = 16 · М: cols 4-6 = 12)
 *    Bottom 2 ряда (60-80см)         14    PA_F b1 entry-tier (полные 7 кол) — budget hook
 *    PA_M из входа удалён — вход стал «женско-детским».
 *    Цены растут L→R (к центру зала справа) в обоих ярусах.
 *
 *  Длинная 4.84м (24 кол)           144    Adult fashion regular
 *    Ж (cols 0-11):  PA_F cols 0-5 (внешний) → MA_F cols 6-11 (внутр.) — L→R asc
 *    М (cols 12-23): MA_M cols 12-17 (внутр.) → PA_M cols 18-23 (внешн.) — R→L asc
 *
 *  Дальняя 2.00м (9 кол)             54    Reading — ВЕРТИКАЛЬНЫЕ полосы
 *    cols 0-3 — RM_F=24 (металл, ближе к центру), cols 4-8 — RP_F=30 (пластик, внешний край).
 *    Pyramid peak в col 0 row 5 (RM_F ~4000), low в col 8 row 0 (RP_F ~790).
 *
 *  Островок (4 блока × 7×5)         140
 *    Пирамида цен сходится к back-to-back пику (центр между всеми 4 блоками):
 *    Block 1 (top-left,  спина=низ,  пик=row 0 col 6): pure MA_F, asc L→R вниз
 *    Block 2 (top-right, спина=низ,  пик=row 0 col 0): мужское, asc R→L вниз
 *    Block 3 (bot-left,  спина=верх, пик=row 4 col 6): pure PA_F, asc L→R вверх
 *    Block 4 (bot-right, спина=верх, пик=row 4 col 0): RL УНИСЕКС (Ж+М слитно), asc R→L вверх
 *
 *  Total                            380    ✓
 * ────────────────────────────────────────────────────────────────
 */

import {
  computeRawPrice,
  computeSectionPrices,
  computePremiumStartBucket,
  getBranchTopAnchors,
  type FrameTypeCode,
  type GenderCode,
  type SectionKey,
} from './framePricingFormula';

export type BucketLabel = 'b1' | 'b2' | 'b3' | 'b4' | 'premium' | 'anchor' | 'flat';

export interface CellAssignment {
  section: SectionKey;
  type: FrameTypeCode;
  gender: GenderCode;
  price: number;
  bucket: BucketLabel;
  /** Помечен ли как premium для целей визуализации/печати (≥4000с в KG). */
  isPremium: boolean;
}

export interface ZoneLayout {
  id: string;
  name: string;
  shortName: string;
  rows: number;
  cols: number;
  capacity: number;
  cells: (CellAssignment | null)[][];
  rowHeightsCm?: number[];
  description?: string;
  /** Семейство зоны для обобщённого рендера ('wall' — стена/полка, 'island' — блок острова). */
  kind?: 'wall' | 'island';
  /** Для двухстенной раскладки: ширина одной физической секции в колонках (рисуем разделители). */
  sectionCols?: number;
}

export type LayoutKind = 'tokmok' | 'twoWall' | 'fourCase';

export interface BranchLayout {
  branchName: string;
  totalSlots: number;
  /** Семейство раскладки: 'tokmok' (вход+длинная+дальняя+остров) | 'twoWall' (2 стены, Кант). */
  kind: LayoutKind;
  /** Упорядоченный список зон. Доступ по id (z.id) для конкретной раскладки или по z.kind для обобщённого рендера. */
  zones: ZoneLayout[];
  unplaced: CellAssignment[];
  sectionSummary: Array<{ section: SectionKey; total: number; regular: number; premium: number; anchor: number }>;
}

const ALL_SECTIONS: Array<[FrameTypeCode, GenderCode]> = [
  ['PA', 'F'], ['PA', 'M'],
  ['MA', 'F'], ['MA', 'M'],
  ['RP', 'F'], ['RM', 'F'],
  ['KD', 'F'], ['KD', 'M'],
  ['RL', 'F'], ['RL', 'M'],
];

/** Граница «премиум» в KG (для визуального выделения и печати). */
export const PREMIUM_PRICE_THRESHOLD = 4000;

/**
 * Цвета по секциям — стандартизированы для продавцов:
 *   • Розовая семья (rose)   — ЖЕНСКИЕ (Ж)
 *   • Синяя семья (sky/blue) — МУЖСКИЕ (М)
 *   • Зелёная семья (green)  — ЧТЕНИЕ (читалки выделены отдельным цветом)
 *   • Жёлтая/оранжевая       — ДЕТСКИЕ (Ж=жёлтый, М=оранжевый)
 *   • Фиолетовая семья       — БЕЗОПРАВНЫЕ (premium-fixed RL)
 *
 * Внутри одной семьи: ПЛАСТИК — светлый оттенок, МЕТАЛЛ — насыщенный.
 * Это даёт продавцу мгновенно увидеть «где какая оправа должна стоять».
 */
export const SECTION_VISUAL: Record<SectionKey, { bg: string; text: string; ring: string; label: string; full: string }> = {
  // ── Взрослые женские ──
  PA_F: { bg: 'bg-rose-100',    text: 'text-rose-800',    ring: 'ring-rose-300',    label: 'Пласт Ж', full: 'Пластик женский' },
  MA_F: { bg: 'bg-rose-300',    text: 'text-rose-900',    ring: 'ring-rose-500',    label: 'Мет Ж',   full: 'Металл женский' },
  // ── Взрослые мужские ──
  PA_M: { bg: 'bg-sky-100',     text: 'text-sky-800',     ring: 'ring-sky-300',     label: 'Пласт М', full: 'Пластик мужской' },
  MA_M: { bg: 'bg-blue-300',    text: 'text-blue-900',    ring: 'ring-blue-600',    label: 'Мет М',   full: 'Металл мужской' },
  // ── Чтение (только женские в формуле) ──
  RP_F: { bg: 'bg-green-100',   text: 'text-green-800',   ring: 'ring-green-300',   label: 'Чт пл',   full: 'Чтение пластик' },
  RM_F: { bg: 'bg-green-300',   text: 'text-green-900',   ring: 'ring-green-600',   label: 'Чт мет',  full: 'Чтение металл' },
  // ── Детские (Ж = жёлтый, М = оранжевый) ──
  KD_F: { bg: 'bg-yellow-200',  text: 'text-yellow-900',  ring: 'ring-yellow-500',  label: 'Дет Ж',   full: 'Детский Ж' },
  KD_M: { bg: 'bg-orange-300',  text: 'text-orange-900',  ring: 'ring-orange-600',  label: 'Дет М',   full: 'Детский М' },
  // ── Безоправные RL (premium-flat 6-13к, УНИСЕКС: Ж и М визуально слитно) ──
  RL_F: { bg: 'bg-purple-300',  text: 'text-purple-900',  ring: 'ring-purple-500',  label: 'БО',      full: 'Безоправные' },
  RL_M: { bg: 'bg-purple-300',  text: 'text-purple-900',  ring: 'ring-purple-500',  label: 'БО',      full: 'Безоправные' },
  // ── Не используются (формула даёт 0) ──
  RP_M: { bg: 'bg-slate-100',   text: 'text-slate-500',   ring: 'ring-slate-200',   label: '—',       full: '—' },
  RM_M: { bg: 'bg-slate-100',   text: 'text-slate-500',   ring: 'ring-slate-200',   label: '—',       full: '—' },
};

export const BUCKET_VISUAL: Record<BucketLabel, { label: string; cls: string }> = {
  b1: { label: 'b1', cls: 'bg-slate-100 text-slate-500 ring-slate-200' },
  b2: { label: 'b2', cls: 'bg-slate-200 text-slate-600 ring-slate-300' },
  b3: { label: 'b3', cls: 'bg-amber-100 text-amber-700 ring-amber-200' },
  b4: { label: 'b4', cls: 'bg-orange-100 text-orange-700 ring-orange-200' },
  premium: { label: 'PRM', cls: 'bg-cyan-500 text-white ring-cyan-300' },
  anchor: { label: 'ANCHOR', cls: 'bg-rose-500 text-white ring-rose-300' },
  flat: { label: 'flat', cls: 'bg-violet-100 text-violet-700 ring-violet-200' },
};

function classifyPrice(
  price: number,
  type: FrameTypeCode,
  gender: GenderCode,
  branchName: string,
): BucketLabel {
  if (type === 'RL') {
    // RL имеет лестницу 6000-13000. 13000 = anchor (decoy для всей RL-секции).
    // Остальные цены (6000-12000) — обычный premium-flat.
    if (price >= 13000) return 'anchor';
    return 'flat';
  }

  const anchorBuckets = getBranchTopAnchors(branchName, type, gender);
  if (anchorBuckets.length > 0) {
    const minAnchorBucket = Math.min(...anchorBuckets);
    const anchorBase = computeRawPrice(type, gender, minAnchorBucket, branchName);
    if (price >= anchorBase * 0.92) return 'anchor';
  }

  const premiumStart = computePremiumStartBucket(type, gender, branchName);
  const premiumBase = computeRawPrice(type, gender, premiumStart, branchName);
  if (price >= premiumBase * 0.85) return 'premium';

  const c1 = computeRawPrice(type, gender, 1, branchName);
  const c2 = computeRawPrice(type, gender, 2, branchName);
  const c3 = computeRawPrice(type, gender, 3, branchName);
  const c4 = computeRawPrice(type, gender, 4, branchName);

  const m12 = (c1 + c2) / 2;
  const m23 = (c2 + c3) / 2;
  const m34 = (c3 + c4) / 2;

  if (price < m12) return 'b1';
  if (price < m23) return 'b2';
  if (price < m34) return 'b3';
  return 'b4';
}

function makeZone(
  id: string,
  name: string,
  shortName: string,
  rows: number,
  cols: number,
  description?: string,
  rowHeightsCm?: number[],
): ZoneLayout {
  const cells: (CellAssignment | null)[][] = [];
  for (let r = 0; r < rows; r++) {
    cells.push(new Array<CellAssignment | null>(cols).fill(null));
  }
  return { id, name, shortName, rows, cols, capacity: rows * cols, cells, description, rowHeightsCm };
}

/** Заливает зону items по указанным рядам, col-диапазону. Возвращает остаток. */
function fillZoneRows(
  zone: ZoneLayout,
  items: CellAssignment[],
  rowsToUse: number[],
  colStart = 0,
  colEnd?: number,
): CellAssignment[] {
  const cEnd = colEnd ?? zone.cols;
  let idx = 0;
  for (const r of rowsToUse) {
    for (let c = colStart; c < cEnd; c++) {
      if (idx >= items.length) return items.slice(idx);
      if (zone.cells[r][c] !== null) continue;
      zone.cells[r][c] = items[idx];
      idx += 1;
    }
  }
  return items.slice(idx);
}

/**
 * То же, что fillZoneRows, но внутри ряда заливает справа налево (cEnd-1 → colStart).
 * Используется для зеркальных зон (мужская половина длинной стены, дальняя стена,
 * блоки 2 и 4 острова), где дешёвые цены должны быть на внешнем крае,
 * а дорогие тянуться к центру зала.
 */
function fillZoneRowsRTL(
  zone: ZoneLayout,
  items: CellAssignment[],
  rowsToUse: number[],
  colStart = 0,
  colEnd?: number,
): CellAssignment[] {
  const cEnd = colEnd ?? zone.cols;
  let idx = 0;
  for (const r of rowsToUse) {
    for (let c = cEnd - 1; c >= colStart; c--) {
      if (idx >= items.length) return items.slice(idx);
      if (zone.cells[r][c] !== null) continue;
      zone.cells[r][c] = items[idx];
      idx += 1;
    }
  }
  return items.slice(idx);
}

/** Филиалы с двухстенной раскладкой (2 плоские стены, без острова). */
const TWO_WALL_BRANCHES = new Set<string>(['Кант']);

/**
 * Собирает все ценники секций филиала из формулы, классифицирует и группирует.
 * Общий шаг для всех семейств раскладки.
 */
function buildSectionData(branchName: string): {
  get: (s: SectionKey, b: BucketLabel) => CellAssignment[];
  sectionSummary: BranchLayout['sectionSummary'];
} {
  // 1) Собираем все ценники из формулы и классифицируем.
  const all: CellAssignment[] = [];
  for (const [type, gender] of ALL_SECTIONS) {
    const prices = computeSectionPrices(type, gender, branchName);
    for (const price of prices) {
      const bucket = classifyPrice(price, type, gender, branchName);
      const isPremium = bucket === 'premium' || bucket === 'anchor' || bucket === 'flat' || price >= PREMIUM_PRICE_THRESHOLD;
      all.push({
        section: `${type}_${gender}` as SectionKey,
        type,
        gender,
        price,
        bucket,
        isPremium,
      });
    }
  }

  // 2) Группируем по секциям и тирам, сортируем по цене.
  const grouped: Partial<Record<SectionKey, Record<BucketLabel, CellAssignment[]>>> = {};
  for (const cell of all) {
    if (!grouped[cell.section]) {
      grouped[cell.section] = { b1: [], b2: [], b3: [], b4: [], premium: [], anchor: [], flat: [] };
    }
    grouped[cell.section]![cell.bucket].push(cell);
  }
  for (const sec of Object.keys(grouped) as SectionKey[]) {
    for (const b of ['b1', 'b2', 'b3', 'b4', 'premium', 'anchor', 'flat'] as const) {
      grouped[sec]![b].sort((a, b2) => a.price - b2.price);
    }
  }
  const get = (s: SectionKey, b: BucketLabel) => grouped[s]?.[b] ?? [];

  // 3) Сводка по секциям.
  const sectionSummary: BranchLayout['sectionSummary'] = [];
  for (const [type, gender] of ALL_SECTIONS) {
    const sec = `${type}_${gender}` as SectionKey;
    const cells = grouped[sec];
    if (!cells) continue;
    const total =
      cells.b1.length + cells.b2.length + cells.b3.length + cells.b4.length +
      cells.premium.length + cells.anchor.length + cells.flat.length;
    if (total === 0) continue;
    sectionSummary.push({
      section: sec,
      total,
      regular: cells.b1.length + cells.b2.length + cells.b3.length + cells.b4.length + cells.flat.length,
      premium: cells.premium.length,
      anchor: cells.anchor.length,
    });
  }

  return { get, sectionSummary };
}

/**
 * Раскладка витрины филиала. Диспетчеризует по семейству:
 *   • двухстенные филиалы (Кант) → computeTwoWallLayout
 *   • остальные формульные (Токмок) → computeTokmokLayout
 */
export function computeBranchLayout(branchName: string): BranchLayout {
  if (TWO_WALL_BRANCHES.has(branchName)) return computeTwoWallLayout(branchName);
  return computeTokmokLayout(branchName);
}

function computeTokmokLayout(branchName: string): BranchLayout {
  const { get, sectionSummary } = buildSectionData(branchName);

  // 4) Зоны.
  const heights = [60, 80, 100, 120, 140, 160];
  const wallEntry = makeZone(
    'wall_entry',
    'Полка у входа (1.20м · 7 кол)',
    'Вход',
    6,
    7,
    'Top 4 ряда — KIDS на eye-level родителя (cols 0-3 Ж=16, cols 4-6 М=12 = 28). Bottom 2 ряда — PA_F b1 entry budget hook (полные 7 кол = 14). PA_M удалён из входа.',
    heights,
  );
  const wallLong = makeZone(
    'wall_long',
    'Длинная стена (4.84м · 24 кол)',
    'Длинная',
    6,
    24,
    'Ж (cols 0-11): PA_F снаружи, MA_F внутри. М (cols 12-23): MA_M внутри, PA_M снаружи. Цены сходятся к центру cols 11-12.',
    heights,
  );
  const wallFar = makeZone(
    'wall_far',
    'Дальняя (2.00м · 9 кол)',
    'Дальняя',
    6,
    9,
    'Вертикальные полосы: cols 0-3 RM_F=24 (металл, левее, к центру) + cols 4-8 RP_F=30 (пластик, правее, к внешнему краю). RTL asc внутри каждой полосы: peak в col 0 row 5 = RM_F max (~4000), low в col 8 row 0 = RP_F min (~790).',
    heights,
  );

  const island1 = makeZone(
    'island_1',
    'Остров блок 1 — Чистый металл женский (MA_F)',
    'Остров 1',
    5,
    7,
    'Top-left. Спина блока (премиум 4-13к) — внизу дисплея. Цена растёт L→R сверху вниз: cheap top-left (~1900), peak bottom-right = anchor 13000.',
  );
  const island2 = makeZone(
    'island_2',
    'Остров блок 2 — Мужское: PA_M (верх 2р) + MA_M (низ 3р)',
    'Остров 2',
    5,
    7,
    'Top-right (зеркало 1). PA_M в верхних 2 рядах, MA_M в нижних 3. Пик bottom-left = MA_M anchor 13000.',
  );
  const island3 = makeZone(
    'island_3',
    'Остров блок 3 — Чистый пластик женский (PA_F)',
    'Остров 3',
    5,
    7,
    'Bottom-left. Спина (премиум) — наверху дисплея. Цена растёт L→R снизу вверх: cheap bottom-left, peak top-right (~7000).',
  );
  const island4 = makeZone(
    'island_4',
    'Остров блок 4 — Безоправные (УНИСЕКС)',
    'Остров 4',
    5,
    7,
    'Bottom-right. 35 ячеек RL слитно (Ж+М одинакового вида «БО»). Asc R→L снизу вверх. Cheap bottom-right (6000) → peak top-left (13000).',
  );

  let unplaced: CellAssignment[] = [];

  // ──────────────────────────────────────────────────────────────────
  // 5) ПОЛКА У ВХОДА (7 кол × 6 ряд = 42) — KIDS на eye-level родителя
  //    Top 4 ряда (rows 2-5, 100-160см): KIDS — расширены до 4 рядов (28 ячеек).
  //      · KD_F: cols 0-3 × rows 2-5 = 16 ячеек.
  //      · KD_M: cols 4-6 × rows 2-5 = 12 ячеек.
  //      Логика: родитель выбирает оправу ребёнку, KIDS должны быть видны
  //      на его eye-level (140-160см), не на полу.
  //    Bottom 2 ряда (rows 0-1, 60-80см): PA_F b1 entry-tier — бюджетный hook.
  //      · PA_F: cols 0-6 × rows 0-1 = 14 cheapest PA_F b1.
  //      Цена растёт L→R (cheap col 0 → expensive col 6, к центру зала).
  //    PA_M из входа удалён — мужской пластик только на длинной стене и в острове.
  // ──────────────────────────────────────────────────────────────────

  const kdF = [
    ...get('KD_F', 'b1'),
    ...get('KD_F', 'b2'),
    ...get('KD_F', 'b3'),
    ...get('KD_F', 'b4'),
    ...get('KD_F', 'premium'),
  ];
  const kdM = [
    ...get('KD_M', 'b1'),
    ...get('KD_M', 'b2'),
    ...get('KD_M', 'b3'),
    ...get('KD_M', 'b4'),
    ...get('KD_M', 'premium'),
  ];
  // KIDS наверху (parent eye-level): rows 2-5. Ж: cols 0-3 (16), М: cols 4-6 (12).
  // Внутри: cheap внизу KIDS-зоны (row 2), premium вверху (row 5).
  unplaced = unplaced.concat(fillZoneRows(wallEntry, kdF, [2, 3, 4, 5], 0, 4));
  unplaced = unplaced.concat(fillZoneRows(wallEntry, kdM, [2, 3, 4, 5], 4, 7));

  // PA_F b1 entry-tier — внизу, rows 0-1 всю ширину (14 ячеек). Budget hook.
  // PA_M b1 НЕ берём в entry — пул PA_M полностью уходит на длинную стену.
  const paFb1All = [...get('PA_F', 'b1')];
  const paMb1All = [...get('PA_M', 'b1')];
  const paFb1Entry = paFb1All.splice(0, 14); // 7 кол × 2 ряд = 14 cheapest PA_F b1
  unplaced = unplaced.concat(fillZoneRows(wallEntry, paFb1Entry, [0, 1], 0, 7));

  // ──────────────────────────────────────────────────────────────────
  // 6) ДЛИННАЯ СТЕНА — MATERIAL CHUNKING + ЗЕРКАЛО МЕЖДУ ПОЛОВИНАМИ
  //
  // Женская половина (cols 0-11) — без изменений, L→R asc:
  //   cols 0-5  = PA_F (внешний край)
  //   cols 6-11 = MA_F (внутр. край, к центру)
  //
  // Мужская половина (cols 12-23) — ЗЕРКАЛЬНО женской:
  //   cols 12-17 = MA_M (внутр. край, к центру) ← металл к центру
  //   cols 18-23 = PA_M (внешний край)         ← пластик снаружи
  // Заливка R→L: cheap на col 23, expensive на col 12.
  //
  // Центральная вертикаль cols 11/12 — место максимальной цены обеих половин
  // (MA_F b4 справа Ж + MA_M b4 слева М).
  // ──────────────────────────────────────────────────────────────────

  const womenPA = [
    ...paFb1All,
    ...get('PA_F', 'b2'),
    ...get('PA_F', 'b3'),
    ...get('PA_F', 'b4'),
  ];
  const womenMA = [
    ...get('MA_F', 'b1'),
    ...get('MA_F', 'b2'),
    ...get('MA_F', 'b3'),
    ...get('MA_F', 'b4'),
  ];
  const menPA = [
    ...paMb1All,
    ...get('PA_M', 'b2'),
    ...get('PA_M', 'b3'),
    ...get('PA_M', 'b4'),
  ];
  const menMA = [
    ...get('MA_M', 'b1'),
    ...get('MA_M', 'b2'),
    ...get('MA_M', 'b3'),
    ...get('MA_M', 'b4'),
  ];

  // Женская сторона: L→R asc (cheap на col 0).
  let leftoverWomenPA = fillZoneRows(wallLong, womenPA, [0, 1, 2, 3, 4, 5], 0, 6);
  let leftoverWomenMA = fillZoneRows(wallLong, womenMA, [0, 1, 2, 3, 4, 5], 6, 12);
  // Мужская сторона: R→L asc (cheap на col 23). MA_M внутри, PA_M снаружи.
  let leftoverMenMA = fillZoneRowsRTL(wallLong, menMA, [0, 1, 2, 3, 4, 5], 12, 18);
  let leftoverMenPA = fillZoneRowsRTL(wallLong, menPA, [0, 1, 2, 3, 4, 5], 18, 24);

  // ──────────────────────────────────────────────────────────────────
  // 7) ДАЛЬНЯЯ СТЕНА — Reading (9 кол × 6 ряд = 54), ВЕРТИКАЛЬНЫЕ ПОЛОСЫ
  //    cols 0-3 (4 кол × 6 ряд = 24): RM_F (металл, ближе к центру зала).
  //    cols 4-8 (5 кол × 6 ряд = 30): RP_F (пластик, у внешнего края).
  //    Внутри обеих полос RTL asc:
  //      RM_F: row 0 col 3 cheap → row 5 col 0 peak (~4000).
  //      RP_F: row 0 col 8 cheap (~790) → row 5 col 4 peak (~1640).
  //    Пик дальней стены = row 5 col 0 (top-left) = RM_F max.
  // ──────────────────────────────────────────────────────────────────

  const rmF = [
    ...get('RM_F', 'b1'),
    ...get('RM_F', 'b2'),
    ...get('RM_F', 'b3'),
    ...get('RM_F', 'b4'),
    ...get('RM_F', 'premium'),
  ];
  const rpF = [
    ...get('RP_F', 'b1'),
    ...get('RP_F', 'b2'),
    ...get('RP_F', 'b3'),
    ...get('RP_F', 'b4'),
  ];
  // Вертикальные полосы: RTL asc от низа к верху, по всем 6 рядам.
  unplaced = unplaced.concat(fillZoneRowsRTL(wallFar, rmF, [0, 1, 2, 3, 4, 5], 0, 4));
  unplaced = unplaced.concat(fillZoneRowsRTL(wallFar, rpF, [0, 1, 2, 3, 4, 5], 4, 9));

  // ──────────────────────────────────────────────────────────────────
  // ОСТРОВ — пирамида цен сходится к back-to-back пику (центр между всеми блоками)
  //
  // Каждый блок 7×5=35. Все блоки заливаются ASC (cheap→peak), но направление
  // зависит от того, где у блока «угол пика» (ближайший к центру 4-блочной решётки).
  //
  // Block 1 (top-left,  спина=row 0, пик=row 0 col 6): asc rows [4→0], cols [0→6]
  // Block 2 (top-right, спина=row 0, пик=row 0 col 0): asc rows [4→0], cols [6→0] (RTL)
  // Block 3 (bot-left,  спина=row 4, пик=row 4 col 6): asc rows [0→4], cols [0→6]
  // Block 4 (bot-right, спина=row 4, пик=row 4 col 0): asc rows [0→4], cols [6→0] (RTL)
  // ──────────────────────────────────────────────────────────────────

  // Сортируем helper: возвращает items по возрастанию цены.
  const asc = (arr: CellAssignment[]) =>
    arr.slice().sort((a, b) => a.price - b.price);

  // ──────────────────────────────────────────────────────────────────
  // 8) ОСТРОВ БЛОК 1 — ЧИСТО MA_F (premium + anchor + overflow)
  //    leftoverWomenMA (overflow asc) + premium asc + anchor = 35
  // ──────────────────────────────────────────────────────────────────
  const block1Items = asc([
    ...leftoverWomenMA,
    ...get('MA_F', 'premium'),
    ...get('MA_F', 'anchor'),
  ]);
  unplaced = unplaced.concat(
    fillZoneRows(island1, block1Items, [4, 3, 2, 1, 0]),
  );

  // ──────────────────────────────────────────────────────────────────
  // 9) ОСТРОВ БЛОК 2 — ВСЁ МУЖСКОЕ, ГРУППИРОВКА ПО ВИДУ (зеркало блока 1)
  //    PA_M rows 4-3 (14 items: 10 overflow + 4 premium) — далеко от пика.
  //    MA_M rows 2-1-0 (21 items: 15 overflow + 5 prem + 1 anchor) — к пику.
  //    Пик (peak) = row 0 col 0 (bottom-left) = MA_M anchor 13000.
  //    Заливка RTL: внутри ряда дешёвое справа (col 6), дорогое слева (col 0).
  // ──────────────────────────────────────────────────────────────────
  const block2_PAM = asc([
    ...leftoverMenPA,            // 10 PA_M overflow
    ...get('PA_M', 'premium'),   // 4 PA_M premium
  ]);
  const block2_MAM = asc([
    ...leftoverMenMA,            // 15 MA_M overflow
    ...get('MA_M', 'premium'),   // 5 MA_M premium
    ...get('MA_M', 'anchor'),    // 1 MA_M anchor (13000)
  ]);
  // PA_M в верхних 2 рядах (rows 4,3 в данных = display top, дальше от peak).
  unplaced = unplaced.concat(fillZoneRowsRTL(island2, block2_PAM, [4, 3]));
  // MA_M в нижних 3 рядах (rows 2,1,0 = display bottom, ближе к peak).
  unplaced = unplaced.concat(fillZoneRowsRTL(island2, block2_MAM, [2, 1, 0]));

  // ──────────────────────────────────────────────────────────────────
  // 10) ОСТРОВ БЛОК 3 — ЧИСТО PA_F (premium + overflow)
  //     32 PA_F overflow + 3 PA_F premium = 35. Без MA_F leftover.
  // ──────────────────────────────────────────────────────────────────
  const block3Items = asc([
    ...leftoverWomenPA,
    ...get('PA_F', 'premium'),
  ]);
  unplaced = unplaced.concat(
    fillZoneRows(island3, block3Items, [0, 1, 2, 3, 4]),
  );

  // ──────────────────────────────────────────────────────────────────
  // 11) ОСТРОВ БЛОК 4 — УНИСЕКС RL (Ж + М слитно, без гендер-группировки)
  //     35 ячеек: 21 RL_F + 14 RL_M, отсортированы вместе по возрастанию цены.
  //     Заливка RTL bottom-up: cheap bottom-right (row 0 col 6) → peak top-left (row 4 col 0).
  //     Внутри сортировки одинаковые цены могут идти подряд (например 2× 13000:
  //     RL_F anchor и RL_M anchor), но визуально они идентичны — одна категория «БО».
  // ──────────────────────────────────────────────────────────────────
  const block4Items = asc([
    ...get('RL_F', 'anchor'),
    ...get('RL_F', 'flat'),
    ...get('RL_M', 'anchor'),
    ...get('RL_M', 'flat'),
  ]); // 35 items asc, unisex (gender только для DB-трекинга)
  unplaced = unplaced.concat(
    fillZoneRowsRTL(island4, block4Items, [0, 1, 2, 3, 4]),
  );

  // ──────────────────────────────────────────────────────────────────
  // 12) Финальный сбор не размещённого — всё должно быть placed.
  // ──────────────────────────────────────────────────────────────────

  wallEntry.kind = 'wall';
  wallLong.kind = 'wall';
  wallFar.kind = 'wall';
  island1.kind = 'island';
  island2.kind = 'island';
  island3.kind = 'island';
  island4.kind = 'island';

  return {
    branchName,
    totalSlots: 0,
    kind: 'tokmok',
    zones: [wallEntry, wallLong, wallFar, island1, island2, island3, island4],
    unplaced,
    sectionSummary,
  };
}

/**
 * КАНТ — двухстенная раскладка (252 = 2 стены × 126; острова НЕТ).
 * СИММЕТРИЯ: фэшн по краям (пластик слева, металл справа), «спец»-категория по центру.
 *   ПРАВАЯ стена (ЖЕНСКАЯ): PA_F 9к (левый край) | ЦЕНТР чтение (RP_F 1к + RM_F 2к) | MA_F 9к +прем (правый край)
 *   ЛЕВАЯ стена (МУЖСКАЯ, зеркало): PA_M 9к (левый край) | ЦЕНТР KD_F 1к + RL_F 1к (центр) + KD_M 1к | MA_M 9к +прем (правый край)
 * Правило: каждая категория = непрерывный блок целых колонок (колонка = 6 ячеек),
 * без обрывков. Заливка по рядам снизу вверх: row 0 — дешёвое, row 5 — дорогое
 * (премиум на верхних рядах). Доли — BRANCH_SECTION_SLOT_SHARE['Кант'];
 * цены RL — явные из BRANCH_RL_EXPLICIT_PRICES['Кант'].
 */
function computeTwoWallLayout(branchName: string): BranchLayout {
  const { get, sectionSummary } = buildSectionData(branchName);

  // Все ценники секции по возрастанию цены (по всем тирам).
  const sectionCells = (sec: SectionKey): CellAssignment[] =>
    [
      ...get(sec, 'b1'), ...get(sec, 'b2'), ...get(sec, 'b3'), ...get(sec, 'b4'),
      ...get(sec, 'premium'), ...get(sec, 'anchor'), ...get(sec, 'flat'),
    ].sort((a, b) => a.price - b.price);

  const heights = [60, 80, 100, 120, 140, 160];
  const allRows = [0, 1, 2, 3, 4, 5];
  // H1: премиум на eye-level. Порядок заливки [0,1,2,3,5,4] кладёт самый дорогой
  // блок-ряд на r4 (140 см, золотая зона), второй по цене — на r5 (160 см), дешёвое — снизу.
  // Для фэшна (PA/MA). Чтение/дети/RL — обычный порядок (их «премиум» либо отсутствует,
  // либо это RL-«корона», которой место на самом верху центра).
  const eyeLevelRows = [0, 1, 2, 3, 5, 4];

  const rightWall = makeZone(
    'wall_right',
    'Правая стена — Женское + чтение (126)',
    'Правая',
    6,
    21,
    'ПРАВАЯ = женская, симметрия. ЛЕВЫЙ край: PA_F (8 кол, пластик Ж). ЦЕНТР (чтение): RP_F (3 кол, чтение пластик — гладкая лестница) + RM_F (2 кол, чтение металл, у самого металла). ПРАВЫЙ край: MA_F (8 кол, металл Ж +премиум). Цена растёт снизу вверх; премиум-металл на eye-level.',
    heights,
  );
  rightWall.kind = 'wall';
  rightWall.sectionCols = 7;

  const leftWall = makeZone(
    'wall_left',
    'Левая стена — Мужское + дети + безоправные (126)',
    'Левая',
    6,
    21,
    'ЛЕВАЯ = мужская, зеркало правой. ЛЕВЫЙ край: PA_M (9 кол, пластик М). ЦЕНТР: KD_F (1 кол, девочки) + RL_F (1 кол, безоправные — в самом центре стены) + KD_M (1 кол, мальчики). ПРАВЫЙ край: MA_M (9 кол, металл М +премиум). Цена растёт снизу вверх.',
    heights,
  );
  leftWall.kind = 'wall';
  leftWall.sectionCols = 7;

  let unplaced: CellAssignment[] = [];

  // ПРАВАЯ стена (женская), симметрия + ЦЕНТР ТЯЖЕСТИ (дорогое тянется к центру):
  //   PA_F (левый край) — L→R: дорогое в верх-ВПРАВО (к центру).
  //   RP_F + RM_F — чтение по центру (2 блока).
  //   MA_F (правый край) — R→L: дорогое (9000) в верх-ВЛЕВО (к центру), дешёвое у внешнего края.
  unplaced = unplaced.concat(fillZoneRows(rightWall, sectionCells('PA_F'), eyeLevelRows, 0, 8));
  unplaced = unplaced.concat(fillZoneRows(rightWall, sectionCells('RP_F'), allRows, 8, 11));
  unplaced = unplaced.concat(fillZoneRows(rightWall, sectionCells('RM_F'), allRows, 11, 13));
  unplaced = unplaced.concat(fillZoneRowsRTL(rightWall, sectionCells('MA_F'), eyeLevelRows, 13, 21));

  // ЛЕВАЯ стена (мужская), зеркало + ЦЕНТР ТЯЖЕСТИ:
  //   PA_M (левый край) — L→R: дорогое в верх-ВПРАВО (к центру).
  //   центр — дети по бокам, безоправные RL ровно по центру стены (пик 13000 наверху).
  //   MA_M (правый край) — R→L: дорогое (11000) в верх-ВЛЕВО (к центру).
  unplaced = unplaced.concat(fillZoneRows(leftWall, sectionCells('PA_M'), eyeLevelRows, 0, 9));
  unplaced = unplaced.concat(fillZoneRows(leftWall, sectionCells('KD_F'), allRows, 9, 10));
  unplaced = unplaced.concat(fillZoneRows(leftWall, sectionCells('RL_F'), allRows, 10, 11));
  unplaced = unplaced.concat(fillZoneRows(leftWall, sectionCells('KD_M'), allRows, 11, 12));
  unplaced = unplaced.concat(fillZoneRowsRTL(leftWall, sectionCells('MA_M'), eyeLevelRows, 12, 21));

  return {
    branchName,
    totalSlots: 0,
    kind: 'twoWall',
    // Порядок: правая (женская) первой — отображается сверху на странице раскладки.
    zones: [rightWall, leftWall],
    unplaced,
    sectionSummary,
  };
}

// ════════════════════════════════════════════════════════════════════
// БЕЛОВОДСК — 4-витринная раскладка ИЗ РЕАЛЬНЫХ ОПРАВ (не из формулы)
// ════════════════════════════════════════════════════════════════════

/** Филиалы с 4-витринной раскладкой (4 одинаковые витрины 6 кол × 5 ряд = 30). */
export const FOUR_CASE_BRANCHES = new Set<string>(['Беловодск']);

export function isFourCaseBranch(branchName: string): boolean {
  return FOUR_CASE_BRANCHES.has(branchName);
}

/** Реальная оправа из БД (frame_barcodes): тип, пол, цена. */
export interface FrameInput {
  type: FrameTypeCode;
  gender: GenderCode;
  price: number;
}

/**
 * Превращает реальную оправу в ячейку. Премиум/якорь определяются ПО ЦЕНЕ
 * (без формулы classifyPrice): ≥4000 — премиум (cyan-полоска), >10000 — якорь-корона.
 */
function frameToCell(f: FrameInput): CellAssignment {
  const isPremium = f.price >= PREMIUM_PRICE_THRESHOLD; // ≥4000
  const bucket: BucketLabel = f.price > 10000 ? 'anchor' : isPremium ? 'premium' : 'b1';
  return {
    section: `${f.type}_${f.gender}` as SectionKey,
    type: f.type,
    gender: f.gender,
    price: f.price,
    bucket,
    isPremium,
  };
}

/**
 * БЕЛОВОДСК — раскладка из РЕАЛЬНЫХ напечатанных оправ (frame_barcodes), не из формулы.
 *
 * ФИЗИКА: 4 витрины стоят В ОДНУ ЛИНИЮ (подряд В1→В2→В3→В4), НЕ квадратом 2×2.
 * Внутри — непрерывная лента 5 рядов × 24 колонки (= 4 витрины × 6 кол), нарезанная на 4.
 * Цена в каждой секции растёт снизу (ряд 0) вверх (ряд 4); корона (>10000) — верхний ряд.
 *
 * ПОРЯДОК ВДОЛЬ ЛИНИИ (каждая категория — ЦЕЛЬНЫЙ блок колонок, без «перепрыгиваний»):
 *   PA_F(5) · MA_F(5) · RM_F(2) · RP_F(2) · KD_F(1) · KD_M(1) · MA_M(4) · PA_M(4) = 24 кол
 *   = Женское (пластик→металл) → Чтение (металл+пластик рядом) → Дети (девочки+мальчики рядом) → Мужское (металл→пластик).
 * Так чтение-металл соседствует с чтением-пластиком, девочки с мальчиками; ничего не разрывается
 * на несоседние витрины. Нарезка по 6 колонок даёт:
 *   В1 ≈ жен. пластик            В2 ≈ жен. металл (корона) + чтение
 *   В3 ≈ чтение + дети + муж.металл   В4 ≈ муж. металл (корона) + муж. пластик
 * Совпадает с тем, что реально напечатано. Устойчива к дрейфу количеств:
 * излишки → unplaced, недостаток → пустые ячейки (выравнивание линии сохраняется).
 */
export function computeFourCaseLayoutFromFrames(
  branchName: string,
  frames: FrameInput[],
): BranchLayout {
  // Группируем по секции и сортируем по цене (по возрастанию).
  const bySection: Record<string, CellAssignment[]> = {};
  for (const f of frames) {
    if (!f || !f.type || !f.gender || !Number.isFinite(f.price)) continue;
    const k = `${f.type}_${f.gender}`;
    (bySection[k] ||= []).push(frameToCell(f));
  }
  for (const k of Object.keys(bySection)) bySection[k].sort((a, b) => a.price - b.price);
  const sec = (k: string): CellAssignment[] => bySection[k] ?? [];

  const CASES = 4;
  const CASE_COLS = 6;
  const ROWS_N = 5;
  const TOTAL_COLS = CASES * CASE_COLS; // 24
  const ROWS = [0, 1, 2, 3, 4]; // снизу вверх: ряд 0 — нижняя полка, ряд 4 — eye-level

  // 1) Непрерывная ЛИНИЯ 5×24: секции цельными блоками колонок, в порядке слева направо.
  const strip = makeZone('strip', 'strip', 'strip', ROWS_N, TOTAL_COLS);
  let unplaced: CellAssignment[] = [];
  let col = 0;
  const place = (items: CellAssignment[], nCols: number) => {
    const leftover = fillZoneRows(strip, items, ROWS, col, col + nCols);
    if (leftover.length) unplaced = unplaced.concat(leftover);
    col += nCols; // фиксированная ширина блока — линия не «съезжает» при дрейфе количеств
  };
  place(sec('PA_F'), 5); // женский пластик (вход/бюджет)
  place(sec('MA_F'), 5); // женский металл (корона наверху)
  place(sec('RM_F'), 2); // чтение-металл
  place(sec('RP_F'), 2); // чтение-пластик (рядом с чтением-металлом — единая зона чтения)
  place(sec('KD_F'), 1); // девочки
  place(sec('KD_M'), 1); // мальчики (рядом с девочками — единая детская зона)
  place(sec('MA_M'), 4); // мужской металл (корона наверху)
  place(sec('PA_M'), 4); // мужской пластик

  // 2) Нарезаем ленту на 4 витрины по 6 колонок (стоят в ряд В1→В4).
  const names = [
    'Витрина 1 · Жен. пластик',
    'Витрина 2 · Жен. металл + чтение',
    'Витрина 3 · Чтение + дети + муж. металл',
    'Витрина 4 · Муж. металл + пластик',
  ];
  const zones: ZoneLayout[] = [];
  for (let k = 0; k < CASES; k++) {
    const z = makeZone(`case_${k + 1}`, names[k], `В${k + 1}`, ROWS_N, CASE_COLS);
    for (let r = 0; r < ROWS_N; r++) {
      for (let c = 0; c < CASE_COLS; c++) {
        z.cells[r][c] = strip.cells[r][k * CASE_COLS + c];
      }
    }
    z.kind = 'wall';
    zones.push(z);
  }

  return {
    branchName,
    totalSlots: frames.length,
    kind: 'fourCase',
    zones,
    unplaced,
    sectionSummary: [],
  };
}
