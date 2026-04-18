// app/api/lens-branch-prices/route.ts
// API для управления филиальными ценами по формуле линз.
//
//   GET    /api/lens-branch-prices          → список филиалов + статус формулы
//   POST   /api/lens-branch-prices          → применить формулу (body: { branch_id, prices })
//   DELETE /api/lens-branch-prices?branch_id=<id>  → выключить формулу
//
// Все операции требуют role = 'owner'.

import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

type LensPrice = {
  lens_id: string;
  price_from: number;
  price_to: number;
};

async function requireOwner(): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const sb = getSupabaseServerClient();
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, status: 401, message: 'unauthorized' };
  }
  const role = (userData.user.app_metadata as { role?: string } | undefined)?.role ?? 'seller';
  if (role !== 'owner') {
    return { ok: false, status: 403, message: `forbidden_owner_only (role=${role})` };
  }
  return { ok: true };
}

export async function GET() {
  const auth = await requireOwner();
  if (!auth.ok) return Response.json({ ok: false, error: auth.message }, { status: auth.status });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc('fn_list_lens_formula_status');
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, branches: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireOwner();
  if (!auth.ok) return Response.json({ ok: false, error: auth.message }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const branchId = Number(body?.branch_id ?? body?.branchId);
  const prices = body?.prices as LensPrice[] | undefined;

  if (!Number.isFinite(branchId) || branchId <= 0) {
    return Response.json({ ok: false, error: 'branch_id обязателен' }, { status: 400 });
  }
  if (!Array.isArray(prices) || prices.length === 0) {
    return Response.json({ ok: false, error: 'prices[] обязателен и непустой' }, { status: 400 });
  }

  // Валидируем каждую позицию
  for (const p of prices) {
    if (!p || typeof p.lens_id !== 'string' || !p.lens_id.trim()) {
      return Response.json({ ok: false, error: 'lens_id обязателен в каждой позиции' }, { status: 400 });
    }
    if (!Number.isFinite(p.price_from) || !Number.isFinite(p.price_to) || p.price_from < 0 || p.price_to < 0) {
      return Response.json({ ok: false, error: `некорректные цены у ${p.lens_id}` }, { status: 400 });
    }
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc('fn_apply_lens_formula_to_branch', {
    p_branch_id: branchId,
    p_prices: prices,
  });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, result: data });
}

export async function DELETE(req: Request) {
  const auth = await requireOwner();
  if (!auth.ok) return Response.json({ ok: false, error: auth.message }, { status: auth.status });

  const url = new URL(req.url);
  const branchId = Number(url.searchParams.get('branch_id'));
  if (!Number.isFinite(branchId) || branchId <= 0) {
    return Response.json({ ok: false, error: 'branch_id обязателен' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc('fn_disable_lens_formula_for_branch', {
    p_branch_id: branchId,
  });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, result: data });
}
