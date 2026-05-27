import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Franchise Reminder Dispatcher.
 *
 * Каждые 5 минут проверяет:
 *  1. Заявки с reminder_at <= now() и reminder_fired_at IS NULL
 *     → ставит в очередь franchise_reminder_ru
 *     → отмечает reminder_fired_at = now()
 *  2. Встречи через 24 часа (meeting_at - 24h <= now() < meeting_at - 23h)
 *     → ставит franchise_meeting_24h_ru если ещё не ставили
 *  3. Встречи через 2 часа (meeting_at - 2h <= now() < meeting_at - 1h 55m)
 *     → ставит напоминание за 2 часа
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

async function run(req: Request) {
  const authErr = assertAuth(req);
  if (authErr) return NextResponse.json({ error: authErr }, { status: 401 });

  const admin = getSupabaseAdmin();
  const now = new Date();
  const nowIso = now.toISOString();

  // Загружаем owner phone + CRM URL из конфига
  const { data: cfgRows } = await admin.from('franchise_config').select('key, value');
  const cfg: Record<string, string> = {};
  for (const r of (cfgRows ?? []) as Array<{ key: string; value: string }>) cfg[r.key] = r.value;
  const ownerPhone = cfg.owner_whatsapp ?? '+996555244966';
  const crmBase = cfg.crm_base_url ?? 'https://crm.refocus.kg';

  let remindersQueued = 0;
  let meeting24hQueued = 0;
  let meeting2hQueued = 0;

  // ── 1. Обычные напоминания (reminder_at пришло) ───────────────────────────
  const { data: dueReminders } = await admin
    .from('franchise_applications')
    .select('id, name, phone, city, reminder_at, reminder_note')
    .lte('reminder_at', nowIso)
    .is('reminder_fired_at', null)
    .not('reminder_at', 'is', null);

  for (const app of (dueReminders ?? []) as Array<any>) {
    await admin.from('franchise_whatsapp_outbox').insert({
      application_id: app.id,
      recipient_role: 'owner',
      phone_number: ownerPhone,
      template_name: 'franchise_reminder_ru',
      template_language: 'ru',
      template_variables: {
        '1': app.name,
        '2': app.phone,
        '3': app.reminder_note ?? '—',
        '4': `${crmBase}/admin/franchise-applications/${app.id}`,
      },
    });

    await admin
      .from('franchise_applications')
      .update({ reminder_fired_at: nowIso })
      .eq('id', app.id);

    await admin.from('franchise_application_events').insert({
      application_id: app.id,
      event_type: 'reminder_fired',
      note: `Напоминание сработало: ${app.reminder_note ?? '—'}`,
    });

    remindersQueued++;
  }

  // ── 2. За 24 часа до встречи ──────────────────────────────────────────────
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in23h = new Date(now.getTime() + 23 * 60 * 60 * 1000);

  const { data: meetings24h } = await admin
    .from('franchise_applications')
    .select('id, name, phone, meeting_at')
    .lte('meeting_at', in24h.toISOString())
    .gte('meeting_at', in23h.toISOString())
    .is('meeting_reminder_24h_at', null)
    .not('meeting_at', 'is', null);

  for (const app of (meetings24h ?? []) as Array<any>) {
    const meetingDate = new Date(app.meeting_at);
    const meetingTimeStr = meetingDate.toLocaleString('ru-RU', {
      timeZone: 'Asia/Bishkek',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    await admin.from('franchise_whatsapp_outbox').insert({
      application_id: app.id,
      recipient_role: 'owner',
      phone_number: ownerPhone,
      template_name: 'franchise_meeting_24h_ru',
      template_language: 'ru',
      template_variables: {
        '1': app.name,
        '2': meetingTimeStr,
        '3': app.phone,
        '4': `${crmBase}/admin/franchise-applications/${app.id}`,
      },
    });

    await admin
      .from('franchise_applications')
      .update({ meeting_reminder_24h_at: nowIso })
      .eq('id', app.id);

    await admin.from('franchise_application_events').insert({
      application_id: app.id,
      event_type: 'meeting_reminder_24h_queued',
      note: `Напоминание за 24ч до встречи: ${meetingTimeStr}`,
    });

    meeting24hQueued++;
  }

  // ── 3. За 2 часа до встречи ───────────────────────────────────────────────
  const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const in1h55m = new Date(now.getTime() + (2 * 60 - 5) * 60 * 1000);

  const { data: meetings2h } = await admin
    .from('franchise_applications')
    .select('id, name, phone, meeting_at')
    .lte('meeting_at', in2h.toISOString())
    .gte('meeting_at', in1h55m.toISOString())
    .is('meeting_reminder_2h_at', null)
    .not('meeting_at', 'is', null);

  for (const app of (meetings2h ?? []) as Array<any>) {
    const meetingDate = new Date(app.meeting_at);
    const meetingTimeStr = meetingDate.toLocaleString('ru-RU', {
      timeZone: 'Asia/Bishkek',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    // Используем тот же шаблон 24h — он подходит и для 2h (с timestring "через 2 часа")
    await admin.from('franchise_whatsapp_outbox').insert({
      application_id: app.id,
      recipient_role: 'owner',
      phone_number: ownerPhone,
      template_name: 'franchise_meeting_24h_ru',
      template_language: 'ru',
      template_variables: {
        '1': app.name,
        '2': `${meetingTimeStr} (через 2 часа)`,
        '3': app.phone,
        '4': `${crmBase}/admin/franchise-applications/${app.id}`,
      },
    });

    await admin
      .from('franchise_applications')
      .update({ meeting_reminder_2h_at: nowIso })
      .eq('id', app.id);

    await admin.from('franchise_application_events').insert({
      application_id: app.id,
      event_type: 'meeting_reminder_2h_queued',
      note: `Напоминание за 2ч до встречи: ${meetingTimeStr}`,
    });

    meeting2hQueued++;
  }

  return NextResponse.json({
    ok: true,
    reminders: remindersQueued,
    meeting_24h: meeting24hQueued,
    meeting_2h: meeting2hQueued,
  });
}

export async function POST(req: Request) {
  return run(req);
}

export async function GET(req: Request) {
  return run(req);
}
