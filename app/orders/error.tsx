'use client';
import { useEffect } from 'react';

export default function OrdersError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Orders error:', error);
  }, [error]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Ошибка на странице заказов</div>
      <div style={{ color: '#475569', marginBottom: 12 }}>{error?.message}</div>
      <button onClick={reset} style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8 }}>
        Перезагрузить раздел
      </button>
    </div>
  );
}
