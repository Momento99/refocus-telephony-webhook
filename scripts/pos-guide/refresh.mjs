// Re-take my-shift and customer detail with longer waits.
import { chromium } from 'playwright';
import path from 'node:path';

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
await page.waitForTimeout(800);
await page.fill('input[placeholder="gulzat"]', 'elida');
await page.fill('input[type="password"]', '1958');

// Wait for navigation AND session storage propagation
await Promise.all([
  page.waitForURL('**/my-shift', { timeout: 15000 }),
  page.click('button[type="submit"]'),
]);

console.log('Wait for my-shift to fully load…');
await page.waitForTimeout(6000); // give RPCs time
await page.screenshot({ path: path.join(OUT, '03-my-shift.png'), fullPage: true });
console.log('  ✓ 03-my-shift');

console.log('Customer detail (waiting longer)…');
await page.goto(`${POS}/customers`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
const link = page.locator('a[href^="/customers/"]').first();
await link.click();
await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(OUT, '13-customer-detail.png'), fullPage: true });
console.log('  ✓ 13-customer-detail');

await browser.close();
