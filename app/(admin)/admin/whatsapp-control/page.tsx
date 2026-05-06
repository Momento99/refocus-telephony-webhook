'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, MessageCircle, Instagram, Sparkles, AlertTriangle, Clock, Building2, RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import AnalysisCalendar, { type DayBucket, type HeatmapMode } from '@/components/whatsapp-control/AnalysisCalendar';
import DayDrawer from '@/components/whatsapp-control/DayDrawer';

type Branch = { id: number; name: string; code: string | null };

function pad2(n: number) { return String(n).padStart(2, '0'); }

export default function WhatsAppControlPage() {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>('score');
  const [days, setDays] = useState<DayBucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranches, setActiveBranches] = useState<Set<number>>(new Set()); // empty = все

  const [openDate, setOpenDate] = useState<string | null>(null);

  const loadBranches = useCallback(async () => {
    try {
      const r = await fetch('/api/branches');
      const j = await r.json();
      const list = Array.isArray(j) ? j : (j.branches ?? []);
      setBranches(
        (list as any[])
          .filter((b) => !b.is_workshop)
          .map((b) => ({ id: Number(b.id), name: String(b.name), code: b.code ?? null }))
          .filter((b) => !isNaN(b.id)),
      );
    } catch {
      setBranches([]);
    }
  }, []);

  useEffect(() => { void loadBranches(); }, [loadBranches]);

  const loadMonth = useCallback(async () => {
    setLoading(true);
    const first = `${viewYear}-${pad2(viewMonth + 1)}-01`;
    const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
    const last = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(lastDay)}`;
    try {
      const r = await fetch(`/api/admin/messaging/calendar?from=${first}&to=${last}`);
      const j = await r.json();
      setDays(Array.isArray(j?.days) ? j.days : []);
    } catch {
      setDays([]);
    } finally {
      setLoading(false);
    }
  }, [viewYear, viewMonth]);

  useEffect(() => { void loadMonth(); }, [loadMonth]);

  const branchFilter = useMemo(() => activeBranches.size === 0 ? null : Array.from(activeBranches), [activeBranches]);

  const toggleBranch = (id: number) => {
    setActiveBranches((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearBranchFilter = () => setActiveBranches(new Set());

  // Aggregate strip for the month (honours branch filter)
  const monthStrip = useMemo(() => {
    let totalThreads = 0, wScore = 0, wCount = 0, iScore = 0, iCount = 0, sla = 0, critical = 0, analyzedDays = 0, totalDaysWithActivity = 0, cost = 0;
    for (const d of days) {
      let wa = d.wa, ig = d.ig;
      if (branchFilter) {
        wa = wa
          ? { ...wa, branches: wa.branches.filter((b) => branchFilter.includes(b.branch_id)) }
          : null;
        ig = ig
          ? { ...ig, branches: ig.branches.filter((b) => branchFilter.includes(b.branch_id)) }
          : null;
        if (wa && wa.branches.length === 0) wa = null;
        if (ig && ig.branches.length === 0) ig = null;
        // пересчёт threads / avg_score
        if (wa) {
          wa = {
            ...wa,
            threads: wa.branches.reduce((s, b) => s + b.threads, 0),
            avg_score: avgFrom(wa.branches.map((b) => b.avg_score)),
          };
        }
        if (ig) {
          ig = {
            ...ig,
            threads: ig.branches.reduce((s, b) => s + b.threads, 0),
            avg_score: avgFrom(ig.branches.map((b) => b.avg_score)),
          };
        }
      }
      const dayThreads = (wa?.threads ?? 0) + (ig?.threads ?? 0);
      totalThreads += dayThreads;
      if (dayThreads > 0) totalDaysWithActivity += 1;
      if (wa?.avg_score != null) { wScore += wa.avg_score; wCount += 1; }
      if (ig?.avg_score != null) { iScore += ig.avg_score; iCount += 1; }
      if ((wa?.analyzed_threads ?? 0) + (ig?.analyzed_threads ?? 0) > 0) analyzedDays += 1;
      cost += (wa?.cost_usd ?? 0) + (ig?.cost_usd ?? 0);
    }
    return {
      totalThreads,
      waAvg: wCount > 0 ? wScore / wCount : null,
      igAvg: iCount > 0 ? iScore / iCount : null,
      analyzedDays,
      totalDaysWithActivity,
      cost,
    };
  }, [days, branchFilter]);

  function navigateDay(direction: -1 | 1) {
    if (!openDate) return;
    const d = new Date(openDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + direction);
    const next = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    // нельзя в будущее
    if (next > `${new Date().getFullYear()}-${pad2(new Date().getMonth() + 1)}-${pad2(new Date().getDate())}`) return;
    setOpenDate(next);
    // Если вышли за границы текущего месяца — сдвигаем календарь
    if (d.getUTCFullYear() !== viewYear || d.getUTCMonth() !== viewMonth) {
      setViewYear(d.getUTCFullYear());
      setViewMonth(d.getUTCMonth());
    }
  }

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-8">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
            <CalendarDays className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-50">Аналитика мессенджеров</div>
            <div className="mt-0.5 text-[12px] text-cyan-300/50">
              WhatsApp + Instagram по дням · клик на день — полный разбор
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { void loadMonth(); }}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-600 ring-1 ring-sky-100 transition hover:bg-sky-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </button>
      </div>

      {/* Branch filter chips */}
      {branches.length > 0 && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={clearBranchFilter}
            className={
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition ring-1 ' +
              (activeBranches.size === 0
                ? 'bg-cyan-500 text-white ring-cyan-400 shadow-[0_2px_8px_rgba(34,211,238,0.3)]'
                : 'bg-white/90 text-slate-700 ring-sky-100 hover:bg-sky-50')
            }
          >
            <Building2 className="h-3 w-3" />
            Все филиалы
          </button>
          {branches.map((b) => {
            const active = activeBranches.has(b.id);
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => toggleBranch(b.id)}
                className={
                  'rounded-full px-3 py-1.5 text-[12px] font-semibold transition ring-1 ' +
                  (active
                    ? 'bg-cyan-500 text-white ring-cyan-400 shadow-[0_2px_8px_rgba(34,211,238,0.3)]'
                    : 'bg-white/90 text-slate-700 ring-sky-100 hover:bg-sky-50')
                }
              >
                {b.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Summary strip */}
      <div className="mb-4 grid grid-cols-2 md:grid-cols-5 gap-2">
        <StripTile icon={MessageCircle} label="Всего диалогов за месяц" value={String(monthStrip.totalThreads)} />
        <StripTile icon={Sparkles} label="Средний WA-балл" value={monthStrip.waAvg != null ? monthStrip.waAvg.toFixed(1) : '—'} />
        <StripTile icon={Sparkles} label="Средний IG-балл" value={monthStrip.igAvg != null ? monthStrip.igAvg.toFixed(1) : '—'} />
        <StripTile icon={CalendarDays} label="Дней проанализировано" value={`${monthStrip.analyzedDays} из ${monthStrip.totalDaysWithActivity}`} />
        <StripTile icon={Sparkles} label="Стоимость анализов" value={monthStrip.cost > 0 ? `$${monthStrip.cost.toFixed(2)}` : '—'} />
      </div>

      {/* Calendar */}
      <AnalysisCalendar
        month={viewMonth}
        year={viewYear}
        onMonthChange={(y, m) => { setViewYear(y); setViewMonth(m); }}
        heatmapMode={heatmapMode}
        onHeatmapModeChange={setHeatmapMode}
        branchFilter={branchFilter}
        days={days}
        loading={loading}
        onDayClick={setOpenDate}
        selectedDate={openDate}
        allBranches={branches}
      />

      {/* Drawer */}
      {openDate && (
        <DayDrawer
          date={openDate}
          onClose={() => setOpenDate(null)}
          onNavigate={navigateDay}
          branchFilter={branchFilter}
        />
      )}
    </div>
  );
}

function StripTile({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/95 backdrop-blur px-3 py-2 ring-1 ring-sky-100 shadow-[0_4px_14px_rgba(15,23,42,0.2)]">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-0.5 text-lg font-bold text-slate-900">{value}</div>
    </div>
  );
}

function avgFrom(scores: (number | null)[]): number | null {
  const valid = scores.filter((s): s is number => s != null);
  if (valid.length === 0) return null;
  return valid.reduce((a, v) => a + v, 0) / valid.length;
}
