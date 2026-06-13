import * as f from '../lib/framePricingFormula.ts';
f.setBranchTotalSlots('Токмок', 380);
const slots = f.computeAllSectionSlotsForBranch('Токмок');
console.log('Section slots:', slots);
console.log('Total slots:', Object.values(slots).reduce((s, v) => s + v, 0));

const sections = [['PA','F'],['PA','M'],['MA','F'],['MA','M'],['RP','F'],['RM','F'],['KD','F'],['KD','M'],['RL','F'],['RL','M']];
let total = 0;
for (const [t, g] of sections) {
  const prices = f.computeSectionPrices(t, g, 'Токмок');
  const exp = slots[`${t}_${g}`];
  const mark = prices.length === exp ? '✓' : `MISSING ${exp - prices.length}`;
  console.log(`${t}_${g}: expected ${exp}, got ${prices.length} ${mark}`);
  total += prices.length;
}
console.log('Generated total:', total);
