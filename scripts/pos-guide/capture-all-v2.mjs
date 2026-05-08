// Robust POS screenshot tour v2.
// • Re-logs in / refreshes session before every scenario
// • Detects "broken state" (no terminal chip / "Нет доступа") and retries
// • Captures real modals (PayModal, DetailsDrawer, close-shift confirmation)
// • Fixes legend placement so nothing covers content

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { addAnnotations, clearAnnotations } from './annotate.mjs';

const POS = 'http://localhost:3001';
const OUT = path.resolve('docs/pos-screenshots');
const VIEWPORT = { width: 1440, height: 900 };

await fs.mkdir(OUT, { recursive: true });

// Wipe previous run so the gallery is clean
const existing = await fs.readdir(OUT);
for (const f of existing) {
  if (f.startsWith('demo-')) continue;            // keep demos
  if (!/^(0[0-9]|[12][0-9])-/.test(f)) continue;  // only numbered screenshots
  await fs.unlink(path.join(OUT, f));
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  locale: 'ru-RU',
  timezoneId: 'Asia/Bishkek',
});
await ctx.addInitScript(() => {
  try { localStorage.setItem('pos_terminal_code', 'BV-01'); } catch {}
});

const page = await ctx.newPage();
page.setDefaultTimeout(30000);
page.on('pageerror', e => console.log('  pageerror:', e.message.slice(0, 80)));

async function snap(name, opts = {}) {
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  if (opts.delay) await page.waitForTimeout(opts.delay);
  await page.screenshot({
    path: path.join(OUT, `${name}.png`),
    fullPage: opts.full !== false,
    clip: opts.clip,
  });
  console.log('  ✓', name);
}
async function noteAndSnap(name, items, opts = {}) {
  if (opts.delay) await page.waitForTimeout(opts.delay);
  await addAnnotations(page, items, opts);
  await page.screenshot({
    path: path.join(OUT, `${name}.png`),
    fullPage: opts.full !== false,
    clip: opts.clip,
  });
  await clearAnnotations(page);
  console.log('  ✓', name, '(annotated)');
}

async function freshLogin() {
  await page.goto(`${POS}/pos/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.fill('input[placeholder="gulzat"]', 'elida');
  await page.fill('input[type="password"]', '1958');
  await Promise.all([
    page.waitForURL('**/my-shift', { timeout: 20000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(5000); // let my-shift establish session/cookie/branch config
}

async function isBroken() {
  return await page.evaluate(() => {
    const t = document.body.textContent || '';
    return t.includes('Нет доступа к')
        || t.includes('Не определён терминал')
        || t.includes('Сессия не активна');
  });
}

async function gotoSafe(url, opts = {}) {
  // Make sure my-shift was visited recently to keep session warm
  if (!page.url().endsWith('/my-shift') && !page.url().endsWith('/pos/login')) {
    await page.goto(`${POS}/my-shift`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  }
  await page.goto(`${POS}${url}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(opts.delay || 2500);

  if (await isBroken()) {
    console.log(`  🔁 ${url} broken, re-login`);
    await freshLogin();
    await page.goto(`${POS}${url}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(opts.delay || 2500);
  }
}

// ════════════════════════════════════════════════════════════════════
// 01-02. LOGIN
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 01-02. LOGIN ===');
await page.goto(`${POS}/pos/login`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
await snap('01-login-empty', { full: false });

await page.fill('input[placeholder="gulzat"]', 'elida');
await page.fill('input[type="password"]', '1958');
await page.waitForTimeout(400);
await noteAndSnap('02-login-annotated', [
  { selector: 'input[placeholder="gulzat"]', label: 'Логин сотрудника', placement: 'right' },
  { selector: 'input[type="password"]', label: 'PIN филиала (4 цифры)', placement: 'right' },
  { selector: 'input[readonly]', label: 'Терминал — определяется автоматически', placement: 'left' },
  { text: 'Войти и открыть смену', tag: 'button', label: 'Нажать «Войти и открыть смену»', placement: 'right', emphasis: true },
], { full: false });

// Submit and land on my-shift
await Promise.all([
  page.waitForURL('**/my-shift', { timeout: 20000 }),
  page.click('button[type="submit"]'),
]);
await page.waitForTimeout(5000);

// ════════════════════════════════════════════════════════════════════
// 03-04. MY SHIFT
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 03-04. MY SHIFT ===');
await snap('03-my-shift-overview');
await noteAndSnap('04-my-shift-annotated', [
  { selector: 'a[href="/new-order"]', label: 'Создать новый заказ', emphasis: true },
  { selector: 'a[href="/orders"]', label: 'Список заказов и оплат' },
  { selector: 'a[href="/customers"]', label: 'База клиентов' },
  { selector: 'a[href="/expenses"]', label: 'Расходы дня (дорога, питание)' },
  { selector: 'a[href="/pos/consumables"]', label: 'Учёт расходников (пакеты, футляры)' },
  { selector: 'a[href="/pos/lens-warehouse"]', label: 'Склад линз (просмотр)' },
  { selector: 'a[href="/my-shift"]', label: 'Моя смена и зарплата (текущий экран)' },
  { selector: 'a[href="/whatsapp"]', label: 'Переписки в WhatsApp' },
  { selector: 'a[href="/instagram"]', label: 'Переписки в Instagram' },
  { text: 'Выключить', tag: 'button', label: 'Закрыть смену в конце дня', emphasis: true },
], {
  mode: 'compact',
  legendTitle: 'Меню кассы — что где',
  // place legend in lower-right area below the breakdown
  legendAnchor: { x: 1080, y: 480 },
  full: false,
});

// ════════════════════════════════════════════════════════════════════
// 05-06. NEW ORDER (sections walkthrough)
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 05-06. NEW ORDER ===');
await gotoSafe('/new-order', { delay: 3000 });
await snap('05-new-order-overview');

await noteAndSnap('06-new-order-client-annotated', [
  { selector: 'input[value="BV-01"]', label: 'Филиал — заполнен автоматически' },
  { selector: 'input[placeholder="Иванов"]', label: 'Фамилия клиента' },
  { selector: 'input[placeholder="Алексей"]', label: 'Имя клиента' },
  { selector: 'input[placeholder="ДД.ММ.ГГГГ"]', label: 'Дата рождения (ДД.ММ.ГГГГ)' },
  { text: 'М', tag: 'label', label: 'Пол клиента: М или Ж' },
  { selector: 'input[placeholder="+996"]', label: 'Телефон клиента — авто-поиск', emphasis: true },
  { text: 'Найти', tag: 'button', label: 'Найти клиента руками' },
  { text: 'Приложение', tag: 'div', label: 'Уведомить через push (по умолчанию)' },
  { text: 'WhatsApp', tag: 'div', label: 'Уведомить через WhatsApp' },
  { text: 'Звонок', tag: 'div', label: 'Продавец позвонит сам' },
  { text: 'Далее: Оправа', tag: 'button', label: 'Перейти к выбору оправы', emphasis: true },
], {
  mode: 'compact',
  legendTitle: 'Шаг 1. Клиент и филиал',
  legendAnchor: { text: 'Создать заказ', tag: 'button', placement: 'below' },
});

// Expand "Оправа" section
try {
  const opravaRow = page.locator('text=Оправа').first().locator('xpath=ancestor::div[1]');
  await opravaRow.click().catch(() => {});
  await page.waitForTimeout(800);
} catch {}

// Expand all remaining sections by clicking РАЗВЕРНУТЬ
for (let i = 0; i < 4; i++) {
  const btn = page.locator('text=РАЗВЕРНУТЬ').first();
  if (await btn.count()) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(700);
  }
}
await page.waitForTimeout(1500);
await snap('07-new-order-all-sections', { full: true });

// ════════════════════════════════════════════════════════════════════
// 08-10. ORDERS (list + drawer + pay modal)
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 08-10. ORDERS ===');
await gotoSafe('/orders', { delay: 3000 });
await snap('08-orders-list');

await noteAndSnap('09-orders-annotated', [
  { selector: 'input[placeholder*="Поиск"]', label: 'Поиск по № заказа, ФИО, телефону', emphasis: true },
  { text: 'Кому позвонить', tag: 'button', label: 'Список клиентов на обзвон' },
  { text: 'Сбросить', tag: 'button', label: 'Сбросить фильтры/поиск' },
  { text: 'Обновить', tag: 'button', label: 'Перезагрузить список' },
], {
  mode: 'compact',
  legendTitle: 'Заказы и оплаты',
  legendAnchor: { x: 16, y: 720 }, // bottom-left empty area
  full: false,
});

// 10. Drawer — click first row
try {
  const row = page.locator('table tbody tr').first();
  if (await row.count()) {
    await row.click({ force: true });
    await page.waitForTimeout(2000);
    await snap('10-orders-drawer', { full: false });
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(800);
  }
} catch (e) {
  console.log('  drawer failed:', e.message);
}

// 11. PayModal — click "Оплата" on first row that has a debt
try {
  await page.waitForTimeout(800);
  const payBtn = page.locator('button:has-text("Оплата")').first();
  if (await payBtn.count()) {
    await payBtn.click();
    await page.waitForTimeout(2000);
    await snap('11-orders-pay-modal', { full: false });
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
  } else {
    console.log('  no Оплата button visible');
  }
} catch (e) {
  console.log('  pay modal failed:', e.message);
}

// ════════════════════════════════════════════════════════════════════
// 12-13. CUSTOMERS
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 12-13. CUSTOMERS ===');
await gotoSafe('/customers', { delay: 2500 });
await snap('12-customers-list');

await noteAndSnap('13-customers-annotated', [
  { selector: 'input[placeholder*="Поиск"]', label: 'Поиск по ФИО или телефону', emphasis: true },
  { text: 'Открыть', tag: 'button', label: 'Открыть карточку клиента' },
], { full: false });

try {
  await page.locator('a[href^="/customers/"]').first().click();
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await snap('14-customer-detail', { full: true });
} catch (e) { console.log('  customer detail failed:', e.message); }

// ════════════════════════════════════════════════════════════════════
// 15-16. EXPENSES
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 15-16. EXPENSES ===');
await gotoSafe('/expenses', { delay: 2500 });
await snap('15-expenses');
await noteAndSnap('16-expenses-annotated', [
  { selector: 'input[type="date"]', label: 'Дата расхода (по умолч. сегодня)' },
  { selector: 'select', label: 'Тип: Дорога / Промоутер / Питание / Расходники' },
  { selector: 'input[placeholder*="250"]', label: 'Сумма в сомах' },
  { selector: 'input[placeholder*="ордой"]', label: 'Откуда (только для «Дорога»)' },
  { selector: 'input[placeholder*="окулук"]', label: 'Куда (только для «Дорога»)' },
  { text: 'Сохранить расход', tag: 'button', label: 'Сохранить', emphasis: true },
], {
  mode: 'compact',
  legendTitle: 'Расходы дня',
  legendAnchor: { x: 16, y: 720 },
  full: false,
});

// ════════════════════════════════════════════════════════════════════
// 17-18. CONSUMABLES
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 17-18. CONSUMABLES ===');
await gotoSafe('/pos/consumables', { delay: 2500 });
await snap('17-consumables');
await noteAndSnap('18-consumables-annotated', [
  { text: 'Пакеты', tag: 'div', label: 'Категория: пакеты' },
  { text: 'Футляры', tag: 'div', label: 'Категория: футляры' },
  { text: 'Платочки', tag: 'div', label: 'Категория: платочки' },
  { text: 'Премиум-набор', tag: 'div', label: 'Премиум-набор для дорогих заказов' },
  { text: 'Обновить', tag: 'button', label: 'Обновить список после пересчёта', emphasis: true },
], {
  mode: 'compact',
  legendTitle: 'Расходники — пересчёт по субботам',
  legendAnchor: { x: 16, y: 720 },
  full: false,
});

// ════════════════════════════════════════════════════════════════════
// 19-20. LENS WAREHOUSE
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 19-20. LENS WAREHOUSE ===');
await gotoSafe('/pos/lens-warehouse', { delay: 3000 });
await snap('19-lens-warehouse');
await noteAndSnap('20-lens-warehouse-annotated', [
  { text: 'Антиблик', tag: 'div', label: 'Активный вид линзы (выбран)', emphasis: true },
  { text: 'Защита от экранов', tag: 'div', label: 'Кликни — увидишь остатки этой линзы' },
  { text: 'Хамелеон', tag: 'div', label: 'Хамелеоны 4 цветов' },
  { text: 'В пути', tag: 'button', label: 'Партии в пути от поставщика' },
  { text: 'Приёмка', tag: 'button', label: 'Партии на приёмке' },
  { text: 'Зачислено', tag: 'button', label: 'Принятые партии за период' },
], {
  mode: 'compact',
  legendTitle: 'Склад линз — режим просмотра',
  legendAnchor: { x: 16, y: 740 },
  full: false,
});

// ════════════════════════════════════════════════════════════════════
// 21-22. WHATSAPP
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 21-22. WHATSAPP ===');
await gotoSafe('/whatsapp', { delay: 3000 });
await snap('21-whatsapp-list');

// open first conversation
try {
  const conv = page.locator('button, [role="button"], a').filter({ hasText: /996|\+7/ }).first();
  if (await conv.count()) {
    await conv.click();
    await page.waitForTimeout(2500);
    await snap('22-whatsapp-conversation', { full: false });
  }
} catch (e) { console.log('  WA convo failed:', e.message); }

// ════════════════════════════════════════════════════════════════════
// 23. INSTAGRAM
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 23. INSTAGRAM ===');
await gotoSafe('/instagram', { delay: 3000 });
await snap('23-instagram');

// ════════════════════════════════════════════════════════════════════
// 24. CLOSE SHIFT — explain via annotation (button is disabled in browser)
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 24. CLOSE SHIFT ===');
await gotoSafe('/my-shift', { delay: 3000 });
await noteAndSnap('24-close-shift-annotated', [
  { text: 'Выключить', tag: 'button', label: 'В конце смены: жми «Выключить» → касса попросит подтверждение, закроет смену и выключится', emphasis: true, placement: 'left' },
], { full: false });

await browser.close();
console.log('\n=== Done ===');
console.log(`All screenshots in: ${OUT}`);
