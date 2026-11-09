'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { EmailOtpType } from '@supabase/supabase-js';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import { normalizeCrmRole, safeCrmRedirect } from '@/lib/crmAccess';

export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null);
  const completion = useRef<Promise<string> | null>(null);

  useEffect(() => {
    let active = true;
    async function completeLogin() {
      const search = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      window.history.replaceState(null, '', '/auth/callback');
      const supabase = getBrowserSupabase();
      const code = search.get('code');
      const tokenHash = search.get('token_hash');
      const type = search.get('type');
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');
      let linkError: unknown;
      try {
        if (search.get('error') || hash.get('error')) {
          throw new Error('Ссылка недействительна или срок её действия истёк. Запросите новую ссылку для входа.');
        }
        if (code) {
          const result = await supabase.auth.exchangeCodeForSession(code);
          if (result.error) throw result.error;
        } else if (tokenHash && type && ['invite', 'magiclink', 'recovery', 'email', 'signup'].includes(type)) {
          const result = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
          if (result.error) throw result.error;
        } else if (accessToken && refreshToken) {
          const result = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          if (result.error) throw result.error;
        }
      } catch (reason) {
        linkError = reason;
      }
      const { data, error: userError } = await supabase.auth.getUser();
      if (userError || !data.user) {
        if (linkError) throw linkError;
        throw new Error('Не удалось подтвердить вход. Запросите новую ссылку.');
      }
      const role = normalizeCrmRole(data.user.app_metadata?.role) || 'seller';
      return safeCrmRedirect(search.get('redirect'), role);
    }
    completion.current ??= completeLogin();
    completion.current.then(target => {
      if (!active) return;
      window.location.replace(target);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Не удалось войти.');
    });
    return () => { active = false; };
  }, []);

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="max-w-md rounded-2xl bg-white p-6 text-slate-900 ring-1 ring-sky-100">
        {error ? <>
          <p className="mb-4 text-sm text-rose-600">{error}</p>
          <Link href="/login?mode=email" className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-cyan-600 px-4 py-2.5 text-base font-semibold text-white hover:bg-cyan-500 sm:w-auto sm:text-sm">Получить новую ссылку</Link>
        </> : <p>Подтверждаем вход…</p>}
      </div>
    </div>
  );
}
