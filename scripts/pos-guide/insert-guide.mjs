// Insert/update the POS guide content into franchise_hq_items as id='14.1'.
import fs from 'node:fs/promises';
import path from 'node:path';

const SUPABASE_URL = 'https://hbvuwnzemdifaapktaol.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const content = await fs.readFile(path.resolve('scripts/pos-guide/guide-content.md'), 'utf8');
console.log(`Content size: ${content.length} chars`);

const body = {
  id: '14.1',
  section_key: 'devices',
  sort_order: 10,
  title: 'POS — кассовая программа',
  content,
  status: 'Есть',
  completed: true,
  readiness: 100,
  audience: ['hq', 'franchisee'],
};

// PostgREST upsert
const url = `${SUPABASE_URL}/rest/v1/franchise_hq_items?on_conflict=id`;
const res = await fetch(url, {
  method: 'POST',
  headers: {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=representation',
  },
  body: JSON.stringify(body),
});

if (res.ok) {
  const data = await res.json();
  console.log('✓ Saved:', data[0]?.id, '- title:', data[0]?.title);
} else {
  console.error('✗ Failed:', res.status, await res.text());
  process.exit(1);
}
