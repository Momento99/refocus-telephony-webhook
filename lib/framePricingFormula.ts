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

export type FrameTypeCode = 'PA' | 'MA' | 'RP' | 'RM' | 'KD';
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
  KG: { PA: 1200,   MA: 1400,   RP: 700,    RM: 900,    KD: 800 },    // RP/RM — бюджетный вход для пресбиопов
  KZ: { PA: 8500,   MA: 10000,  RP: 5000,   RM: 6500,   KD: 5800 },   // в тенге (гипотеза)
  RU: { PA: 2000,   MA: 2400,   RP: 1200,   RM: 1500,   KD: 1300 },   // в рублях (гипотеза)
  UZ: { PA: 180000, MA: 220000, RP: 105000, RM: 140000, KD: 120000 }, // в сумах (гипотеза)
};

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

/** Границы мёртвой зоны (психологический провал под базой следующего бакета). */
export const DEAD_ZONE_LOWER = 0.85;
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

/** Доли секций в общей раскладке (сумма = 1). */
export const SECTION_SLOT_SHARE: Record<SectionKey, number> = {
  PA_F: 35 / 168,
  PA_M: 28 / 168,
  MA_F: 35 / 168,
  MA_M: 28 / 168,
  RP_F: 14 / 168,
  RM_F: 14 / 168,
  KD_F: 7 / 168,
  KD_M: 7 / 168,
  RP_M: 0,
  RM_M: 0,
};

/** Коэф подходящести секции для премиум-якоря (0 = без премиум). */
export const PREMIUM_ELIGIBILITY: Record<SectionKey, number> = {
  MA_M: 1.0,
  MA_F: 0.8,
  PA_M: 0.6,
  PA_F: 0.4,
  RM_F: 0.3,
  RP_F: 0,
  KD_F: 0,
  KD_M: 0,
  RP_M: 0,
  RM_M: 0,
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
  'Токмок': 340,
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
]);

/** Глобальная доля премиум в формуле auto α = PREMIUM_BASE_SHARE × K_c. */
export const PREMIUM_BASE_SHARE = 0.08;

/** Ручной override доли премиум (приоритет над автоформулой). undefined = auto. */
export const BRANCH_PREMIUM_SHARE_OVERRIDE: Record<string, number | undefined> = {
  // 'Токмок': 0.108,  // при желании — ручной. Сейчас auto = 0.08 × 1.20 = 0.096
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

// ════════════════════════════════════════════════════════════════════
// 8) ЯДРО ФОРМУЛЫ ЦЕНЫ
// ════════════════════════════════════════════════════════════════════

function computeRawPrice(
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
  for (let n = 5; n <= 20; n++) {
    if (computePremiumPrice(type, gender, n, branchName) >= threshold) {
      return n;
    }
  }
  return 5;
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

/** Всего слотов в секции (тип+пол) для филиала. */
export function computeSectionTotalSlots(
  type: FrameTypeCode,
  gender: GenderCode,
  branchName: string,
): number {
  const totalSlots = getBranchTotalSlots(branchName);
  if (totalSlots <= 0) return 0;
  const key: SectionKey = `${type}_${gender}`;
  const share = SECTION_SLOT_SHARE[key] ?? 0;
  return Math.round(totalSlots * share);
}

/** Разделение секции на regular + premium. */
export function computeSectionSplit(
  type: FrameTypeCode,
  gender: GenderCode,
  branchName: string,
): { total: number; regular: number; premium: number } {
  const key: SectionKey = `${type}_${gender}`;
  const total = computeSectionTotalSlots(type, gender, branchName);
  const alpha = getBranchPremiumShare(branchName);
  const eligibility = PREMIUM_ELIGIBILITY[key] ?? 0;
  const premium = Math.round(total * alpha * eligibility);
  const regular = Math.max(0, total - premium);
  return { total, regular, premium };
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
): { lower: number; upper: number } {
  // Нижняя граница: конец мёртвой зоны с beforeBucket === bucket (если есть)
  let lower = 10;
  const zoneBelow = deadZones.find((z) => z.beforeBucket === bucket);
  if (zoneBelow) lower = zoneBelow.to + 10;

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

  const { regular, premium } = computeSectionSplit(type, gender, branchName);
  const deadZones = computeDeadZones(type, gender, branchName, premium > 0);
  const prices: number[] = [];

  // Regular buckets 1–4 с вариациями
  if (regular > 0) {
    const bucketCounts = computeRegularBucketCounts(regular);

    // Адаптивный шаг вариаций: 2% от базы типа страны (минимум 10 локальной валюты)
    const country = getBranchCountry(branchName);
    const baseForStep = country ? TYPE_BASE_BY_COUNTRY[country][type] ?? 1000 : 1000;
    const step = Math.max(10, Math.round((baseForStep * 0.02) / 10) * 10);

    for (const b of [1, 2, 3, 4] as BucketId[]) {
      const count = bucketCounts[b];
      if (count <= 0) continue;
      const basePrice = computeRawPrice(type, gender, b, branchName);
      // Safe-зона бакета: строго между мёртвыми зонами сверху и снизу
      const { lower, upper } = computeBucketSafeZone(b, deadZones, premium > 0);
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
  ];
  return sections.reduce((sum, [t, g]) => sum + computeSectionSlotCount(t, g, branchName), 0);
}
