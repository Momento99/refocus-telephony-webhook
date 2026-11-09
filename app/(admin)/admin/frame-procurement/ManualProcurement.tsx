'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Upload, X, ChevronRight, Download, Check, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { FRAME_RECOGNITION_MODEL, type SupplierCatalogRow } from '@/lib/frameProcurementTypes';
import { MANUAL_FRAME_TYPES, MANUAL_FRAME_GENDERS, colorPoint, distributeEvenly,
  modelFromCatalog, modelQuantity, draftQuantity, validateManualDraft,
  type ManualColor, type ManualModel, type ManualDraft, type ManualOrder } from '@/lib/frameManualProcurement';
import styles from './manual-procurement.module.css';
import { frameMarkFontSize } from '@/lib/frameAnnotationLayout';
import PurchaseMix from './PurchaseMix';
import ModelPurchaseProgress from './ModelPurchaseProgress';
import { isModelExcludedFromPurchase } from '@/lib/framePurchaseMix';

type Catalog = SupplierCatalogRow & { signed_url: string | null; recognition_usage?: { usd: number; kgs: number } | null };
type LocalCopy = { id: string; revision: number; draft: ManualDraft };
type Recognition = { colors: ManualColor[]; supplier_model: string | null; needs_review: boolean; notes: string };
const API = '/api/admin/frame-procurement';
const LOCAL_KEY = 'refocus-frame-manual-v1';
const money = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
async function jsonRequest(path: string, options?: RequestInit) {
  const response = await fetch(API + path, { cache: 'no-store', ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос');
  return data;
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export default function ManualProcurement() {
  const [catalog, setCatalog] = useState<Catalog[]>([]);
  const [orders, setOrders] = useState<ManualOrder[]>([]);
  const [order, setOrder] = useState<ManualOrder | null>(null);
  const [draft, setDraft] = useState<ManualDraft>({ target: 500, models: [] });
  const [id, setId] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [recovery, setRecovery] = useState<LocalCopy | null>(null);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'selected' | 'new'>('all');
  const [search, setSearch] = useState('');
  const [targetText, setTargetText] = useState('500');
  const [history, setHistory] = useState(false);
  const lock = useRef(false);
  const stopRecognition = useRef(false);
  const [recognitionBatch, setRecognitionBatch] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const fileInput = useRef<HTMLInputElement>(null);
  const signedCache = useRef(new Map<string, { url: string; time: number }>());
  const readonly = order !== null && order.status !== 'draft';
  const dirty = order ? JSON.stringify(order.manual_draft) !== JSON.stringify(draft) : draft.models.length > 0 || draft.target !== 500 || !!draft.purchaseMix;
  const quantity = draftQuantity(draft);
  const selectedModels = draft.models.filter(m => modelQuantity(m) > 0);
  const modelsById = useMemo(() => new Map(draft.models.map(m => [m.catalogId, m])), [draft]);

  const loadCatalog = useCallback(async () => {
    const data = await jsonRequest('/catalog?limit=2000');
    const rows: Catalog[] = data.items.map((row: Catalog) => {
      const cached = signedCache.current.get(row.image_hash);
      if (cached && Date.now() - cached.time < 50 * 60000) return { ...row, signed_url: cached.url };
      if (row.signed_url) signedCache.current.set(row.image_hash, { url: row.signed_url, time: Date.now() });
      return row;
    });
    setCatalog(rows);
    return rows;
  }, []);

  useEffect(() => {
    let active = true;
    async function init() {
      try {
        const [, data] = await Promise.all([loadCatalog(), jsonRequest('/manual')]);
        if (!active) return;
        const list: ManualOrder[] = data.orders;
        setOrders(list);
        const current = list.find(o => o.status === 'draft') || null;
        let local: LocalCopy | null = null;
        try { local = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); } catch { /* unavailable storage */ }
        const same = local ? list.find(o => o.id === local.id) : null;
        if (local && (!same && local.revision === 0 || same?.status === 'draft' && same.revision === local.revision)) {
          setId(local.id); setOrder(same || null); setDraft(local.draft); setTargetText(String(local.draft.target));
          if (!same || JSON.stringify(same.manual_draft) !== JSON.stringify(local.draft)) setNotice('Восстановлен черновик с этого устройства.');
        } else {
          setOrder(current); setId(current?.id || crypto.randomUUID());
          setDraft(current?.manual_draft || { target: 500, models: [] });
          setTargetText(String(current?.manual_draft.target || 500));
          if (local && (!same || JSON.stringify(same.manual_draft) !== JSON.stringify(local.draft))) setRecovery(local);
        }
        setReady(true);
      } catch (e) { if (active) setError((e as Error).message); }
    }
    void init();
    return () => { active = false; };
  }, [loadCatalog]);

  useEffect(() => {
    if (!ready || readonly || recovery) return;
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ id, revision: order?.revision || 0, draft })); }
    catch { setError('Не удалось сохранить копию на устройстве. Сохраните заказ в базу.'); }
  }, [ready, readonly, recovery, id, order?.revision, draft]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void loadCatalog().catch(() => {}); };
    const interval = setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, [loadCatalog]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (ready && dirty && !readonly) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [ready, dirty, readonly, draft.models.length]);

  async function run(label: string, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(label); setError(''); setNotice('');
    try { await action(); } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(''); }
  }
  async function persist(next = draftRef.current, sent = false) {
    const target = Number(targetText);
    // Discard only zero-quantity placeholders for photos removed from the catalog.
    // Positive quantities must remain visible as errors, never disappear silently.
    const existingIds = new Set(catalog.map(row => row.id));
    const validated = validateManualDraft({ ...next, target,
      models: next.models.filter(model => modelQuantity(model) > 0 || existingIds.has(model.catalogId)) });
    const data = await jsonRequest('/manual', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, revision: order?.revision || 0, draft: validated, sent }) });
    const saved: ManualOrder = data.order;
    setOrder(saved); setDraft(saved.manual_draft);
    setOrders(prev => [saved, ...prev.filter(o => o.id !== saved.id)]);
    // Synchronize the recovery copy before allowing navigation.
    try {
      if (sent) localStorage.removeItem(LOCAL_KEY);
      else localStorage.setItem(LOCAL_KEY, JSON.stringify({ id: saved.id, revision: saved.revision, draft: saved.manual_draft }));
    } catch { /* The database copy is already durable. */ }
    return saved;
  }
  function changeModel(model: ManualModel) {
    setDraft(prev => ({ ...prev, models: prev.models.some(m => m.catalogId === model.catalogId)
      ? prev.models.map(m => m.catalogId === model.catalogId ? model : m) : [...prev.models, model] }));
  }
  function openCard(row: Catalog) {
    setNotice(''); setError('');
    if (!modelsById.has(row.id) && !readonly) {
      const previous = orders.flatMap(o => o.manual_draft.models).find(m => m.catalogId === row.id);
      changeModel(previous ? { ...clone(previous), supplierModel: previous.supplierModel || row.supplier_model || '',
        colors: (previous.colors.length ? previous.colors : modelFromCatalog(row).colors).map(c => ({ ...clone(c), qty: 0 })) } : modelFromCatalog(row));
    } else if (!readonly && !modelsById.get(row.id)?.colors.length && row.colors?.length) {
      const existing = modelsById.get(row.id)!;
      changeModel({ ...existing, supplierModel: existing.supplierModel || row.supplier_model || '', colors: modelFromCatalog(row).colors });
    }
    setEditorId(row.id);
  }
  async function saveCard(next: boolean) {
    await run('Сохраняю', async () => {
      await persist();
      if (next) {
        const index = visible.findIndex(row => row.id === editorId);
        const following = visible[index + 1];
        if (following) openCard(following); else setEditorId(null);
      } else setEditorId(null);
    });
  }
  async function upload(files: File[]) {
    if (!files.length) return;
    await run('Загружаю фото', async () => {
      const body = new FormData();
      files.forEach(file => body.append('files', file));
      const data = await jsonRequest('/upload', { method: 'POST', body });
      await loadCatalog();
      if (data.summary?.errors) throw new Error(`Загружено: ${data.summary.ok}. Не удалось: ${data.summary.errors}. ${data.results.find((r: { ok: boolean }) => !r.ok)?.error || ''}`);
      setNotice(data.summary?.duplicates ? `Фото загружены. Уже были в каталоге: ${data.summary.duplicates}.` : 'Фото добавлены в каталог.');
    });
  }
  async function deletePhoto(row: Catalog) {
    if (lock.current || !ready) return;
    const model = modelsById.get(row.id);
    if (model && modelQuantity(model) > 0) {
      setError('Эта модель добавлена в заказ. Сначала поставьте количество 0 в карточке и сохраните заказ.');
      return;
    }
    if (!window.confirm('Удалить эту фотографию из каталога? Это действие нельзя отменить.')) return;
    await run('Удаляю фото', async () => {
      const result = await jsonRequest(`/catalog/${row.id}`, { method: 'DELETE' });
      signedCache.current.delete(row.image_hash);
      setCatalog(prev => prev.filter(item => item.id !== row.id));
      if (!readonly) setDraft(prev => ({ ...prev, models: prev.models.filter(item => item.catalogId !== row.id) }));
      setNotice(result.storageRemoved ? 'Фото удалено.' : 'Фото удалено из каталога. Не удалось удалить файл из хранилища.');
    });
  }
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (editorId || lock.current) return;
      const files = Array.from(e.clipboardData?.files || []).filter(f => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); void upload(files); }
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  });

  async function download(orderId: string) {
    const response = await fetch(`${API}/orders/${orderId}/zip`);
    if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Ошибка выгрузки'); }
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a'); a.href = url; a.download = `refocus-frames-${orderId.slice(0, 8)}.zip`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function recognizeNewPhotos() {
    const rows = catalog.filter(row => !row.recognized_by && !row.colors?.length);
    await run('Распознаю цвета', async () => {
      stopRecognition.current = false; setRecognitionBatch(true);
      let completed = 0, cost = 0;
      const failures: string[] = [];
      try {
        for (let i = 0; i < rows.length && !stopRecognition.current; i += 3) {
          setBusy(`Распознано ${completed} из ${rows.length}`);
          const data = await jsonRequest('/recognize', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ catalogIds: rows.slice(i, i + 3).map(row => row.id), engine: FRAME_RECOGNITION_MODEL }) });
          for (const result of data.results || []) {
            if (result.ok && !result.skipped) { completed++; cost += result.recognition?.usage?.kgs || 0; }
            else if (!result.ok) failures.push(result.error);
          }
          await loadCatalog();
        }
        setNotice(`Распознано: ${completed}. Стоимость успешных запросов: ≈ ${money(cost)} сом.${failures.length ? ` Ошибок: ${failures.length}.` : ''}`);
        if (failures.length) setError(failures[0]);
      } finally { setRecognitionBatch(false); }
    });
  }
  async function exportDraft() {
    await run('Готовлю картинки', async () => {
      const saved = readonly ? order! : await persist();
      await download(saved.id); setNotice('Картинки скачаны. После отправки поставщику отметьте заказ отправленным.');
    });
  }
  async function selectOrder(selected: ManualOrder | null) {
    await run('Открываю заказ', async () => {
      if (!readonly && dirty) await persist();
      setOrder(selected); setId(selected?.id || crypto.randomUUID());
      setDraft(clone(selected?.manual_draft || { target: 500, models: [] }));
      setTargetText(String(selected?.manual_draft.target || 500)); setHistory(false); setFilter('all');
    });
  }
  const visible = catalog.filter(row => {
    const m = modelsById.get(row.id);
    return (filter !== 'selected' || m && modelQuantity(m) > 0) && (filter !== 'new' || !row.colors?.length)
      && (!search || `${m?.supplierModel || row.supplier_model || ''} ${m?.typeCode ? MANUAL_FRAME_TYPES[m.typeCode] : ''}`.toLowerCase().includes(search.toLowerCase()));
  });
  const editorRow = catalog.find(row => row.id === editorId);
  const editorModel = editorRow && (modelsById.get(editorRow.id) || modelFromCatalog(editorRow));
  const sections = selectedModels.reduce<Record<string, number>>((acc, m) => {
    const key = `${m.typeCode ? MANUAL_FRAME_TYPES[m.typeCode] : 'Без типа'} / ${m.gender ? MANUAL_FRAME_GENDERS[m.gender] : 'Без пола'}`;
    acc[key] = (acc[key] || 0) + modelQuantity(m); return acc;
  }, {});

  return <main className={styles.page} onDragOver={e => e.preventDefault()} onDrop={e => {
    e.preventDefault(); if (!editorId) void upload(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')));
  }}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>ЗАКУПКИ</p><h1>Оправы</h1></div>
      <div className={styles.actions}>
        <button disabled={!ready || !!busy} onClick={() => setHistory(!history)}>Заказы</button>
        <button disabled={!ready || !!busy} onClick={() => void selectOrder(null)}><Plus size={17} /> Новый заказ</button>
        <button className={styles.primary} disabled={!!busy} onClick={() => fileInput.current?.click()}><Upload size={17} /> Добавить фото</button>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={e => { void upload(Array.from(e.target.files || [])); e.target.value = ''; }} />
      </div>
    </header>
    {error && <div className={styles.error} role="alert">{error}<button aria-label="Скрыть ошибку" onClick={() => setError('')}><X size={16} /></button></div>}
    {notice && <div className={styles.notice} role="status">{notice}</div>}
    {recovery && <div className={styles.error}>Есть несохранённая копия из другой версии заказа.
      <button disabled={!!busy} onClick={() => { setOrder(null); setId(crypto.randomUUID()); setDraft(recovery.draft); setTargetText(String(recovery.draft.target)); setRecovery(null); }}>Восстановить отдельным черновиком</button>
      <button onClick={() => { const blob = new Blob([JSON.stringify(recovery, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'frame-draft-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); setRecovery(null); }}>Скачать копию и продолжить</button>
    </div>}
    {history && <section className={styles.history}>
      {orders.length === 0 && <p>Заказов пока нет.</p>}
      {orders.map(o => <button key={o.id} disabled={!!busy} onClick={() => void selectOrder(o)}>
        <span>{new Date(o.created_at).toLocaleDateString('ru-RU')} · {o.id.slice(0, 6)}</span>
        <span>{o.status === 'draft' ? 'Черновик' : o.status === 'sent' ? 'Отправлен' : o.status === 'received' ? 'Получен' : 'Отменён'} · {o.total_qty} шт.</span>
      </button>)}
    </section>}
    <section className={styles.summary}>
      <div className={styles.goal}><label htmlFor="purchase-target">Цель заказа</label><div>
        <input id="purchase-target" type="number" min={1} max={100000} value={targetText} disabled={readonly || !!busy || !ready}
          onChange={e => { setTargetText(e.target.value); const n = Number(e.target.value); if (Number.isInteger(n) && n > 0 && n <= 100000) setDraft(prev => ({ ...prev, target: n })); }}
          /> <span>шт.</span>
      </div></div>
      <div className={styles.progressBlock}>
        <div className={styles.progressTitle}><strong>{quantity} <small>/ {draft.target}</small></strong><span>{quantity > draft.target ? `Сверх цели: ${quantity - draft.target}` : `Осталось ${draft.target - quantity}`}</span></div>
        <div className={styles.progress}><i style={{ width: `${Math.min(100, quantity / draft.target * 100)}%` }} /></div>
        <span className={styles.muted}>{selectedModels.length} моделей · {readonly ? 'Заказ зафиксирован' : dirty ? 'Есть изменения' : 'Сохранено в базе'}</span>
      </div>
      <div className={styles.actions}>
        {!readonly && <button disabled={!!busy || !ready} onClick={() => void run('Сохраняю', async () => { await persist(); setNotice('Черновик сохранён.'); })}><Check size={17} /> Сохранить</button>}
        <button className={styles.primary} disabled={!!busy || !quantity || !ready} onClick={() => void exportDraft()}><Download size={17} /> Скачать картинки</button>
      </div>
    </section>
    <div className={styles.subbar}>
      <span>{busy ? <><Loader2 size={14} className={styles.spin} /> {busy}…</> : 'Alt + Print Screen с watcher · Ctrl + V · перетащите фото'}</span>
      {!readonly && quantity > 0 && <button disabled={!!busy} onClick={() => {
        if (window.confirm('Вы уже отправили эти картинки поставщику? Заказ будет зафиксирован.')) void run('Фиксирую заказ', async () => { await persist(draftRef.current, true); setNotice('Заказ отмечен отправленным.'); });
      }}>Отметить отправленным</button>}
    </div>
    <PurchaseMix key={id} target={Number(targetText)} models={draft.models} settings={draft.purchaseMix}
      readonly={readonly} disabled={readonly || !!busy || !ready || !!recovery}
      onChange={purchaseMix => setDraft(prev => {
        const { purchaseMix: previousMix, ...rest } = prev;
        return { ...rest, ...(purchaseMix ? { purchaseMix } : {}),
          models: prev.models.map(model => isModelExcludedFromPurchase(model, purchaseMix)
            ? { ...model, colors: model.colors.map(color => ({ ...color, qty: 0 })) } : model) };
      })} />
    <div className={styles.toolbar}>
      <div className={styles.tabs}>{([['all', `Все фото · ${catalog.length}`], ['selected', `В заказе · ${selectedModels.length}`], ['new', 'Без цветов']] as const).map(([key, label]) =>
        <button key={key} className={filter === key ? styles.activeTab : ''} onClick={() => setFilter(key)}>{label}</button>)}</div>
      <input aria-label="Поиск модели" placeholder="Найти модель" value={search} onChange={e => setSearch(e.target.value)} />
    </div>
    <div className={styles.aiLine}><Sparkles size={15} /> GPT-6.1 Sol · ~0,90 сом/фото <span title="Один проверочный запрос: $0.01029 при расчётном курсе 87,45 сом/$. Цена зависит от фото и ответа.">· ориентир по тесту; фактическая цена в карточке</span>
      {recognitionBatch ? <button onClick={() => { stopRecognition.current = true; setNotice('Останавливаю после текущих трёх фото.'); }}>Остановить</button> :
        catalog.some(row => !row.recognized_by && !row.colors?.length) && <button disabled={!!busy || !ready} onClick={() => void recognizeNewPhotos()} title={`Ориентир: ≈ ${money(catalog.filter(row => !row.recognized_by && !row.colors?.length).length * .9)} сом за все новые фото; фактическая стоимость зависит от ответа.`}>
          Распознать новые · {catalog.filter(row => !row.recognized_by && !row.colors?.length).length}
        </button>}
    </div>
    {!ready && !error && <div className={styles.empty}>Загружаю каталог…</div>}
    {ready && !visible.length && <div className={styles.empty}>{catalog.length ? 'Нет фотографий по этому фильтру.' : 'Добавьте первые фотографии поставщика.'}</div>}
    <div className={styles.grid}>
      {visible.map(row => {
        const model = modelsById.get(row.id);
        const qty = model ? modelQuantity(model) : 0;
        return <div key={row.id} className={styles.cardWrap}><button className={`${styles.card} ${qty ? styles.chosen : ''}`} disabled={!!busy || !ready} onClick={() => openCard(row)}>
          <div className={styles.thumbnail}><FramePhoto row={row} colors={model?.colors || []} />{qty > 0 && <span className={styles.quantity}>{qty} шт.</span>}</div>
          <div className={styles.cardCaption}><strong>{model?.supplierModel || row.supplier_model || 'Без артикула'}</strong>
            <span>{model?.typeCode ? `${MANUAL_FRAME_TYPES[model.typeCode]} · ${model.gender ? MANUAL_FRAME_GENDERS[model.gender] : 'Выберите пол'}` : 'Выбрать тип и количество'}</span>
          </div>
        </button><button className={styles.deletePhoto} disabled={!!busy || !ready}
          title="Удалить фото" aria-label={`Удалить фото ${model?.supplierModel || row.supplier_model || ''}`}
          onClick={() => void deletePhoto(row)}><Trash2 size={17} /></button></div>;
      })}
    </div>
    {selectedModels.length > 0 && <details className={styles.breakdown}><summary>Состав заказа · {quantity} шт.</summary>{Object.entries(sections).map(([label, qty]) => <div key={label}><span>{label}</span><strong>{qty}</strong></div>)}</details>}
    {editorRow && editorModel && <FrameEditor key={editorRow.id} row={editorRow} model={editorModel} busy={busy} readonly={readonly}
      draft={draft} target={Number(targetText)}
      excluded={isModelExcludedFromPurchase(editorModel, draft.purchaseMix)}
      onDismiss={() => setEditorId(null)}
      error={error} onChange={changeModel} onClose={() => { if (readonly) setEditorId(null); else void saveCard(false); }}
      onNext={() => void saveCard(true)} onRecognize={async () => {
        let recognized: Recognition | null = null;
        await run('Распознаю цвета', async () => {
          const data = await jsonRequest('/recognize', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ catalogIds: [editorRow.id], engine: FRAME_RECOGNITION_MODEL, forceRerun: true }) });
          const result = data.results?.find((r: { id: string }) => r.id === editorRow.id);
          if (!result?.ok || !result.recognition) throw new Error(result?.error || 'Распознавание не вернуло результат');
          recognized = result.recognition;
          const usage = result.recognition.usage;
          if (usage) setNotice(`Распознавание: ≈ ${money(usage.kgs)} сом ($${usage.usd.toFixed(4)}).`);
          await loadCatalog();
        });
        return recognized;
      }} notice={notice} />}
  </main>;
}

function FramePhoto({ row, colors, editable = false, addMode = false, onMove, onAdd, selected = -1, onSelect }: {
  row: Catalog; colors: ManualColor[]; editable?: boolean; addMode?: boolean; selected?: number;
  onMove?: (index: number, point: [number, number]) => void; onAdd?: (point: [number, number]) => void; onSelect?: (index: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const width = row.width_px || 1000, height = row.height_px || 1000;
  function point(e: React.PointerEvent): [number, number] {
    const rect = svgRef.current!.getBoundingClientRect();
    return [Math.max(.02, Math.min(.98, (e.clientX - rect.left) / rect.width)), Math.max(.02, Math.min(.98, (e.clientY - rect.top) / rect.height))];
  }
  return <div className={styles.photo} style={{ aspectRatio: `${width}/${height}`, '--photo-ratio': width / height } as React.CSSProperties}>
    {row.signed_url ? <img src={row.signed_url} alt={row.supplier_model || 'Фото оправ поставщика'} draggable={false} loading={editable ? 'eager' : 'lazy'} /> : <span>Фото временно недоступно</span>}
    <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className={addMode ? styles.crosshair : ''}
      style={{ pointerEvents: editable ? 'auto' : 'none', touchAction: editable ? 'none' : 'auto' }}
      onPointerDown={e => { if (editable && addMode && e.target === e.currentTarget) onAdd?.(point(e)); }}
      onPointerMove={e => { if (drag.current !== null) onMove?.(drag.current, point(e)); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {colors.map((c, index) => {
        if (!editable && c.qty <= 0) return null;
        const [x, y] = colorPoint(c);
        const font = frameMarkFontSize(width, height, c.bbox, c.qty);
        return <g key={index} style={{ cursor: editable ? 'grab' : undefined }}
          onPointerDown={e => { if (!editable || addMode) return; e.preventDefault(); e.stopPropagation(); drag.current = index; onSelect?.(index); e.currentTarget.setPointerCapture(e.pointerId); }}
          role={editable ? 'button' : undefined} tabIndex={editable ? 0 : undefined} aria-label={`${c.label}: ${c.qty}. Стрелки перемещают цифру.`}
          onKeyDown={e => { if (!editable || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return; e.preventDefault(); onMove?.(index, [Math.max(.02, Math.min(.98, x + (e.key === 'ArrowLeft' ? -.005 : e.key === 'ArrowRight' ? .005 : 0))), Math.max(.02, Math.min(.98, y + (e.key === 'ArrowUp' ? -.005 : e.key === 'ArrowDown' ? .005 : 0)))]); }}>
          {editable && <circle cx={x * width} cy={y * height} r={font * .6} fill={selected === index ? '#dbeafe' : '#ffffffbb'} stroke={selected === index ? '#2563eb' : '#94a3b8'} strokeWidth={2} />}
          <text x={x * width} y={y * height} fontSize={c.qty ? font : font * .5} fontFamily="Arial Black, Arial, sans-serif" fontWeight={900}
            fill={c.qty ? '#FF1A1A' : '#64748b'} stroke="white" strokeWidth={c.qty ? Math.max(2, Math.round(font * .12)) : 1}
            paintOrder="stroke" textAnchor="middle" dominantBaseline="middle">{c.qty || c.label}</text>
        </g>;
      })}
    </svg>
  </div>;
}

function FrameEditor({ row, model, draft, target, busy, readonly, excluded, error, notice, onChange, onClose, onDismiss, onNext, onRecognize }: {
  row: Catalog; model: ManualModel; busy: string; readonly: boolean; excluded: boolean; error: string; notice: string;
  draft: ManualDraft; target: number;
  onChange: (m: ManualModel) => void; onClose: () => void; onDismiss: () => void; onNext: () => void; onRecognize: () => Promise<Recognition | null>;
}) {
  const [quantityText, setQuantityText] = useState(String(modelQuantity(model)));
  const [addMode, setAddMode] = useState(false);
  const [selected, setSelected] = useState(-1);
  const [candidate, setCandidate] = useState<Recognition | null>(null);
  const [localError, setLocalError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  const total = modelQuantity(model);
  function readyToSave() {
    if (excluded && total > 0) { setLocalError('Этот вид выключен в плане. Уберите количество или включите вид.'); return false; }
    const value = Number(quantityText);
    if (!Number.isInteger(value) || value < 0 || value > 10000 || value !== total) {
      setLocalError('Проверьте количество и распределите его по цветам.'); return false;
    }
    return true;
  }
  function updateColors(colors: ManualColor[]) { onChange({ ...model, colors }); setQuantityText(String(colors.reduce((s, c) => s + c.qty, 0))); }
  function distribute(quantity = Number(quantityText)) {
    if (excluded && quantity > 0) { setLocalError('Сначала включите этот вид в плане.'); return; }
    try { setLocalError(''); updateColors(distributeEvenly(model.colors, quantity)); }
    catch (e) { setLocalError((e as Error).message); }
  }
  function applyRecognition(result: Recognition) {
    const labels = new Set(result.colors.map(c => c.label));
    if (model.colors.some(c => c.qty > 0 && !labels.has(c.label))) { setLocalError('В новом распознавании нет некоторых заказанных цветов. Количества сохранены; поправьте точки вручную.'); return; }
    onChange({ ...model, supplierModel: model.supplierModel || result.supplier_model || '',
      colors: result.colors.map(c => { const old = model.colors.find(x => x.label === c.label); return { ...c, qty: old?.qty || 0, enabled: old?.enabled ?? total === 0 }; }) });
    setCandidate(null); setLocalError('');
  }
  return <div className={styles.backdrop}>
    <div ref={dialog} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="frame-editor-title" tabIndex={-1}
      onKeyDown={e => {
        if (e.key === 'Escape' && !busy) onDismiss();
        if (e.key === 'Tab') { const nodes = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]');
          if (nodes?.length) { const first = nodes[0], last = nodes[nodes.length - 1]; if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } }
      }}>
      <header className={styles.dialogHeader}><div><p className={styles.eyebrow}>КАРТОЧКА МОДЕЛИ</p><h2 id="frame-editor-title">{model.supplierModel || 'Новая модель'}</h2></div><button aria-label="Свернуть карточку" title="Изменения останутся в черновике на устройстве" disabled={!!busy} onClick={onDismiss}><X size={22} /></button></header>
      {(error || localError) && <div className={styles.error} role="alert">{localError || error}</div>}
      {notice && <div className={styles.notice} role="status">{notice}</div>}
      <div className={styles.editorBody}>
        <div className={styles.editorPhoto}>
          <FramePhoto row={row} colors={model.colors} editable={!readonly && !busy} addMode={addMode} selected={selected} onSelect={setSelected}
            onMove={(index, point) => onChange({ ...model, colors: model.colors.map((c, i) => i === index ? { ...c, click_point: point } : c) })}
            onAdd={point => {
              let n = model.colors.length + 1; while (model.colors.some(c => c.label === `C${n}`)) n++;
              const left = Math.max(0, point[0] - .12), top = Math.max(0, point[1] - .04);
              onChange({ ...model, colors: [...model.colors, { label: `C${n}`, name_ru: '', enabled: true, qty: 0,
                click_point: point, bbox: [left, top, Math.min(.24, 1 - left), Math.min(.08, 1 - top)] }] });
              setSelected(model.colors.length); setAddMode(false);
            }} />
          {!readonly && <p className={styles.muted}>{addMode ? 'Нажмите на оправу, чтобы добавить цвет.' : 'Перетащите цифру, если нужно поправить её место.'}</p>}
        </div>
        <fieldset className={styles.editorFields} disabled={readonly || !!busy}>
          <label>Артикул<input value={model.supplierModel} maxLength={100} placeholder="С фото поставщика" onChange={e => onChange({ ...model, supplierModel: e.target.value })} /></label>
          <div className={styles.twoFields}>
            <label>Тип<select value={model.typeCode || ''} onChange={e => onChange({ ...model, typeCode: e.target.value as ManualModel['typeCode'] || null })}><option value="">Выберите</option>{Object.entries(MANUAL_FRAME_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>Пол<select value={model.gender || ''} onChange={e => onChange({ ...model, gender: e.target.value as ManualModel['gender'] || null })}><option value="">Выберите</option>{Object.entries(MANUAL_FRAME_GENDERS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          </div>
          <ModelPurchaseProgress target={target} draft={draft} model={model} />
          {excluded && <div className={styles.review}>Этот вид выключен в плане по видам. Чтобы заказывать его, сначала верните вид в план.
            {total > 0 && <button type="button" onClick={() => { updateColors(model.colors.map(color => ({ ...color, qty: 0 }))); setLocalError(''); }}>Убрать количество</button>}</div>}
          <div className={styles.modelTotal}><label>Заказать эту модель<input type="number" min={0} max={10000} value={quantityText} disabled={excluded || !model.colors.some(c => c.enabled) || readonly || !!busy}
            onChange={e => { const v = e.target.value; setQuantityText(v); const n = Number(v); if (v !== '' && Number.isInteger(n) && n >= 0 && n <= 10000 && model.colors.some(c => c.enabled)) { onChange({ ...model, colors: distributeEvenly(model.colors, n) }); setLocalError(''); } }}
            onBlur={() => { if (Number(quantityText) !== total) distribute(); }} /></label><span>шт.</span></div>
          <div className={styles.colorHeading}><strong>Цвета · {model.colors.length}</strong><button type="button" onClick={() => distribute()}>Распределить поровну</button></div>
          {model.colors.length === 0 && <div className={styles.emptyColors}>Распознайте цвета или отметьте их на фото.</div>}
          <div className={styles.colors}>
            {model.colors.map((c, i) => <div key={i} className={`${styles.colorRow} ${selected === i ? styles.activeColor : ''}`} onFocus={() => setSelected(i)}>
              <input type="checkbox" aria-label={`Заказывать ${c.label}`} checked={c.enabled} onChange={e => {
                const colors = model.colors.map((color, index) => index === i ? { ...color, enabled: e.target.checked, qty: e.target.checked ? color.qty : 0 } : color);
                updateColors(distributeEvenly(colors, colors.some(color => color.enabled) ? total : 0));
              }} />
              <input aria-label={`Код цвета ${i + 1}`} value={c.label} maxLength={64} onChange={e => onChange({ ...model, colors: model.colors.map((color, index) => index === i ? { ...color, label: e.target.value } : color) })} />
              <input aria-label={`Название цвета ${i + 1}`} value={c.name_ru} maxLength={100} placeholder="Цвет" onChange={e => onChange({ ...model, colors: model.colors.map((color, index) => index === i ? { ...color, name_ru: e.target.value } : color) })} />
              <input aria-label={`Количество ${c.label}`} type="number" min={0} max={10000} disabled={excluded || !c.enabled || readonly || !!busy} value={c.qty} onChange={e => { const qty = Number(e.target.value); if (Number.isInteger(qty) && qty >= 0 && qty <= 10000) updateColors(model.colors.map((color, index) => index === i ? { ...color, qty } : color)); }} />
              <button type="button" aria-label={`Убрать цвет ${c.label}`} onClick={() => { if (!c.qty || window.confirm(`Убрать ${c.label} и ${c.qty} шт. из заказа?`)) updateColors(model.colors.filter((_, index) => index !== i)); }}><X size={14} /></button>
            </div>)}
          </div>
          <div className={styles.actions}><button type="button" onClick={() => setAddMode(!addMode)} disabled={model.colors.length >= 30}>{addMode ? 'Отменить добавление' : <><Plus size={16} /> Цвет вручную</>}</button>
            <button type="button" onClick={async () => { const result = await onRecognize(); if (result) { if (!model.colors.length) applyRecognition(result); else setCandidate(result); } }}><Sparkles size={16} /> {model.colors.length ? 'Проверить цвета' : 'Распознать цвета'}</button></div>
          <p className={styles.muted}>GPT-6.1 Sol · ~0,90 сом/фото по тесту. Тариф: $2 вход / $10 выход за 1 млн токенов.
            {row.recognition_usage && <> Последний запрос: ≈ {money(row.recognition_usage.kgs)} сом.</>}</p>
          {(row.needs_review || candidate?.needs_review) && <p className={styles.review}>Проверьте цвета и точки на фото.{candidate?.notes || row.notes ? ` ${candidate?.notes || row.notes}` : ''}</p>}
          {candidate && <div className={styles.recognitionResult}><strong>Найдено: {candidate.colors.map(c => c.label).join(', ') || 'нет цветов'}</strong>
            <p>Применить новые точки? Количества сохранятся по кодам цветов.</p><div className={styles.actions}><button type="button" onClick={() => applyRecognition(candidate)}>Применить разметку</button><button type="button" onClick={() => setCandidate(null)}>Оставить текущую</button></div></div>}
          <div className={styles.totalLine}><span>В заказе</span><strong>{total} шт.</strong></div>
        </fieldset>
      </div>
      <footer className={styles.editorFooter}><span className={styles.muted}>{busy ? `${busy}…` : readonly ? 'Заказ зафиксирован' : 'Черновик сохраняется в базу по кнопке'}</span><div className={styles.actions}>
        <button disabled={!!busy} onClick={() => { if (readonly || readyToSave()) onClose(); }}>{readonly ? 'Закрыть' : 'Сохранить и закрыть'}</button>
        {!readonly && <button className={styles.primary} disabled={!!busy} onClick={() => { if (readyToSave()) onNext(); }}>Сохранить и дальше <ChevronRight size={18} /></button>}
      </div></footer>
    </div>
  </div>;
}
