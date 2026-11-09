'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';

export default function PosAwareSidebar({ role }: { role: any }) {
  const pathname = usePathname();
  const isPOS = pathname?.startsWith('/pos');
  const isAuth = pathname === '/login' || pathname?.startsWith('/auth/');
  const hideSidebar = isPOS || isAuth;

  // Управляем классом и шириной сайдбара на уровне документа
  useEffect(() => {
    document.body.classList.toggle('auth-mode', Boolean(isAuth));
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
      document.body.classList.remove('auth-mode');
      document.documentElement.style.setProperty('--sidebar-width', '16rem');
    };
  }, [isPOS, isAuth, hideSidebar]);

  if (hideSidebar) return null;
  return <Sidebar role={role} />;
}
