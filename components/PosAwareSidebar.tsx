'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';

export default function PosAwareSidebar({ role }: { role: any }) {
  const pathname = usePathname();
  const isPOS = pathname?.startsWith('/pos');

  // Управляем классом и шириной сайдбара на уровне документа
  useEffect(() => {
    if (isPOS) {
      document.body.classList.add('pos-mode');           // для CSS-подчистки
      document.documentElement.style.setProperty('--sidebar-width', '0rem');
    } else {
      document.body.classList.remove('pos-mode');
      document.documentElement.style.setProperty('--sidebar-width', '18rem');
    }
    // на случай навигации SPA: очищаем при размонтировании
    return () => {
      document.body.classList.remove('pos-mode');
      document.documentElement.style.setProperty('--sidebar-width', '18rem');
    };
  }, [isPOS]);

  if (isPOS) return null;     // на /pos/* сайдбар вообще не рендерим
  return <Sidebar role={role} />;
}
