import { NextRequest, NextResponse } from 'next/server';
import puppeteer, { type Browser } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { buildPdfHtml, stripTrainerSections } from '@/lib/franchiseMarkdown';

export const runtime = 'nodejs';
export const maxDuration = 60;

let cachedBrandFontDataUri: string | null = null;
function getBrandFontDataUri(): string {
  if (cachedBrandFontDataUri) return cachedBrandFontDataUri;
  const fontPath = path.join(process.cwd(), 'public', 'fonts', 'pavelt-jrjpm.ttf');
  const buffer = fs.readFileSync(fontPath);
  cachedBrandFontDataUri = `data:font/ttf;base64,${buffer.toString('base64')}`;
  return cachedBrandFontDataUri;
}

// ─── Browser launch helpers ──────────────────────────────────────────────────
// Production (Vercel): use @sparticuz/chromium binary.
// Local (dev):        try common Chrome/Edge install paths, or CHROME_PATH env.

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
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

async function launchBrowser(): Promise<Browser> {
  const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

  if (isProd) {
    // Vercel / serverless: use sparticuz/chromium
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
    throw new Error(
      'Chrome / Edge не найден на этой машине. Установи Chrome или задай CHROME_PATH.',
    );
  }
  return puppeteer.launch({
    executablePath: localChrome,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let browser: Browser | null = null;
  try {
    const body = await req.json();
    const { title, description, content, notes, itemId, audience, audienceLabel } = body as {
      title: string;
      description: string;
      content: string;
      notes?: string;
      itemId?: string;
      audience?: 'full' | 'trainee';
      audienceLabel?: string;
    };

    if (!title || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'title и content обязательны' },
        { status: 400 },
      );
    }

    const isTrainee = audience === 'trainee';
    const renderedContent = isTrainee ? stripTrainerSections(content).stripped : content;
    const renderedNotes = isTrainee && notes ? stripTrainerSections(notes).stripped : notes;

    const brandFontDataUri = getBrandFontDataUri();
    const html = buildPdfHtml({
      title,
      description: description || '',
      content: renderedContent,
      notes: renderedNotes,
      itemId,
      brandFontDataUri,
      audienceLabel: isTrainee ? (audienceLabel || 'Версия для обучаемого') : undefined,
    });

    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45000 });

    // Belt-and-suspenders: ensure every <img> has fully loaded (or failed) before snapshotting.
    // networkidle0 alone can resolve early if the browser briefly has no in-flight requests.
    await page.evaluate(async () => {
      const imgs = Array.from(document.images);
      await Promise.all(
        imgs.map((img) => {
          if (img.complete && img.naturalHeight > 0) return Promise.resolve();
          return new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          });
        }),
      );
    });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      margin: { top: '24mm', bottom: '20mm', left: '18mm', right: '18mm' },
      headerTemplate: `
        <style>
          @font-face {
            font-family: 'RefocusBrand';
            src: url('${brandFontDataUri}') format('truetype');
            font-weight: 400;
            font-style: normal;
          }
        </style>
        <div style="font-family:'Manrope','Segoe UI',sans-serif;font-size:8pt;color:#94a3b8;width:100%;padding:0 18mm;display:flex;align-items:center;justify-content:space-between;">
          <span style="font-family:'RefocusBrand','Manrope',sans-serif;font-size:13pt;color:#0F172A;letter-spacing:0.01em;line-height:1;">refocus</span>
          <span class="title" style="color:#64748B;">${escapeHtml(title)}</span>
        </div>
      `,
      footerTemplate: `
        <div style="font-family:'Manrope','Segoe UI',sans-serif;font-size:8pt;color:#94a3b8;width:100%;padding:0 18mm;display:flex;justify-content:space-between;">
          <span>Внутренний документ · не для распространения</span>
          <span>Стр. <span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>
      `,
    });

    await browser.close();
    browser = null;

    const audienceSuffix = isTrainee ? '-trainee' : '';
    const filename = `refocus-${itemId || 'doc'}${audienceSuffix}-${new Date().toISOString().slice(0, 10)}.pdf`;
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
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[export-pdf] error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}
