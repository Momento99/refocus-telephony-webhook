'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Users,
  RefreshCw,
  Sparkles,
  X,
  TrendingUp,
  HeartPulse,
  Briefcase,
  Shield,
  Mic,
  MessageCircle,
  Instagram,
  Receipt,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Trophy,
  Clock,
  Coins,
  Building2,
  LogOut,
  Monitor,
  Smile,
} from 'lucide-react';
import toast from 'react-hot-toast';

type LlmModel = 'gemma3:12b' | 'claude-haiku-4-5' | 'claude-opus-4-7';
type Period = 'week' | 'month' | 'quarter';

type Row = {
  employee_id: number;
  full_name: string;
  role: string;
  is_active: boolean;
  branch_id: number;
  branch_name: string | null;
  audio_chunks_count: number;
  audio_avg_score: number | null;
  audio_rude_count: number;
  audio_pushy_count: number;
  wa_threads_count: number;
  wa_analyzed_count: number;
  wa_avg_score: number | null;
  wa_critical_count: number;
  ig_threads_count: number;
  ig_analyzed_count: number;
  ig_avg_score: number | null;
  ig_critical_count: number;
  orders_count: number;
  revenue_total: number;
  avg_check: number;
  frame_items_count: number;
  lens_items_count: number;
  sessions_count: number;
  hours_worked: number;
  penalty_minutes: number;
  penalty_count: number;
  late_minutes_total: number;
  afk_minutes_total: number;
  bonus_amount: number;
  fine_amount: number;
  feedback_daily_count: number;
  feedback_weekly_count: number;
  feedback_avg_mood: number | null;
  is_voice_pilot: boolean;
  app_exits_count: number;
  app_exits_seconds_total: number;
  app_exits_longest_seconds: number;
};

type FocusEvent = {
  id: number;
  terminal_code: string;
  event_kind: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
};

function fmtFocusDuration(sec: number): string {
  if (!sec) return '0 с';
  if (sec < 60) return `${sec} с`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s ? `${m} мин ${s} с` : `${m} мин`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h} ч ${mm} мин` : `${h} ч`;
}

function focusKindLabel(kind: string): string {
  if (kind === 'hidden') return 'свернул окно';
  if (kind === 'blur') return 'Alt+Tab';
  return kind;
}

/** Порядок филиалов по умолчанию (как просил владелец). */
const BRANCH_ORDER: string[] = ['Сокулук', 'Беловодск', 'Кара-Балта', 'Кант', 'Токмок'];

const LLM_CHOICES: Array<{ id: LlmModel; label: string; hint: string }> = [
  { id: 'gemma3:12b', label: 'Gemma', hint: 'Бесплатно, локально' },
  { id: 'claude-haiku-4-5', label: 'Haiku', hint: '≈$0.001/сотрудника' },
  { id: 'claude-opus-4-7', label: 'Opus', hint: 'Премиум, ≈$0.02' },
];

/**
 * Вычисление 360°-скоров на клиенте. Все подскоры — 0..10.
 * Все таргеты нормализованы по длине периода — 7/30/90 дней дают сравнимые баллы.
 *
 * @param revenueMaxNetwork — максимальная выручка по сети (не только в филиале).
 *   Раньше сравнивали внутри филиала → одинокий продавец автоматом получал 10/10.
 * @param periodDays — длина периода в днях (week=7, month=30, quarter=90).
 */
function computeScores(r: Row, revenueMaxNetwork: number, periodDays: number) {
  // Service (0..10): аудио 50 / WA 30 / IG 20 с динамическим перераспределением
  const serviceParts: Array<{ weight: number; value: number }> = [];
  if (r.audio_avg_score != null) serviceParts.push({ weight: 50, value: Number(r.audio_avg_score) });
  if (r.wa_avg_score != null) serviceParts.push({ weight: 30, value: Number(r.wa_avg_score) });
  if (r.ig_avg_score != null) serviceParts.push({ weight: 20, value: Number(r.ig_avg_score) });
  const serviceWeightTotal = serviceParts.reduce((s, p) => s + p.weight, 0);
  const service =
    serviceWeightTotal > 0
      ? serviceParts.reduce((s, p) => s + (p.weight * p.value) / serviceWeightTotal, 0)
      : null;

  // Sales (0..10) — все таргеты нормализованы по периоду.
  // Premium mix (lens/order) убран: на реальных данных у всех 88-100% (продажа линз —
  // норма для оптики), метрика не дифференцирует продавцов. Веса перераспределены.
  const revShare = revenueMaxNetwork > 0 ? Math.min(1, r.revenue_total / revenueMaxNetwork) : 0;
  const revenueScore = revShare * 10;
  const avgCheckScore = Math.min(10, Math.max(0, (r.avg_check / 4000) * 10)); // 4000 KGS = 10
  const orderCountTarget = Math.max(1, 30 * periodDays / 7);
  const orderCountScore = Math.min(10, (r.orders_count / orderCountTarget) * 10);
  const sales =
    r.orders_count === 0
      ? null
      : revenueScore * 0.6 + avgCheckScore * 0.25 + orderCountScore * 0.15;

  // Discipline (0..10) — таргеты нормализованы по периоду
  // #2: hours target = 48ч/неделю → масштабируется
  const hoursTarget = Math.max(1, 48 * periodDays / 7);
  const hoursScore = Math.min(10, (r.hours_worked / hoursTarget) * 10);
  const penaltyScore = Math.max(0, 10 - r.penalty_count * 2);
  // late: 1 ч опоздания / неделю = -1 балл, на длинных периодах пропорционально
  const lateNormalizedHours = (r.late_minutes_total / 60) * (7 / periodDays);
  const lateScore = Math.max(0, 10 - lateNormalizedHours);
  const discipline =
    r.sessions_count === 0 ? null : hoursScore * 0.4 + penaltyScore * 0.3 + lateScore * 0.3;

  // Voice (только если филиал участвует в voice-пилоте, флаг is_voice_pilot)
  const voice =
    r.is_voice_pilot && r.feedback_avg_mood != null
      ? Math.min(10, (Number(r.feedback_avg_mood) / 5) * 10)
      : null;

  // Final 360°: Service 40 / Sales 30 / Discipline 15 / Voice 15
  const finalParts: Array<{ weight: number; value: number }> = [];
  if (service != null) finalParts.push({ weight: 40, value: service });
  if (sales != null) finalParts.push({ weight: 30, value: sales });
  if (discipline != null) finalParts.push({ weight: 15, value: discipline });
  if (voice != null) finalParts.push({ weight: 15, value: voice });
  const wTotal = finalParts.reduce((s, p) => s + p.weight, 0);
  const final360 =
    wTotal > 0 ? finalParts.reduce((s, p) => s + (p.weight * p.value) / wTotal, 0) : null;

  return { service, sales, discipline, voice, final360 };
}

function scoreColor(score: number | null): { ring: string; text: string; bg: string; label: string } {
  if (score == null) return { ring: '#CBD5E1', text: 'text-slate-500', bg: 'bg-slate-50', label: '—' };
  if (score >= 8.5) return { ring: '#10B981', text: 'text-emerald-700', bg: 'bg-emerald-50', label: 'Топ' };
  if (score >= 7) return { ring: '#06B6D4', text: 'text-cyan-700', bg: 'bg-cyan-50', label: 'Хорошо' };
  if (score >= 5) return { ring: '#F59E0B', text: 'text-amber-700', bg: 'bg-amber-50', label: 'Средне' };
  if (score >= 3) return { ring: '#F97316', text: 'text-orange-700', bg: 'bg-orange-50', label: 'Ниже' };
  return { ring: '#E11D48', text: 'text-rose-700', bg: 'bg-rose-50', label: 'Риск' };
}

function ScoreRing({ score, size = 64 }: { score: number | null; size?: number }) {
  const sColor = scoreColor(score);
  const pct = score == null ? 0 : Math.max(0, Math.min(1, score / 10));
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E2E8F0" strokeWidth="6" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={sColor.ring}
          strokeWidth="6"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center leading-tight">
          <div className={`text-lg font-bold ${sColor.text}`}>{score == null ? '—' : score.toFixed(1)}</div>
        </div>
      </div>
    </div>
  );
}

function formatMoney(n: number) {
  return Math.round(n).toLocaleString('ru-RU');
}

function periodDates(p: Period): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const d = new Date(now);
  if (p === 'week') d.setDate(d.getDate() - 6);
  else if (p === 'month') d.setDate(d.getDate() - 29);
  else d.setDate(d.getDate() - 89);
  const from = d.toISOString().slice(0, 10);
  return { from, to };
}

export default function TeamDashboardPage() {
  const [period, setPeriod] = useState<Period>('week');
  const [model, setModel] = useState<LlmModel>('claude-haiku-4-5');
  const [rows, setRows] = useState<Row[]>([]);
  const [commentary, setCommentary] = useState<Record<number, Array<{ model: string; summary: string; created_at: string }>>>({});
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { from, to } = useMemo(() => periodDates(period), [period]);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/team?from=${from}&to=${to}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Ошибка');
      setRows(j.rows ?? []);
      setCommentary(j.commentary ?? {});
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [from, to]);

  // Группировка по филиалу в кастомном порядке
  const grouped = useMemo(() => {
    const byBranch = new Map<string, Row[]>();
    for (const row of rows) {
      const key = row.branch_name ?? '—';
      if (!byBranch.has(key)) byBranch.set(key, []);
      byBranch.get(key)!.push(row);
    }
    const ordered: Array<{ name: string; employees: Row[] }> = [];
    for (const name of BRANCH_ORDER) {
      if (byBranch.has(name)) {
        ordered.push({ name, employees: byBranch.get(name)!.sort((a, b) => a.full_name.localeCompare(b.full_name)) });
        byBranch.delete(name);
      }
    }
    for (const [name, emps] of [...byBranch.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      ordered.push({ name, employees: emps.sort((a, b) => a.full_name.localeCompare(b.full_name)) });
    }
    return ordered;
  }, [rows]);

  const selectedRow = selectedId != null ? rows.find((r) => r.employee_id === selectedId) ?? null : null;

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
            <Users className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-50">Команда 360°</div>
            <div className="mt-0.5 text-[12px] text-cyan-300/50">
              Продажи, сервис, дисциплина и самочувствие каждого сотрудника в одном месте
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Period switcher */}
          <div className="inline-flex rounded-xl bg-white p-1 ring-1 ring-sky-100">
            {(['week', 'month', 'quarter'] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={
                  'rounded-lg px-3 py-1.5 text-xs font-semibold transition ' +
                  (period === p
                    ? 'bg-cyan-500 text-white shadow-[0_2px_8px_rgba(34,211,238,0.28)]'
                    : 'text-slate-600 hover:bg-sky-50')
                }
              >
                {p === 'week' ? 'Неделя' : p === 'month' ? 'Месяц' : 'Квартал'}
              </button>
            ))}
          </div>

          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-600 ring-1 ring-sky-100 transition hover:bg-sky-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </button>
        </div>
      </div>

      {/* Period summary bar */}
      <div className="mb-5 text-[12px] text-slate-400">
        Период: <span className="font-medium text-slate-300">{from}</span> → <span className="font-medium text-slate-300">{to}</span>
        {' · '}
        Сотрудников: <span className="font-medium text-slate-300">{rows.length}</span>
      </div>

      {/* Content */}
      {loading && rows.length === 0 ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-80 animate-pulse rounded-3xl bg-white/60 ring-1 ring-sky-100" />
          ))}
        </div>
      ) : (
        <div className="space-y-10">
          {(() => null)()}
          {/* Сетевой максимум выручки — для справедливого сравнения между филиалами.
              Раньше был внутри-филиальный → одинокий продавец автоматом 10/10. */}
          {(() => null)()}
          {(() => null)()}
          {/* Сетевые ранги (1 = лучший в сети). Раньше были внутри-филиальные —
              "#1 из 1" для одиноких продавцов было бессмысленно. */}
          {(() => null)()}
          {grouped.map((group) => {
            const revenueMaxNetwork = Math.max(1, ...rows.map((e) => e.revenue_total));
            const ordersMaxNetwork = Math.max(1, ...rows.map((e) => e.orders_count));
            const totalNetwork = rows.length;
            const periodDays = period === 'week' ? 7 : period === 'month' ? 30 : 90;
            const revenueRanksNetwork = [...rows]
              .sort((a, b) => b.revenue_total - a.revenue_total)
              .map((e, i) => [e.employee_id, i + 1] as const);
            const revenueRankNetworkMap = new Map(revenueRanksNetwork);
            const ordersRanksNetwork = [...rows]
              .sort((a, b) => b.orders_count - a.orders_count)
              .map((e, i) => [e.employee_id, i + 1] as const);
            const ordersRankNetworkMap = new Map(ordersRanksNetwork);
            return (
              <section key={group.name}>
                <div className="mb-4 flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-cyan-300/60" />
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-cyan-300/70">{group.name}</h2>
                  <span className="text-[11px] text-slate-500">· {group.employees.length} чел.</span>
                  <div className="ml-2 h-px flex-1 bg-gradient-to-r from-cyan-500/20 to-transparent" />
                </div>
                <div className="grid gap-5 lg:grid-cols-2">
                  {group.employees.map((r) => {
                    const s = computeScores(r, revenueMaxNetwork, periodDays);
                    const color = scoreColor(s.final360);
                    const cmt = commentary[r.employee_id]?.[0];
                    const revRank = revenueRankNetworkMap.get(r.employee_id) ?? 0;
                    const ordRank = ordersRankNetworkMap.get(r.employee_id) ?? 0;
                    const isTopRevenue = revRank === 1 && r.revenue_total > 0 && totalNetwork > 1;
                    const revShareVsMax = revenueMaxNetwork > 0 ? (r.revenue_total / revenueMaxNetwork) * 100 : 0;
                    const ordersShareVsMax = ordersMaxNetwork > 0 ? (r.orders_count / ordersMaxNetwork) * 100 : 0;
                    const ordersPerHour = r.hours_worked > 0 ? r.orders_count / Number(r.hours_worked) : 0;
                    return (
                      <button
                        key={r.employee_id}
                        onClick={() => setSelectedId(r.employee_id)}
                        className="group relative overflow-hidden rounded-3xl bg-white p-6 text-left ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] transition hover:-translate-y-0.5 hover:ring-cyan-200 hover:shadow-[0_16px_50px_rgba(15,23,42,0.55)]"
                      >
                        {/* Top: Ring + Name + Badge + Rank */}
                        <div className="flex items-start gap-5">
                          <ScoreRing score={s.final360} size={96} />
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="truncate text-xl font-bold tracking-tight text-slate-900">{r.full_name}</div>
                              {r.role === 'manager' && (
                                <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-sky-200">
                                  Менеджер
                                </span>
                              )}
                              {isTopRevenue && (
                                <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
                                  <Trophy className="h-3 w-3" />
                                  Топ сети
                                </span>
                              )}
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${color.bg} ${color.text} ring-1 ring-inset ring-current/10`}>
                                {color.label}
                                {s.final360 != null && <span className="ml-1 opacity-70">· {s.final360.toFixed(1)}/10</span>}
                              </span>
                              {revRank > 0 && r.orders_count > 0 && totalNetwork > 1 && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
                                  <TrendingUp className="h-3 w-3" />
                                  #{revRank} из {totalNetwork} по выручке
                                </span>
                              )}
                            </div>
                            {/* Sub-scores */}
                            <div className={`mt-3 grid gap-2 ${r.is_voice_pilot ? 'grid-cols-4' : 'grid-cols-3'}`}>
                              <MiniStat icon={Briefcase} label="Продажи" value={s.sales} />
                              <MiniStat icon={HeartPulse} label="Сервис" value={s.service} />
                              <MiniStat icon={Shield} label="Дисциплина" value={s.discipline} />
                              {r.is_voice_pilot && (
                                <MiniStat icon={Smile} label="Настроение" value={s.voice} />
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Key metrics — 2×2 */}
                        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
                          <BigMetric
                            icon={Coins}
                            label="Выручка"
                            value={formatMoney(r.revenue_total)}
                            suffix="KGS"
                            bar={revShareVsMax}
                            tone="cyan"
                          />
                          <BigMetric
                            icon={Receipt}
                            label="Заказов"
                            value={String(r.orders_count)}
                            suffix={r.orders_count > 0 ? `· ${formatMoney(r.avg_check)} ср.чек` : ''}
                            bar={ordersShareVsMax}
                            tone="sky"
                          />
                          <BigMetric
                            icon={Clock}
                            label="Часов"
                            value={Number(r.hours_worked || 0).toFixed(0)}
                            suffix={r.sessions_count > 0 ? `· ${r.sessions_count} смен` : ''}
                            tone="teal"
                          />
                          <BigMetric
                            icon={TrendingUp}
                            label="Заказов в час"
                            value={ordersPerHour > 0 ? ordersPerHour.toFixed(2) : '—'}
                            suffix={ordersPerHour > 0 ? 'зак/час' : ''}
                            tone="emerald"
                          />
                        </div>

                        {/* Channel breakdown — Аудио показывается только если есть записи
                            (Service QA пока не активен, чип всегда был пустой). Линз/заказ
                            убран — на реальных данных всегда 88-100%, не дифференцирует. */}
                        <div className="mt-4 flex flex-wrap gap-2">
                          {r.audio_chunks_count > 0 && (
                            <ChannelChip
                              icon={Mic}
                              label="Аудио"
                              count={r.audio_chunks_count}
                              avg={r.audio_avg_score}
                            />
                          )}
                          <ChannelChip
                            icon={MessageCircle}
                            label="WhatsApp"
                            count={r.wa_threads_count}
                            analyzed={r.wa_analyzed_count}
                            avg={r.wa_avg_score}
                          />
                          <ChannelChip
                            icon={Instagram}
                            label="Instagram"
                            count={r.ig_threads_count}
                            analyzed={r.ig_analyzed_count}
                            avg={r.ig_avg_score}
                          />
                        </div>

                        {/* Критичные флаги */}
                        {(r.wa_critical_count > 0 || r.ig_critical_count > 0 || r.audio_rude_count > 0 || r.audio_pushy_count > 0 || r.late_minutes_total > 120 || Number(r.fine_amount) > 0 || r.app_exits_count > 0) && (
                          <div className="mt-4 flex flex-wrap items-center gap-1.5">
                            {r.app_exits_count > 0 && (
                              <Flag color="rose" icon={LogOut}>
                                Выходы ×{r.app_exits_count} · {fmtFocusDuration(r.app_exits_seconds_total)}
                              </Flag>
                            )}
                            {r.audio_rude_count > 0 && (
                              <Flag color="rose" icon={AlertTriangle}>Грубость ×{r.audio_rude_count}</Flag>
                            )}
                            {r.audio_pushy_count > 0 && (
                              <Flag color="amber" icon={AlertTriangle}>Давление ×{r.audio_pushy_count}</Flag>
                            )}
                            {r.wa_critical_count > 0 && (
                              <Flag color="amber" icon={MessageCircle}>WA &lt;5 ×{r.wa_critical_count}</Flag>
                            )}
                            {r.ig_critical_count > 0 && (
                              <Flag color="amber" icon={Instagram}>IG &lt;5 ×{r.ig_critical_count}</Flag>
                            )}
                            {r.late_minutes_total > 120 && (
                              <Flag color="amber" icon={Clock}>Опоздания {Math.round(r.late_minutes_total / 60)}ч</Flag>
                            )}
                            {Number(r.fine_amount) > 0 && (
                              <Flag color="rose" icon={Coins}>Штрафы {formatMoney(Number(r.fine_amount))} KGS</Flag>
                            )}
                          </div>
                        )}

                        {/* AI commentary */}
                        {cmt ? (
                          <div className="mt-4 rounded-2xl bg-gradient-to-br from-cyan-50 via-sky-50 to-white p-3.5 ring-1 ring-cyan-200/60">
                            <div className="mb-1 flex items-center justify-between">
                              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-cyan-700">
                                <Sparkles className="h-3 w-3" />
                                AI-инсайт · {cmt.model.replace('claude-', '').replace(':12b', '')}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                {new Date(cmt.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}
                              </div>
                            </div>
                            <div
                              className="line-clamp-3 text-[12.5px] leading-relaxed text-slate-700"
                              dangerouslySetInnerHTML={{
                                __html: cmt.summary
                                  .replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-900">$1</strong>')
                                  .replace(/\n+/g, ' '),
                              }}
                            />
                          </div>
                        ) : (
                          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-3 text-[11px] text-slate-500">
                            <Sparkles className="h-3.5 w-3.5 text-slate-400" />
                            Нажми, чтобы сгенерировать AI-комментарий
                          </div>
                        )}

                        <div className="absolute right-4 top-4 text-slate-300 transition group-hover:text-cyan-500">
                          <ChevronRight className="h-5 w-5" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {selectedRow && (
        <EmployeeDrawer
          row={selectedRow}
          from={from}
          to={to}
          model={model}
          onModelChange={setModel}
          commentaryCache={commentary[selectedRow.employee_id] || []}
          onRefreshList={load}
          onClose={() => setSelectedId(null)}
          revenueMaxNetwork={Math.max(1, ...rows.map((x) => x.revenue_total))}
          periodDays={period === 'week' ? 7 : period === 'month' ? 30 : 90}
        />
      )}
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  dim = false,
}: {
  icon: any;
  label: string;
  value: number | null;
  dim?: boolean;
}) {
  const sColor = scoreColor(value);
  return (
    <div className={`rounded-xl px-2 py-1.5 text-center ${dim ? 'opacity-40' : ''} ${sColor.bg}`}>
      <div className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className={`text-base font-bold leading-tight ${sColor.text}`}>
        {value == null ? '—' : value.toFixed(1)}
      </div>
    </div>
  );
}

function BigMetric({
  icon: Icon,
  label,
  value,
  suffix,
  bar,
  tone = 'cyan',
}: {
  icon: any;
  label: string;
  value: string;
  suffix?: string;
  bar?: number;
  tone?: 'cyan' | 'sky' | 'teal' | 'emerald';
}) {
  const toneMap: Record<string, string> = {
    cyan: 'from-cyan-400 to-cyan-500',
    sky: 'from-sky-400 to-sky-500',
    teal: 'from-teal-400 to-teal-500',
    emerald: 'from-emerald-400 to-emerald-500',
  };
  const iconTone: Record<string, string> = {
    cyan: 'text-cyan-600',
    sky: 'text-sky-600',
    teal: 'text-teal-600',
    emerald: 'text-emerald-600',
  };
  return (
    <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        <Icon className={`h-3 w-3 ${iconTone[tone]}`} />
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <div className="text-xl font-bold text-slate-900">{value}</div>
        {suffix && <div className="text-[10px] font-medium text-slate-500">{suffix}</div>}
      </div>
      {bar != null && bar > 0 && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200/70">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${toneMap[tone]}`}
            style={{ width: `${Math.min(100, bar)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function ChannelChip({
  icon: Icon,
  label,
  count,
  analyzed,
  avg,
}: {
  icon: any;
  label: string;
  count: number;
  analyzed?: number;
  avg?: number | null;
}) {
  const dim = count === 0;
  const sColor = scoreColor(avg ?? null);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${
        dim
          ? 'bg-slate-50 text-slate-400 ring-slate-100'
          : 'bg-white text-slate-700 ring-slate-200'
      }`}
    >
      <Icon className={`h-3 w-3 ${dim ? 'text-slate-300' : 'text-slate-500'}`} />
      <span className="font-semibold">{label}</span>
      <span className="text-slate-500">
        {analyzed != null ? `${analyzed}/${count}` : count}
      </span>
      {avg != null && (
        <span className={`font-bold ${sColor.text}`}>· {Number(avg).toFixed(1)}</span>
      )}
    </span>
  );
}

function Flag({ color, icon: Icon, children }: { color: 'rose' | 'amber' | 'cyan'; icon: any; children: React.ReactNode }) {
  const cls =
    color === 'rose'
      ? 'bg-rose-50 text-rose-700 ring-rose-200'
      : color === 'amber'
        ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : 'bg-cyan-50 text-cyan-700 ring-cyan-200';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${cls}`}>
      <Icon className="h-2.5 w-2.5" />
      {children}
    </span>
  );
}

/* -------------------- DRAWER -------------------- */

type DetailData = {
  employee: any;
  metrics: Row;
  audio: any[];
  wa_quality: any[];
  ig_quality: any[];
  orders: any[];
  adjustments: any[];
  feedback_daily: any[];
  feedback_weekly: any[];
  commentary: any[];
  focus_events: FocusEvent[];
};

function EmployeeDrawer({
  row,
  from,
  to,
  model,
  onModelChange,
  commentaryCache,
  onRefreshList,
  onClose,
  revenueMaxNetwork,
  periodDays,
}: {
  row: Row;
  from: string;
  to: string;
  model: LlmModel;
  onModelChange: (m: LlmModel) => void;
  commentaryCache: Array<{ model: string; summary: string; created_at: string }>;
  onRefreshList: () => void;
  onClose: () => void;
  revenueMaxNetwork: number;
  periodDays: number;
}) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeComment, setActiveComment] = useState<{ model: string; summary: string; created_at: string } | null>(
    commentaryCache[0] ?? null,
  );

  const scores = computeScores(row, revenueMaxNetwork, periodDays);

  async function fetchDetail() {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/team/${row.employee_id}?from=${from}&to=${to}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Ошибка');
      setDetail(j);
      if (j.commentary?.length) setActiveComment(j.commentary[0]);
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void fetchDetail(); /* eslint-disable-next-line */ }, [row.employee_id]);

  async function generateComment(force = false) {
    setGenerating(true);
    const t = toast.loading('AI думает...');
    try {
      const r = await fetch(`/api/admin/team/ai-comment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ employee_id: row.employee_id, from, to, model, force }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Ошибка');
      setActiveComment({ model: j.llm_model, summary: j.summary, created_at: j.created_at });
      toast.success(j.cached ? 'Найдено в кэше' : `Готово${j.cost_usd ? ` · $${Number(j.cost_usd).toFixed(4)}` : ''}`, { id: t });
      void fetchDetail();
      onRefreshList();
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка', { id: t });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 p-5 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-4">
              <ScoreRing score={scores.final360} size={80} />
              <div>
                <div className="text-xl font-bold tracking-tight text-slate-900">{row.full_name}</div>
                <div className="text-[12px] text-slate-500">
                  {row.branch_name} · {row.role === 'manager' ? 'Менеджер' : 'Продавец'} · {from} → {to}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <SubScorePill icon={Briefcase} label="Продажи" value={scores.sales} />
                  <SubScorePill icon={HeartPulse} label="Сервис" value={scores.service} />
                  <SubScorePill icon={Shield} label="Дисциплина" value={scores.discipline} />
                  {row.is_voice_pilot && <SubScorePill icon={Mic} label="Mood" value={scores.voice} />}
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* AI Commentary */}
        <section className="border-b border-slate-100 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-cyan-500" />
              <h3 className="text-sm font-bold tracking-tight text-slate-900">AI-комментарий</h3>
            </div>
            <div className="flex items-center gap-1.5">
              {LLM_CHOICES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onModelChange(c.id)}
                  title={c.hint}
                  className={
                    'rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ' +
                    (model === c.id
                      ? 'bg-cyan-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200')
                  }
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {detail && detail.commentary.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {detail.commentary.map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => setActiveComment(c)}
                  className={
                    'rounded-full px-2.5 py-1 text-[10px] font-semibold transition ' +
                    (activeComment?.created_at === c.created_at
                      ? 'bg-cyan-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200')
                  }
                >
                  {c.llm_model.replace('claude-', '').replace(':12b', '')} · {new Date(c.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}
                </button>
              ))}
            </div>
          )}

          {activeComment ? (
            <div className="rounded-xl bg-gradient-to-br from-cyan-50 via-sky-50 to-white p-4 ring-1 ring-cyan-200/60">
              <div
                className="prose prose-sm max-w-none text-slate-800"
                dangerouslySetInnerHTML={{
                  __html: activeComment.summary
                    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-900">$1</strong>')
                    .replace(/\n/g, '<br/>'),
                }}
              />
              <div className="mt-2 text-[10px] text-slate-500">
                {activeComment.model} · {new Date(activeComment.created_at).toLocaleString('ru-RU')}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border-2 border-dashed border-slate-200 p-6 text-center">
              <div className="text-sm text-slate-500">Ещё нет AI-анализа за этот период</div>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => generateComment(false)}
              disabled={generating}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-3 py-2 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              Сгенерировать
            </button>
            {activeComment && (
              <button
                onClick={() => generateComment(true)}
                disabled={generating}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${generating ? 'animate-spin' : ''}`} />
                Перегенерировать
              </button>
            )}
          </div>
        </section>

        {/* Metrics blocks */}
        <section className="border-b border-slate-100 p-5">
          <h3 className="mb-3 text-sm font-bold tracking-tight text-slate-900">Метрики периода</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <StatCard label="Заказов" value={String(row.orders_count)} icon={Receipt} />
            <StatCard label="Выручка" value={formatMoney(row.revenue_total)} suffix="KGS" icon={Coins} />
            <StatCard label="Средний чек" value={formatMoney(row.avg_check)} suffix="KGS" icon={TrendingUp} />
            <StatCard label="Оправ" value={String(row.frame_items_count)} />
            <StatCard label="Линз" value={String(row.lens_items_count)} />
            <StatCard label="Часов" value={String(Number(row.hours_worked || 0).toFixed(1))} icon={Clock} />
            <StatCard
              label="Опоздания"
              value={`${row.late_minutes_total} мин`}
              tone={row.late_minutes_total > 120 ? 'warn' : 'neutral'}
            />
            <StatCard
              label="Штрафы"
              value={String(row.penalty_count)}
              tone={row.penalty_count > 0 ? 'warn' : 'neutral'}
            />
            <StatCard label="Премии" value={formatMoney(row.bonus_amount)} suffix="KGS" tone="good" />
          </div>
        </section>

        {/* Выходы из приложения */}
        {detail && row.app_exits_count > 0 && (
          <section className="border-b border-slate-100 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold tracking-tight text-slate-900">
                <LogOut className="mr-1.5 inline h-4 w-4 text-rose-500" />
                Выходы из приложения ({row.app_exits_count})
              </h3>
              <div className="text-[12px] text-slate-600">
                суммарно: <span className="font-semibold text-rose-700">{fmtFocusDuration(row.app_exits_seconds_total)}</span>
                {' · '}
                самый долгий: <span className="font-semibold text-rose-700">{fmtFocusDuration(row.app_exits_longest_seconds)}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              {detail.focus_events.slice(0, 15).map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-rose-50/60 px-3 py-2 ring-1 ring-rose-100"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-slate-800">
                      {new Date(ev.started_at).toLocaleString('ru-RU', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-500">
                      <Monitor className="h-2.5 w-2.5" />
                      <span className="font-mono">{ev.terminal_code || '—'}</span>
                      <span>·</span>
                      <span>{focusKindLabel(ev.event_kind)}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-sm font-bold tabular-nums text-rose-700">
                    {fmtFocusDuration(ev.duration_seconds)}
                  </div>
                </div>
              ))}
              {row.app_exits_count > 15 && (
                <div className="pt-1 text-center text-[11px] text-slate-500">
                  Ещё {row.app_exits_count - 15} событий не показаны
                </div>
              )}
            </div>
          </section>
        )}

        {/* Audio QA */}
        {detail && (row.audio_chunks_count > 0 || detail.audio.length > 0) && (
          <section className="border-b border-slate-100 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold tracking-tight text-slate-900">
                <Mic className="mr-1.5 inline h-4 w-4 text-cyan-500" />
                Аудио-QA ({row.audio_chunks_count})
              </h3>
              {row.audio_avg_score != null && (
                <div className="text-sm font-semibold text-slate-700">
                  средний: <span className={scoreColor(Number(row.audio_avg_score)).text}>{Number(row.audio_avg_score).toFixed(1)}</span> / 10
                </div>
              )}
            </div>
            <div className="space-y-2">
              {detail.audio.slice(0, 5).map((c: any) => (
                <div key={c.id} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] text-slate-500">
                      {new Date(c.chunk_started_at).toLocaleString('ru-RU')} · {Math.round((c.duration_seconds || 0) / 60)} мин
                    </div>
                    {c.overall_score != null && (
                      <div className={`text-sm font-bold ${scoreColor(Number(c.overall_score)).text}`}>
                        {Number(c.overall_score).toFixed(1)}
                      </div>
                    )}
                  </div>
                  {c.summary && <div className="mt-1 text-[12px] text-slate-700">{c.summary}</div>}
                  {(c.was_rude || c.was_pushy || c.interrupted_client) && (
                    <div className="mt-2 flex gap-1.5">
                      {c.was_rude && <Flag color="rose" icon={AlertTriangle}>Грубость</Flag>}
                      {c.was_pushy && <Flag color="amber" icon={AlertTriangle}>Давление</Flag>}
                      {c.interrupted_client && <Flag color="amber" icon={AlertTriangle}>Перебивал</Flag>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* WA / IG quality */}
        {detail && (detail.wa_quality.length > 0 || detail.ig_quality.length > 0) && (
          <section className="border-b border-slate-100 p-5">
            <h3 className="mb-3 text-sm font-bold tracking-tight text-slate-900">Мессенджеры</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {detail.wa_quality.length > 0 && (
                <ChannelBlock
                  icon={MessageCircle}
                  title={`WhatsApp (${row.wa_analyzed_count}/${row.wa_threads_count})`}
                  avg={row.wa_avg_score}
                  items={detail.wa_quality.slice(0, 3)}
                />
              )}
              {detail.ig_quality.length > 0 && (
                <ChannelBlock
                  icon={Instagram}
                  title={`Instagram (${row.ig_analyzed_count}/${row.ig_threads_count})`}
                  avg={row.ig_avg_score}
                  items={detail.ig_quality.slice(0, 3)}
                />
              )}
            </div>
          </section>
        )}

        {/* Orders preview */}
        {detail && detail.orders.length > 0 && (
          <section className="border-b border-slate-100 p-5">
            <h3 className="mb-3 text-sm font-bold tracking-tight text-slate-900">
              <Receipt className="mr-1.5 inline h-4 w-4 text-cyan-500" />
              Последние заказы ({detail.orders.length})
            </h3>
            <div className="overflow-hidden rounded-xl ring-1 ring-slate-100">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">№</th>
                    <th className="px-3 py-2 text-left">Дата</th>
                    <th className="px-3 py-2 text-left">Клиент</th>
                    <th className="px-3 py-2 text-right">Сумма</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detail.orders.slice(0, 10).map((o: any) => (
                    <tr key={o.id} className="hover:bg-sky-50/40">
                      <td className="px-3 py-2 text-[12px] font-medium text-slate-900">{o.order_no}</td>
                      <td className="px-3 py-2 text-[11px] text-slate-500">
                        {new Date(o.created_at).toLocaleDateString('ru-RU')}
                      </td>
                      <td className="px-3 py-2 text-[12px] text-slate-700">
                        {[o.customer_first_name, o.customer_last_name].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-[12px] font-semibold text-slate-800">
                        {formatMoney(o.total_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Feedback (if Tokmok) */}
        {row.is_voice_pilot && detail && (detail.feedback_daily.length > 0 || detail.feedback_weekly.length > 0) && (
          <section className="p-5">
            <h3 className="mb-3 text-sm font-bold tracking-tight text-slate-900">
              <HeartPulse className="mr-1.5 inline h-4 w-4 text-rose-500" />
              Самочувствие
            </h3>
            <div className="space-y-2">
              {[...detail.feedback_daily.map((f: any) => ({ ...f, kind: 'daily' })), ...detail.feedback_weekly.map((f: any) => ({ ...f, kind: 'weekly' }))]
                .sort((a, b) => (b.day || b.week_start).localeCompare(a.day || a.week_start))
                .slice(0, 6)
                .map((f: any) => (
                  <div key={`${f.kind}-${f.id}`} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] text-slate-500">
                        {f.kind === 'daily' ? 'День' : 'Неделя'} · {f.day || f.week_start}
                      </div>
                      <div className="text-sm font-bold text-rose-600">{'❤'.repeat(f.mood || 0)}</div>
                    </div>
                    {(f.answer_text || f.week_text) && (
                      <div className="mt-1 text-[12px] text-slate-700">{f.answer_text || f.week_text}</div>
                    )}
                    {(f.extra_text || f.helped_text) && (
                      <div className="mt-1 text-[11px] italic text-slate-500">{f.extra_text || f.helped_text}</div>
                    )}
                  </div>
                ))}
            </div>
          </section>
        )}

        {loading && (
          <div className="p-5 text-center text-sm text-slate-400">Загрузка деталей...</div>
        )}
      </div>
    </div>
  );
}

function SubScorePill({ icon: Icon, label, value }: { icon: any; label: string; value: number | null }) {
  const sColor = scoreColor(value);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${sColor.bg} ${sColor.text}`}>
      <Icon className="h-2.5 w-2.5" />
      {label} {value == null ? '—' : value.toFixed(1)}
    </span>
  );
}

function StatCard({
  label,
  value,
  suffix,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  suffix?: string;
  icon?: any;
  tone?: 'neutral' | 'good' | 'warn';
}) {
  const toneCls =
    tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-slate-900';
  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      <div className={`mt-1 text-lg font-bold ${toneCls}`}>
        {value}
        {suffix && <span className="ml-1 text-[11px] font-medium text-slate-500">{suffix}</span>}
      </div>
    </div>
  );
}

function ChannelBlock({
  icon: Icon,
  title,
  avg,
  items,
}: {
  icon: any;
  title: string;
  avg: number | null;
  items: any[];
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
          <Icon className="h-3.5 w-3.5" />
          {title}
        </div>
        {avg != null && (
          <div className={`text-sm font-bold ${scoreColor(Number(avg)).text}`}>
            {Number(avg).toFixed(1)}
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        {items.map((q: any) => (
          <div key={q.id} className="rounded-lg bg-white p-2 ring-1 ring-slate-100">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-slate-500">{new Date(q.created_at).toLocaleDateString('ru-RU')}</div>
              <div className={`text-[12px] font-bold ${scoreColor(Number(q.score)).text}`}>
                {Number(q.score).toFixed(1)}
              </div>
            </div>
            {q.summary && <div className="mt-1 line-clamp-2 text-[11px] text-slate-600">{q.summary}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
