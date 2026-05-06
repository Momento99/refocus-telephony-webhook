'use client';

import { useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, MessageCircle, Instagram, Flame, Activity, AlertOctagon, CheckCircle2,
} from 'lucide-react';

const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DAYS_SHORT = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

function pad2(n: number) { return String(n).padStart(2, '0'); }
function ymd(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }

const MAX_MONTHS_BACK = 3;

export type ChannelSummary = {
  threads: number;
  reports: number;
  avg_score: number | null;
  analyzed_threads: number;
  last_report_id: string | null;
  model: string | null;
  cost_usd: number;
  branches: Array<{ branch_id: number; branch_code: string | null; branch_name: string; threads: number; avg_score: number | null }>;
};

/**
 * Объединённый score филиала за день (WA + IG, взвешенный по threads).
 * Возвращает { score, threads } или null если филиал не имел активности в этот день.
 */
function combinedBranchScore(
  bucket: DayBucket,
  branchId: number,
): { score: number | null; threads: number } | null {
  const wa = bucket.wa?.branches.find((b) => b.branch_id === branchId) ?? null;
  const ig = bucket.ig?.branches.find((b) => b.branch_id === branchId) ?? null;
  if (!wa && !ig) return null;

  const wTh = wa?.threads ?? 0;
  const iTh = ig?.threads ?? 0;
  const total = wTh + iTh;

  const wS = wa?.avg_score ?? null;
  const iS = ig?.avg_score ?? null;

  if (wS == null && iS == null) return { score: null, threads: total };
  if (wS == null) return { score: Number(iS), threads: total };
  if (iS == null) return { score: Number(wS), threads: total };

  // Взвешенное среднее по числу диалогов в каждом канале
  if (wTh + iTh === 0) return { score: (Number(wS) + Number(iS)) / 2, threads: 0 };
  const weighted = (Number(wS) * wTh + Number(iS) * iTh) / (wTh + iTh);
  return { score: Number(weighted.toFixed(2)), threads: total };
}

function scoreColorClasses(score: number | null): { bg: string; text: string } {
  if (score == null) return { bg: 'bg-slate-100', text: 'text-slate-400' };
  if (score >= 8.5) return { bg: 'bg-emerald-200', text: 'text-emerald-900' };
  if (score >= 7)   return { bg: 'bg-cyan-200',    text: 'text-cyan-900' };
  if (score >= 5)   return { bg: 'bg-amber-200',   text: 'text-amber-900' };
  if (score >= 3)   return { bg: 'bg-orange-200',  text: 'text-orange-900' };
  return { bg: 'bg-rose-200', text: 'text-rose-900' };
}

export type DayBucket = {
  date: string;
  wa: ChannelSummary | null;
  ig: ChannelSummary | null;
};

export type HeatmapMode = 'score' | 'activity' | 'problems';

function combinedScore(b: DayBucket): number | null {
  const scores: number[] = [];
  if (b.wa?.avg_score != null) scores.push(Number(b.wa.avg_score));
  if (b.ig?.avg_score != null) scores.push(Number(b.ig.avg_score));
  if (scores.length === 0) return null;
  return scores.reduce((a, v) => a + v, 0) / scores.length;
}

function heatmapColor(mode: HeatmapMode, bucket: DayBucket, maxActivity: number): string {
  const totalThreads = (bucket.wa?.threads ?? 0) + (bucket.ig?.threads ?? 0);
  if (totalThreads === 0) return '';
  if (mode === 'score') {
    const s = combinedScore(bucket);
    if (s == null) return 'bg-slate-100';
    if (s >= 8.5) return 'bg-emerald-100 hover:bg-emerald-200';
    if (s >= 7)   return 'bg-cyan-100 hover:bg-cyan-200';
    if (s >= 5)   return 'bg-amber-100 hover:bg-amber-200';
    if (s >= 3)   return 'bg-orange-100 hover:bg-orange-200';
    return 'bg-rose-100 hover:bg-rose-200';
  }
  if (mode === 'activity') {
    const pct = maxActivity > 0 ? totalThreads / maxActivity : 0;
    if (pct >= 0.8) return 'bg-cyan-300';
    if (pct >= 0.5) return 'bg-cyan-200';
    if (pct >= 0.25) return 'bg-cyan-100';
    return 'bg-cyan-50';
  }
  // problems: если есть cost_usd и оценки, и есть филиалы с avg<5
  const hasCritical =
    (bucket.wa?.branches ?? []).some((b) => b.avg_score != null && b.avg_score < 5) ||
    (bucket.ig?.branches ?? []).some((b) => b.avg_score != null && b.avg_score < 5) ||
    (bucket.wa?.avg_score != null && bucket.wa.avg_score < 5) ||
    (bucket.ig?.avg_score != null && bucket.ig.avg_score < 5);
  if (hasCritical) return 'bg-rose-200 hover:bg-rose-300';
  if ((bucket.wa?.analyzed_threads ?? 0) + (bucket.ig?.analyzed_threads ?? 0) > 0) return 'bg-emerald-50';
  return 'bg-slate-50';
}

export type AllBranchInfo = { id: number; name: string; code: string | null };

export default function AnalysisCalendar({
  month, year, onMonthChange,
  heatmapMode, onHeatmapModeChange,
  branchFilter, days, loading, onDayClick,
  selectedDate, allBranches = [],
}: {
  month: number; year: number;
  onMonthChange: (year: number, month: number) => void;
  heatmapMode: HeatmapMode;
  onHeatmapModeChange: (m: HeatmapMode) => void;
  branchFilter: number[] | null;
  days: DayBucket[];
  loading: boolean;
  onDayClick: (date: string) => void;
  selectedDate: string | null;
  allBranches?: AllBranchInfo[];
}) {
  const todayStr = ymd(new Date());
  const minDate = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - MAX_MONTHS_BACK);
    return ymd(d);
  }, []);

  const dayMap = useMemo(() => {
    const m = new Map<string, DayBucket>();
    for (const d of days) {
      let bucket: DayBucket = d;
      if (branchFilter && branchFilter.length > 0) {
        bucket = applyBranchFilter(d, branchFilter);
      }
      m.set(d.date, bucket);
    }
    return m;
  }, [days, branchFilter]);

  const maxActivity = useMemo(() => {
    let max = 0;
    for (const b of dayMap.values()) {
      const total = (b.wa?.threads ?? 0) + (b.ig?.threads ?? 0);
      if (total > max) max = total;
    }
    return max;
  }, [dayMap]);

  const grid = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    let startDow = firstDay.getDay(); if (startDow === 0) startDow = 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev = new Date(year, month, 0).getDate();
    const cells: Array<{ date: string; day: number; isCurrentMonth: boolean; isToday: boolean; isFuture: boolean; tooOld: boolean }> = [];
    for (let i = startDow - 1; i > 0; i--) {
      const d = daysInPrev - i + 1;
      const m2 = month === 0 ? 12 : month;
      const y = month === 0 ? year - 1 : year;
      const date = `${y}-${pad2(m2)}-${pad2(d)}`;
      cells.push({ date, day: d, isCurrentMonth: false, isToday: date === todayStr, isFuture: date > todayStr, tooOld: date < minDate });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${year}-${pad2(month + 1)}-${pad2(d)}`;
      cells.push({ date, day: d, isCurrentMonth: true, isToday: date === todayStr, isFuture: date > todayStr, tooOld: date < minDate });
    }
    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const m2 = month === 11 ? 1 : month + 2;
      const y = month === 11 ? year + 1 : year;
      const date = `${y}-${pad2(m2)}-${pad2(d)}`;
      cells.push({ date, day: d, isCurrentMonth: false, isToday: date === todayStr, isFuture: date > todayStr, tooOld: date < minDate });
    }
    return cells;
  }, [year, month, todayStr, minDate]);

  function shift(dir: number) {
    let m = month + dir, y = year;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    onMonthChange(y, m);
  }

  return (
    <section className="rounded-2xl bg-white ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)] overflow-hidden">
      {/* Header: nav + heatmap toggle */}
      <div className="px-5 py-4 flex items-center justify-between gap-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="grid h-9 w-9 place-items-center rounded-xl bg-slate-50 ring-1 ring-slate-200 hover:bg-slate-100 transition"
            aria-label="Предыдущий месяц"
          >
            <ChevronLeft className="h-4 w-4 text-slate-600" />
          </button>
          <div className="min-w-[140px] text-center">
            <div className="text-base font-bold text-slate-900">{MONTHS_RU[month]} {year}</div>
          </div>
          <button
            type="button"
            onClick={() => shift(1)}
            className="grid h-9 w-9 place-items-center rounded-xl bg-slate-50 ring-1 ring-slate-200 hover:bg-slate-100 transition"
            aria-label="Следующий месяц"
          >
            <ChevronRight className="h-4 w-4 text-slate-600" />
          </button>
        </div>

        <div className="inline-flex rounded-xl bg-slate-100 p-1">
          <HeatmapPill Icon={Flame} label="Оценка" active={heatmapMode === 'score'} onClick={() => onHeatmapModeChange('score')} />
          <HeatmapPill Icon={Activity} label="Активность" active={heatmapMode === 'activity'} onClick={() => onHeatmapModeChange('activity')} />
          <HeatmapPill Icon={AlertOctagon} label="Проблемы" active={heatmapMode === 'problems'} onClick={() => onHeatmapModeChange('problems')} />
        </div>
      </div>

      {/* DoW row */}
      <div className="grid grid-cols-7 px-2 pt-2">
        {DAYS_SHORT.map((d) => (
          <div key={d} className="text-center text-[11px] font-bold text-slate-400 py-2 uppercase tracking-wider">{d}</div>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="p-10 text-center text-slate-400">Загрузка…</div>
      ) : (
        <div className="grid grid-cols-7 gap-1.5 px-2 pb-4">
          {grid.map((cell, i) => {
            const bucket = dayMap.get(cell.date);
            const wa = bucket?.wa ?? null;
            const ig = bucket?.ig ?? null;
            const hasAny = (wa?.threads ?? 0) + (ig?.threads ?? 0) > 0;
            const analyzed = (wa?.analyzed_threads ?? 0) + (ig?.analyzed_threads ?? 0) > 0;
            const isSelected = cell.date === selectedDate;
            const disabled = cell.isFuture || cell.tooOld || !cell.isCurrentMonth;
            const heat = hasAny && bucket ? heatmapColor(heatmapMode, bucket, maxActivity) : '';

            const combined = bucket ? combinedScore(bucket) : null;
            const hasCritical =
              (wa?.branches ?? []).some((b) => b.avg_score != null && b.avg_score < 5) ||
              (ig?.branches ?? []).some((b) => b.avg_score != null && b.avg_score < 5);

            // Подготовим список филиалов для отрисовки в плитке.
            // Если applied фильтр — показываем только их, иначе все 5.
            const branchesToRender =
              branchFilter && branchFilter.length > 0
                ? allBranches.filter((b) => branchFilter.includes(b.id))
                : allBranches;

            return (
              <button
                key={i}
                type="button"
                disabled={disabled}
                onClick={() => { if (!disabled && hasAny) onDayClick(cell.date); }}
                className={[
                  'relative min-h-[120px] flex flex-col p-2 text-left transition rounded-xl',
                  !cell.isCurrentMonth ? 'opacity-20 pointer-events-none' :
                    cell.isFuture || cell.tooOld ? 'opacity-30 cursor-default' :
                    isSelected ? 'ring-2 ring-inset ring-cyan-500 shadow-[0_4px_16px_rgba(34,211,238,0.35)] bg-white' :
                    cell.isToday ? 'ring-2 ring-inset ring-teal-300 bg-white' :
                    hasAny ? `${heat} ring-1 ring-inset ring-slate-200 cursor-pointer` :
                    'bg-slate-50/50 ring-1 ring-inset ring-slate-100 cursor-default',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-1">
                  {cell.isToday ? (
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500 text-white text-[12px] font-bold shadow-[0_3px_12px_rgba(34,211,238,0.40)] shrink-0">{cell.day}</span>
                  ) : (
                    <span className={`text-[14px] font-bold leading-6 ${cell.isCurrentMonth ? 'text-slate-800' : 'text-slate-300'}`}>{cell.day}</span>
                  )}
                  <div className="flex items-center gap-0.5">
                    {analyzed && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                    {hasCritical && <AlertOctagon className="h-3 w-3 text-rose-600" />}
                  </div>
                </div>

                {/* Мини-плитки по филиалам с объединённой WA+IG оценкой */}
                {cell.isCurrentMonth && !cell.isFuture && !cell.tooOld && bucket && branchesToRender.length > 0 && (
                  <div className="mt-1.5 grid grid-cols-3 gap-0.5">
                    {branchesToRender.map((b) => {
                      const data = combinedBranchScore(bucket, b.id);
                      const hasActivity = data && data.threads > 0;
                      const score = data?.score ?? null;
                      const colors = scoreColorClasses(hasActivity ? score : null);
                      const label = b.code || (b.name ? b.name.slice(0, 2).toUpperCase() : `#${b.id}`);
                      return (
                        <div
                          key={b.id}
                          title={`${b.name}${
                            hasActivity
                              ? `: ${data!.threads} диал.${score != null ? `, оценка ${score.toFixed(1)}` : ', не оценено'}`
                              : ': без активности'
                          }`}
                          className={[
                            'flex items-center justify-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold leading-tight',
                            hasActivity ? colors.bg : 'bg-white/60 ring-1 ring-slate-100',
                            hasActivity ? colors.text : 'text-slate-300',
                          ].join(' ')}
                        >
                          <span className="truncate">{label}</span>
                          {hasActivity && (
                            <span className="tabular-nums">
                              {score != null ? score.toFixed(1) : '·'}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Маленький индикатор каналов внизу */}
                {hasAny && (
                  <div className="mt-auto pt-1 flex items-center gap-2 text-[9px] text-slate-500">
                    {wa && wa.threads > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <MessageCircle className="h-2.5 w-2.5" />{wa.threads}
                      </span>
                    )}
                    {ig && ig.threads > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <Instagram className="h-2.5 w-2.5" />{ig.threads}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Legend footer */}
      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between gap-3 text-[11px]">
        <div className="flex items-center gap-2 text-slate-500">
          <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Проанализировано
          <span className="mx-1 text-slate-300">·</span>
          <AlertOctagon className="h-3 w-3 text-rose-600" /> Есть критичный балл
        </div>
        {combinedScoreLegend(heatmapMode)}
      </div>
    </section>
  );
}

function combinedScoreLegend(mode: HeatmapMode) {
  if (mode === 'score') {
    return (
      <div className="flex items-center gap-1 text-slate-500">
        <span>≤3</span>
        <span className="h-2 w-4 rounded bg-rose-100 ring-1 ring-rose-200" />
        <span className="h-2 w-4 rounded bg-orange-100 ring-1 ring-orange-200" />
        <span className="h-2 w-4 rounded bg-amber-100 ring-1 ring-amber-200" />
        <span className="h-2 w-4 rounded bg-cyan-100 ring-1 ring-cyan-200" />
        <span className="h-2 w-4 rounded bg-emerald-100 ring-1 ring-emerald-200" />
        <span>≥8.5</span>
      </div>
    );
  }
  if (mode === 'activity') {
    return (
      <div className="flex items-center gap-1 text-slate-500">
        <span>меньше</span>
        <span className="h-2 w-4 rounded bg-cyan-50 ring-1 ring-cyan-100" />
        <span className="h-2 w-4 rounded bg-cyan-100 ring-1 ring-cyan-200" />
        <span className="h-2 w-4 rounded bg-cyan-200 ring-1 ring-cyan-300" />
        <span className="h-2 w-4 rounded bg-cyan-300 ring-1 ring-cyan-400" />
        <span>больше</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 text-slate-500">
      <span className="h-2 w-4 rounded bg-emerald-50 ring-1 ring-emerald-200" /> ок
      <span className="ml-1 h-2 w-4 rounded bg-rose-200 ring-1 ring-rose-300" /> проблемы
    </div>
  );
}

function HeatmapPill({ Icon, label, active, onClick }: { Icon: any; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ' +
        (active ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-700')
      }
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

function applyBranchFilter(b: DayBucket, branches: number[]): DayBucket {
  const filterChannel = (ch: ChannelSummary | null): ChannelSummary | null => {
    if (!ch) return null;
    const keep = ch.branches.filter((br) => branches.includes(br.branch_id));
    if (keep.length === 0) return null;
    const threads = keep.reduce((s, b2) => s + b2.threads, 0);
    const withScores = keep.filter((b2) => b2.avg_score != null);
    const avg_score = withScores.length
      ? withScores.reduce((s, b2) => s + Number(b2.avg_score), 0) / withScores.length
      : null;
    return {
      ...ch,
      threads,
      avg_score,
      analyzed_threads: withScores.length ? ch.analyzed_threads : 0,
      branches: keep,
    };
  };
  return { date: b.date, wa: filterChannel(b.wa), ig: filterChannel(b.ig) };
}
