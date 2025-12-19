'use client';

import { useEffect } from 'react';

/**
 * Гард для страниц аппарата: требует активную POS-смену.
 * Если sessionStorage.pos_session_id нет — редирект на /pos/login.
 */
export default function RequireShiftOpen() {
  useEffect(() => {
    try {
      const sid = typeof window !== 'undefined'
        ? sessionStorage.getItem('pos_session_id')
        : null;
      if (!sid) {
        const from = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.replace(`/pos/login?from=${from}`);
      }
    } catch {
      window.location.replace('/pos/login');
    }
  }, []);

  return null;
}
