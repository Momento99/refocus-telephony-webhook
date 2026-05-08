#!/usr/bin/env node
// Заливает содержимое docs/attestation-*.md в таблицу franchise_hq_items
// под нужными id (7.6.1, 7.6.2). Идемпотентно — повторный запуск перезаписывает.
//
// Использование:
//   node scripts/seed-attestation-content.mjs
//   node scripts/seed-attestation-content.mjs --only 7.6.1
//
// Берёт NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY из .env.local.

import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
loadEnv({ path: path.join(ROOT, '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Не нашёл NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local');
  process.exit(1);
}

const TARGETS = [
  { id: '7.3',   file: 'docs/training-7.3-wrapped-2026-04-27.md',          label: 'Программа обучения продавца'  },
  { id: '7.4',   file: 'docs/training-7.4-edited-2026-04-27.md',           label: 'Программа обучения диагностики' },
  { id: '7.6.1', file: 'docs/attestation-seller-7.6-2026-05-02.md',        label: 'Аттестация продавца'          },
  { id: '7.6.2', file: 'docs/attestation-diagnost-7.6-2026-05-02.md',      label: 'Аттестация диагноста'         },
  { id: '8.8',   file: 'docs/employment-contract-seller-8.8-2026-05-03.md',   label: 'Трудовой договор продавца' },
  { id: '8.9',   file: 'docs/employment-contract-master-8.9-2026-05-03.md',   label: 'Трудовой договор мастера'  },
  { id: '8.10',  file: 'docs/services-contract-promoter-8.10-2026-05-03.md',  label: 'Договор ГПХ с промоутером' },
];

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const onlyId = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

(async () => {
  let any = false;
  for (const t of TARGETS) {
    if (onlyId && t.id !== onlyId) continue;
    const filePath = path.join(ROOT, t.file);

    let content;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (e) {
      if (e.code === 'ENOENT') {
        console.log(`⏭  ${t.id} — файл ${t.file} не найден, пропускаю`);
        continue;
      }
      throw e;
    }

    console.log(`📄 ${t.id} — ${t.label}: ${content.length} байт из ${t.file}`);

    const { error } = await supabase
      .from('franchise_hq_items')
      .upsert({
        id: t.id,
        status: 'Есть',
        completed: true,
        content,
        notes: '',
      });

    if (error) {
      console.error(`   ❌ Ошибка апсерта ${t.id}:`, error.message);
      process.exit(1);
    }
    console.log(`   ✓ Залито в franchise_hq_items под id='${t.id}'`);
    any = true;
  }

  if (!any) {
    console.log('Нечего заливать.');
  } else {
    console.log('\n✅ Готово. Открой /admin/franchise-hq → раздел «Обучение» — увидишь обновлённые пункты с двумя PDF-кнопками.');
  }
})().catch((e) => {
  console.error('\n❌ Не получилось:', e.message);
  process.exit(1);
});
