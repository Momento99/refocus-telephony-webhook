// /components/ClientShell.tsx
'use client';

import type React from 'react';
import SessionHeartbeat from './security/SessionHeartbeat';

export default function ClientShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <SessionHeartbeat />
    </>
  );
}
