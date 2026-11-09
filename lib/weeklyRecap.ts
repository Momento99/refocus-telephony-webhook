import type { SupabaseClient } from '@supabase/supabase-js';
import { runLlmAnalysis, type LlmModelId } from '@/lib/llmAnalyze';
import { computeScores, scoreLabel, round1 } from '@/lib/team360score';

/* ============================================================================
   Общая логика субботнего разбора. Принцип «не врёт»: все числа считаются здесь,
   в коде; сезон/погода/промоутер/план — контекст справедливости; LLM (Opus 4.8)
   только формулирует текст и не выдумывает цифры.
   Используется роутами /api/admin/weekly-recap[/employees] и cron-роутом.
   ========================================================================== */

export const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0));
const pctChange = (cur: number, prev: number): number | null => (prev > 0 ? Math.round((cur / prev - 1) * 100) : null);
export function addDays(d: string, n: number) {
  const dt = new Date(d + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
const monthStart = (d: string) => d.slice(0, 7) + '-01';
const monthNum = (d: string) => Number(d.slice(5, 7));
const seasonPhase = (c: number) => (c >= 1.12 ? 'высокий сезон' : c <= 0.85 ? 'низкий сезон' : 'обычный сезон');
const num = (v: any) => Number(v || 0);
const ddShort = (d: string) => d.slice(8, 10) + '.' + d.slice(5, 7); // '2026-06-15' → '15.06'
const ddmy = (d: string) => d.slice(0, 10).split('-').reverse().join('.'); // '2026-06-15' → '15.06.2026'
const RU_MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function confidenceTier(effectiveStart: string | null, week: string): 'A' | 'B' | 'C' {
  if (!effectiveStart) return 'C';
  const weeks = (new Date(week + 'T00:00:00Z').getTime() - new Date(effectiveStart + 'T00:00:00Z').getTime()) / (7 * 864e5);
  if (weeks >= 52) return 'A';
  if (weeks >= 8) return 'B';
  return 'C';
}

/** Филиал в фазе запуска (моложе ~180 дней на дату asOf) — нельзя сравнивать сезонно/по удержанию. */
function isLaunchRamp(effectiveStart: string | null, asOf: string): boolean {
  if (!effectiveStart) return false;
  const days = (new Date(asOf + 'T00:00:00Z').getTime() - new Date(effectiveStart + 'T00:00:00Z').getTime()) / 864e5;
  return days >= 0 && days < 180;
}

/** Понедельник ISO-недели для любой даты. */
export function mondayOf(d: string) {
  const dt = new Date(d + 'T00:00:00Z');
  const wd = dt.getUTCDay();
  dt.setUTCDate(dt.getUTCDate() + (wd === 0 ? -6 : 1 - wd));
  return dt.toISOString().slice(0, 10);
}
/** Последний день месяца даты. */
export function monthEnd(d: string) {
  const dt = new Date(d + 'T00:00:00Z');
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

async function resolveWeek(sb: SupabaseClient, view: string, week?: string): Promise<string | null> {
  if (week) return mondayOf(String(week).slice(0, 10)); // снап любой даты к понедельнику
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await sb.from(view).select('week_start').lte('week_start', today).order('week_start', { ascending: false }).limit(1);
  return (data?.[0] as any)?.week_start?.slice(0, 10) ?? null;
}

/** Богатый погодный профиль за период из суточных строк branch_weather_daily (исключая Вс). */
export function buildWeatherProfile(rows: any[], prof: any) {
  const open = rows.filter((r) => new Date(r.d + 'T00:00:00Z').getUTCDay() !== 0);
  const c = (pred: (r: any) => boolean) => open.filter(pred).length;
  const sumWork = open.reduce((s, r) => s + (num(r.work_precip_mm) || 0), 0);
  const sumDaily = open.reduce((s, r) => s + (num(r.precip_mm) || 0), 0);
  const gustOf = (r: any) => num(r.work_gust_max) || num(r.wind_gust_max);
  let worst: any = null;
  for (const r of open) {
    const p = r.work_precip_mm != null ? num(r.work_precip_mm) : num(r.precip_mm);
    const score = p + (r.work_heavy_before_14 ? 10 : 0) + (gustOf(r) >= 18 ? 8 : 0) + (num(r.snow_depth_max_cm) > 2 ? 6 : 0);
    if (score > 0 && (!worst || score > worst.score)) {
      worst = { score, date: r.d, precip: p, band: r.precip_band, cat: r.weather_category, gust: gustOf(r) };
    }
  }
  const anomalies = open.filter((r) => r.is_anomaly).slice(0, 3).map((r: any) => ({
    date: r.d,
    note: [r.weather_category, r.precip_band && r.precip_band !== 'none' ? 'осадки ' + r.precip_band : '',
      gustOf(r) >= 12 ? 'ветер ' + Math.round(gustOf(r)) + ' м/с' : '', `t=${r.temp_max}°`, `откл ${r.temp_anomaly}`]
      .filter(Boolean).join(', '),
  }));
  return {
    location_type: prof?.location_type ?? null,
    sensitivity: prof ? num(prof.weather_sensitivity) : null,
    measured_effects: prof ? { rain_pct: prof.rain_effect_pct, frost_pct: prof.frost_effect_pct, snow_pct: prof.snow_effect_pct, source: prof.effects_source } : null,
    days: open.length,
    rain: {
      light: c((r) => r.precip_band === 'light'), moderate: c((r) => r.precip_band === 'moderate'),
      heavy: c((r) => r.precip_band === 'heavy'), downpour: c((r) => r.precip_band === 'downpour'),
      total_mm: Math.round((sumWork || sumDaily) * 10) / 10, rain_hours: open.reduce((s, r) => s + (num(r.work_rain_hours) || 0), 0),
      heavy_before_14_days: c((r) => r.work_heavy_before_14 === true),
    },
    snow: {
      snow_days: c((r) => num(r.fresh_snow_cm) > 0), ground_snow_days: c((r) => r.ground_snow === true),
      freeze_thaw_days: c((r) => r.freeze_thaw === true),
    },
    wind: {
      windy: c((r) => r.wind_band === 'windy'), strong: c((r) => r.wind_band === 'strong'),
      gale: c((r) => r.wind_band === 'gale'), dust_days: c((r) => r.dust_suspected === true),
    },
    temp: {
      hot_days: c((r) => num(r.apparent_max) > 32), extreme_hot: c((r) => num(r.apparent_max) > 35),
      cold_days: c((r) => r.apparent_min != null && num(r.apparent_min) <= -5),
      extreme_cold: c((r) => r.apparent_min != null && num(r.apparent_min) <= -15),
    },
    anomalies,
    worst_day: worst ? { date: worst.date, reason: [worst.cat || 'погода', worst.band && worst.band !== 'none' ? worst.band : '', worst.precip ? worst.precip + 'мм в окне' : '', worst.gust >= 12 ? 'ветер ' + Math.round(worst.gust) + ' м/с' : ''].filter(Boolean).join(', ') } : null,
  };
}

/** Контекст справедливости по филиалам за неделю: сезон, погода, промоутер. */
async function loadBranchContext(sb: SupabaseClient, week: string) {
  const weekEnd = addDays(week, 5);
  const mNum = monthNum(week);
  const [prof, weather, terms, promo, season] = await Promise.all([
    sb.from('branch_profile').select('*'),
    sb.from('branch_weather_daily').select('*').gte('d', week).lte('d', addDays(week, 6)),
    sb.from('terminals').select('terminal_code,branch_id'),
    sb.from('expenses').select('terminal_code,expense_date').eq('category', 'promoter_salary').gte('expense_date', week).lte('expense_date', weekEnd),
    sb.from('seasonality_index').select('*').eq('scope', 'network'),
  ]);
  const seasonCoef = num((season.data || []).find((s: any) => Number(s.month) === mNum)?.coef ?? 1);
  const t2b = new Map((terms.data || []).map((t: any) => [t.terminal_code, Number(t.branch_id)]));
  const promoDays = new Map<number, Set<string>>();
  for (const e of (promo.data || []) as any[]) {
    const b = t2b.get(e.terminal_code);
    if (b == null) continue;
    if (!promoDays.has(b)) promoDays.set(b, new Set());
    promoDays.get(b)!.add(e.expense_date);
  }
  const wxRowsBy = new Map<number, any[]>();
  for (const w of (weather.data || []) as any[]) {
    const b = Number(w.branch_id);
    if (!wxRowsBy.has(b)) wxRowsBy.set(b, []);
    wxRowsBy.get(b)!.push(w);
  }
  const profById = new Map((prof.data || []).map((p: any) => [Number(p.branch_id), p]));
  return {
    weekEnd, mNum, seasonCoef, profById,
    contextFor(branchId: number) {
      const p: any = profById.get(branchId);
      return {
        season: { phase: seasonPhase(seasonCoef), coef: seasonCoef },
        weather: buildWeatherProfile(wxRowsBy.get(branchId) || [], p),
        promoter: { days: promoDays.get(branchId)?.size || 0, present: (promoDays.get(branchId)?.size || 0) > 0 },
      };
    },
  };
}

/** Сводка по мобильному приложению — ТОЛЬКО на уровне сети (в данных нет привязки к филиалу). */
async function loadNetworkMobile(sb: SupabaseClient, from: string, to: string) {
  try {
    const [ident, devices] = await Promise.all([
      sb.from('mobile_phone_identities').select('created_at'),
      sb.from('mobile_push_devices').select('last_seen_at'),
    ]);
    const ids = (ident.data || []) as any[];
    const registered = ids.length;
    const toEnd = to + 'T23:59:59';
    const newInPeriod = ids.filter((r) => r.created_at && r.created_at >= from && r.created_at <= toEnd).length;
    const cutoff = new Date(new Date(to + 'T00:00:00Z').getTime() - 30 * 864e5).toISOString();
    const active30 = ((devices.data || []) as any[]).filter((d) => d.last_seen_at && d.last_seen_at >= cutoff).length;
    return { registered, new_in_period: newInPeriod, active_30d: active30 };
  } catch {
    return null;
  }
}

/** Глубокие факты по филиалу: структура продаж, frame/accessory-attach, премиум-микс, взыскания. */
async function loadDeepFacts(sb: SupabaseClient, from: string, to: string): Promise<Map<number, any>> {
  try {
    const { data } = await sb.rpc('app_branch_deep_facts', { p_from: from, p_to: to });
    return new Map((data || []).map((r: any) => [Number(r.branch_id), r.facts]));
  } catch { return new Map(); }
}

const ISSUE_RU: Record<string, string> = {
  slow_reply: 'медленные ответы', no_reply: 'без ответа', cold_tone: 'сухой тон',
  no_empathy: 'нет эмпатии', unprofessional: 'непрофессионально', unresolved: 'вопрос не решён',
  wrong_info: 'неверная информация', template_only: 'только шаблоны',
};

/** Качество клиентских диалогов (WhatsApp) по филиалу: балл, SLA-просрочка, топ-проблемы. */
async function loadMessaging(sb: SupabaseClient, from: string, to: string): Promise<Map<number, any>> {
  try {
    const { data } = await sb.rpc('app_branch_messaging', { p_from: from, p_to: to });
    return new Map((data || []).map((r: any) => [Number(r.branch_id), {
      threads: num(r.threads),
      avg_score: r.avg_score != null ? Number(r.avg_score) : null,
      sla_breach_pct: r.sla_breach_pct != null ? Number(r.sla_breach_pct) : null,
      top_issues: ((r.top_issues || []) as any[]).map((x) => ({ issue: ISSUE_RU[x.issue] || x.issue, n: num(x.n) })),
    }]));
  } catch { return new Map(); }
}

/** Обобщённый загрузчик RPC вида (branch_id, facts jsonb): финансы/удержание/демография. */
async function loadBranchFacts(sb: SupabaseClient, rpc: string, from: string, to: string): Promise<Map<number, any>> {
  try {
    const { data } = await sb.rpc(rpc, { p_from: from, p_to: to });
    return new Map((data || []).map((r: any) => [Number(r.branch_id), r.facts]));
  } catch { return new Map(); }
}

/** Качество диалогов по СОТРУДНИКУ — для личных заметок (проблемы разбираются приватно). */
async function loadEmployeeMessaging(sb: SupabaseClient, from: string, to: string): Promise<Map<number, any>> {
  try {
    const { data } = await sb.rpc('app_employee_messaging', { p_from: from, p_to: to });
    return new Map((data || []).map((r: any) => [Number(r.employee_id), {
      threads: num(r.threads),
      avg_score: r.avg_score != null ? Number(r.avg_score) : null,
      sla_breach_pct: r.sla_breach_pct != null ? Number(r.sla_breach_pct) : null,
      top_issues: ((r.top_issues || []) as any[]).map((x) => ({ issue: ISSUE_RU[x.issue] || x.issue, n: num(x.n) })),
    }]));
  } catch { return new Map(); }
}

/* ───────────────────────── ПОЗИТИВ ПО ФИЛИАЛАМ (в группу) ───────────────────────── */

function branchNominations(f: any): string[] {
  const n: string[] = [];
  const a = f.actual, d = f.delta_pct, s = f.structure, m = f.messaging;
  if (d.paid != null && d.paid >= 10) n.push(`оплаты +${d.paid}% к прошлой неделе`);
  if (d.avg_check != null && d.avg_check >= 8) n.push(`средний чек +${d.avg_check}%`);
  if (a.returning_customers > 0) n.push(`${a.returning_customers} вернувшихся клиентов`);
  if (a.refunds_count === 0) n.push('ноль возвратов');
  if (a.late_minutes === 0 && a.penalties === 0 && (a.early_leave_minutes || 0) === 0) n.push('идеальная дисциплина — ноль опозданий, штрафов и раннего ухода');
  if (f.plan.ahead_of_pace) n.push(`идут с опережением месячного плана (${f.plan.pct_to_plan ?? '?'}% выполнено)`);
  if (a.orders > 0 && a.avg_check > 0) n.push(`${a.orders} заказов при чеке ${fmt(a.avg_check)} с`);
  if (s) {
    if (s.frame_attach_pct != null && s.frame_attach_pct >= 85) n.push(`оправа к ${s.frame_attach_pct}% заказов`);
    if (s.accessory_attach_pct != null && s.accessory_attach_pct >= 40) n.push(`аксессуары к ${s.accessory_attach_pct}% заказов`);
    if (s.premium_lens_share_pct != null && s.premium_lens_share_pct >= 40) n.push(`${s.premium_lens_share_pct}% премиум-линз`);
  }
  if (f.splh != null && f.splh > 0) n.push(`выручка ${fmt(f.splh)} с/час`);
  if (m && m.avg_score != null && m.threads >= 5 && m.avg_score >= 6) n.push(`диалоги ${m.avg_score}/10`);
  return n;
}

const HUMAN_STYLE = `Ты пишешь ГОТОВЫЕ сообщения от лица ВЛАДЕЛЬЦА сети оптик Refocus для WhatsApp-группы (сотрудники только читают). Владелец просто СКОПИРУЕТ твой текст и отправит — поэтому это должно звучать как ЕГО живое сообщение, как будто он сам всё посмотрел и написал. НЕ отчёт, НЕ аналитика.

КАК ПИШЕТ ВЛАДЕЛЕЦ: по-человечески, тепло, но по делу; на «вы»; коротко; чуть по-командирски. Хвалит искренне и ставит 👍. Без канцелярита и воды.

❌ СТРОГО ЗАПРЕЩЕНЫ термины (сотрудники их не понимают, и так владелец не пишет): SPLH, SLA, медиана, премиум-микс, attach, конверсия, retention, LCR, наценка, маржа, «структура продаж», «доля в сети», проценты-коэффициенты. ЛЮБУЮ цифру переводи в простые человеческие слова.

📋 ФОРМАТ каждого text — готовое сообщение в WhatsApp, С ПЕРЕНОСАМИ СТРОК (символ \\n):
Строка 1 — заголовок: эмодзи + Филиал + короткий итог (напр. «🏆 Кара-Балта — лидер недели!», «🔥 Токмок — отличный старт!», «👏 Кант — хороший результат»).
(пустая строка)
1–2 коротких предложения ПОХВАЛЫ с понятными числами из факт-листа (выручка в сомах, заказы, рост в %, средний чек) и 👍.
(пустая строка)
Строка «Что улучшить:» и 1–3 пункта, каждый с новой строки через «• » — простым языком, конкретное действие. Если в этот период улучшать нечего — этот блок не пиши, оставь только похвалу.

🔁 ПЕРЕВОД В ЧЕЛОВЕЧЕСКИЙ ЯЗЫК (бери проблему из факт-листа → пиши простыми словами):
- низкий messaging.avg_score / «медленные ответы» / sla — но ТОЛЬКО если messaging.threads ≥ 5 → «отвечайте клиентам в WhatsApp быстрее — в течение 10 минут»
- мало аксессуаров (structure.accessory_attach_pct низкий) → «предлагайте чехол и салфетку к каждым очкам»
- мало дорогих линз (structure.premium_lens_share_pct низкий) → «чаще предлагайте линзы получше — с защитой, хамелеоны»
- опоздания / ранний уход / штрафы / взыскания → «приходите вовремя и не уходите раньше», «навести порядок со временем смен»
- план далеко не закрыт → «до плана осталось — давайте поднажмём»

ПРАВИЛА ЧЕСТНОСТИ:
- Бери ТОЛЬКО числа из факт-листа. Ничего не выдумывай (ни цифры, ни имена).
- Сервис в WhatsApp упоминай ТОЛЬКО при messaging.threads ≥ 5. Меньше — не делай вывод о сервисе вообще.
- Справедливость: спад, объяснённый погодой/сезоном/отсутствием промоутера (см. weather/season/promoter; для ТЦ дождь-мороз часто плюс), НЕ ставь в вину. Молодой филиал (is_launch_ramp=true) — хвали старт, не требуй повторных клиентов/удержания («клиенты ещё не успели вернуться — это нормально»).
- НИКОГДА не упоминай зарплату, её долю, себестоимость и маржу — это не для группы.`;

const SYSTEM_BRANCH = `${HUMAN_STYLE}

Это НЕДЕЛЬНЫЙ разбор. Выбери ОДНОГО лидера недели (🏆) — у кого самый сильный реальный результат (оплаты + выполнение плана).
В network_note дай 1–2 человеческие строки по всей сети: общая выручка и заказы за неделю + коротко про мобильное приложение (сколько в нём людей, сколько новых). Простыми словами, без терминов.

ФОРМАТ ОТВЕТА — СТРОГО JSON без markdown: {"leader_branch_id":<id>,"network_note":"<строка по сети>","branches":[{"branch_id":<id>,"text":"<готовое сообщение с \\n>"}]}`;

export async function generateBranchRecap(
  sb: SupabaseClient,
  opts: { week?: string; model?: LlmModelId; persist?: boolean } = {},
) {
  const model: LlmModelId = opts.model || 'claude-opus-4-8';
  const week = await resolveWeek(sb, 'v_ai_owner_weekly_branch_trends', opts.week);
  if (!week) throw new Error('Нет доступных недель в данных');
  const ctx = await loadBranchContext(sb, week);
  const weekEnd = ctx.weekEnd, mStart = monthStart(week), mNum = ctx.mNum;

  const [trends, planEff, planPrem, deepBy, msgBy, finBy] = await Promise.all([
    sb.from('v_ai_owner_weekly_branch_trends').select('*').eq('week_start', week),
    sb.from('v_payroll_branch_plan_effective').select('*').eq('month', mStart),
    sb.from('v_payroll_plan_premium_monthly_branch').select('*').eq('month', mStart),
    loadDeepFacts(sb, week, weekEnd),
    loadMessaging(sb, week, weekEnd),
    loadBranchFacts(sb, 'app_branch_finance', week, weekEnd),
  ]);
  const trendsBy = new Map((trends.data || []).map((r: any) => [Number(r.branch_id), r]));
  const peBy = new Map((planEff.data || []).map((r: any) => [Number(r.branch_id), r]));
  const ppBy = new Map((planPrem.data || []).map((r: any) => [Number(r.branch_id), r]));

  const dim = new Date(Date.UTC(Number(week.slice(0, 4)), mNum, 0)).getUTCDate();
  const elapsed = Number(weekEnd.slice(8, 10));

  const factsList: any[] = [];
  for (const [bid, p] of ctx.profById.entries()) {
    if (bid === 18) continue;
    const t: any = trendsBy.get(bid) || {};
    const c = ctx.contextFor(bid);
    const pe: any = peBy.get(bid), pp: any = ppBy.get(bid);
    const target = pe ? num(pe.monthly_turnover_target) : null;
    const mtd = pp ? num(pp.turnover_sum) : null;
    const pctPlan = target && mtd != null ? Math.round((mtd / target) * 100) : null;
    const paceExpected = target != null ? Math.round(target * (elapsed / dim)) : null;
    const paid = num(t.paid_in_week_amount), pPaid = num(t.prev_paid_in_week_amount);
    const rev = num(t.delivered_total_amount), pRev = num(t.prev_delivered_total_amount);
    const avg = num(t.avg_delivered_check), pAvg = num(t.prev_avg_delivered_check);
    const workedHours = num(t.worked_hours);
    // SPLH = выручка за человеко-час. Доставленная выручка недели может быть 0 из-за лага
    // доставки — тогда берём оплаты недели (живые деньги). Зависит от полноты учёта смен.
    const splh = workedHours > 0 ? Math.round((rev > 0 ? rev : paid) / workedHours) : null;
    const facts: any = {
      branch_id: bid, branch_name: (p as any).branch_name, location_type: (p as any).location_type,
      confidence: confidenceTier((p as any).effective_start, week),
      actual: {
        orders: num(t.orders_count_all), delivered_orders: num(t.delivered_orders_count), delivered_revenue: rev,
        avg_check: avg, paid_in_week: paid, returning_customers: num(t.returning_customers_count),
        refunds_count: num(t.refunds_count), late_minutes: num(t.late_minutes_sum),
        early_leave_minutes: num(t.early_leave_minutes_sum), penalties: num(t.penalty_total_sum),
        worked_hours: Math.round(workedHours),
      },
      prev: { paid_in_week: pPaid, delivered_revenue: pRev, avg_check: pAvg },
      delta_pct: { paid: pctChange(paid, pPaid), revenue: pctChange(rev, pRev), avg_check: pctChange(avg, pAvg) },
      season: c.season, weather: c.weather, promoter: c.promoter,
      is_launch_ramp: isLaunchRamp((p as any).effective_start, weekEnd), // моложе ~180 дней → не сравнивать сезонно
      plan: { target, month_to_date: mtd, pct_to_plan: pctPlan, pace_expected: paceExpected, ahead_of_pace: mtd != null && paceExpected != null ? mtd >= paceExpected : null },
      splh, // выручка за отработанный человеко-час — интегральный показатель эффективности смены
      structure: deepBy.get(bid) || null, // структура продаж, frame/accessory-attach, премиум-микс линз
      messaging: msgBy.get(bid) || null,  // качество клиентских диалогов (балл/SLA/проблемы)
    };
    facts.nominations = branchNominations(facts);
    factsList.push(facts);
  }
  if (factsList.length === 0) throw new Error('Нет филиалов с профилем (branch_profile)');

  const fallbackLeader = [...factsList].sort((a, b) => b.actual.paid_in_week - a.actual.paid_in_week)[0]?.branch_id;
  const mobile = await loadNetworkMobile(sb, week, weekEnd);
  const network = {
    paid_in_week: factsList.reduce((s, f) => s + (f.actual.paid_in_week || 0), 0),
    orders: factsList.reduce((s, f) => s + (f.actual.orders || 0), 0),
    mobile,
  };
  const userPrompt = `Неделя: ${week} — ${weekEnd} (пн–сб).\nПо сети: ${JSON.stringify(network)}.\nФакт-лист (только эти числа, не выдумывай):\n${JSON.stringify(factsList, null, 1)}`;

  const res = await runLlmAnalysis(model, SYSTEM_BRANCH, userPrompt);
  const parsed = parseJson(res.content);
  let leader = parsed.leader_branch_id != null ? Number(parsed.leader_branch_id) : fallbackLeader;
  const textBy = new Map<number, string>();
  for (const b of parsed.branches || []) textBy.set(Number(b.branch_id), String(b.text || ''));

  if (opts.persist !== false) {
    const rows = factsList.map((f) => ({ week_start: week, branch_id: f.branch_id, facts: f, positive_text: textBy.get(f.branch_id) || null, model }));
    await sb.from('branch_weekly_recap_snapshot').upsert(rows, { onConflict: 'week_start,branch_id' });
  }

  // finance (LCR/маржа линз) — ВНУТРЕННЕЕ для владельца: добавляем после LLM, в групповой текст не уходит
  const items = factsList.map((f) => ({ ...f, text: textBy.get(f.branch_id) || '', is_leader: f.branch_id === leader, finance: finBy.get(f.branch_id) || null }));
  return { week, week_end: weekEnd, leader_branch_id: leader, network, network_note: parsed.network_note || '', items, llm: { model: res.model, cost_usd: res.cost_usd, input_tokens: res.input_tokens, output_tokens: res.output_tokens } };
}

/* ───────────────────── НЕГАТИВ/РОСТ ПО СОТРУДНИКАМ (в личку) ───────────────────── */

// Банк микро-уроков «Учимся» (из обучения продавца-консультанта). Ротация по неделям/сотрудникам.
const LESSON_BANK: string[] = [
  'Главное у нас — «3 варианта и рекомендую один». Не вываливайте весь каталог: соберите Базовый, Комфорт и Максимум под задачу клиента и честно скажите, какой берёте на его месте. Клиенту нужен не список, а ваше мнение.',
  'Три уровня у нас называются ровно так: Базовый, Комфорт, Максимум. Не «средний» и не «премиум». Базовый закрывает рецепт, Комфорт добавляет один реально нужный плюс, Максимум — лучшее для этого случая.',
  'Наш фокус — продавать середину, Комфорт. Премиум предлагаем спокойно, как приятный бонус, и не давим: у людей бюджет ограничен. Хорошая смена — это когда большинство ушло с Комфортом и довольным лицом.',
  'Если показали 3 варианта, но не сказали «я бы на вашем месте взял вот этот» — работа сделана наполовину. Рекомендация одного варианта — это не давление, это ваша экспертиза. Решение всё равно за клиентом.',
  'Формула, которая работает всегда: «Базовый вашу задачу закроет. Но с учётом того, что вы целый день за компьютером (или много за рулём), комфортнее будет вот этот». В скобках — всегда то, что клиент сам про себя сказал.',
  'Когда называете цену — не извиняйтесь за неё и не делайте тяжёлую паузу. Коротко повторите, что выбрали, назовите сумму, сразу скажите срок изготовления и переходите к оформлению. Извинение за цену само её обесценивает.',
  'Если клиент просит подешевле — спокойно дайте Базовый, он рабочий. Можно один раз мягко добавить: «если носить каждый день, антиблик даёт ощутимый комфорт за небольшую разницу — решать вам». Стыдить за бюджет нельзя никогда.',
  'Цену берём только из кассы, никогда по памяти. Там может быть акция или свежее обновление. Сказать сумму «на глаз» и потом поправить — это прямой удар по доверию, ради которого мы и работаем.',
  'Скептику, который спрашивает «а почему именно эта линза?» — не уговаривайте, а показывайте. Дайте сравнить две линзы на экране, объясните на примере. Аргумент убеждает, уговоры отталкивают.',
  'По таблице зрение проверяем с середины — со строки 0.4–0.6. Не начинайте с самой мелкой и не с самой крупной. Видит — идём вверх, не видит — вниз.',
  'Правило подбора: лучше чуть недотянуть, чем перетянуть. Сильнее, чем нужно, — это головокружение и очки, которые лягут в стол. Останавливаемся там, где человеку комфортно.',
  'После пробной оправы выведите клиента к окну: пусть посмотрит вдаль, сравнит «в очках / без очков». Очки правильные, когда человек говорит «так лучше», а не когда прочитал нижнюю строчку.',
  'Если человек пришёл в контактных линзах — честно предупредите: проверка будет неточной, лучше снять и подождать или прийти завтра. Точность важнее, чем «давайте быстренько».',
  'Туман, резкое падение зрения за день-два, вспышки, «шторка» сбоку — это не про очки, это к врачу, и лучше в тот же день. Честный отказ подобрать очки здесь ценнее любой продажи.',
  'Детей младше 14 лет мы не проверяем — глаз ещё растёт. Откажите мягко, порекомендуйте офтальмолога и позовите вернуться с готовым рецептом. Так вы не теряете родителя как клиента.',
  'Антиблик — слой, который убирает блики: вечером, при свете фар, от экрана отражений меньше, и очки выглядят аккуратнее. Простой понятный шаг вверх для тех, кто носит очки каждый день.',
  'Защита от экранов — наша середина и любимый выбор для тех, кто много за компьютером и телефоном. Говорим про комфорт: «глаза к вечеру устают меньше». Никогда не говорим «защитит зрение» или «лечит» — это неправда и запрещено.',
  'Хамелеон — линзы, которые на солнце темнеют, а в помещении снова прозрачные. «Два в одном»: не нужны отдельные солнцезащитные. Отлично тем, кто весь день то на улице, то внутри.',
  'Асферика — это про то, что линза тоньше и аккуратнее обычной, очки смотрятся изящнее. Это история про эстетику и комфорт носки, а не про «лучше видно».',
  'Утончённые 1.67 предлагаем при сильных диоптриях (примерно от ±4): обычная линза там толстая и тяжёлая по краям, а эта в полтора-два раза тоньше. При слабой диоптрии разницы нет — это была бы переплата.',
  'Поликарбонат — про детей и активных: материал лёгкий и не разбивается от удара. Родителю так и говорите: «обычная линза при ударе мячом может треснуть, а эта — нет».',
  'У нас четыре гарантии, и о них рассказываем при каждой выдаче: 14 дней на замену по любой причине, 60 дней гарантия на рецепт, пожизненный бесплатный сервис и сообщение в WhatsApp через несколько дней. Это и есть сопровождение.',
  '14-дневная замена считается на каждую пару очков отдельно, а не на клиента. Трое очков — три независимые замены. Объясните честно, чтобы человек чувствовал, что правила в его пользу.',
  'Пожизненный сервис — подтянуть, поменять винтик или носоупор, почистить — всегда бесплатно, сколько бы раз человек ни пришёл. Клиент должен уходить с мыслью «вернусь в любой момент — помогут».',
  'Если в первые дни «кружится голова» — это часто нормальная адаптация, глаз привыкает за неделю. Объясните спокойно, но сразу скажите: право на замену в силе. Не уговаривайте «терпеть».',
  'Когда человек возвращается по замене — сначала просто выслушайте причину молча, не оправдываясь. Потом подтвердите право и подберите заново. Спокойно принятый возврат превращает недовольного клиента в постоянного.',
  'Запомните главную мысль: клиент покупает не кассу и не приложение, а спокойствие — «меня не развели, я понял за что плачу, про меня не забудут». Все наши инструменты нужны только чтобы это спокойствие создать.',
  'В конце смены честный вопрос себе — не «сколько я продал подороже», а «скольким людям я помог уйти в лучших очках за их бюджет». Если держать в голове именно это, продажи приходят сами.',
  'Три наши опоры — Доверие, Понятность, Сопровождение. Люди заходят в оптику с тревогой «навтюхают, не пойму, забудут». Кто эту тревогу снимает — у того клиент остаётся и приводит знакомых.',
  'Не выкладывайте перед человеком десять оправ — он устанет и растеряется. Сами выберите три: безопасную классику, одну поинтереснее и одну, которая реально круто сидит. Не зашло — добавьте ещё одну по его запросу, не больше.',
  'Оправу в руки молча не давайте — всегда короткий комментарий: «эта форма смягчает черты», «здесь линза стоит ровно по зрачку». Но «вам идёт» на каждую подряд не говорите — это обесценивает.',
  'Если оправа человеку не идёт — скажите честно и мягко: «по-моему, она крупновата для вашего лица, давайте примерим вот эту». Похвалить то, что не подходит, ради быстрой продажи — против всего, на чём мы стоим.',
  'Всегда проверяйте посадку: зрачок по центру линзы, переносица без давления, дужка лежит за ухом, но не давит. Непроверенная посадка — это будущий возврат и недовольный клиент через неделю.',
  'Когда клиент в переписке ответил «всё нравится» — отвечайте коротко и тепло: «Рад слышать, если что-то изменится — пишите или приходите». Не предлагайте в этот момент докупить — не превращайте добрый ответ в продажу.',
  'Три приёма, которые держат разговор: повторите мысль клиента своими словами, назовите вслух его эмоцию, если расстроен («понимаю, неприятно»), и держите небольшую паузу — в ней человек часто говорит самое важное.',
  'После 3–5 вопросов подведите итог: «Правильно понимаю: очки для работы, в основном за компьютером, важно, чтобы глаза не уставали?» Короткое резюме показывает «вас услышали» — и клиент доверяет вашей рекомендации.',
];

const SYSTEM_EMPLOYEE = `Ты пишешь подробный ЛИЧНЫЙ отчёт от лица ВЛАДЕЛЬЦА сети оптик Refocus каждому продавцу за неделю. Владелец просто СКОПИРУЕТ твой текст и отправит сотруднику ЛИЧНО. Это должно звучать как он сам всё посмотрел, проанализировал и написал — управляющий, который реально видит и контролирует каждого.

КАК ПИШЕТ ВЛАДЕЛЕЦ: на «вы», коротко и прямо, по-человечески, по делу, чуть по-командирски, без воды; хвалит искренне и ставит 👍. Без давления (нельзя «срочно», «последний шанс»). Никаких превосходных степеней без чисел.

❌ СТРОГО ЗАПРЕЩЕНО (термины и слова, которых у нас нет): SPLH, SLA, конверсия, апселл, follow-up, допы, тир, микс; «Blue Block», «синий свет», «дорогие линзы»; «защитит/лечит зрение»; уровни «средний/премиум» (правильно: Базовый/Комфорт/Максимум); слово «пустяк». Любую цифру переводи в человеческие слова («примерно 6 из 10 клиентов», а не «60%»).
❌ НЕ ИСПОЛЬЗУЙ СКОБКИ с пояснениями — текст копируется и отправляется сотруднику как есть, скобки выглядят как служебная пометка. Пиши обычными фразами.
КАНОН названий линз: Стандарт, Антиблик, Защита от экранов, Хамелеон, Асферика, Утончённые 1.67, Поликарбонат. Бренд всегда «Refocus».

📋 ФОРМАТ отчёта (с переносами строк \\n; заголовок раздела + текст). Раздел показывай ТОЛЬКО если по нему есть данные в факт-листе:
ПЕРИОД отчёта НЕ всегда неделя: смотри period_mode в факте — 'week' (неделя), 'month' (календарный месяц) или 'all' (с открытия филиала). В шапке всегда используй готовую подпись period_label. Формулировки про время («за неделю», «неделю назад», «по дням») подбирай под period_mode: для месяца — «за месяц», «в прошлом месяце»; для 'all' — «с открытия».
Строка 1: «{Имя} — {филиал}. Отчёт {period_label}.» (period_label уже готов: «за неделю 15.06–20.06» / «за июнь 2026» / «с открытия 21.05.2026 по 21.06.2026».)
Строка 2 (только если score.final есть): «Оценка: {score.final}/10 — {score.label}.» Это сводный балл по работе за период; подскоры score.sub словами НЕ перечисляй.
Строка 3 — ПРОГРЕСС (если progress есть, это ВАЖНО и мотивирует, сделай тёплым с эмодзи): сравни с прошлым периодом. Слова под period_mode: неделя — «Неделю назад было…», месяц — «В прошлом месяце было…». Если балл вырос — «📈 … было {progress.score_prev}, сейчас {progress.score_now} — растёте, так держать». Если упал — «📉 … было {progress.score_prev}, сейчас {progress.score_now} — давайте вернёмся к форме». Можно добавить заказы (progress.orders_prev → progress.orders_now), если показательно. Если progress нет (например 'all') — строку прогресса пропусти.
Затем по разделам, на «вы», человеческим языком, со СРАВНЕНИЕМ (с филиалом-соседом, сетью, прошлым периодом — это и есть сигнал «я всё вижу и сравниваю»):
- **Продажи** (sales): выручка, заказы, средний чек. Если coshift=true — пиши «по вашей смене» и бери sales.shift, НЕ личные числа; прямо скажи «вы работаете в одну смену, поэтому продажи смотрю по смене». Сравни заказы с сетью: sales.orders_per_day против benchmarks.orders_per_day_net — если заметно ниже сети, прямо скажи, что заказов в среднем за день мало (ориентир ~2–3 в день, как у сильных продавцов), это важно поднять. Если заказов мало — не закрывай продажи одной похвалой за чек. СПРАВЕДЛИВОСТЬ: посмотри context (season — сезон, weather — погода: дожди/жара/снег, promoter — дни промоутера). Если поток объективно слабый из-за низкого сезона, плохой погоды или потому что не было промоутера — НЕ вини за «мало заказов», прямо отметь причину; спрашивай за то, что в его власти: средний чек, пакет линз, оправа, переписка.
- **Линзы** (lens): назови его долю «Защиты от экранов» (середина, наш фокус) человеческими словами: «берёт примерно X из 10 клиентов». Тон ВЫБИРАЙ по lens.screen_verdict, НЕ сравнивай вслепую с максимумом по сети:
    • 'strong' (берёт хорошо ИЛИ идёт вровень с лучшими) → ПОХВАЛИ и НЕ подавай это как отставание: «это хорошо, держите 👍». Если lens.near_best=true — «идёте вровень с лучшими в сети». КАТЕГОРИЧЕСКИ нельзя писать «у {имя} 44, а у вас 40 — есть куда расти»: 40 и 44 — по сути одно и то же, не выдумывай разрыв из пары пунктов.
    • 'ok' (середнячок) → тепло, лёгкое приглашение чуть активнее предлагать середину, БЕЗ имён-лидеров и без «отстаёте».
    • 'low' (берёт заметно мало) → вот ЗДЕСЬ честно про разрыв, и можно показать лидера как ориентир: «у {benchmarks.screen_best.name} почти каждый второй клиент берёт — реальный ориентир, давайте подтянем».
  В любом случае РАЗЖУЙ, как показывать пакет из трёх: Базовый — Антиблик; Комфорт — Защита от экранов (середина, её и рекомендуем чаще всего); Максимум — асферика или Защита от экранов с Хамелеоном. Стандартные («белые») линзы сами НЕ предлагайте — только если клиент сам попросит подешевле. Всегда показывайте три варианта и один рекомендуйте.
- **Оправы** (frames + benchmarks.frame_avg_network): смотри СРЕДНИЙ ЧЕК НА ОПРАВУ. Ассортимент витрины НЕ обсуждаем — оправы приходят по нашей формуле, продавец их не выбирает; за состав витрины (женские/чтение и т.п.) не хвали и не ругай. Раздел пиши ТОЛЬКО если frames.tier задан (иначе оправ мало — пропусти). frames.tier='high' → похвали: «по оправам сильно — средний чек выше, чем в среднем по сети, показываете и интересные модели. Так держите 👍». frames.tier='low' → мягкий совет про якорение по канону «3 оправы, одна поинтереснее», БЕЗ слов «дорогая/лучшая» и без давления: «средний чек на оправу пока ниже сети. Дело не в том, чтобы продавать дороже, а в том, как показываете: подбирайте три оправы, и пусть одна будет заметно интереснее остальных — она задаёт планку, и средняя на её фоне кажется удобным и разумным выбором. Решает всё равно клиент». frames.tier='ok' → нейтрально-тепло: «по оправам идёте ровно, средний чек на уровне сети».
- **Выдача и звонок** (service): показывай ТОЛЬКО если service.ready_fill_pct ≥ 50 (иначе данных мало — раздел пропусти). Скорость готовности очков service.avg_days_ready: быстро (≤2 дня) — похвали «очки готовите за пару дней, клиенты ждут недолго 👍»; долго (>4 дней) — мягко «очки идут дольше обычного, давайте ускорим». Звонок клиенту после готовности (service.call_pct): если звонит мало — мягко «звоните клиенту, когда очки готовы — это забота и сопровождение, человек чувствует, что о нём помнят». Без давления, без процентов в тексте.
- **Долги** (debts — пиши ТОЛЬКО если debts.high=true): по нашему филиалу клиенты не доплатили {debts.debt_sum} с — это {debts.debt_pct}% от продаж, заметно больше, чем в {debts.best_branch} ({debts.best_pct}%). Это уже заработанные, но не полученные деньги. Прямо скажи: дозванивайте клиентам, напоминайте про остаток, доводите оплату до конца. Это общая задача смены/филиала, не лично его вина.
- **Переписка** (messaging): я читаю переписку. Назови медиану времени первого ответа (messaging.median_min) человеческими словами: до ~90 минут — «примерно за N минут», больше — переведи в часы (или сутки), НЕ пиши тысячи минут. Цель — 15 минут. Назови его реальные медленные ответы поимённо — клиент и сколько ждал (slow). Покажи долю переписки сети (messaging.share_pct): если он берёт мало клиентов, а основную часть тянет benchmarks.msg_top.name — прямо скажи, что почти всю переписку в соцсетях ведёт {msg_top.name}, а у него лишь небольшая доля — надо отвечать активнее и забирать клиентов себе, у всех должно быть примерно поровну. Если он сам и есть msg_top — поблагодари 👍 и попроси, чтобы подключались остальные. Шаблон-отписку «Всегда рады помочь, пишите если что понадобится» — только когда вопрос уже решён, не в ответ на жалобу. Если есть bad — по-человечески скажи, что так нельзя и как надо. Правило: на первое сообщение отвечаем за 15 минут; на жалобу — сначала решаем, потом прощаемся.
- **Дисциплина** (discipline): если discipline.period_mode='week' и есть discipline.days — пройди по дням (dow/late/early/penalty), опоздания <15 минут НЕ ругай (штрафа нет) — мягко «почти вовремя», от 15 мин — назови штраф. Если period_mode НЕ 'week' (месяц/с открытия) или days нет — по дням НЕ перечисляй, дай сводку: отработано {work_days} смен, с опозданиями {late_days}, штрафов на {penalty_week} с. Назови, сколько дней из скольких и итог штрафов (penalty_week). Если есть прогресс к прошлой неделе (prev_late_sum было больше) — похвали 👍. Если discipline.clean — коротко поблагодари «приходите вовремя 👍». Если discipline.streak_no_late ≥ 10 — отметь серию с огоньком: «{streak_no_late} дней подряд без опозданий 🔥». Если discipline.broken_schedule=true — раздел дисциплины НЕ пиши вообще (у него график в системе ещё настраивается). Если coshift=true и опоздания синхронны — пиши «вы открываетесь одной сменой позже», как про пару.
- **Фидбэк** (пиши ВСЕГДА, короткой строкой): напомни, что фидбэк в конце смены вы читаете. Если есть real_notes — поблагодари за конкретную запись (про жару/кондиционер — «понял, решаем 👍») и мягко, без давления: в остальные дни случайные буквы — лучше написать одну честную строку, что мешало. Если записей нет — просто пригласи без нажима: «если что-то мешает в работе или нужно — напишите в фидбэке в конце смены, я читаю каждый».
- **Учимся** (lesson): вставь урок из факт-листа дословно (это обучение, чтобы каждый раз узнавали новое). Подпиши коротко, например «И вот на что обращаю внимание:».
- **Итог** (summary_signals): в самом конце короткий итог тоном владельца на «вы»:
  Что хорошо:
  • <1–2 пункта из summary_signals.good, по-человечески, с 👍>
  Над чем поработать:
  • <1–2 пункта из summary_signals.fix, конкретное действие, без «срочно/последний шанс»>
  Если summary_signals.fix пуст — блок «Над чем поработать» не пиши, оставь только похвалу и тёплую завершающую строку.
- **Лучшее за период** (sales.max_check): если есть, заверши позитивом — «Лучший чек за период — {sales.max_check} с ⭐, отличная работа».
- **До премии** (premium): короткой строкой. Если premium.reached=false: «📍 До премии {premium.bonus_each} с каждому по филиалу осталось примерно {premium.remaining} с — реально дотянуть, поднажмём». Если premium.reached=true: «План филиала выполнен — премия {premium.bonus_each} с ваша 👍». Премия командная (за месячный план филиала), так и подавай — «по филиалу», не лично.

ПРАВИЛА ЧЕСТНОСТИ: бери ТОЛЬКО числа и цитаты из факт-листа, ничего не выдумывай. Имя — из факт-листа.
НЕ ВЫДУМЫВАЙ РАЗРЫВ ИЗ ШУМА: если показатель в норме или вровень с лучшими (разница в пределах нескольких пунктов/процентов) — это ОДНО И ТО ЖЕ, просто похвали, не превращай «40 против 44» в «есть куда расти». Разрыв упоминай только когда он реальный и заметный, и опирайся на готовые вердикты в факт-листе (screen_verdict, frames.tier и т.п.), а не сравнивай вручную с максимумом.

ФОРМАТ ОТВЕТА — СТРОГО JSON без markdown: {"employees":[{"employee_id":<id>,"text":"<готовый отчёт с \\n>"}]}`;

/** Загрузчик RPC вида (employee_id, facts) с произвольными аргументами. */
async function loadEmpRpc(sb: SupabaseClient, rpc: string, args: Record<string, any>): Promise<Map<number, any>> {
  try {
    const { data } = await sb.rpc(rpc, args);
    return new Map((data || []).map((r: any) => [Number(r.employee_id), r.facts]));
  } catch { return new Map(); }
}

export async function generateEmployeeGrowth(
  sb: SupabaseClient,
  opts: { week?: string; period?: 'week' | 'month' | 'all'; model?: LlmModelId } = {},
) {
  const model: LlmModelId = opts.model || 'claude-opus-4-8';
  const period: 'week' | 'month' | 'all' = opts.period || 'week';
  const VIEW = 'v_ai_owner_weekly_employee_signals';
  const today = new Date().toISOString().slice(0, 10);
  const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5) + 1;

  // Окно отчёта (week..weekEnd) + окно стабильной статистики (mFrom..mTo) + период сравнения (prevWeek..prevWeekEnd).
  // Имена week/weekEnd оставлены прежними, чтобы не трогать остальной код; для месяца/«с открытия» это уже не неделя.
  let week: string, weekEnd: string;
  let prevWeek: string | null = null, prevWeekEnd: string | null = null;
  let mFrom: string, mTo: string, planMonth: string, periodDays: number, periodLabel: string;
  const branchStart = new Map<number, string>(); // 'all': дата первого заказа филиала (для подписи «с открытия …»)

  if (period === 'month') {
    const anchor = opts.week ? String(opts.week).slice(0, 10) : today;
    week = monthStart(anchor);
    const me = monthEnd(anchor);
    weekEnd = me < today ? me : today;               // текущий месяц считаем только до сегодня
    const pm = addDays(week, -1);                    // любой день прошлого месяца
    prevWeek = monthStart(pm); prevWeekEnd = monthEnd(pm);
    mFrom = week; mTo = weekEnd;                      // для длинного периода стабилизатор не нужен — окно и так большое
    planMonth = monthStart(week);
    periodDays = daysBetween(week, weekEnd);
    periodLabel = `за ${RU_MONTHS_NOM[monthNum(week) - 1]} ${week.slice(0, 4)}`;
  } else if (period === 'all') {
    // Окно сети: от самого раннего заказа до сегодня. Каждый филиал даёт только свою историю,
    // поэтому «с открытия» получается само собой; стартовую дату филиала берём для подписи.
    const { data: brAll } = await sb.from('branches').select('id').neq('id', 18);
    const ids = (brAll || []).map((b: any) => Number(b.id));
    const firsts = await Promise.all(ids.map((id) =>
      sb.from('orders').select('created_at').eq('branch_id', id).or('is_deleted.is.null,is_deleted.eq.false')
        .order('created_at', { ascending: true }).limit(1)));
    ids.forEach((id, i) => { const d = (((firsts[i] as any).data || [])[0])?.created_at; if (d) branchStart.set(id, String(d).slice(0, 10)); });
    const starts = [...branchStart.values()].sort();
    week = starts[0] || addDays(today, -365);
    weekEnd = today;
    mFrom = week; mTo = weekEnd;
    planMonth = monthStart(today);
    periodDays = daysBetween(week, weekEnd);
    periodLabel = 'с открытия';
  } else {
    const wk = await resolveWeek(sb, VIEW, opts.week);
    if (!wk) throw new Error('Нет доступных недель (сотрудники)');
    week = wk; weekEnd = addDays(week, 5);
    prevWeek = addDays(week, -7); prevWeekEnd = addDays(week, -2);
    mTo = weekEnd; mFrom = addDays(weekEnd, -55);     // ~8 недель для стабильного «месяца»
    planMonth = monthStart(week);
    periodDays = 7;
    periodLabel = `за неделю ${ddShort(week)}–${ddShort(weekEnd)}`;
  }

  // Ростер: для недели — одна неделя; для месяца/«с открытия» — диапазон недель (потом дедуп по сотруднику)
  const rosterQ = period === 'week'
    ? sb.from(VIEW).select('employee_id,employee_name,branch_id,branch_name,week_start').eq('week_start', week)
    : sb.from(VIEW).select('employee_id,employee_name,branch_id,branch_name,week_start').gte('week_start', week).lte('week_start', weekEnd);

  const [{ data: empsRaw }, salesBy, lensBy, discBy, msgBy, serviceBy, branchFramesRes, brRes, score360Res, score360PrevRes, rolesRes, planEffRes, planPremRes, debtBy, ctx] = await Promise.all([
    rosterQ,
    loadEmpRpc(sb, 'app_employee_sales', { p_mfrom: mFrom, p_mto: mTo, p_wfrom: week, p_wto: weekEnd }),
    loadEmpRpc(sb, 'app_employee_lens_frames', { p_mfrom: mFrom, p_mto: mTo }),
    loadEmpRpc(sb, 'app_employee_discipline_mood', { p_wfrom: week, p_wto: weekEnd, p_pwfrom: prevWeek ?? week, p_pwto: prevWeekEnd ?? week, p_mfrom: mFrom, p_mto: mTo }),
    loadEmpRpc(sb, 'app_employee_messaging_detail', { p_from: mFrom, p_to: mTo }),
    loadEmpRpc(sb, 'app_employee_service', { p_mfrom: mFrom, p_mto: mTo }),
    sb.rpc('app_branch_frames', { p_mfrom: mFrom, p_mto: mTo }),
    sb.from('branches').select('id,name'),
    sb.rpc('rpc_employee_360', { p_from: week, p_to: weekEnd }), // оценка/10 «Команда 360» (окно отчёта)
    prevWeek ? sb.rpc('rpc_employee_360', { p_from: prevWeek, p_to: prevWeekEnd }) : Promise.resolve({ data: [] } as any), // прошлый период — для прогресса (нет у «с открытия»)
    sb.from('employees').select('id,role'),
    sb.from('v_payroll_branch_plan_effective').select('branch_id,monthly_turnover_target,monthly_bonus_each').eq('month', planMonth),
    sb.from('v_payroll_plan_premium_monthly_branch').select('branch_id,turnover_sum').eq('month', planMonth),
    loadBranchFacts(sb, 'app_branch_debts', mFrom, mTo), // долги клиентов по филиалу
    period === 'week' ? loadBranchContext(sb, week) : Promise.resolve(null), // сезон/погода/промоутер — справедливость только для недели
  ]);
  // Месяц/«с открытия» дают несколько недельных строк на сотрудника — оставляем по одной (имя/филиал стабильны).
  const emps = period === 'week'
    ? (empsRaw || [])
    : [...new Map(((empsRaw || []) as any[]).map((r: any) => [Number(r.employee_id), r])).values()];
  // Только продавцы (промоутер/мастер исключаются) И только те, кто реально работал в периоде
  // (были заказы или смены) — иначе карточка пустая у того, кто был в отпуске/не выходил.
  const roleById = new Map<number, string>(((rolesRes as any).data || []).map((r: any) => [Number(r.id), String(r.role)]));
  const list = (emps || []).filter((e: any) => {
    const eid = Number(e.employee_id);
    if (Number(e.branch_id) === 18 || roleById.get(eid) !== 'seller') return false;
    const workedWeek = !!salesBy.get(eid)?.sales_week || num(discBy.get(eid)?.work_days) > 0;
    return workedWeek;
  });

  // Оценка/10 + подскоры по сотруднику (computeScores на сырье rpc_employee_360, период = неделя)
  const score360By = new Map<number, any>();
  for (const r of (((score360Res as any).data || []) as any[])) {
    const sc = computeScores(r, periodDays);
    const lab = scoreLabel(sc.final360);
    score360By.set(Number(r.employee_id), {
      final: round1(sc.final360), label: lab.label, tone: lab.tone,
      sub: { sales: round1(sc.sales), service: round1(sc.service), discipline: round1(sc.discipline), voice: round1(sc.voice) },
      is_voice_pilot: !!r.is_voice_pilot,
    });
  }
  // Прошлая неделя — для личного прогресса (балл + заказы/чек)
  const prevScoreBy = new Map<number, any>();
  for (const r of (((score360PrevRes as any).data || []) as any[])) {
    prevScoreBy.set(Number(r.employee_id), { final: round1(computeScores(r, periodDays).final360), orders: num(r.orders_count), avg_check: Math.round(num(r.avg_check)) });
  }
  // Премия: до месячного плана филиала (премия командная)
  const premiumByBranch = new Map<number, any>();
  const turnoverBy = new Map<number, number>(((planPremRes as any).data || []).map((r: any) => [Number(r.branch_id), num(r.turnover_sum)]));
  for (const pe of (((planEffRes as any).data || []) as any[])) {
    const bid = Number(pe.branch_id), tgt = num(pe.monthly_turnover_target), cur = turnoverBy.get(bid) || 0;
    if (tgt > 0) premiumByBranch.set(bid, { remaining: Math.max(tgt - cur, 0), bonus_each: num(pe.monthly_bonus_each), target: tgt, current: Math.round(cur), reached: cur >= tgt });
  }
  const branchName = new Map((brRes.data || []).map((b: any) => [Number(b.id), b.name]));
  const branchFrames = new Map<number, any>(((branchFramesRes as any).data || []).map((r: any) => [Number(r.branch_id), r.facts] as [number, any]));

  // Имя/филиал по всем продавцам из продаж (нужно для эталонов)
  const nameById = new Map<number, string>(), brById = new Map<number, number>();
  for (const [eid, f] of salesBy.entries()) { nameById.set(eid, f?.employee_name); brById.set(eid, Number(f?.branch_id)); }
  for (const e of list) { if (!nameById.get(Number(e.employee_id))) nameById.set(Number(e.employee_id), e.employee_name); if (!brById.get(Number(e.employee_id))) brById.set(Number(e.employee_id), Number(e.branch_id)); }

  // Эталоны сети: лучший по «Защите от экранов» и лучший филиал по доле «только линзы»
  let screenBest = { name: '', pct: -1 };
  let scrSum = 0, scrN = 0;
  for (const [eid, f] of lensBy.entries()) {
    if (roleById.get(eid) !== 'seller') continue;
    const p = num(f?.lens?.screen_pct);
    if (f?.lens && num(f.lens.total) > 0) { scrSum += p; scrN++; if (p > screenBest.pct) screenBest = { name: nameById.get(eid) || '', pct: p }; }
  }
  const screenNetAvg = scrN > 0 ? Math.round(scrSum / scrN) : 0; // средняя доля «Защиты от экранов» по продавцам — честный ориентир «норма»
  let lensOnlyBest = { branch: '', pct: 999 };
  for (const [bid, f] of branchFrames.entries()) {
    const p = num(f?.lens_only_pct);
    if (f?.lens_orders > 0 && p < lensOnlyBest.pct) lensOnlyBest = { branch: branchName.get(bid) || '', pct: p };
  }
  // Сетевой средний чек на оправу (взвешенно по проданным оправам) — для совета про якорение
  let fSumP = 0, fSumN = 0;
  for (const [, f] of branchFrames.entries()) {
    const n = num(f?.frames_sold), a = num(f?.avg_frame_price);
    if (n > 0 && a > 0) { fSumP += a * n; fSumN += n; }
  }
  const frameAvgNetwork = fSumN > 0 ? Math.round(fSumP / fSumN) : 0;

  // Долги: лучший филиал (мин % долга) и средний по сети — для сравнения в тексте
  let debtBest = { branch: '', pct: 999 };
  let debtNetSum = 0, debtNetSales = 0;
  for (const [bid, f] of debtBy.entries()) {
    if (num(f?.sales_sum) <= 0) continue;
    debtNetSum += num(f?.debt_sum); debtNetSales += num(f?.sales_sum);
    if (num(f?.debt_pct) < debtBest.pct) debtBest = { branch: branchName.get(bid) || '', pct: num(f?.debt_pct) };
  }
  const debtNetPct = debtNetSales > 0 ? Math.round((100 * debtNetSum) / debtNetSales) : 0;

  // Заказов в день (неделя) по продавцу + сетевой ориентир (co-shift пропускаем — продажи общие)
  const opdById = new Map<number, number>();
  for (const e of list) {
    const eid = Number(e.employee_id), d = discBy.get(eid), s = salesBy.get(eid);
    const wd = num(d?.work_days), wo = num(s?.sales_week?.orders);
    if (wd > 0 && wo > 0 && !d?.coshift) opdById.set(eid, wo / wd);
  }
  const opdVals = [...opdById.values()];
  const opdNet = opdVals.length ? Math.round((opdVals.reduce((a, b) => a + b, 0) / opdVals.length) * 10) / 10 : 0;

  // Кто сколько переписки сети тянет (доля). Только продавцы (промоутер исключён).
  let netThreads = 0;
  const msgShareById = new Map<number, number>();
  for (const [eid, m] of msgBy.entries()) { if (roleById.get(eid) === 'seller') netThreads += num(m?.threads); }
  let msgTop = { name: '', pct: 0 };
  for (const [eid, m] of msgBy.entries()) {
    if (roleById.get(eid) !== 'seller') continue;
    const p = netThreads > 0 ? Math.round((100 * num(m?.threads)) / netThreads) : 0;
    msgShareById.set(eid, p);
    if (p > msgTop.pct) msgTop = { name: nameById.get(eid) || '', pct: p };
  }

  // Сменные (co-shift) агрегаты по филиалу: продажи + взвешенная доля «Защиты от экранов»
  const shiftByBranch = new Map<number, any>();
  for (const e of list) {
    const eid = Number(e.employee_id), bid = Number(e.branch_id);
    const disc = discBy.get(eid);
    if (!disc?.coshift) continue;
    if (!shiftByBranch.has(bid)) shiftByBranch.set(bid, { mOrders: 0, mRev: 0, wOrders: 0, wRev: 0, screenNum: 0, lensTotal: 0, members: new Set() });
    const agg = shiftByBranch.get(bid);
    if (agg.members.has(eid)) continue;
    agg.members.add(eid);
    const s = salesBy.get(eid), l = lensBy.get(eid);
    if (s?.sales_month) { agg.mOrders += num(s.sales_month.orders); agg.mRev += num(s.sales_month.revenue); }
    if (s?.sales_week) { agg.wOrders += num(s.sales_week.orders); agg.wRev += num(s.sales_week.revenue); }
    if (l?.lens) { agg.lensTotal += num(l.lens.total); agg.screenNum += Math.round(num(l.lens.screen_pct) * num(l.lens.total) / 100); }
  }

  const weekIndex = Math.floor(Date.parse(week + 'T00:00:00Z') / (7 * 864e5));

  const facts: any[] = [];
  list.forEach((e: any, i: number) => {
    const eid = Number(e.employee_id), bid = Number(e.branch_id);
    const s = salesBy.get(eid), l = lensBy.get(eid), d = discBy.get(eid), m = msgBy.get(eid);
    const coshift = !!d?.coshift;
    const shift = coshift ? shiftByBranch.get(bid) : null;
    const disc = d ? {
      period_mode: period,
      days: period === 'week' ? d.days : null, // для месяца/«с открытия» по дням не перечисляем — сводка
      work_days: d.work_days, late_days: d.late_days, penalty_week: d.penalty_week,
      prev_late_sum: d.prev_late_sum, broken_schedule: !!d.broken_schedule,
      clean: num(d.penalty_week) === 0, streak_no_late: num(d.streak_no_late),
    } : null;
    // Оправы: средний чек vs сеть → tier (low/ok/high). При <5 проданных оправ совет не даём.
    const fr = l?.frames || null;
    let framesFact: any = fr;
    if (fr && fr.avg_frame_price != null && frameAvgNetwork > 0) {
      const enough = num(fr.lens_orders) - num(fr.lens_only) >= 5;
      const tier = fr.avg_frame_price <= frameAvgNetwork * 0.90 ? 'low' : fr.avg_frame_price >= frameAvgNetwork * 1.12 ? 'high' : 'ok';
      framesFact = { ...fr, tier: enough ? tier : null, vs_network_pct: Math.round(100 * (num(fr.avg_frame_price) / frameAvgNetwork - 1)), network_avg: frameAvgNetwork };
    }
    let lensFact = coshift && shift && shift.lensTotal > 0
      ? { screen_pct: Math.round((shift.screenNum / shift.lensTotal) * 100), shift: true }
      : (l?.lens || null);
    // Вердикт по «Защите от экранов» считаем В КОДЕ, чтобы LLM не выдумывал разрыв из шума.
    // strong — ≥40% ИЛИ в пределах 5 пунктов от лидера (по сути вровень); ok — 25–40%; low — <25%.
    if (lensFact && lensFact.screen_pct != null) {
      const sp = num(lensFact.screen_pct);
      const nearBest = screenBest.pct > 0 && screenBest.pct - sp <= 5; // в пределах погрешности от лучшего
      const screen_verdict = sp >= 40 || nearBest ? 'strong' : sp >= 25 ? 'ok' : 'low';
      lensFact = { ...lensFact, screen_verdict, net_avg: screenNetAvg || null, best_pct: screenBest.pct > 0 ? screenBest.pct : null, near_best: nearBest };
    }
    const opd = opdById.get(eid) != null ? Math.round(opdById.get(eid)! * 10) / 10 : null;
    const msgFact = m && (m.threads > 0 || (m.slow || []).length) ? { ...m, share_pct: msgShareById.get(eid) ?? null } : null;
    const score = score360By.get(eid) || null;
    const prevS = prevScoreBy.get(eid);
    const progress = score?.final != null && prevS?.final != null
      ? { score_now: score.final, score_prev: prevS.final, orders_now: num(s?.sales_week?.orders), orders_prev: num(prevS.orders) }
      : null;
    const cancellations = (s?.cancellations || []).filter((r: string) => r && r !== 'cancelled_by_seller');
    // Долги по филиалу (сигнал, если заметно выше сети) + контекст справедливости (сезон/погода/промоутер)
    const bd = debtBy.get(bid) || null;
    const debtHigh = bd && num(bd.debt_pct) >= 10 && num(bd.debt_pct) >= debtNetPct * 1.5;
    const debts = bd ? { debt_sum: num(bd.debt_sum), debt_pct: num(bd.debt_pct), debt_orders: num(bd.debt_orders), net_pct: debtNetPct, best_branch: debtBest.pct < 999 ? debtBest.branch : null, best_pct: debtBest.pct < 999 ? debtBest.pct : null, high: !!debtHigh } : null;
    const context = ctx?.contextFor ? ctx.contextFor(bid) : null;

    // Итог: что хорошо / что подтянуть (детерминированно, по 2 на сторону; формулирует LLM)
    const good: string[] = [], fix: string[] = [];
    if (progress && progress.score_now - progress.score_prev >= 0.5) good.push('оценка выросла к прошлой неделе');
    if (disc && num(disc.streak_no_late) >= 10) good.push(`${disc.streak_no_late} дней подряд без опозданий`);
    if (disc?.clean) good.push('дисциплина чистая — приходит вовремя');
    if (lensFact && num(lensFact.screen_pct) >= 40) good.push('хорошо предлагает Защиту от экранов');
    if (framesFact?.tier === 'high') good.push('высокий средний чек на оправу');
    if (msgFact && num(msgFact.avg_score) >= 6.5 && num(msgFact.threads) >= 5) good.push('хорошее качество переписки с клиентами');
    if (score?.final != null && score.final >= 7) good.push('сильная неделя по общей оценке');
    if (disc && num(disc.penalty_week) > 0) fix.push('опоздания и штрафы');
    if (msgFact && ((msgFact.slow || []).length || num(msgFact.template_dumps) >= 5 || (msgFact.avg_score != null && num(msgFact.avg_score) < 5))) fix.push('переписка: отвечать быстрее и не отписываться шаблоном на жалобу');
    if (lensFact && lensFact.screen_pct != null && num(lensFact.screen_pct) < 25) fix.push('мало предлагает Защиту от экранов');
    if (framesFact?.tier === 'low') fix.push('низкий средний чек на оправу — показывать оправу поинтереснее');
    if (opd != null && opdNet > 0 && opd < opdNet * 0.7) fix.push('мало заказов за неделю — поднять поток');
    if (msgFact && msgFact.share_pct != null && num(msgFact.share_pct) < 10 && num(msgFact.threads) < 5 && netThreads >= 20) fix.push('почти не берёт клиентов в переписке — отвечать активнее');
    if (cancellations.length >= 3) fix.push('много отменённых заказов');
    if (debts?.high) fix.push('много долгов клиентов по филиалу — дозванивать и закрывать');

    const f: any = {
      employee_id: eid, employee_name: e.employee_name, branch_id: bid, branch_name: e.branch_name,
      period_mode: period,
      period_label: period === 'all'
        ? `с открытия ${ddmy(branchStart.get(bid) || week)} по ${ddmy(weekEnd)}`
        : periodLabel,
      week_label: `${ddShort(week)}–${ddShort(weekEnd)}`,
      coshift,
      score, // {final, label, sub:{sales,service,discipline,voice}, is_voice_pilot}
      progress, // прогресс к прошлой неделе: балл и заказы
      premium: premiumByBranch.get(bid) || null, // до месячного плана филиала (премия командная)
      service: serviceBy.get(eid) || null, // выдача (дни/заполнение) + звонок клиенту
      debts, // долги клиентов по филиалу + сравнение с сетью (показывать при high)
      context, // сезон/погода/промоутер — для справедливости в «Продажах»
      sales: {
        month: s?.sales_month || null, week: s?.sales_week || null,
        orders_per_day: opd,
        shift: shift ? { month_orders: shift.mOrders, month_revenue: shift.mRev, week_orders: shift.wOrders, week_revenue: shift.wRev, avg_check: shift.wOrders ? Math.round(shift.wRev / shift.wOrders) : null } : null,
      },
      lens: lensFact,
      frames: framesFact,
      branch_frames: branchFrames.get(bid) || null,
      benchmarks: { screen_best: screenBest.pct >= 0 ? screenBest : null, lens_only_best: lensOnlyBest.pct < 999 ? lensOnlyBest : null, frame_avg_network: frameAvgNetwork || null, orders_per_day_net: opdNet || null, msg_top: msgTop.pct > 0 ? msgTop : null },
      messaging: msgFact,
      discipline: disc,
      mood: d && d.feedback_entries > 0 ? { mood_week: d.mood_week, real_notes: d.real_notes || [] } : null,
      cancellations,
      summary_signals: { good: good.slice(0, 2), fix: fix.slice(0, 2) },
      lesson: LESSON_BANK[(weekIndex + i) % LESSON_BANK.length],
    };
    facts.push(f);
  });

  // Служебный блок ВЛАДЕЛЬЦУ (не в текст продавцу)
  const ownerNotes: string[] = [];
  const hotBranches = new Set<string>();
  for (const [eid, d] of discBy.entries()) {
    for (const note of (d?.real_notes || []) as string[]) {
      if (/кондиционер|жарко|душно|кулл?ер|жара/i.test(note)) hotBranches.add(branchName.get(brById.get(eid) || 0) || '');
    }
  }
  if (hotBranches.size) ownerNotes.push(`Жара: сотрудники (${[...hotBranches].filter(Boolean).join(', ')}) независимо просят кондиционер/кулер — это условия труда, стоит решить.`);
  const broken = list.filter((e: any) => discBy.get(Number(e.employee_id))?.broken_schedule).map((e: any) => e.employee_name);
  if (broken.length) ownerNotes.push(`График в системе не настроен у: ${broken.join(', ')} (большие отклонения при нулевом штрафе) — сначала почините график, потом меряйте дисциплину.`);
  const highDebt = [...debtBy.entries()].filter(([, f]) => num(f?.debt_pct) >= 10 && num(f?.sales_sum) > 0).sort((a, b) => num(b[1].debt_pct) - num(a[1].debt_pct));
  if (highDebt.length) ownerNotes.push(`Долги клиентов выше нормы: ${highDebt.map(([bid, f]) => `${branchName.get(bid)} ${f.debt_pct}% (${fmt(f.debt_sum)} с)`).join(', ')} — при ~${debtNetPct}% по сети. Нужно дозванивать и закрывать остатки.`);

  let textBy = new Map<number, string>();
  let llm: any = null;
  if (facts.length > 0) {
    const userPrompt = `Период: ${period === 'all' ? 'с открытия по ' + weekEnd : week + ' — ' + weekEnd} (тип: ${period}). У каждого сотрудника в факте есть period_label и period_mode — опирайся на них (в шапке используй period_label, прогресс и дисциплину подавай по period_mode). Числа и цитаты только отсюда:\n${JSON.stringify(facts, null, 1)}`;
    const res = await runLlmAnalysis(model, SYSTEM_EMPLOYEE, userPrompt);
    llm = { model: res.model, cost_usd: res.cost_usd, input_tokens: res.input_tokens, output_tokens: res.output_tokens };
    const parsed = parseJson(res.content);
    for (const e of parsed.employees || []) textBy.set(Number(e.employee_id), String(e.text || ''));
  }

  const byBranch = new Map<number, { branch_id: number; branch_name: string; employees: any[] }>();
  for (const f of facts) {
    if (!byBranch.has(f.branch_id)) byBranch.set(f.branch_id, { branch_id: f.branch_id, branch_name: f.branch_name, employees: [] });
    byBranch.get(f.branch_id)!.employees.push({ ...f, text: textBy.get(f.employee_id) || '' });
  }
  return { week, week_end: weekEnd, period, period_label: periodLabel, branches: Array.from(byBranch.values()), owner_notes: ownerNotes, llm };
}

/* ─────────────── ИТОГИ ПРОИЗВОЛЬНОГО ПЕРИОДА (месяц / год / с открытия) ─────────────── */

const SYSTEM_PERIOD = `${HUMAN_STYLE}

Это ИТОГИ ПЕРИОДА (месяц/год). Похвалу можно сделать на 1 предложение богаче, чем в недельном, но правила те же: человеческий язык, без терминов, формат «заголовок → похвала → Что улучшить».
- Динамику к прошлому периоду подавай С УЧЁТОМ СЕЗОНА (season.expected_delta_pct): спад в рамках сезона — норма, не подавай как провал. Для ТЦ дождь/мороз часто плюс.
- Можно по-человечески и по желанию отметить интересный факт об аудитории (demography: «больше всего к вам приходят женщины 45–60») или о постоянных клиентах (retention: «к вам возвращаются» — если повторных заметно много), но БЕЗ процентов и терминов, и только если это реально интересно.
- Выбери ОДНОГО лидера периода (🏆) — по выручке.
В network_note дай 1–2 человеческие строки по всей сети: общая выручка и заказы за период, коротко про мобильное приложение, и если уместно — пару слов про аудиторию сети (кто основные покупатели). Простыми словами, без терминов и процентов-коэффициентов.

ФОРМАТ ОТВЕТА — СТРОГО JSON без markdown: {"leader_branch_id":<id>,"network_note":"<строка по сети>","branches":[{"branch_id":<id>,"text":"<готовое сообщение с \\n>"}]}`;

export async function generatePeriodRecap(
  sb: SupabaseClient,
  opts: { from: string; to: string; prevFrom?: string; prevTo?: string; label: string; model?: LlmModelId; planMonth?: string },
) {
  const model: LlmModelId = opts.model || 'claude-opus-4-8';
  const profsRes = await sb.from('branch_profile').select('*');
  const profs = (profsRes.data || []) as any[];
  const names: string[] = profs.map((p) => p.branch_name);
  const profObjById = new Map(profs.map((p: any) => [Number(p.branch_id), p]));
  const mFrom = monthNum(opts.from);
  const mPrev = opts.prevFrom ? monthNum(opts.prevFrom) : null;

  const [cur, prev, planEffRes, planPremRes, weatherRes, promoRes, termsRes, coreRes, seasonRes, ...nvr] = await Promise.all([
    sb.rpc('admin_period_by_branch', { from_dt: opts.from, to_dt: opts.to, branches: null }),
    opts.prevFrom ? sb.rpc('admin_period_by_branch', { from_dt: opts.prevFrom, to_dt: opts.prevTo, branches: null }) : Promise.resolve({ data: [] as any[] } as any),
    opts.planMonth ? sb.from('v_payroll_branch_plan_effective').select('*').eq('month', opts.planMonth) : Promise.resolve({ data: [] as any[] } as any),
    opts.planMonth ? sb.from('v_payroll_plan_premium_monthly_branch').select('*').eq('month', opts.planMonth) : Promise.resolve({ data: [] as any[] } as any),
    sb.from('branch_weather_daily').select('*').gte('d', opts.from).lte('d', opts.to),
    sb.from('expenses').select('terminal_code,expense_date').eq('category', 'promoter_salary').gte('expense_date', opts.from).lte('expense_date', opts.to),
    sb.from('terminals').select('terminal_code,branch_id'),
    sb.from('v_ai_owner_weekly_branch_core').select('branch_id,late_minutes_sum,early_leave_minutes_sum,penalty_total_sum,refunds_count,refunds_amount,worked_hours,delivered_total_amount,week_start').gte('week_start', opts.from).lte('week_start', opts.to),
    sb.from('seasonality_index').select('month,coef').eq('scope', 'network'),
    ...names.map((nm) => sb.rpc('admin_new_vs_returning', { from_dt: opts.from, to_dt: opts.to, branches: [nm] })),
  ]);
  const checks = await Promise.all(names.map((nm) => sb.rpc('admin_avg_median_check', { from_dt: opts.from, to_dt: opts.to, branches: [nm] })));
  const [mobile, deepBy, msgBy, finBy, retBy, demoBy] = await Promise.all([
    loadNetworkMobile(sb, opts.from, opts.to),
    loadDeepFacts(sb, opts.from, opts.to),
    loadMessaging(sb, opts.from, opts.to),
    loadBranchFacts(sb, 'app_branch_finance', opts.from, opts.to),
    loadBranchFacts(sb, 'app_branch_retention', opts.from, opts.to),
    loadBranchFacts(sb, 'app_branch_demography', opts.from, opts.to),
  ]);

  const nvrByName = new Map<string, any>();
  names.forEach((nm, i) => nvrByName.set(nm, (((nvr[i] as any)?.data || [])[0]) || null));
  const checkByName = new Map<string, any>();
  names.forEach((nm, i) => checkByName.set(nm, (((checks[i] as any)?.data || [])[0]) || null));

  const profByName = new Map(profs.map((p) => [p.branch_name, Number(p.branch_id)]));
  const prevByName = new Map((((prev as any).data || []) as any[]).map((r: any) => [r.branch, r]));
  const planEffByBranch = new Map((((planEffRes as any).data || []) as any[]).map((r: any) => [Number(r.branch_id), r]));
  const planPremByBranch = new Map((((planPremRes as any).data || []) as any[]).map((r: any) => [Number(r.branch_id), r]));

  const wxRowsByBranch = new Map<number, any[]>();
  for (const w of (((weatherRes as any).data || []) as any[])) {
    const b = Number(w.branch_id);
    if (!wxRowsByBranch.has(b)) wxRowsByBranch.set(b, []);
    wxRowsByBranch.get(b)!.push(w);
  }
  const t2b = new Map((((termsRes as any).data || []) as any[]).map((t: any) => [t.terminal_code, Number(t.branch_id)]));
  const promoByBranch = new Map<number, Set<string>>();
  for (const e of (((promoRes as any).data || []) as any[])) {
    const b = t2b.get(e.terminal_code);
    if (b == null) continue;
    if (!promoByBranch.has(b)) promoByBranch.set(b, new Set());
    promoByBranch.get(b)!.add(e.expense_date);
  }
  const discByBranch = new Map<number, { late: number; early: number; pen: number; refCnt: number; refAmt: number; hours: number; rev: number }>();
  for (const c of (((coreRes as any).data || []) as any[])) {
    const b = Number(c.branch_id);
    const o = discByBranch.get(b) || { late: 0, early: 0, pen: 0, refCnt: 0, refAmt: 0, hours: 0, rev: 0 };
    o.late += num(c.late_minutes_sum);
    o.early += num(c.early_leave_minutes_sum);
    o.pen += num(c.penalty_total_sum);
    o.refCnt += num(c.refunds_count);
    o.refAmt += num(c.refunds_amount);
    o.hours += num(c.worked_hours);
    o.rev += num(c.delivered_total_amount);
    discByBranch.set(b, o);
  }
  const coefBy = new Map((((seasonRes as any).data || []) as any[]).map((s: any) => [Number(s.month), num(s.coef)]));
  const cFrom = coefBy.get(mFrom), cPrev = mPrev != null ? coefBy.get(mPrev) : null;
  const expectedSeasonalPct = cFrom && cPrev ? Math.round((cFrom / cPrev - 1) * 100) : null;

  const curRows = (((cur as any).data || []) as any[]).filter((r) => profByName.has(r.branch));
  const networkRevenue = curRows.reduce((s, r) => s + num(r.ov_revenue), 0);
  const networkOrders = curRows.reduce((s, r) => s + num(r.ov_orders), 0);

  const items: any[] = [];
  for (const r of curRows) {
    const bid = profByName.get(r.branch)!;
    const orders = num(r.ov_orders), rev = num(r.ov_revenue);
    const pv: any = prevByName.get(r.branch);
    const pRev = pv ? num(pv.ov_revenue) : 0, pOrders = pv ? num(pv.ov_orders) : 0;
    const nv = nvrByName.get(r.branch), chk = checkByName.get(r.branch);
    const avg = chk ? Math.round(num(chk.avg_check)) : orders ? Math.round(rev / orders) : 0;
    const pe: any = planEffByBranch.get(bid), pp: any = planPremByBranch.get(bid);
    const target = pe ? num(pe.monthly_turnover_target) : null;
    const turnover = pp ? num(pp.turnover_sum) : null;
    const disc = discByBranch.get(bid) || { late: 0, early: 0, pen: 0, refCnt: 0, refAmt: 0, hours: 0, rev: 0 };
    // SPLH = выручка периода (ov_revenue) / отработанные человеко-часы. delivered_total_amount
    // отстаёт из-за лага доставки, поэтому в знаменателе часы, а в числителе — выручка периода.
    const splh = disc.hours > 0 ? Math.round(rev / disc.hours) : null;
    const struct = deepBy.get(bid) || null;
    const msg = msgBy.get(bid) || null;
    const f: any = {
      branch_id: bid, branch_name: r.branch,
      actual: {
        orders, delivered_revenue: rev, avg_check: avg,
        median_check: chk ? Math.round(num(chk.median_check)) : null,
        new_customers: nv ? num(nv.new_customers) : null,
        returning_customers: nv ? num(nv.returning_customers) : null,
        returning_share_pct: nv ? Math.round(num(nv.returning_share) * 100) : null,
        late_minutes: disc.late, early_leave_minutes: disc.early, penalties: disc.pen, refunds_count: disc.refCnt,
        worked_hours: Math.round(disc.hours),
      },
      network_share_pct: networkRevenue > 0 ? Math.round((rev / networkRevenue) * 100) : null,
      delta_pct: {
        revenue: pRev > 0 ? Math.round((rev / pRev - 1) * 100) : null,
        orders: pOrders > 0 ? Math.round((orders / pOrders - 1) * 100) : null,
      },
      season: { phase: cFrom ? seasonPhase(cFrom) : null, expected_delta_pct: expectedSeasonalPct },
      weather: buildWeatherProfile(wxRowsByBranch.get(bid) || [], profObjById.get(bid)),
      promoter: { days: promoByBranch.get(bid)?.size || 0, present: (promoByBranch.get(bid)?.size || 0) > 0 },
      plan: target != null ? { target, turnover, pct_to_plan: turnover != null ? Math.round((turnover / target) * 100) : null } : null,
      splh,            // выручка за человеко-час
      structure: struct, // структура продаж + frame/accessory-attach + премиум-микс
      messaging: msg,    // качество клиентских диалогов
      retention: retBy.get(bid) || null,   // повторные покупки / удержание
      demography: demoBy.get(bid) || null, // возраст/пол покупателей периода
      is_launch_ramp: isLaunchRamp((profObjById.get(bid) as any)?.effective_start, opts.to),
      nominations: [] as string[],
    };
    const n: string[] = [];
    if (f.delta_pct.revenue != null && f.delta_pct.revenue >= 5) n.push(`выручка +${f.delta_pct.revenue}%`);
    if (f.actual.returning_customers) n.push(`${f.actual.returning_customers} вернувшихся (${f.actual.returning_share_pct}%)`);
    if (f.plan?.pct_to_plan != null) n.push(`план ${f.plan.pct_to_plan}%`);
    if (f.actual.late_minutes === 0 && f.actual.penalties === 0 && f.actual.early_leave_minutes === 0) n.push('дисциплина чистая');
    if (struct?.frame_attach_pct != null && struct.frame_attach_pct >= 85) n.push(`оправа к ${struct.frame_attach_pct}% заказов`);
    if (struct?.accessory_attach_pct != null && struct.accessory_attach_pct >= 40) n.push(`аксессуары к ${struct.accessory_attach_pct}%`);
    if (struct?.premium_lens_share_pct != null && struct.premium_lens_share_pct >= 40) n.push(`${struct.premium_lens_share_pct}% премиум-линз`);
    if (splh != null && splh > 0) n.push(`${fmt(splh)} с/час`);
    if (msg && msg.avg_score != null && msg.threads >= 5 && msg.avg_score >= 6) n.push(`диалоги ${msg.avg_score}/10`);
    if (orders > 0) n.push(`${orders} заказов, ${fmt(rev)} с`);
    f.nominations = n;
    items.push(f);
  }
  if (items.length === 0) throw new Error('Нет данных за период');

  // Демография по сети = сумма по филиалам (задвоение клиентов из >1 филиала ~0.4% — пренебрежимо)
  const sumDemo = (key: 'age' | 'gender', sub: string) =>
    Array.from(demoBy.values()).reduce((s: number, d: any) => s + num(d?.[key]?.[sub]), 0);
  const networkDemo = demoBy.size
    ? {
        purchasers: Array.from(demoBy.values()).reduce((s: number, d: any) => s + num(d?.purchasers), 0),
        age: { a17: sumDemo('age', 'a17'), a18_25: sumDemo('age', 'a18_25'), a26_35: sumDemo('age', 'a26_35'), a36_45: sumDemo('age', 'a36_45'), a46_60: sumDemo('age', 'a46_60'), a60p: sumDemo('age', 'a60p'), unknown: sumDemo('age', 'unknown') },
        gender: { F: sumDemo('gender', 'F'), M: sumDemo('gender', 'M'), unknown: sumDemo('gender', 'unknown') },
      }
    : null;
  const network = { revenue: networkRevenue, orders: networkOrders, mobile, demography: networkDemo };
  const leaderFallback = [...items].sort((a, b) => b.actual.delivered_revenue - a.actual.delivered_revenue)[0]?.branch_id;
  const userPrompt = `Период: ${opts.label} (${opts.from} — ${opts.to})${opts.prevFrom ? `, сравнение с предыдущим периодом (${opts.prevFrom} — ${opts.prevTo})` : ', без сравнения с прошлым'}.\nПо сети: ${JSON.stringify(network)}.\nФакт-лист по филиалам (только эти числа, не выдумывай):\n${JSON.stringify(items, null, 1)}`;
  const res = await runLlmAnalysis(model, SYSTEM_PERIOD, userPrompt);
  const parsed = parseJson(res.content);
  const leader = parsed.leader_branch_id != null ? Number(parsed.leader_branch_id) : leaderFallback;
  const textBy = new Map<number, string>();
  for (const b of parsed.branches || []) textBy.set(Number(b.branch_id), String(b.text || ''));

  // finance (LCR/маржа линз) — ВНУТРЕННЕЕ: добавляем после LLM, в групповой текст не уходит
  const out = items.map((f) => ({ ...f, text: textBy.get(f.branch_id) || '', is_leader: f.branch_id === leader, finance: finBy.get(f.branch_id) || null }));
  return { week: opts.from, week_end: opts.to, period_label: opts.label, leader_branch_id: leader, network, network_note: parsed.network_note || '', items: out, llm: { model: res.model, cost_usd: res.cost_usd, input_tokens: res.input_tokens, output_tokens: res.output_tokens } };
}

function parseJson(content: string): any {
  const raw = (content || '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('LLM вернул не-JSON');
  return JSON.parse(raw.slice(s, e + 1));
}
