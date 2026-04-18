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

function isAuthorized(req: NextRequest) {
  const secret = process.env.NOTIFICATIONS_CRON_SECRET;
  if (!secret) return true;

  const bearer = req.headers.get('authorization');
  const headerSecret = req.headers.get('x-cron-secret');
  const querySecret = req.nextUrl.searchParams.get('secret');

  return (
    bearer === `Bearer ${secret}` ||
    headerSecret === secret ||
    querySecret === secret
  );
}

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const sb = getSupabaseAdmin();

    const { data: rule, error: ruleError } = await sb
      .from('notification_rules')
      .select('is_enabled')
      .eq('code', 'checkup_reminder')
      .single();

    if (ruleError) throw ruleError;

    if (!rule?.is_enabled) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'checkup_reminder disabled',
      });
    }

    const { data: queuedData, error: queuedError } = await sb.rpc(
      'enqueue_checkup_push_due'
    );

    if (queuedError) throw queuedError;

    const queuedCount = Number(queuedData ?? 0);

    const baseUrl =
      process.env.APP_BASE_URL || `${req.nextUrl.protocol}//${req.nextUrl.host}`;

    let dispatchJson: any = {
      ok: true,
      picked: 0,
      sent: 0,
      failed: 0,
    };

    if (queuedCount > 0) {
      const secret = process.env.NOTIFICATIONS_CRON_SECRET;

      const dispatchRes = await fetch(
        `${baseUrl}/api/admin/notifications/dispatch`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(secret ? { 'x-cron-secret': secret } : {}),
          },
          body: JSON.stringify({
            limit: 500,
            kind: 'checkup_reminder',
          }),
          cache: 'no-store',
        }
      );

      dispatchJson = await dispatchRes.json().catch(() => null);

      if (!dispatchRes.ok || !dispatchJson?.ok) {
        throw new Error(
          dispatchJson?.error || 'checkup reminders queued, but dispatch failed'
        );
      }
    }

    return NextResponse.json({
      ok: true,
      queuedCount,
      picked: Number(dispatchJson?.picked ?? 0),
      sent: Number(dispatchJson?.sent ?? 0),
      failed: Number(dispatchJson?.failed ?? 0),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || 'Failed to run checkup cron',
      },
      { status: 500 }
    );
  }
}