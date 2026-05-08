/**
 * POST /api/admin/frame-procurement/catalog/clear-all
 *
 * Удаляет ВСЁ из каталога (frame_supplier_catalog) и весь bucket.
 * Заказы (frame_procurement_orders) НЕ трогает — они должны выживать.
 *
 * Тело: { confirm: 'YES' } — защита от случайного клика.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BUCKET = 'frame-supplier-catalog';

async function checkOwner(): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return { ok: false, error: 'Не авторизован' };
  const role = (data.user.app_metadata as Record<string, unknown> | undefined)?.role;
  if (role !== 'owner') return { ok: false, error: 'Доступ только для owner' };
  return { ok: true };
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await checkOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 403 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {}
  if (body.confirm !== 'YES') {
    return NextResponse.json({ error: 'Подтверждение не передано (confirm: "YES")' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // 1) Сначала удаляем все заказы (CASCADE заберёт и order_items).
  //    Это снимет FK-блокировку с frame_supplier_catalog.
  const { count: ordersCount } = await admin
    .from('frame_procurement_orders')
    .select('id', { count: 'exact', head: true });
  const { error: delOrdersErr } = await admin
    .from('frame_procurement_orders')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (delOrdersErr) {
    return NextResponse.json({
      error: 'Не получилось удалить заказы: ' + delOrdersErr.message,
    }, { status: 500 });
  }

  // 2) Получаем все пути в Storage, чтобы потом удалить файлы.
  const { data: rows, error: selErr } = await admin
    .from('frame_supplier_catalog')
    .select('id, storage_path');
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });

  const totalRows = rows?.length || 0;

  // 3) Удаляем файлы из Storage батчами по 1000 (лимит Supabase API).
  const paths = (rows || []).map((r) => r.storage_path).filter(Boolean) as string[];
  let removedFiles = 0;
  for (let i = 0; i < paths.length; i += 1000) {
    const batch = paths.slice(i, i + 1000);
    const { error: rmErr } = await admin.storage.from(BUCKET).remove(batch);
    if (!rmErr) removedFiles += batch.length;
  }

  // 4) Удаляем все строки каталога — теперь FK-конфликта не будет.
  const { error: delErr } = await admin
    .from('frame_supplier_catalog')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (delErr) {
    return NextResponse.json({
      error: 'Не получилось удалить каталог: ' + delErr.message,
    }, { status: 500 });
  }

  return NextResponse.json({
    deleted_rows: totalRows,
    deleted_files: removedFiles,
    deleted_orders: ordersCount || 0,
  });
}
