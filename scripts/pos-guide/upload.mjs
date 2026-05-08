// Upload all annotated screenshots to Supabase storage bucket franchise-hq-images/devices-pos/

import fs from 'node:fs/promises';
import path from 'node:path';

const SUPABASE_URL = 'https://hbvuwnzemdifaapktaol.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY first');
  process.exit(1);
}

const SRC = path.resolve('docs/pos-screenshots');
const BUCKET = 'franchise-hq-images';
const FOLDER = 'devices-pos';

const files = (await fs.readdir(SRC))
  .filter((f) => f.endsWith('.png'))
  .filter((f) => !f.startsWith('demo-')); // skip demo screenshots

console.log(`Uploading ${files.length} files to ${BUCKET}/${FOLDER}/`);
let ok = 0, fail = 0;

for (const file of files) {
  const local = path.join(SRC, file);
  const data = await fs.readFile(local);
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${FOLDER}/${file}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: data,
  });

  if (res.ok) {
    console.log(`  ✓ ${file}`);
    ok++;
  } else {
    const txt = await res.text();
    console.log(`  ✗ ${file}: ${res.status} ${txt.slice(0, 200)}`);
    fail++;
  }
}

console.log(`\nDone: ${ok} uploaded, ${fail} failed`);
console.log(`Public URL: ${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${FOLDER}/<file>`);
