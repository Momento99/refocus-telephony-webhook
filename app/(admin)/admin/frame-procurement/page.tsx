'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Glasses,
  Upload,
  Sparkles,
  Brain,
  RefreshCw,
  Trash2,
  Download,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ClipboardPaste,
  FilePlus2,
  X,
  Wand2,
  PackageCheck,
  Settings2,
} from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import type {
  CatalogColor,
  RecognitionEngine,
  CatalogGender,
  SectionKey,
  OrderPlan,
} from '@/lib/frameProcurementTypes';
import type { FrameTypeCode } from '@/lib/framePricingFormula';

/* ────────── Типы ────────── */

type CatalogItem = {
  id: string;
  image_hash: string;
  storage_path: string;
  width_px: number;
  height_px: number;
  recognized_by: RecognitionEngine | null;
  recognized_at: string | null;
  confidence: number | null;
  supplier_model: string | null;
  type_code: FrameTypeCode | null;
  gender: CatalogGender | null;
  colors: CatalogColor[];
  needs_review: boolean;
  manually_corrected: boolean;
  notes: string | null;
  created_at: string;
  signed_url: string | null;
};

type Branch = { id: number; name: string };

type OrderRow = {
  id: string;
  branch_id: number | null;
  status: 'draft' | 'sent' | 'received' | 'cancelled';
  cold_start: boolean;
  total_qty: number;
  recognized_by: string | null;
  qty_by_section: Record<string, number>;
  created_at: string;
  sent_at: string | null;
};

const TYPE_LABEL: Record<FrameTypeCode, string> = {
  PA: 'Пластик взр.',
  MA: 'Металл взр.',
  RP: 'Чтение пласт.',
  RM: 'Чтение мет.',
  KD: 'Детские',
  RL: 'Безоправные',
};

const GENDER_LABEL: Record<CatalogGender, string> = {
  F: 'Ж',
  M: 'М',
  U: 'У',
};

const SECTION_ORDER: SectionKey[] = [
  'PA_F', 'PA_M', 'MA_F', 'MA_M',
  'RP_F', 'RM_F', 'KD_F', 'KD_M',
  'RL_F', 'RL_M',
];

const SECTION_LABEL: Record<SectionKey, string> = {
  PA_F: 'Пластик взр. · Ж',
  PA_M: 'Пластик взр. · М',
  MA_F: 'Металл взр. · Ж',
  MA_M: 'Металл взр. · М',
  RP_F: 'Чтение пласт. · Ж',
  RM_F: 'Чтение мет. · Ж',
  KD_F: 'Детские · Дев',
  KD_M: 'Детские · Мал',
  RL_F: 'Безоправные · Ж',
  RL_M: 'Безоправные · М',
};

/* ────────── Утилы ────────── */

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return '—'; }
}

function classNames(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(' ');
}

/* ────────── Чипы ────────── */

function TypeChip({ code, gender }: { code: FrameTypeCode | null; gender: CatalogGender | null }) {
  if (!code) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
        не распознано
      </span>
    );
  }
  const palette: Record<FrameTypeCode, string> = {
    PA: 'bg-sky-50 text-sky-700 ring-sky-200',
    MA: 'bg-slate-100 text-slate-700 ring-slate-300',
    RP: 'bg-teal-50 text-teal-700 ring-teal-200',
    RM: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    KD: 'bg-amber-50 text-amber-700 ring-amber-200',
    RL: 'bg-purple-50 text-purple-700 ring-purple-200',
  };
  return (
    <span className={classNames(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1',
      palette[code],
    )}>
      {TYPE_LABEL[code]}
      {gender && <span className="opacity-70">· {GENDER_LABEL[gender]}</span>}
    </span>
  );
}

/* ────────── StatCard ────────── */

function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-slate-500">{hint}</div> : null}
    </div>
  );
}

/* ────────── Главный компонент ────────── */

export default function FrameProcurementPage() {
  /* Branches */
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<number>(0);
  const [proxyBranchId, setProxyBranchId] = useState<number>(0);

  /* Catalog */
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unrecognized' | 'needs_review' | 'recognized'>('all');
  const [recognizingProgress, setRecognizingProgress] = useState<{ done: number; total: number; engine: string } | null>(null);

  /* Upload */
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Кеш signed URL'ов по image_hash — используется в loadCatalog,
     чтобы не перевыдавать новые подписи на одни и те же картинки. */
  const signedUrlCacheRef = useRef<Map<string, string>>(new Map());

  /* Editor modal */
  const [editing, setEditing] = useState<CatalogItem | null>(null);

  /* Procurement params */
  const [windowDays, setWindowDays] = useState(60);
  const [targetQty, setTargetQty] = useState(1000);
  const [supplierMin, setSupplierMin] = useState(500);
  const [forceProxy, setForceProxy] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [plan, setPlan] = useState<OrderPlan | null>(null);

  /* Orders */
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [creatingOrder, setCreatingOrder] = useState(false);

  /* ──────── Загрузка филиалов ──────── */
  useEffect(() => {
    (async () => {
      const sb = getBrowserSupabase();
      const { data, error } = await sb.from('branches').select('id, name').order('name');
      if (error) {
        toast.error('Не загрузил филиалы: ' + error.message);
        return;
      }
      const list = (data || []) as Branch[];
      setBranches(list);
      const tokmok = list.find((b) => b.name === 'Токмок');
      const karaBalta = list.find((b) => b.name === 'Кара-Балта');
      if (tokmok) setBranchId(tokmok.id);
      if (karaBalta) setProxyBranchId(karaBalta.id);
    })();
  }, []);

  /* ──────── Загрузка каталога ──────── */
  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('status', filter);
      const res = await fetch(`/api/admin/frame-procurement/catalog?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка загрузки');
      // Стабилизируем signed_url по image_hash: API на каждый запрос отдаёт
      // СВЕЖУЮ подпись для тех же картинок, и браузер из-за нового query-string
      // считает это другим ресурсом и качает заново. Это съело 11 GB egress
      // 26 апреля при оставленной открытой странице. Поэтому держим первый
      // полученный URL для каждой image_hash на всё время жизни компонента —
      // подпись валидна 1 час, страница обычно живёт меньше.
      const incoming = (json.items || []) as CatalogItem[];
      const cache = signedUrlCacheRef.current;
      const stabilized = incoming.map((it) => {
        const cached = cache.get(it.image_hash);
        if (cached) return { ...it, signed_url: cached };
        if (it.signed_url) cache.set(it.image_hash, it.signed_url);
        return it;
      });
      // Чистим из кеша записи, которых уже нет в каталоге (удалили).
      const liveHashes = new Set(stabilized.map((it) => it.image_hash));
      for (const k of cache.keys()) if (!liveHashes.has(k)) cache.delete(k);
      setCatalog(stabilized);
    } catch (e: any) {
      toast.error(e.message || 'Не загрузил каталог');
    } finally {
      setCatalogLoading(false);
    }
  }, [filter]);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  /* ──────── Авто-обновление каталога ──────── */
  /* Цель: ловить загрузки от PowerShell-watcher без ручного F5.
     Бывшая реализация (interval 5s, без кеша signed URL) выкачивала одни и
     те же фотки заново на каждом такте — за час дев-сессии это выливалось
     в 10+ GB egress. Сейчас: 30 сек, пауза при скрытой вкладке, кеш
     signed URL по image_hash. */
  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      if (document.visibilityState !== 'visible') return;
      loadCatalog();
    };
    const id = setInterval(tick, 30_000);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [loadCatalog]);

  /* ──────── Загрузка заказов ──────── */
  const loadOrders = useCallback(async () => {
    if (!branchId) return;
    try {
      const res = await fetch(`/api/admin/frame-procurement/orders?branchId=${branchId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка загрузки заказов');
      setOrders(json.items || []);
    } catch (e: any) {
      console.warn('orders:', e.message);
    }
  }, [branchId]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  /* ──────── Загрузка фото (file input) ──────── */
  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    const t = toast.loading(`Загружаю ${files.length} фото…`);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const res = await fetch('/api/admin/frame-procurement/upload', {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка');
      const s = json.summary;
      toast.success(`Загружено ${s.ok} (новых ${s.ok - s.duplicates}, дублей ${s.duplicates}, ошибок ${s.errors})`, { id: t });
      await loadCatalog();
    } catch (e: any) {
      toast.error(e.message || 'Ошибка загрузки', { id: t });
    } finally {
      setUploading(false);
    }
  }, [loadCatalog]);

  /* ──────── Drag & drop ──────── */
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files: File[] = [];
    if (e.dataTransfer.files) {
      for (const f of e.dataTransfer.files) {
        if (f.type.startsWith('image/')) files.push(f);
      }
    }
    if (files.length === 0) return;
    uploadFiles(files);
  }, [uploadFiles]);

  /* ──────── Paste-event ──────── */
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const it of items) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) files.push(new File([f], `paste-${Date.now()}-${files.length}.png`, { type: f.type || 'image/png' }));
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        uploadFiles(files);
      }
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [uploadFiles]);

  /* ──────── Чтение буфера убрано — оно создавало дубли при перефокусе вкладки.
       Загрузки идут через PowerShell-watcher (ловит Alt+PrtScn нативно),
       либо вручную через Ctrl+V / drag-drop / file picker.
       Каталог сам обновляется каждые 5 сек (см. effect выше). ──────── */

  /* ──────── Распознавание ──────── */
  const recognize = useCallback(async (engine: RecognitionEngine, onlyUnrecognized = true) => {
    const ids = catalog
      .filter((c) => onlyUnrecognized ? !c.recognized_by : true)
      .map((c) => c.id);
    if (ids.length === 0) {
      toast(onlyUnrecognized ? 'Нет фото без распознавания' : 'Каталог пуст');
      return;
    }
    // Чанкуем по 5 фото: при concurrency=3 на сервере один чанк проходит
    // ~10-20 секунд, прогресс обновляется заметно чаще.
    const CHUNK = 5;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));

    setRecognizingProgress({ done: 0, total: ids.length, engine });
    const t = toast.loading(`Распознаю через ${engine}: 0/${ids.length}`);
    let totalRecognized = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const res = await fetch('/api/admin/frame-procurement/recognize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ catalogIds: chunk, engine }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Ошибка распознавания');
        const s = json.summary;
        totalRecognized += s.recognized || 0;
        totalSkipped += s.skipped || 0;
        totalErrors += s.errors || 0;
        const done = Math.min((i + 1) * CHUNK, ids.length);
        setRecognizingProgress({ done, total: ids.length, engine });
        toast.loading(`Распознаю через ${engine}: ${done}/${ids.length}`, { id: t });
      }
      toast.success(
        `Готово: ${totalRecognized} распознано, ${totalSkipped} пропущено, ${totalErrors} ошибок`,
        { id: t },
      );
      await loadCatalog();
    } catch (e: any) {
      toast.error(e.message || 'Ошибка', { id: t });
    } finally {
      setRecognizingProgress(null);
    }
  }, [catalog, loadCatalog]);

  /* ──────── Удаление ──────── */
  const deleteItem = useCallback(async (id: string) => {
    const t = toast.loading('Удаляю…');
    try {
      const res = await fetch(`/api/admin/frame-procurement/catalog/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка');
      toast.success('Удалено', { id: t });
      setEditing(null);
      await loadCatalog();
    } catch (e: any) {
      toast.error(e.message || 'Ошибка', { id: t });
    }
  }, [loadCatalog]);

  /* ──────── Построение плана ──────── */
  const buildPlan = useCallback(async () => {
    if (!branchId || !proxyBranchId) {
      toast.error('Выберите оба филиала');
      return;
    }
    setPlanLoading(true);
    try {
      const res = await fetch('/api/admin/frame-procurement/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId, proxyBranchId,
          windowDays, targetQty, supplierMin,
          forceProxyOnly: forceProxy,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка плана');
      setPlan(json.plan);
      toast.success(`План готов: ${json.plan.totalQty} шт, ${json.plan.modelsUsed} моделей`);
    } catch (e: any) {
      toast.error(e.message || 'Ошибка плана');
    } finally {
      setPlanLoading(false);
    }
  }, [branchId, proxyBranchId, windowDays, targetQty, supplierMin, forceProxy]);

  /* ──────── Сохранение заказа + ZIP ──────── */
  const createOrderAndDownload = useCallback(async () => {
    if (!plan || !branchId || !proxyBranchId) {
      toast.error('Сначала постройте план');
      return;
    }
    setCreatingOrder(true);
    const t = toast.loading('Создаю заказ и собираю ZIP…');
    try {
      // 1) Сохраняем заказ
      const res = await fetch('/api/admin/frame-procurement/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          input: { branchId, proxyBranchId, windowDays, targetQty, supplierMin },
          recognizedBy: 'mixed',
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не сохранился заказ');
      const orderId = json.order.id;

      // 2) Качаем ZIP
      const zipRes = await fetch(`/api/admin/frame-procurement/orders/${orderId}/zip`);
      if (!zipRes.ok) {
        const errJson = await zipRes.json().catch(() => ({}));
        throw new Error(errJson.error || 'Не собрался ZIP');
      }
      const blob = await zipRes.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `refocus-frames-order-${orderId.slice(0, 8)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success('Заказ создан и ZIP скачан', { id: t });
      await loadOrders();
    } catch (e: any) {
      toast.error(e.message || 'Ошибка', { id: t });
    } finally {
      setCreatingOrder(false);
    }
  }, [plan, branchId, proxyBranchId, windowDays, targetQty, supplierMin, loadOrders]);

  /* ──────── Скачать ZIP существующего заказа ──────── */
  const downloadExistingZip = useCallback(async (orderId: string) => {
    const t = toast.loading('Качаю ZIP…');
    try {
      const res = await fetch(`/api/admin/frame-procurement/orders/${orderId}/zip`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Ошибка');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `refocus-frames-order-${orderId.slice(0, 8)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('ZIP скачан', { id: t });
    } catch (e: any) {
      toast.error(e.message || 'Ошибка', { id: t });
    }
  }, []);

  /* ──────── Memo: статистика каталога ──────── */
  const catalogStats = useMemo(() => {
    const total = catalog.length;
    const recognized = catalog.filter((c) => c.recognized_by).length;
    const review = catalog.filter((c) => c.needs_review).length;
    return { total, recognized, review, unrecognized: total - recognized };
  }, [catalog]);

  /* ──────── Memo: filtered catalog ──────── */
  const visibleCatalog = useMemo(() => {
    if (filter === 'unrecognized') return catalog.filter((c) => !c.recognized_by);
    if (filter === 'needs_review') return catalog.filter((c) => c.needs_review);
    if (filter === 'recognized') return catalog.filter((c) => c.recognized_by);
    return catalog;
  }, [catalog, filter]);

  return (
    <div className="min-h-screen p-6">
      {/* ─────── Шапка ─────── */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
            <Glasses className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-50">
              Закупка оправ
            </div>
            <div className="mt-0.5 text-[12px] text-cyan-300/50">
              Каталог поставщика → автоматическое распределение → ZIP в WeChat
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={branchId}
            onChange={(e) => setBranchId(Number(e.target.value))}
            className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70"
          >
            <option value={0}>— Куда везём —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ─────── Метрики ─────── */}
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <StatCard label="Всего фото" value={catalogStats.total} />
        <StatCard label="Распознано" value={catalogStats.recognized} hint={catalogStats.recognized < catalogStats.total ? `${catalogStats.unrecognized} ждёт LLM` : 'все готовы'} />
        <StatCard label="На проверку" value={catalogStats.review} hint={catalogStats.review > 0 ? 'требуется ручная правка' : 'всё ок'} />
        <StatCard
          label="Готовых заказов"
          value={orders.length}
          hint={plan ? `текущий план: ${plan.totalQty} шт` : 'плана пока нет'}
        />
      </div>

      {/* ─────── Каталог ─────── */}
      <div className="mb-6 rounded-2xl bg-white ring-1 ring-sky-100 p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-cyan-500" />
            <h2 className="text-lg font-bold tracking-tight text-slate-900">
              Каталог поставщика
            </h2>
            <span className="text-[11px] text-slate-500">
              {catalogStats.total} фото
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-3 py-2 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 disabled:opacity-50"
            >
              <FilePlus2 className="h-4 w-4" /> Загрузить файлы
            </button>
            <button
              onClick={async () => {
                if (!confirm('Удалить дубли по артикулу поставщика? Останется по одной карточке на каждую модель.')) return;
                const t = toast.loading('Ищу дубли…');
                try {
                  const res = await fetch('/api/admin/frame-procurement/dedupe', { method: 'POST' });
                  const json = await res.json();
                  if (!res.ok) throw new Error(json.error || 'Ошибка');
                  if (json.removed === 0) {
                    toast.success('Дублей не найдено', { id: t });
                  } else {
                    toast.success(`Удалено ${json.removed} дублей, оставлено ${json.kept}`, { id: t });
                    await loadCatalog();
                  }
                } catch (e: any) {
                  toast.error(e.message || 'Ошибка', { id: t });
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-600 ring-1 ring-sky-200 transition hover:bg-sky-50"
              title="Найти и удалить дубли по артикулу поставщика"
            >
              <Trash2 className="h-4 w-4" /> Дубли
            </button>
            <button
              onClick={async () => {
                if (catalog.length === 0 && orders.length === 0) { toast('Каталог и заказы уже пусты'); return; }
                if (!confirm(`Удалить ВСЕ ${catalog.length} карточек каталога И ${orders.length} заказов? Действие необратимо.`)) return;
                if (!confirm('Точно удалить весь каталог и заказы? Файлы фото тоже сотрутся из Storage.')) return;
                const t = toast.loading('Удаляю всё…');
                try {
                  const res = await fetch('/api/admin/frame-procurement/catalog/clear-all', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ confirm: 'YES' }),
                  });
                  const json = await res.json();
                  if (!res.ok) throw new Error(json.error || 'Ошибка');
                  toast.success(
                    `Удалено: ${json.deleted_rows} карточек, ${json.deleted_files} файлов, ${json.deleted_orders} заказов`,
                    { id: t },
                  );
                  await loadCatalog();
                  await loadOrders();
                } catch (e: any) {
                  toast.error(e.message || 'Ошибка', { id: t });
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-500 px-3 py-2 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(244,63,94,0.28)] transition hover:bg-rose-400"
              title="Удалить все карточки и фото каталога"
            >
              <Trash2 className="h-4 w-4" /> Удалить всё
            </button>
            <button
              onClick={() => loadCatalog()}
              disabled={catalogLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-600 ring-1 ring-sky-200 transition hover:bg-sky-50 disabled:opacity-50"
            >
              <RefreshCw className={classNames('h-4 w-4', catalogLoading && 'animate-spin')} />
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length > 0) uploadFiles(files);
              e.target.value = '';
            }}
          />
        </div>

        {/* Drag & drop зона */}
        <div
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
          className="mb-4 rounded-xl border-2 border-dashed border-sky-200 bg-sky-50/30 p-5 text-sm text-slate-600"
        >
          <div className="mb-3 flex items-center justify-center gap-2">
            <ClipboardPaste className="h-5 w-5 text-cyan-500" />
            <span className="font-semibold text-slate-700">Как загрузить фото каталога</span>
          </div>

          <div className="mx-auto max-w-3xl space-y-3 text-[12px]">
            <div className="rounded-lg bg-emerald-50 p-3 ring-1 ring-emerald-200">
              <div className="mb-2 font-semibold text-emerald-800">⭐ Рекомендую: фоновый watcher (без переключения окон)</div>
              <ol className="list-decimal space-y-1 pl-5 text-emerald-900">
                <li>
                  <a
                    href="/refocus-watcher.bat"
                    download="refocus-watcher.bat"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-emerald-500"
                  >
                    <Download className="h-3.5 w-3.5" /> Скачать запускалку (.bat)
                  </a>
                  &nbsp; — сохрани на рабочий стол. Двойной клик — watcher запущен. Закрыл окно — остановился.
                </li>
                <li>
                  В WeChat открой фото на полный экран → <kbd className="rounded bg-white px-1.5 py-0.5 font-mono ring-1 ring-emerald-200">Alt+PrtScn</kbd>
                  → стрелка вправо → <kbd className="rounded bg-white px-1.5 py-0.5 font-mono ring-1 ring-emerald-200">Alt+PrtScn</kbd> → ...
                </li>
                <li>Скрипт ловит фото из буфера и грузит в БД, минуя браузер. Переключать окна не нужно.</li>
                <li>Эта страница сама обновляется каждые 5 сек — новые фото появятся в сетке.</li>
              </ol>
            </div>

            <div className="text-slate-600">
              Альтернативы (если watcher не запущен):
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li><b>Drag &amp; drop:</b> перетащи папку или файлы прямо сюда.</li>
                <li><b>Ctrl+V:</b> кликни сюда после <kbd className="rounded bg-slate-200 px-1 py-0.5 font-mono">Alt+PrtScn</kbd>.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Распознавание — одна большая кнопка GPT-5 */}
        <div className="mb-4">
          {(() => {
            // GPT-5 ≈ $0.0075/фото ≈ 0.7 сом/фото (с учётом нашего длинного промпта)
            const n = catalogStats.unrecognized;
            const cost = Math.max(1, Math.round(n * 0.7));
            return (
              <button
                onClick={() => recognize('gpt-5')}
                disabled={!!recognizingProgress || n === 0}
                className="group flex w-full items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-5 text-white shadow-[0_6px_24px_rgba(20,184,166,0.35)] transition hover:from-emerald-400 hover:to-teal-500 disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/20 backdrop-blur">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <div className="text-left">
                    <div className="text-base font-bold">
                      {n > 0 ? `Распознать ${n} нераспознанных фото` : 'Все фото уже распознаны'}
                    </div>
                    <div className="text-[12px] opacity-85">
                      {n > 0
                        ? `Через GPT-5 · ~${cost} сом`
                        : 'Если хочешь переразпознать — открой карточку и жми «Распознать заново»'}
                    </div>
                  </div>
                </div>
                <Wand2 className="h-6 w-6 opacity-60 transition group-hover:opacity-100" />
              </button>
            );
          })()}
        </div>

        {/* Прогресс-бар */}
        {recognizingProgress && (
          <div className="mb-4 rounded-xl bg-cyan-50 p-3 text-[12px] text-cyan-700 ring-1 ring-cyan-200">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Распознаю через {recognizingProgress.engine}: {recognizingProgress.done}/{recognizingProgress.total}
            </div>
          </div>
        )}

        {/* Фильтры */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(['all', 'unrecognized', 'needs_review', 'recognized'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={classNames(
                'rounded-lg px-3 py-1.5 text-[12px] font-semibold transition',
                filter === f
                  ? 'bg-cyan-500 text-white ring-1 ring-cyan-400 shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
                  : 'bg-white text-slate-600 ring-1 ring-sky-200 hover:bg-sky-50',
              )}
            >
              {f === 'all' && `Все (${catalogStats.total})`}
              {f === 'unrecognized' && `Не распознаны (${catalogStats.unrecognized})`}
              {f === 'needs_review' && `На проверку (${catalogStats.review})`}
              {f === 'recognized' && `Распознаны (${catalogStats.recognized})`}
            </button>
          ))}
        </div>

        {/* Сетка миниатюр */}
        {visibleCatalog.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">
            {catalogLoading ? 'Загрузка…' : filter === 'all' ? 'Пока пусто. Загрузи фото.' : 'Нет фото под этот фильтр.'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {visibleCatalog.map((item) => (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => setEditing(item)}
                onKeyDown={(e) => { if (e.key === 'Enter') setEditing(item); }}
                className={classNames(
                  'group relative cursor-pointer overflow-hidden rounded-xl bg-slate-100 ring-1 transition',
                  item.needs_review ? 'ring-amber-300 shadow-[0_0_0_2px_rgba(252,211,77,0.4)]' :
                  item.recognized_by ? 'ring-emerald-200 hover:ring-cyan-400' :
                  'ring-slate-200 hover:ring-cyan-400',
                )}
              >
                {item.signed_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.signed_url}
                    alt=""
                    className="aspect-[3/4] w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="aspect-[3/4] w-full bg-slate-200" />
                )}

                {/* Крестик удаления — правый верхний угол, появляется на hover */}
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm('Удалить эту карточку?')) return;
                    const t = toast.loading('Удаляю…');
                    try {
                      const res = await fetch(`/api/admin/frame-procurement/catalog/${item.id}`, { method: 'DELETE' });
                      const json = await res.json();
                      if (!res.ok) throw new Error(json.error || 'Ошибка');
                      toast.success('Удалено', { id: t });
                      await loadCatalog();
                    } catch (err: any) {
                      toast.error(err.message || 'Ошибка', { id: t });
                    }
                  }}
                  className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-rose-500/90 text-white opacity-0 shadow-md transition group-hover:opacity-100 hover:bg-rose-500"
                  title="Удалить эту карточку"
                >
                  <X className="h-4 w-4" />
                </button>

                <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex flex-wrap items-center gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5">
                  <TypeChip code={item.type_code} gender={item.gender} />
                  {item.needs_review && <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
                  {item.manually_corrected && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─────── План заказа ─────── */}
      <div className="mb-6 rounded-2xl bg-white ring-1 ring-sky-100 p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <PackageCheck className="h-5 w-5 text-cyan-500" />
          <h2 className="text-lg font-bold tracking-tight text-slate-900">План заказа</h2>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Куда</span>
            <select
              value={branchId}
              onChange={(e) => setBranchId(Number(e.target.value))}
              className="w-full rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
            >
              <option value={0}>—</option>
              {branches.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Прокси (для холодного старта)</span>
            <select
              value={proxyBranchId}
              onChange={(e) => setProxyBranchId(Number(e.target.value))}
              className="w-full rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
            >
              <option value={0}>—</option>
              {branches.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Окно продаж (дн)</span>
            <input
              type="number"
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value) || 60)}
              min={7}
              max={365}
              className="w-full rounded-xl bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Цель, шт</span>
            <input
              type="number"
              value={targetQty}
              onChange={(e) => setTargetQty(Number(e.target.value) || 1000)}
              min={1}
              className="w-full rounded-xl bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Минималка поставщика</span>
            <input
              type="number"
              value={supplierMin}
              onChange={(e) => setSupplierMin(Number(e.target.value) || 500)}
              min={0}
              className="w-full rounded-xl bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70"
            />
          </label>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-[12px] text-slate-600">
            <input
              type="checkbox"
              checked={forceProxy}
              onChange={(e) => setForceProxy(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-400"
            />
            Принудительно холодный старт (игнорировать продажи целевого филиала)
          </label>

          <button
            onClick={buildPlan}
            disabled={planLoading || !branchId || !proxyBranchId}
            className="ml-auto inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 disabled:opacity-50"
          >
            {planLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            Пересчитать план
          </button>
        </div>

        {plan && (
          <>
            <div className="mb-3 grid gap-3 md:grid-cols-4">
              <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                <div className="text-[11px] text-slate-500">Холодный старт</div>
                <div className="text-base font-bold text-slate-900">{plan.coldStart ? 'Да (Кара-Балта)' : 'Нет (свои продажи)'}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                <div className="text-[11px] text-slate-500">Своих продаж за окно</div>
                <div className="text-base font-bold text-slate-900">{plan.ownSalesTotal}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                <div className="text-[11px] text-slate-500">Моделей в каталоге</div>
                <div className="text-base font-bold text-slate-900">{plan.modelsUsed}</div>
              </div>
              <div className="rounded-xl bg-cyan-50 p-3 ring-1 ring-cyan-200">
                <div className="text-[11px] text-cyan-700">Итого штук</div>
                <div className="text-base font-bold text-cyan-900">{plan.totalQty}</div>
              </div>
            </div>

            {plan.uncoveredSections.length > 0 && (
              <div className="mb-3 rounded-xl bg-amber-50 p-3 text-[12px] text-amber-800 ring-1 ring-amber-200">
                <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                Не нашлось моделей в каталоге для секций: {plan.uncoveredSections.map((k) => SECTION_LABEL[k]).join(', ')}
              </div>
            )}

            <div className="overflow-hidden rounded-xl ring-1 ring-sky-100">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/80">
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5">Секция</th>
                    <th className="px-4 py-2.5 text-right">Доля</th>
                    <th className="px-4 py-2.5 text-right">К заказу</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-900">
                  {SECTION_ORDER.map((k) => {
                    const qty = plan.qtyBySection[k] || 0;
                    const share = plan.sharesBySection[k] || 0;
                    return (
                      <tr key={k} className="transition hover:bg-sky-50/40">
                        <td className="px-4 py-2.5">{SECTION_LABEL[k]}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-[13px] text-slate-600">{(share * 100).toFixed(1)}%</td>
                        <td className="px-4 py-2.5 text-right font-bold">{qty}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-slate-50 font-bold">
                    <td className="px-4 py-2.5">Итого</td>
                    <td className="px-4 py-2.5 text-right">100%</td>
                    <td className="px-4 py-2.5 text-right">{plan.totalQty}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={createOrderAndDownload}
                disabled={creatingOrder}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 disabled:opacity-50"
              >
                {creatingOrder ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Сохранить заказ и скачать ZIP
              </button>
            </div>
          </>
        )}
      </div>

      {/* ─────── История заказов ─────── */}
      <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
        <div className="mb-4 flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-cyan-500" />
          <h2 className="text-lg font-bold tracking-tight text-slate-900">История заказов</h2>
        </div>

        {orders.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-500">Пока заказов нет.</div>
        ) : (
          <div className="overflow-hidden rounded-xl ring-1 ring-sky-100">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Создан</th>
                  <th className="px-4 py-2.5">Статус</th>
                  <th className="px-4 py-2.5">Холодный старт</th>
                  <th className="px-4 py-2.5">Распознавал</th>
                  <th className="px-4 py-2.5 text-right">Штук</th>
                  <th className="px-4 py-2.5 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-900">
                {orders.map((o) => (
                  <tr key={o.id} className="transition hover:bg-sky-50/40">
                    <td className="px-4 py-2.5 text-[13px] text-slate-600">{fmtDate(o.created_at)}</td>
                    <td className="px-4 py-2.5">
                      <span className={classNames(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1',
                        o.status === 'draft' ? 'bg-slate-100 text-slate-600 ring-slate-200' :
                        o.status === 'sent' ? 'bg-cyan-50 text-cyan-700 ring-cyan-200' :
                        o.status === 'received' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' :
                        'bg-rose-50 text-rose-700 ring-rose-200',
                      )}>
                        {o.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[13px]">{o.cold_start ? '🧊 да' : 'нет'}</td>
                    <td className="px-4 py-2.5 text-[13px] text-slate-600">{o.recognized_by || '—'}</td>
                    <td className="px-4 py-2.5 text-right font-bold">{o.total_qty}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => downloadExistingZip(o.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 ring-1 ring-slate-200 transition hover:bg-cyan-50 hover:text-cyan-600 hover:ring-cyan-200"
                        title="Скачать ZIP"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─────── Модалка редактирования ─────── */}
      {editing && (
        <ItemEditorModal
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setCatalog((prev) => prev.map((c) => c.id === updated.id ? { ...c, ...updated } : c));
            setEditing(null);
            toast.success('Сохранено');
          }}
          onDelete={() => deleteItem(editing.id)}
        />
      )}
    </div>
  );
}

/* ────────── Модалка редактирования ────────── */

function ItemEditorModal({
  item,
  onClose,
  onSaved,
  onDelete,
}: {
  item: CatalogItem;
  onClose: () => void;
  onSaved: (updated: CatalogItem) => void;
  onDelete: () => void;
}) {
  const [supplierModel, setSupplierModel] = useState(item.supplier_model || '');
  const [typeCode, setTypeCode] = useState<FrameTypeCode | ''>(item.type_code || '');
  const [gender, setGender] = useState<CatalogGender | ''>(item.gender || '');
  const [colors, setColors] = useState<CatalogColor[]>(item.colors || []);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reRecognizing, setReRecognizing] = useState<RecognitionEngine | null>(null);

  const reRecognize = useCallback(async (engine: RecognitionEngine) => {
    setReRecognizing(engine);
    const t = toast.loading(`Перераспознаю через ${engine}…`);
    try {
      const res = await fetch('/api/admin/frame-procurement/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalogIds: [item.id], engine, forceRerun: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка');
      // Подтягиваем обновлённую запись
      const get = await fetch(`/api/admin/frame-procurement/catalog?status=all&limit=2000`);
      const list = await get.json();
      const updated = (list.items || []).find((x: CatalogItem) => x.id === item.id);
      if (updated) {
        setSupplierModel(updated.supplier_model || '');
        setTypeCode((updated.type_code as FrameTypeCode | null) || '');
        setGender((updated.gender as CatalogGender | null) || '');
        setColors(updated.colors || []);
      }
      toast.success(`Распознано через ${engine}`, { id: t });
    } catch (e: any) {
      toast.error(e.message || 'Ошибка', { id: t });
    } finally {
      setReRecognizing(null);
    }
  }, [item.id]);

  const save = useCallback(async () => {
    if (!typeCode || !gender) {
      toast.error('Тип и пол обязательны');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/frame-procurement/catalog/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_model: supplierModel || null,
          type_code: typeCode,
          gender,
          colors,
          needs_review: false,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка');
      onSaved({ ...item, ...json.item });
    } catch (e: any) {
      toast.error(e.message || 'Ошибка');
    } finally {
      setSaving(false);
    }
  }, [item, supplierModel, typeCode, gender, colors, onSaved]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-3xl bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.4)] ring-1 ring-sky-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.3)]">
              <Eye className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight text-slate-900">
                Карточка модели
              </div>
              <div className="text-[12px] text-slate-500">
                {item.recognized_by ? `Распознано через ${item.recognized_by}` : 'Не распознано'}
                {item.confidence !== null && ` · уверенность ${(item.confidence * 100).toFixed(0)}%`}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Фото */}
          <div className="overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-200">
            {item.signed_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.signed_url} alt="" className="w-full" />
            ) : (
              <div className="aspect-[3/4] w-full" />
            )}
          </div>

          {/* Форма */}
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Артикул поставщика</span>
              <input
                value={supplierModel}
                onChange={(e) => setSupplierModel(e.target.value)}
                placeholder="38007-53-16-147"
                className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none focus:ring-2 focus:ring-cyan-400/70 placeholder:text-slate-400"
              />
            </label>

            <div>
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Тип</span>
              <div className="grid grid-cols-3 gap-2">
                {(['PA','MA','RP','RM','KD','RL'] as FrameTypeCode[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTypeCode(t)}
                    className={classNames(
                      'rounded-xl px-2 py-2 text-[12px] font-semibold transition',
                      typeCode === t
                        ? 'bg-cyan-500 text-white ring-1 ring-cyan-400 shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
                        : 'bg-white text-slate-600 ring-1 ring-sky-200 hover:bg-sky-50',
                    )}
                  >
                    {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Пол</span>
              <div className="grid grid-cols-3 gap-2">
                {(['F','M','U'] as CatalogGender[]).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGender(g)}
                    className={classNames(
                      'rounded-xl px-3 py-2 text-sm font-semibold transition',
                      gender === g
                        ? 'bg-cyan-500 text-white ring-1 ring-cyan-400 shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
                        : 'bg-white text-slate-600 ring-1 ring-sky-200 hover:bg-sky-50',
                    )}
                  >
                    {g === 'F' ? 'Женский' : g === 'M' ? 'Мужской' : 'Унисекс'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Цвета ({colors.length})
              </span>
              {colors.length === 0 && (
                <div className="rounded-lg bg-amber-50 p-3 text-[12px] text-amber-700 ring-1 ring-amber-200">
                  Цвета не распознаны. Без них заказ не сформируется. Запусти распознавание ещё раз или добавь руками.
                </div>
              )}
              {/* Компактный список: ~28px на строку, до 8 строк без скролла */}
              <div className="space-y-1 max-h-[260px] overflow-y-auto pr-1">
                {colors.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5 rounded bg-slate-50 px-1.5 py-1 ring-1 ring-slate-200">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-slate-200 text-[10px] font-bold text-slate-600">
                      {i + 1}
                    </span>
                    <input
                      value={c.label}
                      onChange={(e) => {
                        const next = [...colors];
                        next[i] = { ...c, label: e.target.value };
                        setColors(next);
                      }}
                      placeholder="C1"
                      className="w-20 rounded bg-white px-1.5 py-0.5 text-[12px] font-medium text-slate-900 ring-1 ring-sky-200 outline-none placeholder:text-slate-300 focus:ring-2 focus:ring-cyan-400/70"
                    />
                    <input
                      value={c.name_ru}
                      onChange={(e) => {
                        const next = [...colors];
                        next[i] = { ...c, name_ru: e.target.value };
                        setColors(next);
                      }}
                      placeholder="чёрный"
                      className="flex-1 rounded bg-white px-1.5 py-0.5 text-[12px] font-medium text-slate-900 ring-1 ring-sky-200 outline-none placeholder:text-slate-300 focus:ring-2 focus:ring-cyan-400/70"
                    />
                    <button
                      type="button"
                      onClick={() => setColors(colors.filter((_, j) => j !== i))}
                      className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      title="Удалить эту строку"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setColors([
                  ...colors,
                  {
                    label: `C${colors.length + 1}`,
                    name_ru: '',
                    bbox: [0.05, colors.length * 0.15, 0.85, 0.13],
                  },
                ])}
                className="mt-2 text-[12px] font-semibold text-cyan-600 hover:text-cyan-700"
              >
                + добавить цвет
              </button>
            </div>

            {item.notes && (
              <div className="rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600 ring-1 ring-slate-200">
                <span className="font-semibold">LLM-заметка:</span> {item.notes}
              </div>
            )}

            <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                Распознать заново
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => reRecognize('opus-4.7')}
                  disabled={!!reRecognizing}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-orange-400 disabled:opacity-50"
                >
                  {reRecognizing === 'opus-4.7'
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Brain className="h-3.5 w-3.5" />}
                  Opus 4.7
                </button>
                <button
                  type="button"
                  onClick={() => reRecognize('gpt-5')}
                  disabled={!!reRecognizing}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  {reRecognizing === 'gpt-5'
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Sparkles className="h-3.5 w-3.5" />}
                  GPT-5
                </button>
                <span className="text-[11px] text-amber-700">
                  Перетрёт текущие данные новым распознаванием
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-2">
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-50"
            >
              <Trash2 className="h-4 w-4" /> Удалить
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-rose-600">Точно?</span>
              <button onClick={onDelete} className="inline-flex items-center gap-2 rounded-xl bg-rose-500 px-3 py-2 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(244,63,94,0.28)] hover:bg-rose-400">
                <Trash2 className="h-4 w-4" /> Да, удалить
              </button>
              <button onClick={() => setConfirmDelete(false)} className="rounded-xl px-3 py-2 text-sm text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50">
                Отмена
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            >
              Отмена
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] hover:bg-cyan-400 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
