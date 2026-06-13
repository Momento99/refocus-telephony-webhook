/**
 * PATCH /api/admin/frame-procurement/orders/[id]
 *   Изменить статус заказа. Сейчас поддерживается только переход
 *   { status: 'cancelled' } из статусов 'draft' или 'sent'.
 *   Уже отменённый или принятый заказ отменить нельзя.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await checkOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 403 });

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'id обязателен' }, { status: 400 });
  }

  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ожидается JSON' }, { status: 400 });
  }

  // Пока через этот endpoint разрешён только переход в 'cancelled'.
  // Переходы draft → sent → received идут отдельными путями (создание
  // заказа сразу sent в POST /orders; приёмка — отдельный flow).
  if (body.status !== 'cancelled') {
    return NextResponse.json(
      { error: "Поддерживается только { status: 'cancelled' }" },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();

  // Отменить можно только заказ в статусе draft или sent. Уже отменённый
  // или принятый (received) заказ трогать нельзя — фильтруем в WHERE,
  // и если строка не вернулась — отдаём 404/409 в зависимости от причины.
  const { data: updated, error: updErr } = await admin
    .from('frame_procurement_orders')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .in('status', ['draft', 'sent'])
    .select('*')
    .maybeSingle();

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  if (!updated) {
    // Различаем «нет такого заказа» и «заказ есть, но статус не позволяет».
    const { data: existing, error: getErr } = await admin
      .from('frame_procurement_orders')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();

    if (getErr) {
      return NextResponse.json({ error: getErr.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
    }
    return NextResponse.json(
      {
        error: `Нельзя отменить заказ в статусе '${existing.status}'`,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ order: updated });
}
