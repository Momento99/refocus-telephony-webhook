'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function TopNav() {
  const pathname = usePathname() || '/new-order';
  const Tab = ({ href, children }: { href: string; children: React.ReactNode }) => {
    const active = pathname.startsWith(href);
    return (
      <Link
        href={href}
        className={`px-3 py-1.5 rounded-lg text-sm border ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}
      >
        {children}
      </Link>
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tab href="/new-order">Новый заказ</Tab>
      <Tab href="/orders">Заказы</Tab>
      <Tab href="/customers">Клиенты</Tab>
    </div>
  );
}
