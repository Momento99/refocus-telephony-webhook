/**
 * Типы для системы закупки оправ (страница /admin/frame-procurement).
 *
 * Соответствуют миграциям:
 *   - supabase/migrations/20260427_frame_supplier_catalog.sql
 *   - supabase/migrations/20260427_frame_procurement_orders.sql
 *
 * Не путать с типом FrameTypeCode из lib/framePricingFormula.ts —
 * здесь импортируем оттуда.
 */

import type { FrameTypeCode, GenderCode } from './framePricingFormula';

/** Какая модель распознавала фото */
export type RecognitionEngine = 'opus-4.7' | 'gpt-5' | 'manual';

/** Пол: F/M/U (U — унисекс, когда визуально определить нельзя) */
export type CatalogGender = GenderCode | 'U';

/** Цвет на фото каталога: bbox в долях изображения 0..1 */
export interface CatalogColor {
  /** Подпись поставщика (C1, C2, ... или китайский ярлык) */
  label: string;
  /** Название цвета на русском (для удобства, может быть пустым) */
  name_ru: string;
  /** [x, y, width, height] — все в долях [0..1] от размера фото */
  bbox: [number, number, number, number];
  /**
   * Конкретная точка [x_ratio, y_ratio] (доли 0..1), куда нужно рисовать
   * красную цифру количества. Должна быть НА самой оправе, желательно на
   * левой линзе. Точнее, чем bbox-derived позиция.
   * Если не задано — fallback на (bbox.x + bbox.w*0.27, bbox.y + bbox.h*0.42).
   */
  click_point?: [number, number];
}

/** Запись в frame_supplier_catalog */
export interface SupplierCatalogRow {
  id: string;
  image_hash: string;
  storage_path: string;
  width_px: number;
  height_px: number;

  recognized_by: RecognitionEngine | null;
  recognized_at: string | null;
  confidence: number | null;
  raw_response: unknown | null;

  supplier_model: string | null;
  type_code: FrameTypeCode | null;
  gender: CatalogGender | null;
  colors: CatalogColor[];

  estimated_price: number | null;

  needs_review: boolean;
  manually_corrected: boolean;
  notes: string | null;

  created_at: string;
  updated_at: string;
}

/** Полезная нагрузка от LLM-распознавания (то, что мы парсим из ответа модели) */
export interface CatalogRecognitionResult {
  supplier_model: string | null;
  type_code: FrameTypeCode;
  gender: CatalogGender;
  confidence: number;
  needs_review: boolean;
  /** Оценочная розничная цена в KGS (целое число) либо null, если LLM не смог оценить */
  estimated_price_kgs: number | null;
  colors: CatalogColor[];
  notes: string;
}

/** Статус заказа в frame_procurement_orders */
export type ProcurementOrderStatus = 'draft' | 'sent' | 'received' | 'cancelled';

/** Ключ секции (тип × пол), как в формуле */
export type SectionKey =
  | 'PA_F' | 'PA_M'
  | 'MA_F' | 'MA_M'
  | 'RP_F' | 'RM_F'
  | 'KD_F' | 'KD_M'
  | 'RL_F' | 'RL_M';

/** qty_by_section — снимок распределения по секциям */
export type QtyBySection = Partial<Record<SectionKey, number>>;

/** Запись в frame_procurement_orders */
export interface ProcurementOrderRow {
  id: string;
  branch_id: number | null;
  branch_ids: number[] | null;
  status: ProcurementOrderStatus;

  cold_start: boolean;
  proxy_branch_id: number | null;
  sales_window_days: number;
  target_warehouse_qty: number;
  supplier_min_qty: number;

  recognized_by: string | null;
  qty_by_section: QtyBySection;
  total_qty: number;
  notes: string | null;

  created_at: string;
  updated_at: string;
  sent_at: string | null;
  received_at: string | null;
}

/** Запись в frame_procurement_order_items */
export interface ProcurementOrderItemRow {
  id: string;
  order_id: string;
  catalog_id: string;
  color_label: string;
  color_name: string | null;
  qty: number;
  bbox: [number, number, number, number] | null;
  created_at: string;
}

/**
 * Режим расчёта плана:
 *   - 'sold'   — заказываем ровно столько, сколько продано за окно
 *   - 'scaled' — масштабируем пропорции продаж до минималки поставщика
 *   - 'custom' — масштабируем пропорции продаж до customTarget шт
 */
export type PlanMode = 'sold' | 'scaled' | 'custom';

/** Параметры алгоритма построения заказа */
export interface BuildOrderInput {
  /** Филиалы — куда везём (Tокмок+Кант group) */
  branchIds: number[];
  /** Режим расчёта */
  mode: PlanMode;
  /** Минималка поставщика (для режима 'scaled' — таргет; для 'sold' — отображение) */
  supplierMin: number;
  /** Произвольная цель (только для режима 'custom') */
  customTarget?: number;
  /**
   * Секции, исключённые из плана (например KD_F, KD_M если детских хватает дома).
   * Продажи этих секций игнорируются при подсчёте долей и распределения.
   * salesBySection в OrderPlan всё равно отдаст исходные продажи для UI-отображения.
   */
  excludedSections?: SectionKey[];
}

/** Данные продаж по одной секции в окне */
export interface SectionSalesInfo {
  soldQty: number;
  revenue: number;
  avgPrice: number;
  /** Сырой список индивидуальных цен продаж в этой секции (для матчинга) */
  prices?: number[];
}

/** Результат построения плана заказа */
export interface OrderPlan {
  /** Режим, использованный при расчёте */
  mode: PlanMode;
  /** Филиалы — куда везём (Tокмок+Кант group) */
  branchIds: number[];
  /**
   * ISO-дата начала окна продаж.
   * Если предыдущий sent-заказ есть — равна его sent_at.
   * Если заказов нет — null (окно = «за всё время»).
   */
  windowSince: string | null;
  /** Сырые продажи Tокмока по секциям (qty, revenue, avgPrice) */
  salesBySection: Record<SectionKey, SectionSalesInfo>;
  /** Итого продано шт за окно */
  totalSoldQty: number;
  /** Итого выручка за окно */
  totalSoldRevenue: number;
  /** Исключённые секции (для отображения серым в UI) */
  excludedSections?: SectionKey[];
  /**
   * Сколько моделей в каталоге поставщика по каждой секции (type_code × gender).
   * Если planned >> catalogModelsBySection[k], алгоритм вынужден наваливать
   * по N штук на одну модель — нужно загрузить ещё скринов из WeChat.
   */
  catalogModelsBySection: Record<SectionKey, number>;
  /** ПЛАН распределения по секциям (что хотим заказать) */
  qtyBySection: Record<SectionKey, number>;
  /** ФАКТ распределения по секциям (что реально удалось разложить по items каталога) */
  distributedBySection: Record<SectionKey, number>;
  /** Финальные доли по секциям (sum=1) */
  sharesBySection: Record<SectionKey, number>;
  /** Целевой плановый объём после применения режима (sold → totalSoldQty; scaled → supplierMin; custom → customTarget) */
  totalQtyTarget: number;
  /** Достаточно ли РЕАЛЬНО распределилось до минималки поставщика (totalQty >= supplierMin) */
  meetsSupplierMin: boolean;
  /** Конкретные позиции заказа */
  items: Array<{
    catalogId: string;
    supplierModel: string | null;
    typeCode: FrameTypeCode;
    gender: CatalogGender;
    colorLabel: string;
    colorName: string | null;
    qty: number;
    bbox: [number, number, number, number];
    /** Цена из catalog модели (estimated_price) */
    estimatedPrice: number | null;
  }>;
  /** Сколько моделей вошло */
  modelsUsed: number;
  /** Сумма items.qty — может быть < totalQtyTarget, если каталог не покрывает все секции */
  totalQty: number;
  /** Какие секции остались без подходящих моделей */
  uncoveredSections: SectionKey[];
  /** Проданные оправы, для которых не нашлось подходящего кандидата в каталоге */
  unmatched: Array<{
    soldPrice: number;
    typeCode: FrameTypeCode;
    gender: GenderCode;
    reason: string;
  }>;
}
