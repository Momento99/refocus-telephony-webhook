import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getUserRole } from '@/lib/getUserRole';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Синхронизация загрузок приложения из App Store Connect и Google Play
 * в таблицу public.mobile_store_daily.
 *
 * Вызывается:
 *  - pg_cron (Bearer CRON_SECRET) — раз в сутки;
 *  - вручную из /admin/mobile-app (по админ-сессии owner/manager).
 *
 * ENV:
 *  Apple:  ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY (.p8 PEM), ASC_VENDOR_NUMBER
 *  Google: GOOGLE_PLAY_SA_JSON (service-account JSON или base64),
 *          GOOGLE_PLAY_BUCKET (pubsite_prod_xxx), GOOGLE_PLAY_PACKAGE (def. kg.refocus.app)
 */

const PACKAGE_DEFAULT = 'kg.refocus.app';

// ───────────────────────────────────────────────────────────── auth
async function authorize(req: NextRequest): Promise<boolean> {
  const hdr = (req.headers.get('authorization') ?? '').toLowerCase();
  // как во franchise/whatsapp-роутах: принимаем оба секрета
  const secrets = [process.env.CRON_SECRET, process.env.WHATSAPP_CRON_SECRET].filter(
    Boolean
  ) as string[];
  if (secrets.some((s) => hdr === `bearer ${s}`.toLowerCase())) return true;
  // ручной запуск из админки
  try {
    const role = await getUserRole();
    return role === 'owner' || role === 'manager';
  } catch {
    return false;
  }
}

// ───────────────────────────────────────────────────────────── helpers
function toB64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type StoreRow = {
  date: string;
  platform: 'ios' | 'android';
  country_code: string;
  downloads: number;
  redownloads: number;
};

async function upsertRows(rows: StoreRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const sb = getSupabaseAdmin();
  const payload = rows.map((r) => ({ ...r, updated_at: new Date().toISOString() }));
  const { error } = await sb
    .from('mobile_store_daily')
    .upsert(payload, { onConflict: 'date,platform,country_code' });
  if (error) throw error;
  return rows.length;
}

// ─────────────────────────────────────────────────────────── App Store
function appleJwt(): string {
  const issuer = process.env.ASC_ISSUER_ID!;
  const keyId = process.env.ASC_KEY_ID!;
  const pem = (process.env.ASC_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const header = toB64Url(Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' })));
  const payload = toB64Url(
    Buffer.from(
      JSON.stringify({ iss: issuer, iat: now, exp: now + 1000, aud: 'appstoreconnect-v1' })
    )
  );
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: crypto.createPrivateKey(pem),
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${toB64Url(signature)}`;
}

// Классификация Product Type Identifier из SALES SUMMARY → тип события.
// "App Units" (первые загрузки) = семейство '1'/'F'; обновления ('3'/'7') и
// in-app ('IA') игнорируем. Может потребовать тюнинга на реальных данных.
function classifyApple(productType: string): 'download' | 'ignore' {
  const t = (productType ?? '').toUpperCase();
  if (t.startsWith('IA')) return 'ignore';
  if (t.startsWith('3') || t.startsWith('7')) return 'ignore';
  if (t.startsWith('1') || t.startsWith('F')) return 'download';
  return 'ignore';
}

async function syncApple(days: number): Promise<{ status: string; rows: number; detail?: string }> {
  if (
    !process.env.ASC_ISSUER_ID ||
    !process.env.ASC_KEY_ID ||
    !process.env.ASC_PRIVATE_KEY ||
    !process.env.ASC_VENDOR_NUMBER
  ) {
    return { status: 'not_configured', rows: 0 };
  }

  try {
    const jwt = appleJwt();
    const vendor = process.env.ASC_VENDOR_NUMBER!;
    const all: StoreRow[] = [];

    for (let i = 1; i <= days; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const reportDate = ymd(d);

      const url =
        'https://api.appstoreconnect.apple.com/v1/salesReports?' +
        new URLSearchParams({
          'filter[frequency]': 'DAILY',
          'filter[reportType]': 'SALES',
          'filter[reportSubType]': 'SUMMARY',
          'filter[vendorNumber]': vendor,
          'filter[reportDate]': reportDate,
        }).toString();

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/a-gzip' },
      });

      // 404 = за этот день отчёта ещё нет / не было активности — пропускаем
      if (res.status === 404) continue;
      if (!res.ok) {
        return { status: 'error', rows: all.length, detail: `Apple ${res.status} ${reportDate}` };
      }

      const gz = Buffer.from(await res.arrayBuffer());
      const tsv = zlib.gunzipSync(gz).toString('utf8');
      const lines = tsv.split('\n').filter(Boolean);
      if (lines.length < 2) continue;

      const header = lines[0].split('\t').map((h) => h.trim());
      const idxCountry = header.indexOf('Country Code');
      const idxUnits = header.indexOf('Units');
      const idxType = header.indexOf('Product Type Identifier');
      const idxBegin = header.indexOf('Begin Date');
      if (idxUnits < 0 || idxCountry < 0 || idxType < 0) continue;

      const perCountry = new Map<string, number>();
      for (let r = 1; r < lines.length; r++) {
        const cols = lines[r].split('\t');
        if (classifyApple(cols[idxType]) !== 'download') continue;
        const cc = (cols[idxCountry] ?? 'ZZ').trim().toUpperCase() || 'ZZ';
        const units = parseInt(cols[idxUnits], 10) || 0;
        perCountry.set(cc, (perCountry.get(cc) ?? 0) + units);
      }

      // дата отчёта = Begin Date из файла (формат MM/DD/YYYY), иначе reportDate
      let day = reportDate;
      if (idxBegin >= 0 && lines[1]) {
        const bd = lines[1].split('\t')[idxBegin]?.trim();
        const m = bd?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) day = `${m[3]}-${m[1]}-${m[2]}`;
      }

      for (const [cc, downloads] of perCountry) {
        all.push({ date: day, platform: 'ios', country_code: cc, downloads, redownloads: 0 });
      }
    }

    const n = await upsertRows(all);
    return { status: 'ok', rows: n };
  } catch (e: any) {
    return { status: 'error', rows: 0, detail: e?.message };
  }
}

// ─────────────────────────────────────────────────────────── Google Play
function parseSaJson(): { client_email: string; private_key: string } | null {
  const raw = process.env.GOOGLE_PLAY_SA_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }
}

async function googleAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = toB64Url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = toB64Url(
    Buffer.from(
      JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/devstorage.read_only',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      })
    )
  );
  const signingInput = `${header}.${claim}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), {
    key: sa.private_key.replace(/\\n/g, '\n'),
  });
  const assertion = `${signingInput}.${toB64Url(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.access_token as string;
}

// Минимальный CSV-парсер (учитывает кавычки)
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c === '\r') { /* skip */ }
      else cell += c;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function fetchGcsCsv(bucket: string, objectPath: string, token: string): Promise<string | null> {
  const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(
    objectPath
  )}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GCS ${res.status} ${objectPath}`);
  // Google Play отчёты в кодировке UTF-16LE
  const buf = Buffer.from(await res.arrayBuffer());
  return new TextDecoder('utf-16le').decode(buf).replace(/^﻿/, '');
}

async function syncGoogle(): Promise<{ status: string; rows: number; detail?: string }> {
  const sa = parseSaJson();
  const bucketRaw = process.env.GOOGLE_PLAY_BUCKET;
  if (!sa || !bucketRaw) return { status: 'not_configured', rows: 0 };

  try {
    const bucket = bucketRaw.replace(/^gs:\/\//, '').replace(/\/.*$/, '');
    const pkg = process.env.GOOGLE_PLAY_PACKAGE || PACKAGE_DEFAULT;
    const token = await googleAccessToken(sa);

    // текущий и прошлый месяц (чтобы покрыть стык месяцев)
    const now = new Date();
    const months = [
      `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
      (() => {
        const p = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        return `${p.getUTCFullYear()}${String(p.getUTCMonth() + 1).padStart(2, '0')}`;
      })(),
    ];

    const all: StoreRow[] = [];
    for (const ym of months) {
      const objectPath = `stats/installs/installs_${pkg}_${ym}_country.csv`;
      const csv = await fetchGcsCsv(bucket, objectPath, token);
      if (!csv) continue;

      const rows = parseCsv(csv);
      if (rows.length < 2) continue;
      const header = rows[0].map((h) => h.trim());
      const idxDate = header.indexOf('Date');
      const idxCountry = header.indexOf('Country');
      // первые установки на устройство за день
      const idxInstalls =
        header.indexOf('Daily Device Installs') >= 0
          ? header.indexOf('Daily Device Installs')
          : header.indexOf('Daily User Installs');
      if (idxDate < 0 || idxCountry < 0 || idxInstalls < 0) continue;

      for (let r = 1; r < rows.length; r++) {
        const cols = rows[r];
        if (!cols[idxDate]) continue;
        const date = cols[idxDate].trim(); // YYYY-MM-DD
        const cc = (cols[idxCountry] ?? 'ZZ').trim().toUpperCase() || 'ZZ';
        const installs = parseInt(cols[idxInstalls], 10) || 0;
        if (installs <= 0) continue;
        all.push({ date, platform: 'android', country_code: cc, downloads: installs, redownloads: 0 });
      }
    }

    const n = await upsertRows(all);
    return { status: 'ok', rows: n };
  } catch (e: any) {
    return { status: 'error', rows: 0, detail: e?.message };
  }
}

// ───────────────────────────────────────────────────────────── handler
export async function POST(req: NextRequest) {
  if (!(await authorize(req))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let days = 5;
  try {
    const body = await req.json().catch(() => ({}));
    if (Number.isFinite(body?.days)) days = Math.min(60, Math.max(1, Number(body.days)));
  } catch {
    /* пустое тело — ок */
  }

  const [apple, google] = await Promise.all([syncApple(days), syncGoogle()]);

  const ok = apple.status !== 'error' && google.status !== 'error';
  return NextResponse.json(
    { ok, apple, google, syncedAt: new Date().toISOString() },
    { status: ok ? 200 : 207 }
  );
}
