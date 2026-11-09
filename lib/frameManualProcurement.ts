import type { CatalogColor, CatalogGender, SupplierCatalogRow } from './frameProcurementTypes';
import type { FrameTypeCode } from './framePricingFormula';
import { isModelExcludedFromPurchase, validatePurchaseMix, type PurchaseMixSettings } from './framePurchaseMix';

export const MANUAL_FRAME_TYPES: Record<FrameTypeCode, string> = {
  PA: 'Пластик · взрослые', MA: 'Металл · взрослые', RP: 'Пластик · чтение',
  RM: 'Металл · чтение', KD: 'Детские', RL: 'Безоправные',
};
export const MANUAL_FRAME_GENDERS: Record<CatalogGender, string> = {
  F: 'Женские', M: 'Мужские', U: 'Унисекс',
};
export interface ManualColor extends CatalogColor { qty: number; enabled: boolean }
export interface ManualModel {
  catalogId: string;
  supplierModel: string;
  typeCode: FrameTypeCode | null;
  gender: CatalogGender | null;
  colors: ManualColor[];
}
export interface ManualDraft { target: number; models: ManualModel[]; purchaseMix?: PurchaseMixSettings }
export interface ManualOrder {
  id: string; revision: number; status: 'draft' | 'sent' | 'received' | 'cancelled';
  manual_draft: ManualDraft; total_qty: number; updated_at: string; created_at: string;
}
export const modelQuantity = (model: ManualModel) => model.colors.reduce((s, c) => s + c.qty, 0);
export const draftQuantity = (draft: ManualDraft) => draft.models.reduce((s, m) => s + modelQuantity(m), 0);
export function colorPoint(c: CatalogColor): [number, number] {
  return c.click_point ?? [c.bbox[0] + c.bbox[2] * .27, c.bbox[1] + c.bbox[3] * .42];
}
export function modelFromCatalog(row: SupplierCatalogRow): ManualModel {
  return {
    catalogId: row.id, supplierModel: row.supplier_model || '',
    // Old AI guesses are suggestions only. The owner confirms both fields.
    typeCode: row.manually_corrected ? row.type_code : null,
    gender: row.manually_corrected ? row.gender : null,
    colors: (row.colors || []).map(c => ({ ...c, click_point: colorPoint(c), qty: 0, enabled: true })),
  };
}

/** Stable remainder allocation; excluded colors always receive zero. */
export function distributeEvenly(colors: ManualColor[], quantity: number): ManualColor[] {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 10000) throw new Error('Количество: от 0 до 10 000');
  const count = colors.filter(c => c.enabled).length;
  if (!count && quantity) throw new Error('Выберите хотя бы один цвет');
  let index = 0;
  return colors.map(c => ({ ...c, qty: c.enabled && count
    ? Math.floor(quantity / count) + (index++ < quantity % count ? 1 : 0) : 0 }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isFrameUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректные данные заказа');
  return value as Record<string, unknown>;
}
function normalized(value: unknown, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length || value.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)) {
    throw new Error('Положение цифры должно быть внутри фотографии');
  }
  return value as number[];
}

/** Shared server/client boundary: never trust client totals or section summaries. */
export function validateManualDraft(value: unknown): ManualDraft {
  const draft = object(value);
  if (!integer(draft.target, 1, 100000)) throw new Error('Цель: от 1 до 100 000 оправ');
  if (!Array.isArray(draft.models) || draft.models.length > 500) throw new Error('Не больше 500 моделей в заказе');
  const purchaseMix = draft.purchaseMix === undefined ? undefined : validatePurchaseMix(draft.purchaseMix);
  const ids = new Set<string>();
  const models = draft.models.map(raw => {
    const m = object(raw);
    if (!isFrameUuid(m.catalogId) || ids.has(m.catalogId)) throw new Error('Некорректная или повторная модель');
    ids.add(m.catalogId);
    if (m.typeCode !== null && !(typeof m.typeCode === 'string' && Object.hasOwn(MANUAL_FRAME_TYPES, m.typeCode))) throw new Error('Выберите тип оправы');
    if (m.gender !== null && !['F', 'M', 'U'].includes(String(m.gender))) throw new Error('Выберите пол');
    if (typeof m.supplierModel !== 'string' || m.supplierModel.length > 100) throw new Error('Слишком длинный артикул');
    if (!Array.isArray(m.colors) || m.colors.length > 30) throw new Error('Не больше 30 цветов на фото');
    const labels = new Set<string>();
    const colors: ManualColor[] = m.colors.map(rawColor => {
      const c = object(rawColor);
      const label = typeof c.label === 'string' ? c.label.trim() : '';
      if (!label || label.length > 64 || labels.has(label)) throw new Error('Коды цветов должны быть заполнены и уникальны');
      labels.add(label);
      if (typeof c.name_ru !== 'string' || c.name_ru.length > 100) throw new Error('Слишком длинное название цвета');
      if (!integer(c.qty, 0, 10000) || typeof c.enabled !== 'boolean' || (!c.enabled && c.qty !== 0)) throw new Error('Проверьте количества по цветам');
      const bbox = normalized(c.bbox, 4) as CatalogColor['bbox'];
      if (bbox[2] <= 0 || bbox[3] <= 0 || bbox[0] + bbox[2] > 1.001 || bbox[1] + bbox[3] > 1.001) throw new Error('Некорректные границы цвета');
      return { label, name_ru: c.name_ru.trim(), bbox,
        click_point: normalized(c.click_point, 2) as [number, number], qty: c.qty, enabled: c.enabled };
    });
    const model: ManualModel = { catalogId: m.catalogId, supplierModel: m.supplierModel.trim(),
      typeCode: m.typeCode as ManualModel['typeCode'], gender: m.gender as ManualModel['gender'], colors };
    if (modelQuantity(model) > 10000) throw new Error('Не больше 10 000 оправ одной модели');
    if (modelQuantity(model) > 0 && (!model.typeCode || !model.gender)) throw new Error('Для выбранных оправ укажите тип и пол');
    if (modelQuantity(model) > 0 && isModelExcludedFromPurchase(model, purchaseMix)) throw new Error('В заказе есть оправы выключенного вида. Включите вид в плане или уберите количество в карточке.');
    return model;
  });
  const result: ManualDraft = { target: draft.target, models, ...(purchaseMix ? { purchaseMix } : {}) };
  if (draftQuantity(result) > 100000) throw new Error('Не больше 100 000 оправ в заказе');
  return result;
}
