'use client';

import { useEffect, useRef } from 'react';
import getSupabase from '@/lib/supabaseClient';

function deviceId(): string {
  let id = localStorage.getItem('rf_device_id');
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() ?? String(Math.random());
    localStorage.setItem('rf_device_id', id);
  }
  return id;
}

function getRuntimeFingerprint() {
  const ua = navigator.userAgent;
  const ip = '::1'; // локально (как и раньше)
  return { ua, ip };
}

export default function SessionHeartbeat() {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    const devId = deviceId();

    async function upsertSessionAndMaybeLog() {
      try {
        const { ua, ip } = getRuntimeFingerprint();

        // 1) Текущий юзер и access token
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // 2) upsert в user_sessions
        await supabase
          .from('user_sessions')
          .upsert(
            {
              user_id: user.id,
              device_id: devId,
              user_agent: ua,
              ip,
              last_active: new Date().toISOString(),
              force_logout: false,
              updated_at: new Date().toISOString()
            },
            { onConflict: 'user_id,device_id' }
          );

        // 3) Пишем лог «login/active», но не чаще одного раза в 30 минут
        const thresholdIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const { count } = await supabase
          .from('user_login_log')
          .select('id', { head: true, count: 'exact' })
          .eq('user_id', user.id)
          .gte('created_at', thresholdIso);

        if (!count || count === 0) {
          await supabase
            .from('user_login_log')
            .insert({
              user_id: user.id,
              event: 'login',     // можно потом расширить: login / refresh / logout
              ip,
              user_agent: ua
            });
        }
      } catch (e) {
        // молча — лог не критичен
        // console.warn('heartbeat/log error', e);
      }
    }

    // первый пинг сразу
    upsertSessionAndMaybeLog();

    // далее — каждые N секунд (оставим 60с)
    timerRef.current = window.setInterval(upsertSessionAndMaybeLog, 60_000);

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  return null;
}
