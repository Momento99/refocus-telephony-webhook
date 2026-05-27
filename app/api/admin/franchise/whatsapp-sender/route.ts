import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Franchise WhatsApp Sender — обрабатывает очередь franchise_whatsapp_outbox.
 *
 * Отдельная очередь от whatsapp_followup_queue, потому что у нас не customer/order,
 * а franchise application. Логика та же — берёт pending, отправляет через Meta Cloud API,
 * пишет событие в franchise_application_events.
 *
 * Запускается:
 *  - cron'ом Vercel (см. vercel.json)
 *  - вручную через GET/POST с заголовком авторизации
 *
 * Security: bearer WHATSAPP_CRON_SECRET или CRON_SECRET.
 */

const CLOUD_API_BASE = 'https://graph.facebook.com/v21.0';
const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 5;

type OutboxItem = {
  id: string;
  application_id: string;
  recipient_role: string;
  phone_number: string;
  template_name: string;
  template_language: string;
  template_variables: Record<string, string> | null;
  attempts: number;
};

type Config = {
  phone_number_id: string | null;
  access_token: string | null;
  is_active: boolean;
};

async function loadConfig(): Promise<Config | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('whatsapp_api_config')
    .select('phone_number_id, access_token, is_active')
    .eq('id', 1)
    .maybeSingle();
  return (data as Config | null) ?? null;
}

async function sendTemplate(
  cfg: Config,
  item: OutboxItem,
): Promise<{ ok: true; waMessageId: string } | { ok: false; error: string }> {
  if (!cfg.phone_number_id || !cfg.access_token) {
    return { ok: false, error: 'WA config missing phone_number_id or access_token' };
  }

  const vars = item.template_variables ?? {};
  const params = Object.keys(vars)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => ({ type: 'text', text: String(vars[k] ?? '') }));

  const body = {
    messaging_product: 'whatsapp',
    to: item.phone_number,
    type: 'template',
    template: {
      name: item.template_name,
      language: { code: item.template_language || 'ru' },
      components: params.length ? [{ type: 'body', parameters: params }] : [],
    },
  };

  try {
    const r = await fetch(`${CLOUD_API_BASE}/${cfg.phone_number_id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = data?.error;
      return {
        ok: false,
        error: `${r.status} ${err?.code ?? ''} ${err?.message ?? JSON.stringify(data)}`,
      };
    }
    const waMessageId: string | undefined = data?.messages?.[0]?.id;
    if (!waMessageId) return { ok: false, error: 'No message id in response' };
    return { ok: true, waMessageId };
  } catch (e: any) {
    return { ok: false, error: `Fetch error: ${e?.message ?? e}` };
  }
}

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
  const cfg = await loadConfig();
  if (!cfg || !cfg.is_active) {
    return NextResponse.json({
      ok: true,
      skipped: 'WhatsApp integration not active',
      processed: 0,
    });
  }
  if (!cfg.phone_number_id || !cfg.access_token) {
    return NextResponse.json({
      ok: true,
      skipped: 'WhatsApp credentials missing',
      processed: 0,
    });
  }

  const { data: items, error: eSel } = await admin
    .from('franchise_whatsapp_outbox')
    .select(
      'id, application_id, recipient_role, phone_number, template_name, template_language, template_variables, attempts',
    )
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (eSel) return NextResponse.json({ error: eSel.message }, { status: 500 });
  if (!items || items.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, sent: 0, failed: 0 });
  }

  let sent = 0;
  let failed = 0;

  for (const raw of items) {
    const item = raw as OutboxItem;
    const result = await sendTemplate(cfg, item);
    const now = new Date().toISOString();

    if (result.ok) {
      await admin
        .from('franchise_whatsapp_outbox')
        .update({
          status: 'sent',
          sent_at: now,
          sent_message_id: result.waMessageId,
          attempts: (item.attempts ?? 0) + 1,
          last_attempt_at: now,
        })
        .eq('id', item.id);

      // Записываем успех в timeline
      const eventType =
        item.recipient_role === 'applicant' ? 'welcome_whatsapp_sent' : 'owner_alert_sent';
      await admin.from('franchise_application_events').insert({
        application_id: item.application_id,
        event_type: eventType,
        note: `WhatsApp-шаблон «${item.template_name}» отправлен на ${item.phone_number}`,
        payload: { wa_message_id: result.waMessageId, template: item.template_name },
      });
      sent++;
    } else {
      const nextAttempts = (item.attempts ?? 0) + 1;
      const tooMany = nextAttempts >= MAX_ATTEMPTS;
      await admin
        .from('franchise_whatsapp_outbox')
        .update({
          status: tooMany ? 'failed' : 'pending',
          error_message: result.error,
          attempts: nextAttempts,
          last_attempt_at: now,
        })
        .eq('id', item.id);

      if (tooMany) {
        await admin.from('franchise_application_events').insert({
          application_id: item.application_id,
          event_type: 'whatsapp_send_failed',
          note: `Не удалось отправить «${item.template_name}» после ${MAX_ATTEMPTS} попыток: ${result.error}`,
          payload: { error: result.error, template: item.template_name },
        });
      }
      failed++;
    }
  }

  return NextResponse.json({ ok: true, processed: items.length, sent, failed });
}

export async function POST(req: Request) {
  return run(req);
}

export async function GET(req: Request) {
  return run(req);
}
