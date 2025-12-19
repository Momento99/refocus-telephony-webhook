// components/PosZoom.tsx
'use client';
import { useEffect } from 'react';

export default function PosZoom() {
  useEffect(() => {
    if (!document.body.classList.contains('pos-mode')) return;
    const saved = Number(localStorage.getItem('posZoom') || '0.90'); // 90% по умолчанию
    (document.documentElement as any).style.zoom = String(saved);
  }, []);
  return null;
}
