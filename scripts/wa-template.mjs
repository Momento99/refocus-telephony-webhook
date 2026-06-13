#!/usr/bin/env node
/**
 * Просмотр и обновление WhatsApp-шаблона order_ready_ru через Graph API.
 *
 *   node scripts/wa-template.mjs            — только показать текущий шаблон (read-only)
 *   node scripts/wa-template.mjs --submit   — отправить новый body на ревью Meta (edit in place)
 *
 * Токен и waba_id читаются из whatsapp_api_config через service role (.env.local),
 * в stdout НЕ печатаются.
 */
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
loadEnv({ path: path.join(ROOT, '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GRAPH = 'https://graph.facebook.com/v21.0';
const TEMPLATE_NAME = 'order_ready_ru';
const LANG = 'ru';

const NEW_BODY = `Здравствуйте, {{1}}! Ваши очки готовы.

Забрать можно в Refocus, {{2}}.
Часы работы: {{3}}.
К доплате при получении: {{4}}.

Наша гарантия:
• Первые 14 дней — время спокойно привыкнуть к новым очкам. Если что-то не подойдёт по комфорту или посадке, бесплатно поменяем оправу и линзы в той же категории.
• 60 дней — если покажется, что рецепт неточный, всё исправим.
• Дальше — бесплатное обслуживание: подгонка, чистка, мелкий ремонт.

Будем ждать!`;

const EXAMPLE = ['Алексей', 'Беловодск', 'Пн–Сб 09:00–17:00, Вс выходной', '2 500 с'];

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Нет NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в .env.local');
  process.exit(1);
}

const submit = process.argv.includes('--submit');

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const { data: cfg, error } = await sb
  .from('whatsapp_api_config')
  .select('waba_id, access_token')
  .eq('id', 1)
  .single();

if (error || !cfg?.waba_id || !cfg?.access_token) {
  console.error('❌ Не удалось получить waba_id/access_token из whatsapp_api_config:', error?.message);
  process.exit(1);
}

const auth = { Authorization: `Bearer ${cfg.access_token}` };

// 1) Найти текущий шаблон по имени
const listUrl = `${GRAPH}/${cfg.waba_id}/message_templates?name=${TEMPLATE_NAME}&fields=id,name,status,category,language,components&limit=20`;
const listRes = await fetch(listUrl, { headers: auth });
const listJson = await listRes.json();

if (!listRes.ok) {
  console.error('❌ GET message_templates провалился:', JSON.stringify(listJson, null, 2));
  process.exit(1);
}

const matches = (listJson.data || []).filter((t) => t.name === TEMPLATE_NAME);
console.log(`\nНайдено шаблонов с именем ${TEMPLATE_NAME}: ${matches.length}`);
for (const t of matches) {
  console.log(`  • id=${t.id} lang=${t.language} status=${t.status} category=${t.category}`);
}

const target = matches.find((t) => t.language === LANG) || matches[0];
if (!target) {
  console.error('❌ Шаблон не найден в этом WABA. Возможно, имя/язык другие.');
  process.exit(1);
}

const curBody = (target.components || []).find((c) => c.type === 'BODY');
console.log(`\n── Текущий BODY (id=${target.id}, ${target.status}/${target.category}) ──\n${curBody?.text ?? '(нет)'}\n`);

if (!submit) {
  console.log('ℹ️  Это режим просмотра. Чтобы отправить новый текст на ревью: node scripts/wa-template.mjs --submit');
  process.exit(0);
}

// 2) Отправить правку (edit in place — старая версия остаётся рабочей до аппрува)
const editUrl = `${GRAPH}/${target.id}`;
const payload = {
  category: target.category || 'UTILITY',
  components: [
    { type: 'BODY', text: NEW_BODY, example: { body_text: [EXAMPLE] } },
  ],
};
console.log('→ Отправляю правку в Meta…');
const editRes = await fetch(editUrl, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
const editJson = await editRes.json();
if (!editRes.ok) {
  console.error('❌ Правка отклонена API:', JSON.stringify(editJson, null, 2));
  process.exit(1);
}
console.log('✅ Отправлено на ревью:', JSON.stringify(editJson));
console.log('   Статус станет PENDING → APPROVED обычно за 1–3 дня. Старый текст шлётся, пока не одобрят.');
