const f = await import('../lib/framePricingFormula.ts');
const s = await import('../lib/shelfLayoutPlan.ts');
const { computeBranchLayout } = s;

f.setBranchTotalSlots('Кант', 252);

const slots = f.computeAllSectionSlotsForBranch('Кант');
const total = Object.values(slots).reduce((a, v) => a + v, 0);
console.log('=== КАНТ: доли секций ===');
console.log(slots);
console.log('Σ слотов:', total, total === 252 ? 'OK' : 'FAIL(!=252)');

const sections = [['PA','F'],['PA','M'],['MA','F'],['MA','M'],['RP','F'],['RM','F'],['KD','F'],['KD','M'],['RL','F'],['RL','M']];
console.log('\n=== Цены по секциям (длина = слотам) ===');
let gen = 0;
for (const [t, g] of sections) {
  const prices = f.computeSectionPrices(t, g, 'Кант');
  const exp = slots[`${t}_${g}`];
  const mark = prices.length === exp ? 'OK' : `MISMATCH (exp ${exp})`;
  gen += prices.length;
  console.log(`${t}_${g}: ${prices.length} ${mark}  [${prices.join(', ')}]`);
}
console.log('Σ сгенерировано:', gen);

console.log('\n=== Раскладка Канта ===');
const layout = computeBranchLayout('Кант');
console.log('kind:', layout.kind);
for (const z of layout.zones) {
  const used = z.cells.flat().filter(Boolean).length;
  console.log(`  ${z.id}: ${used}/${z.capacity} ${used === z.capacity ? 'OK' : 'PARTIAL'}`);
}
console.log('unplaced:', layout.unplaced.length, layout.unplaced.length === 0 ? 'OK' : 'FAIL');

// Визуализация сетки стен (ряд 5 = верх, ряд 0 = низ). Дорогое должно тянуться к центру.
for (const z of layout.zones) {
  console.log(`\n--- ${z.name} (ряд 5 верх → ряд 0 низ) ---`);
  for (let r = z.rows - 1; r >= 0; r--) {
    const line = z.cells[r].map((c) => (c ? String(c.price).padStart(5) : '    .')).join(' ');
    console.log(`r${r}: ${line}`);
  }
}

console.log('\n=== Регресс Токмока ===');
f.setBranchTotalSlots('Токмок', 380);
const tl = computeBranchLayout('Токмок');
const tUsed = tl.zones.reduce((a, z) => a + z.cells.flat().filter(Boolean).length, 0);
const tCap = tl.zones.reduce((a, z) => a + z.capacity, 0);
console.log('kind:', tl.kind, 'зон:', tl.zones.length, 'used/cap:', `${tUsed}/${tCap}`, 'unplaced:', tl.unplaced.length, tl.unplaced.length === 0 ? 'OK' : 'FAIL');
