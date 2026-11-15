import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  archiveWhatsappMedia, archiveWhatsappMediaAfterReceive, downloadWhatsappMedia, incomingWhatsappMedia, isTrustedWhatsappMediaUrl,
  normalizeWhatsappMime, openArchivedWhatsappMedia, parseWhatsappMediaReference, WhatsappMediaError,
  WHATSAPP_MEDIA_MAX_BYTES,
} from './whatsappMedia';

const id = '12345678-1234-4234-8234-123456789abc';
const reference = { id, media_url: 'whatsapp-media:123456', media_mime_type: null };

test('media identity and MIME are retained before downloading every supported incoming media type', () => {
  for (const type of ['image', 'audio', 'video', 'document', 'sticker']) {
    assert.deepEqual(incomingWhatsappMedia({ type, [type]: { id: '123456', mime_type: 'audio/ogg; codecs=opus' } }), {
      media_url: 'whatsapp-media:123456', media_mime_type: 'audio/ogg; codecs=opus',
    });
  }
  assert.equal(incomingWhatsappMedia({ type: 'text' }), null);
  assert.equal(incomingWhatsappMedia({ type: 'audio', audio: { id: '../token' } }), null);
});

test('only canonical references and trusted HTTPS Meta media hosts are accepted', () => {
  assert.deepEqual(parseWhatsappMediaReference('whatsapp-media:123456'), { kind: 'meta', mediaId: '123456' });
  assert.deepEqual(parseWhatsappMediaReference(`whatsapp-storage:messages/${id}/123456.ogg`), { kind: 'storage', path: `messages/${id}/123456.ogg` });
  for (const value of ['https://attacker.test/x', 'whatsapp-storage:../../secret', 'whatsapp-media:123?access_token=x']) {
    assert.equal(parseWhatsappMediaReference(value), null);
  }
  assert.ok(isTrustedWhatsappMediaUrl('https://lookaside.fbsbx.com/whatsapp_business/attachments/?x=y'));
  for (const value of ['http://lookaside.fbsbx.com/x', 'https://lookaside.fbsbx.com.evil.test/x', 'https://user:pass@lookaside.fbsbx.com/x', 'https://127.0.0.1/x']) {
    assert.equal(isTrustedWhatsappMediaUrl(value), false);
  }
  assert.equal(normalizeWhatsappMime('text/html'), null);
  assert.equal(normalizeWhatsappMime('audio/ogg\r\nX-Test: injected'), null);
});

test('download obtains a fresh URL and authenticates both requests without following token-leaking redirects', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return calls.length === 1
      ? Response.json({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?fresh=1', mime_type: 'audio/ogg; codecs=opus', file_size: 4 })
      : new Response(new Uint8Array([79, 103, 103, 83]), { headers: { 'Content-Type': 'audio/ogg' } });
  }) as typeof fetch;
  const file = await downloadWhatsappMedia('123456', 'server-token', fetcher);
  assert.deepEqual([...file.bytes], [79, 103, 103, 83]);
  assert.equal(file.mimeType, 'audio/ogg; codecs=opus');
  assert.equal(calls[0].url, 'https://graph.facebook.com/v21.0/123456');
  for (const [index, call] of calls.entries()) {
    assert.equal(new Headers(call.init?.headers).get('Authorization'), 'Bearer server-token');
    assert.equal(call.init?.redirect, index === 0 ? 'error' : 'manual');
    assert.ok(!call.url.includes('server-token'));
  }
});

test('Meta CDN redirects work, but credentials are never forwarded to an untrusted redirect host', async () => {
  const calls: string[] = [];
  const safe = (async (url: string | URL | Request) => {
    calls.push(String(url));
    if (String(url).includes('graph.facebook.com')) return Response.json({ url: 'https://lookaside.fbsbx.com/file', mime_type: 'image/png' });
    if (String(url).includes('lookaside.fbsbx.com')) return new Response(null, { status: 302, headers: { location: 'https://scontent.xx.fbcdn.net/image' } });
    return new Response(new Uint8Array([1, 2, 3]));
  }) as typeof fetch;
  assert.equal((await downloadWhatsappMedia('123456', 'secret', safe)).bytes.length, 3);
  assert.equal(calls.length, 3);
  let badCalls = 0;
  const unsafe = (async () => {
    badCalls++;
    return badCalls === 1 ? Response.json({ url: 'https://lookaside.fbsbx.com/file', mime_type: 'image/png' })
      : new Response(null, { status: 302, headers: { location: 'https://attacker.invalid/collect' } });
  }) as typeof fetch;
  await assert.rejects(downloadWhatsappMedia('123456', 'secret', unsafe));
  assert.equal(badCalls, 2);
});

test('malicious metadata, oversize response and provider failures never return provider secrets', async () => {
  await assert.rejects(downloadWhatsappMedia('123456', 'secret', (async () => Response.json({ url: 'https://evil.test/secret' })) as typeof fetch),
    (error: unknown) => error instanceof WhatsappMediaError && error.code === 'MEDIA_FETCH_FAILED');
  await assert.rejects(downloadWhatsappMedia('123456', 'secret', (async () => Response.json({ url: 'https://lookaside.fbsbx.com/x', file_size: WHATSAPP_MEDIA_MAX_BYTES + 1 })) as typeof fetch),
    (error: unknown) => error instanceof WhatsappMediaError && error.status === 413);
  await assert.rejects(downloadWhatsappMedia('123456', 'secret', (async () => new Response('access_token=secret', { status: 401 })) as typeof fetch),
    (error: unknown) => error instanceof WhatsappMediaError && !error.message.includes('secret') && error.retryable);
});

function fakeAdmin(options: { publicBucket?: boolean; updateFails?: boolean } = {}) {
  const uploads: any[] = [];
  const updates: any[] = [];
  const admin = {
    from(table: string) {
      if (table === 'whatsapp_api_config') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { access_token: 'test-secret' }, error: null }) }) }) };
      assert.equal(table, 'whatsapp_messages');
      return { update(fields: any) { updates.push(fields); return { eq: () => ({ eq: async () => ({ error: options.updateFails ? new Error('fail') : null }) }) }; } };
    },
    storage: {
      getBucket: async () => ({ data: { public: options.publicBucket || false }, error: null }),
      from: () => ({
        upload: async (...args: any[]) => { uploads.push(args); return { error: null }; },
        createSignedUrl: async () => ({ data: { signedUrl: 'https://example.supabase.co/storage/v1/object/sign/private/file?token=short-lived' }, error: null }),
      }),
    },
  } as unknown as SupabaseClient;
  return { admin, uploads, updates };
}

const mediaFetch = (() => {
  return (async (url: string | URL | Request) => String(url).includes('graph.facebook.com')
    ? Response.json({ url: 'https://lookaside.fbsbx.com/media', mime_type: 'image/png', file_size: 3 })
    : new Response(new Uint8Array([1, 2, 3]))) as typeof fetch;
})();

test('archive is private, deterministic and idempotent, and never stores an expiring Meta URL', async () => {
  const { admin, uploads, updates } = fakeAdmin();
  const result = await archiveWhatsappMedia(admin, reference, mediaFetch);
  assert.deepEqual(result, { media_url: `whatsapp-storage:messages/${id}/123456.png`, media_mime_type: 'image/png' });
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0][0], `messages/${id}/123456.png`);
  assert.equal(uploads[0][2].upsert, true);
  assert.deepEqual(updates, [result]);
  await archiveWhatsappMedia(admin, { id, ...result }, (async () => { throw new Error('must not refetch'); }) as typeof fetch);
  assert.equal(uploads.length, 1);
});

test('failed fetch preserves the recoverable original media ID; public storage is rejected', async () => {
  const { admin, uploads, updates } = fakeAdmin();
  await assert.rejects(archiveWhatsappMedia(admin, reference, (async () => { throw new Error('network failed'); }) as typeof fetch));
  assert.equal(updates.length, 0);
  assert.equal(uploads.length, 0);
  await assert.rejects(archiveWhatsappMedia(fakeAdmin({ publicBucket: true }).admin, reference, mediaFetch),
    (error: unknown) => error instanceof WhatsappMediaError && error.code === 'MEDIA_STORAGE_UNSAFE');
});

test('a saved oversize or unsupported attachment is acknowledged, while transient failures remain retriable', async () => {
  const { admin, updates } = fakeAdmin();
  const tooLarge = (async () => Response.json({ url: 'https://lookaside.fbsbx.com/file', mime_type: 'application/pdf', file_size: WHATSAPP_MEDIA_MAX_BYTES + 1 })) as typeof fetch;
  assert.deepEqual(await archiveWhatsappMediaAfterReceive(admin, reference, tooLarge), { archived: false, permanentError: 'MEDIA_TOO_LARGE' });
  const unsupported = (async (url: string | URL | Request) => String(url).includes('graph.facebook.com')
    ? Response.json({ url: 'https://lookaside.fbsbx.com/file', mime_type: 'text/html' })
    : new Response('<html>untrusted</html>', { headers: { 'Content-Type': 'text/html' } })) as typeof fetch;
  assert.deepEqual(await archiveWhatsappMediaAfterReceive(admin, reference, unsupported), { archived: false, permanentError: 'MEDIA_UNSUPPORTED' });
  assert.deepEqual(await archiveWhatsappMediaAfterReceive(admin, reference, (async () => Response.json({ error: { code: 100 } }, { status: 400 })) as typeof fetch),
    { archived: false, permanentError: 'MEDIA_NOT_AVAILABLE' });
  assert.equal(updates.length, 0, 'original media reference is retained for an explanatory UI error');
  await assert.rejects(archiveWhatsappMediaAfterReceive(admin, reference, (async () => new Response('temporary', { status: 500 })) as typeof fetch),
    (error: unknown) => error instanceof WhatsappMediaError && error.retryable);
});

test('archived audio supports seeking via byte ranges and does not expose signed URLs in output headers', async () => {
  const { admin } = fakeAdmin();
  let requestedRange: string | null = null;
  const result = await openArchivedWhatsappMedia(admin, {
    id, media_url: `whatsapp-storage:messages/${id}/123456.ogg`, media_mime_type: 'audio/ogg; codecs=opus',
  }, 'bytes=1-2', (async (_url, init) => {
    requestedRange = new Headers(init?.headers).get('Range');
    return new Response(new Uint8Array([2, 3]), { status: 206, headers: { 'Content-Range': 'bytes 1-2/3', 'Content-Length': '2' } });
  }) as typeof fetch);
  assert.equal(requestedRange, 'bytes=1-2');
  assert.equal(result.status, 206);
  assert.equal(result.headers.get('Content-Type'), 'audio/ogg; codecs=opus');
  assert.equal(result.headers.get('Content-Range'), 'bytes 1-2/3');
  assert.equal(result.headers.get('Location'), null);
  assert.deepEqual([...new Uint8Array(await result.arrayBuffer())], [2, 3]);
});
