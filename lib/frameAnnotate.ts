/**
 * Аннотация PNG: рисуем красные цифры количества поверх цветовых строк фото.
 *
 * Используем sharp + SVG-overlay. SVG масштабируем под размер исходного фото.
 * Размер шрифта подобран так, чтобы цифра была хорошо видна и на тёмных,
 * и на светлых оправах (белая обводка вокруг красной заливки).
 */

import sharp from 'sharp';

export interface AnnotationMark {
  /** [x_ratio, y_ratio, w_ratio, h_ratio] в долях [0..1] */
  bbox: [number, number, number, number];
  /** Точная точка [x, y] на фото для рисования цифры — приоритетней bbox */
  click_point?: [number, number];
  /** Количество — рисуем поверх этого цвета */
  qty: number;
}

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Создаёт PNG-buffer с аннотированными красными цифрами. */
export async function annotateImage(
  source: Buffer,
  marks: AnnotationMark[],
): Promise<Buffer> {
  const img = sharp(source);
  const meta = await img.metadata();
  const W = meta.width || 0;
  const H = meta.height || 0;

  if (W <= 0 || H <= 0) {
    throw new Error('Не удалось определить размеры изображения');
  }

  if (marks.length === 0) {
    return img.png().toBuffer();
  }

  // Размер шрифта — относительно меньшей стороны.
  // 7.5% — крупно, видно через 5 метров на скриншоте каталога.
  const fontSize = Math.max(20, Math.round(Math.min(W, H) * 0.075));
  const strokeWidth = Math.max(2, Math.round(fontSize * 0.12));

  const svgParts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<style>
      .qty-text {
        font-family: 'Arial Black', Arial, sans-serif;
        font-weight: 900;
        font-size: ${fontSize}px;
        fill: #FF1A1A;
        stroke: #FFFFFF;
        stroke-width: ${strokeWidth}px;
        paint-order: stroke;
        text-anchor: middle;
        dominant-baseline: middle;
      }
    </style>`,
  ];

  for (const m of marks) {
    if (!Number.isFinite(m.qty) || m.qty <= 0) continue;

    let cx: number;
    let cy: number;

    if (
      m.click_point
      && m.click_point.length === 2
      && Number.isFinite(m.click_point[0])
      && Number.isFinite(m.click_point[1])
    ) {
      // Точная точка от LLM — используем её. Это самый надёжный путь.
      cx = m.click_point[0] * W;
      cy = m.click_point[1] * H;
    } else {
      // Fallback: позиция по bbox. Центр левой линзы ≈ 27% слева, 42% сверху.
      const [xR, yR, wR, hR] = m.bbox;
      cx = (xR + wR * 0.27) * W;
      cy = (yR + hR * 0.42) * H;
    }

    svgParts.push(
      `<text class="qty-text" x="${cx.toFixed(1)}" y="${cy.toFixed(1)}">${escapeXml(String(m.qty))}</text>`,
    );
  }

  svgParts.push('</svg>');
  const svg = Buffer.from(svgParts.join(''));

  return img
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

/** Авто-кроп равномерных чёрных/белых полей (для скриншотов WeChat в полный экран). */
export async function autoCropBorders(source: Buffer): Promise<Buffer> {
  // sharp.trim() убирает однотонные края с порогом по умолчанию.
  // threshold 10 — мягкий, чтобы не съесть рамку оправы.
  return sharp(source).trim({ threshold: 10 }).png().toBuffer();
}
