// POS screenshot tour: logs in once as elida/1958 (Belovodsk),
// then walks through every seller-facing route and saves PNGs to docs/pos-screenshots.
//
// Run with:  node scripts/pos-guide/capture.mjs
//
// Requires POS dev server on http://localhost:3001 and Playwright with Chromium.

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const POS = 'http://localhost:3001';
const OUT = path.resolve('docs/pos-screenshots');
const VIEWPORT = { width: 1440, height: 900 };

const LOGIN = 'elida';
const PIN = '1958';
const TERMINAL_CODE = 'BV-01';

await fs.mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  locale: 'ru-RU',
  timezoneId: 'Asia/Bishkek',
});

// Pre-seed terminal code (login page reads from localStorage)
await ctx.addInitScript(([code]) => {
  try {
    localStorage.setItem('pos_terminal_code', code);
  } catch {}
}, [TERMINAL_CODE]);

const page = await ctx.newPage();
page.setDefaultTimeout(20000);
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('  console.error:', msg.text());
});

const shots = [];
async function shot(name, opts = {}) {
  const file = path.join(OUT, `${name}.png`);
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  if (opts.delay) await page.waitForTimeout(opts.delay);
  await page.screenshot({ path: file, fullPage: !!opts.full });
  shots.push({ name, file });
  console.log('  ✓', name);
}

console.log('1. Login page');
await page.goto(`${POS}/pos/login`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
await shot('01-login-empty');

await page.fill('input[placeholder="gulzat"]', LOGIN);
await page.fill('input[type="password"]', PIN);
await page.waitForTimeout(400);
await shot('02-login-filled');

console.log('2. Submit login → /my-shift');
await Promise.all([
  page.waitForURL('**/my-shift', { timeout: 15000 }),
  page.click('button[type="submit"]'),
]);
await page.waitForTimeout(1500);
await shot('03-my-shift', { full: true });

const routes = [
  { url: '/new-order', name: '04-new-order', delay: 1200, full: true },
  { url: '/orders', name: '05-orders', delay: 1500, full: true },
  { url: '/customers', name: '06-customers', delay: 1200, full: true },
  { url: '/expenses', name: '07-expenses', delay: 1200, full: true },
  { url: '/pos/consumables', name: '08-consumables', delay: 1200, full: true },
  { url: '/pos/lens-warehouse', name: '09-lens-warehouse', delay: 1500, full: true },
  { url: '/whatsapp', name: '10-whatsapp', delay: 1200, full: true },
  { url: '/whatsapp-score', name: '11-whatsapp-score', delay: 1200, full: true },
  { url: '/instagram', name: '12-instagram', delay: 1200, full: true },
];

for (const r of routes) {
  console.log('Route:', r.url);
  try {
    await page.goto(`${POS}${r.url}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(r.delay);
    await shot(r.name, { full: r.full });
  } catch (e) {
    console.log('  ✗ failed:', r.url, e.message);
  }
}

// Customer detail (use first customer in list)
console.log('Customer detail');
try {
  await page.goto(`${POS}/customers`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const firstCustLink = page.locator('a[href^="/customers/"]').first();
  if (await firstCustLink.count()) {
    await firstCustLink.click();
    await page.waitForTimeout(1500);
    await shot('13-customer-detail', { full: true });
  }
} catch (e) {
  console.log('  ✗ customer detail failed:', e.message);
}

await browser.close();
console.log(`\nDone. ${shots.length} screenshots in ${OUT}`);
