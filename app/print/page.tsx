'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const EXAMPLES = [
  { label: 'Демо чек', href: '/print/receipt' },
  { label: 'Чек по ID = 2', href: '/print/receipt?order=2' },
  { label: 'Чек по штрихкоду (пример)', href: '/print/receipt?order=RF25KT100010' },
];

export default function PrintHub() {
  const [order, setOrder] = useState('');

  useEffect(() => {
    const v = localStorage.getItem('print.lastOrder') || '';
    setOrder(v);
  }, []);
  useEffect(() => {
    localStorage.setItem('print.lastOrder', order.trim());
  }, [order]);

  function openReceipt() {
    const q = order.trim();
    const url = q ? `/print/receipt?order=${encodeURIComponent(q)}` : '/print/receipt';
    window.open(url, '_blank', 'noopener,noreferrer,width=480,height=800');
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight mb-2">Печать</h1>
      <p className="text-slate-600 mb-6">
        Введите <span className="font-mono">ID</span> заказа или штрихкод вида <span className="font-mono">RF…</span>.
        В чеке строки «Заказ: …» нет. QR ведёт на ссылку по числовому ID.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-white p-4">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Заказ (ID или штрихкод)
          </label>
          <div className="flex gap-3">
            <input
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              placeholder="например: 12 или RF25KT100010"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={openReceipt}
              className="whitespace-nowrap rounded-xl bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 transition"
            >
              Чек →
            </button>
          </div>

          <div className="mt-4 text-sm text-slate-600">
            Примеры:
            <ul className="mt-2 space-y-1">
              {EXAMPLES.map((ex) => (
                <li key={ex.href}>
                  <Link href={ex.href} target="_blank" className="text-blue-600 hover:underline">
                    {ex.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="font-semibold mb-1">Чек</div>
            <div className="text-sm text-slate-600 mb-3">
              Печать клиентского чека по ID или штрихкоду оправы.
            </div>
            <button
              onClick={openReceipt}
              className="rounded-xl bg-slate-900 px-3 py-2 text-white hover:bg-black transition"
            >
              Открыть чек
            </button>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 opacity-60">
            <div className="font-semibold mb-1">Рецепт (в футляр)</div>
            <div className="text-sm text-slate-600 mb-3">Заглушка. Подключим позже.</div>
            <button className="rounded-xl bg-slate-200 px-3 py-2 text-slate-600 cursor-not-allowed">
              В разработке
            </button>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 opacity-60">
            <div className="font-semibold mb-1">Ярлыки/штрихкоды</div>
            <div className="text-sm text-slate-600 mb-3">Этикетки для оправ (Code128, 70×12 мм).</div>
            <button className="rounded-xl bg-slate-200 px-3 py-2 text-slate-600 cursor-not-allowed">
              В разработке
            </button>
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        <div className="font-medium mb-1">Подсказки</div>
        <ul className="list-disc pl-5 space-y-1">
          <li><span className="font-mono">/print/receipt?order=123</span> — печать чека по ID.</li>
          <li><span className="font-mono">/print/receipt?order=RF25KT100010</span> — печать по штрихкоду, мы найдём числовой ID и используем только его.</li>
          <li>В чеке нет строки «Заказ: …». QR ведёт на ссылку по числовому ID.</li>
        </ul>
      </div>
    </div>
  );
}
