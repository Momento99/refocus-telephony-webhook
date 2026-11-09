import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFramePurchasePlan, FRAME_PURCHASE_PROFILE, modelPurchaseNeed } from './framePurchasePlan';
import type { ManualModel } from './frameManualProcurement';
import { defaultPurchaseMix, setPurchaseSectionEnabled, setPurchaseSectionQuantity, validatePurchaseMix } from './framePurchaseMix';

function model(typeCode: ManualModel['typeCode'], gender: ManualModel['gender'], qty: number): ManualModel {
  return { catalogId: 'fixture', supplierModel: '', typeCode, gender,
    colors: [{ label: 'C1', name_ru: '', bbox: [0,0,1,1], click_point: [.5,.5], enabled: true, qty }] };
}

test('the discussed 500-frame recommendation and its double are preserved exactly', () => {
  assert.deepEqual(buildFramePurchasePlan(500, []).sections.map(row => row.planned), [115,75,90,50,100,45,10,10,5]);
  assert.deepEqual(buildFramePurchasePlan(1000, []).sections.map(row => row.planned), [230,150,180,100,200,90,20,20,10]);
});
test('small, odd and maximum goals allocate exactly the goal in whole units', () => {
  for (const target of [...Array.from({length:1000},(_,i)=>i+1), 12345, 99999, 100000]) {
    const plan=buildFramePurchasePlan(target, []);
    assert.equal(plan.sections.reduce((s,r)=>s+r.planned,0),target);
    assert.ok(plan.sections.every(r=>Number.isInteger(r.planned)&&r.planned>=0));
    assert.equal(plan.remaining,target);
    for(const row of plan.sections)assert.ok(Math.abs(row.planned-target*row.baseQty/500)<1);
  }
  for(const target of [0,-1,1.5,100001,NaN,Infinity])assert.throws(()=>buildFramePurchasePlan(target, []));
});
test('an overfilled category never conceals shortages in another category', () => {
  const plan=buildFramePurchasePlan(500, [model('MA','M',500)]);
  assert.equal(plan.selectedTotal,500);assert.equal(plan.fulfilled,115);
  assert.equal(plan.remaining,385);assert.equal(plan.excess,385);
});
test('unisex fills only its own type, respects deficits and never changes models', () => {
  const models=[model('PA','M',100),model('PA','U',20),model('RL','M',3),model('RL','U',2)];
  const before=JSON.stringify(models),plan=buildFramePurchasePlan(500,models);
  assert.equal(plan.sections.find(r=>r.key==='PA_M')!.selected,100);
  assert.equal(plan.sections.find(r=>r.key==='PA_F')!.selected,20);
  assert.equal(plan.sections.find(r=>r.key==='RL_U')!.selected,5);
  assert.equal(plan.sections.find(r=>r.key==='MA_F')!.selected,0);
  assert.equal(plan.unisex,20);assert.equal(plan.excess,10);
  assert.equal(plan.sections.reduce((sum,r)=>sum+r.selected,0),125);
  assert.equal(JSON.stringify(models),before);
});
test('unassigned, zero-target and surplus unisex quantities remain accounted for', () => {
  const plan=buildFramePurchasePlan(1,[model('PA','U',103),model(null,null,7),model('RM','M',2)]);
  assert.equal(plan.unassigned,9);assert.equal(plan.selectedTotal,112);
  assert.equal(plan.sections.reduce((sum,r)=>sum+r.selected,0)+plan.unassigned,112);
  assert.equal(plan.excess,103);assert.equal(plan.remaining,1);
});
test('meeting every category produces a fully completed plan', () => {
  const models=FRAME_PURCHASE_PROFILE.map(row=>model(row.type,row.gender,row.baseQty));
  const plan=buildFramePurchasePlan(500,models);
  assert.equal(plan.fulfilled,500);assert.equal(plan.remaining,0);assert.equal(plan.excess,0);
});

test('excluding both children categories redistributes their share and preserves the goal', () => {
  const source = defaultPurchaseMix();
  const mix = setPurchaseSectionEnabled(setPurchaseSectionEnabled(source, 'KD_F', false), 'KD_M', false);
  const plan = buildFramePurchasePlan(500, [], mix);
  assert.deepEqual(plan.sections.map(row => row.planned), [120,78,94,52,104,47,0,0,5]);
  assert.deepEqual(source, defaultPurchaseMix());
  const restored = setPurchaseSectionEnabled(setPurchaseSectionEnabled(mix, 'KD_F', true), 'KD_M', true);
  assert.deepEqual(buildFramePurchasePlan(500, [], restored).sections.map(row => row.planned), [115,75,90,50,100,45,10,10,5]);
});
test('editing one count is exact, rescales the rest, and changing the goal preserves the new mix', () => {
  let mix = setPurchaseSectionEnabled(defaultPurchaseMix(), 'KD_F', false);
  mix = setPurchaseSectionQuantity(mix, 500, 'MA_M', 200);
  const plan = buildFramePurchasePlan(500, [], mix);
  assert.equal(plan.sections[0].planned, 200);
  assert.equal(plan.sections.reduce((s, r) => s + r.planned, 0), 500);
  assert.equal(plan.sections.find(r => r.key === 'KD_F')!.planned, 0);
  const doubled = buildFramePurchasePlan(1000, [], mix);
  assert.equal(doubled.sections[0].planned,400);
  assert.ok(doubled.sections.every((r,i) => Math.abs(r.planned-plan.sections[i].planned*2)<=1));
  mix = setPurchaseSectionQuantity(mix, 500, 'MA_M', 500);
  assert.equal(buildFramePurchasePlan(500, [], mix).sections[0].planned, 500);
  mix = setPurchaseSectionEnabled(mix, 'MA_M', false);
  assert.equal(buildFramePurchasePlan(500, [], mix).sections.reduce((s,r) => s+r.planned,0), 500);
  assert.ok(buildFramePurchasePlan(500, [], mix).sections.filter(r => r.enabled).every(r => r.planned > 0));
});
test('only enabled categories receive unisex; excluded selections remain counted as excess', () => {
  let mix = setPurchaseSectionEnabled(defaultPurchaseMix(), 'PA_M', false);
  const plan = buildFramePurchasePlan(500, [model('PA','U',200)], mix);
  assert.equal(plan.sections.find(r=>r.key==='PA_M')!.selected,0);
  assert.equal(plan.sections.find(r=>r.key==='PA_F')!.selected,200);
  mix = setPurchaseSectionEnabled(mix, 'PA_F', false);
  const legacy = buildFramePurchasePlan(500, [model('PA','U',200)], mix);
  assert.equal(legacy.selectedTotal,200); assert.equal(legacy.excess,200);
});
test('all but one category can be removed, and last removal or reducing its count is rejected', () => {
  let mix = defaultPurchaseMix();
  for (const row of FRAME_PURCHASE_PROFILE.slice(1)) mix = setPurchaseSectionEnabled(mix, row.key, false);
  assert.equal(buildFramePurchasePlan(500, [], mix).sections[0].planned,500);
  assert.throws(() => setPurchaseSectionEnabled(mix, 'MA_M', false));
  assert.throws(() => setPurchaseSectionQuantity(mix, 500, 'MA_M', 499));
  assert.throws(() => setPurchaseSectionQuantity(mix, 500, 'KD_F', 1));
});
test('many edits, exclusions and goal sizes keep integer totals and zero excluded allocations', () => {
  let mix = defaultPurchaseMix();
  for (let i=1; i<=400; i++) {
    const target = [1,2,9,500,501,100000][i % 6];
    const key = FRAME_PURCHASE_PROFILE[i % 9].key;
    mix = setPurchaseSectionEnabled(mix, key, true);
    mix = setPurchaseSectionQuantity(mix, target, key, i % (target+1));
    assert.equal(buildFramePurchasePlan(target, [], mix).sections.find(r=>r.key===key)!.planned, i % (target+1));
    const nextKey = FRAME_PURCHASE_PROFILE[(i+1) % 9].key;
    if (mix.excluded.length < 7) mix = setPurchaseSectionEnabled(mix, nextKey, false);
    validatePurchaseMix(JSON.parse(JSON.stringify(mix)));
    const plan = buildFramePurchasePlan(target, [], mix);
    assert.equal(plan.sections.reduce((s,r)=>s+r.planned,0),target);
    assert.ok(plan.sections.every(r=>Number.isInteger(r.planned) && r.planned>=0 && (r.enabled || r.planned===0)));
    assert.equal(plan.sections.find(r=>r.key===key)!.enabled,true);
  }
});

test('slider adjustments preserve other proportions even through a one-frame remainder', () => {
  let mix = defaultPurchaseMix();
  mix = setPurchaseSectionQuantity(mix,500,'MA_M',499);
  mix = setPurchaseSectionQuantity(mix,500,'MA_M',115);
  assert.deepEqual(buildFramePurchasePlan(500,[],mix).sections.map(r=>r.planned),[115,75,90,50,100,45,10,10,5]);
  mix = setPurchaseSectionEnabled(mix,'KD_F',false);
  mix = setPurchaseSectionQuantity(mix,100000,'MA_M',30000);
  mix = setPurchaseSectionEnabled(mix,'KD_F',true);
  assert.equal(buildFramePurchasePlan(500,[],mix).sections.find(r=>r.key==='KD_F')!.planned,10);
});

test('model guidance counts all models of its type and tracks shortage, completion and excess', () => {
  const current = model('PA','M',40);
  let need = modelPurchaseNeed(buildFramePurchasePlan(500,[current,model('PA','M',20),model('PA','F',10)]),current)!;
  assert.equal(need.planned,90);assert.equal(need.selected,60);assert.equal(need.remaining,30);
  current.colors[0].qty=70;
  need=modelPurchaseNeed(buildFramePurchasePlan(500,[current,model('PA','M',20)]),current)!;
  assert.equal(need.remaining,0);assert.equal(need.excess,0);
  current.colors[0].qty=75;
  need=modelPurchaseNeed(buildFramePurchasePlan(500,[current,model('PA','M',20)]),current)!;
  assert.equal(need.remaining,0);assert.equal(need.excess,5);
});
test('unisex guidance keeps gender deficits distinct and honors disabled categories', () => {
  const current=model('PA','U',0);
  let plan=buildFramePurchasePlan(500,[model('PA','M',100)]);
  let need=modelPurchaseNeed(plan,current)!;
  assert.equal(need.planned,140);assert.equal(need.selected,100);
  assert.equal(need.remaining,50);assert.equal(need.excess,10);
  let mix=setPurchaseSectionEnabled(defaultPurchaseMix(),'PA_M',false);
  plan=buildFramePurchasePlan(500,[],mix);need=modelPurchaseNeed(plan,current)!;
  assert.equal(need.excluded,false);assert.equal(need.planned,plan.sections.find(r=>r.key==='PA_F')!.planned);
  mix=setPurchaseSectionEnabled(mix,'PA_F',false);
  assert.equal(modelPurchaseNeed(buildFramePurchasePlan(500,[],mix),current)!.excluded,true);
});
test('model guidance recognizes rimless and custom plans without inventing missing categories', () => {
  const mix=setPurchaseSectionQuantity(defaultPurchaseMix(),500,'PA_M',150);
  const plan=buildFramePurchasePlan(1000,[],mix);
  assert.equal(modelPurchaseNeed(plan,model('PA','M',0))!.planned,300);
  assert.equal(modelPurchaseNeed(plan,model('RL','M',0))!.sections[0].key,'RL_U');
  assert.equal(modelPurchaseNeed(plan,model(null,null,0)),null);
  assert.equal(modelPurchaseNeed(plan,model('RP','M',0)),null);
});
