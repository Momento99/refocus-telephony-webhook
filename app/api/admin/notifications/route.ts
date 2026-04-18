import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

type RuleCode = 'orders_ready' | 'checkup_reminder' | 'news_campaign';

type PostBody =
  | {
      action: 'saveRule';
      rule: {
        code: RuleCode;
        title: string;
        description: string;
        is_enabled: boolean;
        template_title: string;
        template_body: string;
        send_delay_minutes: number;
        repeat_after_days: number | null;
        checkup_interval_months: number | null;
        quiet_hours: { from: string; to: string };
      };
    }
  | {
      action: 'createCampaign';
      campaign: {
        kind: 'news' | 'promo';
        title: string;
        body: string;
        status: 'draft' | 'scheduled';
        send_at: string | null;
        audience_mode: 'all_opted_in' | 'branches_only';
        branch_ids: number[];
      };
    }
  | {
      action: 'changeCampaignStatus';
      id: string;
      status: 'draft' | 'scheduled' | 'queued' | 'sent' | 'cancelled';
    }
  | {
      action: 'queueCampaignNow';
      id: string;
    }
  | {
      action: 'runCheckupNow';
    }
  | {
      action: 'sendCheckupTest';
      customerId: number;
    }
  | {
      action: 'sendNewsTest';
      customerId: number;
      title?: string;
      body?: string;
    }
  | {
      action: 'sendOrderReadyTest';
      orderId: number;
    };

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing');
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing');
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function GET() {
  try {
    const sb = getSupabaseAdmin();

    const [rulesRes, campaignsRes, queueRes, logsRes, countriesRes] = await Promise.all([
      sb.from('notification_rules').select('*').order('code'),
      sb
        .from('notification_campaigns')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20),
      sb
        .from('notification_dispatch_queue')
        .select(
          'id,status,kind,scheduled_at,created_at,campaign_id,order_id,customer_id'
        )
        .order('created_at', { ascending: false })
        .limit(300),
      sb
        .from('notification_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20),
      sb
        .from('franchise_countries')
        .select('id, name')
        .eq('is_active', true)
        .order('id'),
    ]);

    if (rulesRes.error) throw rulesRes.error;
    if (campaignsRes.error) throw campaignsRes.error;
    if (queueRes.error) throw queueRes.error;
    if (logsRes.error) throw logsRes.error;

    const queueStats = (queueRes.data ?? []).reduce(
      (acc, row) => {
        if (row.status === 'queued') acc.queued += 1;
        if (row.status === 'processing') acc.processing += 1;
        if (row.status === 'sent') acc.sent += 1;
        if (row.status === 'failed') acc.failed += 1;
        return acc;
      },
      { queued: 0, processing: 0, sent: 0, failed: 0 }
    );

    return NextResponse.json({
      ok: true,
      rules: rulesRes.data ?? [],
      campaigns: campaignsRes.data ?? [],
      queueStats,
      recentQueue: (queueRes.data ?? []).slice(0, 12),
      logs: logsRes.data ?? [],
      countries: countriesRes.data ?? [],
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || 'Failed to load notifications dashboard',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const body = (await req.json()) as PostBody;

    if (body.action === 'saveRule') {
      const rule = body.rule;

      const payload = {
        code: rule.code,
        title: rule.title?.trim(),
        description: rule.description?.trim() ?? '',
        is_enabled: !!rule.is_enabled,
        channel: 'push',
        template_title: rule.template_title?.trim() ?? '',
        template_body: rule.template_body?.trim() ?? '',
        send_delay_minutes: Number.isFinite(rule.send_delay_minutes)
          ? Math.max(0, rule.send_delay_minutes)
          : 0,
        repeat_after_days:
          rule.repeat_after_days === null || rule.repeat_after_days === undefined
            ? null
            : Math.max(0, Number(rule.repeat_after_days)),
        checkup_interval_months:
          rule.checkup_interval_months === null ||
          rule.checkup_interval_months === undefined
            ? null
            : Math.max(1, Number(rule.checkup_interval_months)),
        quiet_hours: {
          from: rule.quiet_hours?.from || '21:00',
          to: rule.quiet_hours?.to || '10:00',
        },
        country_id: rule.country_id || null,
      };

      const { data, error } = await sb
        .from('notification_rules')
        .upsert(payload, { onConflict: 'code' })
        .select('*')
        .single();

      if (error) throw error;

      await sb.from('notification_logs').insert({
        source: 'admin_rule',
        source_id: data.id,
        kind: rule.code,
        status: 'success',
        message: `Сценарий ${rule.code} сохранён`,
        meta: payload,
      });

      return NextResponse.json({ ok: true, rule: data });
    }

    if (body.action === 'createCampaign') {
      const c = body.campaign;

      if (!c.title?.trim()) return badRequest('У кампании нет заголовка');
      if (!c.body?.trim()) return badRequest('У кампании нет текста');

      const insertPayload = {
        kind: c.kind,
        title: c.title.trim(),
        body: c.body.trim(),
        status: c.status,
        send_at:
          c.status === 'scheduled' && c.send_at
            ? new Date(c.send_at).toISOString()
            : null,
        audience_mode: c.audience_mode,
        branch_ids: c.branch_ids ?? [],
      };

      const { data, error } = await sb
        .from('notification_campaigns')
        .insert(insertPayload)
        .select('*')
        .single();

      if (error) throw error;

      await sb.from('notification_logs').insert({
        source: 'admin_campaign',
        source_id: data.id,
        kind: 'news_campaign',
        status: 'success',
        message:
          c.status === 'scheduled'
            ? 'Кампания создана как запланированная'
            : 'Черновик кампании создан',
        meta: insertPayload,
      });

      return NextResponse.json({ ok: true, campaign: data });
    }

    if (body.action === 'changeCampaignStatus') {
      const { data, error } = await sb
        .from('notification_campaigns')
        .update({ status: body.status })
        .eq('id', body.id)
        .select('*')
        .single();

      if (error) throw error;

      await sb.from('notification_logs').insert({
        source: 'admin_campaign',
        source_id: data.id,
        kind: 'news_campaign',
        status: 'info',
        message: `Статус кампании изменён на ${body.status}`,
        meta: { status: body.status },
      });

      return NextResponse.json({ ok: true, campaign: data });
    }

    if (body.action === 'queueCampaignNow') {
      const campaignId =
        typeof body.id === 'string' && body.id.trim() ? body.id.trim() : null;

      if (!campaignId) {
        return badRequest('Некорректный campaign id');
      }

      const { data: rpcData, error: rpcError } = await sb.rpc(
        'queue_news_campaign_push',
        { p_campaign_id: campaignId }
      );

      if (rpcError) throw rpcError;

      return NextResponse.json({
        ok: true,
        queuedCount: Number(rpcData ?? 0),
        campaignId,
      });
    }

    if (body.action === 'runCheckupNow') {
      const { data: rpcData, error: rpcError } = await sb.rpc(
        'enqueue_checkup_push_due'
      );

      if (rpcError) throw rpcError;

      return NextResponse.json({
        ok: true,
        queuedCount: Number(rpcData ?? 0),
      });
    }

    if (body.action === 'sendCheckupTest') {
      const customerId = Number(body.customerId);
      if (!Number.isFinite(customerId) || customerId <= 0) {
        return badRequest('Некорректный customerId');
      }

      const { data: rpcData, error: rpcError } = await sb.rpc(
        'enqueue_checkup_push_for_customer',
        { p_customer_id: customerId }
      );

      if (rpcError) throw rpcError;

      return NextResponse.json({
        ok: true,
        queuedCount: Number(rpcData ?? 0),
        customerId,
      });
    }

    if (body.action === 'sendNewsTest') {
      const customerId = Number(body.customerId);
      if (!Number.isFinite(customerId) || customerId <= 0) {
        return badRequest('Некорректный customerId');
      }

      const title =
        typeof body.title === 'string' && body.title.trim()
          ? body.title.trim()
          : 'Тестовая новость Refocus';

      const newsBody =
        typeof body.body === 'string' && body.body.trim()
          ? body.body.trim()
          : 'Это тестовое push-уведомление новостей и акций.';

      const { data: rpcData, error: rpcError } = await sb.rpc(
        'enqueue_news_test_push_for_customer',
        {
          p_customer_id: customerId,
          p_title: title,
          p_body: newsBody,
        }
      );

      if (rpcError) throw rpcError;

      return NextResponse.json({
        ok: true,
        queuedCount: Number(rpcData ?? 0),
        customerId,
      });
    }

    if (body.action === 'sendOrderReadyTest') {
      const orderId = Number(body.orderId);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        return badRequest('Некорректный orderId');
      }

      const { data: rpcData, error: rpcError } = await sb.rpc(
        'enqueue_order_ready_push',
        { p_order_id: orderId }
      );

      if (rpcError) throw rpcError;

      return NextResponse.json({
        ok: true,
        queuedCount: Number(rpcData ?? 0),
        orderId,
      });
    }

    return badRequest('Unknown action');
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || 'Failed to process notifications action',
      },
      { status: 500 }
    );
  }
}