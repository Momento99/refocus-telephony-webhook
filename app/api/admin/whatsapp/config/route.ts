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
    .from('whatsapp_api_config_public')
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
    waba_id,
    phone_number_id,
    business_phone,
    display_name,
    access_token,
    webhook_verify_token,
    is_active,
    customer_messaging_enabled,
  } = body ?? {};

  const update: Record<string, unknown> = {
    updated_by: guard.user.id,
    updated_at: new Date().toISOString(),
  };
  if (typeof waba_id === 'string') update.waba_id = waba_id.trim() || null;
  if (typeof phone_number_id === 'string') update.phone_number_id = phone_number_id.trim() || null;
  if (typeof business_phone === 'string') update.business_phone = business_phone.trim() || null;
  if (typeof display_name === 'string') update.display_name = display_name.trim() || null;
  if (typeof webhook_verify_token === 'string') update.webhook_verify_token = webhook_verify_token.trim() || null;
  if (typeof is_active === 'boolean') update.is_active = is_active;
  if (typeof customer_messaging_enabled === 'boolean') update.customer_messaging_enabled = customer_messaging_enabled;

  // Токен обновляем ТОЛЬКО если пришла непустая строка — иначе оставляем как есть.
  if (typeof access_token === 'string' && access_token.trim().length > 0) {
    update.access_token = access_token.trim();
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('whatsapp_api_config')
    .update(update)
    .eq('id', 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
