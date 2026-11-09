import { modelQuantity, type ManualModel } from './frameManualProcurement';
import { allocatePurchaseQuantities as allocate, defaultPurchaseMix, FRAME_PURCHASE_PROFILE,
  isValidPurchaseTarget, purchaseMixWeights, type PurchaseMixSettings } from './framePurchaseMix';
export { FRAME_PURCHASE_PROFILE, isValidPurchaseTarget, type PurchaseSectionKey } from './framePurchaseMix';

export function buildFramePurchasePlan(target: number, models: readonly ManualModel[], settings: PurchaseMixSettings = defaultPurchaseMix()) {
  if (!isValidPurchaseTarget(target)) throw new Error('Цель заказа: от 1 до 100 000 целых штук');
  const quantities = allocate(target, purchaseMixWeights(settings));
  const rows = FRAME_PURCHASE_PROFILE.map((row, i) => ({ ...row, planned: quantities[i], selected: 0,
    enabled: !settings.excluded.includes(row.key), percent: quantities[i] / target * 100, unisex: 0 }));
  const unisexByType = new Map<string, number>();
  let unassigned = 0, selectedTotal = 0;
  for (const model of models) {
    const qty = modelQuantity(model);
    if (!qty) continue;
    selectedTotal += qty;
    const match = rows.find(row => row.type === model.typeCode && (row.type === 'RL' || row.gender === model.gender));
    if (match) match.selected += qty;
    else if (model.typeCode && model.gender === 'U' && rows.some(row => row.type === model.typeCode)) {
      unisexByType.set(model.typeCode, (unisexByType.get(model.typeCode) || 0) + qty);
    } else unassigned += qty;
  }
  // Unisex fills remaining male/female needs within the same material/category.
  // This affects only the chart; original model classifications are never changed.
  for (const [type, qty] of unisexByType) {
    const matching = rows.filter(row => row.type === type);
    const deficits = matching.map(row => Math.max(0, row.planned - row.selected));
    const fill = Math.min(qty, deficits.reduce((a, b) => a + b, 0));
    const filled = allocate(fill, deficits);
    let extraWeights = matching.map(row => row.enabled ? settings.weights[row.key] : 0);
    if (!extraWeights.some(Boolean)) extraWeights = matching.map(row => row.enabled ? row.baseQty : 0);
    // In legacy/inconsistent drafts keep excluded selected quantities visible as excess.
    if (!extraWeights.some(Boolean)) extraWeights = matching.map(row => row.baseQty);
    const extra = allocate(qty - fill, extraWeights);
    matching.forEach((row, i) => { row.unisex = filled[i] + extra[i]; row.selected += row.unisex; });
  }
  const sections = rows.map(row => ({ ...row, remaining: Math.max(0, row.planned - row.selected),
    excess: Math.max(0, row.selected - row.planned) }));
  return { target, sections, selectedTotal, unassigned,
    unisex: [...unisexByType.values()].reduce((a, b) => a + b, 0),
    fulfilled: sections.reduce((sum, row) => sum + Math.min(row.planned, row.selected), 0),
    remaining: sections.reduce((sum, row) => sum + row.remaining, 0),
    excess: sections.reduce((sum, row) => sum + row.excess, 0) };
}

export type FramePurchasePlan = ReturnType<typeof buildFramePurchasePlan>;

/** The same categories as the order chart, including unisex and rimless rules. */
export function modelPurchaseNeed(plan: FramePurchasePlan, model: Pick<ManualModel, 'typeCode' | 'gender'>) {
  if (!model.typeCode || !model.gender) return null;
  const sections = plan.sections.filter(row => row.type === model.typeCode
    && (row.type === 'RL' || model.gender === 'U' || row.gender === model.gender));
  if (!sections.length) return null;
  return { sections, excluded: sections.every(row => !row.enabled),
    planned: sections.reduce((sum, row) => sum + row.planned, 0),
    selected: sections.reduce((sum, row) => sum + row.selected, 0),
    // Sum individual deficits: an excess of men's frames cannot fill a shortage of women's.
    remaining: sections.reduce((sum, row) => sum + row.remaining, 0),
    excess: sections.reduce((sum, row) => sum + row.excess, 0) };
}
