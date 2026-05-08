// Demo: 3 annotated screenshots to show user the style.
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

// ── Demo 1: Login screen with all 4 annotated steps ──────────────────────────
console.log('Demo 1: login');
await page.goto(`${POS}/pos/login`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await page.fill('input[placeholder="gulzat"]', 'elida');
await page.fill('input[type="password"]', '1958');
await page.waitForTimeout(400);
await addAnnotations(page, [
  { selector: 'input[placeholder="gulzat"]', label: 'Логин сотрудника', placement: 'right' },
  { selector: 'input[type="password"]', label: 'PIN филиала (4 цифры)', placement: 'right' },
  { selector: 'input[readonly]', label: 'Код терминала — определяется автоматически', placement: 'left' },
  { selector: 'button[type="submit"]', label: 'Нажать «Войти и открыть смену»', placement: 'right', emphasis: true },
]);
await page.screenshot({ path: path.join(OUT, 'demo-01-login-annotated.png') });
await clearAnnotations(page);

// Login for further demos
await Promise.all([
  page.waitForURL('**/my-shift', { timeout: 15000 }),
  page.click('button[type="submit"]'),
]);
await page.waitForTimeout(6000);

// ── Demo 2: My shift with key elements ──────────────────────────────────────
console.log('Demo 2: my-shift');
await addAnnotations(page, [
  { selector: 'a[href="/new-order"]', label: 'Новый заказ', placement: 'bottom', emphasis: true },
  { selector: 'a[href="/my-shift"]', label: 'План и зарплата', placement: 'bottom' },
  { text: 'Выключить', tag: 'button', label: 'Закрыть смену', placement: 'bottom' },
]);
await page.screenshot({ path: path.join(OUT, 'demo-02-my-shift-annotated.png') });
await clearAnnotations(page);

// ── Demo 3: New order — key sections ────────────────────────────────────────
console.log('Demo 3: new-order');
await page.goto(`${POS}/new-order`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await addAnnotations(page, [
  { selector: 'input[value="BV-01"]', label: 'Филиал — заполнен автоматически' },
  { selector: 'input[placeholder="Иванов"]', label: 'Фамилия клиента' },
  { selector: 'input[placeholder="Алексей"]', label: 'Имя клиента' },
  { selector: 'input[placeholder="ДД.ММ.ГГГГ"]', label: 'Дата рождения (ДД.ММ.ГГГГ)' },
  { text: 'М', tag: 'label', label: 'Пол: выбрать М или Ж' },
  { selector: 'input[placeholder="+996"]', label: 'Телефон клиента — впиши и система найдёт его сама', emphasis: true },
  { text: 'Найти', tag: 'button', label: 'Если не нашёлся автоматически — нажать «Найти»' },
  { text: 'Приложение', tag: 'div', label: 'Уведомить клиента push-сообщением (по умолчанию)' },
  { text: 'WhatsApp', tag: 'div', label: 'Уведомить через WhatsApp' },
  { text: 'Звонок', tag: 'div', label: 'Продавец позвонит сам' },
  { text: 'Далее: Оправа', tag: 'button', label: 'После клиента — переход к выбору оправы', emphasis: true },
], {
  mode: 'compact',
  legendTitle: 'Шаг 1. Клиент и филиал',
  // Place legend below the "Создать заказ" button (right column, below the predvar card)
  legendAnchor: { text: 'Создать заказ', tag: 'button', placement: 'below' },
});
await page.screenshot({ path: path.join(OUT, 'demo-03-new-order-annotated.png'), fullPage: false });
await clearAnnotations(page);

await browser.close();
console.log('Done — 3 annotated demos in', OUT);
