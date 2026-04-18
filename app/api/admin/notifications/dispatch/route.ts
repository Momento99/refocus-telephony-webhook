import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing');
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing');

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

type QueueKind = 'orders_ready' | 'checkup_reminder' | 'news_campaign';

type QueueRow = {
  id: string;
  kind: QueueKind;
  rule_code: string | null;
  campaign_id?: string | null;
  customer_id: number | null;
  order_id: number | null;
  auth_user_id: string | null;
  device_id: string | null;
  expo_push_token: string | null;
  scheduled_at: string;
  status: 'queued' | 'processing' | 'sent' | 'failed' | 'cancelled';
  payload: {
    title?: string;
    body?: string;
    order_id?: number;
    order_no?: string;
    branch_id?: number;
    customer_id?: number;
    [key: string]: unknown;
  } | null;
};

type ExpoTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: Record<string, unknown>;
};

function parseKind(value: unknown): QueueKind | null {
  if (
    value === 'orders_ready' ||
    value === 'checkup_reminder' ||
    value === 'news_campaign'
  ) {
    return value;
  }
  return null;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonCors(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      ...corsHeaders(),
      ...(init?.headers ?? {}),
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();

    const body = await req.json().catch(() => ({}));

    const rawLimit = Number(body?.limit ?? 20);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 100)
      : 20;

    const rawOrderId = Number(body?.orderId ?? 0);
    const orderId =
      Number.isFinite(rawOrderId) && rawOrderId > 0 ? rawOrderId : null;

    const rawCustomerId = Number(body?.customerId ?? 0);
    const customerId =
      Number.isFinite(rawCustomerId) && rawCustomerId > 0 ? rawCustomerId : null;

    const kind = parseKind(body?.kind);

    const campaignId =
      typeof body?.campaignId === 'string' && body.campaignId.trim()
        ? body.campaignId.trim()
        : null;

    let pickQuery = sb
      .from('notification_dispatch_queue')
      .select('*')
      .eq('status', 'queued');

    if (kind) {
      pickQuery = pickQuery.eq('kind', kind);
    }

    if (orderId) {
      pickQuery = pickQuery.eq('order_id', orderId);
    }

    if (customerId) {
      pickQuery = pickQuery.eq('customer_id', customerId);
    }

    if (campaignId) {
      pickQuery = pickQuery.eq('campaign_id', campaignId);
    }

    const { data: pickedRows, error: pickError } = await pickQuery
      .order('scheduled_at', { ascending: true })
      .limit(limit);

    if (pickError) throw pickError;

    const rows = ((pickedRows ?? []) as QueueRow[]).filter(
      (row) =>
        !!row.expo_push_token &&
        typeof row.payload?.title === 'string' &&
        typeof row.payload?.body === 'string'
    );

    if (rows.length === 0) {
      return jsonCors({
        ok: true,
        picked: 0,
        sent: 0,
        failed: 0,
        message: 'Нет queued push-уведомлений для отправки',
        filter: { kind, orderId, customerId, campaignId },
      });
    }

    const rowIds = rows.map((row) => row.id);

    const { error: markProcessingError } = await sb
      .from('notification_dispatch_queue')
      .update({
        status: 'processing',
        processed_at: new Date().toISOString(),
      })
      .in('id', rowIds);

    if (markProcessingError) throw markProcessingError;

    const messages = rows.map((row) => ({
      to: row.expo_push_token as string,
      title: row.payload?.title as string,
      body: row.payload?.body as string,
      data: {
        kind: row.kind,
        queue_id: row.id,
        campaign_id: row.campaign_id ?? null,
        order_id: row.order_id,
        customer_id: row.customer_id,
        ...(row.payload ?? {}),
      },
      sound: 'default',
    }));

    const expoHeaders: Record<string, string> = {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    };

    const expoAccessToken = process.env.EXPO_ACCESS_TOKEN;
    if (expoAccessToken) {
      expoHeaders.Authorization = `Bearer ${expoAccessToken}`;
    }

    const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: expoHeaders,
      body: JSON.stringify(messages),
    });

    const expoJson = await expoRes.json().catch(() => null);

    if (!expoRes.ok) {
      const message =
        typeof expoJson?.errors?.[0]?.message === 'string'
          ? expoJson.errors[0].message
          : `Expo push request failed with status ${expoRes.status}`;

      await sb
        .from('notification_dispatch_queue')
        .update({
          status: 'failed',
          processed_at: new Date().toISOString(),
          result_message: message,
        })
        .in('id', rowIds);

      await sb.from('notification_logs').insert(
        rows.map((row) => ({
          source: 'push_dispatch',
          source_id: row.id,
          kind: row.kind,
          status: 'error',
          customer_id: row.customer_id,
          message,
          meta: {
            order_id: row.order_id,
            customer_id: row.customer_id,
            campaign_id: row.campaign_id ?? null,
            device_id: row.device_id,
            http_status: expoRes.status,
          },
        }))
      );

      return jsonCors(
        {
          ok: false,
          picked: rows.length,
          sent: 0,
          failed: rows.length,
          error: message,
          filter: { kind, orderId, customerId, campaignId },
        },
        { status: 500 }
      );
    }

    const tickets: ExpoTicket[] = Array.isArray(expoJson?.data)
      ? expoJson.data
      : Array.isArray(expoJson)
      ? expoJson
      : [];

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const ticket = tickets[i];

      const isOk = ticket?.status === 'ok';
      const resultMessage = isOk
        ? ticket?.id
          ? `Expo ticket: ${ticket.id}`
          : 'Queued in Expo'
        : ticket?.message || 'Expo rejected notification';

      const nextStatus = isOk ? 'sent' : 'failed';

      if (isOk) sent += 1;
      else failed += 1;

      const { error: updateError } = await sb
        .from('notification_dispatch_queue')
        .update({
          status: nextStatus,
          processed_at: new Date().toISOString(),
          result_message: resultMessage,
        })
        .eq('id', row.id);

      if (updateError) throw updateError;

      const { error: logError } = await sb.from('notification_logs').insert({
        source: 'push_dispatch',
        source_id: row.id,
        kind: row.kind,
        status: isOk ? 'success' : 'error',
        customer_id: row.customer_id,
        message: isOk ? 'Push отправлен в Expo' : 'Push отклонён Expo',
        meta: {
          order_id: row.order_id,
          customer_id: row.customer_id,
          campaign_id: row.campaign_id ?? null,
          device_id: row.device_id,
          expo_ticket: ticket ?? null,
        },
      });

      if (logError) throw logError;
    }

    return jsonCors({
      ok: true,
      picked: rows.length,
      sent,
      failed,
      filter: { kind, orderId, customerId, campaignId },
    });
  } catch (error: any) {
    return jsonCors(
      {
        ok: false,
        error: error?.message || 'Failed to dispatch push notifications',
      },
      { status: 500 }
    );
  }
}