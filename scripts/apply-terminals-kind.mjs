#!/usr/bin/env node
/**
 * Одноразовый аппликатор миграции 20260427_terminals_add_kind.sql.
 *
 * Запуск:
 *   SUPABASE_DB_PASSWORD='пароль' node scripts/apply-terminals-kind.mjs
 *   или
 *   node scripts/apply-terminals-kind.mjs --db-password 'пароль'
 *
 * Пароль берётся из Supabase Dashboard → Settings → Database → Database password.
 * Миграция идемпотентна, повторный запуск безопасен.
 */

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
const PROJECT_REF = SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];

const args = process.argv.slice(2);
const passIdx = args.indexOf('--db-password');
const dbPassword = passIdx >= 0 ? args[passIdx + 1] : process.env.SUPABASE_DB_PASSWORD;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Не нашёл NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local');
  process.exit(1);
}

if (!dbPassword) {
  console.log('\n⚠️  Нужен пароль БД (одноразово).');
  console.log('   1) Открой: https://supabase.com/dashboard/project/' + PROJECT_REF + '/settings/database');
  console.log('   2) "Database password" → если забыл — Reset.');
  console.log('   3) Запусти:');
  console.log('      SUPABASE_DB_PASSWORD="ТВОЙ_ПАРОЛЬ" node scripts/apply-terminals-kind.mjs');
  process.exit(1);
}

const SQL_FILE = '20260427_terminals_add_kind.sql';

(async () => {
  const pg = await import('pg');
  const { Client } = pg.default;

  const connectionString =
    `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(dbPassword)}` +
    `@aws-0-eu-north-1.pooler.supabase.com:5432/postgres`;

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  console.log('🔌 Подключаюсь к Postgres через pooler…');
  await client.connect();
  console.log('   ✓ Подключено');

  const filePath = path.join(ROOT, 'supabase', 'migrations', SQL_FILE);
  const sql = await fs.readFile(filePath, 'utf-8');
  console.log(`📄 Применяю ${SQL_FILE} (${sql.length} байт)…`);
  try {
    await client.query(sql);
    console.log('   ✓ Готово');
  } catch (e) {
    console.error('   ❌ Ошибка:', e.message);
    await client.end();
    process.exit(1);
  }

  console.log('\n🔍 Проверяю состояние:');
  const { rows: cols } = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'terminals' AND column_name = 'kind'
  `);
  console.log('  колонка kind:', cols);

  const { rows: byKind } = await client.query(`
    SELECT kind, count(*)::int AS n FROM public.terminals GROUP BY kind ORDER BY kind
  `);
  console.log('  распределение:', byKind);

  const { rows: tokmok } = await client.query(`
    SELECT id, terminal_code, name, kind, is_active, is_enabled
    FROM public.terminals
    WHERE branch_id = 5
    ORDER BY id
  `);
  console.log('  Токмок:', tokmok);

  await client.end();
  console.log('\n✅ Готово.');
})().catch((e) => {
  console.error('\n❌ Не получилось:', e.message);
  process.exit(1);
});
