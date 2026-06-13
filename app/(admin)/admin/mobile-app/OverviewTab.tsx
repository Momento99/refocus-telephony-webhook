'use client';

import React, { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import toast from 'react-hot-toast';
import {
  RefreshCw,
  CloudDownload,
  Activity,
  Smartphone,
  TrendingUp,
  Bell,
  Globe,
  Info,
  ArrowRight,
} from 'lucide-react';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

const COUNTRY_FLAGS: Record<string, string> = {
  kg: '🇰🇬', kz: '🇰🇿', uz: '🇺🇿', ru: '🇷🇺',
};

// Контрастные цвета платформ
const ANDROID = '#10b981'; // emerald-500
const IOS = '#6366f1'; // indigo-500

type Overview = {
  ok: boolean;
  generatedAt: string;
  appMeta: { version: string; appId: string; playStoreUrl: string | null; appStoreUrl: string | null };
  funnel: {
    downloads: number | null;
    registered: number;
    active30: number;
    convDownloadToReg: number | null;
    convRegToActive: number | null;
  };
  store: {
    configured: boolean;
    totalDownloads: number;
    byPlatform: { ios: number; android: number };
    byCountry: { code: string; name: string; downloads: number }[];
    lastSyncedAt: string | null;
  };
  users: {
    registered: number;
    devicesTotal: number;
    devicesByPlatform: { ios: number; android: number };
    usersByPlatform: { ios: number; android: number };
    withoutDevice: number;
    active7: number;
    active30: number;
    usersByCountry: { code: string; name: string; users: number }[];
    countryCoverage: { mapped: number; total: number };
  };
  optIn: { total: number; orders: number; checkups: number; news: number };
  growth: { date: string; installs: number; downloads: number | null }[];
  error?: string;
};

function nf(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('ru-RU').format(n);
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(d);
}

function shortDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(d);
}

// ───────────────────────────────────────────────── funnel
function FunnelStage({
  label,
  value,
  caption,
  from,
  to,
  muted,
}: {
  label: string;
  value: React.ReactNode;
  caption: string;
  from: string;
  to: string;
  muted?: boolean;
}) {
  return (
    <div
      className="relative flex-1 overflow-hidden rounded-2xl px-5 py-5 text-center text-white shadow-[0_8px_24px_rgba(15,23,42,0.18)]"
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-white/80">{label}</div>
      <div className={`mt-1 text-4xl font-extrabold leading-none ${muted ? 'text-white/45' : ''}`}>
        {value}
      </div>
      <div className="mt-1.5 text-[11px] text-white/75">{caption}</div>
    </div>
  );
}

function ConvBadge({ value, hint }: { value: string; hint?: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center px-1 sm:px-1.5">
      <ArrowRight className="h-5 w-5 text-slate-300" />
      <div className="mt-1 whitespace-nowrap rounded-full bg-slate-900 px-2.5 py-0.5 text-[11px] font-bold text-white">
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[9px] text-slate-400">{hint}</div> : null}
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-sky-100 px-4 py-3 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-slate-900">{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div> : null}
    </div>
  );
}

function OptInBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const w = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold text-slate-900">
          {nf(value)} <span className="text-slate-400">/ {nf(total)} · {w}%</span>
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
      </div>
    </div>
  );
}

function CountryList({ rows, color }: { rows: { code: string; name: string; value: number }[]; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const key = r.code.toLowerCase();
        return (
          <div key={r.code} className="flex items-center gap-3">
            <span className="w-28 shrink-0 truncate text-[12px] text-slate-600">
              {COUNTRY_FLAGS[key] ?? '🌐'} {r.name}
            </span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.round((r.value / max) * 100)}%`, background: color }}
              />
            </div>
            <span className="w-12 shrink-0 text-right text-[12px] font-semibold text-slate-900">
              {nf(r.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────────────────────────────────── main
export default function OverviewTab() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/mobile/overview', { cache: 'no-store' });
      const json = (await res.json()) as Overview;
      if (!res.ok || !json.ok) throw new Error(json.error || 'Не удалось загрузить обзор');
      setData(json);
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function syncStores() {
    setSyncing(true);
    const t = toast.loading('Синхронизация со сторами…');
    try {
      const res = await fetch('/api/admin/mobile/sync-stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 7 }),
      });
      const json = await res.json().catch(() => null);
      toast.dismiss(t);
      if (!json) throw new Error('Пустой ответ сервера');

      const appleS = json.apple?.status;
      const googleS = json.google?.status;
      if (appleS === 'not_configured' && googleS === 'not_configured') {
        toast('Ключи сторов ещё не настроены', { icon: 'ℹ️' });
      } else if (json.ok) {
        toast.success(`Готово. Apple: ${json.apple?.rows ?? 0}, Google: ${json.google?.rows ?? 0} строк`);
      } else {
        toast.error(
          `Apple: ${appleS}, Google: ${googleS}${json.google?.detail ? ` (${json.google.detail})` : ''}`
        );
      }
      await load();
    } catch (e: any) {
      toast.dismiss(t);
      toast.error(e?.message || 'Ошибка синхронизации');
    } finally {
      setSyncing(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="h-36 animate-pulse rounded-2xl bg-white/70 ring-1 ring-sky-100" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/70 ring-1 ring-sky-100" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl bg-rose-50 ring-1 ring-rose-200 px-4 py-3 text-sm text-rose-700">{error}</div>
    );
  }
  if (!data) return null;

  const { funnel, store, users, optIn, growth, appMeta } = data;

  // Данные сторов считаем достоверными только если загрузок не меньше, чем вошедших
  // (нельзя войти, не скачав). Иначе история сторов неполная — не вводим в заблуждение.
  const storeReliable = store.configured && store.totalDownloads >= users.registered;

  // ── платформы: 3 сегмента, сумма равна числу вошедших (Android + iOS + без push)
  const platTotal = users.registered;
  const platformOption = {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, icon: 'circle', textStyle: { color: '#475569', fontSize: 12 } },
    series: [
      {
        type: 'pie',
        radius: ['58%', '80%'],
        avoidLabelOverlap: false,
        label: { show: true, position: 'center', formatter: `${platTotal}\nвсего`, fontSize: 13, color: '#0f172a', lineHeight: 18, fontWeight: 700 },
        labelLine: { show: false },
        data: [
          { value: users.usersByPlatform.android, name: 'Android', itemStyle: { color: ANDROID } },
          { value: users.usersByPlatform.ios, name: 'iOS', itemStyle: { color: IOS } },
          { value: users.withoutDevice, name: 'Без push', itemStyle: { color: '#cbd5e1' } },
        ].filter((d) => d.value > 0),
      },
    ],
  };

  // ── график роста
  const showDownloads = storeReliable;
  const growthOption = {
    grid: { left: 38, right: 18, top: 30, bottom: 36 },
    tooltip: { trigger: 'axis', backgroundColor: '#0f172a', borderWidth: 0, textStyle: { color: '#fff', fontSize: 12 } },
    legend: { top: 0, icon: 'roundRect', itemWidth: 14, itemHeight: 8, textStyle: { color: '#475569', fontSize: 12 } },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: growth.map((g) => shortDate(g.date)),
      axisLabel: { color: '#94a3b8', fontSize: 11 },
      axisLine: { lineStyle: { color: '#e2e8f0' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: '#94a3b8', fontSize: 11 },
      splitLine: { lineStyle: { color: '#f1f5f9' } },
    },
    series: [
      {
        name: 'Установки',
        type: 'line',
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 3, color: '#06b6d4' },
        itemStyle: { color: '#06b6d4' },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(6,182,212,0.35)' },
              { offset: 1, color: 'rgba(6,182,212,0.02)' },
            ],
          },
        },
        data: growth.map((g) => g.installs),
      },
      ...(showDownloads
        ? [
            {
              name: 'Скачивания (сторы)',
              type: 'line',
              smooth: true,
              showSymbol: false,
              lineStyle: { width: 3, color: '#8b5cf6' },
              itemStyle: { color: '#8b5cf6' },
              data: growth.map((g) => g.downloads ?? 0),
            },
          ]
        : []),
    ],
  };

  // ── география: точные данные сторов показываем только если данные сторов вообще достоверные
  // (иначе вводит в заблуждение: 1 загрузка KG при 23 вошедших — это не «точные данные»)
  const useStoreGeo = storeReliable && store.byCountry.length > 0;
  const geoRows = useStoreGeo
    ? store.byCountry.map((c) => ({ code: c.code, name: c.name, value: c.downloads }))
    : users.usersByCountry.map((c) => ({ code: c.code, name: c.name, value: c.users }));

  return (
    <div className="space-y-5">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-400">
          <span className="inline-flex items-center gap-1.5 text-slate-300">
            <Smartphone className="h-3.5 w-3.5" /> Refocus v{appMeta.version}
          </span>
          {store.lastSyncedAt ? (
            <>
              <span className="text-slate-600">•</span>
              <span>сторы: {formatDateTime(store.lastSyncedAt)}</span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void syncStores()}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 disabled:opacity-50"
          >
            <CloudDownload className={`h-4 w-4 ${syncing ? 'animate-pulse' : ''}`} />
            Синхронизировать сторы
          </button>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </button>
        </div>
      </div>

      {/* ВОРОНКА — единственный источник трёх ключевых чисел */}
      <div className="rounded-3xl bg-white ring-1 ring-sky-100 p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
        <div className="mb-4 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-cyan-500" />
          <div className="text-base font-bold tracking-tight text-slate-900">Воронка пользователей</div>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <FunnelStage
            label="Скачали"
            value={storeReliable ? nf(funnel.downloads) : '—'}
            caption={storeReliable ? 'App Store + Google Play' : 'данные сторов догружаются'}
            from="#6366f1"
            to="#8b5cf6"
            muted={!storeReliable}
          />
          <ConvBadge value={storeReliable ? `${funnel.convDownloadToReg}%` : '—'} />
          <FunnelStage
            label="Вошли"
            value={nf(funnel.registered)}
            caption="зарегистрировались в приложении"
            from="#06b6d4"
            to="#22d3ee"
          />
          <ConvBadge value={funnel.convRegToActive !== null ? `${funnel.convRegToActive}%` : '—'} />
          <FunnelStage
            label="Активны"
            value={nf(funnel.active30)}
            caption="пользовались за 30 дней"
            from="#059669"
            to="#10b981"
          />
        </div>
        {!storeReliable ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-700 ring-1 ring-amber-200">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              «Скачали» и конверсия появятся, когда сторы зальют полную историю (Android подключается,
              iOS уже тянется). Сейчас данных по загрузкам недостаточно, чтобы считать корректно.
            </span>
          </div>
        ) : null}
      </div>

      {/* вторичные метрики — без дублирования воронки */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MiniStat label="Активны за 7 дней" value={nf(users.active7)} sub={`из ${nf(users.registered)} вошедших`} />
        <MiniStat label="Устройств" value={nf(users.devicesTotal)} sub={`Android ${users.devicesByPlatform.android} · iOS ${users.devicesByPlatform.ios}`} />
        <MiniStat label="Подписаны на новости" value={nf(optIn.news)} sub={`из ${nf(optIn.total)}`} />
        <MiniStat
          label="Скачано из сторов"
          value={storeReliable ? nf(store.totalDownloads) : '—'}
          sub={storeReliable ? `iOS ${store.byPlatform.ios} · Android ${store.byPlatform.android}` : 'ждём данные'}
        />
      </div>

      {/* платформы + подписка */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <div className="mb-1 flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-cyan-500" />
            <div className="text-[13px] font-semibold text-slate-900">Пользователи по платформам</div>
          </div>
          <div className="mb-2 text-[11px] text-slate-500">
            всего {nf(users.registered)}: Android {nf(users.usersByPlatform.android)} · iOS {nf(users.usersByPlatform.ios)}
            {users.withoutDevice > 0 ? ` · без push ${nf(users.withoutDevice)}` : ''}
          </div>
          {platTotal > 0 ? (
            <ReactECharts option={platformOption} style={{ height: 220 }} notMerge lazyUpdate />
          ) : (
            <div className="grid h-[220px] place-items-center text-sm text-slate-400">Нет данных</div>
          )}
        </div>

        <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <div className="mb-1 flex items-center gap-2">
            <Bell className="h-4 w-4 text-cyan-500" />
            <div className="text-[13px] font-semibold text-slate-900">Подписка на push</div>
          </div>
          <div className="mb-4 text-[11px] text-slate-500">сколько пользователей разрешили уведомления</div>
          <div className="space-y-4">
            <OptInBar label="Заказы" value={optIn.orders} total={optIn.total} color="#06b6d4" />
            <OptInBar label="Диагностика" value={optIn.checkups} total={optIn.total} color="#6366f1" />
            <OptInBar label="Новости и акции" value={optIn.news} total={optIn.total} color="#10b981" />
          </div>
        </div>
      </div>

      {/* график роста */}
      <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
        <div className="mb-1 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-cyan-500" />
          <div className="text-[13px] font-semibold text-slate-900">Рост по дням</div>
        </div>
        <div className="mb-2 text-[11px] text-slate-500">новые установки приложения{showDownloads ? ' и скачивания из сторов' : ''}</div>
        {growth.length > 0 ? (
          <ReactECharts option={growthOption} style={{ height: 280 }} notMerge lazyUpdate />
        ) : (
          <div className="grid h-[280px] place-items-center text-sm text-slate-400">Пока нет данных для графика</div>
        )}
      </div>

      {/* география */}
      <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
        <div className="mb-1 flex items-center gap-2">
          <Globe className="h-4 w-4 text-cyan-500" />
          <div className="text-[13px] font-semibold text-slate-900">
            {useStoreGeo ? 'Скачивания по странам' : 'Пользователи по странам'}
          </div>
        </div>
        <div className="mb-3 text-[11px] text-slate-500">
          {useStoreGeo
            ? 'точные данные из сторов'
            : `оценочно по заказам · определено ${nf(users.countryCoverage.mapped)} из ${nf(users.countryCoverage.total)}`}
        </div>
        {geoRows.length > 0 ? (
          <CountryList rows={geoRows} color={useStoreGeo ? '#8b5cf6' : '#06b6d4'} />
        ) : (
          <div className="py-6 text-center text-[12px] text-slate-400">Нет данных</div>
        )}
      </div>

      {/* footer: ссылки на сторы */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-[12px] text-slate-400">
        <span>{appMeta.appId}</span>
        {appMeta.playStoreUrl ? (
          <a href={appMeta.playStoreUrl} target="_blank" rel="noreferrer" className="hover:text-cyan-300">
            Google Play ↗
          </a>
        ) : null}
        {appMeta.appStoreUrl ? (
          <a href={appMeta.appStoreUrl} target="_blank" rel="noreferrer" className="hover:text-cyan-300">
            App Store ↗
          </a>
        ) : (
          <span className="text-slate-500">App Store (ссылка добавится позже)</span>
        )}
      </div>
    </div>
  );
}
