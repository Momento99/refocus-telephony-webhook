import type { SupabaseClient } from '@supabase/supabase-js';

export interface FrameBarcodeShelfRow {
  id: string;
  barcode: string;
  type_code: string | null;
  gender: string | null;
  price: number | string | null;
  year: number;
  sold_at: string | null;
  voided_at: string | null;
}

/** Read the entire shelf history; PostgREST caps an unpaginated select at 1,000 rows.
 * ID cursors also avoid skipping rows when earlier records get voided during a read.
 * The caller receives no partial result if any page fails.
 */
export async function loadFrameBarcodeShelf(
  client: SupabaseClient, branchId: number, years: readonly number[],
): Promise<FrameBarcodeShelfRow[]> {
  if (!Number.isFinite(branchId) || branchId <= 0 || !years.length) return [];
  const size = 500;
  const rows: FrameBarcodeShelfRow[] = [];
  let after: string | null = null;
  while (true) {
    let query = client.from('frame_barcodes')
      .select('id,barcode,type_code,gender,price,year,sold_at,voided_at')
      .eq('branch_id', branchId).in('year', [...years]).is('voided_at', null)
      .order('id', { ascending: true }).limit(size);
    if (after) query = query.gt('id', after);
    const { data, error } = await query;
    if (error) throw error;
    const page = (data || []) as FrameBarcodeShelfRow[];
    rows.push(...page);
    if (page.length < size) return rows;
    const last = page[page.length - 1].id;
    if (!last || last === after) throw new Error('Не удалось загрузить все ценники. Обновите страницу.');
    after = last;
  }
}
