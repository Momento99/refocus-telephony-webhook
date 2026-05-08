/**
 * GET /api/admin/frame-procurement/orders/:id/zip
 *
 * Собирает ZIP с аннотированными PNG для отправки поставщику в WeChat.
 * Каждый файл = одна модель каталога с красными цифрами на нужных цветах.
 *
 * Группируем items по catalog_id, для каждой модели рисуем цифры в bbox-ах
 * выбранных цветов, складываем в ZIP-стрим.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import AdmZip from 'adm-zip';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { annotateImage, type AnnotationMark } from '@/lib/frameAnnotate';

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

function safeFileName(s: string | null | undefined, fallback: string): string {
  const raw = (s ?? fallback).toString();
  return raw.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || fallback;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await checkOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 403 });

  const { id: orderId } = await params;
  if (!orderId) return NextResponse.json({ error: 'id обязателен' }, { status: 400 });

  const admin = getSupabaseAdmin();

  // Загружаем заказ + items + связанные записи каталога
  const { data: order, error: ordErr } = await admin
    .from('frame_procurement_orders')
    .select('id, branch_id, total_qty, recognized_by, created_at')
    .eq('id', orderId)
    .maybeSingle();
  if (ordErr || !order) {
    return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
  }

  const { data: items, error: itErr } = await admin
    .from('frame_procurement_order_items')
    .select('catalog_id, color_label, color_name, qty, bbox')
    .eq('order_id', orderId);
  if (itErr) {
    return NextResponse.json({ error: itErr.message }, { status: 500 });
  }

  const itemList = items || [];
  if (itemList.length === 0) {
    return NextResponse.json({ error: 'В заказе нет позиций' }, { status: 400 });
  }

  // Сначала загружаем catalog (с colors[]) — нужен для свежих click_point
  const catalogIds = Array.from(new Set(itemList.map((it) => it.catalog_id)));
  const { data: catalogRows, error: catErr } = await admin
    .from('frame_supplier_catalog')
    .select('id, storage_path, supplier_model, type_code, gender, colors')
    .in('id', catalogIds);
  if (catErr) {
    return NextResponse.json({ error: catErr.message }, { status: 500 });
  }
  const catalogById = new Map<string, any>();
  for (const r of catalogRows || []) catalogById.set(r.id, r);

  // Группируем items по catalog_id и собираем marks с click_point из каталога
  type Group = {
    catalogId: string;
    marks: AnnotationMark[];
    totalQty: number;
  };
  const groups = new Map<string, Group>();
  for (const it of itemList) {
    let g = groups.get(it.catalog_id);
    if (!g) {
      g = { catalogId: it.catalog_id, marks: [], totalQty: 0 };
      groups.set(it.catalog_id, g);
    }

    // bbox из item — снапшот на момент сохранения заказа
    const bboxRaw = it.bbox as unknown;
    const bbox: [number, number, number, number] =
      Array.isArray(bboxRaw) && bboxRaw.length === 4
        ? [Number(bboxRaw[0]), Number(bboxRaw[1]), Number(bboxRaw[2]), Number(bboxRaw[3])]
        : [0, 0, 1, 0.15];

    // click_point подтягиваем СВЕЖИЙ из каталога — даже если order создан
    // до улучшения распознавания, новый click_point применится при скачивании.
    let clickPoint: [number, number] | undefined;
    const cat = catalogById.get(it.catalog_id);
    if (cat?.colors && Array.isArray(cat.colors)) {
      const matched = cat.colors.find((c: any) => c?.label === it.color_label);
      if (
        matched?.click_point
        && Array.isArray(matched.click_point)
        && matched.click_point.length === 2
        && Number.isFinite(Number(matched.click_point[0]))
        && Number.isFinite(Number(matched.click_point[1]))
      ) {
        clickPoint = [Number(matched.click_point[0]), Number(matched.click_point[1])];
      }
    }

    const mark: AnnotationMark = {
      bbox,
      qty: Number(it.qty) || 0,
      ...(clickPoint ? { click_point: clickPoint } : {}),
    };
    g.marks.push(mark);
    g.totalQty += Number(it.qty) || 0;
  }

  // Строим ZIP
  const zip = new AdmZip();
  const usedNames = new Set<string>();

  for (const g of groups.values()) {
    const cat = catalogById.get(g.catalogId);
    if (!cat) continue;

    const { data: blob, error: dlErr } = await admin.storage
      .from(BUCKET)
      .download(cat.storage_path);
    if (dlErr || !blob) continue;

    const sourceBuf = Buffer.from(await blob.arrayBuffer());

    let annotated: Buffer;
    try {
      annotated = await annotateImage(sourceBuf, g.marks);
    } catch (e) {
      console.warn('annotate fail:', e);
      continue;
    }

    // Имя файла: артикул-поставщика_тип_пол_итоговое.png
    let baseName = safeFileName(
      cat.supplier_model || g.catalogId.slice(0, 8),
      g.catalogId.slice(0, 8),
    );
    const tag = `${cat.type_code || '??'}${cat.gender || '?'}_x${g.totalQty}`;
    let name = `${baseName}__${tag}.png`;
    let suffix = 1;
    while (usedNames.has(name)) {
      name = `${baseName}__${tag}__${suffix}.png`;
      suffix++;
    }
    usedNames.add(name);

    zip.addFile(name, annotated);
  }

  // Сводка
  const manifestLines: string[] = [
    `Refocus — заказ оправ`,
    `Order ID: ${order.id}`,
    `Создан: ${order.created_at}`,
    `Всего штук: ${order.total_qty}`,
    `Распознавал каталог: ${order.recognized_by || 'unknown'}`,
    '',
    'Состав:',
  ];
  for (const g of groups.values()) {
    const cat = catalogById.get(g.catalogId);
    if (!cat) continue;
    manifestLines.push(
      `  • ${cat.supplier_model || g.catalogId.slice(0, 8)} (${cat.type_code}/${cat.gender}) — ${g.totalQty} шт`,
    );
  }
  zip.addFile('manifest.txt', Buffer.from(manifestLines.join('\r\n'), 'utf-8'));

  const zipBuf = zip.toBuffer();
  const filename = `refocus-frames-order-${order.id.slice(0, 8)}.zip`;

  return new Response(zipBuf, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(zipBuf.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
