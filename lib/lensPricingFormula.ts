/**
 * ЕДИНАЯ ФОРМУЛА ЦЕНООБРАЗОВАНИЯ ЛИНЗ REFOCUS — v6.3 (FINAL)
 * ==================================================================
 *
 * Одна математическая формула для всех филиалов Refocus (KG, KZ, RU, UZ).
 * Вход: себестоимость пары линз в KGS → выход: локальная розничная цена
 * в валюте филиала с учётом рынка города, иерархии и маркетинг-округления.
 *
 * ────────────────────────────────────────────────────────────────────
 *  P(lens, side, branch) =
 *      ROUND⟨ C_side(lens) · E_snap(country) · μ_side(lens) · K_market(branch) ⟩
 * ────────────────────────────────────────────────────────────────────
 *  lens     — id линзы из lens_catalog
 *  side     — 'from' (до ±2.75 дптр) или 'to' (от ±3.00 дптр)
 *  branch   — филиал
 *  C_side   — себестоимость ПАРЫ линз в KGS (cost_price_from / cost_price_to)
 *  E_snap   — квартальный snapshot курса KGS → локальная валюта
 *  μ_side   — markup (разная для from/to)
 *  K_market — рыночный коэф филиала (страна × город)
 *  ROUND    — округление через оптимизацию в коридоре floor/cap
 *
 * ПОРЯДОК ОПЕРАЦИЙ (исправление критики v5):
 *   1. P_base = C · E · μ · K
 *   2. hierarchy  — pairwise constraints (подтягиваем "детей")
 *   3. floor      — μ_effective ≥ μ_floor(category)
 *   4. cap        — margin ≤ μ_cap_margin(category)
 *   5. rounding   — argmin loss(P) на сетке X10 в коридоре [floor, cap]
 *   Шаги 2–4 итеративны (до стабилизации, обычно ≤3 прохода).
 *   Округление — всегда последний шаг и знает о floor/cap.
 *
 * ИСПРАВЛЕНИЯ v5 → v6:
 *   ① Явный порядок операций (раньше cap мог нарушаться после округления)
 *   ② Округление — оптимизация, не эвристика (решает баг polycarbonate 2112→2290)
 *   ③ Добавлен pair: asph-antiglare ≥ asph-standard × 1.15
 *   ④ Валютный drift-trigger: |ΔE|>8% и >14 дней → досрочное обновление snapshot
 *   ⑤ Убран спец-cap myopia-control 10k (работает общий cap по марже)
 *   ⑥ loss-функция даёт естественную смесь окончаний (X00/X90/X50), не только X990
 *
 * КАК ДОБАВИТЬ ГОРОД:
 *   CITY_INDEX['Новый-Город'] = { country: 'KZ', index: 1.05 };
 *
 * КАК ДОБАВИТЬ СТРАНУ:
 *   1) Расширить CountryCode
 *   2) COUNTRIES[...] + CURRENCY_SNAPSHOT[...] + COUNTRY_INDEX[...]
 *   3) Добавить города в CITY_INDEX
 */

// ════════════════════════════════════════════════════════════════════
// Типы
// ════════════════════════════════════════════════════════════════════

export type CountryCode = 'KG' | 'KZ' | 'RU' | 'UZ';
export type LensSide = 'from' | 'to';
export type LensCategory = 'basic' | 'special' | 'premium';

export type LensId =
  // basic
  | 'standard' | 'antiglare' | 'screen'
  // special
  | 'chameleon' | 'ast-antiglare' | 'ast-screen' | 'ast-chameleon'
  | 'polycarbonate' | 'myopia-control'
  // premium
  | 'asph-standard' | 'asph-antiglare' | 'asph-screen'
  | 'chameleon-screen' | 'thin-antiglare' | 'thin-screen';

// ════════════════════════════════════════════════════════════════════
// 1) СТРАНЫ И ВАЛЮТЫ
// ════════════════════════════════════════════════════════════════════

export const COUNTRIES: Record<CountryCode, {
  name: string;
  currency: string;
  currencySymbol: string;
  countryIndex: number; // базовый K_country (рыночный уровень страны)
}> = {
  KG: { name: 'Кыргызстан', currency: 'KGS', currencySymbol: 'с',   countryIndex: 1.00 },
  UZ: { name: 'Узбекистан', currency: 'UZS', currencySymbol: 'сўм', countryIndex: 0.95 },
  KZ: { name: 'Казахстан',  currency: 'KZT', currencySymbol: '₸',   countryIndex: 1.20 },
  RU: { name: 'Россия',     currency: 'RUB', currencySymbol: '₽',   countryIndex: 1.45 },
};

/**
 * E_snap — КВАРТАЛЬНЫЙ snapshot курса KGS → локальная валюта.
 * Розничные цены НЕ скачут вслед за ЦБ. Обновляется 1 янв / 1 апр / 1 июл / 1 окт.
 * Для бухгалтерии используется дневной курс (отдельно, не здесь).
 *
 * Drift-trigger: если |E_current − E_snap| / E_snap > 0.08 держится > 14 дней —
 * cron fn_check_currency_drift() пересчитывает snapshot досрочно.
 */
export const CURRENCY_SNAPSHOT: Record<CountryCode, number> = {
  KG: 1.00,   // baseline
  UZ: 142.0,  // 1 KGS = 142 UZS
  KZ: 5.20,   // 1 KGS = 5.20 KZT
  RU: 0.94,   // 1 KGS = 0.94 RUB
};

export const CURRENCY_DRIFT_THRESHOLD = 0.08;  // 8%
export const CURRENCY_DRIFT_DURATION_DAYS = 14;

// ════════════════════════════════════════════════════════════════════
// 2) ГОРОДА — локальная поправка K_city (множитель к country_index)
// ════════════════════════════════════════════════════════════════════

export type CityEntry = {
  country: CountryCode;
  cityMultiplier: number;  // множитель к COUNTRIES[country].countryIndex
};

/**
 * K_market(branch) = COUNTRIES[country].countryIndex × CITY_INDEX[city].cityMultiplier
 *
 * cityMultiplier отражает разрыв доходов внутри страны:
 *   1.00 — средний по стране
 *   <1.0 — беднее (малые города)
 *   >1.0 — богаче (столицы, курорты)
 */
export const CITY_INDEX: Record<string, CityEntry> = {
  // ─── KG ───
  'Кара-Балта':    { country: 'KG', cityMultiplier: 0.95 },
  'Кант':          { country: 'KG', cityMultiplier: 0.95 },
  'Сокулук':       { country: 'KG', cityMultiplier: 0.95 },
  'Беловодск':     { country: 'KG', cityMultiplier: 0.95 },
  'Токмок':        { country: 'KG', cityMultiplier: 1.00 },
  'Ош':            { country: 'KG', cityMultiplier: 1.00 },
  'Бишкек':        { country: 'KG', cityMultiplier: 1.10 },

  // ─── UZ ───
  'Ташкент':       { country: 'UZ', cityMultiplier: 1.00 },
  'Самарканд':     { country: 'UZ', cityMultiplier: 0.90 },

  // ─── KZ ───
  'Шымкент':       { country: 'KZ', cityMultiplier: 1.00 },  // 1.20
  'Астана':        { country: 'KZ', cityMultiplier: 1.05 },  // 1.26
  'Алматы':        { country: 'KZ', cityMultiplier: 1.15 },  // 1.38

  // ─── RU ───
  'Регионы РФ':    { country: 'RU', cityMultiplier: 0.85 },  // 1.23
  'Санкт-Петербург': { country: 'RU', cityMultiplier: 1.10 }, // 1.60
  'Москва':        { country: 'RU', cityMultiplier: 1.20 },  // 1.74
};

export function getKMarket(city: string): number {
  const entry = CITY_INDEX[city];
  if (!entry) throw new Error(`Неизвестный город: ${city}`);
  return COUNTRIES[entry.country].countryIndex * entry.cityMultiplier;
}

// ════════════════════════════════════════════════════════════════════
// 3) MARKUP μ ПО ЛИНЗАМ
// ════════════════════════════════════════════════════════════════════

/**
 * v6.2 — настроено по фидбеку бизнес-советника (Sutherland, Kotler, Lean Analytics):
 *   • basic: приманка, но не «дёшево». Якорь 399/549 (раньше 350/490 — съедало value).
 *   • special (chameleon): плавный переход через фазу 990/1290 (Phase 1).
 *   • premium: подогнаны под психологические пороги (1490<1500, 1890<2000, 2490<2500, 2990<3000).
 *   • polycarbonate и myopia-control ИСКЛЮЧЕНЫ из формулы — symbolic pricing (см. EXCLUDE_FROM_FORMULA).
 */
export const LENS_MARKUP: Record<LensId, { muFrom: number; muTo: number; category: LensCategory }> = {
  // ─── basic (якорь трафика, но не «дёшево») ───
  'standard':         { category: 'basic',   muFrom: 2.85, muTo: 3.43 },  // → 400 / 550
  'antiglare':        { category: 'basic',   muFrom: 3.74, muTo: 4.44 },  // → 600 / 800
  'screen':           { category: 'basic',   muFrom: 4.50, muTo: 5.00 },  // → 990 / 1 290

  // ─── special (умеренный апсейл) ───
  'chameleon':        { category: 'special', muFrom: 3.63, muTo: 4.34 },  // Phase 1: 1 090 / 1 390 (to ↑ чтобы не каннибализировать screen_to=1290)
  'ast-antiglare':    { category: 'special', muFrom: 4.80, muTo: 5.30 },  // → 1 250 / 1 490 (ast-премия +40-60% вместо +30%)
  'ast-screen':       { category: 'special', muFrom: 4.70, muTo: 5.30 },  // → 1 490 / 1 790
  'ast-chameleon':    { category: 'special', muFrom: 5.00, muTo: 5.50 },  // → 1 790 / 2 090
  'polycarbonate':    { category: 'premium', muFrom: 11.32, muTo: 12.46 }, // → 2 490 / 2 990 (symbolic premium — категория premium для высокого cap)
  'myopia-control':   { category: 'premium', muFrom: 8.17,  muTo: 7.45  }, // → 8 990 / 9 990 (psychological <10k)

  // ─── premium (psychological anchors под круглыми порогами) ───
  'asph-standard':    { category: 'premium', muFrom: 7.00, muTo: 7.84 },  // → 1 190 / 1 490
  'asph-antiglare':   { category: 'premium', muFrom: 7.32, muTo: 9.00 },  // → 1 390 / 1 890
  'asph-screen':      { category: 'premium', muFrom: 8.95, muTo: 11.32 }, // → 1 790 / 2 490
  'chameleon-screen': { category: 'premium', muFrom: 8.89, muTo: 9.97 },  // → 2 490 / 2 990
  'thin-antiglare':   { category: 'premium', muFrom: 8.79, muTo: 9.18 },  // → 2 990 / 3 490
  'thin-screen':      { category: 'premium', muFrom: 7.87, muTo: 9.23 },  // → 2 990 / 3 690
};

/**
 * Линзы, исключённые из авто-формулы (symbolic pricing — ставим вручную).
 * Polycarbonate: детские линзы — родительский страх «защитить зрение ребёнка».
 *                Текущая маржа 92% (markup ×13). Снижение до ×6 убьёт anchor.
 *                Держим 2 490 / 2 990 вручную.
 * Myopia-control: MiYOSMART — «дорого = работает» + порог 10 000.
 *                 Держим 8 990 / 9 990 вручную.
 */
/**
 * Линзы вне формулы — если когда-нибудь понадобится вывести SKU целиком
 * на ручное управление (например, супер-индивидуальные заказы). Сейчас пусто:
 * формула считает ВСЕ 15 SKU. Polycarbonate, myopia-control, thin-* имеют
 * специально подогнанные μ для выдачи нужных чисел без manual override.
 */
export const EXCLUDE_FROM_FORMULA: Set<LensId> = new Set([]);

// ════════════════════════════════════════════════════════════════════
// 4) FLOOR И CAP ПО КАТЕГОРИЯМ
// ════════════════════════════════════════════════════════════════════

/**
 * μ_floor — минимальный markup (защита от убытка / нулевой маржи).
 * Если P_base / cost < μ_floor — цена поднимается до cost × μ_floor.
 * v6.1: basic 2.2 (маржа 55%), special 3.0 (67%), premium 5.0 (80%)
 */
export const MU_FLOOR: Record<LensCategory, number> = {
  basic:   2.2,
  special: 3.0,
  premium: 5.0,
};

/**
 * μ_cap_margin — максимальный markup (защита от перецена / потери клиента).
 * Если P_base / cost > μ_cap — цена опускается до cost × μ_cap.
 * v6.1: basic 5.0 (держим basic дешёвыми), special 7.0, premium 11.0.
 */
export const MU_CAP: Record<LensCategory, number> = {
  basic:   5.5,   // screen×5.35 проходит
  special: 7.0,
  premium: 13.0,  // поднято до 13.0 чтобы поликарбонат×12.46 проходил (symbolic pricing категория)
};

// ════════════════════════════════════════════════════════════════════
// 5) PAIRWISE ИЕРАРХИЯ
// ════════════════════════════════════════════════════════════════════

/**
 * Попарные constraints: цена child ≥ parent × minRatio.
 * Применяются до floor/cap и могут "подтягивать" позицию вверх.
 *
 * NEW в v6: asph-antiglare ≥ asph-standard × 1.15
 *           (у обоих разная технология подложки, но asph-antiglare должна стоить дороже)
 */
export const PAIR_CONSTRAINTS: Array<{ child: LensId; parent: LensId; minRatio: number }> = [
  { child: 'asph-antiglare',    parent: 'antiglare',      minRatio: 1.8  },
  { child: 'asph-screen',       parent: 'screen',         minRatio: 1.8  },
  { child: 'asph-antiglare',    parent: 'asph-standard',  minRatio: 1.15 },  // ← NEW v6
  { child: 'thin-antiglare',    parent: 'asph-antiglare', minRatio: 1.5  },
  { child: 'thin-screen',       parent: 'asph-screen',    minRatio: 1.3  },
  { child: 'chameleon-screen',  parent: 'chameleon',      minRatio: 1.4  },
  { child: 'ast-antiglare',     parent: 'antiglare',      minRatio: 1.4  },
  { child: 'ast-screen',        parent: 'screen',         minRatio: 1.4  },
  { child: 'ast-chameleon',     parent: 'chameleon',      minRatio: 1.2  },
  { child: 'polycarbonate',     parent: 'standard',       minRatio: 2.2  },
];

// ════════════════════════════════════════════════════════════════════
// 6) ОКРУГЛЕНИЕ ЧЕРЕЗ ОПТИМИЗАЦИЮ
// ════════════════════════════════════════════════════════════════════

/**
 * Генерация множества кандидатов (кратных 10) в окне [P_raw × 0.92, P_raw × 1.08],
 * пересечённого с коридором [cost_E × μ_floor, cost_E × μ_cap].
 *
 * Затем для каждого кандидата считаем loss и выбираем минимальный.
 *
 * loss(P) = w_margin · margin_deficit²
 *         + w_hier   · hierarchy_violation²
 *         + w_dist   · distance²
 *         + w_ugly   · ugliness
 *
 * Floor/cap — жёсткие (кандидат вне коридора просто не попадает в множество).
 */
export const LOSS_WEIGHTS = {
  margin: 10.0,   // критично: не дать марже упасть ниже target
  hierarchy: 20.0, // критично: не нарушить иерархию линз
  distance: 1.0,  // умеренно: стараемся ближе к P_base
  ugliness: 0.3,  // мягко: предпочтение X00/X90 над X50, X50 над X40/X60/X80 и т.д.
};

/**
 * Кандидаты окончаний: только X_0 шаг 10.
 * Все цены заканчиваются на 0 — никаких X99/X49 «американских» окончаний.
 * Владелец: «пусть будет нолик всегда».
 */
function generateCandidates(min: number, max: number): number[] {
  const step = 10;
  const result: number[] = [];
  const start = Math.ceil(min / step) * step;
  const end   = Math.floor(max / step) * step;
  for (let p = start; p <= end; p += step) {
    if (p > 0) result.push(p);
  }
  return result;
}

/**
 * Ранжирование «красоты» окончания (все цены ∈ X_0):
 *   X00, X90 → 0    (круглая сотня / «почти сотня»)
 *   X50      → 0.2  (половина — допустимо)
 *   X40, X60, X80 → 0.4
 *   X10, X20, X30, X70 → 0.5
 */
function roundingUgliness(p: number): number {
  const last2 = p % 100;
  if (last2 === 0 || last2 === 90) return 0;
  if (last2 === 50) return 0.2;
  if (last2 === 40 || last2 === 60 || last2 === 80) return 0.4;
  return 0.5;
}

// ════════════════════════════════════════════════════════════════════
// 7) ОСНОВНАЯ ФУНКЦИЯ РАСЧЁТА
// ════════════════════════════════════════════════════════════════════

export type ComputeInput = {
  lensId: LensId;
  side: LensSide;
  costPriceFromKGS: number;  // себестоимость пары в KGS для from-стороны
  costPriceToKGS: number;    // -«- для to-стороны
  city: string;
};

export type ComputeContext = {
  /** расчитанные цены остальных линз (для иерархии) */
  siblingPrices?: Partial<Record<`${LensId}_${LensSide}`, number>>;
};

export type ComputeResult = {
  price: number;               // финальная цена в локальной валюте
  currency: string;
  costLocal: number;           // cost × E в локальной валюте
  baseRaw: number;             // P_base до ограничителей и округления
  marginPercent: number;       // финальная маржа, %
  muEffective: number;         // фактический итоговый markup
  appliedFloor: boolean;
  appliedCap: boolean;
  appliedHierarchy: boolean;
  candidates: number[];        // отладка: все 9-кандидаты
  rationale: string[];         // шаги расчёта для аудита
};

export function computeLensPrice(input: ComputeInput, ctx: ComputeContext = {}): ComputeResult {
  const { lensId, side, costPriceFromKGS, costPriceToKGS, city } = input;
  const rationale: string[] = [];

  // 1. Базовые величины
  const cityEntry = CITY_INDEX[city];
  if (!cityEntry) throw new Error(`Неизвестный город: ${city}`);
  const country = cityEntry.country;
  const E = CURRENCY_SNAPSHOT[country];
  const K = getKMarket(city);
  const currency = COUNTRIES[country].currency;

  const markup = LENS_MARKUP[lensId];
  const mu = side === 'from' ? markup.muFrom : markup.muTo;
  const cost_kgs = side === 'from' ? costPriceFromKGS : costPriceToKGS;
  const cost_local = cost_kgs * E;
  const category = markup.category;

  rationale.push(`cost=${cost_kgs} KGS × E=${E} × μ=${mu} × K=${K.toFixed(2)}`);

  // 2. Базовая цена
  let P = cost_kgs * E * mu * K;
  const P_base = P;
  rationale.push(`P_base = ${P.toFixed(0)} ${currency}`);

  // 3. Hierarchy (на родительских ценах из ctx, если переданы)
  let appliedHierarchy = false;
  for (const cst of PAIR_CONSTRAINTS) {
    if (cst.child !== lensId) continue;
    const parentKey = `${cst.parent}_${side}` as const;
    const parentPrice = ctx.siblingPrices?.[parentKey];
    if (parentPrice && P < parentPrice * cst.minRatio) {
      P = parentPrice * cst.minRatio;
      appliedHierarchy = true;
      rationale.push(`hierarchy: ${cst.parent}×${cst.minRatio} = ${P.toFixed(0)} → поднято`);
    }
  }

  // 4. Floor
  const floorPrice = cost_local * MU_FLOOR[category];
  let appliedFloor = false;
  if (P < floorPrice) {
    P = floorPrice;
    appliedFloor = true;
    rationale.push(`floor: μ≥${MU_FLOOR[category]} → ${P.toFixed(0)}`);
  }

  // 5. Cap
  const capPrice = cost_local * MU_CAP[category];
  let appliedCap = false;
  if (P > capPrice) {
    P = capPrice;
    appliedCap = true;
    rationale.push(`cap: μ≤${MU_CAP[category]} → ${P.toFixed(0)}`);
  }

  // 6. Округление через оптимизацию
  const winMin = Math.max(floorPrice, P * 0.92);
  const winMax = Math.min(capPrice, P * 1.08);
  let candidates = generateCandidates(winMin, winMax);
  if (candidates.length === 0) {
    // fallback: берём ближайшее к P без ограничения окна
    candidates = generateCandidates(floorPrice, capPrice);
  }
  if (candidates.length === 0) {
    // совсем крайний случай — возвращаем P как есть, округлив до сотни
    const fallback = Math.round(P / 10) * 10 - 10;
    rationale.push(`fallback: ${fallback}`);
    return buildResult(fallback);
  }

  // loss для каждого кандидата
  let best = candidates[0];
  let bestLoss = Infinity;
  const P_target = P;
  for (const c of candidates) {
    const marginDeficit = Math.max(0, mu - c / cost_local) / mu;
    const distance = Math.abs(c - P_target) / P_target;
    const ugly = roundingUgliness(c);
    // hierarchy_violation: если поднят над родителем × min_ratio — 0, иначе штраф
    let hierViol = 0;
    for (const cst of PAIR_CONSTRAINTS) {
      if (cst.child !== lensId) continue;
      const parentKey = `${cst.parent}_${side}` as const;
      const parentPrice = ctx.siblingPrices?.[parentKey];
      if (parentPrice && c < parentPrice * cst.minRatio) {
        hierViol += (parentPrice * cst.minRatio - c) / (parentPrice * cst.minRatio);
      }
    }
    const loss =
      LOSS_WEIGHTS.margin   * marginDeficit * marginDeficit +
      LOSS_WEIGHTS.hierarchy * hierViol     * hierViol +
      LOSS_WEIGHTS.distance * distance     * distance +
      LOSS_WEIGHTS.ugliness * ugly;
    if (loss < bestLoss) {
      bestLoss = loss;
      best = c;
    }
  }

  rationale.push(`rounding: кандидатов=${candidates.length}, выбран=${best}`);
  return buildResult(best);

  function buildResult(finalPrice: number): ComputeResult {
    const muEff = finalPrice / cost_local;
    return {
      price: finalPrice,
      currency,
      costLocal: cost_local,
      baseRaw: P_base,
      marginPercent: (1 - cost_local / finalPrice) * 100,
      muEffective: muEff,
      appliedFloor,
      appliedCap,
      appliedHierarchy,
      candidates,
      rationale,
    };
  }
}

// ════════════════════════════════════════════════════════════════════
// 8) ПАКЕТНЫЙ РАСЧЁТ ВСЕХ ЛИНЗ (с правильным порядком: сначала parents, потом children)
// ════════════════════════════════════════════════════════════════════

/** Порядок расчёта: basic → special → premium (для корректной работы hierarchy). */
const COMPUTE_ORDER: LensId[] = [
  'standard', 'antiglare', 'screen',
  'chameleon', 'ast-antiglare', 'ast-screen', 'ast-chameleon',
  'polycarbonate', 'myopia-control',
  'asph-standard', 'asph-antiglare', 'asph-screen',
  'chameleon-screen', 'thin-antiglare', 'thin-screen',
];

export type CatalogCosts = Partial<Record<LensId, { costFromKGS: number; costToKGS: number }>>;

export type BranchPriceTable = Partial<
  Record<`${LensId}_${LensSide}`, ComputeResult>
>;

export function computeBranchPriceTable(
  costs: CatalogCosts,
  city: string,
): BranchPriceTable {
  const table: BranchPriceTable = {};
  const siblingPrices: Record<string, number> = {};

  for (const lensId of COMPUTE_ORDER) {
    const c = costs[lensId];
    if (!c) continue;
    if (EXCLUDE_FROM_FORMULA.has(lensId)) continue;  // symbolic pricing — руками
    for (const side of ['from', 'to'] as const) {
      const result = computeLensPrice(
        {
          lensId,
          side,
          costPriceFromKGS: c.costFromKGS,
          costPriceToKGS: c.costToKGS,
          city,
        },
        { siblingPrices: siblingPrices as ComputeContext['siblingPrices'] },
      );
      const key = `${lensId}_${side}` as const;
      table[key] = result;
      siblingPrices[key] = result.price;
    }
  }

  return table;
}
