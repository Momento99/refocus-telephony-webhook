'use client';

import { useCallback, useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';

type SupplierQuoteLine = {
  order_item_id: number;
  order_no: string;
  branch_name: string | null;
  lens_code: string;
  lens_name: string;
  eye: string | null;
  sph: number | null;
  cyl: number | null;
  ax: number | null;
  qty: number;
};

const color: Record<string, string> = {
  CHAME_SCREEN_BLACK: 'чёрный',
  CHAME_SCREEN_BROWN: 'коричневый',
};

const signed = (value: number | null) => value == null ? '—' : (value > 0 ? '+' : '') + value;

export default function LensSupplierQuotes() {
  const [rows, setRows] = useState<SupplierQuoteLine[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const refresh = useCallback(async () => {
    setStatus('loading');
    const { data, error } = await getBrowserSupabase()
      .from('v_lens_supplier_quote_queue')
      .select('order_item_id,order_no,branch_name,lens_code,lens_name,eye,sph,cyl,ax,qty')
      .order('created_at', { ascending: true })
      .order('order_item_id');
    if (error) {
      setStatus('error');
      return;
    }
    setRows((data ?? []) as SupplierQuoteLine[]);
    setStatus('ready');
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Специальные линзы · запрос поставщику</h2>
        <button type="button" className="rounded border px-2 py-1 text-sm" onClick={() => void refresh()}>
          Обновить
        </button>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Сверьте с поставщиком параметры, цвет, стоимость и срок изготовления. Передайте подтверждённые параметры мастеру.
      </p>
      {status === 'loading' && <p className="mt-2 text-sm">Загрузка заказов…</p>}
      {status === 'error' && <p role="alert" className="mt-2 text-sm text-red-700">Очередь заказов временно недоступна.</p>}
      {status === 'ready' && rows.length === 0 && <p className="mt-2 text-sm">Открытых заказов на эти линзы нет.</p>}
      {status === 'ready' && rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr>{['Заказ', 'Филиал', 'Линза', 'Глаз', 'Сфера', 'Цилиндр', 'Ось', 'Шт.'].map(title => (
              <th key={title} className="whitespace-nowrap p-2">{title}</th>
            ))}</tr></thead>
            <tbody>{rows.map(row => (
              <tr key={row.order_item_id} className="border-t">
                <td className="whitespace-nowrap p-2 font-mono">{row.order_no}</td>
                <td className="p-2">{row.branch_name || '—'}</td>
                <td className="p-2">{row.lens_name}{color[row.lens_code] ? ' · ' + color[row.lens_code] : ''}</td>
                <td className="p-2">{row.eye ?? '—'}</td>
                <td className="p-2">{signed(row.sph)}</td>
                <td className="p-2">{signed(row.cyl)}</td>
                <td className="p-2">{row.ax ?? '—'}</td>
                <td className="p-2">{row.qty}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
