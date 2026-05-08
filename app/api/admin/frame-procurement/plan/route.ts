/**
 * POST /api/admin/frame-procurement/plan
 *
 * Тело: { branchId, proxyBranchId, windowDays, targetQty, supplierMin, forceProxyOnly? }
 *
 * Возвращает OrderPlan: распределение по секциям + список items для аннотации.
 * Ничего не сохраняет — просто пересчитывает по текущему каталогу и продажам.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { buildOrderPlan } from '@/lib/frameProcurement';
import type { BuildOrderInput } from '@/lib/frameProcurementTypes';

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

function parseInt32(v: unknown, def: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(0, Math.floor(n));
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await checkOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ожидается JSON' }, { status: 400 });
  }

  const branchId = parseInt32(body.branchId, 0);
  const proxyBranchId = parseInt32(body.proxyBranchId, 0);
  if (!branchId || !proxyBranchId) {
    return NextResponse.json(
      { error: 'branchId и proxyBranchId обязательны' },
      { status: 400 },
    );
  }

  const input: BuildOrderInput = {
    branchId,
    proxyBranchId,
    windowDays: parseInt32(body.windowDays, 60) || 60,
    targetQty: parseInt32(body.targetQty, 1000) || 1000,
    supplierMin: parseInt32(body.supplierMin, 500) || 500,
    forceProxyOnly: Boolean(body.forceProxyOnly),
  };

  const admin = getSupabaseAdmin();
  try {
    const plan = await buildOrderPlan(admin, input);
    return NextResponse.json({ plan, input });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
