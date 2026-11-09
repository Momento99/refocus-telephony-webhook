'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { getSupabaseBrowser } from '@/lib/supabaseBrowser';
import { normalizeCrmRole, safeCrmRedirect } from '@/lib/crmAccess';

function ruError(msg: string) {
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Неверный email или пароль';
  if (m.includes('email not confirmed')) return 'Email не подтверждён';
  if (m.includes('rate limit')) return 'Слишком много попыток. Попробуйте позже';
  return 'Не удалось войти. ' + msg;
}

export default function LoginPage() {
  const params = useSearchParams?.() as URLSearchParams | null;
  const redirectTo = params?.get('redirect') || '/orders';

  const sb = useMemo(() => getSupabaseBrowser(), []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'password' | 'email'>('password');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (search.has('code') || search.has('token_hash') || search.has('error') ||
        hash.has('access_token') || hash.has('refresh_token') || hash.has('error')) {
      window.location.replace('/auth/callback' + window.location.search + window.location.hash);
      return;
    }
    let ignore = false;
    (async () => {
      try {
        const { data, error } = await sb.auth.getUser();
        if (!ignore && !error && data.user) {
          window.location.replace(safeCrmRedirect(redirectTo, normalizeCrmRole(data.user.app_metadata?.role) || 'seller'));
        }
      } catch {
        /* silent */
      }
    })();
    return () => {
      ignore = true;
    };
  }, [sb, redirectTo]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setSent(false);
    setLoading(true);
    try {
      if (mode === 'email') {
        const callback = new URL('/auth/callback', window.location.origin);
        if (redirectTo.startsWith('/') && !redirectTo.startsWith('//')) callback.searchParams.set('redirect', redirectTo);
        const { error } = await sb.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
          options: { shouldCreateUser: false, emailRedirectTo: callback.toString() },
        });
        if (error) throw error;
        setSent(true);
        return;
      }
      const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw error;
      const { data, error: userError } = await sb.auth.getUser();
      if (userError || !data.user) throw userError || new Error('Не удалось подтвердить вход');
      window.location.replace(safeCrmRedirect(redirectTo, normalizeCrmRole(data.user.app_metadata?.role) || 'seller'));
    } catch (reason) {
      setErr(ruError(reason instanceof Error ? reason.message : 'Ошибка соединения'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-10">
      <div className="relative w-full max-w-md">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-8 shadow-[0_40px_80px_rgba(0,0,0,0.45)]">
          {/* тонкая верхняя градиентная полоска */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-teal-400/70 via-cyan-400/70 to-sky-400/70"
          />

          {/* Заголовок */}
          <div className="mb-10 text-center">
            <h1
              className="font-kiona text-4xl sm:text-5xl font-normal leading-none tracking-[0.22em] text-white"
              style={{ textShadow: '0 0 40px rgba(34,211,238,0.18)' }}
            >
              REFOCUS
            </h1>
            <div className="mt-5 flex items-center justify-center gap-3">
              <span className="h-px w-10 bg-gradient-to-r from-transparent to-cyan-400/40" />
              <span className="text-[11px] font-medium tracking-[0.5em] text-cyan-300/80">
                CRM
              </span>
              <span className="h-px w-10 bg-gradient-to-l from-transparent to-cyan-400/40" />
            </div>
          </div>

          <form className="space-y-3" onSubmit={onSubmit}>
            <div className="mb-4 flex rounded-xl bg-slate-800/60 p-1 ring-1 ring-slate-700/60">
              {(['password', 'email'] as const).map(value => (
                <button key={value} type="button" onClick={() => { setMode(value); setErr(null); setSent(false); }}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm transition ${mode === value ? 'bg-cyan-500 text-white' : 'text-slate-300 hover:bg-slate-700/50'}`}>
                  {value === 'password' ? 'Пароль' : 'Ссылка на почту'}
                </button>
              ))}
            </div>
            <div className="relative">
              <Mail
                size={18}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                type="email"
                aria-label="Email"
                inputMode="email"
                autoComplete="email"
                placeholder=""
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] pl-11 pr-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition
                           hover:border-white/20
                           focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-400/20"
              />
            </div>

            {mode === 'password' && <div className="relative">
              <Lock
                size={18}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                type={showPassword ? 'text' : 'password'}
                aria-label="Пароль"
                autoComplete="current-password"
                placeholder=""
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] pl-11 pr-12 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition
                           hover:border-white/20
                           focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-400/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:text-slate-200 focus:outline-none"
                aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>}

            {sent && <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200">
              Проверьте почту и откройте ссылку для входа. Доступ определяется вашей учётной записью.
            </div>}

            {err && (
              <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || (mode === 'password' && !password)}
              className="group relative mt-2 w-full overflow-hidden rounded-xl px-4 py-3.5 text-sm font-semibold tracking-wide text-white shadow-[0_10px_30px_rgba(34,211,238,0.25)] transition
                         focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background:
                  'linear-gradient(135deg, #14b8a6 0%, #22d3ee 50%, #4f8ff0 100%)',
              }}
            >
              <span className="relative inline-flex items-center justify-center gap-2">
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Входим…
                  </>
                ) : (
                  mode === 'email' ? 'Отправить ссылку для входа' : 'Войти'
                )}
              </span>
              <span
                aria-hidden
                className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(255,255,255,0.12), transparent 60%)',
                }}
              />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
