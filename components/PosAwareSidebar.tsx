'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';

export default function PosAwareSidebar({ role }: { role: any }) {
  const pathname = usePathname();
  const isPOS = pathname?.startsWith('/pos');
  const hideSidebar = isPOS || pathname === '/login' || pathname?.startsWith('/auth/');

  // Управляем классом и шириной сайдбара на уровне документа
  useEffect(() => {
    if (isPOS) {
      document.body.classList.add('pos-mode');           // для CSS-подчистки
      document.documentElement.style.setProperty('--sidebar-width', '0rem');
    } else {
      document.body.classList.remove('pos-mode');
      document.documentElement.style.setProperty('--sidebar-width', hideSidebar ? '0rem' : '16rem');
    }
    // на случай навигации SPA: очищаем при размонтировании
    return () => {
      document.body.classList.remove('pos-mode');
      document.documentElement.style.setProperty('--sidebar-width', '16rem');
    };
  }, [isPOS, hideSidebar]);

  if (hideSidebar) return null;
  return <Sidebar role={role} />;
}
