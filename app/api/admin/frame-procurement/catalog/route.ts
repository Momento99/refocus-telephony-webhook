/**
 * GET /api/admin/frame-procurement/catalog
 *   Список всех записей каталога с signed URL для миниатюр.
 *
 * Параметры query:
 *   ?status=all|recognized|unrecognized|needs_review
 *   ?limit=N (default 500)
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'frame-supplier-catalog';
const SIGNED_URL_TTL = 60 * 60; // 1 час

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
  const status = url.searchParams.get('status') || 'all';
  const limit = Math.min(Number(url.searchParams.get('limit') || 500), 2000);

  const admin = getSupabaseAdmin();

  let q = admin
    .from('frame_supplier_catalog')
    .select(
      'id, image_hash, storage_path, width_px, height_px, recognized_by, recognized_at, confidence, supplier_model, type_code, gender, colors, needs_review, manually_corrected, notes, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status === 'recognized') q = q.not('recognized_by', 'is', null);
  if (status === 'unrecognized') q = q.is('recognized_by', null);
  if (status === 'needs_review') q = q.eq('needs_review', true);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Signed URLs батчем
  const paths = (rows ?? []).map((r) => r.storage_path);
  const signedMap: Record<string, string> = {};
  if (paths.length > 0) {
    const { data: signed, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL);
    if (!signErr && signed) {
      for (const s of signed) {
        if (s.path && s.signedUrl) signedMap[s.path] = s.signedUrl;
      }
    }
  }

  const items = (rows ?? []).map((r) => ({
    ...r,
    signed_url: signedMap[r.storage_path] || null,
  }));

  return NextResponse.json({ items, total: items.length });
}
