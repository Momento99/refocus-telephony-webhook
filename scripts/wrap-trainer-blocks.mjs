// One-off: download franchise_hq_items 7.3 and 7.4, save backups,
// wrap trainer-only sections with <!-- TRAINER:START/END --> markers,
// and write wrapped versions next to the backups.
//
// Run: node scripts/wrap-trainer-blocks.mjs           (dry-run, no DB write)
// Run: node scripts/wrap-trainer-blocks.mjs --apply   (push wrapped to DB)
//
// Reads env from .env.local.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Load .env.local ──────────────────────────────────────────────────────────
const envFile = path.join(ROOT, '.env.local');
const envText = fs.readFileSync(envFile, 'utf8');
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter(l => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SUPABASE_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SR_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SR_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');

// ── Strip helper (mirrors lib/franchiseMarkdown.ts) ─────────────────────────
function stripTrainerSections(md) {
  const startCount = (md.match(/<!--\s*TRAINER:START\s*-->/gi) || []).length;
  const endCount = (md.match(/<!--\s*TRAINER:END\s*-->/gi) || []).length;
  let stripped = md.replace(/<!--\s*TRAINER:START\s*-->[\s\S]*?<!--\s*TRAINER:END\s*-->/gi, '');
  stripped = stripped.replace(/\n{3,}/g, '\n\n');
  stripped = stripped.replace(/^(?:---|\*\*\*)\s*\n\s*\n(?:---|\*\*\*)\s*$/gm, '---');
  return { stripped, startCount, endCount };
}

// ── Wrap rules ───────────────────────────────────────────────────────────────

// Generic helper: wrap a region from heading line `startRe` (inclusive) up to
// (exclusive) the next line matching `stopRe`.
// Returns null if the start heading is not found.
function wrapRegion(md, startRe, stopRe) {
  const startMatch = startRe.exec(md);
  if (!startMatch) return null;
  const startIdx = startMatch.index;
  const tail = md.slice(startMatch.index + startMatch[0].length);
  const stopMatch = stopRe.exec(tail);
  const stopIdx = stopMatch ? startMatch.index + startMatch[0].length + stopMatch.index : md.length;

  // Trim trailing whitespace/blank lines and `---` separators just before stop —
  // keep them OUTSIDE the trainer block so the trainee version still has clean
  // section breaks.
  let blockEnd = stopIdx;
  // Move blockEnd backwards past trailing "\n---\n" or blank lines
  const before = md.slice(0, blockEnd);
  const trim = before.match(/(?:\s*\n(?:---|\*\*\*)\s*)+\s*$/);
  if (trim) blockEnd = blockEnd - trim[0].length + trim[0].search(/\S/);
  // Also collapse trailing blank lines
  while (blockEnd > startIdx && /\s/.test(md[blockEnd - 1])) blockEnd--;

  const head = md.slice(0, startIdx);
  const block = md.slice(startIdx, blockEnd);
  const rest = md.slice(blockEnd);
  return head + '<!-- TRAINER:START -->\n' + block + '\n<!-- TRAINER:END -->' + rest;
}

// Wrap each match of a section heading + its body (until next heading at same
// or higher level). Repeats globally.
function wrapAllSections(md, headingRe) {
  // We do this in passes by scanning line-by-line.
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (headingRe.test(line)) {
      // Find end: next line that starts with "#" at same or higher level.
      // The heading we matched is at level = number of leading '#'.
      const levelMatch = line.match(/^(#+)\s/);
      const level = levelMatch ? levelMatch[1].length : 3;
      let j = i + 1;
      while (j < lines.length) {
        const m = lines[j].match(/^(#+)\s/);
        if (m && m[1].length <= level) break;
        j++;
      }
      // Trim trailing blank/`---` lines
      let end = j;
      while (end > i + 1 && (lines[end - 1].trim() === '' || /^(?:---|\*\*\*)+\s*$/.test(lines[end - 1].trim()))) end--;

      out.push('<!-- TRAINER:START -->');
      for (let k = i; k < end; k++) out.push(lines[k]);
      out.push('<!-- TRAINER:END -->');
      // Push back the trimmed tail (blank lines / separators) outside the wrap
      for (let k = end; k < j; k++) out.push(lines[k]);
      i = j;
    } else {
      out.push(line);
      i++;
    }
  }
  return out.join('\n');
}

// Wrap individual paragraphs/lines (single-line) that match a regex.
function wrapMatchingLines(md, lineRe) {
  return md
    .split('\n')
    .map(l => (lineRe.test(l) ? '<!-- TRAINER:START -->\n' + l + '\n<!-- TRAINER:END -->' : l))
    .join('\n');
}

// Wrap from start of file until just before stopRe — for trimming a leading
// methodology preamble before the actual document body. We include any
// trailing "---" separator INSIDE the wrap so the trainee version doesn't
// start with a stray horizontal rule once the preamble is stripped.
function wrapHead(md, stopRe) {
  const stopMatch = stopRe.exec(md);
  if (!stopMatch || stopMatch.index === 0) return null;
  let end = stopMatch.index;
  // Trim trailing whitespace only — keep the "---" separator in.
  while (end > 0 && /\s/.test(md[end - 1])) end--;
  if (end <= 0) return null;
  return '<!-- TRAINER:START -->\n' + md.slice(0, end) + '\n<!-- TRAINER:END -->\n' + md.slice(end);
}

// 7.1 — франчайзи-владелец
function wrap71(md) {
  let out = md;

  // 1) Преамбула в самом начале (текст до "# 7.1.").
  out = wrapHead(out, /^# 7\.1\./m) ?? out;

  // 2) "# 3. Формат обучения владельца" — целиком, до "# 4."
  out = wrapRegion(
    out,
    /^# 3\. Формат обучения владельца.*$/m,
    /^# 4\. /m,
  ) ?? out;

  // 3) Меточная строка-приглашение тренеру внутри §2
  out = wrapMatchingLines(out, /^Вот это нужно проговорить ему сразу.*$/);

  return out;
}

// 7.2 — управляющий
function wrap72(md) {
  let out = md;

  // 1) "# 3. Как обучать управляющего" — целиком, до "# 4."
  out = wrapRegion(
    out,
    /^# 3\. Как обучать управляющего.*$/m,
    /^# 4\. /m,
  ) ?? out;

  // 2) Все ## Сценка / ## Сценка для обучения (в 7.2 эти разделы — H2)
  out = wrapAllSections(out, /^## Сценка(?=\s|$)/);

  // 3) Меточная строка-приглашение тренеру внутри §4
  out = wrapMatchingLines(out, /^Вот это нужно проговорить управляющему.*$/);

  return out;
}

// 7.3 — продавец
function wrap73(md) {
  let out = md;

  // 1) §0 «Зачем этот документ» until before §1
  out = wrapRegion(
    out,
    /^## 0\. Зачем этот документ.*$/m,
    /^## 1\. /m,
  ) ?? out;

  // 2) Все ### [N.M.] Сценка / Сценка для тренера
  // Allow optional "N.", "N.M.", "N.M.K." numeric prefix.
  // Note: \b is ASCII-only in JS regex, so for cyrillic headings we use a
  // lookahead for whitespace or end-of-line.
  out = wrapAllSections(out, /^###\s+(?:\d+(?:\.\d+)*\.\s+)?Сценка(?=\s|$)/);

  // 3) Все ### [N.M.] Проверка усвоения (тренер)
  out = wrapAllSections(out, /^###\s+(?:\d+(?:\.\d+)*\.\s+)?Проверка усвоения(?=\s|$)/);

  // 4) Параграфы вида **Тренер:** ...
  out = wrapMatchingLines(out, /^\*\*Тренер:\*\*/);

  // 4a) Параграфы вида **Сценка:** ... — bold-параграфы внутри обычных секций
  // (например, «**Сценка:** тренер заходит как клиент…» в §5 этап 1).
  out = wrapMatchingLines(out, /^\*\*Сценка:\*\*/);

  // 4b) Блоки вида "> Для практики: тренер ..."
  out = wrapMatchingLines(out, /^>\s*Для практики:.*тренер/i);

  // 5) §11 «План обучения — 6 рабочих дней» — §13 «Инструменты поддержки» (контигуально)
  //    Захватываем 11+12+13 одним блоком, end — перед §14 «Памятка продавцу».
  out = wrapRegion(
    out,
    /^## 11\. План обучения — 6 рабочих дней.*$/m,
    /^## 14\. Памятка продавцу/m,
  ) ?? out;

  return out;
}

// 7.4 — диагностика
function wrap74(md) {
  let out = md;

  // 1) §0 «Зачем этот документ» — до # ДЕНЬ 1 (H1)
  out = wrapRegion(
    out,
    /^## 0\. Зачем этот документ.*$/m,
    /^# ДЕНЬ 1 /m,
  ) ?? out;

  // 2) Все ### [N.M.] Сценка
  out = wrapAllSections(out, /^###\s+(?:\d+(?:\.\d+)*\.\s+)?Сценка(?=\s|$|—|-)/);

  // 3) Все ### [N.M.] Проверка
  out = wrapAllSections(out, /^###\s+(?:\d+(?:\.\d+)*\.\s+)?Проверка(?=\s|$)/);

  // 4) §14 «Финальный экзамен и допуск» — до ## Приложения
  out = wrapRegion(
    out,
    /^## 14\. Финальный экзамен и допуск.*$/m,
    /^## Приложения(?=\s|$)/m,
  ) ?? out;

  return out;
}

// ── Fetch from Supabase ──────────────────────────────────────────────────────
async function fetchItem(id) {
  const url = `${SUPABASE_URL}/rest/v1/franchise_hq_items?id=eq.${id}&select=id,content`;
  const res = await fetch(url, {
    headers: { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` },
  });
  if (!res.ok) throw new Error(`Fetch ${id} failed: ${res.status}`);
  const arr = await res.json();
  if (!arr[0]) throw new Error(`Item ${id} not found`);
  return arr[0].content;
}

async function updateItem(id, content) {
  const url = `${SUPABASE_URL}/rest/v1/franchise_hq_items?id=eq.${id}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SR_KEY,
      Authorization: `Bearer ${SR_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Update ${id} failed: ${res.status} ${await res.text()}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
const date = new Date().toISOString().slice(0, 10);
const docs = path.join(ROOT, 'docs');
fs.mkdirSync(docs, { recursive: true });

const WRAPPERS = {
  '7.1': wrap71,
  '7.2': wrap72,
  '7.3': wrap73,
  '7.4': wrap74,
};

const ONLY = process.argv.find(a => a.startsWith('--only='));
const onlyIds = ONLY ? ONLY.slice('--only='.length).split(',') : null;

for (const id of Object.keys(WRAPPERS)) {
  if (onlyIds && !onlyIds.includes(id)) continue;
  console.log(`\n=== ${id} ===`);
  const raw = await fetchItem(id);

  // Idempotency guard: if the live content already has TRAINER:* markers, the
  // doc was wrapped in a previous run. Re-wrapping would create nested markers
  // and corrupt the doc, so skip and keep the existing wrapping intact.
  if (/<!--\s*TRAINER:(START|END)\s*-->/i.test(raw)) {
    console.log('Already wrapped — skipping (no DB write).');
    continue;
  }

  const backupPath = path.join(docs, `training-${id}-backup-${date}.md`);
  fs.writeFileSync(backupPath, raw, 'utf8');
  console.log(`Backup: ${path.relative(ROOT, backupPath)}  (${raw.length} chars)`);

  const wrapper = WRAPPERS[id];
  const wrapped = wrapper(raw);
  const wrappedPath = path.join(docs, `training-${id}-wrapped-${date}.md`);
  fs.writeFileSync(wrappedPath, wrapped, 'utf8');

  const { stripped, startCount, endCount } = stripTrainerSections(wrapped);
  const trainee = stripped;
  const traineePath = path.join(docs, `training-${id}-trainee-${date}.md`);
  fs.writeFileSync(traineePath, trainee, 'utf8');

  console.log(`Wrapped: ${wrapped.length} chars (Δ +${wrapped.length - raw.length})`);
  console.log(`Trainee: ${trainee.length} chars (-${(((raw.length - trainee.length) / raw.length) * 100).toFixed(1)}%)`);
  console.log(`Markers: ${startCount} START / ${endCount} END  ${startCount === endCount ? 'OK' : 'UNBALANCED!'}`);

  if (startCount !== endCount) {
    console.error('Aborting: unbalanced markers in', id);
    process.exit(1);
  }

  if (APPLY) {
    await updateItem(id, wrapped);
    console.log(`DB updated for ${id}`);
  } else {
    console.log('(dry-run — no DB write)');
  }
}

console.log('\nDone.');
