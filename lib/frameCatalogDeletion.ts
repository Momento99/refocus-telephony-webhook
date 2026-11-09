import type { SupabaseClient } from '@supabase/supabase-js';

export class FramePhotoDeleteError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const IN_ORDER = 'Фото используется в сохранённом заказе. Сначала уберите эту модель из черновика и сохраните его. Фото из отправленного заказа удалять нельзя.';

/** Never delete order items to make a catalog deletion succeed. The FK is the final race guard. */
export async function deleteUnusedFramePhoto(admin: SupabaseClient, id: string) {
  const { data: row, error: readError } = await admin.from('frame_supplier_catalog')
    .select('storage_path').eq('id', id).maybeSingle();
  if (readError) throw new FramePhotoDeleteError(readError.message, 500);
  if (!row) return { ok: true, alreadyDeleted: true, storageRemoved: true };

  const { data: items, error: itemError } = await admin.from('frame_procurement_order_items')
    .select('id').eq('catalog_id', id).limit(1);
  if (itemError) throw new FramePhotoDeleteError(itemError.message, 500);
  if (items?.length) throw new FramePhotoDeleteError(IN_ORDER, 409);

  const { error: deleteError } = await admin.from('frame_supplier_catalog').delete().eq('id', id);
  if (deleteError) throw new FramePhotoDeleteError(deleteError.code === '23503' ? IN_ORDER : deleteError.message,
    deleteError.code === '23503' ? 409 : 500);

  // The catalog deletion is already complete; report a storage failure accurately.
  let storageRemoved = false;
  try {
    const { error } = await admin.storage.from('frame-supplier-catalog').remove([row.storage_path]);
    storageRemoved = !error;
  } catch { /* An orphaned file is safer than a broken order. */ }
  return { ok: true, alreadyDeleted: false, storageRemoved };
}
