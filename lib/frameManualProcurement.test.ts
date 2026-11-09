import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distributeEvenly, validateManualDraft, draftQuantity, type ManualColor } from './frameManualProcurement';
import { frameRecognitionUsageCost } from './frameRecognitionCost';
import { isRecognitionEngine } from './frameProcurementTypes';
import { validateColorRecognition } from './frameColorVision';
import { defaultPurchaseMix, setPurchaseSectionEnabled, setPurchaseSectionQuantity } from './framePurchaseMix';

const colors = (count: number): ManualColor[] => Array.from({ length: count }, (_, i) => ({
  label: `C${i + 1}`, name_ru: '', bbox: [.1, .1, .8, .1], click_point: [.3, .15], qty: 0, enabled: true,
}));
test('even distribution preserves every requested frame with a stable remainder', () => {
  for (let count = 1; count <= 30; count++) for (let qty = 0; qty < 100; qty++) {
    const result = distributeEvenly(colors(count), qty).map(c => c.qty);
    assert.equal(result.reduce((a, b) => a + b, 0), qty);
    assert.ok(Math.max(...result) - Math.min(...result) <= 1);
    assert.ok(result.every((value, i) => !i || result[i - 1] >= value));
  }
  assert.deepEqual(distributeEvenly(colors(5), 17).map(c => c.qty), [4,4,3,3,3]);
});
test('excluded colors receive zero, including existing manually entered quantities', () => {
  const source = colors(5); source[1] = { ...source[1], enabled: false, qty: 99 };
  assert.deepEqual(distributeEvenly(source, 15).map(c => c.qty), [4,0,4,4,3]);
  assert.throws(() => distributeEvenly(source.map(c => ({ ...c, enabled: false })), 1));
  for (const bad of [-1, 1.5, NaN, Infinity, 10001]) assert.throws(() => distributeEvenly(source, bad));
});
const sample = () => ({ target: 500, models: [{ catalogId: '064f9f65-4b4c-4552-8dd4-243a40b8b5e6', supplierModel: '2009', typeCode: 'PA', gender: 'U', colors: distributeEvenly(colors(5), 17) }] });
test('draft JSON round trip preserves coordinates, unisex and exact totals', () => {
  const result = validateManualDraft(JSON.parse(JSON.stringify(sample())));
  assert.equal(draftQuantity(result), 17); assert.equal(result.models[0].gender, 'U');
  assert.deepEqual(result.models[0].colors[0].click_point, [.3,.15]);
});
test('draft validation rejects ambiguous order and image data', () => {
  const invalid: Array<(d: any) => void> = [
    d => d.models.push(d.models[0]), d => d.models[0].colors[1].label = 'C1',
    d => d.models[0].typeCode = null, d => d.models[0].gender = 'invalid',
    d => d.models[0].colors[0].click_point = [1.1,.2], d => d.models[0].colors[0].bbox = [.9,.1,.8,.2],
    d => d.models[0].colors[0].qty = 1.3, d => d.models[0].colors[0].enabled = false,
    d => d.target = 0, d => d.target = '500', d => d.models[0].catalogId = 'not-uuid',
  ];
  for (const mutate of invalid) { const draft = sample(); mutate(draft); assert.throws(() => validateManualDraft(draft)); }
});
test('only 6.1 Sol is offered for new recognition and usage includes output reasoning tokens', () => {
  assert.equal(isRecognitionEngine('gpt-6.1-sol'), true);
  assert.equal(isRecognitionEngine('gpt-5.6-sol'), false); assert.equal(isRecognitionEngine('gpt-5.6-luna'), false);
  assert.ok(Math.abs(frameRecognitionUsageCost(2515, 0, 526).usd - .01029) < 1e-9);
  assert.ok(Math.abs(frameRecognitionUsageCost(2000, 1000, 500).usd - .0071) < 1e-9);
});
test('recognition cannot inject quantities, gender, type or duplicate supplier codes', () => {
  const raw = { supplier_model: '2009', confidence: .9, needs_review: false, colors: colors(2), type_code: 'MA', gender: 'M', qty: 999 };
  const parsed = validateColorRecognition(raw);
  assert.equal('qty' in parsed, false); assert.equal('type_code' in parsed, false);
  assert.equal('qty' in parsed.colors[0], false);
  raw.colors[1].label = raw.colors[0].label;
  assert.throws(() => validateColorRecognition(raw));
});

test('custom mix survives server validation and JSON round trip; old drafts stay compatible', () => {
  const purchaseMix = setPurchaseSectionQuantity(setPurchaseSectionEnabled(defaultPurchaseMix(),'KD_F',false),500,'MA_M',150);
  const draft = { ...sample(), purchaseMix };
  assert.deepEqual(validateManualDraft(JSON.parse(JSON.stringify(draft))),draft);
  assert.equal('purchaseMix' in validateManualDraft(sample()),false);
});
test('server rejects excluded selections and invalid mixes, but allows unisex in the remaining gender', () => {
  let purchaseMix = setPurchaseSectionEnabled(defaultPurchaseMix(),'PA_M',false);
  assert.equal(draftQuantity(validateManualDraft({ ...sample(), purchaseMix })),17);
  purchaseMix = setPurchaseSectionEnabled(purchaseMix,'PA_F',false);
  assert.throws(()=>validateManualDraft({ ...sample(), purchaseMix }));
  for (const invalid of [null, {}, { weights: {}, excluded: [] },
    { ...defaultPurchaseMix(), excluded:['unknown'] }, { ...defaultPurchaseMix(), excluded:['KD_F','KD_F'] },
    { ...defaultPurchaseMix(), weights:{ ...defaultPurchaseMix().weights, MA_M:-1 } },
    { ...defaultPurchaseMix(), weights:{ ...defaultPurchaseMix().weights, MA_M:'1.5' } },
    { ...defaultPurchaseMix(), weights:Object.fromEntries(Object.keys(defaultPurchaseMix().weights).map(k=>[k,0])) }]) {
    assert.throws(()=>validateManualDraft({ ...sample(), purchaseMix:invalid }));
  }
});
