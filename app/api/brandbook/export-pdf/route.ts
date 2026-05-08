import { NextResponse } from 'next/server';
import puppeteer, { type Browser } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { buildBrandbookHtml } from '@/lib/brandbookHtml';

export const runtime = 'nodejs';
export const maxDuration = 60;

// ─── Asset loaders (cached after first call) ─────────────────────────────────

let cachedBrandFontDataUri: string | null = null;
function getBrandFontDataUri(): string {
  if (cachedBrandFontDataUri) return cachedBrandFontDataUri;
  const fontPath = path.join(process.cwd(), 'public', 'fonts', 'pavelt-jrjpm.ttf');
  const buffer = fs.readFileSync(fontPath);
  cachedBrandFontDataUri = `data:font/ttf;base64,${buffer.toString('base64')}`;
  return cachedBrandFontDataUri;
}

const cachedImages = new Map<string, string>();
function fileDataUri(relPath: string, mime = 'image/png'): string {
  const cached = cachedImages.get(relPath);
  if (cached) return cached;
  const buf = fs.readFileSync(path.join(process.cwd(), 'public', relPath));
  const uri = `data:${mime};base64,${buf.toString('base64')}`;
  cachedImages.set(relPath, uri);
  return uri;
}

// ─── Browser launch (same logic as franchise-hq endpoint) ────────────────────

function findLocalChrome(): string | null {
  const candidates: string[] = [
    process.env.CHROME_PATH || '',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}

async function launchBrowser(): Promise<Browser> {
  const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

  if (isProd) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chromiumMod: any = await import('@sparticuz/chromium');
    const chromium = chromiumMod.default ?? chromiumMod;
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const localChrome = findLocalChrome();
  if (!localChrome) {
    throw new Error('Chrome / Edge не найден. Установи Chrome или задай CHROME_PATH.');
  }
  return puppeteer.launch({
    executablePath: localChrome,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST() {
  let browser: Browser | null = null;
  try {
    const html = buildBrandbookHtml({
      logoBlack: fileDataUri('brand/logos/mark-black.png'),
      logoWhite: fileDataUri('brand/logos/mark-white.png'),
      lockupBlack: fileDataUri('brand/logos/lockup-black.png'),
      lockupWhite: fileDataUri('brand/logos/lockup-white.png'),
      wordmarkBlack: fileDataUri('brand/logos/wordmark-black.png'),
      wordmarkWhite: fileDataUri('brand/logos/wordmark-white.png'),
      palette: fileDataUri('brand/palette.png'),
      refs: [
        fileDataUri('brand/refs/1.png'),
        fileDataUri('brand/refs/2.png'),
        fileDataUri('brand/refs/3.png'),
        fileDataUri('brand/refs/4.png'),
        fileDataUri('brand/refs/5.png'),
        fileDataUri('brand/refs/6.png'),
      ],
      app: {
        lens1:      fileDataUri('brand/app/lens-1.png'),
        lens2:      fileDataUri('brand/app/lens-2.png'),
        orderStage: fileDataUri('brand/app/order-stage.png'),
        orderBag:   fileDataUri('brand/app/order-bag.png'),
        screen3:    fileDataUri('brand/app/screen-3.png'),
        screen5:    fileDataUri('brand/app/screen-5.png'),
      },
      pack: {
        glasses:        fileDataUri('brand/pack/glasses.png'),
        bagStandard:    fileDataUri('brand/pack/bag-standard.png'),
        bagPremium:     fileDataUri('brand/pack/bag-premium.png'),
        caseNavy:       fileDataUri('brand/pack/case-navy.png'),
        caseCyan:       fileDataUri('brand/pack/case-cyan.png'),
        casesTwo:       fileDataUri('brand/pack/cases-two.png'),
        casePremium:    fileDataUri('brand/pack/case-premium.png'),
        clothStandard:  fileDataUri('brand/pack/cloth-standard.png'),
        clothPremium:   fileDataUri('brand/pack/cloth-premium.png'),
        clothBox:       fileDataUri('brand/pack/cloth-box.png'),
        boxPremium:     fileDataUri('brand/pack/box-premium.png'),
        premiumSet:     fileDataUri('brand/pack/premium-set.png'),
      },
      brandFontDataUri: getBrandFontDataUri(),
    });

    browser = await launchBrowser();
    const page = await browser.newPage();
    // domcontentloaded — ждём только parsing DOM. Шрифты (Manrope с Google Fonts)
    // и картинки (data URIs) ждём отдельно ниже. networkidle0 здесь зависает,
    // если есть проблемы с CDN Google Fonts.
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Подождать, пока шрифты загрузятся (Manrope с Google Fonts + встроенный pavelt-jrjpm).
    // Если шрифты не загрузились за 10с — продолжим с fallback (system-ui).
    await Promise.race([
      page.evaluate(() => document.fonts.ready.then(() => true)),
      new Promise(resolve => setTimeout(resolve, 10000)),
    ]);

    // Подождать, пока все картинки реально подгрузятся (data URIs обычно мгновенно).
    await page.evaluate(async () => {
      const imgs = Array.from(document.images);
      await Promise.all(imgs.map(img => {
        if (img.complete && img.naturalHeight > 0) return Promise.resolve();
        return new Promise<void>(resolve => {
          img.addEventListener('load',  () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        });
      }));
    });

    const pdf = await page.pdf({
      // Не указываем format вместе с preferCSSPageSize — даём CSS @page сам определить
      // размер и поля. В CSS у нас @page { size: 210mm 297mm; margin: 0 } — это и есть A4.
      printBackground: true,
      preferCSSPageSize: true,
    });

    await browser.close();
    browser = null;

    const filename = `refocus-brandbook-v1.0-${new Date().toISOString().slice(0, 10)}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(pdf.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[brandbook export-pdf] error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
