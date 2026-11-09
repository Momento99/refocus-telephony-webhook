// Dated recommendation: 926 paid/prepaid frames, five branches, 13 Jul–10 Oct 2026.
// Source: outputs/frame-purchase-mix-2026-10-11/recommendation.json.
export const FRAME_PURCHASE_PROFILE = [
  { key: 'MA_M', type: 'MA', gender: 'M', label: 'Металл · мужские', baseQty: 115, color: '#4263d8' },
  { key: 'MA_F', type: 'MA', gender: 'F', label: 'Металл · женские', baseQty: 75, color: '#7895ef' },
  { key: 'PA_M', type: 'PA', gender: 'M', label: 'Пластик · мужские', baseQty: 90, color: '#8359ce' },
  { key: 'PA_F', type: 'PA', gender: 'F', label: 'Пластик · женские', baseQty: 50, color: '#b292e3' },
  { key: 'RP_F', type: 'RP', gender: 'F', label: 'Чтение · пластик', baseQty: 100, color: '#149a94' },
  { key: 'RM_F', type: 'RM', gender: 'F', label: 'Чтение · металл', baseQty: 45, color: '#65b8a4' },
  { key: 'KD_F', type: 'KD', gender: 'F', label: 'Детские · девочки', baseQty: 10, color: '#db9650' },
  { key: 'KD_M', type: 'KD', gender: 'M', label: 'Детские · мальчики', baseQty: 10, color: '#e8ba72' },
  { key: 'RL_U', type: 'RL', gender: 'U', label: 'Безоправные · унисекс', baseQty: 5, color: '#7c8da3' },
] as const;
export type PurchaseSectionKey = typeof FRAME_PURCHASE_PROFILE[number]['key'];
export interface PurchaseMixSettings {
  // Relative shares, not rounded frame counts. Preserve fractions so dragging
  // through small quantities cannot erase the proportions of the other types.
  weights: Record<PurchaseSectionKey, number>;
  excluded: PurchaseSectionKey[];
}
export function defaultPurchaseMix(): PurchaseMixSettings {
  return { weights: Object.fromEntries(FRAME_PURCHASE_PROFILE.map(row => [row.key, row.baseQty])) as PurchaseMixSettings['weights'], excluded: [] };
}
export function isValidPurchaseTarget(target: number): boolean {
  return Number.isInteger(target) && target >= 1 && target <= 100000;
}
/** Stable largest remainders: exact integer total; zero weights receive nothing. */
export function allocatePurchaseQuantities(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum || !total) return weights.map(() => 0);
  const raw = weights.map(weight => total * weight / sum);
  const amounts = raw.map(value => Math.floor(value + 1e-9));
  const ranked = weights.map((weight, index) => ({ index, remainder: Math.round((raw[index] - amounts[index]) * 1e9) / 1e9 }))
    .filter(row => weights[row.index] > 0).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const left = total - amounts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < left; i++) amounts[ranked[i].index]++;
  return amounts;
}
export function validatePurchaseMix(value: unknown): PurchaseMixSettings {
  const invalid = () => new Error('Проверьте настройки плана по видам');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const { weights, excluded } = value as PurchaseMixSettings;
  const keys = FRAME_PURCHASE_PROFILE.map(row => row.key);
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)
    || Object.keys(weights).length !== keys.length
    || keys.some(key => typeof weights[key] !== 'number' || !Number.isFinite(weights[key]) || weights[key] < 0 || weights[key] > 100000)
    || !Array.isArray(excluded) || excluded.some(key => !keys.includes(key))
    || new Set(excluded).size !== excluded.length) throw invalid();
  if (!keys.some(key => !excluded.includes(key) && weights[key] > 0)) throw new Error('Оставьте хотя бы один вид в плане');
  return { weights: { ...weights }, excluded: [...excluded] };
}
export function purchaseMixWeights(settings: PurchaseMixSettings): number[] {
  return FRAME_PURCHASE_PROFILE.map(row => settings.excluded.includes(row.key) ? 0 : settings.weights[row.key]);
}
function normalizeWeights(weights: PurchaseMixSettings['weights']): PurchaseMixSettings['weights'] {
  const sum = Object.values(weights).reduce((a,b) => a+b,0);
  return Object.fromEntries(FRAME_PURCHASE_PROFILE.map(row => [row.key, weights[row.key] / sum * 500])) as PurchaseMixSettings['weights'];
}
export function setPurchaseSectionEnabled(settings: PurchaseMixSettings, key: PurchaseSectionKey, enabled: boolean): PurchaseMixSettings {
  const excluded = enabled ? settings.excluded.filter(k => k !== key) : [...new Set([...settings.excluded, key])];
  const active = FRAME_PURCHASE_PROFILE.filter(row => !excluded.includes(row.key));
  if (!active.length) throw new Error('Оставьте хотя бы один вид в плане');
  const weights = { ...settings.weights };
  if (enabled && !weights[key]) weights[key] = FRAME_PURCHASE_PROFILE.find(row => row.key === key)!.baseQty;
  // A slider may have assigned 100% to the removed category. Revive the other
  // enabled categories proportionally to sales, instead of losing the goal.
  if (!active.some(row => weights[row.key] > 0)) active.forEach(row => { weights[row.key] = row.baseQty; });
  return { weights: normalizeWeights(weights), excluded };
}
/** Editing one count reserves it exactly; all other active categories share the remainder. */
export function setPurchaseSectionQuantity(settings: PurchaseMixSettings, target: number, key: PurchaseSectionKey, quantity: number): PurchaseMixSettings {
  if (!isValidPurchaseTarget(target) || !Number.isInteger(quantity) || quantity < 0 || quantity > target) throw new Error('Количество должно быть от 0 до цели заказа');
  if (settings.excluded.includes(key)) throw new Error('Сначала включите этот вид');
  const others = FRAME_PURCHASE_PROFILE.filter(row => row.key !== key && !settings.excluded.includes(row.key));
  if (!others.length && quantity !== target) throw new Error('Единственный вид получает всю цель заказа');
  let otherWeights = others.map(row => settings.weights[row.key]);
  if (!otherWeights.some(Boolean)) otherWeights = others.map(row => row.baseQty);
  const activeSum = purchaseMixWeights(settings).reduce((a,b) => a+b,0);
  const restWeight = activeSum * (target - quantity) / target;
  const otherSum = otherWeights.reduce((a,b) => a+b,0);
  const weights = { ...settings.weights, [key]: activeSum * quantity / target };
  others.forEach((row, i) => { weights[row.key] = restWeight * otherWeights[i] / otherSum; });
  return { weights: normalizeWeights(weights), excluded: [...settings.excluded] };
}
/** Unisex can fill either enabled gender of its type; rimless is one shared category. */
export function isModelExcludedFromPurchase(model: { typeCode: string | null; gender: string | null }, settings?: PurchaseMixSettings): boolean {
  if (!settings || !model.typeCode || !model.gender) return false;
  const matching = FRAME_PURCHASE_PROFILE.filter(row => row.type === model.typeCode
    && (row.type === 'RL' || model.gender === 'U' || row.gender === model.gender));
  return matching.length > 0 && matching.every(row => settings.excluded.includes(row.key));
}
