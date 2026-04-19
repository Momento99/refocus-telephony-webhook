import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getCurrentUser } from '@/lib/getUserRole';

export const dynamic = 'force-dynamic';

async function assertOwner() {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, status: 401, msg: 'Не авторизован' };
  const role = (user.app_metadata?.role as string) || 'seller';
  if (role !== 'owner') return { ok: false as const, status: 403, msg: 'Доступ только для владельца' };
  return { ok: true as const, user };
}

export async function GET() {
  const guard = await assertOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.msg }, { status: guard.status });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('instagram_api_config_public')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data ?? null });
}

export async function POST(req: Request) {
  const guard = await assertOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.msg }, { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const {
    ig_business_account_id,
    fb_page_id,
    display_name,
    webhook_verify_token,
    page_access_token,
    app_secret,
    is_active,
  } = body ?? {};

  const update: Record<string, unknown> = {
    updated_by: guard.user.id,
    updated_at: new Date().toISOString(),
  };
  if (typeof ig_business_account_id === 'string') update.ig_business_account_id = ig_business_account_id.trim() || null;
  if (typeof fb_page_id === 'string') update.fb_page_id = fb_page_id.trim() || null;
  if (typeof display_name === 'string') update.display_name = display_name.trim() || null;
  if (typeof webhook_verify_token === 'string') update.webhook_verify_token = webhook_verify_token.trim() || null;
  if (typeof is_active === 'boolean') update.is_active = is_active;

  // Секреты обновляем ТОЛЬКО если пришла непустая строка — иначе оставляем как есть.
  if (typeof page_access_token === 'string' && page_access_token.trim().length > 0) {
    update.page_access_token = page_access_token.trim();
  }
  if (typeof app_secret === 'string' && app_secret.trim().length > 0) {
    update.app_secret = app_secret.trim();
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from('instagram_api_config').update(update).eq('id', 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
