// app/api/dashboard/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireCrmPermission } from '@/lib/crmAccessServer';

export const dynamic = 'force-dynamic';

/**
 * POST /api/dashboard
 * body: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', branch_ids: number[] | null }
 */
export async function POST(req: NextRequest) {
  try {
    const gate = await requireCrmPermission('statistics');
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
    // 1) Читаем тело
    let payload: any = null;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { from, to, branch_ids } = payload ?? {};

    if (!from || !to) {
      return NextResponse.json({ error: 'from/to are required (YYYY-MM-DD)' }, { status: 400 });
    }

    // 2) Создаем серверный клиент
    const supabase = getSupabaseAdmin();

    // 4) Вызов RPC
    const { data, error } = await supabase.rpc('rpc_dashboard', {
      p_date_from: from,
      p_date_to: to,
      p_branch_ids: Array.isArray(branch_ids) ? branch_ids : null
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data ?? {});
  } catch (e: any) {
    // Поймаем всё остальное, чтобы не бегать по логам
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

/** Временный GET, чтобы быстро проверить, что маршрут жив. Можно удалить. */
export async function GET() {
  const gate = await requireCrmPermission('statistics');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  return NextResponse.json({ ok: true, methods: ['GET', 'POST'] });
}
