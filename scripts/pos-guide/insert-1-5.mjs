import fs from 'node:fs/promises';
import path from 'node:path';

const SUPABASE_URL = 'https://hbvuwnzemdifaapktaol.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const content = await fs.readFile(path.resolve('scripts/pos-guide/format-1-5.md'), 'utf8');
console.log(`Content size: ${content.length} chars`);

const res = await fetch(
  `${SUPABASE_URL}/rest/v1/franchise_hq_items?id=eq.1.5`,
  {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      content,
      title: 'Формат точки',
      status: 'Есть',
      completed: true,
      readiness: 100,
      audience: ['hq', 'franchisee'],
    }),
  }
);

if (res.ok) {
  const data = await res.json();
  console.log('✓ Saved:', data[0]?.id, '-', data[0]?.title);
} else {
  console.error('✗ Failed:', res.status, await res.text());
  process.exit(1);
}
