'use client';

import { useEffect, useRef } from 'react';
import getSupabase from '@/lib/supabaseClient';
import { getDeviceId } from '@/lib/deviceId';

type HeartbeatPayload = {
  ip: string;
  ua: string;
  now: string;
};

const BEAT_MS = 60_000; // пульс раз в минуту

export default function SecurityHeartbeat() {
  const ticking = useRef(false);

  useEffect(() => {
    let timer: number | undefined;

    const run = async () => {
      if (ticking.current) return;
      ticking.current = true;

      try {
        const supabase = getSupabase();

        // 1) Кто мы
        const { data: auth } = await supabase.auth.getUser();
        const user = auth?.user ?? null;
        if (!user) {
          ticking.current = false;
          return;
        }

        // 2) IP/UA
        const res = await fetch('/api/security/heartbeat', { cache: 'no-store' });
        const hb: HeartbeatPayload = await res.json();

        const deviceId = getDeviceId();

        // 3) upsert сессии под твой user_sessions
        const upsert = await supabase
          .from('user_sessions')
          .upsert(
            {
              user_id: user.id,
              device_id: deviceId,
              ip: hb.ip,
              user_agent: hb.ua,
              last_active: new Date(hb.now).toISOString(),
              // чтобы было видно свежесть записи
              updated_at: new Date(hb.now).toISOString(),
            },
            { onConflict: 'user_id,device_id' }
          )
          .select('force_logout')
          .maybeSingle();

        // 4) Принудительный выход для этой сессии
        if (!upsert.error && upsert.data?.force_logout) {
          await supabase.auth.signOut();
          try {
            localStorage.removeItem(`security.signedin.logged:${user.id}:${deviceId}`);
          } catch {}
          return;
        }

        // 5) Одноразово записываем факт входа в user_login_log
        try {
          const flagKey = `security.signedin.logged:${user.id}:${deviceId}`;
          if (!localStorage.getItem(flagKey)) {
            await supabase.from('user_login_log').insert({
              user_id: user.id,
              ip: hb.ip,
              user_agent: hb.ua,
              success: true,
            });
            localStorage.setItem(flagKey, '1');
          }
        } catch {
          // журнал вторичен, не шумим
        }
      } catch {
        // мимо
      } finally {
        ticking.current = false;
      }
    };

    // стартуем и бьёмся по интервалу
    run();
    // @ts-expect-error: setInterval тип
    timer = window.setInterval(run, BEAT_MS);

    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, []);

  return null;
}
