import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Stale Lead Detector — запускается раз в день в 09:00 Бишкек (= 03:00 UTC, в кроне 0 3 * * *,
 * но в vercel.json указано "0 9 * * *" что = 09:00 UTC = 15:00 Бишкек — приемлемо).
 *
 * Логика:
 *  - Заявка в статусе 'contacted' БЕЗ обновления last_activity_at > 7 дней
 *    → ставит в очередь franchise_stale_ru → тебе на WhatsApp
 *    → отмечает stale_alert_sent_at, чтобы не дублировать
 *  - При активности (status change, новое событие) — last_activity_at обновляется,
 *    stale_alert_sent_at сбрасывается на NULL (это уже делает app-логика)
 *
 * Security: bearer WHATSAPP_CRON_SECRET или CRON_SECRET.
 */

function assertAuth(req: Request): string | null {
  const ours = process.env.WHATSAPP_CRON_SECRET;
  const vercel = process.env.CRON_SECRET;
  if (!ours && !vercel) return 'WHATSAPP_CRON_SECRET or CRON_SECRET env not set';
  const hdr = (req.headers.get('authorization') ?? '').toLowerCase();
  if (ours && hdr === `bearer ${ours}`.toLowerCase()) return null;
  if (vercel && hdr === `bearer ${vercel}`.toLowerCase()) return null;
  return 'unauthorized';
}

const STALE_DAYS = 7;
// Статусы которые "висят" (можно быть в них долго не двигаясь и это плохо)
const STALE_STATUSES = ['contacted', 'qualified', 'negotiation'];

async function run(req: Request) {
  const authErr = assertAuth(req);
  if (authErr) return NextResponse.json({ error: authErr }, { status: 401 });

  const admin = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Загружаем конфиг
  const { data: cfgRows } = await admin.from('franchise_config').select('key, value');
  const cfg: Record<string, string> = {};
  for (const r of (cfgRows ?? []) as Array<{ key: string; value: string }>) cfg[r.key] = r.value;
  const ownerPhone = cfg.owner_whatsapp ?? '+996555244966';
  const crmBase = cfg.crm_base_url ?? 'https://crm.refocus.kg';

  // Найти все stale заявки
  const { data: stale } = await admin
    .from('franchise_applications')
    .select('id, name, phone, status, last_activity_at')
    .in('status', STALE_STATUSES)
    .lt('last_activity_at', cutoff)
    .is('stale_alert_sent_at', null);

  let queued = 0;

  for (const app of (stale ?? []) as Array<any>) {
    const daysIdle = Math.floor(
      (Date.now() - new Date(app.last_activity_at).getTime()) / (24 * 60 * 60 * 1000),
    );

    const statusLabel: Record<string, string> = {
      contacted: 'Связались',
      qualified: 'Квалифицирован',
      negotiation: 'Переговоры',
    };

    await admin.from('franchise_whatsapp_outbox').insert({
      application_id: app.id,
      recipient_role: 'owner',
      phone_number: ownerPhone,
      template_name: 'franchise_stale_ru',
      template_language: 'ru',
      template_variables: {
        '1': app.name,
        '2': statusLabel[app.status] ?? app.status,
        '3': String(daysIdle),
        '4': app.phone,
        '5': `${crmBase}/admin/franchise-applications/${app.id}`,
      },
    });

    await admin
      .from('franchise_applications')
      .update({ stale_alert_sent_at: nowIso })
      .eq('id', app.id);

    await admin.from('franchise_application_events').insert({
      application_id: app.id,
      event_type: 'stale_alert_queued',
      note: `Лид неактивен ${daysIdle} дней в статусе "${app.status}"`,
      payload: { days_idle: daysIdle, status: app.status },
    });

    queued++;
  }

  return NextResponse.json({ ok: true, stale_alerts_queued: queued });
}

export async function POST(req: Request) {
  return run(req);
}

export async function GET(req: Request) {
  return run(req);
}
