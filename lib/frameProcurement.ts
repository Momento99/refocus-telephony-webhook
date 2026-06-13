/**
 * Алгоритм построения плана заказа оправ.
 *
 * Версия 2026-06-02 — мульти-филиальная, color-weight распределение:
 *   1. Окно продаж = c sent_at последнего «отправленного» заказа этой
 *      ГРУППЫ филиалов (branchIds). Если sent-заказов нет — за всё время.
 *      Совпадение по branch_ids (массив, overlap) ИЛИ legacy branch_id.
 *   2. Считаем продажи группы по секциям (тип × пол): qty, revenue, avg
 *      и СПИСОК фактических цен (frame_barcodes.price) — список цен нужен
 *      только для UI/информации и для расчёта объёма (через .length).
 *   3. По выбранному режиму определяем totalQtyTarget:
 *      - 'sold'   → totalQtyTarget = sum(soldQty)
 *      - 'scaled' → totalQtyTarget = supplierMin (масштабируем доли продаж)
 *      - 'custom' → totalQtyTarget = customTarget
 *   4. qtyBySection = доли продаж × totalQtyTarget (с компенсацией округления).
 *   5. Внутри секции: распределяем весь объём по ВСЕМ кандидатам каталога
 *      с подходящими type+gender через color-weight (см.
 *      distributeWithinSectionByColor) — это гарантирует равномерный спред
 *      по моделям и приоритет тёмных/нейтральных цветов.
 *
 * Поле estimated_price каталога остаётся в БД и в UI (для информации,
 * прогнозов выручки и т.п.), но в алгоритме распределения НЕ используется
 * (отключено 2026-06-02 — price-aware matching концентрировал заказ на
 * немногих моделях с близкой ценой, спред оказался хуже color-weight).
 *
 * Старый алгоритм (slot-share формула, прокси-филиал, cold-start) удалён.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FrameTypeCode, GenderCode } from './framePricingFormula';
import type {
  BuildOrderInput,
  OrderPlan,
  PlanMode,
  SectionKey,
  SectionSalesInfo,
  SupplierCatalogRow,
  CatalogColor,
  CatalogGender,
} from './frameProcurementTypes';

/* ────────── Константы ────────── */

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
 * Это ОСНОВНОЙ путь распределения (с 2026-06-02 price-aware отключён).
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

function emptySharesNum(): Record<SectionKey, number> {
  const r = {} as Record<SectionKey, number>;
  for (const k of ALL_SECTION_KEYS) r[k] = 0;
  return r;
}

function emptySalesInfo(): Record<SectionKey, SectionSalesInfo> {
  const r = {} as Record<SectionKey, SectionSalesInfo>;
  for (const k of ALL_SECTION_KEYS) {
    r[k] = { soldQty: 0, revenue: 0, avgPrice: 0, prices: [] };
  }
  return r;
}

function normalizeBranchIds(branchIds: number[] | undefined | null): number[] {
  if (!Array.isArray(branchIds)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const raw of branchIds) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    const id = Math.floor(n);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Литерал postgres-массива: [1,2,3] → '{1,2,3}' */
function pgIntArray(ids: number[]): string {
  return `{${ids.join(',')}}`;
}

/* ────────── Окно: дата последнего sent-заказа по группе ────────── */

/**
 * Берёт самую свежую sent_at среди отправленных/полученных заказов, в которых
 * пересекается набор филиалов с переданной группой branchIds.
 *
 * Сначала пробуем .overlaps() по колонке-массиву branch_ids. Если SDK отверг
 * (старая БД, нет колонки) или вернул 0 строк — добавляем legacy совпадение по
 * branch_id IN (...).
 */
export async function getLastSentAt(
  sb: SupabaseClient,
  branchIds: number[],
): Promise<string | null> {
  const ids = normalizeBranchIds(branchIds);
  if (ids.length === 0) return null;

  // Основной путь: overlap по массиву branch_ids
  let latest: string | null = null;
  try {
    const { data, error } = await sb
      .from('frame_procurement_orders')
      .select('sent_at')
      .overlaps('branch_ids', ids)
      .in('status', ['sent', 'received'])
      .not('sent_at', 'is', null)
      .order('sent_at', { ascending: false })
      .limit(1);
    if (!error && data && data.length > 0) {
      latest = (data[0]?.sent_at as string | null) ?? null;
    }
  } catch {
    // SDK без .overlaps — упадём в .filter ниже
  }

  // Fallback / dual-source: filter ov через сырое выражение + legacy branch_id IN (...)
  // Берём максимум из двух запросов: overlap-по-массиву и legacy single-branch.
  try {
    const { data: legacy, error: legacyErr } = await sb
      .from('frame_procurement_orders')
      .select('sent_at')
      .in('branch_id', ids)
      .in('status', ['sent', 'received'])
      .not('sent_at', 'is', null)
      .order('sent_at', { ascending: false })
      .limit(1);
    if (!legacyErr && legacy && legacy.length > 0) {
      const legSent = legacy[0]?.sent_at as string | null;
      if (legSent && (!latest || legSent > latest)) latest = legSent;
    }
  } catch {
    /* noop */
  }

  // Если .overlaps вообще недоступен, попытаемся через .filter('branch_ids','ov',pgArray)
  if (!latest) {
    try {
      const { data, error } = await sb
        .from('frame_procurement_orders')
        .select('sent_at')
        .filter('branch_ids', 'ov', pgIntArray(ids))
        .in('status', ['sent', 'received'])
        .not('sent_at', 'is', null)
        .order('sent_at', { ascending: false })
        .limit(1);
      if (!error && data && data.length > 0) {
        latest = (data[0]?.sent_at as string | null) ?? null;
      }
    } catch {
      /* noop */
    }
  }

  return latest;
}

/* ────────── Продажи по секциям с ценой ────────── */

/**
 * Считает продажи группы филиалов по (type_code, gender). Для каждой секции
 * собирает массив цен — он используется в UI (средняя цена, прогноз
 * выручки) и для определения объёма к закупке (через .length).
 * В алгоритме распределения сами значения цен не участвуют — см. шапку файла.
 */
export async function getSalesBySectionWithPrice(
  sb: SupabaseClient,
  branchIds: number[],
  sinceIso: string | null,
): Promise<Record<SectionKey, SectionSalesInfo>> {
  const ids = normalizeBranchIds(branchIds);
  const out = emptySalesInfo();
  // Пустой ввод — это легитимный «нет филиалов», возвращаем пустой результат.
  // Но если на вход пришли значения, и все они оказались невалидными
  // (отрицательные/нечисловые) — это баг вызывающего кода, не маскируем его.
  if (ids.length === 0) {
    if (Array.isArray(branchIds) && branchIds.length > 0) {
      throw new Error(
        `getSalesBySectionWithPrice: все branchIds невалидны после нормализации (вход: ${JSON.stringify(branchIds)})`,
      );
    }
    return out;
  }

  let q = sb
    .from('frame_barcodes')
    .select('type_code, gender, price')
    .in('branch_id', ids)
    .is('voided_at', null)
    .not('sold_at', 'is', null);
  if (sinceIso) q = q.gte('sold_at', sinceIso);

  const { data, error } = await q;
  if (error) throw error;

  for (const row of (data || []) as Array<{
    type_code: string | null;
    gender: string | null;
    price: number | string | null;
  }>) {
    if (!row.type_code || !row.gender) continue;
    const key = `${row.type_code}_${row.gender}` as SectionKey;
    if (!(key in out)) continue;
    const price = Number(row.price);
    // Игнорируем нечисловые/нулевые/отрицательные цены: они искажают
    // среднюю цену (UI) и прогноз выручки.
    if (!Number.isFinite(price) || price <= 0) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(
          `[frameProcurement] skip non-positive price for ${key}: raw=${JSON.stringify(row.price)}`,
        );
      }
      continue;
    }
    out[key].soldQty += 1;
    out[key].revenue += price;
    // prices создан в emptySalesInfo()
    (out[key].prices as number[]).push(price);
  }
  // Средние цены
  for (const k of ALL_SECTION_KEYS) {
    if (out[k].soldQty > 0) {
      out[k].avgPrice = out[k].revenue / out[k].soldQty;
    }
  }
  return out;
}

/* ────────── Распределение штук по секциям ────────── */

export interface SectionPlanInput {
  sales: Record<SectionKey, SectionSalesInfo>;
  mode: PlanMode;
  supplierMin: number;
  customTarget?: number;
}

export interface SectionPlanResult {
  totalSoldQty: number;
  totalSoldRevenue: number;
  shares: Record<SectionKey, number>;
  qtyBySection: Record<SectionKey, number>;
  totalQtyTarget: number;
}

export function buildSectionPlan(input: SectionPlanInput): SectionPlanResult {
  let totalSoldQty = 0;
  let totalSoldRevenue = 0;
  for (const k of ALL_SECTION_KEYS) {
    totalSoldQty += input.sales[k].soldQty;
    totalSoldRevenue += input.sales[k].revenue;
  }

  // Доли продаж по секциям
  const shares = emptySharesNum();
  if (totalSoldQty > 0) {
    for (const k of ALL_SECTION_KEYS) {
      shares[k] = input.sales[k].soldQty / totalSoldQty;
    }
  }

  // Целевой объём по режиму
  let totalQtyTarget = 0;
  if (input.mode === 'sold') {
    totalQtyTarget = totalSoldQty;
  } else if (input.mode === 'scaled') {
    totalQtyTarget = Math.max(input.supplierMin, 0);
  } else if (input.mode === 'custom') {
    totalQtyTarget = Math.max(Math.floor(input.customTarget || 0), 0);
  }

  // Если продаж нет вообще — распределять нечего
  if (totalSoldQty <= 0 || totalQtyTarget <= 0) {
    return {
      totalSoldQty,
      totalSoldRevenue,
      shares,
      qtyBySection: emptySharesNum(),
      totalQtyTarget,
    };
  }

  // Floor + распределение остатка по убыванию дробной части
  const floored = emptySharesNum();
  const remainders: Array<{ key: SectionKey; rem: number }> = [];
  let allocated = 0;
  for (const k of ALL_SECTION_KEYS) {
    const exact = shares[k] * totalQtyTarget;
    const fl = Math.floor(exact);
    floored[k] = fl;
    allocated += fl;
    remainders.push({ key: k, rem: exact - fl });
  }
  let deficit = totalQtyTarget - allocated;
  remainders.sort((a, b) => b.rem - a.rem);
  for (const r of remainders) {
    if (deficit <= 0) break;
    floored[r.key] += 1;
    deficit -= 1;
  }

  return {
    totalSoldQty,
    totalSoldRevenue,
    shares,
    qtyBySection: floored,
    totalQtyTarget,
  };
}

/* ────────── Подходящие модели каталога ────────── */

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

/* ────────── Тип возвращаемой позиции ────────── */

type PlanItem = OrderPlan['items'][number];

export interface PriceMatchSectionResult {
  items: PlanItem[];
  /**
   * Проданные цены, для которых не удалось подобрать кандидата. С 2026-06-02
   * (color-weight only) всегда пустой массив, но поле сохранено ради совместимости
   * сигнатуры с buildOrderPlan и на случай возврата к price-aware матчингу.
   */
  outUnmatched: Array<{ soldPrice: number; reason: string }>;
}

/* ────────── Fallback: распределение без цены (color-weight) ────────── */

function distributeWithinSectionByColor(
  models: Array<{ model: SupplierCatalogRow; weight: number }>,
  needQty: number,
  maxPerColor = 3,
): PlanItem[] {
  const result: PlanItem[] = [];
  if (models.length === 0 || needQty <= 0) return result;

  type Slot = {
    model: SupplierCatalogRow;
    color: CatalogColor;
    weight: number;
    assigned: number;
  };

  const slots: Slot[] = [];
  // modelTotals: накопленный спрос по модели через все её цвета —
  // используется для приоритета «спред между моделями» перед концентрацией
  // в одной модели.
  const modelTotals = new Map<string, number>();
  for (const { model, weight: modelW } of models) {
    if (!model.colors || model.colors.length === 0) continue;
    if (!modelTotals.has(model.id)) modelTotals.set(model.id, 0);
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

  let remaining = needQty;
  let safety = Math.max(needQty * 5, needQty * slots.length * 2);
  // safety также ловит зацикливание maxPerColor bump'ов — runaway maxPerColor
  // не страшен, потому что slots[].assigned физически ограничен safety.
  while (remaining > 0 && safety > 0) {
    // Стратегия: сначала выбираем модели с наименьшим суммарным assigned
    // (спред между моделями), и только при равенстве — по color-weight score.
    let bestIdx = -1;
    let bestModelTotal = Infinity;
    let bestScore = -Infinity;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.assigned >= maxPerColor) continue;
      const mt = modelTotals.get(s.model.id) ?? 0;
      const score = s.weight / (s.assigned + 1);
      if (mt < bestModelTotal) {
        bestModelTotal = mt;
        bestScore = score;
        bestIdx = i;
      } else if (mt === bestModelTotal && score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) {
      maxPerColor += 1;
      safety--;
      continue;
    }
    const chosen = slots[bestIdx];
    chosen.assigned += 1;
    modelTotals.set(chosen.model.id, (modelTotals.get(chosen.model.id) ?? 0) + 1);
    remaining -= 1;
    safety--;
  }
  if (remaining > 0) {
    console.warn(
      `[frameProcurement] distributeWithinSectionByColor: ${remaining} of ${needQty} units unplaced after safety budget exhausted (slots=${slots.length}, maxPerColor=${maxPerColor})`,
    );
  }

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
      estimatedPrice: s.model.estimated_price ?? null,
    });
  }

  // Финальная агрегация: если в catalog.colors[] есть два цвета с одинаковым
  // label (например GPT-5 вернул дубль C1), distribute мог создать две
  // записи на один и тот же (catalogId, colorLabel) — это нарушает
  // UNIQUE constraint uniq_procurement_item_color в БД. Сливаем в одну.
  const aggregated = new Map<string, PlanItem>();
  for (const it of result) {
    const key = it.catalogId + '|' + it.colorLabel;
    const existing = aggregated.get(key);
    if (existing) {
      existing.qty += it.qty;
    } else {
      aggregated.set(key, it);
    }
  }
  return Array.from(aggregated.values());
}

/* ────────── Распределение по секции (color-weight) ────────── */

/**
 * Распределяет общий объём секции по ВСЕМ кандидатам каталога (с подходящими
 * type+gender) через color-weight.
 *
 * 2026-06-02: упростили по запросу пользователя. Раньше делали price-aware
 * matching (для каждой sold price искали catalog model с ближайшей
 * estimated_price), что концентрировало заказ на немногих моделях с близкой
 * ценой. Теперь распределяем ТОЛЬКО по color-weight на ВСЕХ кандидатах
 * type+gender — равномерный спред гарантирован.
 *
 * Цена estimated_price остаётся в каталоге и UI для информации, в алгоритме
 * не используется.
 *
 * Сигнатура и возвращаемый shape сохранены ради совместимости с buildOrderPlan
 * (outUnmatched теперь всегда пустой, но поле остаётся).
 */
export function priceMatchSection(
  sales: { prices: number[] },
  candidates: Array<{ model: SupplierCatalogRow; weight: number }>,
  scaleFactor: number,
  maxPerColor = 3,
): PriceMatchSectionResult {
  const outUnmatched: Array<{ soldPrice: number; reason: string }> = [];
  if (!candidates.length) return { items: [], outUnmatched };
  const prices = (sales.prices || []).filter((p) => Number.isFinite(p));
  if (prices.length === 0 || scaleFactor <= 0) return { items: [], outUnmatched };
  const total = Math.max(1, Math.round(prices.length * scaleFactor));
  return {
    items: distributeWithinSectionByColor(candidates, total, maxPerColor),
    outUnmatched,
  };
}

/* ────────── Финальная сборка плана ────────── */

export async function buildOrderPlan(
  sb: SupabaseClient,
  input: BuildOrderInput,
): Promise<OrderPlan> {
  const ids = normalizeBranchIds(input.branchIds);

  // 1) Окно продаж = с последнего sent-заказа группы
  const windowSince = await getLastSentAt(sb, ids);

  // 2) Продажи + цены по секциям (полные, для UI-отображения)
  const sales = await getSalesBySectionWithPrice(sb, ids, windowSince);

  // 2b) Фильтр исключённых секций. Например, KD_F/KD_M исключаются если детских
  //     хватает дома. Делаем «теневую» копию sales где исключённые секции = 0,
  //     чтобы buildSectionPlan не учитывал их в долях и totalSoldQty.
  //     Оригинальный sales отдадим в OrderPlan для UI (исключённые строки
  //     рендерятся серыми).
  const excludedSet = new Set<SectionKey>(input.excludedSections || []);
  const salesForPlan: typeof sales = emptySalesInfo();
  for (const k of ALL_SECTION_KEYS) {
    if (excludedSet.has(k)) {
      salesForPlan[k] = { soldQty: 0, revenue: 0, avgPrice: 0, prices: [] };
    } else {
      salesForPlan[k] = sales[k];
    }
  }

  // 3) Секционный план по режиму
  const plan = buildSectionPlan({
    sales: salesForPlan,
    mode: input.mode,
    supplierMin: input.supplierMin,
    customTarget: input.customTarget,
  });

  // 4) Каталог поставщика — только распознанные записи
  const { data: catalogRows, error: catErr } = await sb
    .from('frame_supplier_catalog')
    .select('*')
    .not('type_code', 'is', null)
    .not('gender', 'is', null);
  if (catErr) throw catErr;
  const catalog = (catalogRows || []) as unknown as SupplierCatalogRow[];

  // Сколько моделей в каталоге по каждой секции — для подсказки UI «загрузи ещё».
  // Унисекс (U) считается ПОДХОДЯЩИМ для обоих полов с пониженным весом, но в
  // подсчёте считаем его +1 в каждую гендерную ветку секции своего типа.
  const catalogModelsBySection = emptySharesNum();
  for (const m of catalog) {
    if (!m.type_code || !m.gender) continue;
    const t = m.type_code;
    if (m.gender === 'F' || m.gender === 'M') {
      const k = `${t}_${m.gender}` as SectionKey;
      if (k in catalogModelsBySection) catalogModelsBySection[k] += 1;
    } else if (m.gender === 'U') {
      const kF = `${t}_F` as SectionKey;
      const kM = `${t}_M` as SectionKey;
      if (kF in catalogModelsBySection) catalogModelsBySection[kF] += 1;
      if (kM in catalogModelsBySection) catalogModelsBySection[kM] += 1;
    }
  }

  // scaleFactor — один общий мультипликатор на каждую продажу
  //   sold   → 1
  //   scaled → supplierMin / totalSoldQty
  //   custom → customTarget / totalSoldQty
  let scaleFactor = 1;
  if (plan.totalSoldQty > 0) {
    if (input.mode === 'scaled') {
      scaleFactor = plan.totalQtyTarget / plan.totalSoldQty;
    } else if (input.mode === 'custom') {
      scaleFactor = plan.totalQtyTarget / plan.totalSoldQty;
    }
  }

  // 5) Распределение по секциям через color-weight (см. priceMatchSection)
  const items: PlanItem[] = [];
  const uncovered: SectionKey[] = [];
  const usedModelIds = new Set<string>();
  const distributedBySection = emptySharesNum();
  const unmatched: OrderPlan['unmatched'] = [];

  for (const sectionKey of ALL_SECTION_KEYS) {
    // Исключённые секции — полностью пропускаем (без обращения к каталогу,
    // без unmatched, без uncovered).
    if (excludedSet.has(sectionKey)) continue;
    const sectionSales = salesForPlan[sectionKey];
    const need = plan.qtyBySection[sectionKey] || 0;
    if (sectionSales.soldQty <= 0 || need <= 0) continue;

    const [tCode, gCode] = sectionKey.split('_') as [FrameTypeCode, GenderCode];

    const candidates = catalog
      .map((m) => ({ model: m, ...modelFitsSection(m, sectionKey) }))
      .filter((c) => c.fits)
      .map((c) => ({ model: c.model, weight: c.weight }));

    if (candidates.length === 0) {
      // Нет ни одного кандидата ни по типу/полу — секция целиком в uncovered
      uncovered.push(sectionKey);
      // И все её продажи — в unmatched
      for (const p of sectionSales.prices || []) {
        unmatched.push({
          soldPrice: p,
          typeCode: tCode,
          gender: gCode,
          reason: 'no_catalog_candidate_for_section',
        });
      }
      continue;
    }

    // Локальный scaleFactor для секции = глобальный (по ТЗ — общий)
    const { items: portion, outUnmatched: sectionUnmatched } = priceMatchSection(
      { prices: sectionSales.prices || [] },
      candidates,
      scaleFactor,
    );

    // Подмешиваем секционные unmatched (per-price без estimated_price у кандидатов)
    // с проставленным typeCode/gender этой секции.
    const alreadyUnmatched = new Set<number>();
    for (const u of sectionUnmatched) {
      unmatched.push({
        soldPrice: u.soldPrice,
        typeCode: tCode,
        gender: gCode,
        reason: u.reason,
      });
      alreadyUnmatched.add(u.soldPrice);
    }

    let distributedHere = 0;
    for (const p of portion) {
      items.push(p);
      usedModelIds.add(p.catalogId);
      distributedHere += p.qty;
    }
    distributedBySection[sectionKey] = distributedHere;

    if (distributedHere === 0) {
      uncovered.push(sectionKey);
      for (const p of sectionSales.prices || []) {
        if (alreadyUnmatched.has(p)) continue;
        unmatched.push({
          soldPrice: p,
          typeCode: tCode,
          gender: gCode,
          reason: 'candidates_have_no_colors',
        });
      }
    }
  }

  // Финальная дедупликация items по (catalogId, colorLabel) — унисекс модели
  // (gender=U) подходят и под F-, и под M-секцию, поэтому распределение
  // могло положить их в обе. В items это даёт две строки с одним
  // (catalog_id, color_label), что нарушает UNIQUE constraint
  // uniq_procurement_item_color в frame_procurement_order_items.
  const dedupItems = new Map<string, typeof items[number]>();
  for (const it of items) {
    const key = it.catalogId + '|' + it.colorLabel;
    const existing = dedupItems.get(key);
    if (existing) {
      existing.qty += it.qty;
    } else {
      dedupItems.set(key, it);
    }
  }
  const finalItems = Array.from(dedupItems.values());

  // Также пересчитываем distributedBySection и modelsUsed под дедуплицированный список.
  // distributedBySection НЕ нужно пересчитывать (он построен через накопление per-section,
  // дубли U-моделей в нём отражают реальное намерение алгоритма).
  // modelsUsed — это Set, дедупликация items не влияет на его размер.

  const totalQty = finalItems.reduce((s, it) => s + it.qty, 0);

  return {
    mode: input.mode,
    branchIds: ids,
    windowSince,
    salesBySection: sales,
    excludedSections: Array.from(excludedSet),
    catalogModelsBySection,
    totalSoldQty: plan.totalSoldQty,
    totalSoldRevenue: plan.totalSoldRevenue,
    qtyBySection: plan.qtyBySection,
    distributedBySection,
    sharesBySection: plan.shares,
    totalQtyTarget: plan.totalQtyTarget,
    // Минималка проверяется по РЕАЛЬНО распределённому объёму
    meetsSupplierMin: totalQty >= input.supplierMin,
    items: finalItems,
    modelsUsed: usedModelIds.size,
    totalQty,
    uncoveredSections: uncovered,
    unmatched,
  };
}

/* ────────── Экспорт для тестов ────────── */

export const _testing = {
  ALL_SECTION_KEYS,
  colorWeight,
  emptySharesNum,
  emptySalesInfo,
  normalizeBranchIds,
  pgIntArray,
  distributeWithinSectionByColor,
};
