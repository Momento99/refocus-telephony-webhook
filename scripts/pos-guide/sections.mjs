// Capture each section of the new-order page expanded individually.

import { chromium } from 'playwright';
import path from 'node:path';
import { addAnnotations, clearAnnotations } from './annotate.mjs';

const POS = 'http://localhost:3001';
const OUT = path.resolve('docs/pos-screenshots');

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  locale: 'ru-RU',
  timezoneId: 'Asia/Bishkek',
});
await ctx.addInitScript(() => localStorage.setItem('pos_terminal_code', 'BV-01'));

const page = await ctx.newPage();
page.setDefaultTimeout(20000);

console.log('Login…');
await page.goto(`${POS}/pos/login`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await page.fill('input[placeholder="gulzat"]', 'elida');
await page.fill('input[type="password"]', '1958');
await Promise.all([
  page.waitForURL('**/my-shift', { timeout: 15000 }),
  page.click('button[type="submit"]'),
]);
await page.waitForTimeout(5000);

const sections = [
  { idx: 2, name: 'Оправа',          file: '07a-new-order-frame' },
  { idx: 3, name: 'Линзы',           file: '07b-new-order-lenses' },
  { idx: 4, name: 'Оплата',          file: '07c-new-order-payment' },
  { idx: 5, name: 'Возврат / Отмена', file: '07d-new-order-refund' },
];

for (const sec of sections) {
  console.log(`Section ${sec.name}…`);
  await page.goto(`${POS}/new-order`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // Click РАЗВЕРНУТЬ on the target section. Each section has its own trigger.
  // The section row contains both number badge and section name + РАЗВЕРНУТЬ button.
  try {
    // Find all РАЗВЕРНУТЬ triggers; index 0 = Оправа, 1 = Линзы, etc.
    const expanders = page.locator('text=РАЗВЕРНУТЬ');
    const count = await expanders.count();
    console.log(`  found ${count} РАЗВЕРНУТЬ triggers`);
    // index = idx - 2 (sections are 2,3,4,5 → indexes 0,1,2,3)
    const targetIdx = sec.idx - 2;
    if (targetIdx < count) {
      await expanders.nth(targetIdx).click({ force: true });
      await page.waitForTimeout(1500);
    }
  } catch (e) { console.log('  expand failed:', e.message); }

  await page.screenshot({
    path: path.join(OUT, `${sec.file}.png`),
    fullPage: true,
  });
  console.log(`  ✓ ${sec.file}`);
}

await browser.close();
console.log('Done');
