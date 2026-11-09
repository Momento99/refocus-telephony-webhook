/**
 * GET  /api/admin/frame-procurement/orders
 *   Список черновиков и отправленных заказов.
 *
 * POST /api/admin/frame-procurement/orders
 *   Создать заказ из текущего плана. Тело: { plan, input }
 *   План должен прийти готовый (из /plan endpoint), мы его просто сохраняем
 *   с items.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import type { OrderPlan, BuildOrderInput } from '@/lib/frameProcurementTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function checkOwner(): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return { ok: false, error: 'Не авторизован' };
  const role = (data.user.app_metadata as Record<string, unknown> | undefined)?.role;
  if (role !== 'owner') return { ok: false, error: 'Доступ только для owner' };
  return { ok: true };
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await checkOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 403 });

  const url = new URL(req.url);
  const branchId = Number(url.searchParams.get('branchId') || 0);

  const admin = getSupabaseAdmin();
  let q = admin
    .from('frame_procurement_orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (branchId) {
    // Новые строки хранят группу филиалов в branch_ids (jsonb/array).
    // Старые строки имеют только branch_id (single int) и branch_ids = NULL,
    // поэтому проверяем оба варианта через .or().
    q = q.or(`branch_id.eq.${branchId},branch_ids.cs.{${branchId}}`);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await checkOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 403 });

  let body: { plan?: OrderPlan; input?: BuildOrderInput };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ожидается JSON' }, { status: 400 });
  }

  const plan = body.plan;
  const input = body.input;
  if (!plan || !input || !Array.isArray(plan.items)) {
    return NextResponse.json({ error: 'plan.items обязателен' }, { status: 400 });
  }
  if (plan.mode !== input.mode) {
    return NextResponse.json({ error: 'Режим плана не совпадает с параметрами заказа' }, { status: 400 });
  }
  if (
    plan.mode === 'custom'
    && Math.floor(Number(input.customTarget)) !== Math.floor(Number(plan.totalQtyTarget))
  ) {
    return NextResponse.json({ error: 'Своя цель изменилась — пересчитайте план' }, { status: 400 });
  }

  const requestedSupplierMin = Number(input.supplierMin);
  const effectiveSupplierMin = plan.mode === 'custom'
    ? 0
    : Number.isFinite(requestedSupplierMin) && requestedSupplierMin > 0
      ? Math.max(Math.floor(requestedSupplierMin), 500)
      : 500;

  if (!Number.isFinite(plan.totalQty) || plan.totalQty <= 0) {
    return NextResponse.json({ error: 'В плане нет позиций для заказа' }, { status: 400 });
  }
  if (plan.totalQty < effectiveSupplierMin) {
    return NextResponse.json(
      { error: `До минималки поставщика (${effectiveSupplierMin}) не хватает ${effectiveSupplierMin - plan.totalQty} шт` },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();

  // Окно «с последнего sent» вычисляется в плане: считаем дни от windowSince
  // до сейчас (для отчётности в существующую колонку sales_window_days).
  const windowDays = plan.windowSince
    ? Math.max(1, Math.ceil((Date.now() - new Date(plan.windowSince).getTime()) / 86_400_000))
    : 0;

  // Создаём СРАЗУ как sent — нажатие «Сохранить заказ» = заказ отправлен
  // поставщику, ZIP уезжает в WeChat. С этого момента окно продаж для
  // следующей закупки начинается заново.
  const sentAt = new Date().toISOString();

  // input.branchIds — массив филиалов группы (Tокмок+Кант). Для legacy
  // совместимости пишем первый в branch_id, весь массив — в branch_ids.
  const branchIds = Array.isArray(input.branchIds) ? input.branchIds : [];
  const primaryBranch = branchIds[0] ?? null;

  // Атомарное создание шапки + items в одной транзакции БД (plpgsql).
  // Раньше шапка вставлялась отдельно, потом items, и при ошибке items
  // делался отдельный DELETE — он мог сам упасть (RLS/сеть) и оставить
  // осиротевший заказ. Теперь либо всё, либо ничего.
  const itemsPayload = plan.items.map((it) => ({
    catalog_id: it.catalogId,
    color_label: it.colorLabel,
    color_name: it.colorName,
    qty: it.qty,
    bbox: it.bbox ?? null,
  }));

  // Provenance вычисляет сервер по реально использованным catalog_id. Клиент
  // не может подменить модель, а смешанный Sol/Luna/ручной план честно
  // сохраняется как mixed.
  const catalogIds = Array.from(new Set(plan.items.map((it) => it.catalogId)));
  let recognizedBy = 'mixed';
  if (catalogIds.length > 0) {
    const { data: catalogSources, error: sourceErr } = await admin
      .from('frame_supplier_catalog')
      .select('id, recognized_by, manually_corrected')
      .in('id', catalogIds);

    if (sourceErr) {
      return NextResponse.json({ error: sourceErr.message }, { status: 500 });
    }

    const sources = catalogSources || [];
    const completeSet = sources.length === catalogIds.length;
    const allManual = completeSet && sources.every((row) => row.manually_corrected);
    const anyManual = sources.some((row) => row.manually_corrected);
    const engineSources = new Set(
      sources
        .map((row) => row.recognized_by)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    );

    if (allManual) recognizedBy = 'manual';
    else if (completeSet && !anyManual && engineSources.size === 1) {
      recognizedBy = Array.from(engineSources)[0];
    }
  }

  const { data: order, error: rpcErr } = await admin.rpc(
    'fn_create_frame_procurement_order',
    {
      p_branch_id: primaryBranch,
      p_branch_ids: branchIds.length > 0 ? branchIds : null,
      p_status: 'sent',
      p_sales_window_days: windowDays,
      p_target_warehouse_qty: plan.totalQtyTarget,
      p_supplier_min_qty: effectiveSupplierMin,
      p_recognized_by: recognizedBy,
      p_qty_by_section: plan.qtyBySection,
      p_total_qty: plan.totalQty,
      p_sent_at: sentAt,
      p_items: itemsPayload,
    },
  );

  if (rpcErr || !order) {
    return NextResponse.json(
      { error: rpcErr?.message || 'Ошибка создания заказа' },
      { status: 500 },
    );
  }

  return NextResponse.json({ order });
}
