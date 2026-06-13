// Памятка мастеру (Сокулук): аннотированные скрины + печатный PDF.
// Снимает РЕАЛЬНЫЙ экран запущенного POS (localhost:3001, dev-сервер отдаёт рабочую копию,
// поэтому новый экран мастера тоже попадает в кадр). Аннотации — из annotate.mjs.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addAnnotations, clearAnnotations } from './annotate.mjs';

const POS = 'http://localhost:3001';
const OUT = path.join(os.homedir(), 'OneDrive', 'Рабочий стол', 'Памятка мастеру');
const VIEWPORT = { width: 1280, height: 1000 };

await fs.mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  locale: 'ru-RU',
  timezoneId: 'Asia/Bishkek',
});
await ctx.addInitScript(() => { try { localStorage.setItem('pos_terminal_code', 'SK-01'); } catch {} });

const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.on('pageerror', e => console.log('  pageerror:', String(e.message).slice(0, 100)));

// ── 01. Вход в кассу (логин филиала) ──────────────────────────────
console.log('01 — вход в кассу');
await page.goto(`${POS}/pos/login`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[placeholder="gulzat"]', { timeout: 90000 });
await page.waitForTimeout(1500);
await page.fill('input[placeholder="gulzat"]', 'master');
await page.fill('input[type="password"]', '1905');
await page.waitForTimeout(600);
await addAnnotations(page, [
  { selector: 'input[placeholder="gulzat"]', label: 'Логин: master', placement: 'right' },
  { selector: 'input[type="password"]', label: 'PIN филиала: 1905', placement: 'right', emphasis: true },
  { selector: 'input[readonly]', label: 'Терминал SK-01 — определится сам', placement: 'left' },
  { text: 'Войти и открыть смену', tag: 'button', label: 'Нажмите «Войти и открыть смену»', placement: 'top', emphasis: true },
]);
await page.screenshot({ path: path.join(OUT, '01-вход-в-кассу.png'), fullPage: false });
await clearAnnotations(page);

// ── Войти в филиал (master/1905) → попадаем на «Моя смена» ──
await Promise.all([
  page.waitForURL('**/my-shift', { timeout: 60000 }),
  page.click('button[type="submit"]'),
]);
await page.waitForSelector('input[placeholder="login"]', { timeout: 90000 });
await page.waitForTimeout(8000); // дать прогрузить сессии + состояние мастера

// ── 02. «Моя смена» — вход по личному PIN ─────────────────────────
console.log('02 — моя смена: вход');
await page.fill('input[placeholder="login"]', 'master');
await page.fill('input[type="password"]', '1904');
await page.waitForTimeout(500);
await addAnnotations(page, [
  { selector: 'input[placeholder="login"]', label: 'Логин: master', placement: 'right' },
  { selector: 'input[type="password"]', label: 'PIN: 1904 (личный)', placement: 'right', emphasis: true },
  { text: 'Открыть', tag: 'button', label: 'Нажмите «Открыть»', placement: 'right', emphasis: true },
]);
await page.screenshot({ path: path.join(OUT, '02-моя-смена-вход.png'), fullPage: false });
await clearAnnotations(page);

// ── 03. Карточка мастера: цель + ввод + закрытие ──────────────────
console.log('03 — карточка мастера');
const card = page.locator('text=Сегодня нужно собрать').first();
await card.waitFor({ timeout: 30000 }).catch(() => console.log('  ! карточка мастера не найдена'));
await card.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(800);
await addAnnotations(page, [
  { text: 'Сегодня нужно собрать', tag: 'div', label: 'Сколько пар нужно собрать за ночь', placement: 'left' },
  { text: 'Собрал очков', tag: 'div', label: 'Укажите, сколько собрали: «+» / «−» или впишите число', placement: 'left' },
  { text: 'Сохранить и закрыть', tag: 'button', label: 'В конце смены — «Сохранить и закрыть»', placement: 'left', emphasis: true },
]);
await page.screenshot({ path: path.join(OUT, '03-карта-мастера.png'), fullPage: false });
await clearAnnotations(page);

// ── PDF одностраничной памятки ────────────────────────────────────
console.log('PDF');
const files = ['01-вход-в-кассу.png', '02-моя-смена-вход.png', '03-карта-мастера.png'];
const b64 = {};
for (const f of files) b64[f] = (await fs.readFile(path.join(OUT, f))).toString('base64');

const steps = [
  { t: 'Шаг 1. Вход в кассу', d: 'Включите кассу, подождите 1–2 мин. На экране «Вход в кассу» введите логин <b>master</b> и <b>PIN филиала 1905</b>, нажмите «Войти и открыть смену».', img: files[0] },
  { t: 'Шаг 2. Страница «Моя смена»', d: 'Введите логин <b>master</b> и <b>ваш личный PIN 1904</b>, нажмите «Открыть».', img: files[1] },
  { t: 'Шаг 3. Работа и закрытие', d: 'Сверху видно, сколько очков нужно собрать. По мере работы укажите в поле «Собрал очков» (кнопки «+»/«−» или вписать). В конце нажмите «Сохранить и закрыть».', img: files[2] },
];

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; font-family: 'Segoe UI', system-ui, sans-serif; }
  body { margin: 0; color: #0f172a; }
  .hd { background: linear-gradient(135deg,#06b6d4,#1e40af); color:#fff; padding:18px 22px; border-radius:14px; }
  .hd h1 { margin:0; font-size:22px; }
  .hd p { margin:4px 0 0; font-size:13px; opacity:.9; }
  .pins { display:flex; gap:10px; margin:14px 0; }
  .pin { flex:1; background:#f1f5f9; border:1px solid #e2e8f0; border-radius:12px; padding:10px 14px; }
  .pin b { font-size:18px; } .pin span{ font-size:12px; color:#475569; }
  .step { margin-top:16px; page-break-inside:avoid; }
  .step h2 { font-size:15px; margin:0 0 4px; color:#0e7490; }
  .step p { font-size:13px; margin:0 0 8px; line-height:1.4; }
  .step img { width:100%; border:1px solid #e2e8f0; border-radius:10px; }
  .pay { margin-top:14px; background:#ecfeff; border:1px solid #a5f3fc; border-radius:12px; padding:10px 14px; font-size:13px; }
</style></head><body>
  <div class="hd"><h1>Памятка мастеру — Кудрет (Сокулук)</h1><p>Как открыть смену на кассе и записать собранные очки</p></div>
  <div class="pins">
    <div class="pin"><span>Вход в кассу</span><br><b>master / 1905</b><br><span>1905 — общий PIN филиала</span></div>
    <div class="pin"><span>Страница «Моя смена»</span><br><b>master / 1904</b><br><span>1904 — ваш личный PIN</span></div>
  </div>
  ${steps.map(s => `<div class="step"><h2>${s.t}</h2><p>${s.d}</p><img src="data:image/png;base64,${b64[s.img]}"></div>`).join('')}
  <div class="pay"><b>Оплата:</b> 150 сом за каждые собранные очки, выплата раз в неделю. Приходить можно в любое время вечером — главное закрыть все очки до утра.</div>
</body></html>`;

const pdfPage = await ctx.newPage();
await pdfPage.setContent(html, { waitUntil: 'networkidle' });
await pdfPage.pdf({
  path: path.join(OUT, 'Памятка-мастер.pdf'),
  format: 'A4',
  printBackground: true,
  margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
});

await browser.close();
console.log('Готово →', OUT);
