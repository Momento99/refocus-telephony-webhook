import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Instagram Messaging Webhook
 *
 * GET: verification challenge. Query: hub.mode, hub.verify_token, hub.challenge.
 * POST: incoming DMs, message reactions, read receipts, echoes.
 *
 * Payload format = Messenger Platform (entry[].messaging[]), not Cloud API.
 * Verify token + app secret stored in instagram_api_config.
 */

async function getConfig(): Promise<{
  verifyToken: string | null;
  appSecret: string | null;
  businessId: string | null;
}> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('instagram_api_config')
    .select('webhook_verify_token, app_secret, ig_business_account_id')
    .eq('id', 1)
    .maybeSingle();
  return {
    verifyToken: (data?.webhook_verify_token as string | null) ?? null,
    appSecret: (data?.app_secret as string | null) ?? null,
    businessId: (data?.ig_business_account_id as string | null) ?? null,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  const { verifyToken } = await getConfig();
  if (mode === 'subscribe' && verifyToken && token === verifyToken) {
    return new Response(challenge ?? '', { status: 200 });
  }
  return new Response('forbidden', { status: 403 });
}

function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const provided = header.slice('sha256='.length);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}

type IgAttachment = {
  type?: 'image' | 'video' | 'audio' | 'file' | 'share' | 'story_mention' | 'template' | 'fallback' | 'location';
  payload?: { url?: string; title?: string; sticker_id?: string };
};

type IgMessage = {
  mid?: string;
  text?: string;
  is_echo?: boolean;
  is_deleted?: boolean;
  is_unsupported?: boolean;
  attachments?: IgAttachment[];
  reply_to?: { story?: { url?: string; id?: string }; mid?: string };
  reaction?: { reaction?: string; action?: 'react' | 'unreact'; mid?: string; emoji?: string };
  referral?: unknown;
};

type IgMessaging = {
  sender: { id: string; username?: string };
  recipient: { id: string };
  timestamp?: number;
  message?: IgMessage;
  read?: { mid?: string; watermark?: number };
  reaction?: { mid: string; action: 'react' | 'unreact'; reaction?: string; emoji?: string };
};

type IgPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    messaging?: IgMessaging[];
    changes?: Array<{ field?: string; value?: unknown }>;
  }>;
};

function pickMessageType(m: IgMessage): {
  type:
    | 'text'
    | 'image'
    | 'video'
    | 'audio'
    | 'file'
    | 'sticker'
    | 'reaction'
    | 'story_reply'
    | 'story_mention'
    | 'share'
    | 'deleted'
    | 'unsupported';
  mediaUrl: string | null;
  body: string | null;
} {
  if (m.is_deleted) return { type: 'deleted', mediaUrl: null, body: null };
  if (m.is_unsupported) return { type: 'unsupported', mediaUrl: null, body: null };
  if (m.reaction?.reaction) {
    return { type: 'reaction', mediaUrl: null, body: `[Реакция: ${m.reaction.emoji ?? m.reaction.reaction}]` };
  }
  if (m.reply_to?.story) {
    return { type: 'story_reply', mediaUrl: m.reply_to.story.url ?? null, body: m.text ?? '[Ответ на историю]' };
  }

  const att = m.attachments?.[0];
  if (att?.type === 'story_mention') {
    return { type: 'story_mention', mediaUrl: att.payload?.url ?? null, body: m.text ?? '[Упоминание в истории]' };
  }
  if (att?.type === 'image') return { type: 'image', mediaUrl: att.payload?.url ?? null, body: m.text ?? null };
  if (att?.type === 'video') return { type: 'video', mediaUrl: att.payload?.url ?? null, body: m.text ?? null };
  if (att?.type === 'audio') return { type: 'audio', mediaUrl: att.payload?.url ?? null, body: null };
  if (att?.type === 'file') return { type: 'file', mediaUrl: att.payload?.url ?? null, body: att.payload?.title ?? null };
  if (att?.type === 'share') return { type: 'share', mediaUrl: att.payload?.url ?? null, body: att.payload?.title ?? null };

  if (m.text) return { type: 'text', mediaUrl: null, body: m.text };
  return { type: 'unsupported', mediaUrl: null, body: null };
}

async function findOrCreateThread(
  igUserId: string,
  igUsername: string | null,
): Promise<string | null> {
  const admin = getSupabaseAdmin();

  const { data: existing } = await admin
    .from('instagram_threads')
    .select('id, status')
    .eq('ig_user_id', igUserId)
    .maybeSingle();

  if (existing?.id) {
    // Unique constraint on ig_user_id — only one row per user ever.
    // Re-open if closed.
    if (existing.status === 'closed') {
      await admin
        .from('instagram_threads')
        .update({ status: 'waiting_seller', closed_at: null, close_reason: null })
        .eq('id', existing.id);
    }
    if (igUsername) {
      await admin.from('instagram_threads').update({ ig_username: igUsername }).eq('id', existing.id);
    }
    return existing.id as string;
  }

  const { data: newThread, error } = await admin
    .from('instagram_threads')
    .insert({
      ig_user_id: igUserId,
      ig_username: igUsername,
      status: 'waiting_seller',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[ig webhook] failed to create thread', error);
    return null;
  }
  return newThread.id as string;
}

async function ingestInbound(m: IgMessage, senderId: string, ts: number | undefined) {
  const admin = getSupabaseAdmin();
  const createdAt = ts ? new Date(ts).toISOString() : new Date().toISOString();

  // Try to resolve username via Graph API lookup if we have access token.
  // Skip for MVP — use null, user appears as "@<igsid>" in UI. Can add enrichment later.
  const igUsername: string | null = null;

  const threadId = await findOrCreateThread(senderId, igUsername);
  if (!threadId) return;

  const { type, body, mediaUrl } = pickMessageType(m);

  const { error } = await admin.from('instagram_messages').insert({
    thread_id: threadId,
    direction: 'inbound',
    ig_message_id: m.mid ?? null,
    message_type: type,
    body,
    media_url: mediaUrl,
    status: 'delivered',
    created_at: createdAt,
    reply_to_ig_message_id: m.reply_to?.mid ?? null,
  });

  if (error) {
    if ((error as { code?: string }).code !== '23505') {
      console.error('[ig webhook] msg insert error', error);
    }
    return;
  }

  const { data: thread } = await admin
    .from('instagram_threads')
    .select('first_customer_message_at, unread_count')
    .eq('id', threadId)
    .maybeSingle();

  const patch: Record<string, unknown> = {
    last_message_at: createdAt,
    last_customer_message_at: createdAt,
    unread_count: ((thread?.unread_count as number | null) ?? 0) + 1,
    status: 'waiting_seller',
  };
  if (!thread?.first_customer_message_at) patch.first_customer_message_at = createdAt;

  await admin.from('instagram_threads').update(patch).eq('id', threadId);
}

async function ingestEchoOutbound(m: IgMessage, recipientId: string, ts: number | undefined) {
  // Echo = we sent via Graph API or via IG mobile app. Avoid duplicating messages
  // already inserted from /api/instagram/send (it sets ig_message_id synchronously).
  if (!m.mid) return;
  const admin = getSupabaseAdmin();

  // Primary match: by ig_message_id (set by /api/instagram/send immediately after Meta responds).
  const { data: existing } = await admin
    .from('instagram_messages')
    .select('id, status')
    .eq('ig_message_id', m.mid)
    .maybeSingle();

  if (existing?.id) {
    if (existing.status === 'pending' || existing.status === 'sent') {
      await admin.from('instagram_messages').update({ status: 'delivered' }).eq('id', existing.id);
    }
    return;
  }

  // Fallback: echo could arrive before /api/instagram/send's UPDATE lands.
  // Find a recent pending/sent outbound in the same thread with matching body.
  const threadId = await findOrCreateThread(recipientId, null);
  if (!threadId) return;

  const { type, body, mediaUrl } = pickMessageType(m);
  const createdAt = ts ? new Date(ts).toISOString() : new Date().toISOString();

  if (body) {
    const raceCutoff = new Date(Date.now() - 60_000).toISOString();
    const { data: raceRow } = await admin
      .from('instagram_messages')
      .select('id')
      .eq('thread_id', threadId)
      .eq('direction', 'outbound')
      .in('status', ['pending', 'sent'])
      .eq('body', body)
      .is('ig_message_id', null)
      .gte('created_at', raceCutoff)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (raceRow?.id) {
      await admin
        .from('instagram_messages')
        .update({ status: 'delivered', ig_message_id: m.mid })
        .eq('id', raceRow.id);
      await admin
        .from('instagram_threads')
        .update({ last_message_at: createdAt, status: 'waiting_customer' })
        .eq('id', threadId);
      return;
    }
  }

  // Truly external send (e.g. seller used Instagram mobile app). Mirror into thread.
  await admin.from('instagram_messages').insert({
    thread_id: threadId,
    direction: 'outbound',
    ig_message_id: m.mid,
    message_type: type,
    body,
    media_url: mediaUrl,
    status: 'delivered',
    created_at: createdAt,
  });

  await admin
    .from('instagram_threads')
    .update({ last_message_at: createdAt, status: 'waiting_customer' })
    .eq('id', threadId);
}

async function ingestRead(senderId: string, watermark: number | undefined) {
  if (!watermark) return;
  const admin = getSupabaseAdmin();
  const cutoff = new Date(watermark).toISOString();

  const { data: thread } = await admin
    .from('instagram_threads')
    .select('id')
    .eq('ig_user_id', senderId)
    .maybeSingle();
  if (!thread?.id) return;

  await admin
    .from('instagram_messages')
    .update({ status: 'read' })
    .eq('thread_id', thread.id)
    .eq('direction', 'outbound')
    .lte('created_at', cutoff)
    .in('status', ['sent', 'delivered']);
}

export async function POST(req: Request) {
  const raw = await req.text();

  // HMAC signature check if app_secret is configured.
  const { appSecret, businessId } = await getConfig();
  if (appSecret) {
    const header = req.headers.get('x-hub-signature-256');
    if (!verifySignature(raw, header, appSecret)) {
      console.warn('[ig webhook] signature mismatch');
      return NextResponse.json({ ok: true }); // 200 to prevent Meta retries
    }
  }

  let payload: IgPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }

  if (payload.object !== 'instagram') return NextResponse.json({ ok: true });

  try {
    for (const entry of payload.entry ?? []) {
      for (const m of entry.messaging ?? []) {
        const isFromBusiness = businessId && m.sender.id === businessId;
        try {
          if (m.read?.watermark) {
            await ingestRead(m.sender.id, m.read.watermark);
            continue;
          }
          if (m.reaction) {
            // Persist reaction as a separate message entry.
            const fakeMsg: IgMessage = {
              mid: m.reaction.mid,
              reaction: {
                reaction: m.reaction.reaction,
                action: m.reaction.action,
                emoji: m.reaction.emoji,
              },
            };
            if (isFromBusiness) {
              await ingestEchoOutbound(fakeMsg, m.recipient.id, m.timestamp);
            } else {
              await ingestInbound(fakeMsg, m.sender.id, m.timestamp);
            }
            continue;
          }
          if (!m.message) continue;

          if (m.message.is_echo) {
            await ingestEchoOutbound(m.message, m.recipient.id, m.timestamp);
          } else {
            await ingestInbound(m.message, m.sender.id, m.timestamp);
          }
        } catch (e) {
          console.error('[ig webhook] messaging handler fail', e);
        }
      }
    }
  } catch (e) {
    console.error('[ig webhook] processing error', e);
  }

  return NextResponse.json({ ok: true });
}
