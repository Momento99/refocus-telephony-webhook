'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  ShieldCheck,
  Mail,
  Clock3,
  KeyRound,
  LogOut,
  AlertTriangle,
  Loader2,
  X,
  CheckCircle2,
} from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export default function SecurityPage() {
  const sb = useMemo(() => getBrowserSupabase(), []);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [lastSignIn, setLastSignIn] = useState<string | null>(null);

  const [resetSending, setResetSending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await sb.auth.getUser();
        if (cancelled) return;
        if (error || !data.user) throw error ?? new Error('Нет сессии');
        setEmail(data.user.email ?? null);
        setLastSignIn(data.user.last_sign_in_at ?? null);
      } catch (e: any) {
        toast.error(e?.message || 'Не удалось загрузить профиль');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sb]);

  async function sendResetLink() {
    if (!email) return;
    setResetSending(true);
    const t = toast.loading('Отправляю ссылку для сброса пароля…');
    try {
      const redirectTo =
        typeof window !== 'undefined' ? `${window.location.origin}/login` : undefined;
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      toast.success(`Ссылка отправлена на ${email}`);
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось отправить ссылку');
    } finally {
      toast.dismiss(t);
      setResetSending(false);
    }
  }

  async function signOutEverywhere() {
    setSigningOut(true);
    try {
      const { error } = await sb.auth.signOut({ scope: 'global' });
      if (error) throw error;
      toast.success('Вы вышли со всех устройств');
      router.replace('/login');
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось выйти');
      setSigningOut(false);
      setConfirmSignOut(false);
    }
  }

  return (
    <div className="text-slate-50">
      {/* Header (бренд-стандарт) */}
      <div className="mb-6 flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
          <ShieldCheck className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-2xl font-bold tracking-tight text-slate-50">Безопасность</div>
          <div className="mt-0.5 text-[12px] text-cyan-300/50">
            Управление вашим аккаунтом — пароль и сессии
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* ── Аккаунт-блок ── */}
        <section className="rounded-2xl bg-white ring-1 ring-sky-100 p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <div className="mb-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Ваш аккаунт
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-3 rounded-xl bg-slate-50/60 ring-1 ring-sky-100 p-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cyan-50 ring-1 ring-cyan-200">
                <Mail className="h-4 w-4 text-cyan-600" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Email
                </div>
                <div className="mt-0.5 truncate text-sm font-semibold text-slate-900">
                  {loading ? '…' : email ?? '—'}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-xl bg-slate-50/60 ring-1 ring-sky-100 p-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cyan-50 ring-1 ring-cyan-200">
                <Clock3 className="h-4 w-4 text-cyan-600" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Последний вход
                </div>
                <div className="mt-0.5 text-sm font-semibold text-slate-900">
                  {loading ? '…' : formatDateTime(lastSignIn)}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Сменить пароль ── */}
        <section className="rounded-2xl bg-white ring-1 ring-sky-100 p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cyan-500 shadow-[0_4px_12px_rgba(34,211,238,0.28)]">
                <KeyRound className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="text-[15px] font-semibold text-slate-900">Сменить пароль</div>
                <div className="mt-0.5 text-[12px] text-slate-500">
                  Отправим ссылку на {email ?? 'вашу почту'} — перейдёте по ней и зададите новый пароль.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={sendResetLink}
              disabled={resetSending || loading || !email}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-300/70 disabled:opacity-50"
            >
              {resetSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              {resetSending ? 'Отправляю…' : 'Отправить ссылку'}
            </button>
          </div>
        </section>

        {/* ── Выйти со всех устройств ── */}
        <section className="rounded-2xl bg-white ring-1 ring-rose-200 p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-500 shadow-[0_4px_12px_rgba(244,63,94,0.28)]">
                <LogOut className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="text-[15px] font-semibold text-slate-900">Выйти со всех устройств</div>
                <div className="mt-0.5 text-[12px] text-slate-500">
                  Завершит все активные сессии — на этом браузере, других устройствах, всех вкладках.
                  Рекомендуется после смены пароля.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setConfirmSignOut(true)}
              disabled={signingOut}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-300/70 disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" />
              Выйти везде
            </button>
          </div>
        </section>
      </div>

      {/* Confirm modal for global sign-out */}
      {confirmSignOut && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
          onClick={signingOut ? undefined : () => setConfirmSignOut(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.4)] ring-1 ring-sky-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-rose-500 shadow-[0_4px_16px_rgba(244,63,94,0.3)]">
                  <AlertTriangle className="h-5 w-5 text-white" />
                </div>
                <div>
                  <div className="text-lg font-bold tracking-tight text-slate-900">
                    Выйти со всех устройств?
                  </div>
                  <div className="text-[12px] text-slate-500">
                    Вы будете разлогинены везде и вернётесь на страницу входа
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmSignOut(false)}
                disabled={signingOut}
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-5 rounded-xl bg-slate-50/60 ring-1 ring-slate-100 p-3 text-[13px] text-slate-700">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-600" />
                <span>Завершатся все активные сессии CRM на всех устройствах.</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmSignOut(false)}
                disabled={signingOut}
                className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={signOutEverywhere}
                disabled={signingOut}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(244,63,94,0.28)] transition hover:bg-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-300/70 disabled:opacity-50"
              >
                {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                Выйти везде
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
