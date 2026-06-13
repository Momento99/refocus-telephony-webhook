/**
 * POST /api/admin/frame-procurement/plan
 *
 * Тело: { branchIds: number[], mode, supplierMin?, customTarget? }
 *   mode: 'sold' | 'scaled' | 'custom'
 *
 * Возвращает OrderPlan: продажи по секциям с ценой + распределение + items.
 * Ничего не сохраняет — просто пересчитывает по текущим продажам и каталогу.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { buildOrderPlan } from '@/lib/frameProcurement';
import type { BuildOrderInput, PlanMode } from '@/lib/frameProcurementTypes';

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

function parseMode(v: unknown): PlanMode {
  if (v === 'sold' || v === 'scaled' || v === 'custom') return v;
  return 'sold';
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

  // Body: branchIds: number[] — обязателен, непустой массив положительных целых.
  const MAX_BRANCH_IDS = 20;
  if (!Array.isArray(body.branchIds)) {
    return NextResponse.json(
      { error: 'branchIds обязателен (массив положительных целых)' },
      { status: 400 },
    );
  }
  if (body.branchIds.length > MAX_BRANCH_IDS) {
    return NextResponse.json(
      { error: `branchIds не должен превышать ${MAX_BRANCH_IDS} элементов` },
      { status: 400 },
    );
  }
  const branchIds: number[] = body.branchIds
    .map((v) => parseInt32(v, 0))
    .filter((n) => n > 0);
  if (branchIds.length === 0) {
    return NextResponse.json(
      { error: 'branchIds обязателен (массив положительных целых)' },
      { status: 400 },
    );
  }

  const VALID_SECTION_KEYS = new Set([
    'PA_F', 'PA_M', 'MA_F', 'MA_M',
    'RP_F', 'RM_F', 'KD_F', 'KD_M',
    'RL_F', 'RL_M',
  ]);
  const excludedSections = Array.isArray(body.excludedSections)
    ? body.excludedSections
        .filter((s): s is string => typeof s === 'string')
        .filter((s) => VALID_SECTION_KEYS.has(s)) as BuildOrderInput['excludedSections']
    : undefined;

  const input: BuildOrderInput = {
    branchIds,
    mode: parseMode(body.mode),
    supplierMin: parseInt32(body.supplierMin, 500) || 500,
    customTarget: parseInt32(body.customTarget, 0),
    excludedSections,
  };

  const admin = getSupabaseAdmin();
  try {
    const plan = await buildOrderPlan(admin, input);
    return NextResponse.json({ plan, input });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
