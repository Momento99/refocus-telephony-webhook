import type { CatalogColor } from './frameProcurementTypes';

function bboxIoU(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  const areaA = Math.max(0, aw) * Math.max(0, ah);
  const areaB = Math.max(0, bw) * Math.max(0, bh);
  const union = areaA + areaB - inter;
  if (union <= 0) return 0;
  return inter / union;
}

function bboxCenter(
  b: [number, number, number, number],
): [number, number] {
  return [b[0] + b[2] / 2, b[1] + b[3] / 2];
}

function bboxesAreDuplicates(a: CatalogColor, b: CatalogColor): boolean {
  // Условие 1: имена должны совпадать (без учёта регистра, после трима).
  // Это снижает риск ошибочного слияния двух близких, но РАЗНЫХ цветов
  // (например «чёрный» рядом с «серый» в плотной сетке).
  const an = (a.name_ru || '').trim().toLowerCase();
  const bn = (b.name_ru || '').trim().toLowerCase();
  if (!an || !bn) return false;
  if (an !== bn) return false;

  // Условие 2: пространственная близость.
  if (bboxIoU(a.bbox, b.bbox) > 0.5) return true;

  const [acx, acy] = bboxCenter(a.bbox);
  const [bcx, bcy] = bboxCenter(b.bbox);
  const dist = Math.hypot(acx - bcx, acy - bcy);
  const minDim = Math.min(a.bbox[2], a.bbox[3], b.bbox[2], b.bbox[3]);
  if (minDim > 0 && dist < minDim * 0.3) return true;

  return false;
}

/**
 * Удаляет цвета, у которых bbox перекрывается с уже принятыми и совпадает name_ru.
 * Из группы дублей оставляем запись с самым длинным name_ru (более описательным).
 * Возвращает (deduplicated, didDedup) — флаг сигнализирует, что нужно
 * поднять needs_review=true в результирующем CatalogRecognitionResult.
 */
export function dedupOverlappingColors(
  colors: CatalogColor[],
): { colors: CatalogColor[]; didDedup: boolean } {
  if (colors.length < 2) return { colors, didDedup: false };

  const kept: CatalogColor[] = [];
  let didDedup = false;

  for (const c of colors) {
    const dupIdx = kept.findIndex((k) => bboxesAreDuplicates(k, c));
    if (dupIdx === -1) {
      kept.push(c);
      continue;
    }
    didDedup = true;
    // Оставляем «лучшую» запись: с более длинным name_ru, иначе текущую
    // (порядок уже сверху-вниз — раннюю можно считать корректнее).
    const existing = kept[dupIdx];
    const existingLen = (existing.name_ru || '').trim().length;
    const candidateLen = (c.name_ru || '').trim().length;
    if (candidateLen > existingLen) {
      kept[dupIdx] = c;
    }
  }

  return { colors: kept, didDedup };
}
