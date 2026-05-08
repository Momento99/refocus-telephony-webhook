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
  if (branchId) q = q.eq('branch_id', branchId);

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

  const { data: order, error: insErr } = await admin
    .from('frame_procurement_orders')
    .insert({
      branch_id: input.branchId,
      status: 'draft',
      cold_start: plan.coldStart,
      proxy_branch_id: input.proxyBranchId,
      sales_window_days: input.windowDays,
      target_warehouse_qty: input.targetQty,
      supplier_min_qty: input.supplierMin,
      recognized_by: body.recognizedBy || 'mixed',
      qty_by_section: plan.qtyBySection,
      total_qty: plan.totalQty,
    })
    .select()
    .single();

  if (insErr || !order) {
    return NextResponse.json({ error: insErr?.message || 'Ошибка создания заказа' }, { status: 500 });
  }

  // Items батчем
  const itemRows = plan.items.map((it) => ({
    order_id: order.id,
    catalog_id: it.catalogId,
    color_label: it.colorLabel,
    color_name: it.colorName,
    qty: it.qty,
    bbox: it.bbox,
  }));

  if (itemRows.length > 0) {
    const { error: itemsErr } = await admin
      .from('frame_procurement_order_items')
      .insert(itemRows);
    if (itemsErr) {
      // Откат
      await admin.from('frame_procurement_orders').delete().eq('id', order.id);
      return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ order });
}
