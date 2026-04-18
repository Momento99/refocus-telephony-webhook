'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { getSupabaseBrowser } from '@/lib/supabaseBrowser';

function ruError(msg: string) {
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Неверный email или пароль';
  if (m.includes('email not confirmed')) return 'Email не подтверждён';
  if (m.includes('rate limit')) return 'Слишком много попыток. Попробуйте позже';
  return 'Не удалось войти. ' + msg;
}

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams?.() as URLSearchParams | null;
  const redirectTo = params?.get('redirect') || '/orders';

  const sb = useMemo(() => getSupabaseBrowser(), []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const { data, error } = await sb.auth.getUser();
        if (!ignore && !error && data.user) router.replace(redirectTo);
      } catch {
        /* silent */
      }
    })();
    return () => {
      ignore = true;
    };
  }, [sb, router, redirectTo]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      setErr(ruError(error.message));
      setLoading(false);
      return;
    }
    router.replace(redirectTo);
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-10 overflow-hidden">
      {/* Фон: мягкие цветные пятна */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-40 -left-40 h-[420px] w-[420px] rounded-full opacity-40"
          style={{
            background:
              'radial-gradient(closest-side, rgba(34,211,238,0.35), transparent 70%)',
            filter: 'blur(20px)',
          }}
        />
        <div
          className="absolute -bottom-40 -right-40 h-[460px] w-[460px] rounded-full opacity-40"
          style={{
            background:
              'radial-gradient(closest-side, rgba(20,184,166,0.28), transparent 70%)',
            filter: 'blur(20px)',
          }}
        />
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[540px] w-[540px] rounded-full opacity-20"
          style={{
            background:
              'radial-gradient(closest-side, rgba(79,143,240,0.22), transparent 70%)',
            filter: 'blur(28px)',
          }}
        />
      </div>

      <div className="relative w-full max-w-md">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-slate-900/60 backdrop-blur-xl p-8 shadow-[0_40px_80px_rgba(0,0,0,0.45)]">
          {/* тонкая верхняя градиентная полоска */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-teal-400/70 via-cyan-400/70 to-sky-400/70"
          />

          {/* Лого + текст */}
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 shadow-lg ring-1 ring-white/20">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <h1 className="font-kiona text-3xl sm:text-4xl font-normal leading-none tracking-[0.2em] text-white">
              REFOCUS
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              Вход в CRM — введите email и пароль
            </p>
          </div>

          <form className="space-y-4" onSubmit={onSubmit}>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-300 uppercase tracking-wide">
                Email
              </span>
              <div className="relative">
                <Mail
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                />
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none transition
                             focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-400/20"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-300 uppercase tracking-wide">
                Пароль
              </span>
              <div className="relative">
                <Lock
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Ваш пароль"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-11 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none transition
                             focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-400/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:text-slate-200 focus:outline-none"
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </label>

            {err && (
              <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="group relative w-full overflow-hidden rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(34,211,238,0.25)] transition
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
                  'Войти'
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

          <div className="mt-6 text-center text-[11px] text-slate-500">
            Refocus · сеть оптик · панель управления
          </div>
        </div>
      </div>
    </div>
  );
}
