/**
 * Авто-кроп скриншотов WeChat (и любых фото с тёмной рамкой UI вокруг
 * полезной центральной фотографии).
 *
 * Алгоритм:
 *   1) Конвертируем в greyscale.
 *   2) Для каждой строки/колонки считаем долю "ярких" пикселей (>180).
 *   3) Находим первую/последнюю строку и колонку, где доля яркости ≥ 30% —
 *      это границы полезной фотографии (она почти всегда на белом фоне).
 *   4) Обрезаем по этим границам с небольшим padding'ом.
 *
 * Если кроп даёт нереалистично маленький или нелепо большой результат —
 * возвращаем оригинал без изменений.
 */

import sharp from 'sharp';

export interface SmartCropResult {
  buffer: Buffer;
  /** true если реально обрезали, false если вернули оригинал */
  cropped: boolean;
  width: number;
  height: number;
}

// Параметры алгоритма
const BRIGHT_THRESHOLD = 180; // что считаем "ярким" пикселем (0..255)
const ROW_DENSITY_THR = 0.30; // ≥30% ярких пикселей в строке = "полезная строка"
const COL_DENSITY_THR = 0.30; // то же по колонкам
const MIN_DIM_PX = 200;       // если кропнули меньше — что-то не так, не используем
const MIN_AREA_DELTA = 0.05;  // если кроп уменьшил площадь меньше чем на 5% — не стоит
const PADDING_PX = 6;         // отступ вокруг найденной области

export async function smartCrop(input: Buffer): Promise<SmartCropResult> {
  // Получаем сырые пиксели в greyscale
  const { data: gs, info } = await sharp(input)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = info.width;
  const H = info.height;

  // Считаем долю ярких пикселей по строкам и колонкам.
  // Делаем за один проход, чтобы не платить дважды по O(W*H).
  const rowBright = new Uint32Array(H);
  const colBright = new Uint32Array(W);
  for (let y = 0; y < H; y++) {
    const rowOff = y * W;
    for (let x = 0; x < W; x++) {
      if (gs[rowOff + x] > BRIGHT_THRESHOLD) {
        rowBright[y]++;
        colBright[x]++;
      }
    }
  }

  // Находим края, где плотность яркости пересекает порог
  const rowMinBright = ROW_DENSITY_THR * W;
  const colMinBright = COL_DENSITY_THR * H;
  let topY = 0, botY = H - 1, leftX = 0, rightX = W - 1;
  while (topY < H && rowBright[topY] < rowMinBright) topY++;
  while (botY > topY && rowBright[botY] < rowMinBright) botY--;
  while (leftX < W && colBright[leftX] < colMinBright) leftX++;
  while (rightX > leftX && colBright[rightX] < colMinBright) rightX--;

  const cropW = rightX - leftX + 1;
  const cropH = botY - topY + 1;

  // Проверки: достаточно ли кропа
  const original = await sharp(input).metadata();
  const origArea = (original.width || 0) * (original.height || 0);
  const cropArea = cropW * cropH;
  const tooSmall = cropW < MIN_DIM_PX || cropH < MIN_DIM_PX;
  const noticeable = origArea > 0 && cropArea / origArea < (1 - MIN_AREA_DELTA);

  if (tooSmall || !noticeable) {
    // Не стоит кропать — возвращаем оригинал
    return {
      buffer: input,
      cropped: false,
      width: original.width || 0,
      height: original.height || 0,
    };
  }

  // Добавляем padding, чтобы не обрезать края оправ
  const finalLeft = Math.max(0, leftX - PADDING_PX);
  const finalTop = Math.max(0, topY - PADDING_PX);
  const finalW = Math.min(W - finalLeft, cropW + 2 * PADDING_PX);
  const finalH = Math.min(H - finalTop, cropH + 2 * PADDING_PX);

  const cropped = await sharp(input)
    .extract({ left: finalLeft, top: finalTop, width: finalW, height: finalH })
    .png()
    .toBuffer();

  return {
    buffer: cropped,
    cropped: true,
    width: finalW,
    height: finalH,
  };
}
