import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { isFrameUuid, validateManualDraft } from '@/lib/frameManualProcurement';

export const dynamic = 'force-dynamic';
async function owner() {
  const { data, error } = await getSupabaseServerClient().auth.getUser();
  return !error && data.user?.app_metadata?.role === 'owner';
}
export async function GET() {
  if (!await owner()) return NextResponse.json({ error: 'Нет доступа' }, { status: 403 });
  const { data, error } = await getSupabaseAdmin().from('frame_procurement_orders')
    .select('id,revision,status,manual_draft,total_qty,created_at,updated_at')
    .not('manual_draft', 'is', null).order('updated_at', { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orders: data }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function PUT(req: Request) {
  if (!await owner()) return NextResponse.json({ error: 'Нет доступа' }, { status: 403 });
  let body;
  try {
    body = await req.json();
    if (!isFrameUuid(body.id) || !Number.isInteger(body.revision) || body.revision < 0 || (body.sent !== undefined && typeof body.sent !== 'boolean')) {
      throw new Error('Некорректная версия заказа');
    }
    body.draft = validateManualDraft(body.draft);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ожидается JSON' }, { status: 400 });
  }
  const { data, error } = await getSupabaseAdmin().rpc('save_manual_frame_procurement', {
    p_id: body.id, p_revision: body.revision, p_draft: body.draft, p_sent: body.sent === true,
  }).single();
  if (error) {
    const conflict = error.message.includes('FRAME_DRAFT_CONFLICT');
    return NextResponse.json({ error: conflict
      ? 'Заказ изменён в другой вкладке. Обновите страницу; ваша локальная копия сохранена.' : error.message }, { status: conflict ? 409 : 500 });
  }
  return NextResponse.json({ order: data });
}
