'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabaseBrowser'; // путь поправь, если нет алиаса '@'

function ruError(msg: string) {
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Неверный email или пароль';
  if (m.includes('email not confirmed')) return 'Email не подтвержден';
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
        /* молча, клиент всё равно работает */
      }
    })();
    return () => { ignore = true; };
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
    <div className="min-h-[calc(100vh-0px)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="theme-surface relative overflow-hidden p-6 sm:p-8 shadow-xl">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full"
            style={{
              background: 'radial-gradient(120px 120px at 50% 50%, rgba(99,102,241,0.18), transparent 70%)',
              filter: 'blur(6px)',
            }}
          />

          <div className="mb-6 text-center">
            <h1 className="font-kiona text-3xl sm:text-4xl font-normal leading-tight">
              REFOCUS
            </h1>
            <p className="mt-1 text-sm text-[color:rgb(var(--text-muted))]">
              Введите email и пароль для доступа
            </p>
          </div>

          <form className="space-y-4" onSubmit={onSubmit}>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Email</span>
              <div className="relative">
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-lg border border-[rgba(var(--panel-border))] bg-white/80 px-3 py-2.5 pr-10 outline-none transition
                             focus:border-transparent focus:ring-2 focus:ring-[#6366f1]/40"
                />
                <svg
                  className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 opacity-60"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                  <path strokeWidth="2" d="M4 8l8 5 8-5" />
                  <rect x="2" y="6" width="20" height="12" rx="2" ry="2" strokeWidth="2" />
                </svg>
              </div>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Пароль</span>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Ваш пароль"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-lg border border-[rgba(var(--panel-border))] bg-white/80 px-3 py-2.5 pr-16 outline-none transition
                             focus:border-transparent focus:ring-2 focus:ring-[#14b8a6]/40"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-sm
                             text-[color:rgb(var(--text-muted))] hover:text-[color:rgb(var(--text-main))] focus:outline-none"
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  {showPassword ? 'Скрыть' : 'Показать'}
                </button>
              </div>
            </label>

            {err && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {err}
              </div>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg px-4 py-2.5 text-white font-medium shadow-md transition
                           focus:outline-none focus:ring-2 focus:ring-offset-0 disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #22c55e 0%, #0ea5e9 50%, #6366f1 100%)' }}
              >
                {loading ? 'Входим…' : 'Войти'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
