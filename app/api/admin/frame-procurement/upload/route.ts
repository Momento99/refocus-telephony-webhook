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

async function checkOwner(): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return { ok: false, error: 'Не авторизован' };
  const role = (data.user.app_metadata as Record<string, unknown> | undefined)?.role;
  if (role !== 'owner') return { ok: false, error: 'Доступ только для owner' };
  return { ok: true };
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await checkOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 403 });

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

  const admin = getSupabaseAdmin();
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

      const { data: inserted, error: insErr } = await admin
        .from('frame_supplier_catalog')
        .insert({
          image_hash: imageHash,
          storage_path: storagePath,
          width_px: width,
          height_px: height,
        })
        .select('id')
        .single();

      if (insErr || !inserted) {
        // Откат загрузки в Storage
        await admin.storage.from(BUCKET).remove([storagePath]).catch(() => {});
        results.push({ ok: false, error: insErr?.message || 'Ошибка БД' });
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
