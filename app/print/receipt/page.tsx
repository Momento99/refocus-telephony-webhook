'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import getSupabase from '@/lib/supabaseClient';

/* ---------- Настройки чека ---------- */
type ReceiptSettings = {
  branchName: string;
  branchAddress: string;
  branchPhone: string;
  logoText: string;
  showQr: boolean;
  footerText: string;
  lineWidth: number;
};
const RECEIPT_LS_KEY = 'refocus.integrations.printers.receipt.v1';
const DEFAULT_SETTINGS: ReceiptSettings = {
  branchName: 'Кант, ТЦ «Мээрим»',
  branchAddress: 'Кант, -1 этаж, отдел C08',
  branchPhone: '+996 555 000 000',
  logoText: 'REFOCUS',
  showQr: true,
  footerText: 'Спасибо, что выбрали Refocus! Диагностика — через 6 месяцев.',
  lineWidth: 30,
};
function loadSettings(): ReceiptSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(RECEIPT_LS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/* ---------- Типы ---------- */
type OrderItem = { title: string; price: number };
type OrderData = {
  client_name: string | null;
  client_phone: string | null;
  items: OrderItem[];
  total_amount: number;
  advance_amount: number;
  debt: number;
  status_url: string; // ВСЕГДА по числовому order_no
};

/* ---------- Демо ---------- */
function makeDemoOrder(orderId: number = 12345): OrderData {
  const items = [
    { title: 'Оправа TestBrand X1', price: 2480 },
    { title: 'Линзы BlueBlock AR', price: 1800 },
    { title: 'Работа мастера', price: 300 },
  ];
  const total = items.reduce((a, b) => a + b.price, 0);
  const advance = 1500;
  const debt = total - advance;
  return {
    client_name: 'Иванов И.',
    client_phone: '+996 555 111 222',
    items,
    total_amount: total,
    advance_amount: advance,
    debt,
    status_url: `https://refocus.kg/o/${orderId}`,
  };
}

/* ---------- Утилиты ---------- */
function formatMoney(v: number) {
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KGS', maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${v} сом`;
  }
}
function padRight(s: string, n: number) {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}
const looksLikeBarcode = (s: string) => /[A-Za-z]/.test(s);
const normalizeBarcode = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/* ---------- Рендер текста чека (БЕЗ строки "Заказ: ...") ---------- */
function buildReceiptText(s: ReceiptSettings, o: OrderData, dateStr: string) {
  const w = s.lineWidth;
  const lines: string[] = [];
  const center = (t: string) => {
    const len = Math.min(t.length, w);
    const pad = Math.max(0, Math.floor((w - len) / 2));
    return ' '.repeat(pad) + t.slice(0, w);
  };

  lines.push(center(s.logoText));
  lines.push(center(`Филиал: ${s.branchName}`));
  lines.push(center(s.branchAddress));
  lines.push(center(`Тел: ${s.branchPhone}`));
  if (dateStr) lines.push(center(`Дата: ${dateStr}`));
  lines.push('-'.repeat(w));

  lines.push(`Клиент: ${o.client_name || '-'}`);
  lines.push(`Тел: ${o.client_phone || '-'}`);
  lines.push('-'.repeat(w));

  for (const it of o.items) {
    const left = it.title;
    const right = formatMoney(it.price);
    const leftSpace = Math.max(1, w - right.length - 1);
    lines.push(padRight(left, leftSpace) + ' ' + right);
  }
  lines.push('-'.repeat(w));

  const addMoney = (label: string, val: number) => {
    const r = formatMoney(val);
    const left = `${label}:`;
    const leftSpace = Math.max(1, w - r.length - 1);
    lines.push(padRight(left, leftSpace) + ' ' + r);
  };
  addMoney('Итого', o.total_amount);
  addMoney('Аванс', o.advance_amount);
  addMoney('Остаток', o.debt);
  lines.push('-'.repeat(w));

  if (s.showQr) {
    lines.push(center('[ QR — статус заказа ]'));
    const chunkLen = w;
    for (let i = 0; i < o.status_url.length; i += chunkLen) {
      lines.push(o.status_url.slice(i, i + chunkLen));
    }
    lines.push('-'.repeat(w));
  }

  const footer = s.footerText.trim();
  if (footer) {
    const words = footer.split(/\s+/);
    let cur = '';
    for (const w1 of words) {
      if ((cur + ' ' + w1).trim().length > w) {
        lines.push(cur.trim());
        cur = w1;
      } else {
        cur = (cur + ' ' + w1).trim();
      }
    }
    if (cur) lines.push(cur);
  }

  return lines.join('\n');
}

/* ---------- Резолв ЧИСЛОВОГО order_id по баркоду (универсальный) ---------- */
async function resolveOrderIdByBarcode(supabase: any, rawParam: string): Promise<number> {
  const raw = rawParam.toUpperCase();
  const norm = normalizeBarcode(rawParam);

  // 1) barcode → frame_id (uuid)
  const { data: bc, error: e1 } = await supabase
    .from('frame_barcodes')
    .select('frame_id, barcode')
    .or(`barcode.eq.${raw},barcode.eq.${norm}`)
    .maybeSingle();
  if (e1) throw e1;
  if (!bc?.frame_id) throw new Error(`Штрихкод ${raw} не найден в frame_barcodes`);
  const frameUuid: string = bc.frame_id;

  // helper: получить order_id из order_items
  const getOrderFromItems = async (productId: number | string) => {
    const { data: oi, error } = await supabase
      .from('order_items')
      .select('order_id')
      .eq('item_type', 'frame')
      .eq('product_id', productId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (oi?.order_id && Number.isFinite(Number(oi.order_id))) {
      return Number(oi.order_id);
    }
    return null;
  };

  // helper: через view
  const getOrderFromItemsView = async (productId: number | string) => {
    const { data: oi, error } = await supabase
      .from('order_items_view')
      .select('order_id')
      .eq('item_type', 'frame')
      .eq('product_id', productId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (oi?.order_id && Number.isFinite(Number(oi.order_id))) {
      return Number(oi.order_id);
    }
    return null;
  };

  // 2) ПРЯМО: product_id = frameUuid (если так хранили)
  let orderId = await getOrderFromItems(frameUuid);
  if (orderId) return orderId;

  // 3) frames.uuid → frames.id (число)
  const { data: fr } = await supabase
    .from('frames')
    .select('id')
    .eq('uuid', frameUuid)
    .maybeSingle();
  if (fr?.id !== undefined && fr?.id !== null) {
    orderId = await getOrderFromItems(fr.id);
    if (orderId) return orderId;
    orderId = await getOrderFromItemsView(fr.id);
    if (orderId) return orderId;
  }

  // 4) v_frame_labels.id (число)
  const { data: lbl } = await supabase
    .from('v_frame_labels')
    .select('id')
    .eq('frame_id', frameUuid)
    .maybeSingle();
  if (lbl?.id !== undefined && lbl?.id !== null) {
    orderId = await getOrderFromItems(lbl.id);
    if (orderId) return orderId;
    orderId = await getOrderFromItemsView(lbl.id);
    if (orderId) return orderId;
  }

  // 5) Последняя попытка через view c UUID
  orderId = await getOrderFromItemsView(frameUuid);
  if (orderId) return orderId;

  throw new Error('Не удалось определить числовой ID заказа по этому штрихкоду');
}

/* ---------- Получение заказа по ЧИСЛОВОМУ order_no ---------- */
async function fetchOrderRecord(supabase: any, orderNo: number) {
  if (typeof orderNo !== 'number' || !Number.isFinite(orderNo)) {
    throw new Error(`Внутренняя ошибка: orderNo не число (${String(orderNo)})`);
  }
  // у тебя ключ во view — order_no
  const { data, error } = await supabase
    .from('orders_view')
    .select('*')
    .eq('order_no', orderNo)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/* ---------- Страница ---------- */
export default function PrintReceiptPage() {
  const params = useSearchParams();
  const param = (params.get('order') || '').trim();

  const [settings, setSettings] = useState<ReceiptSettings>(DEFAULT_SETTINGS);
  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dateStr, setDateStr] = useState<string>('');

  useEffect(() => {
    setSettings(loadSettings());
    setDateStr(new Date().toLocaleString('ru-RU'));
  }, []);

  useEffect(() => {
    let mounted = true;

    async function run() {
      if (!param) {
        setOrder(makeDemoOrder());
        return;
      }
      setLoading(true);
      setErr(null);

      try {
        const supabase = getSupabase();

        let orderNo: number | null = null;

        if (!looksLikeBarcode(param)) {
          orderNo = Number(param);
          if (!Number.isFinite(orderNo)) {
            throw new Error('Параметр order не число и не штрихкод');
          }
        } else {
          orderNo = await resolveOrderIdByBarcode(supabase, param);
        }

        if (typeof orderNo !== 'number' || !Number.isFinite(orderNo)) {
          throw new Error(`Внутренняя ошибка: получили нечисловой order_no (${String(orderNo)})`);
        }

        const ov: any = await fetchOrderRecord(supabase, orderNo);
        if (!ov) throw new Error('Заказ не найден в orders_view');

        // поля из твоего view (см. скрин): customer_name, customer_phone, total_amount, paid_amount, debt
        const clientName = ov.customer_name || ov.client_full_name || ov.full_name || null;
        const clientPhone = ov.customer_phone || ov.client_phone || ov.phone || null;

        const total = Number(ov.total_amount ?? ov.total ?? 0);
        const paid = Number(ov.paid_amount ?? ov.paid ?? 0);
        const debt = Number(ov.debt ?? Math.max(0, total - paid));

        // позиции по order_items.order_id = order_no
        let items: OrderItem[] = [];
        const { data: itemsView } = await supabase
          .from('order_items_view')
          .select('title, price')
          .eq('order_id', orderNo);

        if (itemsView && itemsView.length) {
          items = itemsView.map((x: any) => ({
            title: String(x.title ?? 'Позиция'),
            price: Number(x.price ?? 0),
          }));
        } else {
          const { data: itemsTbl } = await supabase
            .from('order_items')
            .select('title, name, price, order_id')
            .eq('order_id', orderNo);

          if (itemsTbl && itemsTbl.length) {
            items = itemsTbl.map((x: any) => ({
              title: String(x.title ?? x.name ?? 'Позиция'),
              price: Number(x.price ?? 0),
            }));
          }
        }
        if (!items.length) items = [{ title: 'Состав заказа', price: total }];

        const o: OrderData = {
          client_name: clientName,
          client_phone: clientPhone,
          items,
          total_amount: total,
          advance_amount: paid,
          debt,
          status_url: `https://refocus.kg/o/${orderNo}`, // ТОЛЬКО число
        };

        if (mounted) setOrder(o);
      } catch (e: any) {
        if (mounted) {
          setErr((e?.message || 'Ошибка запроса') + '. Показан демо-чек.');
          setOrder(makeDemoOrder());
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    run();
    return () => { mounted = false; };
  }, [param]);

  const receiptText = useMemo(() => {
    const o = order || makeDemoOrder();
    return buildReceiptText(settings, o, dateStr);
  }, [settings, order, dateStr]);

  function handlePrint() {
    const w = window.open('', '_blank', 'width=480,height=800');
    if (!w) return;
    const css = `
      <style>
        @page { size: 80mm auto; margin: 5mm; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
        pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.3; }
      </style>
    `;
    w.document.write(`<html><head><title>Чек</title>${css}</head><body><pre>${receiptText}</pre></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Печать чека</h1>
      <p className="text-slate-600 mb-4">Источник данных: параметр {param ? param : '—'}.</p>

      {loading ? (
        <div className="text-slate-600">Загружаю заказ из базы…</div>
      ) : err ? (
        <div className="text-rose-600 text-sm mb-3">{err}</div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.3]">
{receiptText}
        </pre>
      </div>

      <div className="mt-4 flex gap-3">
        <button
          onClick={handlePrint}
          className="inline-flex items-center rounded-xl px-4 py-2 bg-blue-600 text-white text-sm hover:bg-blue-700 transition"
        >
          Печать
        </button>
        <button
          onClick={() => navigator.clipboard?.writeText(receiptText)}
          className="inline-flex items-center rounded-xl px-4 py-2 bg-white border border-slate-300 text-sm hover:bg-slate-50 transition"
        >
          Копировать текст
        </button>
      </div>

      <div className="mt-6 text-xs text-slate-500">
        Чек без строки «Заказ». Ссылка в QR всегда по <b>числовому ID</b>, даже если входной параметр был вида <i>RF-…</i>.
      </div>
    </div>
  );
}
