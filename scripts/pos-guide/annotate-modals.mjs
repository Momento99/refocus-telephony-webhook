// Annotate the orders drawer + pay modal.

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

// ── DRAWER ──────────────────────────────────────────────────────────
console.log('Drawer + annotate…');
await page.locator('table tbody tr').first().locator('td').first().click();
await page.waitForTimeout(2500);
await addAnnotations(page, [
  { text: 'ORD-26-01006', tag: 'div', label: 'Номер заказа (ORD-26-…)' },
  { text: 'Болот', tag: 'div', label: 'ФИО клиента' },
  { text: '996555244966', tag: 'div', label: 'Телефон клиента' },
  { text: 'Беловодск', tag: 'div', label: 'Филиал, где сделан заказ' },
  { text: '6 150', tag: 'div', label: 'Полная сумма заказа' },
  { text: '2 000', tag: 'div', label: 'Уже оплачено клиентом' },
  { text: '4 150', tag: 'div', label: 'Долг: остаток к оплате', emphasis: true },
  { text: 'История оплат', tag: 'div', label: 'Все платежи по этому заказу' },
], {
  mode: 'compact',
  legendTitle: 'Детали заказа',
  legendAnchor: { x: 16, y: 480 },
  full: false,
});
await page.screenshot({ path: path.join(OUT, '10-orders-drawer-annotated.png'), fullPage: false });
await clearAnnotations(page);
console.log('  ✓ 10-orders-drawer-annotated');

// close drawer
await page.evaluate(() => {
  document.querySelectorAll('button').forEach(b => {
    if ((b.textContent || '').trim() === '' && b.querySelector('svg')) {
      const r = b.getBoundingClientRect();
      if (r.right > window.innerWidth - 80 && r.top < 50) b.click();
    }
  });
});
await page.waitForTimeout(1000);

// ── PAY MODAL ──────────────────────────────────────────────────────
console.log('PayModal + annotate…');
await page.evaluate(() => {
  document.querySelectorAll('[class*="fixed"][class*="inset-0"]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 100 && r.height > 100) el.remove();
  });
});
await page.waitForTimeout(500);

await page.locator('table button:has-text("Оплата")').first().click({ force: true });
await page.waitForTimeout(2500);
await addAnnotations(page, [
  { text: 'Наличные', tag: 'button', label: 'Оплата наличными' },
  { text: 'Карта', tag: 'button', label: 'Оплата картой' },
  { text: 'QR-код', tag: 'button', label: 'Оплата через QR (О!Деньги, MBANK)' },
  { selector: 'input[placeholder="Сумма"]', label: 'Сумма платежа в сомах', emphasis: true },
  { text: 'Весь долг', tag: 'button', label: 'Подставить весь долг (4 150)' },
  { text: '+5000', tag: 'button', label: 'Быстрая подстановка суммы' },
  { text: '+ Добавить второй платёж', tag: 'button', label: 'Если клиент платит частями разными способами' },
  { text: 'Подтвердить', tag: 'button', label: 'Сохранить платёж', emphasis: true },
  { text: 'Отмена', tag: 'button', label: 'Закрыть без сохранения' },
], {
  mode: 'compact',
  legendTitle: 'Окно оплаты',
  legendAnchor: { x: 16, y: 480 },
  full: false,
});
await page.screenshot({ path: path.join(OUT, '11-orders-pay-modal-annotated.png'), fullPage: false });
await clearAnnotations(page);
console.log('  ✓ 11-orders-pay-modal-annotated');

await browser.close();
console.log('Done');
