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

  let body: { plan?: OrderPlan; input?: BuildOrderInput; recognizedBy?: string };
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

  const { data: order, error: rpcErr } = await admin.rpc(
    'fn_create_frame_procurement_order',
    {
      p_branch_id: primaryBranch,
      p_branch_ids: branchIds.length > 0 ? branchIds : null,
      p_status: 'sent',
      p_sales_window_days: windowDays,
      p_target_warehouse_qty: plan.totalQtyTarget,
      p_supplier_min_qty: input.supplierMin,
      p_recognized_by: body.recognizedBy || 'mixed',
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
