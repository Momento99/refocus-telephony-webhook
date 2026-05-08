// Annotate the 4 expanded new-order sections.

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
  {
    file: '07a-new-order-frame-annotated',
    legendTitle: 'Шаг 2. Оправа',
    expandIdx: 0,
    items: [
      { selector: 'input[placeholder*="FR"]', label: 'SKU или штрих-код оправы (можно сканером)', emphasis: true },
      { text: 'ЦЕНА ОПРАВЫ', tag: 'div', label: 'Цена оправы — подставляется автоматически из штрих-кода' },
      { text: 'ОПРАВА (СПИСОК, ОПЦИОНАЛЬНО)', tag: 'div', label: 'Если штрих-код потерян — выбор оправы из списка' },
      { text: 'Назад', tag: 'button', label: 'Вернуться к клиенту' },
      { text: 'Далее: Линзы', tag: 'button', label: 'Перейти к выбору линз', emphasis: true },
    ],
  },
  {
    file: '07b-new-order-lenses-annotated',
    legendTitle: 'Шаг 3. Линзы',
    expandIdx: 1,
    items: [
      { text: 'Правый глаз (OD)', tag: 'div', label: 'Параметры правого глаза (OD)' },
      { text: 'Левый глаз (OS)', tag: 'div', label: 'Параметры левого глаза (OS)' },
      { text: 'Не выбрана линза', tag: 'div', label: 'Тип линзы из каталога (антиблик/защита от экранов и т.д.)' },
      { text: 'Плюс', tag: 'label', label: 'Знак: «+» если дальнозоркость' },
      { text: 'Минус', tag: 'label', label: 'Знак: «−» если близорукость' },
      { text: 'Сначала выберите знак', tag: 'div', label: 'Диоптрия — выбирается после знака' },
      { text: 'Контактные линзы и раствор', tag: 'div', label: 'Опционально: добавить КЛ к заказу' },
      { text: 'Далее: Оплата', tag: 'button', label: 'Перейти к оплате', emphasis: true },
    ],
  },
  {
    file: '07c-new-order-payment-annotated',
    legendTitle: 'Шаг 4. Оплата',
    expandIdx: 2,
    items: [
      { text: 'МЕТОД #1', tag: 'div', label: 'Способ платежа: Наличные / Карта / QR-код' },
      { text: 'СУММА, С', tag: 'div', label: 'Сумма платежа в сомах' },
      { text: '+ Добавить платёж', tag: 'button', label: 'Если клиент платит частями разными способами' },
      { text: 'Назад', tag: 'button', label: 'Вернуться к линзам' },
      { text: 'Создать заказ', tag: 'button', label: 'Создать заказ и сохранить платёж', emphasis: true },
    ],
  },
  {
    file: '07d-new-order-refund-annotated',
    legendTitle: 'Шаг 5. Возврат / Отмена (если что-то пошло не так)',
    expandIdx: 3,
    items: [
      { text: 'СУММА ВОЗВРАТА, С', tag: 'div', label: 'Сколько возвращаем клиенту' },
      { text: 'МЕТОД', tag: 'div', label: 'Как возвращаем (Наличные / Карта)' },
      { text: 'ПРИЧИНА', tag: 'div', label: 'Почему вернули (для аналитики)' },
      { text: 'КОММЕНТАРИЙ (ОПЦ.)', tag: 'div', label: 'Свободный комментарий' },
      { text: 'ШТРИХ-КОД ЦЕННИКА ОПРАВЫ', tag: 'div', label: 'Для возврата оправы на склад (unsell)' },
      { text: 'Зафиксировать возврат', tag: 'button', label: 'Сохранить возврат', emphasis: true },
      { text: 'Отмена', tag: 'button', label: 'Закрыть без сохранения' },
    ],
  },
];

for (const sec of sections) {
  console.log(`Snap ${sec.file}…`);
  await page.goto(`${POS}/new-order`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const expanders = page.locator('text=РАЗВЕРНУТЬ');
  if (sec.expandIdx < await expanders.count()) {
    await expanders.nth(sec.expandIdx).click({ force: true });
    await page.waitForTimeout(1500);
  }

  await addAnnotations(page, sec.items, {
    mode: 'compact',
    legendTitle: sec.legendTitle,
    legendAnchor: { text: 'Создать заказ', tag: 'button', placement: 'below' },
  });
  await page.screenshot({ path: path.join(OUT, `${sec.file}.png`), fullPage: true });
  await clearAnnotations(page);
  console.log(`  ✓ ${sec.file}`);
}

await browser.close();
console.log('Done');
