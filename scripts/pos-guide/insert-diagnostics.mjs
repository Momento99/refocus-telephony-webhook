import fs from 'node:fs/promises';
import path from 'node:path';

const SUPABASE_URL = 'https://hbvuwnzemdifaapktaol.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const content = await fs.readFile(path.resolve('scripts/pos-guide/diagnostics-content.md'), 'utf8');
console.log(`Content size: ${content.length} chars`);

const body = {
  id: '7.4',
  section_key: 'training',
  sort_order: 40,
  title: 'Программа обучения диагностике',
  content,
  status: 'Есть',
  completed: true,
  readiness: 100,
  audience: ['hq', 'franchisee'],
};

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
