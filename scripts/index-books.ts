/**
 * Indexes PDF/EPUB business books into Supabase (ai_knowledge_books + ai_knowledge_chunks).
 *
 * Usage:
 *   1) put PDF and/or EPUB files into ./knowledge-books/
 *      File names must match `file` field in manifest.json (without extension).
 *      If both .epub and .pdf are present → EPUB is preferred (cleaner text).
 *   2) fill ./knowledge-books/manifest.json with metadata for each file
 *   3) ensure .env.local has: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY
 *   4) npm run index-books
 *
 * Safe to re-run: books that already have status='indexed' are skipped.
 * Pass --force <file-basename> to reindex a specific book.
 */

// Polyfill Promise.try for Node < 23 (unpdf/pdfjs needs it)
if (typeof (Promise as unknown as { try?: unknown }).try !== 'function') {
  (Promise as unknown as { try: <T>(fn: (...args: unknown[]) => T | Promise<T>, ...args: unknown[]) => Promise<T> }).try =
    <T>(fn: (...args: unknown[]) => T | Promise<T>, ...args: unknown[]): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        try { resolve(fn(...args)); } catch (e) { reject(e); }
      });
}

import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

loadEnv({ path: path.join(repoRoot, '.env.local') });
loadEnv({ path: path.join(repoRoot, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !VOYAGE_KEY) {
  console.error('❌ missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VOYAGE_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const require = createRequire(import.meta.url);

async function parsePdfWithUnpdf(buf: Buffer): Promise<{ text: string; numpages: number }> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const data = new Uint8Array(buf);
  const pdf = await getDocumentProxy(data);
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  const out = Array.isArray(text) ? text.join('\n') : text;
  return { text: out ?? '', numpages: totalPages ?? 0 };
}

function loadPdfParseFallback(): (buf: Buffer) => Promise<{ text: string; numpages: number }> {
  return require('pdf-parse');
}

type EPubModule = {
  EPub: {
    createAsync(filepath: string): Promise<{
      flow: Array<{ id: string }>;
      getChapterAsync(id: string): Promise<string>;
    }>;
  };
};

function loadEpubLib(): EPubModule {
  return require('epub2');
}

const BOOKS_DIR = path.join(repoRoot, 'knowledge-books');
const MANIFEST_PATH = path.join(BOOKS_DIR, 'manifest.json');

type Category =
  | 'retail' | 'marketing' | 'psychology' | 'sales' | 'strategy'
  | 'finance' | 'culture' | 'optics' | 'other';

type ManifestEntry = {
  file: string; // base name, without extension
  title: string;
  author?: string;
  category: Category;
  language?: string;
};

function readManifest(): ManifestEntry[] {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`❌ manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as ManifestEntry[];
}

const STOPWORDS = new Set([
  'the','a','an','of','and','or','for','to','in','on','at','by','with','from','as','is',
  'how','why','what','when','where','who','which','that','this','these','those','its',
  'oceanofpdf','com','epub','pdf','book','edition','revised','updated','classic',
  'volume','vol','new','old','first','second','third',
  'into','about','without','against','between','through','around','over','under',
]);

function tokenize(s: string): Set<string> {
  const t = s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return new Set(t);
}

function listBookFiles(): Array<{ format: 'epub' | 'pdf'; fullPath: string; fileName: string; tokens: Set<string> }> {
  if (!fs.existsSync(BOOKS_DIR)) return [];
  const out: Array<{ format: 'epub' | 'pdf'; fullPath: string; fileName: string; tokens: Set<string> }> = [];
  for (const name of fs.readdirSync(BOOKS_DIR)) {
    const lower = name.toLowerCase();
    if (!lower.endsWith('.epub') && !lower.endsWith('.pdf')) continue;
    const fullPath = path.join(BOOKS_DIR, name);
    const format: 'epub' | 'pdf' = lower.endsWith('.epub') ? 'epub' : 'pdf';
    out.push({ format, fullPath, fileName: name, tokens: tokenize(name) });
  }
  return out;
}

const FILE_INDEX = listBookFiles();

/** Fuzzy-match a manifest entry to a file by token overlap (surname + title keywords). */
function resolveBookFile(entry: ManifestEntry): { format: 'epub' | 'pdf'; fullPath: string; fileName: string } | null {
  // (a) exact base-name match first (for clean manifest-controlled files)
  const clean = entry.file.replace(/\.(epub|pdf)$/i, '');
  const exactEpub = path.join(BOOKS_DIR, `${clean}.epub`);
  if (fs.existsSync(exactEpub)) return { format: 'epub', fullPath: exactEpub, fileName: `${clean}.epub` };
  const exactPdf = path.join(BOOKS_DIR, `${clean}.pdf`);
  if (fs.existsSync(exactPdf)) return { format: 'pdf', fullPath: exactPdf, fileName: `${clean}.pdf` };

  // (b) fuzzy match on (file-slug tokens, title tokens, author surnames)
  const slugTokens = tokenize(clean.replace(/^\d+_/, ''));
  const titleTokens = tokenize(entry.title);

  // Collect surnames from every co-author, not just the last one.
  const authors = (entry.author ?? '')
    .split(/[&,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const surnames = new Set<string>();
  for (const a of authors) {
    const parts = a.split(/\s+/).filter(Boolean);
    const last = parts[parts.length - 1];
    if (!last) continue;
    for (const t of tokenize(last)) surnames.add(t);
  }

  let best: { score: number; file: typeof FILE_INDEX[number] } | null = null;

  for (const f of FILE_INDEX) {
    let score = 0;
    for (const s of surnames) {
      if (f.tokens.has(s)) { score += 3; break; }
    }
    for (const t of titleTokens) if (f.tokens.has(t)) score += 1;
    for (const t of slugTokens) if (f.tokens.has(t)) score += 0.5;
    if (f.format === 'epub') score += 0.1;
    if (!best || score > best.score) best = { score, file: f };
  }

  if (!best || best.score < 2) return null;
  return { format: best.file.format, fullPath: best.file.fullPath, fileName: best.file.fileName };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<(br|p|div|h[1-6]|li|tr|td|section|article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&[a-z]+;/gi, ' ');
}

function extractTextFromEpubZip(filePath: string): { text: string; numChapters: number } {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries() as Array<{
    isDirectory: boolean;
    entryName: string;
    getData(): Buffer;
  }>;
  const htmls = entries
    .filter((e) => !e.isDirectory && /\.(xhtml|html|htm)$/i.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName));
  const chapters: string[] = [];
  for (const e of htmls) {
    try {
      const raw = e.getData().toString('utf-8');
      const text = stripHtml(raw).trim();
      if (text.length > 50) chapters.push(text);
    } catch { /* skip */ }
  }
  return { text: chapters.join('\n\n'), numChapters: chapters.length };
}

async function extractTextFromEpub(filePath: string): Promise<{ text: string; numChapters: number }> {
  // Primary: raw zip walk — works for any well-formed EPUB regardless of spine quirks
  try {
    const zipResult = extractTextFromEpubZip(filePath);
    if (zipResult.text.trim().length > 2000) return zipResult;
    console.warn('  ⚠ zip walk returned very little text, trying epub2 library');
  } catch (e) {
    console.warn(`  ⚠ zip walk failed (${(e as Error).message}), trying epub2 library`);
  }

  // Fallback: epub2 library (spine-aware but fragile)
  const { EPub } = loadEpubLib();
  const book = await EPub.createAsync(filePath) as unknown as {
    flow: Array<{ id: string }>;
    manifest?: Record<string, { id?: string; mediaType?: string; 'media-type'?: string }>;
    getChapterAsync(id: string): Promise<string>;
  };

  const chapters: string[] = [];
  const seen = new Set<string>();
  async function readById(id: string) {
    if (!id || seen.has(id)) return;
    seen.add(id);
    try {
      const raw = await book.getChapterAsync(id);
      if (raw) chapters.push(stripHtml(raw));
    } catch { /* skip */ }
  }
  for (const ch of book.flow) await readById(ch.id);
  if (book.manifest) {
    for (const [id, item] of Object.entries(book.manifest)) {
      const mt = (item?.mediaType ?? item?.['media-type'] ?? '').toString();
      if (mt.includes('xhtml') || mt.includes('html')) await readById(id);
    }
  }
  return { text: chapters.join('\n\n'), numChapters: chapters.length };
}

async function extractTextFromPdf(filePath: string): Promise<{ text: string; numpages: number }> {
  const buf = fs.readFileSync(filePath);
  // Primary: unpdf (Mozilla pdfjs under the hood, robust on modern PDFs)
  try {
    const r = await parsePdfWithUnpdf(buf);
    if (r.text && r.text.trim().length > 200) return r;
    console.warn('  ⚠ unpdf returned very little text, trying pdf-parse fallback');
  } catch (e) {
    console.warn(`  ⚠ unpdf failed (${(e as Error).message}), trying pdf-parse fallback`);
  }
  // Fallback: pdf-parse (older but handles some edge cases)
  const parsed = await loadPdfParseFallback()(buf);
  return { text: parsed.text, numpages: parsed.numpages };
}

function chunkText(text: string, targetWords = 700, overlapWords = 100): string[] {
  const cleaned = text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  const words = cleaned.split(/\s+/);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    const end = Math.min(i + targetWords, words.length);
    const slice = words.slice(i, end).join(' ');
    if (slice.trim().length >= 100) chunks.push(slice);
    if (end >= words.length) break;
    i = end - overlapWords;
    if (i < 0) i = 0;
  }
  return chunks;
}

async function embedBatch(inputs: string[]): Promise<number[][]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VOYAGE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: inputs, model: 'voyage-3', input_type: 'document' }),
  });
  if (!res.ok) throw new Error(`voyage ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => d.embedding);
}

async function indexOne(entry: ManifestEntry, force = false): Promise<'ok' | 'skipped' | 'missing'> {
  const resolved = resolveBookFile(entry);
  if (!resolved) {
    console.error(`  ⚠ file not found for ${entry.file} — skipping`);
    return 'missing';
  }

  const fileName = resolved.fileName;
  console.log(`  format: ${resolved.format.toUpperCase()}  file: ${fileName}`);

  const { data: existing } = await supabase
    .from('ai_knowledge_books')
    .select('id, status, file_name')
    .eq('file_name', fileName)
    .maybeSingle();

  if (existing && existing.status === 'indexed' && !force) {
    console.log(`  ✓ already indexed — skipping`);
    return 'skipped';
  }

  let bookId: string;
  if (existing) {
    bookId = existing.id;
    await supabase.from('ai_knowledge_books').update({
      title: entry.title,
      author: entry.author ?? null,
      category: entry.category,
      language: entry.language ?? 'en',
      file_name: fileName,
      status: 'indexing',
      updated_at: new Date().toISOString(),
    }).eq('id', bookId);
    await supabase.from('ai_knowledge_chunks').delete().eq('book_id', bookId);
  } else {
    const { data: created, error: cErr } = await supabase.from('ai_knowledge_books')
      .insert({
        title: entry.title,
        author: entry.author ?? null,
        category: entry.category,
        language: entry.language ?? 'en',
        file_name: fileName,
        status: 'indexing',
      })
      .select('id').single();
    if (cErr || !created) throw new Error(`insert book: ${cErr?.message}`);
    bookId = created.id as string;
  }

  let text = '';
  let pagesOrChapters = 0;
  if (resolved.format === 'epub') {
    const r = await extractTextFromEpub(resolved.fullPath);
    text = r.text;
    pagesOrChapters = r.numChapters;
  } else {
    const r = await extractTextFromPdf(resolved.fullPath);
    text = r.text;
    pagesOrChapters = r.numpages;
  }

  const chunks = chunkText(text);
  console.log(`  ⇢ ${chunks.length} chunks (${pagesOrChapters} ${resolved.format === 'epub' ? 'chapters' : 'pages'})`);

  const BATCH = 96;
  let embedded = 0;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
    const embs = await embedBatch(slice);
    const rows = slice.map((content, j) => ({
      book_id: bookId,
      chunk_index: i + j,
      content,
      token_count: Math.round(content.split(/\s+/).length * 1.33),
      embedding: embs[j] as unknown as string,
    }));
    const { error: insErr } = await supabase.from('ai_knowledge_chunks').insert(rows);
    if (insErr) throw new Error(`insert chunks: ${insErr.message}`);
    embedded += slice.length;
    process.stdout.write(`    embedded ${embedded}/${chunks.length}\r`);
  }
  process.stdout.write('\n');

  await supabase.from('ai_knowledge_books').update({
    status: 'indexed',
    pages_count: pagesOrChapters,
    chunks_count: chunks.length,
    indexed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', bookId);

  console.log(`  ✓ done`);
  return 'ok';
}

async function main() {
  const args = process.argv.slice(2);
  const forceIdx = args.indexOf('--force');
  const forceFile = forceIdx >= 0 ? args[forceIdx + 1] : null;

  const manifest = readManifest();
  console.log(`📚 ${manifest.length} books in manifest\n`);

  const summary = { ok: 0, skipped: 0, missing: 0, failed: 0 };

  for (let i = 0; i < manifest.length; i++) {
    const entry = manifest[i];
    console.log(`[${i + 1}/${manifest.length}] ${entry.title} — ${entry.author ?? '?'}`);
    try {
      const r = await indexOne(entry, forceFile != null && entry.file === forceFile);
      summary[r]++;
    } catch (e) {
      console.error(`  ✗ failed: ${(e as Error).message}`);
      summary.failed++;
      const resolved = resolveBookFile(entry);
      if (resolved) {
        await supabase.from('ai_knowledge_books').update({
          status: 'failed',
          updated_at: new Date().toISOString(),
        }).eq('file_name', resolved.fileName);
      }
    }
  }

  console.log(`\n✅ pass complete: ${summary.ok} indexed, ${summary.skipped} skipped, ${summary.missing} missing files, ${summary.failed} failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
