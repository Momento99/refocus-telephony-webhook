/**
 * POST /api/admin/frame-procurement/recognize
 *
 * Тело запроса:
 *   { catalogIds: string[], engine: 'opus-4.7' | 'gpt-5' }
 *
 * Для каждого catalogId:
 *   1) если запись уже распознана через тот же движок и не требует review — пропускает
 *   2) иначе: загружает фото из Storage, шлёт в LLM, парсит ответ, пишет в БД
 *
 * Возвращает массив результатов с прогрессом.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { recognize } from '@/lib/frameVision';
import { smartCrop } from '@/lib/frameAutoCrop';
import type { RecognitionEngine } from '@/lib/frameProcurementTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // секунд — батч 116 фото может занять до 5 минут

const BUCKET = 'frame-supplier-catalog';
const VALID_ENGINES = new Set<RecognitionEngine>(['opus-4.7', 'gpt-5']);

async function checkOwner(): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return { ok: false, error: 'Не авторизован' };
  const role = (data.user.app_metadata as Record<string, unknown> | undefined)?.role;
  if (role !== 'owner') return { ok: false, error: 'Доступ только для owner' };
  return { ok: true };
}

type Body = {
  catalogIds?: unknown;
  engine?: unknown;
  /** Если true — переразпознаём, даже если уже было */
  forceRerun?: unknown;
};

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await checkOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 403 });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ожидается JSON' }, { status: 400 });
  }

  const catalogIds = Array.isArray(body.catalogIds)
    ? body.catalogIds.filter((x): x is string => typeof x === 'string')
    : [];
  if (catalogIds.length === 0) {
    return NextResponse.json({ error: 'catalogIds пуст' }, { status: 400 });
  }

  const engine = body.engine as RecognitionEngine;
  if (!VALID_ENGINES.has(engine)) {
    return NextResponse.json({ error: `Неизвестный engine: ${body.engine}` }, { status: 400 });
  }
  const forceRerun = Boolean(body.forceRerun);

  const admin = getSupabaseAdmin();

  // Загружаем строки каталога
  const { data: rows, error: selErr } = await admin
    .from('frame_supplier_catalog')
    .select(
      'id, storage_path, recognized_by, recognized_at, needs_review, manually_corrected',
    )
    .in('id', catalogIds);

  if (selErr) {
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }

  type Result =
    | { id: string; ok: true; skipped: false; engine: RecognitionEngine; supplierModel: string | null }
    | { id: string; ok: true; skipped: true; reason: string }
    | { id: string; ok: false; error: string };

  // Параллельная обработка с лимитом 3 одновременных запросов к LLM —
  // достаточно для ускорения в 3 раза, не упираемся в rate limit.
  const CONCURRENCY = 3;
  const queue = [...(rows || [])];
  const results: Result[] = [];

  async function processOne(row: typeof queue[number]): Promise<Result> {
    try {
      if (
        !forceRerun &&
        row.recognized_by === engine &&
        !row.needs_review &&
        !row.manually_corrected
      ) {
        return { id: row.id, ok: true, skipped: true, reason: `Уже распознано через ${engine}` };
      }
      if (row.manually_corrected && !forceRerun) {
        return { id: row.id, ok: true, skipped: true, reason: 'Поправлено вручную' };
      }

      const { data: blob, error: dlErr } = await admin.storage
        .from(BUCKET)
        .download(row.storage_path);
      if (dlErr || !blob) {
        return { id: row.id, ok: false, error: dlErr?.message || 'Не скачалось фото' };
      }

      let buf: Buffer = Buffer.from(await blob.arrayBuffer());

      // Авто-кроп: если фото имеет тёмную WeChat-рамку, обрежем и
      // перезапишем в Storage. Идемпотентно — повторный кроп не вредит.
      // Это нужно для уплоадов от watcher'а, которые идут мимо /upload.
      const crop = await smartCrop(buf);
      if (crop.cropped) {
        buf = Buffer.from(crop.buffer);
        // Перезаписываем в Storage по тому же пути
        const { error: upErr } = await admin.storage
          .from(BUCKET)
          .upload(row.storage_path, buf, {
            contentType: 'image/png',
            upsert: true,
          });
        if (upErr) {
          // не критично — продолжим с локальным буфером
          console.warn('re-upload after crop failed:', upErr.message);
        }
        // Обновим размеры в БД, чтобы UI и аннотация знали актуальные
        await admin
          .from('frame_supplier_catalog')
          .update({ width_px: crop.width, height_px: crop.height })
          .eq('id', row.id);
      }

      const base64 = buf.toString('base64');

      const recognition = await recognize(base64, 'image/png', engine);

      const { error: updErr } = await admin
        .from('frame_supplier_catalog')
        .update({
          recognized_by: engine,
          recognized_at: new Date().toISOString(),
          confidence: recognition.confidence,
          raw_response: recognition,
          supplier_model: recognition.supplier_model,
          type_code: recognition.type_code,
          gender: recognition.gender,
          colors: recognition.colors,
          needs_review: recognition.needs_review,
          notes: recognition.notes,
          manually_corrected: false,
        })
        .eq('id', row.id);

      if (updErr) {
        return { id: row.id, ok: false, error: updErr.message };
      }

      return {
        id: row.id,
        ok: true,
        skipped: false,
        engine,
        supplierModel: recognition.supplier_model,
      };
    } catch (e: any) {
      return { id: row.id, ok: false, error: e?.message || String(e) };
    }
  }

  // Запускаем CONCURRENCY воркеров, которые тащат задачи из очереди
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const row = queue.shift();
      if (!row) break;
      const r = await processOne(row);
      results.push(r);
    }
  });
  await Promise.all(workers);

  const summary = {
    total: rows?.length ?? 0,
    recognized: results.filter((r) => r.ok && !('skipped' in r && r.skipped)).length,
    skipped: results.filter((r) => r.ok && 'skipped' in r && r.skipped).length,
    errors: results.filter((r) => !r.ok).length,
  };

  return NextResponse.json({ results, summary });
}
