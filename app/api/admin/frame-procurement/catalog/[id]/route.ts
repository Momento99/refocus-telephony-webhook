/**
 * PATCH /api/admin/frame-procurement/catalog/:id
 *   Ручная правка записи каталога (тип, пол, цвета, артикул).
 *   Ставит manually_corrected=true и снимает needs_review.
 *
 * DELETE /api/admin/frame-procurement/catalog/:id
 *   Удаляет запись и файл из Storage.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import type { CatalogColor } from '@/lib/frameProcurementTypes';
import { dedupOverlappingColors } from '@/lib/frameVision';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'frame-supplier-catalog';
const VALID_TYPES = ['PA', 'MA', 'RP', 'RM', 'KD', 'RL'] as const;
const VALID_GENDERS = ['F', 'M', 'U'] as const;

async function checkOwner(): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return { ok: false, error: 'Не авторизован' };
  const role = (data.user.app_metadata as Record<string, unknown> | undefined)?.role;
  if (role !== 'owner') return { ok: false, error: 'Доступ только для owner' };
  return { ok: true };
}

function clamp01(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function sanitizeColors(input: unknown): CatalogColor[] | null {
  if (!Array.isArray(input)) return null;
  const out: CatalogColor[] = [];
  for (const c of input) {
    if (!c || typeof c !== 'object') continue;
    const obj = c as Record<string, unknown>;
    const bbox = Array.isArray(obj.bbox) && obj.bbox.length === 4
      ? ([clamp01(obj.bbox[0]), clamp01(obj.bbox[1]), clamp01(obj.bbox[2]), clamp01(obj.bbox[3])] as [number, number, number, number])
      : ([0, 0, 1, 0.15] as [number, number, number, number]);
    out.push({
      label: String(obj.label ?? '').slice(0, 32),
      name_ru: String(obj.name_ru ?? '').slice(0, 32),
      bbox,
    });
  }
  return out;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await checkOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 403 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ожидается JSON' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  if ('supplier_model' in body) {
    const v = body.supplier_model;
    update.supplier_model = v === null || v === '' ? null : String(v).slice(0, 64);
  }
  if ('type_code' in body) {
    const v = String(body.type_code || '').toUpperCase();
    if (!VALID_TYPES.includes(v as (typeof VALID_TYPES)[number])) {
      return NextResponse.json({ error: `Неверный type_code: ${v}` }, { status: 400 });
    }
    update.type_code = v;
  }
  if ('gender' in body) {
    const v = String(body.gender || '').toUpperCase();
    if (!VALID_GENDERS.includes(v as (typeof VALID_GENDERS)[number])) {
      return NextResponse.json({ error: `Неверный gender: ${v}` }, { status: 400 });
    }
    update.gender = v;
  }
  // dedupCleanupTriggered = одноразовая очистка существующих «битых» строк:
  // если в текущей записи есть перекрывающиеся дубли цветов (GPT-5 наплодил),
  // мы их вычищаем при первом же PATCH этой строки и поднимаем needs_review.
  let dedupCleanupTriggered = false;

  if ('colors' in body) {
    const colors = sanitizeColors(body.colors);
    if (!colors) return NextResponse.json({ error: 'colors должен быть массивом' }, { status: 400 });
    // Дедуп присланных пользователем цветов — на случай если он сам не заметил
    // или просто открыл/сохранил старую битую запись без редактирования.
    const { colors: deduped, didDedup } = dedupOverlappingColors(colors);
    if (didDedup) dedupCleanupTriggered = true;
    update.colors = deduped;
  }
  if ('needs_review' in body) {
    update.needs_review = Boolean(body.needs_review);
  }
  if ('notes' in body) {
    update.notes = String(body.notes || '').slice(0, 500);
  }
  if ('estimated_price' in body) {
    const v = body.estimated_price;
    if (v === null) {
      update.estimated_price = null;
    } else {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n) || n <= 0 || n >= 100000) {
        return NextResponse.json(
          { error: 'estimated_price должен быть положительным числом меньше 100000 или null' },
          { status: 400 },
        );
      }
      update.estimated_price = n;
    }
  }

  // Если поправили хоть что-то семантическое — отмечаем как ручную коррекцию
  if (
    'type_code' in body ||
    'gender' in body ||
    'colors' in body ||
    'supplier_model' in body ||
    'estimated_price' in body
  ) {
    update.manually_corrected = true;
    if (!('needs_review' in body)) update.needs_review = false;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Ничего не изменено' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Одноразовая чистка существующих «битых» строк: если пользователь правит
  // запись, но НЕ трогает colors[], всё равно подтянем текущие colors и
  // прогоним через dedup. Так исторические дубли GPT-5 (19 каталогов из
  // discovery) уйдут естественным путём при первом же сохранении.
  if (!('colors' in body)) {
    const { data: existing } = await admin
      .from('frame_supplier_catalog')
      .select('colors')
      .eq('id', id)
      .maybeSingle();
    const existingColors = Array.isArray(existing?.colors)
      ? (existing!.colors as CatalogColor[])
      : null;
    if (existingColors && existingColors.length >= 2) {
      const { colors: deduped, didDedup } = dedupOverlappingColors(existingColors);
      if (didDedup) {
        update.colors = deduped;
        dedupCleanupTriggered = true;
      }
    }
  }

  // Если дедуп сработал — пользователь должен ещё раз провериться глазами,
  // поэтому ставим needs_review=true (даже если выше его сняли как «вручную
  // поправлено»). Это не блокирует — просто метка в UI.
  if (dedupCleanupTriggered) {
    update.needs_review = true;
  }

  const { data, error } = await admin
    .from('frame_supplier_catalog')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data, dedup_cleanup: dedupCleanupTriggered });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await checkOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 403 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: row } = await admin
    .from('frame_supplier_catalog')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle();

  // FK frame_procurement_order_items.catalog_id → frame_supplier_catalog.id
  // имеет ON DELETE RESTRICT, поэтому сначала удаляем позиции из исторических
  // заказов, где эта модель использовалась. Сам заказ (frame_procurement_orders)
  // остаётся: total_qty/qty_by_section/sent_at сохраняются как аудит, теряем
  // только детализацию позиций (ZIP уже отправлен в WeChat).
  await admin
    .from('frame_procurement_order_items')
    .delete()
    .eq('catalog_id', id);

  const { error: delErr } = await admin
    .from('frame_supplier_catalog')
    .delete()
    .eq('id', id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  if (row?.storage_path) {
    await admin.storage.from(BUCKET).remove([row.storage_path]).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
