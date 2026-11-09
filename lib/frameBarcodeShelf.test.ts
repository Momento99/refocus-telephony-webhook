import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadFrameBarcodeShelf, type FrameBarcodeShelfRow } from './frameBarcodeShelf';

function fixture(count: number, failPage = 0) {
  const rows: FrameBarcodeShelfRow[] = Array.from({ length: count }, (_, i) => ({
    id: String(i + 1).padStart(8, '0'), barcode: i === count - 1 ? 'KBRPF260263' : `TEST${i}`,
    type_code: 'RP', gender: 'F', price: 1780, year: 26, sold_at: i === count - 1 ? null : '2026-01-01', voided_at: null,
  }));
  const cursors: Array<string | null> = [];
  const client = {
    from(table: string) {
      assert.equal(table, 'frame_barcodes');
      let after: string | null = null;
      let size = 0;
      const query = {
        select: () => query,
        eq(column: string, value: number) { assert.deepEqual([column, value], ['branch_id', 3]); return query; },
        in(column: string, value: number[]) { assert.equal(column, 'year'); assert.deepEqual(value, [24,25,26]); return query; },
        is(column: string, value: null) { assert.deepEqual([column, value], ['voided_at', null]); return query; },
        order(column: string, options: { ascending: boolean }) { assert.equal(column, 'id'); assert.equal(options.ascending, true); return query; },
        limit(value: number) { size = Math.min(value, 1000); return query; },
        gt(column: string, value: string) { assert.equal(column, 'id'); after = value; return query; },
        then(resolve: (value: unknown) => void) {
          cursors.push(after);
          resolve(cursors.length === failPage ? { data: null, error: new Error('network failure') }
            : { data: rows.filter(row => !after || row.id > after).slice(0, size), error: null });
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, rows, cursors };
}
test('all 1024 rows are read, including the active barcode outside the former 1000-row cap', async () => {
  const { client, rows, cursors } = fixture(1024);
  assert.equal(rows.slice(0, 1000).some(row => row.barcode === 'KBRPF260263'), false);
  const actual = await loadFrameBarcodeShelf(client, 3, [24,25,26]);
  assert.deepEqual(actual, rows);
  assert.equal(actual.filter(row => row.barcode === 'KBRPF260263' && !row.sold_at).length, 1);
  assert.deepEqual(cursors, [null, '00000500', '00001000']);
});
test('empty, short and exactly full pages finish without dropping or duplicating rows', async () => {
  for (const count of [0, 1, 499, 500, 1000, 1501]) {
    const { client, rows } = fixture(count);
    const actual = await loadFrameBarcodeShelf(client, 3, [24,25,26]);
    assert.deepEqual(actual, rows);
    assert.equal(new Set(actual.map(row => row.id)).size, count);
  }
});
test('a failure on a later page rejects the whole load, never returns a partial shelf', async () => {
  const { client } = fixture(1024, 3);
  await assert.rejects(loadFrameBarcodeShelf(client, 3, [24,25,26]), /network failure/);
});
