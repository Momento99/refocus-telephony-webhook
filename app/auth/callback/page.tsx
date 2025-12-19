// app/auth/callback/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.replace('#', ''));
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');

    if (access_token && refresh_token) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      supabase.auth.setSession({
        access_token,
        refresh_token,
      }).then(() => {
        // после успешного входа → перекидываем на главную
        router.push('/');
      });
    } else {
      router.push('/login'); // если токенов нет
    }
  }, [router]);

  return (
    <div className="flex items-center justify-center h-screen">
      <p>Авторизация...</p>
    </div>
  );
}
