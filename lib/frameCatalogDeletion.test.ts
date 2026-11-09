import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteUnusedFramePhoto, FramePhotoDeleteError } from './frameCatalogDeletion';

function fixture({ used = false, fkConflict = false, storageFailure = false, missing = false } = {}) {
  const writes: string[] = [];
  const admin = {
    from(table: string) {
      let deleting = false;
      const query = {
        select() { return query; },
        delete() { deleting = true; writes.push(`delete:${table}`); return query; },
        eq() { return deleting ? Promise.resolve({ error: fkConflict ? { code: '23503' } : null }) : query; },
        maybeSingle: async () => ({ data: missing ? null : { storage_path: 'test.png' }, error: null }),
        limit: async () => ({ data: used ? [{ id: 'order-item' }] : [], error: null }),
      };
      return query;
    },
    storage: { from: () => ({ remove: async () => { writes.push('delete:storage'); return { error: storageFailure ? { message: 'offline' } : null }; } }) },
  } as unknown as SupabaseClient;
  return { admin, writes };
}
test('a photo used in an order cannot delete the image or any order detail', async () => {
  const { admin, writes } = fixture({ used: true });
  await assert.rejects(deleteUnusedFramePhoto(admin, 'photo'), e => e instanceof FramePhotoDeleteError && e.status === 409);
  assert.deepEqual(writes, []);
});
test('a concurrently saved order prevents physical image deletion through the FK', async () => {
  const { admin, writes } = fixture({ fkConflict: true });
  await assert.rejects(deleteUnusedFramePhoto(admin, 'photo'), e => e instanceof FramePhotoDeleteError && e.status === 409);
  assert.deepEqual(writes, ['delete:frame_supplier_catalog']);
});
test('an unused photo deletes only its catalog row and storage file', async () => {
  const { admin, writes } = fixture();
  assert.equal((await deleteUnusedFramePhoto(admin, 'photo')).storageRemoved, true);
  assert.deepEqual(writes, ['delete:frame_supplier_catalog', 'delete:storage']);
});
test('missing rows are idempotent and a storage failure does not claim full deletion', async () => {
  const missing = fixture({ missing: true });
  assert.equal((await deleteUnusedFramePhoto(missing.admin, 'photo')).alreadyDeleted, true);
  assert.deepEqual(missing.writes, []);
  const failed = fixture({ storageFailure: true });
  assert.equal((await deleteUnusedFramePhoto(failed.admin, 'photo')).storageRemoved, false);
});
