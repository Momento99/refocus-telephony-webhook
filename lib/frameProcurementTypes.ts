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

/** Параметры алгоритма построения заказа */
export interface BuildOrderInput {
  /** Filial — куда везём, обычно Токмок */
  branchId: number;
  /** Прокси для холодного старта (Кара-Балта) */
  proxyBranchId: number;
  /** Окно анализа продаж в днях, default 60 */
  windowDays: number;
  /** Целевой объём заказа (1000 — до полного склада) */
  targetQty: number;
  /** Минималка поставщика (500) */
  supplierMin: number;
  /** Принудительно использовать прокси (если true, игнорируем продажи branchId) */
  forceProxyOnly?: boolean;
}

/** Результат построения плана заказа */
export interface OrderPlan {
  /** Использован ли холодный старт (свои продажи < 100 за окно) */
  coldStart: boolean;
  /** Кол-во продаж branchId за окно — для отображения в UI */
  ownSalesTotal: number;
  /** Распределение по секциям (количество штук) */
  qtyBySection: Record<SectionKey, number>;
  /** Финальные доли по секциям (sum=1) */
  sharesBySection: Record<SectionKey, number>;
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
  }>;
  /** Сколько моделей вошло, сколько секций без подходящих моделей */
  modelsUsed: number;
  totalQty: number;
  /** Какие секции остались с неполным покрытием (мало моделей в каталоге) */
  uncoveredSections: SectionKey[];
}
