/**
 * POST /api/admin/frame-procurement/dedupe
 *
 * Находит дубли в каталоге по supplier_model и удаляет лишние копии.
 * Оставляет ту запись, у которой:
 *   1) manually_corrected=true (приоритет — человек уже поправил)
 *   2) иначе — самая старая по created_at (обычно первая загрузка)
 *
 * Записи без supplier_model не трогаем (нечего сравнивать).
 *
 * Тело: пусто. Возвращает { removed: number, kept: number }.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'frame-supplier-catalog';

async function checkOwner(): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return { ok: false, error: 'Не авторизован' };
  const role = (data.user.app_metadata as Record<string, unknown> | undefined)?.role;
  if (role !== 'owner') return { ok: false, error: 'Доступ только для owner' };
  return { ok: true };
}

export async function POST(): Promise<NextResponse> {
  const auth = await checkOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 403 });

  const admin = getSupabaseAdmin();
  const { data: rows, error } = await admin
    .from('frame_supplier_catalog')
    .select('id, supplier_model, manually_corrected, created_at, storage_path')
    .not('supplier_model', 'is', null)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Группируем по supplier_model (нормализованному — убираем лишние пробелы)
  const groups = new Map<string, typeof rows>();
  for (const r of rows || []) {
    const key = String(r.supplier_model || '').replace(/\s+/g, ' ').trim().toUpperCase();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, [] as any);
    groups.get(key)!.push(r);
  }

  const toDelete: typeof rows = [] as any;
  let kept = 0;

  for (const list of groups.values()) {
    if (list.length <= 1) {
      kept += list.length;
      continue;
    }
    // Выбираем "победителя" — manually_corrected приоритетней,
    // среди прочих — самый старый.
    list.sort((a, b) => {
      if (a.manually_corrected !== b.manually_corrected) {
        return a.manually_corrected ? -1 : 1;
      }
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    const [keep, ...rest] = list;
    kept += 1;
    for (const r of rest) toDelete.push(r);
  }

  // Удаляем файлы из Storage + строки из БД
  if (toDelete.length > 0) {
    const paths = toDelete.map((r) => r.storage_path).filter(Boolean) as string[];
    if (paths.length > 0) {
      await admin.storage.from(BUCKET).remove(paths).catch(() => {});
    }
    const ids = toDelete.map((r) => r.id);
    await admin.from('frame_supplier_catalog').delete().in('id', ids);
  }

  return NextResponse.json({
    removed: toDelete.length,
    kept,
  });
}
