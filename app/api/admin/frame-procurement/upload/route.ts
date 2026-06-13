/**
 * POST /api/admin/frame-procurement/upload
 *
 * Принимает multipart/form-data с одним или несколькими файлами image/* (PNG/JPEG).
 * Для каждого файла:
 *   1) считает SHA-256 — это image_hash
 *   2) если такой hash уже есть в frame_supplier_catalog → возвращает существующую запись
 *      (дедупликация — повторно не платим за распознавание)
 *   3) иначе: загружает в Storage bucket 'frame-supplier-catalog' и создаёт строку в БД
 *
 * Авторизация: только app_metadata.role === 'owner'.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { smartCrop } from '@/lib/frameAutoCrop';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'frame-supplier-catalog';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 МБ

// Anti-abuse quotas (минимальная защита от заполнения bucket'а):
//   - per-owner rate limit: не больше RATE_LIMIT_MAX файлов за RATE_LIMIT_WINDOW_MS;
//   - aggregate bucket high-water mark: суммарный размер объектов в bucket
//     не должен превышать BUCKET_HIGH_WATER_BYTES.
// Проверки дешёвые и работают в едином Node-инстансе; для multi-instance
// окружения стоит вынести во внешнее хранилище (KV/Postgres), но базовую
// защиту это уже даёт.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 час
const RATE_LIMIT_MAX = 200; // файлов на owner'а в окно
const BUCKET_HIGH_WATER_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB
const BUCKET_SIZE_CACHE_TTL_MS = 60 * 1000; // 1 минута

const rateLimitBuckets = new Map<string, number[]>();
let bucketSizeCache: { bytes: number; at: number } | null = null;

function consumeRateLimit(ownerId: string, count: number): boolean {
  const now = Date.now();
  const arr = rateLimitBuckets.get(ownerId) ?? [];
  // Чистим старые отметки за пределами окна.
  const fresh = arr.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (fresh.length + count > RATE_LIMIT_MAX) {
    rateLimitBuckets.set(ownerId, fresh);
    return false;
  }
  for (let i = 0; i < count; i++) fresh.push(now);
  rateLimitBuckets.set(ownerId, fresh);
  return true;
}

async function getBucketSizeBytes(admin: ReturnType<typeof getSupabaseAdmin>): Promise<number> {
  const now = Date.now();
  if (bucketSizeCache && now - bucketSizeCache.at < BUCKET_SIZE_CACHE_TTL_MS) {
    return bucketSizeCache.bytes;
  }
  // Объекты лежат в подпапках вида "ab/<hash>.png" — двухсимвольный префикс.
  // Перебираем все 256 hex-префиксов (00..ff) с пагинацией.
  // Если bucket огромный — кэш на 60s страхует от лишних запросов.
  let total = 0;
  const hex = '0123456789abcdef';
  for (const a of hex) {
    for (const b of hex) {
      const prefix = `${a}${b}`;
      let offset = 0;
      const pageSize = 1000;
      // Пагинируем внутри префикса.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await admin.storage.from(BUCKET).list(prefix, {
          limit: pageSize,
          offset,
        });
        if (error || !data) break;
        for (const obj of data) {
          const size = (obj as any)?.metadata?.size;
          if (typeof size === 'number') total += size;
        }
        if (data.length < pageSize) break;
        offset += pageSize;
      }
    }
  }
  bucketSizeCache = { bytes: total, at: now };
  return total;
}

type UploadResult = {
  ok: true;
  catalogId: string;
  imageHash: string;
  storagePath: string;
  isDuplicate: boolean;
  width: number;
  height: number;
};

type UploadError = { ok: false; error: string };

async function checkOwner(): Promise<{ ok: boolean; error?: string; userId?: string }> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return { ok: false, error: 'Не авторизован' };
  const role = (data.user.app_metadata as Record<string, unknown> | undefined)?.role;
  if (role !== 'owner') return { ok: false, error: 'Доступ только для owner' };
  return { ok: true, userId: data.user.id };
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await checkOwner();
  if (!auth.ok || !auth.userId) return NextResponse.json({ error: auth.error }, { status: 403 });
  const ownerId = auth.userId;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e) {
    return NextResponse.json({ error: 'Ожидается multipart/form-data' }, { status: 400 });
  }

  const files: File[] = [];
  for (const [, value] of formData.entries()) {
    if (value instanceof File && value.size > 0) {
      files.push(value);
    }
  }

  if (files.length === 0) {
    return NextResponse.json({ error: 'Файлы не найдены' }, { status: 400 });
  }

  // Per-owner rate limit: атомарно «бронируем» слот под все файлы запроса.
  if (!consumeRateLimit(ownerId, files.length)) {
    return NextResponse.json(
      {
        error: `Превышен лимит загрузок: не более ${RATE_LIMIT_MAX} файлов в час на пользователя`,
      },
      { status: 429 },
    );
  }

  const admin = getSupabaseAdmin();

  // Aggregate bucket high-water mark: если bucket уже забит — отказываем
  // до удаления старых объектов / повышения лимита.
  try {
    const used = await getBucketSizeBytes(admin);
    if (used >= BUCKET_HIGH_WATER_BYTES) {
      return NextResponse.json(
        {
          error: `Хранилище переполнено (использовано ${Math.round(
            used / (1024 * 1024),
          )} МиБ, лимит ${Math.round(
            BUCKET_HIGH_WATER_BYTES / (1024 * 1024),
          )} МиБ). Загрузка временно недоступна.`,
        },
        { status: 507 },
      );
    }
  } catch {
    // Если не удалось посчитать — не блокируем, чтобы не сломать рабочий процесс.
  }

  const results: (UploadResult | UploadError)[] = [];

  for (const file of files) {
    try {
      if (file.size > MAX_FILE_SIZE) {
        results.push({ ok: false, error: `Файл ${file.name} больше 10 МБ` });
        continue;
      }
      if (!file.type.startsWith('image/')) {
        results.push({ ok: false, error: `Файл ${file.name} не изображение (${file.type})` });
        continue;
      }

      const arrayBuf = await file.arrayBuffer();
      const rawBuf = Buffer.from(arrayBuf);

      // Авто-кроп: убираем тёмную WeChat-рамку, миниатюры, заголовок и т.п.
      // Если фото уже без рамки — smartCrop вернёт оригинал.
      const crop = await smartCrop(rawBuf);
      const buf = crop.buffer;
      const width = crop.width;
      const height = crop.height;

      if (width <= 0 || height <= 0) {
        results.push({ ok: false, error: `Не удалось прочитать ${file.name}` });
        continue;
      }

      // SHA-256 по обрезанному PNG (после crop), не по исходному.
      // Это даёт корректную дедупликацию для случаев "тот же скрин, но
      // в другом окне WeChat" — после кропа байты одинаковые.
      const pngBuf = await sharp(buf).png().toBuffer();
      const imageHash = crypto.createHash('sha256').update(pngBuf).digest('hex');

      // Дедупликация
      const { data: existing } = await admin
        .from('frame_supplier_catalog')
        .select('id, storage_path, width_px, height_px')
        .eq('image_hash', imageHash)
        .maybeSingle();

      if (existing) {
        results.push({
          ok: true,
          catalogId: existing.id,
          imageHash,
          storagePath: existing.storage_path,
          isDuplicate: true,
          width: existing.width_px,
          height: existing.height_px,
        });
        continue;
      }

      const storagePath = `${imageHash.slice(0, 2)}/${imageHash}.png`;

      const { error: upErr } = await admin.storage
        .from(BUCKET)
        .upload(storagePath, pngBuf, {
          contentType: 'image/png',
          upsert: true,
        });

      if (upErr) {
        results.push({ ok: false, error: `Upload: ${upErr.message}` });
        continue;
      }

      // Атомарный INSERT с защитой от TOCTOU: при конкурентной загрузке того же
      // image_hash unique-constraint предотвратит дубликат. upsert+ignoreDuplicates
      // делает INSERT идемпотентным — на конфликте просто ничего не вставляется,
      // и select вернёт пустой массив. Тогда дочитываем существующую запись.
      const { data: insertedRows, error: insErr } = await admin
        .from('frame_supplier_catalog')
        .upsert(
          {
            image_hash: imageHash,
            storage_path: storagePath,
            width_px: width,
            height_px: height,
          },
          { onConflict: 'image_hash', ignoreDuplicates: true },
        )
        .select('id');

      if (insErr) {
        // Откат загрузки в Storage только при реальной ошибке БД.
        // На конфликте сюда не попадаем (ignoreDuplicates не возвращает ошибку).
        await admin.storage.from(BUCKET).remove([storagePath]).catch(() => {});
        results.push({ ok: false, error: insErr.message || 'Ошибка БД' });
        continue;
      }

      const inserted = insertedRows && insertedRows.length > 0 ? insertedRows[0] : null;

      if (!inserted) {
        // Конфликт по image_hash — параллельный запрос уже создал запись.
        // Storage не удаляем: storage_path детерминирован от hash, объект
        // тот же самый (upsert: true), его использует существующая строка.
        const { data: existingAfter, error: exErr } = await admin
          .from('frame_supplier_catalog')
          .select('id, storage_path, width_px, height_px')
          .eq('image_hash', imageHash)
          .maybeSingle();

        if (exErr || !existingAfter) {
          results.push({ ok: false, error: exErr?.message || 'Ошибка БД (конфликт)' });
          continue;
        }

        results.push({
          ok: true,
          catalogId: existingAfter.id,
          imageHash,
          storagePath: existingAfter.storage_path,
          isDuplicate: true,
          width: existingAfter.width_px,
          height: existingAfter.height_px,
        });
        continue;
      }

      results.push({
        ok: true,
        catalogId: inserted.id,
        imageHash,
        storagePath,
        isDuplicate: false,
        width,
        height,
      });
    } catch (e: any) {
      results.push({ ok: false, error: e?.message || String(e) });
    }
  }

  const summary = {
    total: files.length,
    ok: results.filter((r) => r.ok).length,
    duplicates: results.filter((r) => r.ok && (r as UploadResult).isDuplicate).length,
    errors: results.filter((r) => !r.ok).length,
  };

  return NextResponse.json({ results, summary });
}
