/**
 * ЕДИНАЯ ФОРМУЛА ЦЕНООБРАЗОВАНИЯ ОПРАВ REFOCUS — v3 (мультистрана + мёртвые зоны)
 * ==============================================================================
 *
 * Одна математическая формула, масштабируемая на любую страну, валюту, город
 * и любую ёмкость витрины. Автоматически обходит психологические «мёртвые зоны» —
 * диапазоны между бакетами, где оправа «и не дешёвая, и не качественная».
 *
 * ─────────────────────────────────────────────────────────────────
 *  P(t, g, n, c) = B_t(country(c)) × G_g × q^(n-1) × K_c
 * ─────────────────────────────────────────────────────────────────
 *
 *  t — тип оправы (PA, MA, RP, RM, KD)
 *  g — пол (M, F)
 *  n — номер бакета (1–4 regular, 5+ премиум)
 *  c — филиал (город)
 *
 *  B_t(country) — база типа в локальной валюте страны (для baseline-города страны, муж, бакет 1)
 *  G_g          — коэф пола: M = 1.00, F = 0.90
 *  q            — шаг бакета = 1.25
 *  K_c          — ЛОКАЛЬНЫЙ индекс города (внутри страны; baseline-город = 1.0)
 *
 * МЁРТВЫЕ ЗОНЫ (психологические провалы между бакетами):
 *   DeadZone_n = [ P_n × 0.85,  P_n × 0.97 ]
 *   Т.е. узкий диапазон ПРЯМО под базой следующего бакета — туда ценники не ставим.
 *   Клиент воспринимает такие цены как «не дешёво, но и не круто — не беру».
 *   Автоматически масштабируется: богаче город → мёртвая зона выше, беднее → ниже.
 *
 * КАК ДОБАВИТЬ НОВЫЙ ФИЛИАЛ (3–4 строки):
 *   1) CITY_INDEX['Новый-Город']       = { country: 'KZ', index: 1.00 };
 *   2) BRANCH_TOTAL_SLOTS['Новый-Город'] = 400;
 *   3) FORMULA_ENABLED_BRANCHES.add('Новый-Город');
 *   4) (опц.) BRANCH_PREMIUM_SHARE_OVERRIDE['Новый-Город'] = 0.12;
 *
 * КАК ДОБАВИТЬ НОВУЮ СТРАНУ:
 *   1) Расширить CountryCode: 'KG' | 'KZ' | 'RU' | 'UZ' | 'TJ' …
 *   2) Добавить запись в COUNTRIES и TYPE_BASE_BY_COUNTRY
 *   3) Добавить города в CITY_INDEX с этой страной
 */

// ════════════════════════════════════════════════════════════════════
// Типы
// ════════════════════════════════════════════════════════════════════

export type FrameTypeCode = 'PA' | 'MA' | 'RP' | 'RM' | 'KD' | 'RL';
export type GenderCode = 'F' | 'M';
export type SectionKey = `${FrameTypeCode}_${GenderCode}`;
export type CountryCode = 'KG' | 'KZ' | 'RU' | 'UZ';
export type BucketId = 1 | 2 | 3 | 4;

export type DeadZone = {
  from: number;
  to: number;
  /** мёртвая зона лежит под бакетом beforeBucket; при генерации вариаций бакета (beforeBucket − 1) её пропускаем */
  beforeBucket: number;
};

// ════════════════════════════════════════════════════════════════════
// 1) СТРАНЫ
// ════════════════════════════════════════════════════════════════════

export const COUNTRIES: Record<CountryCode, {
  name: string;
  currency: string;
  currencySymbol: string;
  /** baseline-город страны, где K_c = 1.00 и к которому привязаны базы B_t */
  referenceCity: string;
  /** пример порога премиум в локальной валюте (цены ≥ этого значения считаем якорными) */
  premiumThreshold: number;
}> = {
  KG: { name: 'Кыргызстан', currency: 'KGS', currencySymbol: 'с',    referenceCity: 'Кара-Балта', premiumThreshold: 4000 },
  KZ: { name: 'Казахстан',  currency: 'KZT', currencySymbol: '₸',    referenceCity: 'Алматы',     premiumThreshold: 25000 },
  RU: { name: 'Россия',     currency: 'RUB', currencySymbol: '₽',    referenceCity: 'Москва',     premiumThreshold: 5000 },
  UZ: { name: 'Узбекистан', currency: 'UZS', currencySymbol: 'сўм',  referenceCity: 'Ташкент',    premiumThreshold: 600000 },
};

// ════════════════════════════════════════════════════════════════════
// 2) БАЗЫ ТИПОВ ПО СТРАНАМ (муж, бакет 1, baseline-город страны)
// ════════════════════════════════════════════════════════════════════

/**
 * B_t(country) — опорная цена. Для каждой страны в её локальной валюте.
 * Калибруется по фактическим продажам в baseline-городе (после 3 месяцев).
 */
/**
 * RP/RM — «для чтения» (очки ±0.75…±3.00 для пресбиопии).
 * Целевая аудитория — пенсионеры, им нужен бюджетный вход.
 * Базы НИЖЕ PA/MA намеренно: для чтения ≠ премиум, это доступная функциональная линия.
 * Соотношение выдержано для всех стран одинаково:
 *   RP ≈ 0.58 × PA,  RM ≈ 0.64 × MA
 * Если вы продаёте дорогие оправы «для чтения» (титан, бренды) —
 * заводите их отдельными типами, не смешивая с RP/RM.
 */
export const TYPE_BASE_BY_COUNTRY: Record<CountryCode, Record<FrameTypeCode, number>> = {
  KG: { PA: 1200,   MA: 1400,   RP: 700,    RM: 900,    KD: 800,    RL: 6000 },    // RL — безоправные премиум, плоская цена ~6000с
  KZ: { PA: 8500,   MA: 10000,  RP: 5000,   RM: 6500,   KD: 5800,   RL: 38000 },   // в тенге (гипотеза)
  RU: { PA: 2000,   MA: 2400,   RP: 1200,   RM: 1500,   KD: 1300,   RL: 8500 },    // в рублях (гипотеза)
  UZ: { PA: 180000, MA: 220000, RP: 105000, RM: 140000, KD: 120000, RL: 720000 },  // в сумах (гипотеза)
};

/**
 * МИНИМАЛЬНЫЕ ДОПУСТИМЫЕ ЦЕНЫ по типу — нижняя граница, которую формула
 * не должна нарушать при генерации вариаций b1. Используется как floor в
 * computeBucketSafeZone(b1).
 *
 * Должно совпадать с FRAME_TYPE_PRICE_RULES в [branchId]/page.tsx, иначе
 * формула сгенерирует цены, которые не пройдут валидацию при печати.
 *
 * Для MA берём max(MA_F_min, MA_M_min) = 1400 (мужской стрчиже).
 * Для PA: max(PA_F_min=1000, PA_M_min=1200) = 1200.
 */
export const TYPE_MIN_PRICE_BY_COUNTRY: Record<CountryCode, Record<FrameTypeCode, number>> = {
  KG: { PA: 1200, MA: 1400, RP: 800,    RM: 1000,   KD: 800,    RL: 6000 },
  KZ: { PA: 7000, MA: 9000, RP: 5000,   RM: 6000,   KD: 5000,   RL: 35000 },
  RU: { PA: 1500, MA: 1800, RP: 1000,   RM: 1200,   KD: 1000,   RL: 7500 },
  UZ: { PA: 150000, MA: 200000, RP: 100000, RM: 130000, KD: 100000, RL: 650000 },
};

export function getTypeMinPrice(type: FrameTypeCode, branchName: string): number {
  const country = getBranchCountry(branchName);
  if (!country) return 10;
  return TYPE_MIN_PRICE_BY_COUNTRY[country]?.[type] ?? 10;
}

// ════════════════════════════════════════════════════════════════════
// 3) КОЭФФИЦИЕНТЫ ФОРМУЛЫ
// ════════════════════════════════════════════════════════════════════

/**
 * Коэф пола. Ранее G_F=0.9 (женщинам скидка 10%), но это противоречит индустриальным данным:
 * женщины в оптике тратят в среднем БОЛЬШЕ мужчин (больше пар, выше чек на пару).
 * Поставили G_F=1.0 (равенство). При желании можно поднять до 1.05–1.10.
 */
export const GENDER_COEFFICIENT: Record<GenderCode, number> = {
  M: 1.0,
  F: 1.0,
};

/** q — шаг бакета. +25% на каждый бакет (закон Вебера-Фехнера, Kotler). */
export const BUCKET_STEP = 1.25;

/**
 * Границы мёртвой зоны (психологический провал под базой следующего бакета).
 *
 * 0.85 → 0.88 → 0.89 → 0.90 (мёртвая зона сжимается до 7%):
 * - 0.85: PA_F b2 count=22 помещалось только 14 (теряли 8 ценников).
 * - 0.88: 22 помещается, но при PA_F=81 b2 становится 23 → не входит на шаге 10.
 * - 0.89: b2 safe-зона расширяется до 230с (1760-1990), вмещает 23 шт.
 * - 0.90: при PA_F=87 b2=25 не входит в 230с → расширили до 260с (1760-2020).
 *
 * При 0.90 психологический провал всё ещё чёток (~7% gap между bucket'ами).
 * Дальше сжимать опасно — провал станет неотличим от вариации внутри тира.
 */
export const DEAD_ZONE_LOWER = 0.90;
export const DEAD_ZONE_UPPER = 0.97;

// ════════════════════════════════════════════════════════════════════
// 4) ГОРОДА
// ════════════════════════════════════════════════════════════════════

/**
 * Каталог известных городов с их страной и локальным индексом.
 * Индекс города — отношение к baseline-городу его страны (Кара-Балта для KG, Алматы для KZ и т.д.).
 *
 * Гипотезы помечены в комментариях — калибруются после 3 месяцев реальных продаж.
 */
export const CITY_INDEX: Record<string, { country: CountryCode; index: number }> = {
  // ── Кыргызстан (baseline Кара-Балта) ──
  'Кара-Балта':       { country: 'KG', index: 1.00 }, // база — 386 реальных продаж
  'Токмок':           { country: 'KG', index: 1.20 }, // калибровано через AI
  'Бишкек':           { country: 'KG', index: 1.30 }, // гипотеза
  'Кант':             { country: 'KG', index: 1.05 }, // гипотеза
  'Сокулук':          { country: 'KG', index: 1.10 }, // гипотеза
  'Беловодск':        { country: 'KG', index: 0.90 }, // гипотеза

  // ── Казахстан (baseline Алматы) ──
  'Алматы':           { country: 'KZ', index: 1.00 }, // база
  'Алматы 2':         { country: 'KZ', index: 1.00 },
  'Астана':           { country: 'KZ', index: 1.15 }, // столица, средний чек выше
  'Шымкент':          { country: 'KZ', index: 0.80 },
  'Караганда':        { country: 'KZ', index: 0.75 },
  'Костанай':         { country: 'KZ', index: 0.70 },
  'Павлодар':         { country: 'KZ', index: 0.75 },
  'Усть-Каменогорск': { country: 'KZ', index: 0.70 },
  'Тараз':            { country: 'KZ', index: 0.75 },
  'Семей':            { country: 'KZ', index: 0.70 },
  'Атырау':           { country: 'KZ', index: 1.10 }, // нефтяной город — выше среднего
  'Актау':            { country: 'KZ', index: 1.00 },
  'Туркестан':        { country: 'KZ', index: 0.65 },
  'Кызылорда':        { country: 'KZ', index: 0.70 },

  // ── Россия (baseline Москва) ──
  'Москва':            { country: 'RU', index: 1.00 }, // база
  'Санкт-Петербург':   { country: 'RU', index: 0.90 },
  'Казань':            { country: 'RU', index: 0.65 },
  'Новосибирск':       { country: 'RU', index: 0.65 },
  'Екатеринбург':      { country: 'RU', index: 0.70 },
  'Краснодар':         { country: 'RU', index: 0.70 },
  'Нижний Новгород':   { country: 'RU', index: 0.60 },
  'Уфа':               { country: 'RU', index: 0.55 },
  'Красноярск':        { country: 'RU', index: 0.60 },
  'Омск':              { country: 'RU', index: 0.50 },
  'Челябинск':         { country: 'RU', index: 0.55 },

  // ── Узбекистан (baseline Ташкент) ──
  'Ташкент':           { country: 'UZ', index: 1.00 }, // база
  'Самарканд':         { country: 'UZ', index: 0.80 },
  'Бухара':            { country: 'UZ', index: 0.75 },
  'Андижан':           { country: 'UZ', index: 0.70 },
  'Наманган':          { country: 'UZ', index: 0.70 },
  'Нукус':             { country: 'UZ', index: 0.65 },
};

// ════════════════════════════════════════════════════════════════════
// 5) РАСПРЕДЕЛЕНИЕ СЛОТОВ
// ════════════════════════════════════════════════════════════════════

/**
 * Доли секций в общей раскладке (сумма = 1).
 *
 * RL (безоправные) занимают 7.7% всей витрины: 5.0% F + 2.7% M.
 * Остальные секции пропорционально сжаты на коэффициент 0.923 (= 1 − 0.077),
 * чтобы итоговая сумма = 1 и распределение PA/MA/RP/RM/KD оставалось
 * пропорциональным предыдущей раскладке 35:28:35:28:14:14:7:7.
 *
 * Базовый знаменатель 340 — оптимальная раскладка для Токмока (без ошибок
 * округления). Для любого другого totalSlots сумма по секциям остаётся
 * равной totalSlots благодаря методу наибольшего остатка (Hamilton),
 * см. computeAllSectionSlotsForBranch ниже.
 */
export const SECTION_SLOT_SHARE: Record<SectionKey, number> = {
  PA_F: 65 / 340,
  PA_M: 53 / 340,
  MA_F: 65 / 340,
  MA_M: 53 / 340,
  RP_F: 26 / 340,
  RM_F: 26 / 340,
  KD_F: 13 / 340,
  KD_M: 13 / 340,
  RL_F: 17 / 340, // 5.0% — главная гендерная доля безоправных
  RL_M: 9 / 340,  // 2.6% — мужских безоправных меньше
  RP_M: 0,
  RM_M: 0,
};

/**
 * Per-branch override SECTION_SLOT_SHARE — для калибровки под физическую
 * раскладку конкретного филиала.
 *
 * Используется, когда у филиала есть фиксированные физические зоны
 * (например, KIDS-полка ровно 36 ячеек, reading-стенка ровно 60), и нужно
 * чтобы количество ценников каждой секции точно совпадало с её зоной.
 *
 * ВАЖНО: значения должны суммироваться в 1.0 (в пределах округления).
 *
 * Если филиал расширяется/перекомпонуется — пересчитать и обновить.
 */
export const BRANCH_SECTION_SLOT_SHARE: Record<string, Partial<Record<SectionKey, number>>> = {
  // ─────────────────────────────────────────────────────────────────────
  // Токмок (380 ячеек, шары подогнаны под row-aligned grouping):
  //   Полка вход 1.20м × 7 кол × 6 ряд = 42 ячейки
  //     - Bottom 4 ряда (28) = KIDS: KD_F cols 0-3 (16) + KD_M cols 4-6 (12)
  //     - Top 2 ряда (14) = PA_F entry, no PA_M (вход стал женско-детским)
  //   Длинная стена 4.84м × 24 кол × 6 ряд = 144 ячейки
  //   Дальняя 2.00м × 9 кол × 6 ряд = 54 ячейки (RP_F=27, RM_F=27)
  //   Остров 4 блока × 7×5 = 140 ячеек:
  //     Block 1 = MA_F pure       (5 prem + 1 anchor + 29 overflow = 35)
  //     Block 2 = PA_M rows 4-3 (14) + MA_M rows 2-1-0 (21) = 35
  //     Block 3 = PA_F pure       (3 prem + 32 overflow = 35)
  //     Block 4 = 35 RL (УНИСЕКС, все cells tracked as RL_F)
  //
  // Δ от прошлой версии: PA_F 87→85 (−2), PA_M 62→50 (−12),
  //                      KD_F 8→16 (+8), KD_M 6→12 (+6). Сумма 0, остаётся 380.
  // Мужской пластик удалён из входа (12 ячеек), занят расширенным детским
  // сектором (28 ячеек 4 ряда вместо 14 двух рядов).
  //
  // Гендер Ж/М по витрине: 217 / 163 ≈ 57.1%/42.9% (если KIDS считать поровну
  // 8 в KD_F-сторону + 12 KD_F = 20 жен KIDS, KD_M=12). Если KIDS считать
  // нейтральными — adult-only 196 / 142 ≈ 58%/42%.
  //
  // Если пересчитаешь физическую вместимость — обнови и здесь, и в
  // shelfLayoutPlan.ts (makeZone + fill блоков).
  // ─────────────────────────────────────────────────────────────────────
  'Токмок': {
    PA_F: 85 / 380,
    PA_M: 50 / 380,
    MA_F: 71 / 380,
    MA_M: 57 / 380,
    // Дальняя стена 2.00м · вертикальные полосы вместо горизонтальных:
    //   cols 0-3 (4 кол × 6р = 24) = RM_F (металл, слева, ближе к центру)
    //   cols 4-8 (5 кол × 6р = 30) = RP_F (пластик, справа, у внешнего края)
    // Сумма 54, как и раньше. Пластик увеличен (+3), металл уменьшен (−3).
    RP_F: 30 / 380,
    RM_F: 24 / 380,
    KD_F: 16 / 380,
    KD_M: 12 / 380,
    // RL — УНИСЕКС: вся 35-ячейка RL-зона трекается как gender=F.
    // Печать с страницы штрих-кодов идёт как RL_F (одна строка в TYPE_SECTIONS).
    RL_F: 35 / 380,
    RL_M: 0,
    RP_M: 0,
    RM_M: 0,
  },
  // ─────────────────────────────────────────────────────────────────────
  // Кант (252 ячейки = 2 стены × 3 секции × 42; секция = 7 кол × 6 рядов).
  // Острова НЕТ. K=1.05, KG. RL — УНИСЕКС (трекается как RL_F, RL_M=0).
  // Раскладка (Вариант A v3, по правкам владельца) — каждая категория =
  // непрерывный блок целых колонок (колонка = 6 ячеек):
  //   ПРАВАЯ стена (ЖЕНСКАЯ, 126): чтение тоже женское (это вид женской оправы).
  //     PA_F 48 (8 кол) | RP_F 18 (3 кол, чтение пластик) | RM_F 12 (2 кол, чтение металл) | MA_F 48 (8 кол, +премиум)
  //   ЛЕВАЯ стена (МУЖСКАЯ + дети + безоправные, 126):
  //     PA_M 54 (9) | MA_M 54 (9, +премиум) | KD_F 6 (1) | KD_M 6 (1) | RL_F 6 (1, дальний край)
  // Чтение-пластик расширено до 3 кол (18), чтение-металл 2 кол (12): чтобы дать столько РАЗЛИЧИМЫХ цен,
  // RP/RM Канта генерятся ГЛАДКОЙ лестницей (BRANCH_READING_SMOOTH_LADDER) — без
  // мёртвых зон, заполняя «пробелы» (950/1000/1100…), без повторов. RM ужат до 1 кол;
  // PA_F и MA_F ужаты с 9 до 8 кол. Все доли кратны 6 → Σ = 252. Заливка — shelfLayoutPlan.
  // ─────────────────────────────────────────────────────────────────────
  'Кант': {
    PA_F: 48 / 252,
    PA_M: 54 / 252,
    MA_F: 48 / 252,
    MA_M: 54 / 252,
    RP_F: 18 / 252,
    RM_F: 12 / 252,
    KD_F: 6 / 252,
    KD_M: 6 / 252,
    RL_F: 6 / 252,
    RL_M: 0,
    RP_M: 0,
    RM_M: 0,
  },
};

/** Реальная доля секции с учётом per-branch override. */
function getSectionSlotShare(branchName: string, key: SectionKey): number {
  const override = BRANCH_SECTION_SLOT_SHARE[branchName];
  if (override && override[key] !== undefined) return override[key]!;
  return SECTION_SLOT_SHARE[key] ?? 0;
}

/**
 * Коэф подходящести секции для премиум-якоря (0 = без премиум).
 *
 * KD стоит ниже PA_F (0.2 vs 0.4): дети — категория ценочувствительная,
 * но один премиум-якорь (брендовая/титановая детская оправа) даёт сигнал
 * «у нас и для детей есть премиум». Реальная гарантия минимум 1 шт. при
 * eligibility > 0 и total ≥ 5 — в computeSectionSplit.
 */
export const PREMIUM_ELIGIBILITY: Record<SectionKey, number> = {
  MA_M: 1.0,
  MA_F: 0.8,
  PA_M: 0.6,
  PA_F: 0.4,
  RM_F: 0.3,
  KD_F: 0.2,
  KD_M: 0.2,
  RP_F: 0,
  RP_M: 0,
  RM_M: 0,
  // RL — плоская цена ~6000с, без премиум-якорей через бакеты
  RL_F: 0,
  RL_M: 0,
};

/** Доли regular-слотов по бакетам 1–4. */
export const REGULAR_BUCKET_SHARE: Record<BucketId, number> = {
  1: 0.40,
  2: 0.30,
  3: 0.20,
  4: 0.10,
};

// ════════════════════════════════════════════════════════════════════
// 6) КОНФИГУРАЦИЯ ФИЛИАЛОВ
// ════════════════════════════════════════════════════════════════════

/**
 * Физическая ёмкость витрины филиала.
 * Значения в этом объекте — fallback на случай, если в БД не задано.
 * Актуальное значение приходит из `branches.frame_total_slots` и применяется
 * runtime-функцией `setBranchTotalSlots(name, value)` при загрузке страницы.
 */
export const BRANCH_TOTAL_SLOTS: Record<string, number> = {
  'Токмок': 380,
  'Кант': 252, // 2 стены × 3 секции × (7 кол × 6 рядов = 42); fallback, актуальное — из branches.frame_total_slots
  // другие — по мере подключения
};

/** Runtime override. Заполняется со страницы после чтения из БД. */
const RUNTIME_TOTAL_SLOTS = new Map<string, number>();

/**
 * Установить ёмкость филиала в runtime (после чтения из БД).
 * Если value ≤ 0 — override снимается и берётся константа-fallback.
 */
export function setBranchTotalSlots(branchName: string, value: number): void {
  if (Number.isFinite(value) && value > 0) {
    RUNTIME_TOTAL_SLOTS.set(branchName, Math.round(value));
  } else {
    RUNTIME_TOTAL_SLOTS.delete(branchName);
  }
}

/** Список филиалов, где применяется формула. Остальные — на старой логике. */
export const FORMULA_ENABLED_BRANCHES: Set<string> = new Set<string>([
  'Токмок',
  'Кант',
]);

/**
 * Филиалы, где не используем «автодопечатку по продажам» (suggestMap).
 * Для них список к печати формируется только из формульной/ladder-сетки,
 * без подмешивания ранее проданных цен.
 */
export const BRANCHES_WITHOUT_AUTO_REPLENISH: Set<string> = new Set<string>([
  'Кант',
  'Токмок',
]);

/**
 * Плановая ёмкость витрин для legacy-филиалов (без формулы).
 * Стартовое значение; на странице филиала переопределяется через localStorage.
 * Для формульных филиалов ёмкость берётся из BRANCH_TOTAL_SLOTS / runtime override.
 */
export const LEGACY_BRANCH_CAPACITY: Record<string, number> = {
  Сокулук: 120,
  Беловодск: 100,
  'Кара-Балта': 168,
  Кант: 120, // dead: Кант переведён на формулу (FORMULA_ENABLED_BRANCHES) — значение не используется
};

/** Глобальная доля премиум в формуле auto α = PREMIUM_BASE_SHARE × K_c. */
export const PREMIUM_BASE_SHARE = 0.08;

/**
 * RL anchor ladder per country (override для верхнего тира безоправных).
 *
 * По умолчанию tier 5 RL = base × 2.1667 ≈ 13000 в KG. Это создаёт «склейку»
 * с MA-якорем (тоже 13000) → нет иерархии «RL > MA по премиальности».
 *
 * Override-лестница: tier 5 получает N ценников по заданным ценам, заменяя
 * default-расчёт. Создаёт явный jump от tier 4 (~12000) к ultra-premium-зоне.
 * Излишек ячеек берётся из tier 0 (entry-tier 6000).
 *
 * null = использовать default tierMults расчёт.
 */
export const RL_ANCHOR_LADDER_BY_COUNTRY: Record<CountryCode, number[] | null> = {
  KG: [16000, 16500, 17000],  // 3 ценника, выше MA-якоря 13000
  KZ: null,
  RU: null,
  UZ: null,
};

/**
 * Per-branch override RL-лестницы (приоритет над страновой RL_ANCHOR_LADDER_BY_COUNTRY).
 * Если филиал ПРИСУТСТВУЕТ в этой карте — берётся его значение, ВКЛЮЧАЯ null
 * (null = без ультра-лестницы: натуральная пирамида с топом ~13000, cap=1).
 * Если филиала нет — fallback на страновую лестницу.
 *
 * Кант (K=1.05, малый/пограничный город): null — не даём ультра-якоря 16-17к,
 * иначе RL-потолок читается как «не для нас». Токмок (нет в карте) сохраняет
 * страновую KG-лестницу 16000/16500/17000.
 */
export const BRANCH_RL_ANCHOR_LADDER: Record<string, number[] | null> = {
  'Кант': null,
};

/** RL-лестница для филиала: branch override (если есть ключ) > страновой default. */
export function getRLAnchorLadder(branchName: string, country: CountryCode): number[] | null {
  if (Object.prototype.hasOwnProperty.call(BRANCH_RL_ANCHOR_LADDER, branchName)) {
    return BRANCH_RL_ANCHOR_LADDER[branchName];
  }
  return RL_ANCHOR_LADDER_BY_COUNTRY[country];
}

/**
 * Per-branch ЯВНЫЙ список цен RL (безоправных) — полный override пирамиды/лестницы.
 * Владелец задаёт точные цены (каждая своя — для вариации). Длина массива ДОЛЖНА
 * равняться числу слотов RL-секции филиала. Если задан — обычная RL-логика
 * (пирамида тиров + getRLAnchorLadder) не применяется. Нет ключа — обычная логика.
 */
export const BRANCH_RL_EXPLICIT_PRICES: Record<string, number[]> = {
  // Кант: 6 безоправных, каждая со своей ценой (вариация), дальний край левой стены.
  'Кант': [6000, 6500, 7600, 9000, 10500, 13000],
};

/**
 * Премиум-«мостик» (H2): филиалы, у которых фэшн-секции (PA/MA) получают
 * дополнительный НИЖНИЙ премиум-рунг, закрывающий пустой ценовой коридор между
 * массовым потолком (b4) и первым премиумом. Реализация:
 *   • computePremiumStartBucket опускает старт на 1 бакет (b6→b5);
 *   • computeSectionSplit добавляет +1 премиум-ячейку (фондируется из regular).
 * Вместе это вставляет рунг ~3000/3500 СНИЗУ, СОХРАНЯЯ верх лестницы (top не падает).
 * Только PA/MA — у микро-секций (чтение/дети) коридора-проблемы нет.
 */
export const BRANCH_PREMIUM_BRIDGE: Set<string> = new Set<string>(['Кант']);

function branchUsesPremiumBridge(branchName: string, type: FrameTypeCode): boolean {
  return BRANCH_PREMIUM_BRIDGE.has(branchName) && (type === 'PA' || type === 'MA');
}

/**
 * Гладкая лестница чтения: филиалы, где RP/RM генерируются РАВНОМЕРНОЙ лестницей
 * различимых цен через весь диапазон, БЕЗ мёртвых зон и бакет-кластеров.
 * Дешёвые читалки не нуждаются в тировой сепарации (как фэшн), зато так можно дать
 * больше РАЗЛИЧИМЫХ цен (заполнить «пробелы» 950/1000/1100…) без повторов — нужно,
 * когда секция чтения большая (Кант: RP_F=24). Токмок (нет в наборе) — обычная логика.
 */
export const BRANCH_READING_SMOOTH_LADDER: Set<string> = new Set<string>(['Кант']);

function branchUsesReadingSmoothLadder(branchName: string): boolean {
  return BRANCH_READING_SMOOTH_LADDER.has(branchName);
}

/** Ручной override доли премиум (приоритет над автоформулой). undefined = auto. */
export const BRANCH_PREMIUM_SHARE_OVERRIDE: Record<string, number | undefined> = {
  // 'Токмок': 0.108,  // при желании — ручной. Сейчас auto = 0.08 × 1.20 = 0.096
};

/**
 * Витринные «декой-якоря» сверх естественной премиум-сетки.
 *
 * Decoy / asymmetric dominance (Ariely "Predictably Irrational" 2008,
 * Huber-Payne-Puto 1982): один заметно более дорогой ценник поднимает
 * воспринимаемую ценность мид-премиума (4–10к в KG) — клиент сравнивает
 * 6500с с 13000с и видит «умную середину», а не «дорого без причины».
 *
 * Decoy НЕ предполагает регулярных продаж — он *присутствует* как визуальный
 * референс. Превращать декой в линейку (3+ позиции в зоне 13к+) для малого
 * города ПРОТИВОПОКАЗАНО — клиент считывает «оптика не для меня» и уходит
 * из всей премиум-зоны, не только от якорей (Veblen, малые рынки).
 *
 * Формат: массив номеров бакетов. Например, [10] для MA_M в KG = b10 = 13000с.
 * При перекрытии с естественным премиумом (если premium count уже достигает
 * этого бакета) якорь автоматически пропускается — нечего дублировать.
 *
 * Маленькие/бедные филиалы обычно НЕ добавляют якорей: даже один декой 13к
 * в городе с K_c ≤ 0.9 будет восприниматься как «не для нас».
 */
export const BRANCH_TOP_ANCHORS: Record<string, Partial<Record<SectionKey, number[]>>> = {
  // Токмок (K=1.20, ~308 слотов): один декой в каждой металлической секции.
  // b10 → 13000с. Cap MA = 15000с (запас на вариации/рост).
  // Пластик (PA) и детские (KD) НЕ получают декоев — для Токмока перебор:
  // премиум пластик 13к = редкий коллекционный сегмент, нет реальной аудитории.
  'Токмок': {
    MA_M: [10],
    MA_F: [10],
  },
};

// ════════════════════════════════════════════════════════════════════
// 7) HELPER-ФУНКЦИИ
// ════════════════════════════════════════════════════════════════════

export function getCityRecord(branchName: string): { country: CountryCode; index: number } | null {
  return CITY_INDEX[branchName] ?? null;
}

export function getBranchCountry(branchName: string): CountryCode | null {
  return getCityRecord(branchName)?.country ?? null;
}

export function getCityIndex(branchName: string): number {
  return getCityRecord(branchName)?.index ?? 1.0;
}

export function getBranchCurrency(branchName: string): string {
  const c = getBranchCountry(branchName);
  return c ? COUNTRIES[c].currency : 'KGS';
}

export function getBranchCurrencySymbol(branchName: string): string {
  const c = getBranchCountry(branchName);
  return c ? COUNTRIES[c].currencySymbol : 'с';
}

export function getBranchTotalSlots(branchName: string): number {
  const override = RUNTIME_TOTAL_SLOTS.get(branchName);
  if (override !== undefined && override > 0) return override;
  return BRANCH_TOTAL_SLOTS[branchName] ?? 0;
}

export function isBranchUsingFormula(branchName: string): boolean {
  return FORMULA_ENABLED_BRANCHES.has(branchName)
    && branchName in CITY_INDEX
    && getBranchTotalSlots(branchName) > 0;
}

export function getBranchPremiumShare(branchName: string): number {
  const override = BRANCH_PREMIUM_SHARE_OVERRIDE[branchName];
  if (override !== undefined) return override;
  const k = getCityIndex(branchName);
  const raw = PREMIUM_BASE_SHARE * k;
  return Math.max(0, Math.min(0.15, raw));
}

export function getCountryPremiumThreshold(branchName: string): number {
  const c = getBranchCountry(branchName);
  return c ? COUNTRIES[c].premiumThreshold : 4000;
}

/** Список номеров бакетов «витринных декоев» для секции в данном филиале. */
export function getBranchTopAnchors(
  branchName: string,
  type: FrameTypeCode,
  gender: GenderCode,
): number[] {
  const cfg = BRANCH_TOP_ANCHORS[branchName];
  if (!cfg) return [];
  return cfg[`${type}_${gender}` as SectionKey] ?? [];
}

// ════════════════════════════════════════════════════════════════════
// 8) ЯДРО ФОРМУЛЫ ЦЕНЫ
// ════════════════════════════════════════════════════════════════════

export function computeRawPrice(
  type: FrameTypeCode,
  gender: GenderCode,
  bucket: number,
  branchName: string,
): number {
  const country = getBranchCountry(branchName);
  if (!country) return 0;
  const baseMaleB1 = TYPE_BASE_BY_COUNTRY[country][type] ?? 0;
  const gCoef = GENDER_COEFFICIENT[gender] ?? 1;
  const bCoef = Math.pow(BUCKET_STEP, bucket - 1);
  const kCity = getCityIndex(branchName);
  return baseMaleB1 * gCoef * bCoef * kCity;
}

/** Обычная цена — округление до 10 единиц локальной валюты. */
export function computePrice(
  type: FrameTypeCode,
  gender: GenderCode,
  bucket: number,
  branchName: string,
): number {
  return Math.round(computeRawPrice(type, gender, bucket, branchName) / 10) * 10;
}

/**
 * Премиум-цена — округление к «красивым» числам (Kotler — якорь должен звучать).
 *  • <10× премиум-порога → шаг 500 единиц валюты
 *  • ≥10× премиум-порога → шаг 1000 единиц валюты
 * Для KZ/UZ валют с большими номиналами логика пропорциональная.
 */
export function computePremiumPrice(
  type: FrameTypeCode,
  gender: GenderCode,
  bucket: number,
  branchName: string,
): number {
  const raw = computeRawPrice(type, gender, bucket, branchName);
  const country = getBranchCountry(branchName);
  if (!country) return Math.round(raw / 10) * 10;

  // Шаг округления масштабируется с премиум-порогом страны:
  //   KG (4000)    → step 500  / big step 1000
  //   KZ (25000)   → step 2500 / big step 5000
  //   RU (5000)    → step 500  / big step 1000
  //   UZ (600000)  → step 50000 / big step 100000
  const threshold = COUNTRIES[country].premiumThreshold;
  const smallStep = Math.round(threshold / 8 / 10) * 10;   // ~12.5% от порога
  const bigStep = smallStep * 2;
  const switchPoint = threshold * 2.5; // где переключаемся на big step

  const step = raw < switchPoint ? smallStep : bigStep;
  return Math.round(raw / step) * step;
}

/**
 * Первый премиум-бакет: минимальный n ≥ 5, где ОКРУГЛЁННАЯ премиум-цена
 * ≥ порогу страны.
 */
export function computePremiumStartBucket(
  type: FrameTypeCode,
  gender: GenderCode,
  branchName: string,
): number {
  const threshold = getCountryPremiumThreshold(branchName);
  let start = 5;
  for (let n = 5; n <= 20; n++) {
    if (computePremiumPrice(type, gender, n, branchName) >= threshold) {
      start = n;
      break;
    }
  }
  // Премиум-«мостик» (H2): опускаем старт на 1 бакет у фэшна бридж-филиалов,
  // чтобы добавить нижний рунг (~3000/3500) в коридоре b4→премиум.
  // Парная +1 премиум-ячейка — в computeSectionSplit (верх лестницы сохраняется).
  if (start > 5 && branchUsesPremiumBridge(branchName, type)) {
    start -= 1;
  }
  return start;
}

// ════════════════════════════════════════════════════════════════════
// 9) МЁРТВЫЕ ЗОНЫ
// ════════════════════════════════════════════════════════════════════

/**
 * Мёртвые зоны для секции — диапазоны цен, где ценник работать не будет.
 * Каждая зона лежит под базой следующего бакета в интервале [85% .. 97%].
 *
 * При генерации вариаций внутри бакета n формула пропускает цены, попадающие
 * в мёртвую зону перед бакетом n+1.
 */
export function computeDeadZones(
  type: FrameTypeCode,
  gender: GenderCode,
  branchName: string,
  includeBeforePremium = true,
): DeadZone[] {
  const zones: DeadZone[] = [];

  // Зоны перед бакетами 2, 3, 4 (применяются к вариациям 1, 2, 3)
  for (let nextBucket = 2; nextBucket <= 4; nextBucket++) {
    const nextBase = computeRawPrice(type, gender, nextBucket, branchName);
    if (nextBase <= 0) continue;
    zones.push({
      from: Math.round((nextBase * DEAD_ZONE_LOWER) / 10) * 10,
      to: Math.round((nextBase * DEAD_ZONE_UPPER) / 10) * 10,
      beforeBucket: nextBucket,
    });
  }

  // Зона перед первым премиум-бакетом (если в секции есть премиум)
  if (includeBeforePremium) {
    const premiumStart = computePremiumStartBucket(type, gender, branchName);
    const nextBase = computeRawPrice(type, gender, premiumStart, branchName);
    if (nextBase > 0) {
      zones.push({
        from: Math.round((nextBase * DEAD_ZONE_LOWER) / 10) * 10,
        to: Math.round((nextBase * DEAD_ZONE_UPPER) / 10) * 10,
        beforeBucket: premiumStart,
      });
    }
  }

  return zones;
}

/** Попадает ли цена в любую из переданных мёртвых зон. Публичный helper для UI/тестов. */
export function isInDeadZone(price: number, zones: DeadZone[]): boolean {
  return zones.some((z) => price >= z.from && price <= z.to);
}

// ════════════════════════════════════════════════════════════════════
// 10) РАСПРЕДЕЛЕНИЕ СЛОТОВ ПО СЕКЦИИ И БАКЕТАМ
// ════════════════════════════════════════════════════════════════════

/**
 * Раскладка по всем секциям сразу с гарантией Σ = totalSlots.
 *
 * Используется метод наибольшего остатка (Hamilton / Hare): берём floor от
 * exact share, остаток (total − Σ floor) распределяем по секциям с самой
 * большой дробной частью. Это стандартный способ распределить целое число
 * пропорционально дробям так, чтобы сумма совпала.
 *
 * Дополнительно: если total > 0, защищаем от полного «обнуления» секций,
 * у которых формально share > 0, но floor = 0 — такие секции вытягивают
 * хотя бы 1 слот за счёт самых «округлившихся вниз» (см. computeSectionSplit).
 */
export function computeAllSectionSlotsForBranch(
  branchName: string,
): Record<SectionKey, number> {
  const total = getBranchTotalSlots(branchName);
  const sections = Object.keys(SECTION_SLOT_SHARE) as SectionKey[];
  const result: Record<SectionKey, number> = {} as Record<SectionKey, number>;

  if (total <= 0) {
    sections.forEach((k) => {
      result[k] = 0;
    });
    return result;
  }

  // Берём long shares с учётом per-branch override (BRANCH_SECTION_SLOT_SHARE).
  const exact = sections.map((k) => total * getSectionSlotShare(branchName, k));
  const floor = exact.map((x) => Math.floor(x));
  const remainder = exact.map((x, i) => x - floor[i]);
  const sumFloor = floor.reduce((s, x) => s + x, 0);
  const deficit = total - sumFloor; // ≥ 0 потому что Σ shares = 1

  // Сортируем индексы по убыванию остатка (стабильная сортировка → детерминизм).
  const order = remainder
    .map((r, i) => ({ i, r }))
    .sort((a, b) => b.r - a.r);

  const adjusted = [...floor];
  for (let n = 0; n < deficit && n < order.length; n++) {
    adjusted[order[n].i] += 1;
  }

  sections.forEach((k, i) => {
    result[k] = adjusted[i];
  });
  return result;
}

/** Всего слотов в секции (тип+пол) для филиала. Σ по всем секциям = totalSlots. */
export function computeSectionTotalSlots(
  type: FrameTypeCode,
  gender: GenderCode,
  branchName: string,
): number {
  const all = computeAllSectionSlotsForBranch(branchName);
  return all[`${type}_${gender}` as SectionKey] ?? 0;
}

/**
 * Разделение секции на regular + premium + anchor.
 *
 * - regular: ценники в обычных бакетах b1–b4 (массовый сегмент)
 * - premium: естественная премиум-сетка от premiumStart, count = round(total × α × eligibility)
 *            (с гарантией ≥ 1 при eligibility > 0 и total ≥ 5)
 * - anchor: витринные декои из BRANCH_TOP_ANCHORS, КОТОРЫЕ НЕ ПЕРЕКРЫВАЮТСЯ
 *           с естественным премиумом (если premium уже достиг бакета якоря —
 *           добавлять нечего).
 *
 * Σ regular + premium + anchor = total.
 */
export function computeSectionSplit(
  type: FrameTypeCode,
  gender: GenderCode,
  branchName: string,
): { total: number; regular: number; premium: number; anchor: number } {
  const key: SectionKey = `${type}_${gender}`;
  const total = computeSectionTotalSlots(type, gender, branchName);
  const alpha = getBranchPremiumShare(branchName);
  const eligibility = PREMIUM_ELIGIBILITY[key] ?? 0;
  let premium = Math.round(total * alpha * eligibility);
  // Гарантия премиум-якоря: если секция допускает премиум (eligibility > 0)
  // и достаточно крупная (≥ 5 слотов), хотя бы 1 премиум-ценник должен быть.
  // Без этого мелкие секции (например, KD на 12 слотов в Токмоке) теряют
  // премиум-сигнал из-за округления при низком α × eligibility.
  if (premium === 0 && eligibility > 0 && total >= 5) {
    premium = 1;
  }

  // Премиум-«мостик» (H2): для фэшна (PA/MA) бридж-филиалов +1 премиум-ячейка,
  // фондируется из regular. Вместе с опущенным на 1 premiumStart (см.
  // computePremiumStartBucket) это вставляет нижний рунг ~3000/3500, СОХРАНЯЯ верх.
  if (premium >= 1 && branchUsesPremiumBridge(branchName, type)) {
    premium += 1;
  }

  // Витринные декои: только не перекрывающиеся с естественным премиумом.
  // Якорь должен лежать ВЫШЕ верхнего бакета регулярного премиума, иначе
  // он просто дублирует уже сгенерированную цену.
  let anchor = 0;
  if (eligibility > 0) {
    const anchorBuckets = getBranchTopAnchors(branchName, type, gender);
    if (anchorBuckets.length > 0) {
      const premiumStart = computePremiumStartBucket(type, gender, branchName);
      const naturalTop = premium > 0 ? premiumStart + premium - 1 : 0;
      anchor = anchorBuckets.filter((b) => b > naturalTop).length;
    }
  }

  const regular = Math.max(0, total - premium - anchor);
  return { total, regular, premium, anchor };
}

/** Распределение regular-слотов по 4 бакетам (сумма = regularSlots). */
export function computeRegularBucketCounts(regularSlots: number): Record<BucketId, number> {
  if (regularSlots <= 0) return { 1: 0, 2: 0, 3: 0, 4: 0 };
  const raw: Record<BucketId, number> = {
    1: Math.round(regularSlots * REGULAR_BUCKET_SHARE[1]),
    2: Math.round(regularSlots * REGULAR_BUCKET_SHARE[2]),
    3: Math.round(regularSlots * REGULAR_BUCKET_SHARE[3]),
    4: Math.round(regularSlots * REGULAR_BUCKET_SHARE[4]),
  };
  const sum = raw[1] + raw[2] + raw[3] + raw[4];
  const diff = regularSlots - sum;
  if (diff !== 0) raw[1] += diff;
  return raw;
}

// ════════════════════════════════════════════════════════════════════
// 11) ГЕНЕРАЦИЯ ЦЕН С УЧЁТОМ МЁРТВЫХ ЗОН
// ════════════════════════════════════════════════════════════════════

/**
 * Генерирует `count` цен вокруг basePrice с шагом `step`, строго внутри safe-зоны [lower, upper].
 * Safe-зона = диапазон между мёртвой зоной снизу (конец зоны перед этим бакетом)
 * и мёртвой зоной сверху (начало зоны перед следующим бакетом).
 *
 * Если запрошенный шаг слишком широкий для узкой safe-зоны, шаг автоматически
 * сужается до минимального (10).
 */
function generateBucketVariations(
  basePrice: number,
  count: number,
  requestedStep: number,
  lower: number,
  upper: number,
): number[] {
  if (count <= 0 || upper < lower) return [];

  // Если (count − 1) × step не помещается в safe-зону, шаг сужаем
  let step = requestedStep;
  const range = upper - lower;
  if (count > 1 && (count - 1) * step > range) {
    const fit = Math.floor((range / Math.max(1, count - 1)) / 10) * 10;
    step = Math.max(10, fit);
  }

  // Доп.проверка alignment: сколько РЕАЛЬНО уникальных позиций доступно
  // от basePrice при текущем step. Если base не выровнен с safe-зоной,
  // step=20 может не вместить count даже когда формально range достаточный.
  // Пример: RM_F b2 safe [1320, 1480] = 160с, count=9, step=20.
  // Math: (count-1)*step = 160 ≤ range. Но от base=1350: только 8 позиций
  // в [1320, 1480] на шаге 20. Падаем до step=10 чтобы вместить все 9.
  if (count > 1) {
    const negSteps = Math.floor(Math.max(0, basePrice - lower) / step);
    const posSteps = Math.floor(Math.max(0, upper - basePrice) / step);
    const available = 1 + negSteps + posSteps;
    if (available < count) {
      step = 10;
    }
  }

  const prices: number[] = [];
  const seen = new Set<number>();

  const baseRounded = Math.round(basePrice / 10) * 10;
  if (baseRounded >= lower && baseRounded <= upper) {
    prices.push(baseRounded);
    seen.add(baseRounded);
  }

  let offset = 1;
  const maxOffset = count * 8;
  while (prices.length < count && offset <= maxOffset) {
    for (const sign of [-1, 1]) {
      if (prices.length >= count) break;
      const raw = basePrice + sign * offset * step;
      const rounded = Math.round(raw / 10) * 10;
      if (rounded < lower || rounded > upper) continue;
      if (seen.has(rounded)) continue;
      prices.push(rounded);
      seen.add(rounded);
    }
    offset++;
  }

  return prices.sort((a, b) => a - b);
}

/** Вычисляет safe-зону бакета на основе мёртвых зон. */
function computeBucketSafeZone(
  bucket: BucketId,
  deadZones: DeadZone[],
  hasPremium: boolean,
  /** Минимально допустимая цена — гарантирует что формула не сгенерирует
   *  цены ниже бизнес-минимума типа. Применяется как floor для lower. */
  minFloor: number = 10,
): { lower: number; upper: number } {
  // Нижняя граница: конец мёртвой зоны с beforeBucket === bucket (если есть),
  // но не ниже бизнес-минимума типа.
  let lower = minFloor;
  const zoneBelow = deadZones.find((z) => z.beforeBucket === bucket);
  if (zoneBelow) lower = Math.max(zoneBelow.to + 10, minFloor);

  // Верхняя граница: начало мёртвой зоны перед следующим бакетом
  let upper = Number.MAX_SAFE_INTEGER;
  if (bucket < 4) {
    const zoneAbove = deadZones.find((z) => z.beforeBucket === bucket + 1);
    if (zoneAbove) upper = zoneAbove.from - 10;
  } else if (hasPremium) {
    // Для B4 верхняя граница — мёртвая зона перед премиум-стартом (beforeBucket ≥ 5)
    const zoneBeforePremium = deadZones.find((z) => z.beforeBucket >= 5);
    if (zoneBeforePremium) upper = zoneBeforePremium.from - 10;
  }

  return { lower, upper };
}

/**
 * Полный массив цен для секции: 4 regular-бакета + премиум-якори.
 * Цены уникальные, отсортированные, с обходом мёртвых зон.
 */
export function computeSectionPrices(
  type: FrameTypeCode,
  gender: GenderCode,
  branchName: string,
): number[] {
  if (!isBranchUsingFormula(branchName)) return [];

  // RL — безоправные. Плоская цена ±5% от базы, без бакетов и мёртвых зон.
  // У поставщика они идут одной ценой ~6000с, продаются как «премиум-фиксед».
  if (type === 'RL') {
    const slots = computeSectionTotalSlots(type, gender, branchName);
    if (slots <= 0) return [];

    // Явные цены RL филиала (приоритет над пирамидой). Длина списка = числу слотов.
    const explicitRL = BRANCH_RL_EXPLICIT_PRICES[branchName];
    if (explicitRL && explicitRL.length > 0) {
      return [...explicitRL].sort((a, b) => a - b).slice(0, slots);
    }
    // RL — премиум-категория с пирамидальной ценовой лестницей.
    // Несмотря на то что у поставщика большинство RL ≈ entry-цена (6000с),
    // в реальности рынок имеет несколько тиров RL: titanium, designer,
    // brand RL до 13000с. Витрина должна это отражать (B7 Veblen + decoy).
    //
    // Тиры (KG):
    //   6000   — entry (40%)
    //   7500   — mid-low (25%)
    //   9000   — mid (15%)
    //   10500  — mid-top (10%)
    //   12000  — premium (5%)
    //   13000  — top anchor (5%) — decoy для всей RL-секции
    //
    // ВАЖНО: для RL правило «1 цена = 1 ценник» НЕ применяется.
    // Несколько RL-оправ могут иметь одинаковую цену (например, несколько
    // RL по 6000с — все одного supplier-уровня). doPrint разрешает дубли
    // для type='RL' специфически.
    //
    // НЕ умножаем на city_index — RL premium-fixed, не зависит от города.
    const country = getBranchCountry(branchName);
    if (!country) return [];
    const baseRL = TYPE_BASE_BY_COUNTRY[country][type] ?? 0;
    if (baseRL <= 0) return [];

    // Pyramid distribution: entry-heavy, anchor at top
    const tierMults = [1.00, 1.25, 1.50, 1.75, 2.00, 2.1667];
    const tierShares = [0.40, 0.25, 0.15, 0.10, 0.05, 0.05];

    // Round to country's premium step (KG: 500)
    const threshold = COUNTRIES[country].premiumThreshold;
    const roundStep = Math.round(threshold / 8 / 10) * 10; // KG: 500

    const tierPrices = tierMults.map((m) =>
      Math.round((baseRL * m) / roundStep) * roundStep,
    );
    // Для KG: [6000, 7500, 9000, 10500, 12000, 13000]

    // Hamilton распределение slots по тирам
    const exact = tierShares.map((s) => slots * s);
    const floor = exact.map((x) => Math.floor(x));
    const remainder = exact.map((x, i) => x - floor[i]);
    const sumFloor = floor.reduce((s, x) => s + x, 0);
    const deficit = slots - sumFloor;
    const order = remainder
      .map((r, i) => ({ i, r }))
      .sort((a, b) => b.r - a.r);
    const adjusted = [...floor];
    for (let n = 0; n < deficit && n < order.length; n++) {
      adjusted[order[n].i] += 1;
    }

    // ANCHOR LADDER: tier 5 получает фиксированную лестницу цен из country override
    // (например, KG: [16000, 16500, 17000] — 3 ультра-премиум ценника выше MA-якоря).
    // Если override не задан — fallback на старое поведение (cap = 1, default tier price).
    const anchorLadder = getRLAnchorLadder(branchName, country);
    if (anchorLadder && anchorLadder.length > 0) {
      const want = anchorLadder.length;
      const diff = want - adjusted[5];
      adjusted[5] = want;
      adjusted[0] -= diff;
      if (adjusted[0] < 0) {
        // Edge case (очень малый slots): tier 0 ушёл в минус — ужимаем лестницу.
        adjusted[5] += adjusted[0];
        adjusted[0] = 0;
      }
    } else if (adjusted[5] > 1) {
      // Без override — оставляем cap = 1 (избыток в tier 0).
      adjusted[0] += adjusted[5] - 1;
      adjusted[5] = 1;
    }

    // Build output: each tier contributes `adjusted[i]` items at tierPrices[i].
    // ВАРИАЦИИ ВНУТРИ ТИРА: чтобы не было визуальной «стены» из 8 одинаковых
    // 6000с, каждому item в тире прибавляем step×j (j=0 даёт round-tier-цену).
    // Шаг ~1.7% от базы RL (для KG step=100с, для RU=150₽, etc.) — достаточно
    // мал чтобы не выпрыгивать из тира, и достаточно различим визуально.
    //
    // ИСКЛЮЧЕНИЕ — tier 5 с anchor ladder: используем точные значения из
    // RL_ANCHOR_LADDER_BY_COUNTRY[country] (не step-вариации).
    const stepWithinTier = Math.max(10, Math.round(baseRL / 60 / 50) * 50);
    const out: number[] = [];
    for (let i = 0; i < tierMults.length; i++) {
      for (let j = 0; j < adjusted[i]; j++) {
        if (i === 5 && anchorLadder && anchorLadder.length > 0 && j < anchorLadder.length) {
          out.push(anchorLadder[j]);
        } else {
          out.push(tierPrices[i] + j * stepWithinTier);
        }
      }
    }
    return out;
  }

  // Гладкая лестница чтения (Кант): равномерная сетка различимых цен через весь
  // диапазон, без мёртвых зон. Даёт ровно `slots` уникальных цен на любое число
  // ячеек (заполняет «пробелы» 950/1000/1100…), без повторов.
  if ((type === 'RP' || type === 'RM') && branchUsesReadingSmoothLadder(branchName)) {
    const slots = computeSectionTotalSlots(type, gender, branchName);
    if (slots <= 0) return [];
    const floor = getTypeMinPrice(type, branchName);
    const top = Math.round((floor * 1.85) / 10) * 10;
    const step = Math.max(20, Math.round((top - floor) / Math.max(1, slots - 1) / 10) * 10);
    const ladder: number[] = [];
    for (let i = 0; i < slots; i++) ladder.push(floor + i * step);
    return ladder;
  }

  const { regular, premium, anchor } = computeSectionSplit(type, gender, branchName);
  const hasPremiumOrAnchor = premium > 0 || anchor > 0;
  const deadZones = computeDeadZones(type, gender, branchName, hasPremiumOrAnchor);
  const prices: number[] = [];

  // Regular buckets 1–4 с вариациями
  if (regular > 0) {
    const bucketCounts = computeRegularBucketCounts(regular);

    // Адаптивный шаг вариаций: 2% от базы типа страны (минимум 10 локальной валюты)
    const country = getBranchCountry(branchName);
    const baseForStep = country ? TYPE_BASE_BY_COUNTRY[country][type] ?? 1000 : 1000;
    const step = Math.max(10, Math.round((baseForStep * 0.02) / 10) * 10);

    // Бизнес-минимум типа (см. TYPE_MIN_PRICE_BY_COUNTRY) — формула не должна
    // спускать вариации ниже него, иначе ценники не пройдут валидацию печати.
    const minFloor = getTypeMinPrice(type, branchName);

    for (const b of [1, 2, 3, 4] as BucketId[]) {
      const count = bucketCounts[b];
      if (count <= 0) continue;
      const basePrice = computeRawPrice(type, gender, b, branchName);
      // Safe-зона бакета: между мёртвыми зонами сверху/снизу + minFloor для b1.
      const { lower, upper } = computeBucketSafeZone(b, deadZones, hasPremiumOrAnchor, minFloor);
      prices.push(...generateBucketVariations(basePrice, count, step, lower, upper));
    }
  }

  // Premium buckets 5+ (1 слот на бакет, округление к красивым числам)
  if (premium > 0) {
    const nStart = computePremiumStartBucket(type, gender, branchName);
    for (let i = 0; i < premium; i++) {
      prices.push(computePremiumPrice(type, gender, nStart + i, branchName));
    }
  }

  // Витринные декои: явно заданные бакеты выше естественного премиума.
  // Filter повторяет логику computeSectionSplit (overlap-protection),
  // чтобы не сгенерировать ту же цену, что и в премиум-цикле.
  if (anchor > 0) {
    const anchorBuckets = getBranchTopAnchors(branchName, type, gender);
    if (anchorBuckets.length > 0) {
      const nStart = computePremiumStartBucket(type, gender, branchName);
      const naturalTop = premium > 0 ? nStart + premium - 1 : 0;
      for (const bucket of anchorBuckets) {
        if (bucket > naturalTop) {
          prices.push(computePremiumPrice(type, gender, bucket, branchName));
        }
      }
    }
  }

  // Защита от дублей
  const unique: number[] = [];
  const seen = new Set<number>();
  prices.sort((a, b) => a - b);
  for (const p of prices) {
    let v = p;
    while (seen.has(v)) v += 10;
    seen.add(v);
    unique.push(v);
  }
  unique.sort((a, b) => a - b);
  return unique;
}

/** Количество слотов секции — для отображения плана в UI. */
export function computeSectionSlotCount(
  type: FrameTypeCode,
  gender: GenderCode,
  branchName: string,
): number {
  return computeSectionTotalSlots(type, gender, branchName);
}

/** Фактическое кол-во слотов после распределения — сумма по всем секциям. */
export function computeBranchTotalCount(branchName: string): number {
  if (!isBranchUsingFormula(branchName)) return getBranchTotalSlots(branchName);
  const sections: Array<[FrameTypeCode, GenderCode]> = [
    ['PA', 'F'], ['PA', 'M'],
    ['MA', 'F'], ['MA', 'M'],
    ['RP', 'F'], ['RM', 'F'],
    ['KD', 'F'], ['KD', 'M'],
    ['RL', 'F'], ['RL', 'M'],
  ];
  return sections.reduce((sum, [t, g]) => sum + computeSectionSlotCount(t, g, branchName), 0);
}

/** Полный список секций, у которых может быть ненулевая доля слотов. */
export const ALL_SECTIONS: Array<[FrameTypeCode, GenderCode]> = [
  ['PA', 'F'], ['PA', 'M'],
  ['MA', 'F'], ['MA', 'M'],
  ['RP', 'F'], ['RM', 'F'],
  ['KD', 'F'], ['KD', 'M'],
  ['RL', 'F'], ['RL', 'M'],
];
