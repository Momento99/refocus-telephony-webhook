// Refocus Brand Guidelines — полный HTML брендбука для генерации PDF через Puppeteer.
// Используется в /api/brandbook/export-pdf.
//
// Архитектура: каждая <section class="page"> — отдельный лист A4 (210×297mm).
// Все ассеты передаются как base64 data URIs из endpoint'а, чтобы HTML был самодостаточным.

export interface BrandbookAssets {
  /** Чёрный знак (RE) — для светлых фонов */
  logoBlack: string;
  /** Белый знак (RE) — для тёмных фонов */
  logoWhite: string;
  /** Референс-фотографии интерьера точки (1-6) */
  refs: string[];
  /** Брендовый шрифт pavelt-jrjpm как base64 ttf */
  brandFontDataUri: string;

  /** Полные композиции логотипа: знак + wordmark рядом */
  lockupBlack: string;
  lockupWhite: string;
  /** Wordmark отдельно (только текст REFOCUS) */
  wordmarkBlack: string;
  wordmarkWhite: string;
  /** Палитра официальная (плакат) */
  palette: string;

  /** Скрины мобильного приложения */
  app: {
    lens1: string;
    lens2: string;
    orderStage: string;
    orderBag: string;
    screen3: string;
    screen5: string;
  };

  /** Упаковка — стандарт и премиум */
  pack: {
    glasses: string;
    bagStandard: string;
    bagPremium: string;
    caseNavy: string;
    caseCyan: string;
    casesTwo: string;
    casePremium: string;
    clothStandard: string;
    clothPremium: string;
    clothBox: string;
    boxPremium: string;
    premiumSet: string;
  };
}

export function buildBrandbookHtml(a: BrandbookAssets): string {
  const today = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Refocus Brand Guidelines</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  @font-face {
    font-family: 'RefocusBrand';
    src: url('${a.brandFontDataUri}') format('truetype');
    font-weight: 400;
    font-style: normal;
    font-display: block;
  }

  :root {
    --cyan: #22D3EE;
    --cyan-deep: #06B6D4;
    --teal: #14B8A6;
    --sky-blue: #38BDF8;
    --slate-900: #0F172A;
    --slate-800: #1E293B;
    --slate-700: #334155;
    --slate-600: #475569;
    --slate-500: #64748B;
    --slate-400: #94A3B8;
    --slate-300: #CBD5E1;
    --slate-200: #E2E8F0;
    --slate-100: #F1F5F9;
    --slate-50: #F8FAFC;
    --sky-100: #E0F2FE;
    --sky-50:  #F0F9FF;
    --emerald: #10B981;
    --rose:    #F43F5E;
    --amber:   #F59E0B;
    --violet:  #8B5CF6;
  }

  @page { size: 210mm 297mm; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: white; }
  /* Автоматический CSS-counter для номеров страниц в footer */
  body { counter-reset: pagenum; }
  .page { counter-increment: pagenum; }
  .pf-num::before { content: counter(pagenum, decimal-leading-zero); }
  body {
    font-family: 'Manrope', system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--slate-900);
    font-size: 10.5pt;
    line-height: 1.5;
    letter-spacing: -0.01em;
    -webkit-font-smoothing: antialiased;
  }

  /* Каждый <section class="page"> — отдельная страница A4.
     box-sizing: border-box обязателен, чтобы padding включался в height: 297mm. */
  .page {
    position: relative;
    box-sizing: border-box;
    width: 210mm;
    height: 297mm;
    padding: 16mm 16mm 12mm;
    background: white;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
  }
  .page:last-child {
    page-break-after: auto;
    break-after: auto;
  }

  /* ── Page chrome (header + footer) ─────────────────────────────── */
  .ph {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 4mm;
    margin-bottom: 8mm;
    border-bottom: 0.4pt solid var(--slate-100);
  }
  .ph-brand {
    font-family: 'RefocusBrand', 'Manrope', sans-serif;
    font-size: 14pt;
    line-height: 1;
    color: var(--slate-900);
    letter-spacing: 0.01em;
  }
  .ph-meta {
    font-size: 7.5pt;
    color: var(--slate-500);
    text-transform: uppercase;
    letter-spacing: 0.20em;
    font-weight: 600;
  }
  .pf {
    /* Не absolute — теперь часть flexbox потока .page.
       margin-top: auto выталкивает footer в самый низ страницы,
       независимо от объёма контента выше. */
    margin-top: auto;
    padding-top: 5mm;
    border-top: 0.4pt solid var(--slate-100);
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 7pt;
    color: var(--slate-400);
    letter-spacing: 0.04em;
  }
  .pf-num {
    font-weight: 700;
    color: var(--slate-600);
    font-feature-settings: "tnum";
  }

  /* ── Section big title ─────────────────────────────────────────── */
  .section-num {
    font-size: 8.5pt;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--cyan-deep);
    margin-bottom: 4mm;
  }
  .section-title {
    font-size: 28pt;
    font-weight: 800;
    line-height: 1.04;
    letter-spacing: -0.025em;
    color: var(--slate-900);
    margin: 0 0 6mm 0;
  }
  .section-lede {
    font-size: 11pt;
    line-height: 1.55;
    color: var(--slate-600);
    margin: 0 0 8mm 0;
    max-width: 150mm;
  }

  /* ── Brand gradient strip ──────────────────────────────────────── */
  .brand-rule {
    height: 4pt;
    width: 64mm;
    border-radius: 2pt;
    background: linear-gradient(90deg, #14B8A6 0%, #22D3EE 55%, #38BDF8 100%);
    margin-bottom: 6mm;
  }
  .brand-rule.full { width: 100%; }

  /* ── Generic blocks ────────────────────────────────────────────── */
  h2.h2 { font-size: 16pt; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 4mm; color: var(--slate-900); }
  h3.h3 { font-size: 12.5pt; font-weight: 700; letter-spacing: -0.015em; margin: 0 0 2.5mm; color: var(--slate-900); }
  h4.h4 { font-size: 9.5pt; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; margin: 0 0 2mm; color: var(--cyan-deep); }
  p { margin: 0 0 3mm; color: var(--slate-700); font-size: 10pt; line-height: 1.55; }
  p.muted { color: var(--slate-500); }
  strong { color: var(--slate-900); font-weight: 700; }

  ul.bullets { margin: 0 0 4mm; padding-left: 5mm; list-style: none; }
  ul.bullets li { position: relative; padding-left: 6mm; margin: 1.5mm 0; font-size: 10pt; color: var(--slate-700); line-height: 1.5; }
  ul.bullets li::before { content: ''; position: absolute; left: 0; top: 2.5mm; width: 5pt; height: 5pt; border-radius: 50%; background: var(--cyan); }

  ul.checks li::before { background: var(--emerald); content: '✓'; color: white; font-size: 6pt; line-height: 5pt; text-align: center; font-weight: 800; }
  ul.crosses li::before { background: var(--rose); content: '×'; color: white; font-size: 7pt; line-height: 5pt; text-align: center; font-weight: 800; }

  /* ── Cards ─────────────────────────────────────────────────────── */
  .card {
    border: 1pt solid var(--slate-200);
    border-radius: 4mm;
    padding: 6mm;
    background: white;
  }
  .card.tinted { background: var(--sky-50); border-color: var(--sky-100); }
  .card.dark { background: var(--slate-900); color: white; border: none; }
  .card.dark p, .card.dark li { color: var(--slate-300); }
  .card.dark strong { color: white; }

  /* ── Color swatch ─────────────────────────────────────────────── */
  .swatch {
    border-radius: 4mm;
    overflow: hidden;
    border: 1pt solid var(--slate-200);
    display: flex;
    flex-direction: column;
  }
  .swatch-color { height: 38mm; }
  .swatch-info { padding: 4mm 5mm; background: white; }
  .swatch-name { font-size: 11pt; font-weight: 700; color: var(--slate-900); margin: 0; }
  .swatch-role { font-size: 8.5pt; color: var(--slate-500); margin: 1mm 0 3mm; }
  .swatch-codes { font-size: 7.5pt; color: var(--slate-600); line-height: 1.6; font-family: 'Courier New', monospace; }

  /* ── Type sample ──────────────────────────────────────────────── */
  .type-sample {
    border-bottom: 0.4pt solid var(--slate-100);
    padding: 3mm 0;
  }
  .type-sample-meta {
    font-size: 7.5pt;
    color: var(--slate-500);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-weight: 600;
    margin-bottom: 1mm;
  }

  /* ── Logo display ─────────────────────────────────────────────── */
  .logo-frame {
    border: 1pt solid var(--slate-200);
    border-radius: 4mm;
    padding: 8mm;
    display: flex;
    align-items: center;
    justify-content: center;
    background: white;
    overflow: hidden;
  }
  .logo-frame.dark   { background: var(--slate-900); border-color: var(--slate-800); }
  .logo-frame.cyan   { background: var(--cyan); border-color: var(--cyan); }
  .logo-frame.sky    { background: var(--sky-50); border-color: var(--sky-100); }
  .logo-frame img { max-width: 100%; max-height: 100%; }

  /* ── Page-specific styles ─────────────────────────────────────── */

  /* Cover */
  .cover {
    padding: 0;
    background: white;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .cover-grad-band {
    height: 12mm;
    background: linear-gradient(90deg, #14B8A6 0%, #22D3EE 55%, #38BDF8 100%);
  }
  .cover-body {
    flex: 1;
    padding: 24mm 24mm 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .cover-eyebrow {
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.30em;
    text-transform: uppercase;
    color: var(--cyan-deep);
    margin-bottom: 10mm;
  }
  .cover-wordmark {
    font-family: 'RefocusBrand', 'Manrope', sans-serif;
    font-size: 88pt;
    line-height: 0.9;
    letter-spacing: 0.005em;
    color: var(--slate-900);
    margin-bottom: 8mm;
    max-width: 100%;
    overflow: hidden;
  }
  /* Изображение-wordmark — фиксированная ширина, гарантировано не обрезается */
  .cover-wordmark-img {
    display: block;
    width: 150mm;
    height: auto;
    margin-bottom: 10mm;
  }
  .cover-title {
    font-size: 32pt;
    font-weight: 800;
    letter-spacing: -0.025em;
    line-height: 1.1;
    color: var(--slate-900);
    margin-bottom: 6mm;
  }
  .cover-subtitle {
    font-size: 13pt;
    color: var(--slate-600);
    max-width: 130mm;
    margin-bottom: 12mm;
  }
  .cover-foot {
    padding: 10mm 24mm 18mm;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    font-size: 8.5pt;
    color: var(--slate-500);
    border-top: 0.4pt solid var(--slate-100);
    padding-top: 8mm;
  }
  .cover-version {
    font-weight: 700;
    color: var(--slate-700);
    text-transform: uppercase;
    letter-spacing: 0.15em;
    font-size: 8.5pt;
  }

  /* Two-col / three-col grids */
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5mm; }
  .grid-4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 4mm; }
  .grid-6 { display: grid; grid-template-columns: repeat(6, 1fr); gap: 3mm; }

  /* Pull-quote */
  .pull {
    font-size: 16pt;
    font-weight: 600;
    line-height: 1.35;
    letter-spacing: -0.015em;
    color: var(--slate-900);
    border-left: 3pt solid var(--cyan);
    padding: 3mm 0 3mm 6mm;
    margin: 4mm 0 8mm;
  }
  .pull em { color: var(--cyan-deep); font-style: normal; }

  /* Stat block */
  .stat {
    font-size: 26pt;
    font-weight: 800;
    color: var(--cyan-deep);
    line-height: 1;
    margin-bottom: 1mm;
    letter-spacing: -0.02em;
  }
  .stat-label {
    font-size: 8pt;
    color: var(--slate-500);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-weight: 600;
  }

  /* ─── PAGE 14: Что нельзя — крест-накрест overlay ─── */
  .donts-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
  .donts-cell {
    position: relative;
    border: 1pt solid var(--slate-200);
    border-radius: 3mm;
    padding: 5mm;
    background: var(--slate-50);
    min-height: 38mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .donts-cell::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      linear-gradient(45deg,  transparent 49%, var(--rose) 49%, var(--rose) 51%, transparent 51%),
      linear-gradient(-45deg, transparent 49%, var(--rose) 49%, var(--rose) 51%, transparent 51%);
    opacity: 0.12;
    pointer-events: none;
  }
  .donts-cell .label { position: relative; font-size: 8.5pt; color: var(--slate-700); font-weight: 600; line-height: 1.35; }
  .donts-cell .x {
    position: absolute;
    top: 3mm; right: 3mm;
    width: 6mm; height: 6mm;
    border-radius: 50%;
    background: var(--rose);
    color: white;
    font-size: 8pt;
    font-weight: 800;
    display: flex; align-items: center; justify-content: center;
  }

  /* Tone table */
  .tone-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 2mm;
  }
  .tone-table th {
    text-align: left;
    font-size: 7.5pt;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--slate-500);
    font-weight: 700;
    padding: 3mm 4mm;
    border-bottom: 0.6pt solid var(--slate-200);
  }
  .tone-table td {
    padding: 4mm;
    font-size: 9pt;
    color: var(--slate-700);
    border-bottom: 0.4pt solid var(--slate-100);
    vertical-align: top;
    line-height: 1.5;
  }
  .tone-table .yes { color: var(--emerald); font-weight: 700; }
  .tone-table .no  { color: var(--rose);    font-weight: 700; }

  /* Photo gallery */
  .gallery-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
  .gallery-2 img { width: 100%; border-radius: 3mm; border: 1pt solid var(--slate-200); }
  .gallery-1 { width: 100%; }
  .gallery-1 img { width: 100%; border-radius: 4mm; border: 1pt solid var(--slate-200); }
  .gallery-cap { font-size: 7.5pt; color: var(--slate-500); margin-top: 1.5mm; letter-spacing: 0.05em; }

  /* Mockup card (visit/business card / packaging) */
  .mockup {
    background: var(--slate-100);
    border-radius: 3mm;
    padding: 6mm;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 50mm;
  }
  .mockup-bc {
    background: white;
    border-radius: 1.5mm;
    box-shadow: 0 2mm 6mm rgba(15,23,42,0.18);
    width: 90mm;
    height: 55mm;
    padding: 6mm;
    position: relative;
    overflow: hidden;
  }
  .mockup-bc::after {
    content: '';
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 1mm;
    background: linear-gradient(90deg, #14B8A6 0%, #22D3EE 55%, #38BDF8 100%);
  }
  .mockup-bc .bc-name { font-weight: 800; font-size: 11pt; color: var(--slate-900); }
  .mockup-bc .bc-role { font-size: 7.5pt; color: var(--slate-500); margin-top: 0.5mm; }
  .mockup-bc .bc-mark {
    position: absolute;
    top: 5mm; right: 5mm;
    font-family: 'RefocusBrand', sans-serif;
    color: var(--slate-900);
    font-size: 12pt;
    line-height: 1;
  }
  .mockup-bc .bc-info {
    position: absolute;
    left: 6mm; bottom: 6mm;
    font-size: 7.5pt;
    color: var(--slate-600);
    line-height: 1.5;
  }

  /* ════════════════════════════════════════════════════════════════
     ДОПОЛНИТЕЛЬНЫЕ СТИЛИ ДЛЯ НОВЫХ СТРАНИЦ И РЕДИЗАЙНОВ
     ════════════════════════════════════════════════════════════════ */

  /* ── Тёмная страница (Манифест, Суть, Brand Promise, Финал) ──── */
  .page.dark {
    background: var(--slate-900);
    color: white;
  }
  .page.dark .ph { border-bottom-color: var(--slate-800); }
  .page.dark .ph-brand { color: white; }
  .page.dark .ph-meta  { color: var(--slate-400); }
  .page.dark .pf       { color: var(--slate-500); border-top-color: var(--slate-800); }
  .page.dark .pf-num   { color: var(--slate-300); }
  .page.dark .section-title { color: white; }
  .page.dark .section-num   { color: var(--cyan); }
  .page.dark .section-lede  { color: var(--slate-300); }
  .page.dark p              { color: var(--slate-300); }
  .page.dark strong         { color: white; }
  .page.dark h2.h2          { color: white; }
  .page.dark h3.h3          { color: white; }
  .page.dark h4.h4          { color: var(--cyan); }
  .page.dark .card          { background: rgba(255,255,255,0.04); border-color: var(--slate-700); }
  .page.dark .brand-rule    { /* gradient тот же — на тёмном смотрится отлично */ }

  /* Cyan-glow декорации для тёмных страниц */
  .glow-cyan {
    position: absolute;
    width: 180mm;
    height: 180mm;
    border-radius: 50%;
    background: rgba(34, 211, 238, 0.20);
    filter: blur(60mm);
    pointer-events: none;
    z-index: 0;
  }
  .glow-emerald {
    position: absolute;
    width: 140mm;
    height: 140mm;
    border-radius: 50%;
    background: rgba(16, 185, 129, 0.15);
    filter: blur(50mm);
    pointer-events: none;
    z-index: 0;
  }

  /* ── Splash-разделитель частей ─────────────────────────────────── */
  .splash {
    position: relative;
    overflow: hidden;
    padding: 16mm 16mm 12mm;
    /* Наследует .page (flex column). Не переопределяем justify — ph остаётся вверху,
       pf внизу через margin-top:auto, splash-content центрируется через своё margin auto */
  }
  .splash-content {
    margin-top: auto;
    margin-bottom: auto;
  }
  .splash-part-num {
    font-family: 'RefocusBrand', sans-serif;
    font-size: 220pt;
    line-height: 0.85;
    color: var(--sky-100);
    position: absolute;
    top: 50mm;
    right: 20mm;
    pointer-events: none;
    z-index: 0;
    letter-spacing: 0;
    opacity: 0.7;
  }
  .splash-content {
    position: relative;
    z-index: 1;
    margin-top: auto;
    margin-bottom: auto;
  }
  .splash-eyebrow {
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.30em;
    text-transform: uppercase;
    color: var(--cyan-deep);
    margin-bottom: 6mm;
  }
  .splash-title {
    font-size: 56pt;
    font-weight: 800;
    letter-spacing: -0.025em;
    color: var(--slate-900);
    line-height: 1.04;
    margin-bottom: 8mm;
    max-width: 160mm;
  }
  .splash-desc {
    font-size: 13pt;
    color: var(--slate-600);
    max-width: 130mm;
    line-height: 1.5;
  }
  .splash-rule {
    height: 5pt;
    width: 80mm;
    border-radius: 2.5pt;
    background: linear-gradient(90deg, #14B8A6 0%, #22D3EE 55%, #38BDF8 100%);
    margin-bottom: 10mm;
  }

  /* ── Манифест-текст ────────────────────────────────────────────── */
  .manifest-text {
    font-family: 'Manrope', sans-serif;
    font-weight: 600;
    font-size: 28pt;
    line-height: 1.25;
    letter-spacing: -0.025em;
    color: white;
    margin-top: 4mm;
    max-width: 165mm;
  }
  .manifest-text em {
    color: var(--cyan);
    font-style: normal;
    font-weight: 700;
  }
  .manifest-signature {
    margin-top: 12mm;
    font-family: 'RefocusBrand', sans-serif;
    font-size: 32pt;
    line-height: 1;
    color: white;
  }

  /* ── Декоративный фоновый wordmark (огромный полупрозрачный) ──── */
  .bg-wordmark {
    position: absolute;
    bottom: -20mm;
    right: -10mm;
    font-family: 'RefocusBrand', sans-serif;
    font-size: 240pt;
    line-height: 0.8;
    color: var(--slate-100);
    opacity: 1;
    pointer-events: none;
    z-index: 0;
    letter-spacing: 0;
  }
  .bg-wordmark.dark {
    color: rgba(255,255,255,0.04);
  }

  /* ── TOC styling ────────────────────────────────────────────────── */
  .toc-list {
    margin-top: 6mm;
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 12mm;
    row-gap: 0;
    align-content: start;
  }
  .toc-col { /* колонка-обёртка для группировки нескольких частей */
    display: flex;
    flex-direction: column;
  }
  .toc-item {
    display: flex;
    align-items: baseline;
    gap: 3mm;
    padding: 2mm 0;
    border-bottom: 0.4pt dotted var(--slate-200);
  }
  .toc-num {
    font-size: 8pt;
    font-weight: 700;
    color: var(--cyan-deep);
    min-width: 8mm;
    font-feature-settings: 'tnum';
  }
  .toc-title {
    font-size: 9.5pt;
    color: var(--slate-700);
    flex: 1;
    line-height: 1.3;
  }
  .toc-title strong { color: var(--slate-900); font-weight: 700; }
  .toc-page-num {
    font-size: 8pt;
    color: var(--slate-400);
    font-feature-settings: 'tnum';
  }
  .toc-part {
    font-size: 8.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.20em;
    color: var(--cyan-deep);
    margin: 5mm 0 1mm;
  }
  .toc-part:first-child { margin-top: 0; }

  /* ── Brand promise (гарантии) ───────────────────────────────────── */
  .promise-row {
    display: flex;
    align-items: baseline;
    gap: 8mm;
    padding: 8mm 0;
    border-bottom: 0.6pt solid rgba(255,255,255,0.10);
  }
  .promise-num {
    font-family: 'Manrope', sans-serif;
    font-weight: 800;
    font-size: 56pt;
    line-height: 0.9;
    color: var(--cyan);
    letter-spacing: -0.03em;
    min-width: 50mm;
    font-feature-settings: 'tnum';
  }
  .promise-row .promise-text { flex: 1; }
  .promise-row h3 {
    font-size: 14pt;
    font-weight: 700;
    color: white;
    margin: 0 0 2mm;
  }
  .promise-row p {
    font-size: 10pt;
    color: var(--slate-300);
    margin: 0;
    line-height: 1.5;
  }

  /* ── Customer Journey ──────────────────────────────────────────── */
  .journey-rail {
    position: relative;
    padding: 8mm 0 4mm;
  }
  .journey-rail::before {
    content: '';
    position: absolute;
    left: 6mm; right: 6mm;
    top: 14mm;
    height: 1pt;
    background: linear-gradient(90deg, var(--slate-200) 0%, var(--cyan) 50%, var(--slate-200) 100%);
  }
  .journey-step {
    position: relative;
    text-align: center;
    z-index: 1;
  }
  .journey-step .dot {
    width: 8mm; height: 8mm;
    border-radius: 50%;
    background: var(--cyan);
    color: white;
    font-size: 9pt;
    font-weight: 800;
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 3mm;
    box-shadow: 0 2mm 6mm rgba(34,211,238,0.30);
  }
  .journey-step .stage {
    font-size: 8pt;
    font-weight: 700;
    color: var(--slate-900);
    margin-bottom: 1mm;
    line-height: 1.2;
  }
  .journey-step .desc {
    font-size: 7pt;
    color: var(--slate-500);
    line-height: 1.3;
  }

  /* ── Аватар клиента ────────────────────────────────────────────── */
  .persona-card {
    border: 1pt solid var(--slate-200);
    border-radius: 4mm;
    padding: 5mm;
    background: white;
  }
  .persona-icon {
    width: 14mm; height: 14mm;
    border-radius: 3mm;
    background: var(--cyan);
    color: white;
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 4mm;
    box-shadow: 0 3mm 10mm rgba(34,211,238,0.30);
  }

  /* ── Voice dictionary ──────────────────────────────────────────── */
  .voc-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 4mm;
  }
  .voc-table thead th {
    text-align: left;
    font-size: 7.5pt;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--slate-500);
    font-weight: 700;
    padding: 2.5mm 4mm;
    border-bottom: 0.6pt solid var(--slate-200);
  }
  .voc-table td {
    padding: 2mm 4mm;
    font-size: 9pt;
    border-bottom: 0.4pt solid var(--slate-100);
    vertical-align: top;
    line-height: 1.4;
  }
  .voc-table .voc-yes { color: var(--emerald); font-weight: 600; margin-right: 1mm; }
  /* Прозрачнее зачёркивание — текст и линия мягче, чтобы было читабельно но видно что нельзя */
  .voc-table .voc-no  {
    color: rgba(244, 63, 94, 0.55);
    font-weight: 500;
    text-decoration: line-through;
    text-decoration-color: rgba(244, 63, 94, 0.45);
    text-decoration-thickness: 0.6pt;
  }

  /* ── Key Visuals (mockup'ы) ────────────────────────────────────── */
  .kv-frame {
    background: white;
    box-shadow: 0 4mm 14mm rgba(15,23,42,0.20);
    overflow: hidden;
    position: relative;
  }
  .kv-ig-post {
    aspect-ratio: 1/1;
    border-radius: 3mm;
    padding: 8mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .kv-ig-story {
    aspect-ratio: 9/16;
    border-radius: 3mm;
    padding: 6mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .kv-billboard {
    aspect-ratio: 16/9;
    border-radius: 2mm;
    padding: 8mm 12mm;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .kv-leaflet {
    aspect-ratio: 1/1.414;
    border-radius: 2mm;
    padding: 8mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .kv-cap {
    font-size: 7.5pt;
    color: var(--slate-500);
    margin-top: 2mm;
    text-align: center;
    letter-spacing: 0.05em;
  }

  /* ── Финальная страница ─────────────────────────────────────────── */
  .final-wordmark {
    width: 160mm;
    height: auto;
    display: block;
    margin: 0 auto;
    filter: brightness(0) invert(1); /* делаем белым из чёрного PNG */
  }
  .final-tagline {
    font-family: 'RefocusBrand', sans-serif;
    font-size: 30pt;
    color: var(--cyan);
    text-align: center;
    margin-top: 14mm;
    letter-spacing: 0.005em;
  }
  .final-meta {
    text-align: center;
    margin-top: 18mm;
    color: var(--slate-400);
    font-size: 9.5pt;
    line-height: 1.7;
  }

  /* ── Hero photo (для редизайна galleries) ──────────────────────── */
  .hero-photo {
    width: 100%;
    border-radius: 4mm;
    overflow: hidden;
    border: 1pt solid var(--slate-200);
  }
  .hero-photo img { width: 100%; display: block; }

  /* ── Cyan filter для Manrope в Manifest ──────────────────────── */
</style>
</head>
<body>

${PageCover(a, today)}
${Page02_TOC(a)}

${PageSplash({ roman: 'I', eyebrow: 'Часть I', title: 'Фундамент', desc: 'Манифест, суть бренда, ценности и личность Refocus. То, что определяет всё остальное.', pageNum: '05' })}
${PageManifesto(a)}
${PageEssenceDark(a)}
${PageValuesV2(a)}
${Page05_Personality(a)}

${PageSplash({ roman: 'II', eyebrow: 'Часть II', title: 'Голос', desc: 'Как говорит Refocus — принципы речи, тон в разных контекстах, имя, слоган и словарь.', pageNum: '10' })}
${Page06_Voice(a)}
${Page07_ToneContexts(a)}
${Page08_Naming(a)}
${PageVoiceDictionary(a)}

${PageSplash({ roman: 'III', eyebrow: 'Часть III', title: 'Логотип', desc: 'Главный знак, три композиции, цветовые исполнения, защитное поле, запреты, app icon.', pageNum: '15' })}
${Page09_LogoMain(a)}
${Page10_LogoConstruction(a)}
${Page11_LogoVersions(a)}
${Page12_LogoColorway(a)}
${Page13_LogoOnBackgrounds(a)}
${Page14_LogoDonts(a)}
${Page15_AppIcon(a)}

${PageSplash({ roman: 'IV', eyebrow: 'Часть IV', title: 'Цвет', desc: 'Primary палитра, функциональные цвета, брендовый градиент, контрастность.', pageNum: '23' })}
${Page16_PrimaryPalette(a)}
${Page16b_PalettePoster(a)}
${Page17_SecondaryPalette(a)}
${PageGradientV2(a)}

${PageSplash({ roman: 'V', eyebrow: 'Часть V', title: 'Типографика', desc: 'Manrope, RefocusDisplay, иерархия шрифтов и локализация.', pageNum: '28' })}
${Page19_Manrope(a)}
${Page20_RefocusDisplay(a)}
${Page21_TypographyHierarchy(a)}

${PageSplash({ roman: 'VI', eyebrow: 'Часть VI', title: 'Применение', desc: 'Иконы, фото, точка продаж, упаковка, customer journey, мобильное приложение, key visuals.', pageNum: '32' })}
${Page22_Iconography(a)}
${Page23_PhotoStyle(a)}
${PagePhotoGalleryV2(a)}
${Page25_PrintCollateral(a)}
${Page25b_PremiumPackaging(a)}
${PageCustomerJourney(a)}
${PageAvatar(a)}
${PageBrandPromise(a)}
${Page26_PrintSpecs(a)}
${Page27_DigitalApps(a)}
${Page28_SocialEmail(a)}
${PageKeyVisuals(a)}
${Page29_StoreExperience(a)}
${Page30_LegalContacts(a)}

${PageFinal(a)}

</body>
</html>`;
}

// ── Helper: общий header страницы ──────────────────────────────────────────────
function ph(section: string): string {
  return `<div class="ph">
    <span class="ph-brand">refocus</span>
    <span class="ph-meta">${section}</span>
  </div>`;
}
function pf(_num?: string): string {
  // Номер страницы вставляется автоматически через CSS counter (см. .pf-num::before).
  // Параметр оставлен для обратной совместимости — игнорируется.
  return `<div class="pf">
    <span>Refocus Brand Guidelines · v1.0 · 2026</span>
    <span class="pf-num"></span>
  </div>`;
}

// ─── PAGE 01: COVER ────────────────────────────────────────────────────────────
function PageCover(a: BrandbookAssets, today: string): string {
  return `<section class="page cover">
    <div class="cover-grad-band"></div>
    <div class="cover-body">
      <div class="cover-eyebrow">Refocus · Сеть оптик нового поколения</div>
      <img src="${a.wordmarkBlack}" alt="REFOCUS" class="cover-wordmark-img" />
      <div class="cover-title">Brand Guidelines</div>
      <div class="cover-subtitle">
        Единый визуальный и смысловой канон бренда Refocus.
        Логотип, цвета, типографика, голос, применение в материалах и точках.
      </div>
    </div>
    <div class="cover-foot">
      <span class="cover-version">Версия 1.0 · ${today}</span>
      <span>Внутренний документ. Для франчайзи и подрядчиков.</span>
    </div>
  </section>`;
}

// ─── PAGE 02: TABLE OF CONTENTS + PREFACE ──────────────────────────────────────
function Page02_TOC(_a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Содержание')}
    <div class="section-num">— Содержание</div>
    <h1 class="section-title">Что внутри</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Шесть частей. От смысла бренда до конкретики применения в материалах.
      Шпаргалки и ассеты — в конце документа. Спорные кейсы — на refocus.kg@gmail.com.
    </p>

    <div class="toc-list">
      <div class="toc-col">
        <div class="toc-part">Часть I · Фундамент</div>
        <div class="toc-item"><span class="toc-num">01</span><span class="toc-title">Манифест бренда</span><span class="toc-page-num">04</span></div>
        <div class="toc-item"><span class="toc-num">02</span><span class="toc-title">Суть Refocus</span><span class="toc-page-num">05</span></div>
        <div class="toc-item"><span class="toc-num">03</span><span class="toc-title">Четыре ценности</span><span class="toc-page-num">06</span></div>
        <div class="toc-item"><span class="toc-num">04</span><span class="toc-title">Личность и архетип</span><span class="toc-page-num">07</span></div>

        <div class="toc-part">Часть II · Голос</div>
        <div class="toc-item"><span class="toc-num">05</span><span class="toc-title">Принципы речи</span><span class="toc-page-num">09</span></div>
        <div class="toc-item"><span class="toc-num">06</span><span class="toc-title">Тон в контекстах</span><span class="toc-page-num">10</span></div>
        <div class="toc-item"><span class="toc-num">07</span><span class="toc-title">Имя и слоган</span><span class="toc-page-num">11</span></div>
        <div class="toc-item"><span class="toc-num">08</span><span class="toc-title">Словарь Refocus</span><span class="toc-page-num">12</span></div>

        <div class="toc-part">Часть III · Логотип</div>
        <div class="toc-item"><span class="toc-num">09</span><span class="toc-title">Главный логотип</span><span class="toc-page-num">14</span></div>
        <div class="toc-item"><span class="toc-num">10</span><span class="toc-title">Конструкция и геометрия</span><span class="toc-page-num">15</span></div>
        <div class="toc-item"><span class="toc-num">11</span><span class="toc-title">Три композиции</span><span class="toc-page-num">16</span></div>
        <div class="toc-item"><span class="toc-num">12</span><span class="toc-title">Цветовые исполнения</span><span class="toc-page-num">17</span></div>
        <div class="toc-item"><span class="toc-num">13</span><span class="toc-title">Защитное поле и фоны</span><span class="toc-page-num">18</span></div>
        <div class="toc-item"><span class="toc-num">14</span><span class="toc-title">Что нельзя делать</span><span class="toc-page-num">19</span></div>
        <div class="toc-item"><span class="toc-num">15</span><span class="toc-title">App icon, favicon, OG</span><span class="toc-page-num">20</span></div>
      </div>

      <div class="toc-col">
        <div class="toc-part">Часть IV · Цвет</div>
        <div class="toc-item"><span class="toc-num">16</span><span class="toc-title">Primary палитра</span><span class="toc-page-num">22</span></div>
        <div class="toc-item"><span class="toc-num">17</span><span class="toc-title">Палитра-плакат</span><span class="toc-page-num">23</span></div>
        <div class="toc-item"><span class="toc-num">18</span><span class="toc-title">Functional цвета</span><span class="toc-page-num">24</span></div>
        <div class="toc-item"><span class="toc-num">19</span><span class="toc-title">Градиент + контраст</span><span class="toc-page-num">25</span></div>

        <div class="toc-part">Часть V · Типографика</div>
        <div class="toc-item"><span class="toc-num">20</span><span class="toc-title">Manrope</span><span class="toc-page-num">27</span></div>
        <div class="toc-item"><span class="toc-num">21</span><span class="toc-title">RefocusDisplay</span><span class="toc-page-num">28</span></div>
        <div class="toc-item"><span class="toc-num">22</span><span class="toc-title">Иерархия шрифтов</span><span class="toc-page-num">29</span></div>

        <div class="toc-part">Часть VI · Применение</div>
        <div class="toc-item"><span class="toc-num">23</span><span class="toc-title">Иконография</span><span class="toc-page-num">31</span></div>
        <div class="toc-item"><span class="toc-num">24</span><span class="toc-title">Стиль фотографии</span><span class="toc-page-num">32</span></div>
        <div class="toc-item"><span class="toc-num">25</span><span class="toc-title">Эталон точки</span><span class="toc-page-num">33</span></div>
        <div class="toc-item"><span class="toc-num">26</span><span class="toc-title">Стандартная упаковка</span><span class="toc-page-num">34</span></div>
        <div class="toc-item"><span class="toc-num">27</span><span class="toc-title">Премиум-набор</span><span class="toc-page-num">35</span></div>
        <div class="toc-item"><span class="toc-num">28</span><span class="toc-title">Customer Journey</span><span class="toc-page-num">36</span></div>
        <div class="toc-item"><span class="toc-num">29</span><span class="toc-title">Аватар клиента</span><span class="toc-page-num">37</span></div>
        <div class="toc-item"><span class="toc-num">30</span><span class="toc-title"><strong>Brand Promise</strong> — гарантии</span><span class="toc-page-num">38</span></div>
        <div class="toc-item"><span class="toc-num">31</span><span class="toc-title">Print specs</span><span class="toc-page-num">39</span></div>
        <div class="toc-item"><span class="toc-num">32</span><span class="toc-title">Mobile app</span><span class="toc-page-num">40</span></div>
        <div class="toc-item"><span class="toc-num">33</span><span class="toc-title">Соцсети, email, мессенджеры</span><span class="toc-page-num">41</span></div>
        <div class="toc-item"><span class="toc-num">34</span><span class="toc-title"><strong>Key Visuals</strong> — макеты</span><span class="toc-page-num">42</span></div>
        <div class="toc-item"><span class="toc-num">35</span><span class="toc-title">Атмосфера в точке</span><span class="toc-page-num">43</span></div>
        <div class="toc-item"><span class="toc-num">36</span><span class="toc-title">Юр. защита и контакты</span><span class="toc-page-num">44</span></div>
      </div>
    </div>

    ${pf('02')}
  </section>`;
}

// ─── PAGE 03: BRAND ESSENCE ────────────────────────────────────────────────────
function Page03_Essence(_a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Суть бренда')}
    <div class="section-num">02 — Фундамент</div>
    <h1 class="section-title">Суть Refocus</h1>
    <div class="brand-rule"></div>

    <div class="pull">
      <em>Refocus</em> — технологичная оптика нового поколения,<br>
      где клиент получает <em>честную консультацию</em>, <em>современное решение</em><br>
      и <em>дружелюбный сервис</em>.
    </div>

    <div class="grid-2" style="margin-top: 6mm;">
      <div class="card dark">
        <h4 class="h4" style="color: var(--cyan);">Внутри сети — про механизм</h4>
        <p style="font-size: 9.5pt; color: var(--slate-300);">
          Технологичная, стандартизированная, честная, единая инфраструктура.
          Это то, как мы устроены изнутри. Об этом говорим с франчайзи,
          сотрудниками, поставщиками.
        </p>
      </div>
      <div class="card tinted">
        <h4 class="h4">Снаружи клиенту — про результат</h4>
        <p style="font-size: 9.5pt;">
          <strong>«Здесь всё объясняют, не давят и не забывают после покупки».</strong>
          Это то, что чувствует клиент. Об этом говорим в рекламе,
          на витрине, в соцсетях, в разговоре продавца.
        </p>
      </div>
    </div>

    <div style="margin-top: 8mm;">
      <h3 class="h3">Главное правило подачи</h3>
      <p>
        Перепутать нельзя. <strong>Клиент не покупает технологию — клиент покупает спокойствие.</strong>
        Технология — это <em>наша</em> ответственность. Спокойствие —
        это <em>его</em> результат.
      </p>
    </div>

    <div class="grid-3" style="margin-top: 8mm;">
      <div>
        <div class="stat">3</div>
        <div class="stat-label">Обещания клиенту</div>
        <p class="muted" style="font-size: 8.5pt; margin-top: 2mm;">Доверие. Понятность. Сопровождение.</p>
      </div>
      <div>
        <div class="stat">4</div>
        <div class="stat-label">Страны присутствия</div>
        <p class="muted" style="font-size: 8.5pt; margin-top: 2mm;">Кыргызстан, Россия, Казахстан, Узбекистан.</p>
      </div>
      <div>
        <div class="stat">∞</div>
        <div class="stat-label">Срок сервиса</div>
        <p class="muted" style="font-size: 8.5pt; margin-top: 2mm;">Пожизненный бесплатный сервис на каждую пару.</p>
      </div>
    </div>

    ${pf('03')}
  </section>`;
}

// ─── PAGE 04: 4 VALUES ────────────────────────────────────────────────────────
function Page04_Values(_a: BrandbookAssets): string {
  const values = [
    {
      n: '01',
      title: 'Честность',
      sub: '«Здесь меня не разведут»',
      body: 'Прозрачные цены. Объяснение опций без давления. Возможность сказать «нет» без последствий. AI-контроль качества разговоров продавцов.',
    },
    {
      n: '02',
      title: 'Понятность',
      sub: '«Я наконец понял, за что плачу»',
      body: 'Технология (тач-экран) и обученные продавцы делают сложное простым. Клиент видит разницу между линзами, понимает за что отвечает каждая опция.',
    },
    {
      n: '03',
      title: 'Сопровождение',
      sub: '«После покупки про меня не забыли»',
      body: 'Через 3 дня — WhatsApp-сообщение «как очки?». 14 дней — полная замена по любой причине. 60 дней — гарантия рецепта. Пожизненный сервис.',
    },
    {
      n: '04',
      title: 'Технологичность',
      sub: 'Невидимая для клиента, но работает на него',
      body: 'CRM, POS, мобильное приложение, фирменный сенсорный экран, AI-контроль, аналитика. Делает Refocus возможным, оставаясь за кулисами.',
    },
  ];
  return `<section class="page">
    ${ph('Ценности')}
    <div class="section-num">03 — Фундамент</div>
    <h1 class="section-title">Четыре ценности</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Любое решение в бренде проходит проверку: соответствует ли оно нашим ценностям?
      Если нет — мы это не делаем, даже если экономически выгодно.
    </p>

    <div class="grid-2" style="margin-top: 4mm;">
      ${values.map(v => `
        <div class="card">
          <div style="display: flex; align-items: baseline; gap: 4mm; margin-bottom: 3mm;">
            <span style="font-size: 24pt; font-weight: 800; color: var(--cyan); line-height: 1; font-feature-settings: 'tnum';">${v.n}</span>
            <div>
              <h3 class="h3" style="margin: 0;">${v.title}</h3>
              <div style="font-size: 8.5pt; color: var(--slate-500); font-style: italic; margin-top: 0.5mm;">${v.sub}</div>
            </div>
          </div>
          <p style="font-size: 9.5pt; line-height: 1.5; margin: 0;">${v.body}</p>
        </div>
      `).join('')}
    </div>

    ${pf('04')}
  </section>`;
}

// ─── PAGE 05: BRAND PERSONALITY + ARCHETYPE ───────────────────────────────────
function Page05_Personality(_a: BrandbookAssets): string {
  const traits = ['Внимательные', 'Прозрачные', 'Точные', 'Заботливые', 'Современные', 'Дружелюбные'];
  const antitraits = ['Агрессивные', 'Навязчивые', 'Формальные', 'Хитрые', 'Дешёвые', 'Скучные'];
  return `<section class="page">
    ${ph('Личность бренда')}
    <div class="section-num">04 — Фундамент</div>
    <h1 class="section-title">Какой Refocus<br>как человек</h1>
    <div class="brand-rule"></div>

    <div class="card dark" style="margin-bottom: 8mm;">
      <h4 class="h4" style="color: var(--cyan);">Архетип: Заботливый эксперт</h4>
      <p style="font-size: 10.5pt; color: white; margin-bottom: 3mm;">
        Гибрид двух классических архетипов — <strong>Caregiver</strong> (заботливый) и <strong>Sage</strong> (мудрец).
      </p>
      <p style="font-size: 9.5pt; color: var(--slate-300);">
        Caregiver — мы заботимся: бесплатная диагностика, follow-up, гарантии, пожизненный сервис.
        Sage — мы знаем: подбор зрения, разница линз, AI-контроль качества разговоров.
        Refocus — это компетентность, которая не пугает, а помогает.
      </p>
    </div>

    <div class="grid-2">
      <div>
        <h4 class="h4" style="color: var(--emerald);">✓ Какие мы</h4>
        <ul class="bullets checks" style="margin-top: 3mm;">
          ${traits.map(t => `<li>${t}</li>`).join('')}
        </ul>
      </div>
      <div>
        <h4 class="h4" style="color: var(--rose);">× Какими мы НЕ являемся</h4>
        <ul class="bullets crosses" style="margin-top: 3mm;">
          ${antitraits.map(t => `<li>${t}</li>`).join('')}
        </ul>
      </div>
    </div>

    <div style="margin-top: 8mm; padding: 5mm 6mm; background: var(--sky-50); border-left: 3pt solid var(--cyan); border-radius: 0 3mm 3mm 0;">
      <p style="font-size: 10pt; margin: 0; color: var(--slate-700);">
        Тест на каждое решение в бренде: <strong>будет ли так делать «заботливый эксперт»?</strong>
        Если ответ «нет» или «возможно» — переделать.
      </p>
    </div>

    ${pf('05')}
  </section>`;
}

// ─── PAGE 06: VOICE & TONE — PRINCIPLES ───────────────────────────────────────
function Page06_Voice(_a: BrandbookAssets): string {
  const principles = [
    { n: '01', title: 'Просто и без жаргона', body: 'Объясняем диоптрии, мультифокальность, поляризацию человеческими словами. Если клиент не понял с первого раза — значит, мы плохо объяснили.' },
    { n: '02', title: 'Без давления', body: 'Никогда не пишем «срочно», «только сегодня», «последний шанс», «уже разобрали». У клиента всегда есть право подумать и вернуться завтра.' },
    { n: '03', title: 'Образовательно', body: 'Рассказываем «почему», не только «что». Делимся знаниями про зрение, линзы, оправы. Клиент уходит немного умнее, чем пришёл.' },
    { n: '04', title: 'Тепло, но без панибратства', body: 'На «вы» с клиентами старше 25, на «ты» в соцсетях и с молодёжью. Дружелюбно, но без эмодзи через слово и без «солнышко» / «зайка».' },
  ];
  return `<section class="page">
    ${ph('Голос и тон')}
    <div class="section-num">05 — Голос</div>
    <h1 class="section-title">Как говорит Refocus</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Каждый текст — от пуш-уведомления до Instagram-поста — должен звучать
      как один человек. Это четыре принципа речи Refocus.
    </p>

    <div style="margin-top: 4mm;">
      ${principles.map(p => `
        <div style="display: flex; gap: 6mm; padding: 5mm 0; border-bottom: 0.4pt solid var(--slate-100);">
          <span style="font-size: 22pt; font-weight: 800; color: var(--cyan); line-height: 1; flex-shrink: 0; min-width: 14mm; font-feature-settings: 'tnum';">${p.n}</span>
          <div style="flex: 1;">
            <h3 class="h3" style="margin-bottom: 2mm;">${p.title}</h3>
            <p style="font-size: 9.5pt; margin: 0;">${p.body}</p>
          </div>
        </div>
      `).join('')}
    </div>

    ${pf('06')}
  </section>`;
}

// ─── PAGE 07: TONE IN CONTEXTS ────────────────────────────────────────────────
function Page07_ToneContexts(_a: BrandbookAssets): string {
  const examples = [
    { ctx: 'Реклама в Instagram', yes: 'Очки готовы за день. Без записи, без очередей. Загляните.', no: 'СПЕЦИАЛЬНОЕ ПРЕДЛОЖЕНИЕ! ТОЛЬКО СЕГОДНЯ! Скидка 50% на ВСЕ оправы! 🔥🔥🔥' },
    { ctx: 'WhatsApp — заказ готов', yes: 'Здравствуйте! Ваши очки готовы. Заходите когда удобно — мы на месте.', no: 'Здравствуйте! Срочно заберите заказ! Иначе аннулируем!' },
    { ctx: 'Отказ клиенту', yes: 'К сожалению, эту оправу мы не можем заказать — снята с производства. Покажу похожие модели?', no: 'Этого нет. Берите что есть.' },
    { ctx: 'Извинение за ошибку', yes: 'Мы перепутали диоптрии — это наша вина. Сделаем новые линзы за наш счёт, готовы будут завтра. Дополнительно — скидка 1000₽ на следующий заказ.', no: 'Извините, такое бывает. Подождите ещё пару дней.' },
    { ctx: 'Соцсети — образовательный пост', yes: 'Утомление глаз к вечеру? Скорее всего, не ленятся, а перегружены. Расскажем, как современные линзы помогают →', no: 'Купите наши premium-линзы — самые крутые на рынке!' },
    { ctx: 'Юридический документ', yes: 'Франчайзи обязуется обеспечить страхование Франчайзинговой точки в соответствии с Приложением №10.', no: 'Тебе обязательно надо застраховать точку, иначе будут проблемы.' },
  ];
  return `<section class="page">
    ${ph('Тон в контекстах')}
    <div class="section-num">06 — Голос</div>
    <h1 class="section-title">Тон меняется,<br>принципы — нет</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Refocus говорит по-разному в рекламе и в юридическом документе.
      Но всегда честно, понятно, без давления.
    </p>

    <table class="tone-table">
      <thead><tr><th style="width: 25%;">Контекст</th><th style="width: 37.5%;">✓ Голос Refocus</th><th style="width: 37.5%;">× Так не пишем</th></tr></thead>
      <tbody>
        ${examples.map(e => `
          <tr>
            <td><strong style="font-size: 9pt;">${e.ctx}</strong></td>
            <td><span class="yes">✓</span> ${e.yes}</td>
            <td><span class="no">×</span> ${e.no}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    ${pf('07')}
  </section>`;
}

// ─── PAGE 08: NAMING + TAGLINE ────────────────────────────────────────────────
function Page08_Naming(_a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Имя и слоган')}
    <div class="section-num">07 — Голос</div>
    <h1 class="section-title">Как пишем имя</h1>
    <div class="brand-rule"></div>

    <div class="grid-2">
      <div>
        <h4 class="h4" style="color: var(--emerald);">✓ Единственно правильно</h4>
        <div style="font-family: 'RefocusBrand', sans-serif; font-size: 56pt; color: var(--slate-900); line-height: 1; margin: 4mm 0; letter-spacing: 0.005em;">refocus</div>
        <p style="font-size: 9pt;">Только «<strong>Refocus</strong>» — заглавная R, остальные строчные.</p>
        <p style="font-size: 9pt;">Применяется во всех языках: русском, кыргызском, казахском, узбекском, английском.</p>
      </div>
      <div>
        <h4 class="h4" style="color: var(--rose);">× Так писать НЕЛЬЗЯ</h4>
        <ul class="bullets crosses" style="margin-top: 3mm;">
          <li><span style="font-family: monospace;">REFOCUS</span> — нет, не капсом</li>
          <li><span style="font-family: monospace;">ReFocus</span> — нет, не camelCase</li>
          <li><span style="font-family: monospace;">refocus</span> — нет, без заглавной</li>
          <li><span style="font-family: monospace;">Re-Focus / Re Focus</span> — нет, без дефиса и пробела</li>
          <li><span style="font-family: monospace;">Рефокус</span> — никогда не транслитерировать</li>
        </ul>
      </div>
    </div>

    <div style="margin-top: 10mm; padding: 6mm; background: var(--slate-900); border-radius: 4mm; color: white;">
      <h4 class="h4" style="color: var(--cyan);">Слоган бренда</h4>
      <div style="font-family: 'RefocusBrand', sans-serif; font-size: 38pt; color: white; line-height: 1.1; margin: 4mm 0 3mm; letter-spacing: 0.005em;">снова в фокусе</div>
      <p style="color: var(--slate-300); font-size: 9.5pt;">
        Игра с именем: «Re-focus» = «снова в фокусе». Возвращаем чёткость зрения и фокус на главное.
        Используется в брендовых материалах, на упаковке, в hero-блоках сайта.
      </p>
    </div>

    <div style="margin-top: 6mm;">
      <h4 class="h4">Brand Promise — обещание для рекламы и фронта</h4>
      <p class="pull" style="margin: 3mm 0 0;">
        <em>Здесь всё объясняют,</em><br><em>не давят</em> и <em>не забывают</em> после покупки.
      </p>
    </div>

    ${pf('08')}
  </section>`;
}

// ─── PAGE 09: LOGO MAIN ───────────────────────────────────────────────────────
function Page09_LogoMain(a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Логотип')}
    <div class="section-num">08 — Логотип</div>
    <h1 class="section-title">Главный логотип</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Стилизованное «RE», где буква E вписана в круг. Круг — это линза,
      это фокус, это символ зрения. Самый важный визуальный актив бренда.
    </p>

    <div class="logo-frame" style="height: 110mm; margin-bottom: 6mm;">
      <img src="${a.lockupBlack}" alt="Refocus logo" style="height: 80mm; width: auto;" />
    </div>

    <div class="grid-2">
      <div>
        <h4 class="h4">Что означает форма</h4>
        <p style="font-size: 9.5pt;">
          Буква <strong>R</strong> классическая — про надёжность и наследие.
          Буква <strong>E</strong> вписана в круг — линза, фокус, точка концентрации зрения.
          Вместе образуют узнаваемую монограмму, которая работает на любом масштабе —
          от иконки приложения 16×16 до вывески точки 3 метра в высоту.
        </p>
      </div>
      <div>
        <h4 class="h4">Где использовать</h4>
        <ul class="bullets" style="margin-top: 3mm;">
          <li>Вывеска точки</li>
          <li>App Store / Play Market иконка</li>
          <li>Favicon сайта</li>
          <li>Бейдж сотрудника</li>
          <li>Тиснение упаковки</li>
          <li>Печать в документах HQ</li>
        </ul>
      </div>
    </div>

    ${pf('09')}
  </section>`;
}

// ─── PAGE 10: LOGO CONSTRUCTION (РЕДИЗАЙН — реальная SVG-схема) ──────────────
function Page10_LogoConstruction(a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Конструкция логотипа')}
    <div class="section-num">10 — Логотип</div>
    <h1 class="section-title">Геометрия и пропорции</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Логотип построен на единице <strong>X</strong> — высоте буквы R.
      Все пропорции, отступы и минимальные размеры считаются относительно X.
    </p>

    <!-- SVG-схема с измерительными линиями -->
    <div style="background: var(--sky-50); border-radius: 4mm; padding: 14mm 12mm; margin: 4mm 0 6mm; display: flex; justify-content: center;">
      <svg viewBox="0 0 600 360" style="width: 100%; max-width: 160mm; height: auto;">
        <!-- Защитное поле (большая рамка) -->
        <rect x="60" y="60" width="480" height="240" fill="none" stroke="#22D3EE" stroke-width="1" stroke-dasharray="4,4" opacity="0.6"/>

        <!-- Внутренняя рамка вокруг лого -->
        <rect x="180" y="120" width="240" height="120" fill="none" stroke="#22D3EE" stroke-width="0.8" stroke-dasharray="2,2" opacity="0.45"/>

        <!-- Логотип — image внутри -->
        <image href="${a.logoBlack}" x="200" y="130" width="200" height="100" preserveAspectRatio="xMidYMid meet"/>

        <!-- Размерная X — слева от лого, вертикальная -->
        <line x1="170" y1="120" x2="170" y2="240" stroke="#0F172A" stroke-width="1"/>
        <line x1="166" y1="120" x2="174" y2="120" stroke="#0F172A" stroke-width="1"/>
        <line x1="166" y1="240" x2="174" y2="240" stroke="#0F172A" stroke-width="1"/>
        <text x="155" y="186" font-family="Manrope" font-size="14" font-weight="700" fill="#22D3EE" text-anchor="end">X</text>

        <!-- Защитное поле сверху -->
        <line x1="540" y1="60" x2="540" y2="120" stroke="#22D3EE" stroke-width="0.8"/>
        <line x1="536" y1="60" x2="544" y2="60" stroke="#22D3EE" stroke-width="0.8"/>
        <line x1="536" y1="120" x2="544" y2="120" stroke="#22D3EE" stroke-width="0.8"/>
        <text x="556" y="94" font-family="Manrope" font-size="11" font-weight="700" fill="#22D3EE">≥ X</text>

        <!-- Защитное поле слева -->
        <line x1="60" y1="280" x2="180" y2="280" stroke="#22D3EE" stroke-width="0.8"/>
        <line x1="60" y1="276" x2="60" y2="284" stroke="#22D3EE" stroke-width="0.8"/>
        <line x1="180" y1="276" x2="180" y2="284" stroke="#22D3EE" stroke-width="0.8"/>
        <text x="120" y="298" font-family="Manrope" font-size="11" font-weight="700" fill="#22D3EE" text-anchor="middle">≥ X</text>

        <!-- Подпись сверху -->
        <text x="300" y="40" font-family="Manrope" font-size="9" font-weight="700" fill="#64748B" text-anchor="middle" letter-spacing="2">ЗАЩИТНОЕ ПОЛЕ — НЕ МЕНЕЕ X СО ВСЕХ СТОРОН</text>
      </svg>
    </div>

    <div class="grid-3" style="gap: 4mm;">
      <div class="card">
        <h4 class="h4">X — высота R</h4>
        <p style="font-size: 9pt; margin: 0;">Базовая единица сетки. Все остальные размеры (защитное поле, толщина обводки, минимальный размер) считаются относительно X.</p>
      </div>
      <div class="card">
        <h4 class="h4">Защитное поле</h4>
        <p style="font-size: 9pt; margin: 0;">Свободное пространство вокруг логотипа со всех сторон — <strong>не менее 1× X</strong>. В этом поле ничего не размещать.</p>
      </div>
      <div class="card">
        <h4 class="h4">Минимальный размер</h4>
        <p style="font-size: 9pt; margin: 0;">Знак (RE) — <strong>16px / 8mm</strong>. Wordmark (REFOCUS) — <strong>20px / 10mm</strong>. Lockup — <strong>24px / 12mm</strong>.</p>
      </div>
    </div>

    ${pf('10')}
  </section>`;
}

// ─── PAGE 11: LOGO VERSIONS ───────────────────────────────────────────────────
function Page11_LogoVersions(a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Версии логотипа')}
    <div class="section-num">10 — Логотип</div>
    <h1 class="section-title">Три композиции</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Логотип Refocus имеет три официальных композиции. Каждая — для своего контекста.
      Все три есть в готовых файлах в папке брендовых ассетов
      (по 4 цветовых исполнения каждая, см. след. страницу).
      Любая другая компоновка должна быть утверждена HQ.
    </p>

    <div style="display: flex; flex-direction: column; gap: 6mm; margin-top: 6mm;">
      <div style="display: flex; gap: 6mm; align-items: stretch;">
        <div class="logo-frame" style="width: 70mm; height: 55mm;">
          <img src="${a.logoBlack}" alt="" style="height: 38mm;" />
        </div>
        <div style="flex: 1; padding: 2mm 0;">
          <h4 class="h4">A · Знак (mark) — RE</h4>
          <h3 class="h3" style="margin: 1mm 0 2mm;">Минималистичный символ</h3>
          <p style="font-size: 9.5pt; margin: 0;">
            Стилизованное «RE», где буква E вписана в круг — символ линзы и фокуса.
            <strong>Для:</strong> иконок приложения (App Store, Play Market), favicon сайта, бейджей сотрудников,
            тиснения упаковки, малых размеров (от 16px / 8mm).
          </p>
          <p style="font-size: 8.5pt; color: var(--slate-500); margin-top: 2mm;">
            Файл: <code>RE — чёрный/белый.png/svg</code>
          </p>
        </div>
      </div>

      <div style="display: flex; gap: 6mm; align-items: stretch;">
        <div class="logo-frame" style="width: 70mm; height: 55mm;">
          <img src="${a.wordmarkBlack}" alt="" style="height: 22mm;" />
        </div>
        <div style="flex: 1; padding: 2mm 0;">
          <h4 class="h4">B · Wordmark — REFOCUS</h4>
          <h3 class="h3" style="margin: 1mm 0 2mm;">Только название</h3>
          <p style="font-size: 9.5pt; margin: 0;">
            Слово «REFOCUS» в фирменном шрифте RefocusDisplay (pavelt-jrjpm).
            <strong>Для:</strong> hero-надписей на стенах точки, фирменных вывесок,
            крупных баннеров, упаковки (тиснение по широкому краю), обложек документов.
          </p>
          <p style="font-size: 8.5pt; color: var(--slate-500); margin-top: 2mm;">
            Файл: <code>REFOCUS — чёрный/белый.png/svg</code>
          </p>
        </div>
      </div>

      <div style="display: flex; gap: 6mm; align-items: stretch;">
        <div class="logo-frame" style="width: 70mm; height: 55mm;">
          <img src="${a.lockupBlack}" alt="" style="height: 38mm;" />
        </div>
        <div style="flex: 1; padding: 2mm 0;">
          <h4 class="h4">C · Lockup — RE + REFOCUS</h4>
          <h3 class="h3" style="margin: 1mm 0 2mm;">Полная композиция</h3>
          <p style="font-size: 9.5pt; margin: 0;">
            Знак сверху + wordmark под ним. Самая «представительная» версия.
            <strong>Для:</strong> главной вывески, шапки сайта и приложения, фирменных бланков,
            маркетинговых материалов, страниц коммерческих предложений, фасада точки.
          </p>
          <p style="font-size: 8.5pt; color: var(--slate-500); margin-top: 2mm;">
            Файл: <code>RE + REFOCUS — чёрный/белый.png/svg</code>
          </p>
        </div>
      </div>
    </div>

    ${pf('11')}
  </section>`;
}

// ─── PAGE 12: LOGO COLORWAYS ──────────────────────────────────────────────────
function Page12_LogoColorway(a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Цветовые версии')}
    <div class="section-num">11 — Логотип</div>
    <h1 class="section-title">Четыре цветовых исполнения</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Каждая из трёх композиций (mark / wordmark / lockup) существует в четырёх цветовых
      исполнениях. Любые другие цвета — нарушение бренда. На примере lockup:
    </p>

    <div class="grid-2" style="gap: 5mm; margin-top: 4mm;">
      <div>
        <div class="logo-frame" style="height: 56mm; background: white;">
          <img src="${a.lockupBlack}" alt="" style="height: 36mm;" />
        </div>
        <h4 class="h4" style="margin-top: 3mm;">1 · Чёрный на белом</h4>
        <p style="font-size: 8.5pt; margin: 0;">Основной канонический вариант. Документы, печать, светлые интерфейсы, фирменные бланки.</p>
      </div>

      <div>
        <div class="logo-frame dark" style="height: 56mm;">
          <img src="${a.lockupWhite}" alt="" style="height: 36mm;" />
        </div>
        <h4 class="h4" style="margin-top: 3mm;">2 · Белый на тёмно-синем</h4>
        <p style="font-size: 8.5pt; margin: 0;">Реверс. Для тёмных стен точки (Slate #0F172A), мобильного приложения, фасада, тёмных баннеров.</p>
      </div>

      <div>
        <div class="logo-frame cyan" style="height: 56mm;">
          <img src="${a.lockupWhite}" alt="" style="height: 36mm;" />
        </div>
        <h4 class="h4" style="margin-top: 3mm;">3 · Белый на cyan</h4>
        <p style="font-size: 8.5pt; margin: 0;">Брендовый акцентный вариант. App icon, цианевый футляр, hero-блоки рекламы, плашка на упаковке.</p>
      </div>

      <div>
        <div class="logo-frame" style="height: 56mm; background: #000000; border-color: #000000;">
          <img src="${a.lockupWhite}" alt="" style="height: 36mm;" />
        </div>
        <h4 class="h4" style="margin-top: 3mm;">4 · Белый на чёрном</h4>
        <p style="font-size: 8.5pt; margin: 0;">Контрастная версия для печати в одном цвете, для тиснения фольгой по чёрному, для футляров тёмно-синих и чёрных, для глянцевой полиграфии. Максимально лаконично.</p>
      </div>
    </div>

    <div style="margin-top: 6mm;" class="card tinted">
      <h4 class="h4">Что НЕ является официальным цветом</h4>
      <p style="font-size: 9pt; margin: 0;">
        Логотип <strong>не существует</strong> в красном, зелёном, фиолетовом, золотом, серебряном или любом другом цвете. Любая попытка перекрасить логотип — нарушение бренда. Для специальных проектов (партнёрские коллаборации, юбилейные выпуски) — обязательное согласование с HQ.
      </p>
    </div>

    ${pf('12')}
  </section>`;
}

// ─── PAGE 13: LOGO ON BACKGROUNDS + CLEAR SPACE ───────────────────────────────
function Page13_LogoOnBackgrounds(a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Защитное поле')}
    <div class="section-num">12 — Логотип</div>
    <h1 class="section-title">Защитное поле и минимальные размеры</h1>
    <div class="brand-rule"></div>

    <div class="grid-2">
      <div class="card tinted">
        <h4 class="h4">Защитное поле</h4>
        <p style="font-size: 9.5pt;">Вокруг логотипа должно быть свободное пространство <strong>не менее 1× X</strong>, где X — высота буквы R.</p>
        <p style="font-size: 9.5pt;">В этом поле <strong>ничего не размещать</strong>: ни текст, ни иконки, ни рамки, ни элементы фото.</p>
      </div>
      <div class="card tinted">
        <h4 class="h4">Минимальные размеры</h4>
        <table style="width: 100%; font-size: 9pt; margin-top: 2mm;">
          <tr><td><strong>Знак (mark)</strong></td><td>16px digital · 8mm print</td></tr>
          <tr><td><strong>Lockup</strong></td><td>24px digital · 12mm print</td></tr>
          <tr><td><strong>Wordmark</strong></td><td>20px digital · 10mm print</td></tr>
        </table>
        <p style="font-size: 8.5pt; color: var(--slate-500); margin-top: 3mm;">Меньше — нечитаемо, не используем.</p>
      </div>
    </div>

    <h3 class="h3" style="margin-top: 8mm;">Логотип на фотографиях</h3>
    <p style="font-size: 9.5pt;">На фото — только на тёмной/светлой подложке (плашка),
    или на однотонном спокойном участке. Никогда напрямую на пёстром фоне.</p>

    <div class="grid-3" style="margin-top: 4mm;">
      <div>
        <div style="position: relative; height: 52mm; border-radius: 3mm; overflow: hidden; background-image: url('${a.refs[0]}'); background-size: cover; background-position: center;">
          <div style="position: absolute; inset: 0; background: rgba(15,23,42,0.55); display: flex; align-items: center; justify-content: center;">
            <img src="${a.lockupWhite}" alt="" style="height: 26mm;" />
          </div>
        </div>
        <p style="font-size: 8pt; color: var(--emerald); font-weight: 700; margin: 1mm 0 0;">✓ С затемнением фото</p>
      </div>
      <div>
        <div style="position: relative; height: 52mm; border-radius: 3mm; overflow: hidden; background: var(--slate-50); display: flex; align-items: center; justify-content: center;">
          <img src="${a.pack.caseCyan}" alt="" style="max-height: 50mm; max-width: 100%;" />
        </div>
        <p style="font-size: 8pt; color: var(--emerald); font-weight: 700; margin: 1mm 0 0;">✓ Тиснение на упаковке</p>
      </div>
      <div>
        <div style="position: relative; height: 52mm; border-radius: 3mm; overflow: hidden; background-image: url('${a.refs[1]}'); background-size: cover; background-position: center;">
          <img src="${a.lockupBlack}" alt="" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); height: 18mm; opacity: 0.85;" />
        </div>
        <p style="font-size: 8pt; color: var(--rose); font-weight: 700; margin: 1mm 0 0;">× На пёстром фоне без подложки</p>
      </div>
    </div>

    ${pf('13')}
  </section>`;
}

// ─── PAGE 14: WHAT NOT TO DO ──────────────────────────────────────────────────
function Page14_LogoDonts(a: BrandbookAssets): string {
  const donts = [
    { label: 'Не вращать и не наклонять',                   style: 'transform: rotate(-15deg);' },
    { label: 'Не растягивать и не искажать пропорции',      style: 'transform: scaleX(1.7);' },
    { label: 'Не сжимать (squash)',                          style: 'transform: scaleY(0.55);' },
    { label: 'Не перекрашивать в произвольный цвет',         style: 'filter: invert(50%) sepia(80%) saturate(700%) hue-rotate(290deg);' },
    { label: 'Не добавлять обводку (stroke / outline)',      style: 'filter: drop-shadow(0.4mm 0 0 var(--rose)) drop-shadow(-0.4mm 0 0 var(--rose)) drop-shadow(0 0.4mm 0 var(--rose)) drop-shadow(0 -0.4mm 0 var(--rose));' },
    { label: 'Не добавлять drop-shadow или glow',           style: 'filter: drop-shadow(2mm 2mm 0.5mm rgba(15,23,42,0.6));' },
    { label: 'Не размещать на пёстром фоне без подложки',   style: ''  /* спец-обработка ниже */ , bg: `background-image: url('${a.refs[1]}'); background-size: cover;` },
    { label: 'Не помещать в чужую рамку',                   style: 'outline: 0.5pt solid var(--rose); outline-offset: 1mm;' },
    { label: 'Не использовать менее минимального размера',  style: 'transform: scale(0.30);' },
  ];
  return `<section class="page">
    ${ph('Запреты')}
    <div class="section-num">14 — Логотип</div>
    <h1 class="section-title">Что нельзя<br>делать с логотипом</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Девять запретов. Любое нарушение — повод не выпускать материал в свет.
      Если есть сомнение — пиши на refocus.kg@gmail.com.
    </p>

    <div class="donts-grid">
      ${donts.map(d => `
        <div class="donts-cell" style="${d.bg ?? ''}">
          <span class="x">×</span>
          <div style="position: relative; margin-top: 4mm; display: flex; align-items: center; justify-content: center; min-height: 18mm; overflow: hidden;">
            <img src="${a.logoBlack}" alt="" style="height: 14mm; opacity: 0.85; ${d.style}" />
          </div>
          <span class="label" style="${d.bg ? 'background: white; padding: 1.5mm 2mm; border-radius: 1mm; align-self: flex-start;' : ''}">${d.label}</span>
        </div>
      `).join('')}
    </div>

    ${pf('14')}
  </section>`;
}

// ─── PAGE 15: APP ICON, FAVICON, OG ───────────────────────────────────────────
function Page15_AppIcon(a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('App icon, favicon, social')}
    <div class="section-num">14 — Логотип</div>
    <h1 class="section-title">Для приложений<br>и социальных сетей</h1>
    <div class="brand-rule"></div>

    <div class="grid-3" style="gap: 5mm;">
      <div>
        <div style="width: 100%; aspect-ratio: 1/1; background: var(--cyan); border-radius: 22.5%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4mm 12mm rgba(34,211,238,0.30);">
          <img src="${a.logoWhite}" alt="" style="width: 56%;" />
        </div>
        <h4 class="h4" style="margin-top: 4mm;">App icon</h4>
        <p style="font-size: 8.5pt; margin: 0;">1024×1024 px. Радиус 22.5%. Cyan #22D3EE фон, белый знак, safe area 12% по краям.</p>
      </div>

      <div>
        <div style="display: flex; gap: 3mm; align-items: flex-end; padding: 5mm; background: var(--slate-50); border-radius: 3mm; min-height: 65mm; justify-content: center;">
          <div style="text-align: center;">
            <div style="width: 16mm; height: 16mm; background: white; border: 0.6pt solid var(--slate-200); border-radius: 1mm; display: flex; align-items: center; justify-content: center;">
              <img src="${a.logoBlack}" alt="" style="width: 11mm;" />
            </div>
            <span style="font-size: 7pt; color: var(--slate-500); display: block; margin-top: 1mm;">512px</span>
          </div>
          <div style="text-align: center;">
            <div style="width: 11mm; height: 11mm; background: white; border: 0.6pt solid var(--slate-200); border-radius: 1mm; display: flex; align-items: center; justify-content: center;">
              <img src="${a.logoBlack}" alt="" style="width: 7mm;" />
            </div>
            <span style="font-size: 7pt; color: var(--slate-500); display: block; margin-top: 1mm;">180px</span>
          </div>
          <div style="text-align: center;">
            <div style="width: 7mm; height: 7mm; background: white; border: 0.6pt solid var(--slate-200); border-radius: 0.5mm; display: flex; align-items: center; justify-content: center;">
              <img src="${a.logoBlack}" alt="" style="width: 4.5mm;" />
            </div>
            <span style="font-size: 7pt; color: var(--slate-500); display: block; margin-top: 1mm;">32px</span>
          </div>
          <div style="text-align: center;">
            <div style="width: 4mm; height: 4mm; background: white; border: 0.4pt solid var(--slate-300); border-radius: 0.3mm;"></div>
            <span style="font-size: 7pt; color: var(--slate-500); display: block; margin-top: 1mm;">16px</span>
          </div>
        </div>
        <h4 class="h4" style="margin-top: 4mm;">Favicon</h4>
        <p style="font-size: 8.5pt; margin: 0;">Размеры 16, 32, 180, 512 px. На прозрачном или белом фоне.</p>
      </div>

      <div>
        <div style="background: white; border: 0.6pt solid var(--slate-200); aspect-ratio: 1.91/1; border-radius: 2mm; padding: 8mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3mm;">
          <img src="${a.lockupBlack}" alt="" style="height: 18mm;" />
          <div style="font-family: 'Manrope', sans-serif; font-weight: 600; font-size: 9pt; color: var(--slate-500); letter-spacing: 0.05em;">снова в фокусе</div>
        </div>
        <h4 class="h4" style="margin-top: 4mm;">OG image / Social share</h4>
        <p style="font-size: 8.5pt; margin: 0;">1200×630 px. Lockup по центру + tagline снизу. Белый фон. Используется как preview-картинка в WhatsApp, Telegram, Facebook, Instagram при шеринге ссылок refocus.kg.</p>
      </div>
    </div>

    ${pf('15')}
  </section>`;
}

// ─── PAGE 16: PRIMARY PALETTE ─────────────────────────────────────────────────
function Page16_PrimaryPalette(_a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Основная палитра')}
    <div class="section-num">15 — Цвет</div>
    <h1 class="section-title">Три цвета бренда</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Refocus строится на трёх основных цветах. Cyan — наш голос.
      Slate — наша опора. Белый — наше дыхание.
    </p>

    <div class="grid-3" style="gap: 5mm;">
      <div class="swatch">
        <div class="swatch-color" style="background: #22D3EE;"></div>
        <div class="swatch-info">
          <p class="swatch-name">Refocus Cyan</p>
          <p class="swatch-role">Primary · Акцент</p>
          <div class="swatch-codes">
            HEX  #22D3EE<br>
            RGB  34 / 211 / 238<br>
            CMYK 56 / 0 / 14 / 0<br>
            Pantone 305 C
          </div>
          <p style="font-size: 8pt; color: var(--slate-500); margin-top: 3mm; line-height: 1.45;">Голос бренда. Кнопки, акценты, ссылки, фирменный градиент, App icon, циановый футляр.</p>
        </div>
      </div>

      <div class="swatch">
        <div class="swatch-color" style="background: #0F172A;"></div>
        <div class="swatch-info">
          <p class="swatch-name">Refocus Slate</p>
          <p class="swatch-role">Dark · Текст · Фон</p>
          <div class="swatch-codes">
            HEX  #0F172A<br>
            RGB  15 / 23 / 42<br>
            CMYK 96 / 86 / 49 / 68<br>
            Pantone Black 6 C
          </div>
          <p style="font-size: 8pt; color: var(--slate-500); margin-top: 3mm; line-height: 1.45;">Опора бренда. Основной текст, тёмные стены точки, тёмно-синий футляр, тёмная тема приложения.</p>
        </div>
      </div>

      <div class="swatch">
        <div class="swatch-color" style="background: #FFFFFF; border: 0.6pt solid var(--slate-200);"></div>
        <div class="swatch-info">
          <p class="swatch-name">White</p>
          <p class="swatch-role">Воздух · Фон</p>
          <div class="swatch-codes">
            HEX  #FFFFFF<br>
            RGB  255 / 255 / 255<br>
            CMYK 0 / 0 / 0 / 0<br>
            Pantone Pure White
          </div>
          <p style="font-size: 8pt; color: var(--slate-500); margin-top: 3mm; line-height: 1.45;">Дыхание бренда. Белый фон витрин, светлый интерьер, белая премиум-упаковка, web и print фон.</p>
        </div>
      </div>
    </div>

    <div style="margin-top: 7mm;">
      <h4 class="h4">Соотношение 60-30-10 в материалах</h4>
      <div style="display: flex; height: 14mm; border-radius: 3mm; overflow: hidden; margin-top: 3mm;">
        <div style="flex: 60; background: white; border: 0.6pt solid var(--slate-200); display: flex; align-items: center; justify-content: center; font-size: 9pt; color: var(--slate-700); font-weight: 600;">60% White</div>
        <div style="flex: 30; background: var(--slate-900); display: flex; align-items: center; justify-content: center; font-size: 9pt; color: white; font-weight: 600;">30% Slate</div>
        <div style="flex: 10; background: var(--cyan); display: flex; align-items: center; justify-content: center; font-size: 9pt; color: var(--slate-900); font-weight: 700;">10% Cyan</div>
      </div>
      <p style="font-size: 9pt; color: var(--slate-600); margin-top: 2.5mm;">
        <strong>Базовое правило композиции.</strong> Белый — основной фон и воздух (60%). Slate — текст и тёмные акценты (30%). Cyan — точечный акцент: кнопки, ссылки, ключевые элементы (10%). Если cyan занимает больше 10% — материал перегружен и кричит.
      </p>
    </div>

    <div style="margin-top: 6mm;" class="card tinted">
      <h4 class="h4">Откуда эта палитра</h4>
      <p style="font-size: 9pt; margin: 0;">
        Cyan — цвет современных оптических технологий: бликующее покрытие на просветлённых линзах, отражение в стекле, цвет неба сквозь чистое зрение. Slate — глубина, доверие, медицинская сдержанность. White — клинический свет, прозрачность процессов. Эта тройка — оптика нового поколения, не «тёплая старая аптека».
      </p>
    </div>

    ${pf('16')}
  </section>`;
}

// ─── PAGE 16b: OFFICIAL PALETTE POSTER ────────────────────────────────────────
function Page16b_PalettePoster(a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Палитра — плакат')}
    <div class="section-num">16 — Цвет</div>
    <h1 class="section-title">Официальный плакат палитры</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Канонический визуал палитры Refocus. Используется как референс для
      типографий, дизайнеров наружной рекламы и веб-разработчиков.
      Файл прилагается к брендовому пакету ассетов.
    </p>
    <div style="margin-top: 4mm; border: 1pt solid var(--slate-200); border-radius: 4mm; overflow: hidden; background: white;">
      <!-- Обрезаем нижние ~6% картинки чтобы убрать watermark «coolors» -->
      <img src="${a.palette}" alt="Оптика Refocus Палитра" style="width: 100%; display: block; clip-path: inset(0 0 6.5% 0); margin-bottom: -7%;" />
    </div>
    <p style="font-size: 8.5pt; color: var(--slate-500); text-align: center; margin-top: 3mm; letter-spacing: 0.05em;">
      Файл: <code>Оптика Refocus Палитра.png</code> · в брендовом пакете ассетов
    </p>
    ${pf('17')}
  </section>`;
}

// ─── PAGE 17: SECONDARY / FUNCTIONAL PALETTE ──────────────────────────────────
function Page17_SecondaryPalette(_a: BrandbookAssets): string {
  const swatches = [
    { name: 'Sky-100',   hex: '#E0F2FE', rgb: '224 / 242 / 254', role: 'Светлые фоны, плашки', tone: 'pale' },
    { name: 'Slate-100', hex: '#F1F5F9', rgb: '241 / 245 / 249', role: 'Подложки, разделители', tone: 'pale' },
    { name: 'Slate-500', hex: '#64748B', rgb: '100 / 116 / 139', role: 'Secondary текст, captions', tone: 'mid' },
    { name: 'Emerald',   hex: '#10B981', rgb: '16 / 185 / 129',  role: 'Успех, готовность', tone: 'mid' },
    { name: 'Rose',      hex: '#F43F5E', rgb: '244 / 63 / 94',   role: 'Ошибка, нарушение', tone: 'mid' },
    { name: 'Amber',     hex: '#F59E0B', rgb: '245 / 158 / 11',  role: 'Предупреждение', tone: 'mid' },
  ];
  return `<section class="page">
    ${ph('Поддерживающая палитра')}
    <div class="section-num">18 — Цвет</div>
    <h1 class="section-title">Функциональные цвета</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Шесть цветов поддерживают основную палитру в интерфейсах CRM, POS, мобильного приложения и в брендовых документах.
      Каждый цвет означает что-то конкретное — нельзя использовать «потому что красиво».
    </p>

    <div class="grid-3" style="gap: 4mm;">
      ${swatches.map(s => `
        <div class="swatch">
          <div class="swatch-color" style="background: ${s.hex}; height: 30mm; ${s.tone === 'pale' ? 'border-bottom: 0.6pt solid var(--slate-200);' : ''}"></div>
          <div class="swatch-info" style="padding: 4mm 5mm;">
            <p class="swatch-name" style="font-size: 11pt;">${s.name}</p>
            <p class="swatch-role" style="font-size: 8.5pt; margin: 1mm 0 2mm;">${s.role}</p>
            <div class="swatch-codes" style="font-size: 7.5pt; line-height: 1.55;">
              ${s.hex}<br>RGB ${s.rgb}
            </div>
          </div>
        </div>
      `).join('')}
    </div>

    <div style="margin-top: 6mm;">
      <h4 class="h4">Где какой цвет</h4>
      <table class="tone-table">
        <thead><tr><th>Цвет</th><th>Только для</th><th>Никогда не</th></tr></thead>
        <tbody>
          <tr><td><strong>Sky-100</strong></td><td>светлые фоновые плашки, обводки карточек</td><td>текст (нечитаемо)</td></tr>
          <tr><td><strong>Slate-500</strong></td><td>secondary текст, подписи, captions</td><td>основной заголовок (используем slate-900)</td></tr>
          <tr><td><strong>Emerald</strong></td><td>статусы «готово / успех», галочки выполнения</td><td>акция, скидка, реклама</td></tr>
          <tr><td><strong>Rose</strong></td><td>ошибка, удаление, нарушение, кнопки destructive</td><td>любая позитивная коммуникация</td></tr>
          <tr><td><strong>Amber</strong></td><td>предупреждение, требует внимания, «не сохранено»</td><td>основной фон или текст</td></tr>
        </tbody>
      </table>
    </div>

    <div style="margin-top: 5mm;" class="card tinted">
      <h4 class="h4">Чего нет в палитре</h4>
      <p style="font-size: 9pt; margin: 0;">
        Refocus сознательно <strong>не использует</strong>: фиолетовый, оранжевый-яркий, жёлтый-яркий, розовый, неон. Палитра умышленно холодная и сдержанная — это часть позиционирования «спокойная медицинская оптика», не «весёлый магазин аксессуаров».
      </p>
    </div>

    ${pf('17')}
  </section>`;
}

// ─── PAGE 18: BRAND GRADIENT + ACCESSIBILITY ──────────────────────────────────
function Page18_GradientAccessibility(_a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Градиент и контраст')}
    <div class="section-num">17 — Цвет</div>
    <h1 class="section-title">Брендовый градиент</h1>
    <div class="brand-rule"></div>

    <div style="height: 38mm; border-radius: 4mm; background: linear-gradient(90deg, #14B8A6 0%, #22D3EE 55%, #38BDF8 100%); margin-bottom: 4mm; position: relative; box-shadow: 0 4mm 18mm rgba(34,211,238,0.20);">
      <div style="position: absolute; bottom: -3mm; left: 4mm; background: white; padding: 1mm 3mm; border-radius: 1mm; font-family: monospace; font-size: 7.5pt; color: var(--slate-700); border: 0.4pt solid var(--slate-200);">#14B8A6</div>
      <div style="position: absolute; bottom: -3mm; left: 50%; transform: translateX(-50%); background: white; padding: 1mm 3mm; border-radius: 1mm; font-family: monospace; font-size: 7.5pt; color: var(--slate-700); border: 0.4pt solid var(--slate-200);">#22D3EE · 55%</div>
      <div style="position: absolute; bottom: -3mm; right: 4mm; background: white; padding: 1mm 3mm; border-radius: 1mm; font-family: monospace; font-size: 7.5pt; color: var(--slate-700); border: 0.4pt solid var(--slate-200);">#38BDF8</div>
    </div>

    <div class="grid-2" style="margin-top: 8mm;">
      <div class="card">
        <h4 class="h4" style="color: var(--emerald);">✓ Где применять</h4>
        <ul class="bullets" style="margin-top: 2mm;">
          <li>Тонкие полоски-разделители (4pt высоты)</li>
          <li>Hero-блоки сайта и приложения</li>
          <li>Прогресс-бары</li>
          <li>Полоса под логотипом на cover-страницах</li>
          <li>App splash screen</li>
        </ul>
      </div>
      <div class="card">
        <h4 class="h4" style="color: var(--rose);">× Где НЕ применять</h4>
        <ul class="bullets" style="margin-top: 2mm;">
          <li>Полноразмерный фон страницы</li>
          <li>Подложка под текст (нарушает читаемость)</li>
          <li>Кнопки (используем сплошной cyan-500)</li>
          <li>Менять угол (всегда 90°, горизонтально)</li>
          <li>Менять stop-цвета или их позиции</li>
        </ul>
      </div>
    </div>

    <h3 class="h3" style="margin-top: 8mm;">Контрастность (WCAG AA)</h3>
    <table class="tone-table">
      <thead><tr><th>Пара</th><th>Контраст</th><th>WCAG AA текст</th></tr></thead>
      <tbody>
        <tr><td>Slate-900 на White</td><td>15.85 : 1</td><td class="yes">✓ Проходит</td></tr>
        <tr><td>White на Slate-900</td><td>15.85 : 1</td><td class="yes">✓ Проходит</td></tr>
        <tr><td>White на Cyan-500</td><td>2.04 : 1</td><td class="no">× Только крупный текст ≥18pt</td></tr>
        <tr><td>Slate-900 на Cyan-500</td><td>7.78 : 1</td><td class="yes">✓ Проходит</td></tr>
        <tr><td>Slate-500 на White</td><td>4.78 : 1</td><td class="yes">✓ Проходит для нормального текста</td></tr>
        <tr><td>Slate-300 на White</td><td>1.85 : 1</td><td class="no">× Не использовать для текста</td></tr>
      </tbody>
    </table>

    ${pf('18')}
  </section>`;
}

// ─── PAGE 19: MANROPE ──────────────────────────────────────────────────────────
function Page19_Manrope(_a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Manrope — основной шрифт')}
    <div class="section-num">18 — Типографика</div>
    <h1 class="section-title">Manrope</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Шрифт всех материалов Refocus. Современный, чистый, geometric sans-serif.
      Хорошо читается на экране и в печати, поддерживает кириллицу.
    </p>

    <div style="margin-top: 6mm;">
      <div class="type-sample">
        <div class="type-sample-meta">Manrope · 400 Regular</div>
        <div style="font-family: 'Manrope', sans-serif; font-weight: 400; font-size: 22pt; color: var(--slate-900); letter-spacing: -0.015em;">Refocus — оптика нового поколения</div>
      </div>
      <div class="type-sample">
        <div class="type-sample-meta">Manrope · 500 Medium</div>
        <div style="font-family: 'Manrope', sans-serif; font-weight: 500; font-size: 22pt; color: var(--slate-900); letter-spacing: -0.015em;">Refocus — оптика нового поколения</div>
      </div>
      <div class="type-sample">
        <div class="type-sample-meta">Manrope · 600 SemiBold</div>
        <div style="font-family: 'Manrope', sans-serif; font-weight: 600; font-size: 22pt; color: var(--slate-900); letter-spacing: -0.02em;">Refocus — оптика нового поколения</div>
      </div>
      <div class="type-sample">
        <div class="type-sample-meta">Manrope · 700 Bold</div>
        <div style="font-family: 'Manrope', sans-serif; font-weight: 700; font-size: 22pt; color: var(--slate-900); letter-spacing: -0.02em;">Refocus — оптика нового поколения</div>
      </div>
      <div class="type-sample">
        <div class="type-sample-meta">Manrope · 800 ExtraBold · для крупных заголовков</div>
        <div style="font-family: 'Manrope', sans-serif; font-weight: 800; font-size: 28pt; color: var(--slate-900); letter-spacing: -0.025em;">ABCDEFGH абвгдежзи</div>
      </div>
    </div>

    ${pf('19')}
  </section>`;
}

// ─── PAGE 20: REFOCUS DISPLAY ─────────────────────────────────────────────────
function Page20_RefocusDisplay(_a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Фирменный шрифт')}
    <div class="section-num">21 — Типографика</div>
    <h1 class="section-title">Pawelt — фирменный шрифт</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Фирменное начертание логотипа. <strong>Каноническое имя шрифта — «Pawelt»</strong>
      (так оно подписано в шрифтовых каталогах и в файле <code>pavelt-jrjpm.ttf</code>).
      Внутри Refocus используем псевдоним <strong>«RefocusDisplay»</strong> — оба названия означают
      один и тот же шрифт. Применяется только для логотипа, обложек и крупных hero-надписей.
      Никогда — для тела текста, кнопок или интерфейсов.
    </p>

    <div style="background: var(--slate-50); padding: 14mm; border-radius: 4mm; text-align: center; margin: 6mm 0;">
      <div style="font-family: 'RefocusBrand', sans-serif; font-size: 80pt; line-height: 0.95; color: var(--slate-900); letter-spacing: 0.005em;">refocus</div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h4 class="h4" style="color: var(--emerald);">✓ Использовать для</h4>
        <ul class="bullets" style="margin-top: 2mm;">
          <li>Логотип Refocus</li>
          <li>Cover-страницы документов и презентаций</li>
          <li>Hero-надписи на стенах точки</li>
          <li>Большие баннеры на витрине</li>
          <li>Главная вывеска</li>
        </ul>
      </div>
      <div class="card">
        <h4 class="h4" style="color: var(--rose);">× Не использовать для</h4>
        <ul class="bullets" style="margin-top: 2mm;">
          <li>Тела текста</li>
          <li>Кнопок и форм</li>
          <li>Подписей, captions</li>
          <li>Названий разделов в документах</li>
          <li>Интерфейсов CRM, POS, мобильного приложения</li>
        </ul>
      </div>
    </div>

    <div style="margin-top: 8mm;" class="card">
      <h4 class="h4">Файл и доступ</h4>
      <p style="font-size: 9pt; margin: 0;">Файл <strong>pavelt-jrjpm.ttf</strong> (искать как <strong>«Pawelt»</strong>) входит в брендовый пакет ассетов. Скачать через брендовую команду: <strong>refocus.kg@gmail.com</strong>. Передача шрифта третьим лицам без разрешения HQ запрещена.</p>
    </div>

    ${pf('20')}
  </section>`;
}

// ─── PAGE 21: TYPOGRAPHY HIERARCHY ─────────────────────────────────────────────
function Page21_TypographyHierarchy(_a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Иерархия')}
    <div class="section-num">20 — Типографика</div>
    <h1 class="section-title">Иерархия шрифтов</h1>
    <div class="brand-rule"></div>

    <table class="tone-table">
      <thead><tr><th style="width: 22%;">Уровень</th><th style="width: 18%;">Вес / стиль</th><th style="width: 15%;">UI размер</th><th style="width: 15%;">Print размер</th><th>Пример</th></tr></thead>
      <tbody>
        <tr>
          <td><strong>Display</strong></td>
          <td>RefocusDisplay 400</td>
          <td>56-110px</td>
          <td>32-110pt</td>
          <td><span style="font-family: 'RefocusBrand', sans-serif; font-size: 22pt;">refocus</span></td>
        </tr>
        <tr>
          <td><strong>H1</strong></td>
          <td>Manrope 800</td>
          <td>32-48px</td>
          <td>24-32pt</td>
          <td><span style="font-family: 'Manrope'; font-weight: 800; font-size: 16pt; letter-spacing: -0.025em;">Главный заголовок</span></td>
        </tr>
        <tr>
          <td><strong>H2</strong></td>
          <td>Manrope 700</td>
          <td>24-32px</td>
          <td>18-24pt</td>
          <td><span style="font-family: 'Manrope'; font-weight: 700; font-size: 13pt; letter-spacing: -0.02em;">Раздел</span></td>
        </tr>
        <tr>
          <td><strong>H3</strong></td>
          <td>Manrope 700</td>
          <td>18-22px</td>
          <td>13-16pt</td>
          <td><span style="font-family: 'Manrope'; font-weight: 700; font-size: 11pt; letter-spacing: -0.015em;">Подраздел</span></td>
        </tr>
        <tr>
          <td><strong>Body Large</strong></td>
          <td>Manrope 400</td>
          <td>16-18px</td>
          <td>11-12pt</td>
          <td><span style="font-family: 'Manrope'; font-weight: 400; font-size: 10pt;">Основной читаемый текст для лонгридов</span></td>
        </tr>
        <tr>
          <td><strong>Body</strong></td>
          <td>Manrope 400</td>
          <td>14-15px</td>
          <td>9.5-10.5pt</td>
          <td><span style="font-family: 'Manrope'; font-weight: 400; font-size: 9pt;">Стандартный текст в интерфейсе и документах</span></td>
        </tr>
        <tr>
          <td><strong>Caption</strong></td>
          <td>Manrope 600 UPPERCASE</td>
          <td>11-12px</td>
          <td>7.5-8pt</td>
          <td><span style="font-family: 'Manrope'; font-weight: 600; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.18em;">Метка раздела</span></td>
        </tr>
        <tr>
          <td><strong>Button</strong></td>
          <td>Manrope 600</td>
          <td>13-14px</td>
          <td>—</td>
          <td><span style="background: var(--cyan); color: white; padding: 1.5mm 4mm; border-radius: 2mm; font-family: 'Manrope'; font-weight: 600; font-size: 9pt;">Действие</span></td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top: 8mm;" class="card tinted">
      <h4 class="h4">Локализация: 4 страны, разные алфавиты</h4>
      <p style="font-size: 9pt; margin-bottom: 2mm;">Manrope покрывает <strong>русский, кыргызский, казахский, узбекский (латиница и кириллица)</strong>. Никаких отдельных «национальных» шрифтов не требуется — единый канон во всех странах.</p>
      <p style="font-size: 9pt; margin: 0;">Имя «Refocus» <strong>никогда не транслитерируется</strong> ни на один локальный язык.</p>
    </div>

    ${pf('21')}
  </section>`;
}

// ─── PAGE 22: ICONOGRAPHY ─────────────────────────────────────────────────────
function Page22_Iconography(_a: BrandbookAssets): string {
  // Реальные иконки из CRM-навигации (Sidebar) + специфичные для оптики.
  // Все из lucide-react, отрисованы как inline SVG для PDF.
  const navIcons: { name: string; label: string; svg: string }[] = [
    { name: 'ReceiptText',   label: 'Сверка выручки', svg: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1L4 2z"/><path d="M14 8H8"/><path d="M16 12H8"/><path d="M13 16H8"/>' },
    { name: 'PackageCheck',  label: 'Заказы',         svg: '<path d="M16 16l2 2 4-4"/><path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14"/><path d="M16.5 9.4 7.55 4.24"/><path d="M3.29 7 12 12l8.71-5"/><path d="M12 22V12"/>' },
    { name: 'Users',         label: 'Клиенты',        svg: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
    { name: 'Boxes',         label: 'Склад',          svg: '<path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42z"/><path d="M7 16.5l-4.74-2.85"/><path d="M7 16.5v5.17"/><path d="M7 16.5l5-3"/><path d="M14 7.5V11"/><path d="M14 7.5l5-3 5 3v3.5"/><path d="M22 16.92a2 2 0 0 1-.97 1.71l-3 1.8a2 2 0 0 1-2.06 0L12 19v-5.5l5-3 4.03 2.42a2 2 0 0 1 .97 1.71v3.29z"/>' },
    { name: 'WalletCards',   label: 'Зарплаты',       svg: '<rect x="2" y="6" width="20" height="14" rx="2"/><path d="M14 2v4"/><path d="M2 10h20"/>' },
    { name: 'LineChart',     label: 'Статистика',     svg: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>' },
    { name: 'BrainCircuit',  label: 'AI-центр',       svg: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M9 13a4.5 4.5 0 0 0 3-4"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M12 13h4"/><path d="M12 18h6a2 2 0 0 1 2 2v1"/><path d="M12 8h8"/><path d="M16 8V5a2 2 0 0 1 2-2"/><circle cx="16" cy="13" r=".5"/><circle cx="18" cy="3" r=".5"/><circle cx="20" cy="21" r=".5"/><circle cx="20" cy="8" r=".5"/>' },
    { name: 'MessageCircle', label: 'WhatsApp',       svg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
    { name: 'Map',           label: 'Карта системы',  svg: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>' },
    { name: 'Globe',         label: 'Карта франшизы', svg: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>' },
    { name: 'BookOpen',      label: 'Брендбук',       svg: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>' },
    { name: 'Bell',          label: 'Уведомления',    svg: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>' },
    { name: 'Settings2',     label: 'Настройки',      svg: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>' },
    { name: 'Eye',           label: 'Зрение',         svg: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>' },
    { name: 'Glasses',       label: 'Очки',           svg: '<circle cx="6" cy="15" r="4"/><circle cx="18" cy="15" r="4"/><path d="M14 15a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/><path d="M2.5 13 5 7c.7-1.3 1.4-2 3-2"/><path d="M21.5 13 19 7c-.7-1.3-1.5-2-3-2"/>' },
    { name: 'FlaskConical',  label: 'Линзы',          svg: '<path d="M10 2v7.31"/><path d="M14 9.3V1.99"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/><path d="M5.52 16h12.96"/>' },
  ];

  return `<section class="page">
    ${ph('Иконография')}
    <div class="section-num">21 — Иконы</div>
    <h1 class="section-title">Иконы Refocus</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Единственный одобренный набор — <strong>lucide-react</strong> (<span style="color: var(--cyan-deep);">lucide.dev</span>).
      Чистые, тонкие, geometric — идеальная пара к Manrope. Ниже — реальный набор,
      используемый в навигации Refocus CRM, плюс отраслевые иконки для оптики.
    </p>

    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin: 4mm 0 6mm;">
      ${navIcons.map(ic => `
        <div style="background: var(--slate-50); border-radius: 3mm; padding: 4mm 3mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2mm; min-height: 30mm;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0F172A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ic.svg}</svg>
          <div style="font-size: 7pt; color: var(--slate-500); text-align: center; line-height: 1.3; font-weight: 600;">${ic.label}</div>
          <div style="font-family: 'Courier New', monospace; font-size: 6pt; color: var(--slate-400);">${ic.name}</div>
        </div>
      `).join('')}
    </div>

    <div class="grid-2" style="gap: 5mm;">
      <div class="card">
        <h4 class="h4">Стандарт</h4>
        <ul class="bullets" style="margin-top: 2mm;">
          <li>Толщина линии: <strong>2px</strong></li>
          <li>Закругления: <strong>round caps + round joins</strong></li>
          <li>Сетка: <strong>24×24 viewBox</strong></li>
          <li>Размеры: 16 / 18 / 20 / 24 / 32 / 40 / 48 px</li>
        </ul>
      </div>
      <div class="card">
        <h4 class="h4" style="color: var(--rose);">Запреты</h4>
        <ul class="bullets crosses" style="margin-top: 2mm;">
          <li>Смешивать с heroicons, FontAwesome, react-icons</li>
          <li>Перерисовывать вручную / искажать</li>
          <li>Заполнять монохромные иконки цветом</li>
          <li>Использовать эмодзи в интерфейсе вместо иконок</li>
        </ul>
      </div>
    </div>

    <div style="margin-top: 5mm; padding: 5mm 6mm; background: var(--sky-50); border-radius: 3mm; display: flex; align-items: center; gap: 6mm;">
      <div style="display: inline-flex; align-items: center; justify-content: center; width: 14mm; height: 14mm; background: var(--cyan); border-radius: 3.5mm; box-shadow: 0 2mm 6mm rgba(34,211,238,0.40); flex-shrink: 0;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
      </div>
      <div style="flex: 1;">
        <h4 class="h4" style="margin-bottom: 1mm;">Эталонный «Refocus tile»</h4>
        <p style="font-size: 9pt; margin: 0;">Иконка 5×5 (20pt) внутри cyan-квадрата 10×10 (40pt) со скруглением 8pt и cyan-glow тенью. Используется в шапках страниц CRM, POS, Brand Guidelines.</p>
      </div>
    </div>

    ${pf('22')}
  </section>`;
}

// ─── PAGE 23: PHOTO STYLE ─────────────────────────────────────────────────────
function Page23_PhotoStyle(_a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Стиль фотографии')}
    <div class="section-num">22 — Фото</div>
    <h1 class="section-title">Как Refocus выглядит<br>на фотографиях</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Фотография — половина впечатления о бренде. Никаких стоковых картинок,
      никаких тёплых фильтров, никаких фальшивых улыбок.
    </p>

    <div class="grid-2" style="margin-top: 4mm;">
      <div class="card">
        <h4 class="h4">Что снимаем</h4>
        <ul class="bullets" style="margin-top: 2mm;">
          <li><strong>Точку</strong> — чистый интерьер, просторно, светло, спокойно</li>
          <li><strong>Продукт</strong> — оправы крупно на нейтральном фоне</li>
          <li><strong>Людей</strong> — настоящих клиентов и сотрудников, искренние моменты</li>
          <li><strong>Детали</strong> — мастерская, мастер за работой, рецепт, чистота</li>
        </ul>
      </div>
      <div class="card">
        <h4 class="h4">Технические правила</h4>
        <ul class="bullets" style="margin-top: 2mm;">
          <li><strong>Свет</strong> — естественный мягкий, без жёлтых филигранов</li>
          <li><strong>Цветокор</strong> — лёгкий, без HDR и Instagram-фильтров</li>
          <li><strong>Композиция</strong> — много воздуха, минимализм</li>
          <li><strong>Температура</strong> — холодная / нейтральная (5500K), под наш бренд</li>
        </ul>
      </div>
    </div>

    <div style="margin-top: 8mm;" class="card dark">
      <h4 class="h4" style="color: var(--rose);">Категорически нельзя</h4>
      <p style="font-size: 9.5pt; color: white;">
        <strong style="color: white;">Стоковые картинки</strong> — никогда. Клиент за километр чувствует фальшь.<br>
        <strong style="color: white;">AI-сгенерированные люди</strong> — нет, это нарушение доверия.<br>
        <strong style="color: white;">Ретушь до пластика</strong> — нет, наши клиенты — живые люди.<br>
        <strong style="color: white;">Тяжёлые цветные фильтры</strong> — нет, мы не Instagram-кафе.
      </p>
    </div>

    <div style="margin-top: 6mm;" class="card tinted">
      <h4 class="h4">Эталоны для вдохновения</h4>
      <p style="font-size: 9pt; margin: 0;">До формирования собственного фотобанка — равняемся на стиль <strong>Warby Parker</strong> и <strong>Ace & Tate</strong>: чистые, спокойные, документальные кадры с натуральным светом. Холодная палитра, минимум обработки, фокус на продукте и человеке.</p>
    </div>

    ${pf('23')}
  </section>`;
}

// ─── PAGE 24: PHOTO GALLERY (наши точки) ──────────────────────────────────────
function Page24_PhotoGallery(a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Эталон точки')}
    <div class="section-num">23 — Фото</div>
    <h1 class="section-title">Эталон оформления<br>точки Refocus</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Эти изображения — визуальный эталон того, как должна выглядеть точка Refocus
      изнутри. Тёмно-синяя верхняя зона (Slate-900), белые витрины, акцентный логотип.
    </p>

    <div class="gallery-2" style="margin-top: 4mm;">
      <div>
        <img src="${a.refs[0]}" alt="Точка Refocus — ресепшн" />
        <p class="gallery-cap">01 · Ресепшн с фирменным знаком и тач-экраном</p>
      </div>
      <div>
        <img src="${a.refs[3]}" alt="Точка Refocus — торговый зал" />
        <p class="gallery-cap">02 · Торговый зал с витринами оправ и центральным островом</p>
      </div>
      <div>
        <img src="${a.refs[2]}" alt="Точка Refocus — диагностическая зона" />
        <p class="gallery-cap">03 · Диагностическая зона с авторефом</p>
      </div>
      <div>
        <img src="${a.refs[5]}" alt="Точка Refocus — тач-экран" />
        <p class="gallery-cap">04 · Зона работы с фирменным сенсорным экраном</p>
      </div>
    </div>

    ${pf('24')}
  </section>`;
}

// ─── PAGE 25: PRINT COLLATERAL — РЕАЛЬНАЯ УПАКОВКА ────────────────────────────
function Page25_PrintCollateral(a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Стандартная упаковка')}
    <div class="section-num">24 — Применение</div>
    <h1 class="section-title">Упаковка — стандартный заказ</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Каждый заказ Refocus упаковывается в фирменный набор. Для обычных заказов —
      два цвета футляра на выбор клиента: фирменный cyan или тёмно-синий.
    </p>

    <div class="grid-2" style="gap: 6mm; margin-top: 4mm;">
      <div>
        <div style="background: var(--slate-50); border-radius: 4mm; padding: 4mm; display: flex; align-items: center; justify-content: center; min-height: 70mm;">
          <img src="${a.pack.casesTwo}" alt="Два футляра" style="max-width: 100%; max-height: 64mm;" />
        </div>
        <h4 class="h4" style="margin-top: 3mm;">Футляр для очков</h4>
        <p style="font-size: 9pt;"><strong>Два цвета:</strong> Refocus Cyan #22D3EE и Refocus Slate #0F172A. Клиент выбирает на этапе оформления. Чёрный лого RE+REFOCUS на верхней крышке. Жёсткий каркас, мягкая внутренняя обивка.</p>
      </div>

      <div>
        <div style="background: var(--slate-50); border-radius: 4mm; padding: 4mm; display: flex; align-items: center; justify-content: center; min-height: 70mm;">
          <img src="${a.pack.bagStandard}" alt="Пакет стандарт" style="max-width: 100%; max-height: 64mm;" />
        </div>
        <h4 class="h4" style="margin-top: 3mm;">Пакет фирменный</h4>
        <p style="font-size: 9pt;"><strong>Цвет:</strong> Cyan #22D3EE. Лого RE+REFOCUS белым, мягкие верёвочные ручки. Для всех стандартных заказов. На дне — фирменный сертификат подлинности.</p>
      </div>

      <div>
        <div style="background: var(--slate-50); border-radius: 4mm; padding: 4mm; display: flex; align-items: center; justify-content: center; min-height: 50mm;">
          <img src="${a.pack.clothStandard}" alt="Платочек стандарт" style="max-width: 100%; max-height: 44mm;" />
        </div>
        <h4 class="h4" style="margin-top: 3mm;">Салфетка для линз</h4>
        <p style="font-size: 9pt;"><strong>Цвет:</strong> Cyan + белый лого. Микрофибра, безворсовая. Кладётся в каждый футляр. Размер 18×18 см.</p>
      </div>

      <div>
        <div style="background: var(--slate-50); border-radius: 4mm; padding: 4mm; display: flex; align-items: center; justify-content: center; min-height: 50mm;">
          <img src="${a.pack.glasses}" alt="Очки готовые" style="max-width: 100%; max-height: 44mm;" />
        </div>
        <h4 class="h4" style="margin-top: 3mm;">Готовый продукт</h4>
        <p style="font-size: 9pt;">Очки попадают к клиенту в комплекте: оправа в фирменном футляре + салфетка + гарантийный талон + пакет. Всё единообразно во всех точках сети.</p>
      </div>
    </div>

    ${pf('25')}
  </section>`;
}

// ─── PAGE 25.5: PREMIUM PACKAGING ─────────────────────────────────────────────
function Page25b_PremiumPackaging(a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Премиум-набор')}
    <div class="section-num">25 — Применение</div>
    <h1 class="section-title">Упаковка — премиум-набор</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Премиум-заказы (премиальные оправы, специальные линзы, подарочные наборы) выдаются
      в полном фирменном наборе — белая палитра с чёрным лого, минимализм, ощущение качества.
    </p>

    <div style="background: var(--slate-50); border-radius: 4mm; padding: 6mm; margin-top: 4mm;">
      <img src="${a.pack.premiumSet}" alt="Премиум-набор Refocus" style="width: 100%; max-height: 100mm; object-fit: contain;" />
      <div style="font-size: 8pt; color: var(--slate-500); text-align: center; margin-top: 3mm; letter-spacing: 0.05em;">Полный премиум-набор: пакет, коробка для футляра, мини-коробка для салфетки, футляр, салфетка</div>
    </div>

    <div class="grid-4" style="margin-top: 6mm; gap: 3mm;">
      <div>
        <div style="background: var(--slate-50); border-radius: 2.5mm; padding: 3mm; min-height: 38mm; display: flex; align-items: center; justify-content: center;">
          <img src="${a.pack.bagPremium}" alt="" style="max-width: 100%; max-height: 32mm;" />
        </div>
        <h4 class="h4" style="margin-top: 2mm; font-size: 8.5pt;">Пакет премиум</h4>
        <p style="font-size: 7.5pt; margin: 0; color: var(--slate-600);">Белый, фактурная бумага, чёрный лого RE+REFOCUS</p>
      </div>
      <div>
        <div style="background: var(--slate-50); border-radius: 2.5mm; padding: 3mm; min-height: 38mm; display: flex; align-items: center; justify-content: center;">
          <img src="${a.pack.boxPremium}" alt="" style="max-width: 100%; max-height: 32mm;" />
        </div>
        <h4 class="h4" style="margin-top: 2mm; font-size: 8.5pt;">Коробка для футляра</h4>
        <p style="font-size: 7.5pt; margin: 0; color: var(--slate-600);">Жёсткий белый картон с тиснением логотипа</p>
      </div>
      <div>
        <div style="background: var(--slate-50); border-radius: 2.5mm; padding: 3mm; min-height: 38mm; display: flex; align-items: center; justify-content: center;">
          <img src="${a.pack.casePremium}" alt="" style="max-width: 100%; max-height: 32mm;" />
        </div>
        <h4 class="h4" style="margin-top: 2mm; font-size: 8.5pt;">Футляр премиум</h4>
        <p style="font-size: 7.5pt; margin: 0; color: var(--slate-600);">Кожаный, белый, с чёрным лого</p>
      </div>
      <div>
        <div style="background: var(--slate-50); border-radius: 2.5mm; padding: 3mm; min-height: 38mm; display: flex; align-items: center; justify-content: center;">
          <img src="${a.pack.clothBox}" alt="" style="max-width: 100%; max-height: 32mm;" />
        </div>
        <h4 class="h4" style="margin-top: 2mm; font-size: 8.5pt;">Мини-коробка для салфетки</h4>
        <p style="font-size: 7.5pt; margin: 0; color: var(--slate-600);">Для отдельной премиум-салфетки</p>
      </div>
    </div>

    <div style="margin-top: 5mm;" class="card tinted">
      <h4 class="h4">Когда выдаётся премиум-набор</h4>
      <p style="font-size: 9pt; margin: 0;">
        Автоматически: премиум-линзы (мультифокальные, поляризация, фотохромы),
        премиум-оправы (от __ ₽/с/₸/сум), все подарочные сертификаты от __ ₽,
        VIP-клиенты программы лояльности, возмещение по гарантии — на выбор клиента.
      </p>
    </div>

    ${pf('26')}
  </section>`;
}

// ─── PAGE 26: PRINT SPECS ─────────────────────────────────────────────────────
function Page26_PrintSpecs(_a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Print specs')}
    <div class="section-num">25 — Применение</div>
    <h1 class="section-title">Спецификации печати</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Параметры для типографий. Передавать вместе с макетом.
    </p>

    <div class="grid-2" style="gap: 6mm;">
      <div class="card">
        <h4 class="h4">Бумага</h4>
        <table style="width: 100%; font-size: 9pt;">
          <tr><td><strong>Визитки</strong></td><td>Touche Cover 250 г, матовая</td></tr>
          <tr><td><strong>Листовки A5</strong></td><td>Мелованная глянцевая 130 г</td></tr>
          <tr><td><strong>Буклеты</strong></td><td>Мелованная матовая 170 г</td></tr>
          <tr><td><strong>Гарантийные</strong></td><td>Мелованная 130 г</td></tr>
          <tr><td><strong>Сертификаты</strong></td><td>Картон 300 г + тиснение</td></tr>
          <tr><td><strong>Упаковка</strong></td><td>Чёрный картон 350 г + cyan фольга</td></tr>
        </table>
      </div>

      <div class="card">
        <h4 class="h4">Цвета и профили</h4>
        <table style="width: 100%; font-size: 9pt;">
          <tr><td><strong>Cyan #22D3EE</strong></td><td>Pantone 305 C</td></tr>
          <tr><td><strong>Slate #0F172A</strong></td><td>Pantone Black 6 C</td></tr>
          <tr><td><strong>CMYK профиль</strong></td><td>ISO Coated v2 (ECI)</td></tr>
          <tr><td><strong>Допуск ΔE</strong></td><td>≤ 3</td></tr>
          <tr><td><strong>Разрешение</strong></td><td>300 dpi (фото) / 600 dpi (вектор)</td></tr>
          <tr><td><strong>Bleed</strong></td><td>3 мм со всех сторон</td></tr>
        </table>
      </div>
    </div>

    <div style="margin-top: 8mm;" class="card tinted">
      <h4 class="h4">Перед сдачей в печать</h4>
      <ul class="bullets" style="margin-top: 2mm;">
        <li>Все шрифты переведены в кривые (outlined)</li>
        <li>Прикреплён тестовый PDF в CMYK ISO Coated v2</li>
        <li>На каждом макете — bleed marks и crop marks</li>
        <li>Пруф (proof) от типографии перед тиражом — обязательно</li>
        <li>HQ согласовывает финальный пруф перед запуском тиража</li>
      </ul>
    </div>

    ${pf('26')}
  </section>`;
}

// ─── PAGE 27: MOBILE APP — РЕАЛЬНЫЕ СКРИНЫ ───────────────────────────────────
function Page27_DigitalApps(a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Мобильное приложение')}
    <div class="section-num">26 — Применение</div>
    <h1 class="section-title">Refocus Mobile</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Приложение Refocus — главный канал постпродажного сопровождения клиента.
      Тёмно-синий бренд-фон, cyan акценты, фирменные тач-зоны.
      App ID: <code>kg.refocus.app</code>.
    </p>

    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin-top: 4mm;">
      <div>
        <div style="background: var(--slate-100); border-radius: 4mm; padding: 3mm; display: flex; align-items: center; justify-content: center; min-height: 90mm;">
          <img src="${a.app.lens1}" alt="" style="width: 100%; max-height: 84mm; object-fit: contain; border-radius: 2mm;" />
        </div>
        <p style="font-size: 7.5pt; color: var(--slate-500); text-align: center; margin: 2mm 0 0;">Карточка линзы</p>
      </div>
      <div>
        <div style="background: var(--slate-100); border-radius: 4mm; padding: 3mm; display: flex; align-items: center; justify-content: center; min-height: 90mm;">
          <img src="${a.app.lens2}" alt="" style="width: 100%; max-height: 84mm; object-fit: contain; border-radius: 2mm;" />
        </div>
        <p style="font-size: 7.5pt; color: var(--slate-500); text-align: center; margin: 2mm 0 0;">Описание + видео</p>
      </div>
      <div>
        <div style="background: var(--slate-100); border-radius: 4mm; padding: 3mm; display: flex; align-items: center; justify-content: center; min-height: 90mm;">
          <img src="${a.app.orderStage}" alt="" style="width: 100%; max-height: 84mm; object-fit: contain; border-radius: 2mm;" />
        </div>
        <p style="font-size: 7.5pt; color: var(--slate-500); text-align: center; margin: 2mm 0 0;">Этап заказа 6/7</p>
      </div>
      <div>
        <div style="background: var(--slate-100); border-radius: 4mm; padding: 3mm; display: flex; align-items: center; justify-content: center; min-height: 90mm;">
          <img src="${a.app.orderBag}" alt="" style="width: 100%; max-height: 84mm; object-fit: contain; border-radius: 2mm;" />
        </div>
        <p style="font-size: 7.5pt; color: var(--slate-500); text-align: center; margin: 2mm 0 0;">Финальная упаковка</p>
      </div>
    </div>

    <div class="grid-2" style="gap: 5mm; margin-top: 6mm;">
      <div class="card">
        <h4 class="h4">Дизайн-система приложения</h4>
        <ul class="bullets" style="margin-top: 2mm;">
          <li>Фон главных экранов — <strong>Slate-900 + cyan-glow</strong></li>
          <li>Карточки контента — <strong>тёмные с белым текстом</strong></li>
          <li>Акценты, кнопки, прогресс-бары — <strong>cyan #22D3EE</strong></li>
          <li>Шрифт интерфейса — <strong>Manrope</strong></li>
          <li>Иконки нижнего меню — <strong>lucide-react</strong>, 24px</li>
        </ul>
      </div>
      <div class="card">
        <h4 class="h4">Внутренние цифровые продукты</h4>
        <p style="font-size: 9pt; margin: 0;"><strong>Refocus CRM, POS, Kiosk</strong> — единая DNA: cyan акцент, slate-900 шапка, белые карточки с sky-100 обводкой, Manrope, lucide-react. Клиент не видит эти продукты, но они продолжают тот же визуальный язык.</p>
      </div>
    </div>

    ${pf('27')}
  </section>`;
}

// ─── PAGE 28: SOCIAL + EMAIL + MESSAGING ──────────────────────────────────────
function Page28_SocialEmail(_a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Соцсети, email, мессенджеры')}
    <div class="section-num">27 — Применение</div>
    <h1 class="section-title">Коммуникация с клиентом</h1>
    <div class="brand-rule"></div>

    <h3 class="h3">Шаблоны WhatsApp / SMS</h3>
    <p class="muted" style="font-size: 9pt;">Все автоматические сообщения должны звучать как один человек, в едином тоне Refocus. Запрет на CAPS, эмодзи через слово, восклицательные знаки в каждой фразе.</p>

    <div class="grid-2" style="gap: 5mm; margin-top: 4mm;">
      <div class="card tinted">
        <h4 class="h4">День 3 — «Как ваши очки?»</h4>
        <div style="background: white; padding: 4mm; border-radius: 2mm; font-size: 8.5pt; color: var(--slate-700); line-height: 1.6; margin-top: 2mm;">
          Здравствуйте, [имя]! Это Refocus, [филиал].<br><br>
          Как ваши новые очки — всё ли удобно, нет ли дискомфорта?<br><br>
          Если что-то беспокоит по зрению, посадке или ощущениям — просто ответьте на это сообщение, мы поможем.<br><br>
          Хорошего дня!
        </div>
      </div>
      <div class="card tinted">
        <h4 class="h4">День 12 — «Гарантия адаптации»</h4>
        <div style="background: white; padding: 4mm; border-radius: 2mm; font-size: 8.5pt; color: var(--slate-700); line-height: 1.6; margin-top: 2mm;">
          Здравствуйте! Через 2 дня у вас заканчивается 14-дневная гарантия адаптации на очки.<br><br>
          Если что-то не подошло по комфорту или посадке — можем бесплатно поменять оправу и линзы в той же ценовой категории. Просто заходите без записи.<br><br>
          А если всё хорошо — носите на здоровье.
        </div>
      </div>
    </div>

    <h3 class="h3" style="margin-top: 8mm;">Email-подпись сотрудника</h3>
    <div style="margin-top: 3mm; padding: 5mm 6mm; background: white; border: 0.4pt solid var(--slate-200); border-radius: 3mm; font-size: 9.5pt; color: var(--slate-700);">
      <div style="font-weight: 700; color: var(--slate-900);">Имя Фамилия</div>
      <div style="color: var(--slate-500); font-size: 8.5pt;">Должность</div>
      <div style="height: 0.4pt; background: var(--slate-200); margin: 2.5mm 0;"></div>
      <div style="display: flex; align-items: center; gap: 4mm;">
        <span style="font-family: 'RefocusBrand'; font-size: 14pt; color: var(--slate-900);">refocus</span>
        <div style="font-size: 8pt; color: var(--slate-500); line-height: 1.4;">refocus.kg<br>+996 700 000 000</div>
      </div>
    </div>

    <h3 class="h3" style="margin-top: 6mm;">Размеры для соцсетей</h3>
    <table class="tone-table" style="font-size: 8.5pt;">
      <thead><tr>
        <th style="width: 18%;">Платформа</th>
        <th style="width: 22%;">Формат</th>
        <th style="width: 22%;">Размер</th>
        <th style="width: 38%;">Обязательное</th>
      </tr></thead>
      <tbody>
        <tr><td><strong>Instagram</strong></td><td>Post квадрат</td><td>1080 × 1080</td><td>знак в правом нижнем углу</td></tr>
        <tr><td><strong>Instagram</strong></td><td>Story / Reels</td><td>1080 × 1920</td><td>safe area 250px сверху/снизу</td></tr>
        <tr><td><strong>Facebook</strong></td><td>Post</td><td>1200 × 630</td><td>знак или wordmark</td></tr>
        <tr><td><strong>Telegram</strong></td><td>Post</td><td>1280 × 720</td><td>знак или wordmark</td></tr>
        <tr><td><strong>TikTok</strong></td><td>Cover</td><td>1080 × 1920</td><td>safe zone ≥ 200px по краям</td></tr>
      </tbody>
    </table>

    ${pf('28')}
  </section>`;
}

// ─── PAGE 29: STORE EXPERIENCE ────────────────────────────────────────────────
function Page29_StoreExperience(a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Точка продаж')}
    <div class="section-num">28 — Применение</div>
    <h1 class="section-title">Атмосфера в точке</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Бренд — это не только что клиент видит, но и что слышит, чем дышит,
      как себя чувствует. Эти стандарты обязательны во всех точках сети.
    </p>

    <div class="gallery-2" style="margin-top: 4mm;">
      <div>
        <img src="${a.refs[1]}" alt="" />
        <p class="gallery-cap">Светлый интерьер с тёмной верхней зоной</p>
      </div>
      <div>
        <img src="${a.refs[4]}" alt="" />
        <p class="gallery-cap">Минималистичный торговый зал</p>
      </div>
    </div>

    <div class="grid-3" style="margin-top: 6mm;">
      <div class="card">
        <h4 class="h4">Звук</h4>
        <p style="font-size: 9pt;">Lo-fi, instrumental, ambient. Громкость — фон, не доминирует. <strong>Запрет:</strong> радио, попса, новости, реклама.</p>
      </div>
      <div class="card">
        <h4 class="h4">Свет</h4>
        <p style="font-size: 9pt;">Нейтральный белый <strong>5000K</strong>. Tракшен на витрины, общий свет — мягкий рассеянный. <strong>Запрет:</strong> жёлтые лампы 2700K, мигающие неоны.</p>
      </div>
      <div class="card">
        <h4 class="h4">Запах</h4>
        <p style="font-size: 9pt;">Нейтральный, чистый. Без аромадиффузоров с резкими нотами. Можно лёгкий цитрусовый, но в фоне. <strong>Запрет:</strong> ваниль, кофе, благовония.</p>
      </div>
    </div>

    <div style="margin-top: 6mm;" class="card tinted">
      <h4 class="h4">Customer journey в точке — точки бренд-контакта</h4>
      <p style="font-size: 9pt; margin: 0;">
        Вход (вывеска) → Встреча (голос продавца — тёплый, без давления) → Диагностика (профессиональный язык, объяснение что делаем) → Подбор оправы (без оценочных суждений) → Тач-экран Refocus (понятная демонстрация линз) → Оформление (фирменные документы) → Выдача (упаковка, салфетка для линз) → Постпродажа (мобильное приложение, WhatsApp follow-up).
      </p>
    </div>

    ${pf('29')}
  </section>`;
}

// ════════════════════════════════════════════════════════════════════════════
//  НОВЫЕ СТРАНИЦЫ И РЕДИЗАЙНЫ (v1.1)
// ════════════════════════════════════════════════════════════════════════════

// ─── SPLASH ── Универсальный разделитель частей ───────────────────────────────
function PageSplash(opts: { roman: string; eyebrow: string; title: string; desc: string; pageNum: string }): string {
  return `<section class="page splash">
    <div class="splash-part-num">${opts.roman}</div>
    <div class="splash-content">
      <div class="splash-eyebrow">${opts.eyebrow}</div>
      <div class="splash-rule"></div>
      <div class="splash-title">${opts.title}</div>
      <div class="splash-desc">${opts.desc}</div>
    </div>
    ${pf(opts.pageNum)}
  </section>`;
}

// ─── PAGE: МАНИФЕСТ БРЕНДА (тёмная) ──────────────────────────────────────────
function PageManifesto(_a: BrandbookAssets): string {
  return `<section class="page dark">
    <div class="glow-cyan" style="top: -60mm; right: -60mm;"></div>
    <div class="glow-emerald" style="bottom: -40mm; left: -40mm;"></div>
    ${ph('Манифест')}
    <div class="section-num">01 — Фундамент</div>
    <h1 class="section-title">Манифест Refocus</h1>
    <div class="brand-rule"></div>

    <div class="manifest-text">
      Мы верим, что зрение — <em>это право, не привилегия</em>.<br><br>
      Мы делаем диагностику <em>бесплатной</em>,<br>
      потому что человек должен видеть мир чётко<br>
      ещё до того, как заплатил.<br><br>
      Мы <em>объясняем</em>, не давим, не торопим.<br>
      Не продаём страх — продаём ясность.<br><br>
      Мы <em>остаёмся рядом</em> после покупки.<br>
      Очки готовы за день — а сервис длится годами.<br><br>
      Мы — не магазин. Мы — <em>оптика нового поколения</em>.
    </div>

    <div class="manifest-signature">refocus</div>
    ${pf('06')}
  </section>`;
}

// ─── PAGE: СУТЬ REFOCUS (РЕДИЗАЙН на тёмную) ─────────────────────────────────
function PageEssenceDark(_a: BrandbookAssets): string {
  return `<section class="page dark">
    <div class="glow-cyan" style="top: -50mm; right: -50mm;"></div>
    ${ph('Суть бренда')}
    <div class="section-num">02 — Фундамент</div>
    <h1 class="section-title">Суть Refocus</h1>
    <div class="brand-rule"></div>

    <div class="pull" style="border-left-color: var(--cyan); color: white; font-size: 18pt; margin: 6mm 0 10mm;">
      <em>Refocus</em> — технологичная оптика нового поколения,<br>
      где клиент получает <em>честную консультацию</em>, <em>современное решение</em><br>
      и <em>дружелюбный сервис</em>.
    </div>

    <div class="grid-2" style="margin-top: 4mm;">
      <div style="background: rgba(34,211,238,0.08); border: 1pt solid rgba(34,211,238,0.30); border-radius: 4mm; padding: 6mm;">
        <h4 class="h4" style="color: var(--cyan);">Внутри сети — про механизм</h4>
        <p style="font-size: 9.5pt; color: var(--slate-300); margin-top: 2mm;">
          Технологичная, стандартизированная, честная, единая инфраструктура.
          Это то, как мы устроены изнутри. Об этом говорим с франчайзи,
          сотрудниками, поставщиками.
        </p>
      </div>
      <div style="background: rgba(255,255,255,0.05); border: 1pt solid rgba(255,255,255,0.15); border-radius: 4mm; padding: 6mm;">
        <h4 class="h4" style="color: white;">Снаружи клиенту — про результат</h4>
        <p style="font-size: 9.5pt; color: white; margin-top: 2mm;">
          <strong style="color: var(--cyan);">«Здесь всё объясняют, не давят и не забывают после покупки».</strong>
          Это то, что чувствует клиент. Об этом говорим в рекламе,
          на витрине, в соцсетях, в разговоре продавца.
        </p>
      </div>
    </div>

    <div style="margin-top: 8mm; padding: 5mm 6mm; background: rgba(255,255,255,0.04); border-left: 3pt solid var(--cyan); border-radius: 0 3mm 3mm 0;">
      <p style="font-size: 11pt; margin: 0; color: white; font-weight: 500;">
        Перепутать нельзя. <strong>Клиент не покупает технологию — клиент покупает спокойствие.</strong>
      </p>
    </div>

    <div class="grid-3" style="margin-top: 8mm;">
      <div>
        <div style="font-size: 36pt; font-weight: 800; color: var(--cyan); line-height: 1; letter-spacing: -0.025em;">3</div>
        <div style="font-size: 8pt; color: var(--slate-400); text-transform: uppercase; letter-spacing: 0.20em; font-weight: 700; margin-top: 2mm;">Обещания клиенту</div>
        <p style="font-size: 9pt; color: var(--slate-300); margin: 2mm 0 0;">Доверие. Понятность. Сопровождение.</p>
      </div>
      <div>
        <div style="font-size: 36pt; font-weight: 800; color: var(--cyan); line-height: 1; letter-spacing: -0.025em;">4</div>
        <div style="font-size: 8pt; color: var(--slate-400); text-transform: uppercase; letter-spacing: 0.20em; font-weight: 700; margin-top: 2mm;">Страны присутствия</div>
        <p style="font-size: 9pt; color: var(--slate-300); margin: 2mm 0 0;">Кыргызстан, Россия, Казахстан, Узбекистан.</p>
      </div>
      <div>
        <div style="font-size: 36pt; font-weight: 800; color: var(--cyan); line-height: 1; letter-spacing: -0.025em;">∞</div>
        <div style="font-size: 8pt; color: var(--slate-400); text-transform: uppercase; letter-spacing: 0.20em; font-weight: 700; margin-top: 2mm;">Срок сервиса</div>
        <p style="font-size: 9pt; color: var(--slate-300); margin: 2mm 0 0;">Пожизненный бесплатный сервис на каждую пару.</p>
      </div>
    </div>

    ${pf('07')}
  </section>`;
}

// ─── PAGE: ЦЕННОСТИ (РЕДИЗАЙН: 1 hero + 3 supporting) ────────────────────────
function PageValuesV2(_a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Ценности')}
    <div class="section-num">03 — Фундамент</div>
    <h1 class="section-title">Четыре ценности</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Любое решение в бренде проходит проверку: соответствует ли оно нашим ценностям?
      Если нет — мы это не делаем, даже если экономически выгодно.
    </p>

    <div style="background: linear-gradient(135deg, var(--slate-900) 0%, var(--slate-800) 100%); border-radius: 4mm; padding: 10mm; color: white; margin-top: 4mm; position: relative; overflow: hidden;">
      <div style="position: absolute; top: -20mm; right: -20mm; width: 80mm; height: 80mm; border-radius: 50%; background: rgba(34,211,238,0.18); filter: blur(20mm);"></div>
      <div style="position: relative; display: flex; align-items: baseline; gap: 8mm;">
        <span style="font-size: 64pt; font-weight: 800; color: var(--cyan); line-height: 0.9; font-feature-settings: 'tnum';">01</span>
        <div>
          <h3 style="font-size: 22pt; font-weight: 800; color: white; margin: 0 0 2mm; letter-spacing: -0.025em;">Честность</h3>
          <div style="font-size: 11pt; color: var(--cyan); font-style: italic; margin-bottom: 4mm;">«Здесь меня не разведут»</div>
          <p style="font-size: 11pt; color: var(--slate-300); margin: 0; max-width: 130mm; line-height: 1.5;">
            Прозрачные цены. Объяснение опций без давления. Возможность сказать «нет» без последствий. AI-контроль качества разговоров продавцов. <strong style="color: white;">Главная ценность Refocus — клиент должен уйти с ощущением, что его не обманули.</strong>
          </p>
        </div>
      </div>
    </div>

    <div class="grid-3" style="margin-top: 6mm; gap: 4mm;">
      <div class="card" style="padding: 5mm;">
        <div style="font-size: 24pt; font-weight: 800; color: var(--cyan); line-height: 1; font-feature-settings: 'tnum';">02</div>
        <h4 class="h4" style="margin-top: 2mm;">Понятность</h4>
        <div style="font-size: 8pt; color: var(--slate-500); font-style: italic; margin-bottom: 2mm;">«Я наконец понял, за что плачу»</div>
        <p style="font-size: 9pt; margin: 0;">Тач-экран и обученные продавцы делают сложное простым. Клиент видит разницу между линзами.</p>
      </div>
      <div class="card" style="padding: 5mm;">
        <div style="font-size: 24pt; font-weight: 800; color: var(--cyan); line-height: 1; font-feature-settings: 'tnum';">03</div>
        <h4 class="h4" style="margin-top: 2mm;">Сопровождение</h4>
        <div style="font-size: 8pt; color: var(--slate-500); font-style: italic; margin-bottom: 2mm;">«После покупки не забыли»</div>
        <p style="font-size: 9pt; margin: 0;">WhatsApp через 3 дня · 14 дней замена · 60 дней гарантия рецепта · пожизненный сервис.</p>
      </div>
      <div class="card" style="padding: 5mm;">
        <div style="font-size: 24pt; font-weight: 800; color: var(--cyan); line-height: 1; font-feature-settings: 'tnum';">04</div>
        <h4 class="h4" style="margin-top: 2mm;">Технологичность</h4>
        <div style="font-size: 8pt; color: var(--slate-500); font-style: italic; margin-bottom: 2mm;">Невидимая, но работает на клиента</div>
        <p style="font-size: 9pt; margin: 0;">CRM, POS, мобильное приложение, AI-контроль. За кулисами, чтобы клиент чувствовал плавность сервиса.</p>
      </div>
    </div>

    ${pf('08')}
  </section>`;
}

// ─── PAGE: СЛОВАРЬ REFOCUS ────────────────────────────────────────────────────
function PageVoiceDictionary(_a: BrandbookAssets): string {
  const rows = [
    { yes: 'Подобрать линзы',           no: 'Втюхать линзы' },
    { yes: 'Бесплатная диагностика',    no: 'Бесплатная проверка глаз' },
    { yes: 'Заказ готов',               no: 'Срочно заберите' },
    { yes: 'Мы поможем',                no: 'Мы решим за вас' },
    { yes: 'Очки за 1–2 дня',           no: 'Быстро как нигде' },
    { yes: 'Современные линзы',         no: 'Лучшие линзы в мире' },
    { yes: 'Объясним разницу',          no: 'Берите вот эти, они круче' },
    { yes: 'Refocus',                   no: 'РеФокус, REFOCUS, ReFocus' },
    { yes: 'Заходите без записи',       no: 'Запишитесь обязательно' },
    { yes: 'Подсказать что-то?',        no: 'Что вам нужно?' },
    { yes: 'Премиум-линзы',             no: 'Дорогие линзы' },
    { yes: 'Вернуться за корректировкой', no: 'Принести на ремонт' },
  ];
  return `<section class="page">
    ${ph('Словарь Refocus')}
    <div class="section-num">08 — Голос</div>
    <h1 class="section-title">Словарь — что говорим, что нет</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Конкретные слова и формулировки. Применяются продавцами в точке,
      SMM в соцсетях, операторами в WhatsApp, копирайтерами в рекламе.
    </p>

    <table class="voc-table">
      <thead><tr><th style="width: 50%;">✓ Так говорим</th><th style="width: 50%;">× Так не говорим</th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td><span class="voc-yes">✓</span> ${r.yes}</td>
            <td><span class="voc-no">${r.no}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div style="margin-top: 6mm;" class="card tinted">
      <h4 class="h4">Главный лингвистический принцип</h4>
      <p style="font-size: 9.5pt; margin: 0;">
        Refocus говорит как <strong>образованный, спокойный профессионал</strong>, а не как продавец на рынке.
        Никогда не используем превосходные степени без подтверждения («лучшие», «самые крутые»),
        не давим срочностью, не оперируем эмоциями страха («не упустите!»). Объясняем — клиент сам решит.
      </p>
    </div>

    ${pf('14')}
  </section>`;
}

// ─── PAGE: CUSTOMER JOURNEY ───────────────────────────────────────────────────
function PageCustomerJourney(_a: BrandbookAssets): string {
  const steps = [
    { stage: 'Вход',          desc: 'Вывеска, входная группа' },
    { stage: 'Встреча',       desc: 'Тёплое приветствие без давления' },
    { stage: 'Диагностика',   desc: 'Бесплатно, на современном оборудовании' },
    { stage: 'Подбор оправы', desc: 'Без оценочных суждений' },
    { stage: 'Тач-экран',     desc: 'Понятное объяснение линз' },
    { stage: 'Оформление',    desc: 'Прозрачная цена, фирменные документы' },
    { stage: 'Выдача',        desc: 'Очки, футляр, салфетка, пакет, талон' },
    { stage: 'День 3',        desc: 'WhatsApp: «Как ваши очки?»' },
    { stage: 'День 12',       desc: 'WhatsApp: напоминание о гарантии' },
    { stage: 'Дальше',        desc: 'App, лояльность, история зрения' },
  ];
  const top = steps.slice(0, 5);
  const bottom = steps.slice(5);
  return `<section class="page">
    ${ph('Customer Journey')}
    <div class="section-num">28 — Применение</div>
    <h1 class="section-title">Customer Journey<br>в точке Refocus</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Каждое из 10 касаний — это бренд-touchpoint. Если хоть одно «провисает» —
      клиент чувствует разрыв и уходит с разочарованием.
    </p>

    <div class="journey-rail" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 3mm; margin-top: 4mm;">
      ${top.map((s, i) => `
        <div class="journey-step">
          <div class="dot">${i + 1}</div>
          <div class="stage">${s.stage}</div>
          <div class="desc">${s.desc}</div>
        </div>
      `).join('')}
    </div>

    <div class="journey-rail" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 3mm; margin-top: 8mm;">
      ${bottom.map((s, i) => `
        <div class="journey-step">
          <div class="dot">${i + 6}</div>
          <div class="stage">${s.stage}</div>
          <div class="desc">${s.desc}</div>
        </div>
      `).join('')}
    </div>

    <div class="grid-2" style="margin-top: 10mm; gap: 5mm;">
      <div class="card tinted">
        <h4 class="h4">Где живёт бренд</h4>
        <p style="font-size: 9pt; margin: 0;">В каждой точке — визуально, аудиально и текстуально. Логотип на вывеске → голос продавца на встрече → тач-экран в подборе → шрифт в чеке → дизайн пакета на выдаче → подпись Refocus в WhatsApp.</p>
      </div>
      <div class="card">
        <h4 class="h4" style="color: var(--rose);">Где бренд ломается</h4>
        <p style="font-size: 9pt; margin: 0;">Чаще всего — на встрече (агрессивный продавец) и на постпродаже (забыли отправить follow-up). Эти две точки — где франчайзи теряет клиентов больше всего.</p>
      </div>
    </div>

    ${pf('38')}
  </section>`;
}

// ─── PAGE: АВАТАР КЛИЕНТА ─────────────────────────────────────────────────────
function PageAvatar(_a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Аватар клиента')}
    <div class="section-num">29 — Применение</div>
    <h1 class="section-title">Кому мы пишем,<br>когда говорим Refocus</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Когда мы все понимаем, кто наш клиент — каждое решение в бренде становится проще.
    </p>

    <div style="background: linear-gradient(135deg, var(--slate-900) 0%, var(--slate-800) 100%); border-radius: 4mm; padding: 8mm 10mm; color: white; margin: 4mm 0; position: relative; overflow: hidden;">
      <div style="position: absolute; top: -30mm; right: -30mm; width: 100mm; height: 100mm; border-radius: 50%; background: rgba(34,211,238,0.20); filter: blur(30mm);"></div>
      <div style="position: relative;">
        <div style="font-size: 8pt; font-weight: 700; letter-spacing: 0.20em; text-transform: uppercase; color: var(--cyan); margin-bottom: 3mm;">Основной клиент</div>
        <h3 style="font-size: 20pt; font-weight: 800; color: white; margin: 0 0 4mm; letter-spacing: -0.015em; line-height: 1.1;">Айгуль, 34 года</h3>
        <p style="font-size: 10.5pt; color: var(--slate-200); max-width: 145mm; line-height: 1.55; margin: 0;">
          Менеджер среднего звена в банке. Двое детей. Зарабатывает достаточно, чтобы не считать каждую копейку, но недостаточно, чтобы покупать очки за 30 000 ₽ без раздумий. Уже носит очки 5 лет — сменила 2 пары. <strong style="color: white;">Не любит, когда давят, не любит, когда говорят свысока. Хочет, чтобы её просто послушали и помогли.</strong>
        </p>
      </div>
    </div>

    <div class="grid-2" style="gap: 5mm;">
      <div class="persona-card">
        <h4 class="h4">Что для неё важно</h4>
        <ul class="bullets" style="margin-top: 2mm;">
          <li>Качество — но без переплаты «за бренд»</li>
          <li>Чтобы продавец объяснил, не говорил по-медицински</li>
          <li>Возможность зайти без записи</li>
          <li>Заказ готов быстро (не неделю)</li>
          <li>Сервис после покупки</li>
        </ul>
      </div>
      <div class="persona-card">
        <h4 class="h4" style="color: var(--rose);">Чего она боится</h4>
        <ul class="bullets crosses" style="margin-top: 2mm;">
          <li>Что её обманут «навешав» дорогих опций</li>
          <li>Что цена в рекламе была не настоящая</li>
          <li>Что в случае проблемы её отправят «к производителю»</li>
          <li>Что очки будут готовы через 2 недели</li>
          <li>Что ребёнка-школьника поведут «на проверку зрения»</li>
        </ul>
      </div>
    </div>

    <div class="grid-2" style="margin-top: 5mm; gap: 5mm;">
      <div class="persona-card">
        <h4 class="h4">Где живёт</h4>
        <p style="font-size: 9pt; margin: 0;">Регионы наших стран — города 100K+. Спальные районы и центры. <strong>Главное:</strong> в шаговой доступности от точки Refocus или максимум 15 минут на машине.</p>
      </div>
      <div class="persona-card">
        <h4 class="h4">Что читает / смотрит</h4>
        <p style="font-size: 9pt; margin: 0;">Instagram (рилсы про детей и дом), Telegram (новости и распродажи), WhatsApp (с близкими). Не на TikTok, не на LinkedIn. Доверяет отзывам в 2GIS и Yandex Maps.</p>
      </div>
    </div>

    <div style="margin-top: 5mm;" class="card tinted">
      <h4 class="h4">Вторичные сегменты</h4>
      <p style="font-size: 9pt; margin: 0;">
        <strong>Подростки 14–18</strong> (приходят с родителями за первой парой) ·
        <strong>Мужчины 35–55</strong> (часто упрямы, нужна особенно тактичная подача) ·
        <strong>Пенсионеры 60+</strong> (мультифокальные линзы, требуют терпения).
        Все они узнают Refocus через Айгуль — она основной носитель сарафанного радио.
      </p>
    </div>

    ${pf('39')}
  </section>`;
}

// ─── PAGE: BRAND PROMISE / ГАРАНТИИ (тёмная) ─────────────────────────────────
function PageBrandPromise(_a: BrandbookAssets): string {
  return `<section class="page dark">
    <div class="glow-cyan" style="top: -50mm; right: -50mm;"></div>
    ${ph('Brand Promise')}
    <div class="section-num">30 — Применение</div>
    <h1 class="section-title">Brand Promise —<br>наши гарантии</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Это не пункты в договоре. Это <strong style="color: white;">обещание бренда</strong>,
      которое работает в каждой точке сети одинаково. Главный материальный
      носитель ценности «Сопровождение».
    </p>

    <div class="promise-row">
      <div class="promise-num">14</div>
      <div class="promise-text">
        <h3>Дней — адаптационная гарантия</h3>
        <p>В течение 14 дней с даты выдачи — полная замена оправы и линз по любой причине. Не привык, не понравился стиль, передумал, повредил сам. Один раз на каждую пару.</p>
      </div>
    </div>

    <div class="promise-row">
      <div class="promise-num">60</div>
      <div class="promise-text">
        <h3>Дней — гарантия рецепта</h3>
        <p>Бесплатная перепроверка зрения и переустановка линз, если выяснится, что подбор был неточным. Покрывает не «вам не понравилось», а объективную ошибку точки.</p>
      </div>
    </div>

    <div class="promise-row" style="border-bottom: none;">
      <div class="promise-num">∞</div>
      <div class="promise-text">
        <h3>Пожизненный бесплатный сервис</h3>
        <p>Подтяжка, регулировка посадки, замена винтиков и носовых упоров, мелкий ремонт, ультразвуковая чистка. Сколько бы лет ни прошло.</p>
      </div>
    </div>

    <div style="margin-top: 8mm; padding: 6mm; background: rgba(34,211,238,0.10); border-left: 3pt solid var(--cyan); border-radius: 0 3mm 3mm 0;">
      <p style="font-size: 10.5pt; margin: 0; color: white; font-weight: 500; line-height: 1.5;">
        <strong style="color: var(--cyan);">Не пугаемся возвратов и переделок.</strong>
        Совокупный расход на гарантии — 1–1,5% выручки точки. А лояльность,
        которую это создаёт — х5 к повторным покупкам и сарафанному радио.
      </p>
    </div>

    ${pf('40')}
  </section>`;
}

// ─── PAGE: KEY VISUALS — 6 чистых макетов ────────────────────────────────────
function PageKeyVisuals(a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Key Visuals')}
    <div class="section-num">34 — Применение</div>
    <h1 class="section-title">Key Visuals — макеты</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Эталонные макеты Refocus в шести ключевых форматах. Используются как референс
      для подрядчиков и SMM при создании новых материалов.
    </p>

    <!-- Верхний ряд: 3 равные колонки. Каждая ячейка = mockup с фиксированным aspect ratio. -->
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5mm; margin-top: 4mm;">

      <!-- 1. Instagram Post 1:1 — белый минималистичный -->
      <div>
        <div style="aspect-ratio: 1/1; border-radius: 2mm; background: white; box-shadow: 0 3mm 10mm rgba(15,23,42,0.18); padding: 6mm; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; position: relative;">
          <img src="${a.lockupBlack}" alt="" style="height: 9mm; width: auto;" />
          <div>
            <div style="font-family: 'Manrope', sans-serif; font-weight: 800; font-size: 13pt; line-height: 1.1; color: var(--slate-900); letter-spacing: -0.025em;">Очки готовы<br>за день.</div>
            <div style="height: 0.6pt; width: 10mm; background: var(--cyan); margin-top: 3mm;"></div>
            <div style="font-size: 6.5pt; color: var(--slate-500); margin-top: 1.5mm; letter-spacing: 0.05em;">Без записи · refocus.kg</div>
          </div>
        </div>
        <p class="kv-cap">Instagram Post · 1080×1080</p>
      </div>

      <!-- 2. Instagram Post — тёмный с большим тезисом -->
      <div>
        <div style="aspect-ratio: 1/1; border-radius: 2mm; background: var(--slate-900); box-shadow: 0 3mm 10mm rgba(15,23,42,0.30); padding: 6mm; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; position: relative; color: white;">
          <div style="position: absolute; top: -10mm; right: -10mm; width: 40mm; height: 40mm; border-radius: 50%; background: rgba(34,211,238,0.25); filter: blur(8mm);"></div>
          <img src="${a.lockupWhite}" alt="" style="height: 9mm; width: auto; position: relative;" />
          <div style="position: relative;">
            <div style="font-family: 'Manrope'; font-weight: 800; font-size: 14pt; line-height: 1.1; letter-spacing: -0.025em;">Здесь<br>не давят.</div>
            <div style="font-size: 6.5pt; color: var(--cyan); margin-top: 2mm; letter-spacing: 0.10em;">снова в фокусе</div>
          </div>
        </div>
        <p class="kv-cap">Instagram Post · 1080×1080</p>
      </div>

      <!-- 3. Instagram Post — cyan с белым CTA -->
      <div>
        <div style="aspect-ratio: 1/1; border-radius: 2mm; background: var(--cyan); box-shadow: 0 3mm 10mm rgba(34,211,238,0.30); padding: 6mm; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; color: white;">
          <img src="${a.lockupWhite}" alt="" style="height: 9mm; width: auto;" />
          <div>
            <div style="font-family: 'Manrope'; font-weight: 800; font-size: 14pt; line-height: 1.1; letter-spacing: -0.025em;">Бесплатная<br>диагностика</div>
            <div style="background: white; color: var(--cyan); padding: 1.5mm 3mm; border-radius: 1mm; font-size: 7pt; font-weight: 700; margin-top: 3mm; align-self: flex-start;">Заходите без записи</div>
          </div>
        </div>
        <p class="kv-cap">Instagram Post · 1080×1080</p>
      </div>
    </div>

    <!-- Средний ряд: 2 Story 9:16 + 1 промо -->
    <div style="display: grid; grid-template-columns: 0.6fr 0.6fr 1.5fr; gap: 5mm; margin-top: 5mm;">

      <!-- 4. Story 9:16 -->
      <div>
        <div style="aspect-ratio: 9/16; border-radius: 2mm; background: var(--slate-900); box-shadow: 0 3mm 10mm rgba(15,23,42,0.30); padding: 5mm; display: flex; flex-direction: column; justify-content: space-between; color: white; position: relative; overflow: hidden;">
          <div style="position: absolute; top: -5mm; left: -5mm; width: 30mm; height: 30mm; border-radius: 50%; background: rgba(34,211,238,0.30); filter: blur(6mm);"></div>
          <img src="${a.lockupWhite}" alt="" style="height: 7mm; width: auto; position: relative;" />
          <div style="position: relative; text-align: center;">
            <div style="font-family: 'Manrope'; font-weight: 800; font-size: 11pt; line-height: 1.15; letter-spacing: -0.02em;">Очки<br>за день.</div>
            <div style="font-size: 6pt; color: var(--cyan); margin-top: 2mm; letter-spacing: 0.10em;">снова в фокусе</div>
          </div>
          <div style="font-size: 5.5pt; color: var(--slate-400); text-align: center; letter-spacing: 0.05em;">refocus.kg</div>
        </div>
        <p class="kv-cap">Story · 1080×1920</p>
      </div>

      <!-- 5. Story 9:16 cyan -->
      <div>
        <div style="aspect-ratio: 9/16; border-radius: 2mm; background: var(--cyan); box-shadow: 0 3mm 10mm rgba(34,211,238,0.30); padding: 5mm; display: flex; flex-direction: column; justify-content: space-between; color: white;">
          <img src="${a.lockupWhite}" alt="" style="height: 7mm; width: auto;" />
          <div style="text-align: center;">
            <div style="font-family: 'Manrope'; font-weight: 800; font-size: 12pt; line-height: 1.15; letter-spacing: -0.02em;">Бесплатная<br>проверка<br>зрения</div>
          </div>
          <div style="background: white; color: var(--cyan); padding: 1.5mm; border-radius: 1mm; font-size: 6.5pt; font-weight: 700; text-align: center;">Заходите</div>
        </div>
        <p class="kv-cap">Story · 1080×1920</p>
      </div>

      <!-- 6. Билборд 16:9 — белый, максимально крупный lockup + слоган -->
      <div>
        <div style="aspect-ratio: 16/9; border-radius: 2mm; background: white; box-shadow: 0 3mm 10mm rgba(15,23,42,0.18); padding: 8mm 12mm; display: flex; align-items: center; justify-content: space-between; gap: 8mm; position: relative; overflow: hidden;">
          <img src="${a.lockupBlack}" alt="" style="height: 26mm; width: auto;" />
          <div style="text-align: right;">
            <div style="font-family: 'Manrope'; font-weight: 800; font-size: 18pt; color: var(--slate-900); line-height: 1.05; letter-spacing: -0.025em;">Очки за день.<br>Сервис на годы.</div>
            <div style="font-size: 8pt; color: var(--cyan); margin-top: 2mm; letter-spacing: 0.10em; font-weight: 700;">refocus.kg</div>
          </div>
          <!-- Снизу cyan-полоска брендового градиента -->
          <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 1.5mm; background: linear-gradient(90deg, #14B8A6 0%, #22D3EE 55%, #38BDF8 100%);"></div>
        </div>
        <p class="kv-cap">Билборд / широкий баннер · 16:9</p>
      </div>
    </div>

    <div style="margin-top: 6mm;" class="card tinted">
      <h4 class="h4">Главное правило макетов</h4>
      <p style="font-size: 9pt; margin: 0;">
        Каждый макет содержит ровно три обязательных элемента: <strong>(1) логотип Refocus</strong>,
        <strong>(2) короткий тезис</strong> в Manrope 800 (1–2 строки максимум),
        <strong>(3) призыв или контакт</strong>. Никаких длинных описаний, эмодзи, восклицаний.
        Если макет требует более 8 слов — это уже не Refocus.
      </p>
    </div>

    ${pf('42')}
  </section>`;
}

// ─── PAGE: ФИНАЛ (тёмная, hero wordmark) ──────────────────────────────────────
function PageFinal(a: BrandbookAssets): string {
  return `<section class="page dark">
    <div class="glow-cyan" style="top: -40mm; right: -40mm;"></div>
    <div class="glow-emerald" style="bottom: -40mm; left: -40mm;"></div>
    ${ph('Финал')}
    <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; position: relative; z-index: 1;">
      <img src="${a.wordmarkWhite}" alt="REFOCUS" style="width: 160mm; height: auto;" />
      <div class="final-tagline">снова в фокусе</div>
      <div class="final-meta">
        Спасибо, что бережёте наш бренд.<br>
        Refocus Brand Guidelines · версия 1.0 · 2026<br>
        <span style="color: var(--cyan);">refocus.kg@gmail.com</span>
      </div>
    </div>
    ${pf('47')}
  </section>`;
}

// ─── PAGE: ЭТАЛОН ТОЧКИ (РЕДИЗАЙН: hero photo + 3 supporting) ────────────────
function PagePhotoGalleryV2(a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Эталон точки')}
    <div class="section-num">25 — Применение</div>
    <h1 class="section-title">Эталон оформления точки</h1>
    <div class="brand-rule"></div>
    <p class="section-lede">
      Тёмно-синяя верхняя зона (Slate-900), белые витрины, акцентный логотип.
      Ниже — четыре ракурса эталонной точки Refocus.
    </p>

    <div class="hero-photo" style="margin-top: 4mm;">
      <img src="${a.refs[0]}" alt="Точка Refocus — главный ракурс" />
    </div>
    <p class="gallery-cap" style="margin-top: 2mm;">01 · Главный вход с ресепшеном — фирменный знак, тач-экран, диван</p>

    <div class="grid-3" style="margin-top: 6mm;">
      <div>
        <img src="${a.refs[3]}" alt="" style="width: 100%; border-radius: 3mm; border: 1pt solid var(--slate-200);" />
        <p class="gallery-cap">02 · Торговый зал с витринами оправ</p>
      </div>
      <div>
        <img src="${a.refs[2]}" alt="" style="width: 100%; border-radius: 3mm; border: 1pt solid var(--slate-200);" />
        <p class="gallery-cap">03 · Диагностическая зона</p>
      </div>
      <div>
        <img src="${a.refs[5]}" alt="" style="width: 100%; border-radius: 3mm; border: 1pt solid var(--slate-200);" />
        <p class="gallery-cap">04 · Зона работы с тач-экраном</p>
      </div>
    </div>

    ${pf('35')}
  </section>`;
}

// ─── PAGE: ГРАДИЕНТ (РЕДИЗАЙН: full-width hero) ──────────────────────────────
function PageGradientV2(_a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Брендовый градиент')}
    <div class="section-num">19 — Цвет</div>
    <h1 class="section-title">Брендовый градиент</h1>
    <div class="brand-rule"></div>

    <div style="height: 70mm; border-radius: 4mm; background: linear-gradient(90deg, #14B8A6 0%, #22D3EE 55%, #38BDF8 100%); margin: 4mm 0 8mm; position: relative; box-shadow: 0 6mm 24mm rgba(34,211,238,0.30); overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; padding: 6mm 8mm;">
      <div style="color: white; font-size: 8pt; letter-spacing: 0.20em; text-transform: uppercase; opacity: 0.85; font-weight: 700;">Refocus Brand Gradient</div>
      <div style="color: white; font-family: 'Manrope', sans-serif; font-weight: 800; font-size: 26pt; letter-spacing: -0.025em; line-height: 1;">снова в фокусе</div>
    </div>

    <div class="grid-3" style="gap: 4mm;">
      <div style="text-align: center; padding: 4mm; border: 1pt solid var(--slate-200); border-radius: 3mm;">
        <div style="height: 16mm; background: #14B8A6; border-radius: 2mm; margin-bottom: 3mm;"></div>
        <div style="font-family: monospace; font-size: 9pt; color: var(--slate-700); font-weight: 700;">#14B8A6</div>
        <div style="font-size: 7pt; color: var(--slate-500); margin-top: 1mm;">Teal · 0%</div>
      </div>
      <div style="text-align: center; padding: 4mm; border: 1pt solid var(--slate-200); border-radius: 3mm;">
        <div style="height: 16mm; background: #22D3EE; border-radius: 2mm; margin-bottom: 3mm;"></div>
        <div style="font-family: monospace; font-size: 9pt; color: var(--slate-700); font-weight: 700;">#22D3EE</div>
        <div style="font-size: 7pt; color: var(--slate-500); margin-top: 1mm;">Cyan · 55%</div>
      </div>
      <div style="text-align: center; padding: 4mm; border: 1pt solid var(--slate-200); border-radius: 3mm;">
        <div style="height: 16mm; background: #38BDF8; border-radius: 2mm; margin-bottom: 3mm;"></div>
        <div style="font-family: monospace; font-size: 9pt; color: var(--slate-700); font-weight: 700;">#38BDF8</div>
        <div style="font-size: 7pt; color: var(--slate-500); margin-top: 1mm;">Sky · 100%</div>
      </div>
    </div>

    <div class="grid-2" style="margin-top: 8mm; gap: 5mm;">
      <div class="card">
        <h4 class="h4" style="color: var(--emerald);">✓ Где применять</h4>
        <ul class="bullets" style="margin-top: 2mm;">
          <li>Тонкие полоски-разделители (4pt высоты)</li>
          <li>Hero-блоки сайта и приложения</li>
          <li>Прогресс-бары</li>
          <li>App splash screen</li>
        </ul>
      </div>
      <div class="card">
        <h4 class="h4" style="color: var(--rose);">× Где НЕ применять</h4>
        <ul class="bullets crosses" style="margin-top: 2mm;">
          <li>Полноразмерный фон страницы</li>
          <li>Подложка под текст (нарушает читаемость)</li>
          <li>Кнопки (используем сплошной cyan-500)</li>
          <li>Менять угол (всегда 90°, горизонтально)</li>
        </ul>
      </div>
    </div>

    <h3 class="h3" style="margin-top: 6mm;">Контрастность (WCAG AA)</h3>
    <table class="tone-table">
      <thead><tr><th>Пара</th><th>Контраст</th><th>WCAG AA текст</th></tr></thead>
      <tbody>
        <tr><td>Slate-900 на White</td><td>15.85 : 1</td><td class="yes">✓ Проходит</td></tr>
        <tr><td>Slate-900 на Cyan-500</td><td>7.78 : 1</td><td class="yes">✓ Проходит</td></tr>
        <tr><td>White на Cyan-500</td><td>2.04 : 1</td><td class="no">× Только крупный ≥18pt</td></tr>
        <tr><td>Slate-300 на White</td><td>1.85 : 1</td><td class="no">× Не использовать для текста</td></tr>
      </tbody>
    </table>

    ${pf('27')}
  </section>`;
}

// ─── PAGE 30: LEGAL + LOCALIZATION + CONTACTS ─────────────────────────────────
function Page30_LegalContacts(_a: BrandbookAssets): string {
  return `<section class="page">
    ${ph('Юридическое и контакты')}
    <div class="section-num">29 — Финал</div>
    <h1 class="section-title">Trademark, локализация,<br>контакты</h1>
    <div class="brand-rule"></div>

    <h3 class="h3">Защита бренда</h3>
    <div class="card tinted">
      <p style="font-size: 9.5pt; margin: 0;">
        Товарный знак «Refocus» <strong>подан на регистрацию</strong> в патентных ведомствах Кыргызстана, России, Казахстана и Узбекистана. До завершения регистрации (ориентировочно — 6 месяцев с даты подачи) использовать обозначение <strong>™</strong> рядом с логотипом.<br><br>
        После регистрации — <strong>®</strong>. Обязательная фраза в footer полиграфии: <strong>«Refocus® — зарегистрированный товарный знак ОсОО Refocus»</strong>.<br><br>
        При обнаружении подделок и несанкционированного использования — сообщать на <strong>refocus.kg@gmail.com</strong> с фото, адресом и датой.
      </p>
    </div>

    <h3 class="h3" style="margin-top: 6mm;">Локализация по странам</h3>
    <table class="tone-table">
      <thead><tr><th>Страна</th><th>Валюта</th><th>Телефон</th><th>Дата</th></tr></thead>
      <tbody>
        <tr><td><strong>Кыргызстан</strong></td><td>1 250 с (KGS)</td><td>+996 XXX XXX XXX</td><td>24.04.2026</td></tr>
        <tr><td><strong>Россия</strong></td><td>1 250 ₽ (RUB)</td><td>+7 XXX XXX-XX-XX</td><td>24.04.2026</td></tr>
        <tr><td><strong>Казахстан</strong></td><td>1 250 ₸ (KZT)</td><td>+7 XXX XXX XX XX</td><td>24.04.2026</td></tr>
        <tr><td><strong>Узбекистан</strong></td><td>1 250 сўм (UZS)</td><td>+998 XX XXX XX XX</td><td>24.04.2026</td></tr>
      </tbody>
    </table>
    <p style="font-size: 8.5pt; color: var(--slate-500); margin-top: 2mm;">Имя бренда «Refocus» <strong>никогда не транслитерируется</strong> и не переводится ни на один локальный язык.</p>

    <h3 class="h3" style="margin-top: 8mm;">Контакты бренд-команды</h3>
    <div class="grid-2" style="gap: 5mm;">
      <div class="card">
        <h4 class="h4">Запросы по бренду</h4>
        <p style="font-size: 10pt; font-weight: 700; color: var(--slate-900); margin: 0 0 1mm;">refocus.kg@gmail.com</p>
        <p style="font-size: 8.5pt; margin: 0;">Согласование макетов, доступ к ассетам, лицензия на шрифт RefocusDisplay, вопросы по правильному использованию бренда.</p>
      </div>
      <div class="card">
        <h4 class="h4">Срок согласования</h4>
        <p style="font-size: 10pt; font-weight: 700; color: var(--slate-900); margin: 0 0 1mm;">5 рабочих дней</p>
        <p style="font-size: 8.5pt; margin: 0;">До публикации, печати, выпуска любого материала с использованием бренда Refocus франчайзи и подрядчик согласовывают макет с HQ.</p>
      </div>
    </div>

    <div style="margin-top: 8mm; padding: 6mm; background: var(--slate-900); border-radius: 4mm; color: white; text-align: center;">
      <div style="font-family: 'RefocusBrand', sans-serif; font-size: 28pt; line-height: 1; margin-bottom: 3mm;">refocus</div>
      <div style="font-size: 9pt; color: var(--slate-300);">Спасибо, что бережёте наш бренд.</div>
    </div>

    ${pf('30')}
  </section>`;
}
