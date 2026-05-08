// Re-capture the two missing screens: orders drawer + pay modal.
// Click the № cell (not whole row) to open drawer; close drawer; click Оплата.

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

console.log('Open orders…');
await page.goto(`${POS}/orders`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);

// Drawer — click № cell (first <td>)
console.log('Drawer…');
try {
  await page.locator('table tbody tr').first().locator('td').first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, '10-orders-drawer.png'), fullPage: false });
  console.log('  ✓ 10-orders-drawer');

  // close drawer (Escape may not work — find close button)
  const closeBtn = page.locator('button[aria-label*="close"], button:has-text("✕"), button:has-text("Закрыть")').first();
  if (await closeBtn.count()) {
    await closeBtn.click({ force: true }).catch(() => {});
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
  await page.waitForTimeout(1500);
} catch (e) { console.log('  drawer fail:', e.message); }

// PayModal
console.log('PayModal…');
try {
  // ensure no overlay
  await page.evaluate(() => {
    document.querySelectorAll('[class*="fixed"][class*="inset-0"]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 100 && r.height > 100) el.remove();
    });
  });
  await page.waitForTimeout(500);

  const payBtn = page.locator('table button:has-text("Оплата")').first();
  await payBtn.scrollIntoViewIfNeeded();
  await payBtn.click({ force: true });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, '11-orders-pay-modal.png'), fullPage: false });
  console.log('  ✓ 11-orders-pay-modal');
} catch (e) { console.log('  pay modal fail:', e.message); }

await browser.close();
console.log('Done');
