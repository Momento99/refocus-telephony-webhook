'use client';

import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Power } from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * FAB-кнопка “Закончить смену” для страниц аппарата.
 * Работает только когда есть sessionStorage.pos_session_id.
 */
export default function ShiftCloseFab() {
  const supabase = createClientComponentClient();
  const [open, setOpen] = useState(false);
  const sidRaw =
    typeof window !== 'undefined' ? sessionStorage.getItem('pos_session_id') : null;
  const sessionId = sidRaw ? Number(sidRaw) : null;

  if (!sessionId) return null;

  async function handleCloseShift() {
    try {
      setOpen(false);
      const { data, error } = await supabase.rpc('fn_logout_and_close', {
        p_session_id: sessionId,
        p_reason: 'user',
      });
      if (error) throw error;

      // чистим локальную метку смены
      try {
        sessionStorage.removeItem('pos_session_id');
        sessionStorage.removeItem('pos_terminal');
      } catch {}

      const penalty = Number((data as any)?.penalty_total ?? 0) || 0;
      toast.success(`Смена закрыта. Штраф: ${penalty} сом`);

      // если Electron — просим выключить аппарат
      try {
        await (window as any).system?.shutdown?.();
      } catch {}

      // уводим на страницу PIN, чтобы исключить действия без смены
      setTimeout(() => {
        window.location.replace('/pos/login');
      }, 500);
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось закрыть смену');
    }
  }

  return (
    <>
      {/* Плавающая кнопка */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 grid h-14 w-14 place-items-center rounded-full
                   bg-rose-600 text-white shadow-xl ring-1 ring-rose-300/60
                   hover:bg-rose-700 active:scale-95 transition"
        title="Закончить смену"
      >
        <Power size={22} />
      </button>

      {/* Подтверждение */}
      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="absolute left-1/2 top-1/2 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2
                       rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 font-semibold">
              Закрыть смену
            </div>
            <div className="px-5 py-4 text-sm text-slate-700 space-y-2">
              <p>Подтвердите завершение смены. Незавершённые действия будут остановлены.</p>
              <p className="text-slate-500">После закрытия смены возможен штраф согласно правилам.</p>
            </div>
            <div className="px-5 py-4 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => setOpen(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="rounded-xl bg-rose-600 text-white px-4 py-2 text-sm hover:opacity-95"
                onClick={handleCloseShift}
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
