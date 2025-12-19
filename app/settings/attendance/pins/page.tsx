// app/settings/attendance/pins/page.tsx
'use client';

import dynamic from 'next/dynamic';

// чисто клиентский компонент
const PinsClient = dynamic(() => import('./PinsClient'), { ssr: false });

export default function Page() {
  return <PinsClient />;
}
