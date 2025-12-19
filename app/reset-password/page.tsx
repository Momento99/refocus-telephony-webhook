'use client';

import { useEffect, useState } from 'react';
import getSupabase from '@/lib/supabaseClient';

export default function ResetPasswordPage() {
  const sb = getSupabase();

  // ready = у нас есть валидная сессия из ссылки (PASSWORD_RECOVERY)
  const [ready, setReady] = useState(false);
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    // 1) если браузер пришёл по ссылке из письма, supabase-js сам подхватит hash
    // и кинет событие PASSWORD_RECOVERY
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });

    // 2) если событие не успели поймать, просто проверим, вдруг сессия уже есть
    sb.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });

    return () => sub.subscription.unsubscribe();
  }, [sb]);

  async function handleSave() {
    setMsg(null);
    if (!ready) { setMsg('Ссылка не подтверждена. Перейди по письму ещё раз.'); return; }
    if (!pwd || pwd.length < 8) { setMsg('Пароль должен быть не короче 8 символов'); return; }
    if (pwd !== pwd2) { setMsg('Пароли не совпадают'); return; }

    const { error } = await sb.auth.updateUser({ password: pwd });
    if (error) { setMsg('Ошибка: ' + error.message); return; }

    setMsg('Пароль обновлён. Можешь войти на /login.');
    // опционально: редирект через пару секунд
    // setTimeout(() => window.location.href = '/login', 1200);
  }

  return (
    <div className="p-6 max-w-sm mx-auto space-y-3">
      <h1 className="text-xl font-semibold">Сброс пароля</h1>

      {!ready && (
        <div className="text-sm opacity-70">
          Ожидаю подтверждение из ссылки… Если пришёл не по письму, вернись в почту и перейди по «Reset Password».
        </div>
      )}

      <input
        type="password"
        className="w-full px-3 py-2 border rounded"
        placeholder="Новый пароль"
        value={pwd}
        onChange={(e) => setPwd(e.target.value)}
        disabled={!ready}
      />
      <input
        type="password"
        className="w-full px-3 py-2 border rounded"
        placeholder="Повтор пароля"
        value={pwd2}
        onChange={(e) => setPwd2(e.target.value)}
        disabled={!ready}
      />

      <button
        onClick={handleSave}
        disabled={!ready}
        className="px-4 py-2 rounded bg-black text-white disabled:opacity-60"
      >
        Сохранить пароль
      </button>

      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
}
