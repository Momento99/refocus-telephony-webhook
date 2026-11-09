/** Same mark sizing in the browser preview and in the exported PNG. */
export function frameMarkFontSize(width: number, height: number, bbox: readonly number[], qty: number) {
  const digits = String(Math.max(0, qty)).length;
  return Math.max(14, Math.round(Math.min(Math.min(width, height) * .075,
    height * bbox[3] * .85, width * bbox[2] * .48 / Math.max(1, digits * .65))));
}
