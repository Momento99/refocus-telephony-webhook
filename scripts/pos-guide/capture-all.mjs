// Comprehensive POS screenshot tour — covers every seller-facing screen + modals.
// Generates ~30 annotated PNGs for the training guide.
//
// Run:  node scripts/pos-guide/capture-all.mjs

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { addAnnotations, clearAnnotations } from './annotate.mjs';

const POS = 'http://localhost:3001';
const OUT = path.resolve('docs/pos-screenshots');
const VIEWPORT = { width: 1440, height: 900 };

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  locale: 'ru-RU',
  timezoneId: 'Asia/Bishkek',
});
await ctx.addInitScript(() => localStorage.setItem('pos_terminal_code', 'BV-01'));

const page = await ctx.newPage();
page.setDefaultTimeout(20000);
page.on('pageerror', e => console.log('  pageerror:', e.message.slice(0, 100)));

async function snap(name, opts = {}) {
  const file = path.join(OUT, `${name}.png`);
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  if (opts.delay) await page.waitForTimeout(opts.delay);
  await page.screenshot({ path: file, fullPage: opts.full !== false });
  console.log('  ✓', name);
}
async function noteAndSnap(name, items, opts = {}) {
  if (opts.delay) await page.waitForTimeout(opts.delay);
  await addAnnotations(page, items, opts);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: opts.full !== false });
  await clearAnnotations(page);
  console.log('  ✓', name, '(annotated)');
}

// ════════════════════════════════════════════════════════════════════
// 1. LOGIN
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 1. LOGIN ===');
await page.goto(`${POS}/pos/login`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await snap('01-login-empty', { full: false });

await page.fill('input[placeholder="gulzat"]', 'elida');
await page.fill('input[type="password"]', '1958');
await page.waitForTimeout(400);
await noteAndSnap('02-login-annotated', [
  { selector: 'input[placeholder="gulzat"]', label: 'Логин сотрудника', placement: 'right' },
  { selector: 'input[type="password"]', label: 'PIN филиала (4 цифры)', placement: 'right' },
  { selector: 'input[readonly]', label: 'Терминал — определяется автоматически', placement: 'left' },
  { text: 'Войти и открыть смену', tag: 'button', label: 'Нажать «Войти»', placement: 'right', emphasis: true },
], { full: false });

// Submit
await Promise.all([
  page.waitForURL('**/my-shift', { timeout: 15000 }),
  page.click('button[type="submit"]'),
]);
await page.waitForTimeout(6000);

// ════════════════════════════════════════════════════════════════════
// 2. MY SHIFT
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 2. MY SHIFT ===');
await snap('03-my-shift-overview');
await noteAndSnap('04-my-shift-annotated', [
  { selector: 'a[href="/new-order"]', label: 'Создать новый заказ', placement: 'bottom', emphasis: true },
  { selector: 'a[href="/orders"]', label: 'Список заказов', placement: 'bottom' },
  { selector: 'a[href="/customers"]', label: 'База клиентов', placement: 'bottom' },
  { selector: 'a[href="/expenses"]', label: 'Расходы дня', placement: 'bottom' },
  { selector: 'a[href="/pos/consumables"]', label: 'Учёт расходников', placement: 'bottom' },
  { selector: 'a[href="/pos/lens-warehouse"]', label: 'Склад линз', placement: 'bottom' },
  { selector: 'a[href="/my-shift"]', label: 'Моя смена и зарплата', placement: 'bottom' },
  { selector: 'a[href="/whatsapp"]', label: 'WhatsApp клиентов', placement: 'bottom' },
  { selector: 'a[href="/instagram"]', label: 'Instagram клиентов', placement: 'bottom' },
  { text: 'Выключить', tag: 'button', label: 'Закрыть смену в конце дня', placement: 'bottom' },
], { mode: 'compact', legendTitle: 'Меню верхней навигации',
   legendAnchor: { text: 'Элида', tag: 'div', placement: 'below' } });

// ════════════════════════════════════════════════════════════════════
// 3. NEW ORDER — sections walkthrough
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 3. NEW ORDER ===');
await page.goto(`${POS}/new-order`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

// 3.1 Section 1 — клиент + филиал (already open by default)
await noteAndSnap('05-new-order-client', [
  { selector: 'input[value="BV-01"]', label: 'Филиал — заполнен автоматически' },
  { selector: 'input[placeholder="Иванов"]', label: 'Фамилия клиента' },
  { selector: 'input[placeholder="Алексей"]', label: 'Имя клиента' },
  { selector: 'input[placeholder="ДД.ММ.ГГГГ"]', label: 'Дата рождения' },
  { text: 'М', tag: 'label', label: 'Пол клиента: М или Ж' },
  { selector: 'input[placeholder="+996"]', label: 'Телефон клиента — авто-поиск', emphasis: true },
  { text: 'Найти', tag: 'button', label: 'Поиск клиента руками' },
  { text: 'Приложение', tag: 'div', label: 'Уведомить через push (по умолч.)' },
  { text: 'WhatsApp', tag: 'div', label: 'Уведомить через WhatsApp' },
  { text: 'Звонок', tag: 'div', label: 'Продавец позвонит сам' },
  { text: 'Далее: Оправа', tag: 'button', label: 'После клиента — переход к оправе', emphasis: true },
], { mode: 'compact', legendTitle: 'Шаг 1. Клиент и филиал',
   legendAnchor: { text: 'Создать заказ', tag: 'button', placement: 'below' } });

// 3.2 Section 2 — Оправа
const sectionsToOpen = ['Оправа', 'Линзы', 'Оплата', 'Возврат / Отмена'];
for (const sectionName of sectionsToOpen) {
  try {
    // click РАЗВЕРНУТЬ next to section title
    const sectionRow = page.locator(`text=${sectionName}`).first();
    const expandBtn = sectionRow.locator('xpath=../..').locator('text=РАЗВЕРНУТЬ').first();
    if (await expandBtn.count() > 0) {
      await expandBtn.click().catch(() => {});
      await page.waitForTimeout(800);
    }
  } catch (e) {
    console.log(`  could not expand: ${sectionName}`);
  }
}
await page.waitForTimeout(1500);
await snap('06-new-order-all-sections', { full: true });

// ════════════════════════════════════════════════════════════════════
// 4. ORDERS
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 4. ORDERS ===');
await page.goto(`${POS}/orders`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await snap('07-orders-list');
await noteAndSnap('08-orders-annotated', [
  { selector: 'input[placeholder*="Поиск"]', label: 'Поиск по №, ФИО, телефону' },
  { text: 'Кому позвонить', tag: 'button', label: 'Список клиентов на обзвон' },
  { text: 'Сбросить', tag: 'button', label: 'Сброс фильтров' },
  { text: 'Обновить', tag: 'button', label: 'Перезагрузить список', emphasis: true },
], { mode: 'compact', legendTitle: 'Список заказов',
   legendAnchor: { text: 'Долг клиентов', tag: 'div', placement: 'below' } });

// 4.1 Click first order's "Оплата" → PayModal
try {
  const payBtn = page.locator('button:has-text("Оплата")').first();
  if (await payBtn.count() > 0) {
    await payBtn.click();
    await page.waitForTimeout(1500);
    await snap('09-orders-pay-modal', { full: false });
    // close modal
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
  }
} catch (e) {
  console.log('  pay modal failed:', e.message);
}

// 4.2 Click first order row to open Drawer
try {
  await page.waitForTimeout(800);
  const orderRow = page.locator('table tbody tr').first();
  await orderRow.click({ force: true }).catch(() => {});
  await page.waitForTimeout(1500);
  await snap('10-orders-drawer', { full: false });
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
} catch (e) {
  console.log('  drawer failed:', e.message);
}

// ════════════════════════════════════════════════════════════════════
// 5. CUSTOMERS
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 5. CUSTOMERS ===');
await page.goto(`${POS}/customers`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await snap('11-customers-list');
await noteAndSnap('12-customers-annotated', [
  { selector: 'input[placeholder*="Поиск"]', label: 'Поиск по ФИО, телефону', emphasis: true },
  { text: 'Открыть', tag: 'button', label: 'Открыть карточку клиента' },
], { full: false });

// Open first customer
try {
  await page.locator('a[href^="/customers/"]').first().click();
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(3500);
  await snap('13-customer-detail', { full: true });
} catch (e) {
  console.log('  customer detail failed:', e.message);
}

// ════════════════════════════════════════════════════════════════════
// 6. EXPENSES
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 6. EXPENSES ===');
await page.goto(`${POS}/expenses`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await snap('14-expenses');
await noteAndSnap('15-expenses-annotated', [
  { selector: 'input[type="date"]', label: 'Дата расхода (по умолчанию — сегодня)' },
  { selector: 'select', label: 'Тип расхода: Дорога / Промоутер / Питание / Расходники' },
  { selector: 'input[placeholder*="250"]', label: 'Сумма в сомах' },
  { selector: 'input[placeholder*="ордой"]', label: 'Откуда ехал (только для «Дорога»)' },
  { selector: 'input[placeholder*="окулук"]', label: 'Куда ехал' },
  { selector: 'textarea, input[placeholder*="ратко"]', label: 'Комментарий (необязательно)' },
  { text: 'Сохранить расход', tag: 'button', label: 'Сохранить', emphasis: true },
], { full: false });

// ════════════════════════════════════════════════════════════════════
// 7. CONSUMABLES
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 7. CONSUMABLES ===');
await page.goto(`${POS}/pos/consumables`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await snap('16-consumables');
await noteAndSnap('17-consumables-annotated', [
  { text: 'Пакеты', tag: 'div', label: 'Категория расходника' },
  { text: 'Футляры', tag: 'div', label: 'Каждая категория считается отдельно' },
  { text: 'Платочки', tag: 'div', label: 'Если запас < порога → красный «Критично»' },
  { text: 'Премиум-набор', tag: 'div', label: 'Премиум-набор для дорогих заказов' },
  { text: 'Обновить', tag: 'button', label: 'Обновить данные после пересчёта', emphasis: true },
], { mode: 'compact', legendTitle: 'Учёт расходников',
   legendAnchor: { text: 'График пересчёта', tag: 'div', placement: 'below' } });

// ════════════════════════════════════════════════════════════════════
// 8. LENS WAREHOUSE
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 8. LENS WAREHOUSE ===');
await page.goto(`${POS}/pos/lens-warehouse`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await snap('18-lens-warehouse');

// Click on different lens type
try {
  await page.locator('text=Защита от экранов').first().click();
  await page.waitForTimeout(1500);
  await snap('19-lens-warehouse-screen', { full: true });
} catch {}

// ════════════════════════════════════════════════════════════════════
// 9. WHATSAPP & INSTAGRAM
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 9. WHATSAPP / INSTAGRAM ===');
await page.goto(`${POS}/whatsapp`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await snap('20-whatsapp-list', { full: true });

// open first conversation if exists
try {
  const conv = page.locator('[role="button"], button, a').filter({ hasText: /\+\d|\+996|\+7/ }).first();
  if (await conv.count()) {
    await conv.click();
    await page.waitForTimeout(2000);
    await snap('21-whatsapp-conversation', { full: false });
  }
} catch {}

await page.goto(`${POS}/instagram`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await snap('22-instagram', { full: true });

// ════════════════════════════════════════════════════════════════════
// 10. CLOSE SHIFT (only show confirmation, don't actually close)
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 10. CLOSE SHIFT CONFIRMATION ===');
await page.goto(`${POS}/my-shift`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
try {
  const closeBtn = page.locator('button:has-text("Выключить")').first();
  await closeBtn.click();
  await page.waitForTimeout(1500);
  await snap('23-close-shift-confirm', { full: false });
} catch (e) {
  console.log('  close confirm failed:', e.message);
}

await browser.close();
console.log('\n=== Done ===');
console.log(`All screenshots in: ${OUT}`);
