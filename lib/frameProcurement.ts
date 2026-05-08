/**
 * Алгоритм построения плана заказа оправ.
 *
 * Шаги:
 *   1. Считаем продажи целевого филиала (Токмок) и прокси (Кара-Балта) за окно.
 *   2. Если у целевого < 100 продаж — холодный старт, берём прокси.
 *   3. Финальная доля по секции = max(salesShare, slotShare) — слоты-формула
 *      работает страховочным полом, чтобы редкие категории не выпадали.
 *   4. Целевой объём = max(targetQty, supplierMin).
 *   5. Распределяем штуки по секциям пропорционально final-долям.
 *   6. Внутри секции: берём подходящие модели каталога, раскидываем по цветам.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SECTION_SLOT_SHARE,
  type FrameTypeCode,
  type GenderCode,
} from './framePricingFormula';
import type {
  BuildOrderInput,
  OrderPlan,
  SectionKey,
  SupplierCatalogRow,
  CatalogColor,
  CatalogGender,
} from './frameProcurementTypes';

/* ────────── Константы ────────── */

const COLD_START_THRESHOLD = 100;

/** Все 10 секций (включая RL) */
const ALL_SECTION_KEYS: SectionKey[] = [
  'PA_F', 'PA_M',
  'MA_F', 'MA_M',
  'RP_F', 'RM_F',
  'KD_F', 'KD_M',
  'RL_F', 'RL_M',
];

/**
 * Приоритет цветов при распределении внутри модели.
 * Чёрный/коричневый/серый — самые продаваемые. Яркие — меньше.
 * Используется только если у нас НЕТ статистики по продажам цветов
 * (мы её и не собираем — frame_barcodes не различает цвет, только тип/пол).
 */
const COLOR_PRIORITY: Record<string, number> = {
  'чёрный': 1.0, 'черный': 1.0, 'black': 1.0,
  'коричневый': 0.9, 'brown': 0.9,
  'серый': 0.85, 'gray': 0.85, 'grey': 0.85,
  'tortoise': 0.85, 'тёмный': 0.85,
  'синий': 0.65, 'blue': 0.65,
  'тёмно-синий': 0.7,
  'золотой': 0.6, 'gold': 0.6, 'золото': 0.6,
  'серебристый': 0.55, 'silver': 0.55,
  'градиент': 0.6, 'gradient': 0.6,
  'прозрачный': 0.55, 'clear': 0.55, 'transparent': 0.55,
  'розовый': 0.45, 'pink': 0.45,
  'красный': 0.4, 'red': 0.4,
  'зелёный': 0.35, 'green': 0.35,
  'фиолетовый': 0.35, 'purple': 0.35,
  'жёлтый': 0.3, 'yellow': 0.3,
  'белый': 0.4, 'white': 0.4,
};

function colorWeight(name: string): number {
  if (!name) return 0.5;
  const lc = name.toLowerCase().trim();
  for (const [key, w] of Object.entries(COLOR_PRIORITY)) {
    if (lc.includes(key)) return w;
  }
  return 0.5;
}

/* ────────── Вспомогательные ────────── */

function emptyShares(): Record<SectionKey, number> {
  const r = {} as Record<SectionKey, number>;
  for (const k of ALL_SECTION_KEYS) r[k] = 0;
  return r;
}

function sectionKeyFromTypeGender(t: FrameTypeCode, g: GenderCode | 'U'): SectionKey | null {
  // 'U' (унисекс) — не валидный sectionKey. Когда модель помечена как U,
  // мы её используем для обоих полов с пониженным приоритетом — см. matchSection.
  if (g === 'U') return null;
  return `${t}_${g}` as SectionKey;
}

/* ────────── Шаг 1: продажи по секциям ────────── */

export async function getSalesBySection(
  sb: SupabaseClient,
  branchId: number,
  windowDays: number,
): Promise<Record<SectionKey, number>> {
  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  const { data, error } = await sb
    .from('frame_barcodes')
    .select('type_code, gender')
    .eq('branch_id', branchId)
    .gte('sold_at', since.toISOString())
    .is('voided_at', null)
    .not('sold_at', 'is', null);

  if (error) throw error;

  const out = emptyShares();
  for (const row of (data || []) as Array<{ type_code: string | null; gender: string | null }>) {
    if (!row.type_code || !row.gender) continue;
    const key = `${row.type_code}_${row.gender}` as SectionKey;
    if (key in out) out[key] += 1;
  }
  return out;
}

function totalCount(rec: Record<SectionKey, number>): number {
  return ALL_SECTION_KEYS.reduce((s, k) => s + (rec[k] || 0), 0);
}

function normalize(rec: Record<SectionKey, number>): Record<SectionKey, number> {
  const sum = totalCount(rec);
  if (sum <= 0) return emptyShares();
  const out = emptyShares();
  for (const k of ALL_SECTION_KEYS) out[k] = (rec[k] || 0) / sum;
  return out;
}

/* ────────── Шаг 2-4: финальные количества по секциям ────────── */

export interface SectionPlanInput {
  ownSales: Record<SectionKey, number>;
  proxySales: Record<SectionKey, number>;
  targetQty: number;
  supplierMin: number;
  forceProxyOnly: boolean;
}

export interface SectionPlanResult {
  coldStart: boolean;
  ownTotal: number;
  proxyTotal: number;
  totalQty: number;
  shares: Record<SectionKey, number>;
  qtyBySection: Record<SectionKey, number>;
}

export function buildSectionPlan(input: SectionPlanInput): SectionPlanResult {
  const ownTotal = totalCount(input.ownSales);
  const proxyTotal = totalCount(input.proxySales);
  const coldStart = input.forceProxyOnly || ownTotal < COLD_START_THRESHOLD;

  const salesSource = coldStart ? input.proxySales : input.ownSales;
  const salesShares = normalize(salesSource);

  // Слот-доли формулы: страховочный пол (slotShare),
  // чтобы редкие категории (KD, RL) не вылетали при шумной выборке.
  // Типы SectionKey формулы и нашей библиотеки немного отличаются (формула
  // включает RP_M/RM_M=0), поэтому достаём через индекс по строке.
  const slotShareMap = SECTION_SLOT_SHARE as Record<string, number>;

  // final[k] = max(salesShare, slotShare), затем нормализация
  const rawFinal = emptyShares();
  for (const k of ALL_SECTION_KEYS) {
    const sales = salesShares[k] || 0;
    const slot = slotShareMap[k] || 0;
    rawFinal[k] = Math.max(sales, slot);
  }
  const finalSum = ALL_SECTION_KEYS.reduce((s, k) => s + rawFinal[k], 0);
  const shares: Record<SectionKey, number> = emptyShares();
  if (finalSum > 0) {
    for (const k of ALL_SECTION_KEYS) shares[k] = rawFinal[k] / finalSum;
  } else {
    // Совсем нет данных — fallback на slotShares
    for (const k of ALL_SECTION_KEYS) {
      shares[k] = slotShareMap[k] || 0;
    }
  }

  const totalQty = Math.max(input.targetQty, input.supplierMin);

  // Раскидываем штуки с компенсацией ошибки округления:
  // считаем floor + остатки, затем распределяем недостачу по секциям с
  // максимальным дробным остатком.
  const floored: Record<SectionKey, number> = emptyShares();
  const remainders: Array<{ key: SectionKey; rem: number }> = [];
  let allocated = 0;
  for (const k of ALL_SECTION_KEYS) {
    const exact = shares[k] * totalQty;
    const fl = Math.floor(exact);
    floored[k] = fl;
    allocated += fl;
    remainders.push({ key: k, rem: exact - fl });
  }
  let deficit = totalQty - allocated;
  remainders.sort((a, b) => b.rem - a.rem);
  for (const r of remainders) {
    if (deficit <= 0) break;
    floored[r.key] += 1;
    deficit -= 1;
  }

  return {
    coldStart,
    ownTotal,
    proxyTotal,
    totalQty,
    shares,
    qtyBySection: floored,
  };
}

/* ────────── Шаг 5-6: распределение по моделям/цветам ────────── */

/** Подходит ли модель каталога для конкретной секции */
function modelFitsSection(
  model: SupplierCatalogRow,
  sectionKey: SectionKey,
): { fits: boolean; weight: number } {
  if (!model.type_code || !model.gender) return { fits: false, weight: 0 };
  const [t, g] = sectionKey.split('_') as [FrameTypeCode, GenderCode];

  if (model.type_code !== t) return { fits: false, weight: 0 };

  // Точное совпадение пола — высокий вес
  if (model.gender === g) return { fits: true, weight: 1.0 };
  // Унисекс — подходит обоим, но с меньшим весом
  if (model.gender === 'U') return { fits: true, weight: 0.6 };
  return { fits: false, weight: 0 };
}

/**
 * Распределить qty штук по моделям секции и цветам внутри моделей.
 * Стратегия: сначала набираем равномерно, потом учитываем веса цветов
 * (чёрный/коричневый — больше, экзотика — меньше).
 */
function distributeWithinSection(
  models: Array<{ model: SupplierCatalogRow; weight: number }>,
  needQty: number,
  maxPerColor = 5,
): Array<{
  catalogId: string;
  supplierModel: string | null;
  typeCode: FrameTypeCode;
  gender: CatalogGender;
  colorLabel: string;
  colorName: string | null;
  qty: number;
  bbox: [number, number, number, number];
}> {
  const result: Array<any> = [];
  if (models.length === 0 || needQty <= 0) return result;

  // Соберём "слоты": каждая модель × цвет = один слот с весом
  type Slot = {
    model: SupplierCatalogRow;
    color: CatalogColor;
    weight: number;
    assigned: number;
  };

  const slots: Slot[] = [];
  for (const { model, weight: modelW } of models) {
    if (!model.colors || model.colors.length === 0) continue;
    for (const c of model.colors) {
      slots.push({
        model,
        color: c,
        weight: modelW * colorWeight(c.name_ru || c.label),
        assigned: 0,
      });
    }
  }
  if (slots.length === 0) return result;

  // Раундами по 1 штуке: на каждом раунде назначаем штуку слоту с наибольшим
  // (weight × (1 / (assigned + 1))) — то есть больше шансов у тех, кому ещё мало
  // дали и у кого больше базовый вес.
  let remaining = needQty;
  let safety = needQty * 5; // защита от вечного цикла
  while (remaining > 0 && safety > 0) {
    // Найти лучший слот
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.assigned >= maxPerColor) continue;
      const score = s.weight / (s.assigned + 1);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) {
      // Все слоты добили до maxPerColor — увеличиваем maxPerColor
      maxPerColor += 5;
      safety--;
      continue;
    }
    slots[bestIdx].assigned += 1;
    remaining -= 1;
    safety--;
  }

  // Финализируем
  for (const s of slots) {
    if (s.assigned <= 0) continue;
    result.push({
      catalogId: s.model.id,
      supplierModel: s.model.supplier_model,
      typeCode: s.model.type_code as FrameTypeCode,
      gender: s.model.gender as CatalogGender,
      colorLabel: s.color.label,
      colorName: s.color.name_ru || null,
      qty: s.assigned,
      bbox: s.color.bbox,
    });
  }
  return result;
}

/* ────────── Финальная сборка плана ────────── */

export async function buildOrderPlan(
  sb: SupabaseClient,
  input: BuildOrderInput,
): Promise<OrderPlan> {
  // 1) Продажи
  const [ownSales, proxySales] = await Promise.all([
    getSalesBySection(sb, input.branchId, input.windowDays),
    getSalesBySection(sb, input.proxyBranchId, input.windowDays),
  ]);

  // 2) Секционный план
  const plan = buildSectionPlan({
    ownSales,
    proxySales,
    targetQty: input.targetQty,
    supplierMin: input.supplierMin,
    forceProxyOnly: Boolean(input.forceProxyOnly),
  });

  // 3) Каталог поставщика — только распознанные записи
  const { data: catalogRows, error: catErr } = await sb
    .from('frame_supplier_catalog')
    .select('*')
    .not('type_code', 'is', null)
    .not('gender', 'is', null);
  if (catErr) throw catErr;
  const catalog = (catalogRows || []) as unknown as SupplierCatalogRow[];

  // 4) Распределение по моделям/цветам
  const items: OrderPlan['items'] = [];
  const uncovered: SectionKey[] = [];
  const usedModelIds = new Set<string>();

  for (const sectionKey of ALL_SECTION_KEYS) {
    const need = plan.qtyBySection[sectionKey] || 0;
    if (need <= 0) continue;

    const candidates = catalog
      .map((m) => ({ model: m, ...modelFitsSection(m, sectionKey) }))
      .filter((c) => c.fits)
      .map((c) => ({ model: c.model, weight: c.weight }));

    if (candidates.length === 0) {
      uncovered.push(sectionKey);
      continue;
    }

    const portion = distributeWithinSection(candidates, need);
    for (const p of portion) {
      items.push(p);
      usedModelIds.add(p.catalogId);
    }
  }

  return {
    coldStart: plan.coldStart,
    ownSalesTotal: plan.ownTotal,
    qtyBySection: plan.qtyBySection,
    sharesBySection: plan.shares,
    items,
    modelsUsed: usedModelIds.size,
    totalQty: items.reduce((s, it) => s + it.qty, 0),
    uncoveredSections: uncovered,
  };
}

/* ────────── Экспорт для тестов ────────── */

export const _testing = {
  ALL_SECTION_KEYS,
  COLD_START_THRESHOLD,
  colorWeight,
  emptyShares,
  normalize,
  totalCount,
};
