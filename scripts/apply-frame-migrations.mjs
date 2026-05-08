#!/usr/bin/env node
/**
 * Одноразовый аппликатор миграций для системы закупки оправ.
 *
 * Запуск:
 *   1) Storage bucket (создаётся автоматически через service_role):
 *        node scripts/apply-frame-migrations.mjs --bucket-only
 *   2) SQL миграции (требуется DB пароль из Supabase Dashboard → Settings → Database):
 *        node scripts/apply-frame-migrations.mjs --db-password 'твой_пароль'
 *      или через переменную окружения:
 *        SUPABASE_DB_PASSWORD='твой_пароль' node scripts/apply-frame-migrations.mjs
 *
 * Bucket создаётся идемпотентно (upsert). DDL пишет CREATE TABLE IF NOT EXISTS,
 * так что повторный запуск безопасен.
 */

import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Грузим .env.local
loadEnv({ path: path.join(ROOT, '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROJECT_REF = SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];

const args = process.argv.slice(2);
const bucketOnly = args.includes('--bucket-only');
const passIdx = args.indexOf('--db-password');
const dbPassword = passIdx >= 0 ? args[passIdx + 1] : process.env.SUPABASE_DB_PASSWORD;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Не нашёл NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local');
  process.exit(1);
}

console.log('Project:', PROJECT_REF);

/* ──────── 1) Storage bucket ──────── */

async function applyBucket() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log('\n📦 Создаю/обновляю Storage bucket "frame-supplier-catalog"…');
  const { data: existing } = await supabase.storage.getBucket('frame-supplier-catalog');

  if (existing) {
    const { error } = await supabase.storage.updateBucket('frame-supplier-catalog', {
      public: false,
      fileSizeLimit: 10485760,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    });
    if (error) throw error;
    console.log('   ✓ Bucket уже был, настройки обновлены');
  } else {
    const { error } = await supabase.storage.createBucket('frame-supplier-catalog', {
      public: false,
      fileSizeLimit: 10485760,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    });
    if (error) throw error;
    console.log('   ✓ Bucket создан');
  }
}

/* ──────── 2) SQL миграции ──────── */

const SQL_FILES = [
  '20260427_frame_supplier_catalog.sql',
  '20260427_frame_procurement_orders.sql',
  // Storage RLS-policies применяем последней — bucket уже создан выше через API
  '20260427_frame_supplier_catalog_storage.sql',
];

async function applyDdl() {
  if (!dbPassword) {
    console.log('\n⚠️  Чтобы создать таблицы — нужен пароль БД (одноразово).');
    console.log('');
    console.log('   1) Открой: https://supabase.com/dashboard/project/' + PROJECT_REF + '/settings/database');
    console.log('   2) Прокрути до "Database password" → если забыл, нажми "Reset database password"');
    console.log('   3) Запусти команду (вставь свой пароль внутри кавычек):');
    console.log('');
    console.log('      node scripts/apply-frame-migrations.mjs --db-password "ТВОЙ_ПАРОЛЬ"');
    console.log('');
    console.log('   Скрипт идемпотентен — повторный запуск безопасен.');
    return false;
  }

  // Динамически импортируем pg, чтобы не было required-зависимости при --bucket-only
  let pg;
  try {
    pg = await import('pg');
  } catch (e) {
    console.error('❌ Пакет "pg" не установлен. Запусти:  npm install pg');
    return false;
  }
  const { Client } = pg.default;

  // Connection через pooler с поддержкой IPv4
  const connectionString =
    `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(dbPassword)}` +
    `@aws-0-eu-north-1.pooler.supabase.com:5432/postgres`;

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  console.log('\n🔌 Подключаюсь к Postgres через pooler…');
  await client.connect();
  console.log('   ✓ Подключено');

  for (const fileName of SQL_FILES) {
    const filePath = path.join(ROOT, 'supabase', 'migrations', fileName);
    const sql = await fs.readFile(filePath, 'utf-8');
    console.log(`\n📄 Применяю ${fileName} (${sql.length} байт)…`);
    try {
      await client.query(sql);
      console.log(`   ✓ Готово`);
    } catch (e) {
      console.error(`   ❌ Ошибка: ${e.message}`);
      console.error(`   (миграции написаны идемпотентно — можно безопасно перезапустить)`);
      await client.end();
      throw e;
    }
  }

  // Verification: проверяем, что таблицы существуют
  console.log('\n🔍 Проверяю таблицы…');
  const { rows: tables } = await client.query(`
    select table_name from information_schema.tables
    where table_schema = 'public'
      and table_name in ('frame_supplier_catalog','frame_procurement_orders','frame_procurement_order_items')
    order by table_name
  `);
  console.log('   ✓ Найдено таблиц:', tables.map((r) => r.table_name).join(', '));

  await client.end();
  return true;
}

/* ──────── main ──────── */

(async () => {
  try {
    await applyBucket();

    if (!bucketOnly) {
      await applyDdl();
    }

    console.log('\n✅ Готово.');
  } catch (e) {
    console.error('\n❌ Не получилось:', e.message);
    process.exit(1);
  }
})();
