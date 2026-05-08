import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const SR = env.split(/\r?\n/).find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY='))?.split('=')[1].trim();
const URL = 'https://hbvuwnzemdifaapktaol.supabase.co';
const content = fs.readFileSync('docs/training-7.4-edited-2026-04-27.md', 'utf8');

const res = await fetch(URL + '/rest/v1/franchise_hq_items?id=eq.7.4', {
  method: 'PATCH',
  headers: {
    apikey: SR,
    Authorization: 'Bearer ' + SR,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  },
  body: JSON.stringify({ content }),
});

if (!res.ok) {
  console.error('Failed:', res.status, await res.text());
  process.exit(1);
}
console.log('Updated 7.4 in DB —', content.length, 'chars');
