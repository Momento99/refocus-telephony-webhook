import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// Метаданные приложения (см. CLAUDE.md → Refocus Mobile App)
const APP_META = {
  version: '1.3.0',
  appId: 'kg.refocus.app',
  playStoreUrl: 'https://play.google.com/store/apps/details?id=kg.refocus.app',
  appStoreUrl: null as string | null, // числовой Apple ID подставим после подключения стора
};

type Platform = 'ios' | 'android';

function dayKey(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function pct(part: number, whole: number): number | null {
  if (!whole || whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10; // 1 знак после запятой
}

export async function GET() {
  try {
    const sb = getSupabaseAdmin();
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const since7 = new Date(now - 7 * DAY).getTime();
    const since30 = new Date(now - 30 * DAY).getTime();

    const [devicesRes, identitiesRes, settingsRes, countryRes, storeRes, countriesRes, excludedRes] =
      await Promise.all([
        sb
          .from('mobile_push_devices')
          .select('auth_user_id, platform, is_active, last_seen_at, created_at'),
        sb.from('mobile_phone_identities').select('auth_user_id, created_at'),
        sb
          .from('mobile_user_settings')
          .select('auth_user_id, notify_orders, notify_checkups, notify_news'),
        sb.from('v_mobile_user_country').select('auth_user_id, country_id'),
        sb
          .from('mobile_store_daily')
          .select('date, platform, country_code, downloads, redownloads, updated_at')
          .order('date', { ascending: true }),
        sb.from('franchise_countries').select('id, name'),
        sb.from('mobile_excluded_users').select('auth_user_id'),
      ]);

    for (const r of [devicesRes, identitiesRes, settingsRes, countryRes, storeRes]) {
      if (r.error) throw r.error;
    }

    // тест-аккаунты исключаем из всех «наших» метрик
    const excluded = new Set<string>(
      (excludedRes.data ?? []).map((r: any) => r.auth_user_id)
    );
    const notExcluded = (id: any) => !id || !excluded.has(id);

    const devices = (devicesRes.data ?? []).filter((d: any) => notExcluded(d.auth_user_id));
    const identities = (identitiesRes.data ?? []).filter((i: any) => notExcluded(i.auth_user_id));
    const settings = (settingsRes.data ?? []).filter((s: any) => notExcluded(s.auth_user_id));
    const ourCountries = (countryRes.data ?? []).filter((c: any) => notExcluded(c.auth_user_id));
    const store = storeRes.data ?? [];
    const countryNames = new Map<string, string>(
      (countriesRes.data ?? []).map((c: any) => [String(c.id), String(c.name)])
    );

    // ───────────────────────────── наши пользователи (Supabase)
    const devicesByPlatform = { ios: 0, android: 0 };
    const usersByPlatform: Record<Platform, Set<string>> = { ios: new Set(), android: new Set() };
    const active7Users = new Set<string>();
    const active30Users = new Set<string>();
    const installsByDay = new Map<string, { ios: number; android: number }>();

    for (const d of devices) {
      const p = (d.platform === 'ios' ? 'ios' : 'android') as Platform;
      devicesByPlatform[p] += 1;
      if (d.auth_user_id) usersByPlatform[p].add(d.auth_user_id);

      const seen = d.last_seen_at ? new Date(d.last_seen_at).getTime() : 0;
      if (d.auth_user_id && seen >= since30) active30Users.add(d.auth_user_id);
      if (d.auth_user_id && seen >= since7) active7Users.add(d.auth_user_id);

      const k = dayKey(d.created_at);
      if (k) {
        const row = installsByDay.get(k) ?? { ios: 0, android: 0 };
        row[p] += 1;
        installsByDay.set(k, row);
      }
    }

    const registrationsByDay = new Map<string, number>();
    for (const i of identities) {
      const k = dayKey(i.created_at);
      if (k) registrationsByDay.set(k, (registrationsByDay.get(k) ?? 0) + 1);
    }

    const registered = identities.length;
    const active30 = active30Users.size;
    const active7 = active7Users.size;
    // сколько вошедших ещё НЕ подключили push (нет устройства в системе)
    const usersWithAnyDevice = new Set(
      devices.map((d: any) => d.auth_user_id).filter(Boolean)
    ).size;
    const withoutDevice = Math.max(0, registered - usersWithAnyDevice);

    const optIn = {
      total: settings.length,
      orders: settings.filter((s: any) => s.notify_orders).length,
      checkups: settings.filter((s: any) => s.notify_checkups).length,
      news: settings.filter((s: any) => s.notify_news).length,
    };

    const ourCountryMap = new Map<string, number>();
    for (const c of ourCountries) {
      const id = String(c.country_id ?? '').toLowerCase();
      if (!id) continue;
      ourCountryMap.set(id, (ourCountryMap.get(id) ?? 0) + 1);
    }
    const usersByCountry = [...ourCountryMap.entries()]
      .map(([code, users]) => ({ code, name: countryNames.get(code) ?? code.toUpperCase(), users }))
      .sort((a, b) => b.users - a.users);

    // ───────────────────────────── загрузки из сторов (кэш mobile_store_daily)
    const storeConfigured = store.length > 0;
    const downloadsByPlatform = { ios: 0, android: 0 };
    const downloadsByCountry = new Map<string, number>();
    const downloadsByDay = new Map<string, { ios: number; android: number }>();
    let lastSyncedAt: string | null = null;

    for (const s of store) {
      const p = (s.platform === 'ios' ? 'ios' : 'android') as Platform;
      const n = Number(s.downloads ?? 0);
      downloadsByPlatform[p] += n;

      const cc = String(s.country_code ?? 'ZZ').toUpperCase();
      downloadsByCountry.set(cc, (downloadsByCountry.get(cc) ?? 0) + n);

      const k = dayKey(s.date);
      if (k) {
        const row = downloadsByDay.get(k) ?? { ios: 0, android: 0 };
        row[p] += n;
        downloadsByDay.set(k, row);
      }

      if (s.updated_at && (!lastSyncedAt || s.updated_at > lastSyncedAt)) {
        lastSyncedAt = s.updated_at;
      }
    }

    const totalDownloads = downloadsByPlatform.ios + downloadsByPlatform.android;

    // ───────────────────────────── воронка: скачали → вошли → активны
    const funnel = {
      downloads: storeConfigured ? totalDownloads : null,
      registered,
      active30,
      convDownloadToReg: storeConfigured ? pct(registered, totalDownloads) : null,
      convRegToActive: pct(active30, registered),
    };

    // объединённый набор дат для графика роста
    const allDays = new Set<string>([
      ...installsByDay.keys(),
      ...downloadsByDay.keys(),
    ]);
    const growth = [...allDays]
      .sort()
      .map((date) => {
        const inst = installsByDay.get(date) ?? { ios: 0, android: 0 };
        const dl = downloadsByDay.get(date) ?? { ios: 0, android: 0 };
        return {
          date,
          installs: inst.ios + inst.android,
          downloads: storeConfigured ? dl.ios + dl.android : null,
        };
      });

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      appMeta: APP_META,
      funnel,
      store: {
        configured: storeConfigured,
        totalDownloads,
        byPlatform: downloadsByPlatform,
        byCountry: [...downloadsByCountry.entries()]
          .map(([code, downloads]) => ({
            code,
            name: countryNames.get(code.toLowerCase()) ?? code,
            downloads,
          }))
          .sort((a, b) => b.downloads - a.downloads),
        lastSyncedAt,
      },
      users: {
        registered,
        devicesTotal: devices.length,
        devicesByPlatform,
        usersByPlatform: { ios: usersByPlatform.ios.size, android: usersByPlatform.android.size },
        withoutDevice,
        active7,
        active30,
        usersByCountry,
        countryCoverage: { mapped: ourCountries.length, total: registered },
      },
      optIn,
      growth,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to load mobile overview' },
      { status: 500 }
    );
  }
}
