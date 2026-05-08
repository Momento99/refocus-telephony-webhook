// One-off: crop decorative top/bottom bands from training-7.3 images so that
// each image fits a PDF page together with its heading instead of being pushed
// to the next page and leaving white gaps.
//
// Reads originals from scripts/img-tmp/, writes cropped to scripts/img-tmp/cropped/,
// and (with --apply) uploads them back to Supabase Storage at the same path,
// overwriting the originals.
//
// Run:
//   node scripts/crop-training-images.mjs            # crop only, no upload
//   node scripts/crop-training-images.mjs --apply    # crop + upload to Storage

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'scripts', 'img-tmp');
const DST = path.join(SRC, 'cropped');
fs.mkdirSync(DST, { recursive: true });

// Pixel offsets to crop from top and bottom of each image.
// Measured by visually inspecting each PNG and locating the first/last pixel
// row of meaningful content (the dark navy "REFOCUS" / "Стандарт Refocus"
// banners or the in-image title that duplicates the markdown heading above).
const CROPS = {
  // §1 Бренд: cuts REFOCUS logo on top + cyan footer block + remnant cyan circle
  '01-brand-3-words.png':          { top:  92, bottom: 200 },
  // §2 Семь правил: cut entire image title (markdown heading already says it),
  // keep subtitle + "Цель" block. Bottom: cut italic line.
  'seven-rules.png':               { top: 165, bottom:  92 },
  // §3 Линзы: cut top/bottom navy bands the user explicitly asked about.
  '03-lenses-cheatsheet.png':      { top: 142, bottom: 105 },
  // §4.3 Подбор формы: cut just the title; landscape, no bottom decoration.
  'face-shape-matrix.png':         { top: 120, bottom:   0 },
  // §5 Клиентский путь: cut "Клиентский путь — этапы X-Y" title + subtitle
  // (markdown heading covers it) + bottom "Стандарт Refocus" line.
  '05-customer-journey-1-3.png':   { top: 152, bottom:  88 },
  '05-customer-journey-4-6.png':   { top: 152, bottom:  88 },
  '05-customer-journey-7-10.png':  { top: 152, bottom:  88 },
  '05-customer-journey-11-14.png': { top: 152, bottom:  88 },
  // §6.1 Гарантии: cut title (markdown heading dups it), keep subtitle.
  '06-warranty-system.png':        { top: 158, bottom: 100 },
  // §6.3 Скрипты гарантий: keep title (markdown heading talks about a
  // narrower topic, so the image's overview title is still informative).
  '06-warranty-scripts.png':       { top:  80, bottom:  88 },
  // §6.2 Скрипт при выдаче: cut title (markdown heading dups), keep subtitle.
  '06-2-pickup-script.png':        { top: 188, bottom: 115 },
  // §6.7 Follow-up: cut title (markdown heading dups), keep subtitle.
  '06-7-followup-2-touches.png':   { top: 158, bottom:  88 },
  // §7 Психология клиента: cut title (markdown heading dups).
  '07-customer-psychology.png':    { top: 152, bottom:  88 },
  // §8 Психология продавца: cut title (markdown heading dups).
  '08-seller-psychology.png':      { top: 158, bottom:  88 },
  // §9 Конфликтные ситуации: cut title (markdown heading dups).
  '09-conflict-situations.png':    { top: 152, bottom:  88 },
};

const APPLY = process.argv.includes('--apply');

async function cropOne(file, top, bottom) {
  const inPath = path.join(SRC, file);
  const outPath = path.join(DST, file);
  const meta = await sharp(inPath).metadata();
  const newHeight = meta.height - top - bottom;
  if (newHeight <= 0) throw new Error(`Bad crop for ${file}: height would be ${newHeight}`);
  await sharp(inPath)
    .extract({ left: 0, top, width: meta.width, height: newHeight })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  const cropped = await sharp(outPath).metadata();
  const inSize = fs.statSync(inPath).size;
  const outSize = fs.statSync(outPath).size;
  return {
    file,
    before: `${meta.width}×${meta.height} (${(inSize / 1024).toFixed(0)} KB)`,
    after:  `${cropped.width}×${cropped.height} (${(outSize / 1024).toFixed(0)} KB)`,
    pctTrimmed: (((meta.height - newHeight) / meta.height) * 100).toFixed(1),
  };
}

async function uploadOne(file) {
  const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  const SR = env.split('\n').find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY='))?.split('=')[1].trim();
  const URL = 'https://hbvuwnzemdifaapktaol.supabase.co';
  const buf = fs.readFileSync(path.join(DST, file));
  const r = await fetch(URL + '/storage/v1/object/franchise-hq-images/training-7-3/' + file, {
    method: 'PUT',
    headers: {
      apikey: SR,
      Authorization: 'Bearer ' + SR,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
      'Cache-Control': 'no-cache',
    },
    body: buf,
  });
  if (!r.ok) throw new Error(`Upload ${file} failed: ${r.status} ${await r.text()}`);
}

console.log(`Cropping ${Object.keys(CROPS).length} images...\n`);
const rows = [];
for (const [file, { top, bottom }] of Object.entries(CROPS)) {
  const r = await cropOne(file, top, bottom);
  rows.push(r);
  console.log(`  ${file.padEnd(38)} ${r.before.padEnd(28)} → ${r.after.padEnd(28)} (-${r.pctTrimmed}%)`);
}

if (APPLY) {
  console.log('\nUploading to Supabase Storage...\n');
  for (const file of Object.keys(CROPS)) {
    await uploadOne(file);
    console.log(`  uploaded: ${file}`);
  }
  console.log('\nDone.');
} else {
  console.log('\n(dry-run — no upload). Re-run with --apply to push to Storage.');
}
