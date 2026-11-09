/**
 * POST /api/admin/frame-procurement/recognize
 *
 * Тело запроса:
 *   { catalogIds: string[], engine: 'gpt-6.1-sol' }
 *
 * Для каждого catalogId:
 *   1) если запись уже распознана или исправлена вручную — пропускает без forceRerun
 *   2) иначе: загружает фото из Storage, шлёт в LLM, парсит ответ, пишет в БД
 *
 * Возвращает массив результатов с прогрессом.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { recognizeFrameColors } from '@/lib/frameColorVision';
import {
  isRecognitionEngine,
  type RecognitionEngine,
} from '@/lib/frameProcurementTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // секунд — до 50 фото за один серверный запрос

const BUCKET = 'frame-supplier-catalog';
const MAX_BATCH = 50;
const FORCE_RERUN_CONFIRM_THRESHOLD = 10;

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
  /** Обязательное подтверждение при forceRerun на пачке > FORCE_RERUN_CONFIRM_THRESHOLD */
  confirmForceRerun?: unknown;
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
  if (catalogIds.length > MAX_BATCH) {
    return NextResponse.json(
      {
        error: `Слишком большая пачка: ${catalogIds.length}. Максимум за один запрос — ${MAX_BATCH}.`,
      },
      { status: 400 },
    );
  }

  if (!isRecognitionEngine(body.engine)) {
    return NextResponse.json(
      { error: `Неизвестная модель распознавания: ${String(body.engine ?? '')}` },
      { status: 400 },
    );
  }
  const engine: RecognitionEngine = body.engine;
  const forceRerun = body.forceRerun === true;
  const confirmForceRerun = body.confirmForceRerun === true;
  if (
    forceRerun &&
    catalogIds.length > FORCE_RERUN_CONFIRM_THRESHOLD &&
    !confirmForceRerun
  ) {
    return NextResponse.json(
      {
        error: `forceRerun на ${catalogIds.length} элементов требует confirmForceRerun=true (порог: ${FORCE_RERUN_CONFIRM_THRESHOLD}).`,
      },
      { status: 400 },
    );
  }

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
    | { id: string; ok: true; skipped: false; engine: RecognitionEngine; supplierModel: string | null; recognition: Awaited<ReturnType<typeof recognizeFrameColors>> }
    | { id: string; ok: true; skipped: true; reason: string }
    | { id: string; ok: false; error: string };

  // Параллельная обработка с лимитом 3 одновременных запросов к LLM —
  // достаточно для ускорения в 3 раза, не упираемся в rate limit.
  const CONCURRENCY = 3;
  const queue = [...(rows || [])];
  const results: Result[] = [];

  async function processOne(row: typeof queue[number]): Promise<Result> {
    try {
      if (row.manually_corrected && !forceRerun) {
        return { id: row.id, ok: true, skipped: true, reason: 'Поправлено вручную' };
      }
      // Existing recognition is rerun only after an explicit request.
      if (!forceRerun && row.recognized_by) {
        return {
          id: row.id,
          ok: true,
          skipped: true,
          reason: `Уже распознано через ${row.recognized_by}`,
        };
      }

      const { data: blob, error: dlErr } = await admin.storage
        .from(BUCKET)
        .download(row.storage_path);
      if (dlErr || !blob) {
        return { id: row.id, ok: false, error: dlErr?.message || 'Не скачалось фото' };
      }

      const buf: Buffer = Buffer.from(await blob.arrayBuffer());

      // Preserve original bytes and coordinate system, including watcher screenshots.
      const recognition = await recognizeFrameColors(buf.toString('base64'), blob.type || 'image/png');

      const { error: updErr } = await admin
        .from('frame_supplier_catalog')
        .update({
          recognized_by: engine,
          recognized_at: new Date().toISOString(),
          confidence: recognition.confidence,
          raw_response: recognition,
          supplier_model: recognition.supplier_model,
          colors: recognition.colors,
          needs_review: recognition.needs_review,
          notes: recognition.notes,
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
        recognition,
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

  return NextResponse.json({ engine, results, summary });
}
