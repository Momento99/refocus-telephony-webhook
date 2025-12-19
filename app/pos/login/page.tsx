'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import getSupabase from '@/lib/supabaseClient';
import toast from 'react-hot-toast';
import { Shield, RefreshCw } from 'lucide-react';

type OpenRes = { session_id: number | null; error: string | null };

// типы глобалки только для TS
declare global {
  interface Window {
    system?: { getTerminal?: () => Promise<string>; shutdown?: () => Promise<void> };
    posCloseShift?: () => Promise<{ penalty_total: number } | null>;
  }
}

export default function PosLoginPage(): JSX.Element {
  const supabase = getSupabase();
  const router = useRouter();

  const [terminalCode, setTerminalCode] = useState<string>('');
  const [terminalId, setTerminalId] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);

  // 1) Авто-определение терминала
  useEffect(() => {
    (async () => {
      try {
        const codeFromDevice: string | undefined = await window.system?.getTerminal?.();
        const code = codeFromDevice || localStorage.getItem('pos_terminal_code') || 'SK-01';
        setTerminalCode(code);
      } catch {
        setTerminalCode('SK-01');
      }
    })();
  }, []);

  // 2) По коду → ищем id терминала
  useEffect(() => {
    if (!terminalCode) return;
    (async () => {
      const { data, error } = await supabase
        .from('terminals')
        .select('id, branch_id, is_active')
        .eq('terminal_code', terminalCode)
        .single();

      if (error || !data) {
        setTerminalId(null);
        toast.error('Не удалось определить терминал автоматически.');
        return;
      }
      if (!data.is_active) {
        setTerminalId(null);
        toast.error('Терминал выключен (is_active = false).');
        return;
      }

      setTerminalId(data.id);
      try { localStorage.setItem('pos_terminal_code', terminalCode); } catch {}
    })();
  }, [terminalCode, supabase]);

  // 3) Логин
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!terminalId) {
      toast.error('Сначала определите терминал.');
      return;
    }
    if (pin.length < 4) {
      toast.error('PIN минимум 4 цифры.');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('fn_pos_open_by_branch', {
        p_pin: pin,
        p_terminal_id: terminalId,
      });
      if (error) throw error;

      const res = data as OpenRes;
      if (res?.error && res.error !== 'already_open') {
        const map: Record<string, string> = {
          invalid_pin: 'Неверный PIN.',
          pin_not_set: 'Для филиала не задан PIN.',
          terminal_not_found: 'Терминал не найден.',
          terminal_inactive: 'Терминал выключен.',
        };
        toast.error(map[res.error] || res.error);
        return;
      }

      if (res?.session_id) {
        try { sessionStorage.setItem('pos_session_id', String(res.session_id)); } catch {}
      }
      router.replace('/new-order');
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      if (msg.includes('schema cache')) {
        toast.error("API не видит новую сигнатуру. Выполни: NOTIFY pgrst, 'reload schema';");
      } else {
        toast.error('Ошибка входа');
      }
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // 4) Глобальный хелпер закрытия смены (оставляю, но не трогаю UI)
  useEffect(() => {
    async function closeShiftAndShutdown() {
      const raw = sessionStorage.getItem('pos_session_id');
      const sessionId = raw ? Number(raw) : 0;
      if (!sessionId) {
        toast.error('Смена не активна.');
        return null;
      }
      try {
        const { data, error } = await supabase.rpc('fn_logout_and_close', {
          p_session_id: sessionId,
          p_reason: 'user',
        } as any);
        if (error) throw error;

        sessionStorage.removeItem('pos_session_id');

        const row = Array.isArray(data) ? (data as any)[0] : (data as any);
        const penalty = Number(row?.penalty_total ?? 0);
        toast.success(
          `Смена закрыта. Штраф: ${new Intl.NumberFormat('ru-RU').format(penalty)} сом`
        );

        try { await window.system?.shutdown?.(); } catch {}
        return { penalty_total: penalty };
      } catch (e: any) {
        console.error(e);
        toast.error(e?.message || 'Не удалось закрыть смену');
        return null;
      }
    }
    window.posCloseShift = closeShiftAndShutdown;
    return () => { delete window.posCloseShift; };
  }, [supabase]);

  return (
    <div
      className="min-h-dvh grid place-items-center"
      style={{
        background:
          'radial-gradient(60% 50% at 50% 0%, rgba(59,130,246,.12) 0%, rgba(59,130,246,0) 70%)',
      }}
    >
      <div className="w-[420px] max-w-[92vw] rounded-2xl border border-white/60 bg-white/95 shadow-[0_16px_48px_rgba(31,38,135,0.16)] backdrop-blur-md p-6">
        {/* Шапка */}
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-600 text-white shadow">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xl font-semibold bg-gradient-to-r from-sky-600 to-indigo-600 bg-clip-text text-transparent">
              Вход в кассу
            </div>
            <div className="text-xs text-slate-500">Открой смену по PIN</div>
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {/* Терминал */}
          <div>
            <div className="mb-1 text-sm text-slate-600">Терминал</div>
            <div className="flex gap-2">
              <input
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 outline-none focus:ring-2 focus:ring-sky-200"
                value={terminalCode}
                readOnly
              />
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-[14px] hover:bg-slate-50"
                onClick={async () => {
                  try {
                    const code = await window.system?.getTerminal?.();
                    if (code) setTerminalCode(code);
                  } catch {}
                }}
              >
                <RefreshCw className="h-4 w-4" />
                Обновить
              </button>
            </div>
            {!terminalId && (
              <div className="mt-1 text-xs text-rose-600">
                Не удалось определить автоматически.
              </div>
            )}
          </div>

          {/* PIN */}
          <div>
            <div className="mb-1 text-sm text-slate-600">PIN филиала</div>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={pin}
              onChange={(e) => setPin(e.currentTarget.value.replace(/[^\d]/g, ''))}
              placeholder="Введите PIN"
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 outline-none focus:ring-2 focus:ring-sky-200"
            />
            <div className="mt-1 text-xs text-slate-400">Рекомендуем 4–6 цифр.</div>
          </div>

          <button
            type="submit"
            disabled={loading || !terminalId || pin.length < 4}
            className="w-full rounded-xl py-3 text-white disabled:opacity-50 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500"
          >
            {loading ? 'Открываем…' : 'Войти и открыть смену'}
          </button>
        </form>

        <div className="mt-4 text-center text-xs text-slate-500">
          После входа вы будете перенаправлены на «Новый заказ».
        </div>
      </div>

      {/* компактные базовые стили, чтобы всё выглядело одинаково даже без твоего глобального Nav/Providers */}
      <style>{`
        * { font-family: system-ui, -apple-system, Segoe UI, Roboto, 'Inter', sans-serif; }
        .tabular-nums { font-variant-numeric: tabular-nums; }
      `}</style>
    </div>
  );
}
