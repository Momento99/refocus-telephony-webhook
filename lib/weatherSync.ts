import type { SupabaseClient } from '@supabase/supabase-js';

/* ============================================================================
   Синхронизация климат-данных Open-Meteo по филиалам.
   История — ERA5-Land (archive, лаг ~5 дней), свежий хвост — Forecast/IFS.
   Классификация (банды дождя/снега/ветра, weather_code→категория) и оконные
   агрегаты (рабочие часы) считаются здесь и кладутся в БД. Нормы/аномалии —
   через RPC weather_recompute_norms / weather_recompute_anomalies.
   Используется cron-роутом /api/cron/weather-sync (mode=ongoing|backfill).
   ========================================================================== */

const TZ = 'Asia/Bishkek';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

const DAILY_VARS = [
  'temperature_2m_max', 'temperature_2m_min', 'temperature_2m_mean',
  'apparent_temperature_max', 'apparent_temperature_min', 'apparent_temperature_mean',
  'precipitation_sum', 'rain_sum', 'snowfall_sum', 'precipitation_hours',
  'weather_code', 'sunshine_duration',
  'wind_speed_10m_max', 'wind_gusts_10m_max', 'wind_direction_10m_dominant',
].join(',');
const HOURLY_VARS = [
  'temperature_2m', 'apparent_temperature', 'precipitation', 'rain', 'snowfall', 'snow_depth',
  'wind_speed_10m', 'wind_gusts_10m', 'weather_code', 'cloud_cover', 'relative_humidity_2m',
  'surface_pressure', 'dew_point_2m',
].join(',');

const addDays = (d: string, n: number) => {
  const dt = new Date(d + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);
const round1 = (x: any) => (x == null || Number.isNaN(Number(x)) ? null : Math.round(Number(x) * 10) / 10);

export function weatherCategory(code: any): string | null {
  if (code == null) return null;
  const c = Number(code);
  if (c <= 1) return 'clear';
  if (c === 2) return 'partly';
  if (c === 3) return 'overcast';
  if (c === 45 || c === 48) return 'fog';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if (c >= 95) return 'thunderstorm';
  return 'other';
}
function precipBand(mm: number): string {
  if (mm <= 0) return 'none';
  if (mm < 1) return 'light';
  if (mm < 5) return 'moderate';
  if (mm < 15) return 'heavy';
  return 'downpour';
}
function windBand(gustMs: number | null): string | null {
  if (gustMs == null) return null;
  if (gustMs < 8) return 'calm';
  if (gustMs < 12) return 'windy';
  if (gustMs < 18) return 'strong';
  return 'gale';
}

async function omFetch(base: string, params: Record<string, string>): Promise<any> {
  const url = base + '?' + new URLSearchParams(params).toString();
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.json();
}

function hourlyRowsFromJson(branchId: number, hj: any, source: string): any[] {
  const t: string[] = hj?.hourly?.time || [];
  const H = hj.hourly;
  const out: any[] = [];
  for (let i = 0; i < t.length; i++) {
    const ts = t[i];
    out.push({
      branch_id: branchId, ts, d: ts.slice(0, 10), hour: Number(ts.slice(11, 13)),
      temperature_2m: H.temperature_2m?.[i], apparent_temperature: H.apparent_temperature?.[i],
      precipitation: H.precipitation?.[i], rain: H.rain?.[i], snowfall: H.snowfall?.[i], snow_depth: H.snow_depth?.[i],
      wind_speed_10m: H.wind_speed_10m?.[i], wind_gusts_10m: H.wind_gusts_10m?.[i],
      weather_code: H.weather_code?.[i], cloud_cover: H.cloud_cover?.[i], relative_humidity_2m: H.relative_humidity_2m?.[i],
      source,
    });
  }
  return out;
}
function groupHourlyByDate(rows: any[]): Map<string, any[]> {
  const m = new Map<string, any[]>();
  for (const h of rows) {
    if (!m.has(h.d)) m.set(h.d, []);
    m.get(h.d)!.push(h);
  }
  return m;
}

function windowAggs(hours: any[], openH: number, closeH: number) {
  const w = hours.filter((h) => h.hour >= openH && h.hour < closeH);
  if (!w.length) return null;
  const sum = (f: string) => w.reduce((s, h) => s + (Number(h[f]) || 0), 0);
  const ext = (f: string, mx: boolean) => {
    let m: number | null = null;
    for (const h of w) {
      const v = Number(h[f]);
      if (!Number.isNaN(v) && (m == null || (mx ? v > m : v < m))) m = v;
    }
    return m;
  };
  const codes = w.map((h) => Number(h.weather_code)).filter((c) => !Number.isNaN(c));
  const snowDepthM = ext('snow_depth', true);
  return {
    work_precip_mm: round1(sum('precipitation')),
    work_rain_hours: w.filter((h) => (Number(h.precipitation) || 0) >= 0.1).length,
    work_heavy_before_14: w.some((h) => h.hour < 14 && (Number(h.precipitation) || 0) >= 4),
    work_apparent_max: round1(ext('apparent_temperature', true)),
    work_apparent_min: round1(ext('apparent_temperature', false)),
    work_gust_max: round1(ext('wind_gusts_10m', true)),
    work_snow_depth_cm: snowDepthM != null ? round1(snowDepthM * 100) : null,
    work_weather_category: codes.length ? weatherCategory(Math.max(...codes)) : null,
  };
}

function dailyRowsFromJson(branchId: number, dj: any, hByDate: Map<string, any[]>, openH: number, closeH: number, source: string): any[] {
  const t: string[] = dj?.daily?.time || [];
  const D = dj.daily;
  const out: any[] = [];
  for (let i = 0; i < t.length; i++) {
    const d = t[i];
    const hrs = hByDate.get(d) || [];
    const avg = (f: string) => {
      const vs = hrs.map((h) => Number(h[f])).filter((v) => !Number.isNaN(v));
      return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
    };
    const maxH = (f: string) => {
      let m: number | null = null;
      for (const h of hrs) { const v = Number(h[f]); if (!Number.isNaN(v) && (m == null || v > m)) m = v; }
      return m;
    };
    const wa = windowAggs(hrs, openH, closeH);
    const precipSum = Number(D.precipitation_sum?.[i] ?? 0);
    const bandSource = wa ? Number(wa.work_precip_mm || 0) : precipSum;
    const tmin = Number(D.temperature_2m_min?.[i]);
    const tmax = Number(D.temperature_2m_max?.[i]);
    const gust = D.wind_gusts_10m_max?.[i] != null ? Number(D.wind_gusts_10m_max[i]) : null;
    const freshSnow = Number(D.snowfall_sum?.[i] ?? 0);
    const snowDepthM = maxH('snow_depth');
    const snowDepthCm = snowDepthM != null ? snowDepthM * 100 : null;
    const hum = avg('relative_humidity_2m');
    const code = D.weather_code?.[i];
    const dust = (windBand(gust) === 'strong' || windBand(gust) === 'gale') && precipSum < 0.2 && hum != null && hum < 40;
    out.push({
      branch_id: branchId, d,
      temp_mean: round1(D.temperature_2m_mean?.[i]), temp_min: round1(tmin), temp_max: round1(tmax),
      apparent_max: round1(D.apparent_temperature_max?.[i]), apparent_min: round1(D.apparent_temperature_min?.[i]), apparent_mean: round1(D.apparent_temperature_mean?.[i]),
      precip_mm: round1(precipSum), rain_mm: round1(D.rain_sum?.[i]), precip_hours: D.precipitation_hours?.[i] != null ? Number(D.precipitation_hours[i]) : null, precip_band: precipBand(bandSource),
      snowfall_cm: round1(freshSnow), fresh_snow_cm: round1(freshSnow), snow_depth_max_cm: snowDepthCm != null ? round1(snowDepthCm) : null,
      ground_snow: snowDepthCm != null ? snowDepthCm > 2 : false, freeze_thaw: !Number.isNaN(tmin) && !Number.isNaN(tmax) ? tmin < 0 && tmax > 0 : null,
      wind_max: round1(D.wind_speed_10m_max?.[i]), wind_gust_max: round1(gust), wind_dir_dominant: D.wind_direction_10m_dominant?.[i] != null ? Number(D.wind_direction_10m_dominant[i]) : null, wind_band: windBand(gust),
      weather_code: code != null ? Number(code) : null, weather_category: weatherCategory(code),
      cloud_cover_mean: round1(avg('cloud_cover')), sunshine_minutes: D.sunshine_duration?.[i] != null ? Math.round(Number(D.sunshine_duration[i]) / 60) : null,
      humidity_mean: round1(hum), dew_point_mean: round1(avg('dew_point_2m')), surface_pressure_mean: round1(avg('surface_pressure')),
      work_precip_mm: wa?.work_precip_mm ?? null, work_rain_hours: wa?.work_rain_hours ?? null, work_heavy_before_14: wa?.work_heavy_before_14 ?? null,
      work_apparent_max: wa?.work_apparent_max ?? null, work_apparent_min: wa?.work_apparent_min ?? null, work_gust_max: wa?.work_gust_max ?? null,
      work_snow_depth_cm: wa?.work_snow_depth_cm ?? null, work_weather_category: wa?.work_weather_category ?? null,
      dust_suspected: dust,
      source, fetched_at: new Date().toISOString(),
    });
  }
  return out;
}

async function upsertChunked(sb: SupabaseClient, table: string, rows: any[], conflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict: conflict });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
}

export async function runWeatherSync(sb: SupabaseClient, opts: { mode?: 'ongoing' | 'backfill'; historyStart?: string } = {}) {
  const mode = opts.mode || 'ongoing';
  const historyStart = opts.historyStart || '2016-01-01';
  const t = today();
  const archiveTo = addDays(t, -5);

  const { data: profs } = await sb.from('branch_profile').select('branch_id,lat,lng,elevation_m,effective_start');
  const { data: branchesRows } = await sb.from('branches').select('id,work_open,work_close');
  const workById = new Map((branchesRows || []).map((b: any) => [Number(b.id), b]));

  const summary: any[] = [];
  for (const p of (profs || []) as any[]) {
    const bid = Number(p.branch_id);
    if (p.lat == null || p.lng == null) continue;
    const wb: any = workById.get(bid) || {};
    const openH = wb.work_open ? Number(String(wb.work_open).slice(0, 2)) : 9;
    const closeH = wb.work_close ? Number(String(wb.work_close).slice(0, 2)) : 18;
    const elevParam: Record<string, string> = p.elevation_m != null ? { elevation: String(p.elevation_m) } : {};
    const lat = String(p.lat), lng = String(p.lng);
    const hourlyFrom = mode === 'backfill'
      ? (p.effective_start ? String(p.effective_start).slice(0, 10) : addDays(t, -365))
      : addDays(t, -12);

    const dailyRows: any[] = [];
    const hourlyRows: any[] = [];
    try {
      // 1) свежий хвост (forecast/IFS) — пишем первым, чтобы архив перезаписал пересечение
      const fj = await omFetch(FORECAST, { latitude: lat, longitude: lng, ...elevParam, timezone: TZ, wind_speed_unit: 'ms', past_days: '10', forecast_days: '1', daily: DAILY_VARS, hourly: HOURLY_VARS });
      const fH = hourlyRowsFromJson(bid, fj, 'forecast_ifs').filter((h) => h.d < t);
      const fD = dailyRowsFromJson(bid, fj, groupHourlyByDate(fH), openH, closeH, 'forecast_ifs').filter((r) => r.d < t && r.d >= addDays(t, -10));
      hourlyRows.push(...fH); dailyRows.push(...fD);

      // 2) архив ERA5-Land (авторитетный) — перезаписывает пересечение
      const aj = await omFetch(ARCHIVE, { latitude: lat, longitude: lng, ...elevParam, timezone: TZ, wind_speed_unit: 'ms', start_date: hourlyFrom, end_date: archiveTo, daily: DAILY_VARS, hourly: HOURLY_VARS });
      const aH = hourlyRowsFromJson(bid, aj, 'era5_land');
      const aD = dailyRowsFromJson(bid, aj, groupHourlyByDate(aH), openH, closeH, 'era5_land');
      hourlyRows.push(...aH); dailyRows.push(...aD);

      // 3) глубокая суточная история для норм (без hourly)
      if (mode === 'backfill' && historyStart < hourlyFrom) {
        const dj = await omFetch(ARCHIVE, { latitude: lat, longitude: lng, ...elevParam, timezone: TZ, wind_speed_unit: 'ms', start_date: historyStart, end_date: addDays(hourlyFrom, -1), daily: DAILY_VARS });
        dailyRows.push(...dailyRowsFromJson(bid, dj, new Map(), openH, closeH, 'era5_land'));
      }
    } catch (e: any) {
      summary.push({ branch_id: bid, error: String(e?.message || e) });
      continue;
    }

    const dailyMap = new Map<string, any>();
    for (const r of dailyRows) dailyMap.set(r.d, r); // архив после forecast → архив побеждает
    const hourlyMap = new Map<string, any>();
    for (const h of hourlyRows) hourlyMap.set(h.ts, h);

    await upsertChunked(sb, 'branch_weather_hourly', [...hourlyMap.values()], 'branch_id,ts');
    await upsertChunked(sb, 'branch_weather_daily', [...dailyMap.values()], 'branch_id,d');
    summary.push({ branch_id: bid, daily: dailyMap.size, hourly: hourlyMap.size, open: openH, close: closeH });
  }

  await sb.rpc('weather_recompute_norms', { p_branch_id: null });
  await sb.rpc('weather_recompute_anomalies', { p_branch_id: null, p_from: mode === 'backfill' ? null : addDays(t, -20) });
  return { mode, archiveTo, branches: summary };
}
