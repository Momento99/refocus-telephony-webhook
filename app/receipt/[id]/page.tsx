'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import getSupabase from '@/lib/supabaseClient';

type Order = {
  id: number;
  order_no: string;
  created_at: string;
  total: number;
  prepaid: number;
  discount_amount: number;
  discount_type: string | null;
  discount_percent: number | null;
  branch_id: number;
  customer_id: number;
};

type Item = {
  item_type: 'frame' | 'lens';
  eye: 'NA' | 'OD' | 'OS';
  lens_type: string | null;
  price: number;
  qty: number;
};

type Payment = { method: 'cash' | 'pos' | 'transfer'; amount: number };
type Customer = { full_name: string | null; phone: string | null };
type Branch = { name: string | null };

const fmt = new Intl.NumberFormat('ru-RU');

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const orderId = Number(id);

  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);

  useEffect(() => {
    if (!orderId || Number.isNaN(orderId)) return;

    let alive = true;
    (async () => {
      const sb = getSupabase();

      const { data: o } = await sb
        .from('orders')
        .select(
          'id,order_no,created_at,total,prepaid,discount_amount,discount_type,discount_percent,branch_id,customer_id'
        )
        .eq('id', orderId)
        .single();

      if (!alive || !o) return;

      setOrder(o as any);

      const [it, pay, cu, br] = await Promise.all([
        sb
          .from('order_items')
          .select('item_type,eye,lens_type,price,qty')
          .eq('order_id', orderId)
          .order('item_type'),
        sb.from('payments').select('method,amount').eq('order_id', orderId),
        sb
          .from('customers')
          .select('full_name,phone')
          .eq('id', (o as any).customer_id)
          .single(),
        sb
          .from('branches')
          .select('name')
          .eq('id', (o as any).branch_id)
          .single(),
      ]);

      if (!alive) return;

      setItems(((it as any).data || []) as Item[]);
      setPayments(((pay as any).data || []) as Payment[]);
      setCustomer(((cu as any).data || null) as Customer);
      setBranch(((br as any).data || null) as Branch);

      // Браузерный запасной режим: ?print=1
      if ((sp.get('print') ?? '0') === '1') {
        setTimeout(() => {
          window.print();
          setTimeout(() => window.close(), 300);
        }, 150);
      }
    })();

    return () => {
      alive = false;
    };
  }, [orderId, sp]);

  const paid = useMemo(
    () => (payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0),
    [payments]
  );

  const due = useMemo(() => {
    if (!order) return 0;
    return Math.max(0, (order.total || 0) - paid);
  }, [order, paid]);

  if (!order) {
    return (
      <div className="print-area receipt receipt-page p-3 text-[12px]">
        Загрузка чека…
      </div>
    );
  }

  return (
    <div className="print-area receipt">
      <div className="receipt-page mx-auto px-2 py-2 text-[12px] leading-[1.25] text-black">
        <div className="text-center font-bold text-[14px]">
          {branch?.name || 'REFocus'}
        </div>
        <div className="text-center">Квитанция #{order.order_no}</div>
        <div className="text-center">
          {new Date(order.created_at).toLocaleString('ru-RU')}
        </div>

        <div className="my-2 border-t border-black" />

        <div>
          Клиент: {customer?.full_name || '—'}
          <br />
          Тел: {customer?.phone || '—'}
        </div>

        <div className="my-2 border-t border-dashed border-black" />

        <table className="w-full">
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td className="pr-2 align-top">
                  {it.item_type === 'frame'
                    ? 'Оправа'
                    : it.eye === 'OD'
                    ? 'Линза OD'
                    : 'Линза OS'}
                  {it.lens_type ? ` ${it.lens_type}` : ''}
                </td>
                <td className="text-right whitespace-nowrap">
                  {fmt.format(it.price)} с
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="my-2 border-t border-dashed border-black" />

        <div className="flex justify-between">
          <span>Скидка</span>
          <span>- {fmt.format(order.discount_amount || 0)} с</span>
        </div>

        <div className="flex justify-between font-bold">
          <span>Итого</span>
          <span>{fmt.format(order.total)} с</span>
        </div>

        {paid > 0 && (
          <>
            <div className="flex justify-between">
              <span>Аванс</span>
              <span>- {fmt.format(paid)} с</span>
            </div>
            <div className="flex justify-between font-bold">
              <span>К оплате</span>
              <span>{fmt.format(due)} с</span>
            </div>
          </>
        )}

        <div className="my-2 border-t border-black" />
        <div className="text-center">Спасибо за покупку!</div>
      </div>
    </div>
  );
}
