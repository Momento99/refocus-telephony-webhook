'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X, ChevronLeft, ChevronRight, Sparkles, Loader2, RefreshCw, Cpu, Zap, Gem,
  MessageCircle, Instagram, Building2, Trophy, AlertTriangle, Clock, CheckCircle2,
  Copy, FileText, Users as UsersIcon, ChevronDown, AlertOctagon,
} from 'lucide-react';
import toast from 'react-hot-toast';

export type ModelOption = 'gemma3:12b' | 'claude-haiku-4-5' | 'claude-opus-4-7';

const MODEL_META: Record<ModelOption, { label: string; Icon: typeof Cpu; color: string }> = {
  'gemma3:12b':       { label: 'Gemma',  Icon: Cpu, color: 'emerald' },
  'claude-haiku-4-5': { label: 'Haiku',  Icon: Zap, color: 'sky' },
  'claude-opus-4-7':  { label: 'Opus',   Icon: Gem, color: 'violet' },
};

type ChannelDay = {
  threads_total: number;
  threads_sla_breached: number;
  analyzed_threads: number;
  avg_score: number | null;
  critical_count: number;
  analyzed: boolean;
  reports: Array<{
    id: string; llm_model: string; markdown: string | null; created_at: string;
    threads_analyzed: number | null; input_tokens: number | null;
    output_tokens: number | null; cost_usd: number | null;
  }>;
  branches: Array<{
    branch_id: number; branch_name: string; threads: number;
    avg_score: number | null; critical_count: number; sla_breached_count: number;
  }>;
  sellers: Array<{
    employee_id: number; full_name: string; branch_id: number; branch_name: string;
    threads: number; avg_score: number | null; critical_count: number;
  }>;
  critical_replies: Array<{
    thread_id: string; employee_id: number | null; employee_name: string | null;
    branch_id: number | null; branch_name: string | null; customer_name: string | null;
    score: number; verdict: string; summary: string | null; worst_reply: string | null;
    issues: string[];
  }>;
  sla_threads: Array<{
    thread_id: string; branch_id: number | null; branch_name: string | null;
    customer_name: string | null; response_minutes: number | null;
    first_customer_message_at: string | null;
  }>;
};

type DayData = { ok: true; date: string; wa: ChannelDay; ig: ChannelDay };

function scoreColor(score: number | null): { text: string; bg: string; ring: string; dot: string } {
  if (score == null) return { text: 'text-slate-500', bg: 'bg-slate-100', ring: 'ring-slate-200', dot: 'bg-slate-300' };
  if (score >= 8.5) return { text: 'text-emerald-700', bg: 'bg-emerald-50', ring: 'ring-emerald-200', dot: 'bg-emerald-500' };
  if (score >= 7)   return { text: 'text-cyan-700',    bg: 'bg-cyan-50',    ring: 'ring-cyan-200',    dot: 'bg-cyan-500' };
  if (score >= 5)   return { text: 'text-amber-700',   bg: 'bg-amber-50',   ring: 'ring-amber-200',   dot: 'bg-amber-500' };
  if (score >= 3)   return { text: 'text-orange-700',  bg: 'bg-orange-50',  ring: 'ring-orange-200',  dot: 'bg-orange-500' };
  return               { text: 'text-rose-700',    bg: 'bg-rose-50',    ring: 'ring-rose-200',    dot: 'bg-rose-500' };
}

function formatDateLong(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.toLocaleDateString('ru-RU', { weekday: 'long', timeZone: 'UTC' });
  const dayPart = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `${weekday.charAt(0).toUpperCase() + weekday.slice(1)}, ${dayPart}`;
}

export default function DayDrawer({
  date,
  onClose,
  onNavigate,
  branchFilter,
}: {
  date: string | null;
  onClose: () => void;
  onNavigate: (direction: -1 | 1) => void;
  branchFilter: number[] | null; // null = все филиалы
}) {
  const [data, setData] = useState<DayData | null>(null);
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState<ModelOption>('claude-haiku-4-5');
  const [running, setRunning] = useState(false);
  const [activeChannel, setActiveChannel] = useState<'both' | 'wa' | 'ig'>('both');
  const [activeReportByChannel, setActiveReportByChannel] = useState<{ wa: string | null; ig: string | null }>({ wa: null, ig: null });
  const [drilldownBranch, setDrilldownBranch] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!date) return;
    setLoading(true);
    try {
      const q = new URLSearchParams({ date });
      if (branchFilter && branchFilter.length > 0) q.set('branches', branchFilter.join(','));
      const r = await fetch(`/api/admin/messaging/day?${q}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Ошибка загрузки');
      setData(j);
      setActiveReportByChannel({
        wa: j.wa?.reports?.[0]?.id ?? null,
        ig: j.ig?.reports?.[0]?.id ?? null,
      });
      setDrilldownBranch(null);
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось загрузить день');
    } finally {
      setLoading(false);
    }
  }, [date, branchFilter]);

  useEffect(() => { void load(); }, [load]);

  // Keyboard navigation
  useEffect(() => {
    if (!date) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onNavigate(-1);
      else if (e.key === 'ArrowRight') onNavigate(1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [date, onClose, onNavigate]);

  async function runAnalysis(force = false) {
    if (!date || running) return;
    setRunning(true);
    const t = toast.loading(`Анализирую ${date} в ${MODEL_META[model].label}…`);
    try {
      await Promise.all([
        fetch('/api/admin/whatsapp/analyze', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ period_from: date, period_to: date, model }),
        }),
        fetch('/api/admin/instagram/analyze', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ period_from: date, period_to: date, model }),
        }),
      ]);
      toast.success('Готово', { id: t });
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка анализа', { id: t });
    } finally {
      setRunning(false);
    }
  }

  if (!date) return null;

  const filtered = useMemo(() => {
    if (!data || drilldownBranch == null) return data;
    // локальная фильтрация по выбранному филиалу (не делаем новый запрос)
    const filterChannel = (ch: ChannelDay): ChannelDay => {
      const b = ch.branches.find((x) => x.branch_id === drilldownBranch);
      return {
        ...ch,
        threads_total: b?.threads ?? 0,
        threads_sla_breached: b?.sla_breached_count ?? 0,
        analyzed_threads: ch.sellers.filter((s) => s.branch_id === drilldownBranch).reduce((s, x) => s + x.threads, 0),
        avg_score: b?.avg_score ?? null,
        critical_count: b?.critical_count ?? 0,
        branches: b ? [b] : [],
        sellers: ch.sellers.filter((s) => s.branch_id === drilldownBranch),
        critical_replies: ch.critical_replies.filter((c) => c.branch_id === drilldownBranch),
        sla_threads: ch.sla_threads.filter((s) => s.branch_id === drilldownBranch),
      };
    };
    return { ...data, wa: filterChannel(data.wa), ig: filterChannel(data.ig) };
  }, [data, drilldownBranch]);

  const showWa = activeChannel !== 'ig';
  const showIg = activeChannel !== 'wa';

  return (
    <div className="fixed inset-0 z-40 flex justify-end pointer-events-none">
      <div
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px] pointer-events-auto"
        onClick={onClose}
      />
      <aside
        className="relative h-full w-full sm:w-[680px] lg:w-[780px] bg-slate-50 shadow-[-20px_0_60px_rgba(15,23,42,0.4)] overflow-y-auto pointer-events-auto animate-[slideIn_0.25s_ease-out]"
        style={{ animation: 'slideIn 0.25s ease-out' }}
      >
        <style>{`@keyframes slideIn { from { transform: translateX(40px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>

        {/* HEADER */}
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => onNavigate(-1)}
                className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition"
                title="Предыдущий день (←)"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <div className="text-[18px] font-bold tracking-tight text-slate-900 truncate">{formatDateLong(date)}</div>
                {drilldownBranch != null && data && (
                  <button
                    type="button"
                    onClick={() => setDrilldownBranch(null)}
                    className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-700 hover:text-cyan-800"
                  >
                    <ChevronLeft className="h-3 w-3" />
                    Ко всему дню
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => onNavigate(1)}
                className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition"
                title="Следующий день (→)"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              title="Закрыть (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Channel toggle */}
          {data && (data.wa.threads_total > 0 || data.ig.threads_total > 0) && (
            <div className="mt-3 inline-flex rounded-xl bg-slate-100 p-1">
              {(['both', 'wa', 'ig'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setActiveChannel(v)}
                  className={
                    'rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ' +
                    (activeChannel === v
                      ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                      : 'text-slate-500 hover:text-slate-700')
                  }
                >
                  {v === 'both' ? 'WA + IG' : v === 'wa' ? 'WhatsApp' : 'Instagram'}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* BODY */}
        {loading && !data ? (
          <div className="p-10 text-center text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
            Загрузка дня…
          </div>
        ) : !data ? (
          <div className="p-10 text-center text-slate-400">Нет данных</div>
        ) : filtered && (filtered.wa.threads_total + filtered.ig.threads_total === 0) ? (
          <div className="p-10 text-center">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400">
              <MessageCircle className="h-6 w-6" />
            </div>
            <div className="text-sm font-medium text-slate-700">В этот день диалогов не было</div>
            <div className="mt-1 text-[12px] text-slate-500">
              {drilldownBranch != null ? 'Ни одного треда в выбранном филиале' : 'Клиенты никому не писали'}
            </div>
          </div>
        ) : filtered && (
          <div className="p-5 space-y-5">
            {/* Block 1: Summary strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {showWa && (
                <>
                  <SummaryTile icon={MessageCircle} label="WhatsApp · диалогов" value={String(filtered.wa.threads_total)} hint={filtered.wa.threads_sla_breached ? `${filtered.wa.threads_sla_breached} SLA` : null} />
                  <SummaryTile icon={Sparkles} label="WA · балл" value={filtered.wa.avg_score != null ? filtered.wa.avg_score.toFixed(1) : '—'} scoreColor={scoreColor(filtered.wa.avg_score)} />
                </>
              )}
              {showIg && (
                <>
                  <SummaryTile icon={Instagram} label="Instagram · диалогов" value={String(filtered.ig.threads_total)} hint={filtered.ig.threads_sla_breached ? `${filtered.ig.threads_sla_breached} SLA` : null} />
                  <SummaryTile icon={Sparkles} label="IG · балл" value={filtered.ig.avg_score != null ? filtered.ig.avg_score.toFixed(1) : '—'} scoreColor={scoreColor(filtered.ig.avg_score)} />
                </>
              )}
            </div>

            {/* Block 2: Branches */}
            {drilldownBranch == null && filtered.wa.branches.length + filtered.ig.branches.length > 0 && (
              <section className="rounded-2xl bg-white ring-1 ring-sky-100 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-cyan-500" />
                  <h3 className="text-[13px] font-bold tracking-tight text-slate-900">Филиалы в этот день</h3>
                  <span className="text-[11px] text-slate-400">кликни для детализации</span>
                </div>
                <BranchCards
                  wa={showWa ? filtered.wa.branches : []}
                  ig={showIg ? filtered.ig.branches : []}
                  onClickBranch={setDrilldownBranch}
                />
              </section>
            )}

            {/* Block 3: Analyze CTA / Report */}
            {!filtered.wa.analyzed && !filtered.ig.analyzed && (filtered.wa.threads_total + filtered.ig.threads_total > 0) ? (
              <section className="rounded-2xl bg-gradient-to-br from-cyan-50 via-sky-50 to-white ring-1 ring-cyan-200 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="h-5 w-5 text-cyan-600" />
                  <div className="text-[15px] font-bold text-slate-900">Запустить AI-анализ за этот день</div>
                </div>
                <div className="mb-3 flex items-center gap-1.5">
                  {(Object.keys(MODEL_META) as ModelOption[]).map((id) => {
                    const meta = MODEL_META[id];
                    const Icon = meta.Icon;
                    const active = model === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setModel(id)}
                        className={
                          'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition ring-1 ' +
                          (active
                            ? `bg-${meta.color}-500 text-white ring-${meta.color}-400 shadow-[0_2px_8px_rgba(0,0,0,0.12)]`
                            : `bg-white text-${meta.color}-700 ring-${meta.color}-200 hover:bg-${meta.color}-50`)
                        }
                      >
                        <Icon className="h-3 w-3" />
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => runAnalysis()}
                  disabled={running}
                  className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 disabled:opacity-50"
                >
                  {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {running ? 'Анализирую…' : 'Проанализировать'}
                </button>
              </section>
            ) : (
              filtered.wa.reports.length + filtered.ig.reports.length > 0 && (
                <section className="rounded-2xl bg-white ring-1 ring-sky-100 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-cyan-500" />
                      <h3 className="text-[13px] font-bold tracking-tight text-slate-900">AI-отчёт</h3>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {(Object.keys(MODEL_META) as ModelOption[]).map((id) => {
                        const meta = MODEL_META[id];
                        const active = model === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setModel(id)}
                            title={`Перегенерировать на ${meta.label}`}
                            className={
                              'rounded-lg px-2 py-1 text-[10px] font-semibold transition ring-1 ' +
                              (active
                                ? 'bg-slate-800 text-white ring-slate-700'
                                : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50')
                            }
                          >
                            {meta.label}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => runAnalysis(true)}
                        disabled={running}
                        className="inline-flex items-center gap-1 rounded-lg bg-cyan-500 px-2 py-1 text-[10px] font-semibold text-white hover:bg-cyan-400 disabled:opacity-40"
                        title="Перегенерировать отчёт"
                      >
                        {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        {MODEL_META[model].label}
                      </button>
                    </div>
                  </div>

                  {showWa && filtered.wa.reports.length > 0 && (
                    <ReportBlock
                      channel="wa"
                      reports={filtered.wa.reports}
                      activeId={activeReportByChannel.wa}
                      onSelect={(id) => setActiveReportByChannel((s) => ({ ...s, wa: id }))}
                    />
                  )}
                  {showIg && filtered.ig.reports.length > 0 && (
                    <div className={showWa && filtered.wa.reports.length > 0 ? 'mt-4' : ''}>
                      <ReportBlock
                        channel="ig"
                        reports={filtered.ig.reports}
                        activeId={activeReportByChannel.ig}
                        onSelect={(id) => setActiveReportByChannel((s) => ({ ...s, ig: id }))}
                      />
                    </div>
                  )}
                </section>
              )
            )}

            {/* Block 5: Critical replies */}
            {(filtered.wa.critical_replies.length + filtered.ig.critical_replies.length) > 0 && (
              <CollapseSection
                title="Критичные ответы (балл < 5)"
                icon={AlertTriangle}
                tone="rose"
                defaultOpen
                count={(showWa ? filtered.wa.critical_replies.length : 0) + (showIg ? filtered.ig.critical_replies.length : 0)}
              >
                <div className="space-y-2">
                  {showWa && filtered.wa.critical_replies.map((c) => <CriticalCard key={`wa:${c.thread_id}:${c.score}`} channel="wa" item={c} />)}
                  {showIg && filtered.ig.critical_replies.map((c) => <CriticalCard key={`ig:${c.thread_id}:${c.score}`} channel="ig" item={c} />)}
                </div>
              </CollapseSection>
            )}

            {/* Block 6: SLA */}
            {(filtered.wa.sla_threads.length + filtered.ig.sla_threads.length) > 0 && (
              <CollapseSection
                title="SLA-нарушения (ответ > 10 мин)"
                icon={Clock}
                tone="amber"
                defaultOpen={false}
                count={(showWa ? filtered.wa.sla_threads.length : 0) + (showIg ? filtered.ig.sla_threads.length : 0)}
              >
                <div className="rounded-xl overflow-hidden ring-1 ring-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Канал</th>
                        <th className="px-3 py-2 text-left">Филиал</th>
                        <th className="px-3 py-2 text-left">Клиент</th>
                        <th className="px-3 py-2 text-right">Время ответа</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {showWa && filtered.wa.sla_threads.map((s) => <SlaRow key={`wa:${s.thread_id}`} channel="wa" item={s} />)}
                      {showIg && filtered.ig.sla_threads.map((s) => <SlaRow key={`ig:${s.thread_id}`} channel="ig" item={s} />)}
                    </tbody>
                  </table>
                </div>
              </CollapseSection>
            )}

            {/* Block 7: Sellers of the day */}
            {(filtered.wa.sellers.length + filtered.ig.sellers.length) > 0 && (
              <CollapseSection
                title="Рейтинг продавцов за день"
                icon={Trophy}
                tone="cyan"
                defaultOpen={false}
                count={new Set([...(showWa ? filtered.wa.sellers : []).map((s) => s.employee_id), ...(showIg ? filtered.ig.sellers : []).map((s) => s.employee_id)]).size}
              >
                <SellersTable
                  wa={showWa ? filtered.wa.sellers : []}
                  ig={showIg ? filtered.ig.sellers : []}
                />
              </CollapseSection>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

/* ============================ SUB-COMPONENTS ============================ */

function SummaryTile({
  icon: Icon, label, value, hint, scoreColor: sc,
}: {
  icon: any; label: string; value: string; hint?: string | null; scoreColor?: ReturnType<typeof scoreColor>;
}) {
  return (
    <div className={`rounded-xl bg-white p-3 ring-1 ${sc?.ring ?? 'ring-sky-100'}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className={`mt-0.5 text-xl font-bold ${sc?.text ?? 'text-slate-900'}`}>{value}</div>
      {hint && <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function BranchCards({
  wa, ig, onClickBranch,
}: {
  wa: ChannelDay['branches']; ig: ChannelDay['branches']; onClickBranch: (id: number) => void;
}) {
  const byId = new Map<number, { id: number; name: string; wa: ChannelDay['branches'][number] | null; ig: ChannelDay['branches'][number] | null }>();
  for (const b of wa) byId.set(b.branch_id, { id: b.branch_id, name: b.branch_name, wa: b, ig: null });
  for (const b of ig) {
    const cur = byId.get(b.branch_id);
    if (cur) cur.ig = b;
    else byId.set(b.branch_id, { id: b.branch_id, name: b.branch_name, wa: null, ig: b });
  }
  const list = Array.from(byId.values()).sort((a, b) => (b.wa?.threads ?? 0) + (b.ig?.threads ?? 0) - ((a.wa?.threads ?? 0) + (a.ig?.threads ?? 0)));
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {list.map((b) => {
        const waScore = b.wa?.avg_score ?? null;
        const igScore = b.ig?.avg_score ?? null;
        const sc = scoreColor(waScore ?? igScore);
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onClickBranch(b.id)}
            className="group text-left rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100 hover:bg-sky-50 hover:ring-sky-200 transition"
          >
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${sc.dot}`} />
              <div className="text-[13px] font-semibold text-slate-900 truncate">{b.name}</div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
              {b.wa ? (
                <div className="flex items-center justify-between rounded-lg bg-white px-2 py-1">
                  <div className="flex items-center gap-1 text-slate-500">
                    <MessageCircle className="h-2.5 w-2.5" /> {b.wa.threads}
                  </div>
                  <span className={`font-bold ${scoreColor(b.wa.avg_score).text}`}>
                    {b.wa.avg_score != null ? b.wa.avg_score.toFixed(1) : '—'}
                  </span>
                </div>
              ) : <div />}
              {b.ig ? (
                <div className="flex items-center justify-between rounded-lg bg-white px-2 py-1">
                  <div className="flex items-center gap-1 text-slate-500">
                    <Instagram className="h-2.5 w-2.5" /> {b.ig.threads}
                  </div>
                  <span className={`font-bold ${scoreColor(b.ig.avg_score).text}`}>
                    {b.ig.avg_score != null ? b.ig.avg_score.toFixed(1) : '—'}
                  </span>
                </div>
              ) : <div />}
            </div>
            {((b.wa?.critical_count ?? 0) + (b.ig?.critical_count ?? 0) > 0 ||
              (b.wa?.sla_breached_count ?? 0) + (b.ig?.sla_breached_count ?? 0) > 0) && (
              <div className="mt-1.5 flex gap-1 text-[10px]">
                {((b.wa?.critical_count ?? 0) + (b.ig?.critical_count ?? 0) > 0) && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-700 ring-1 ring-rose-200">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    {(b.wa?.critical_count ?? 0) + (b.ig?.critical_count ?? 0)}
                  </span>
                )}
                {((b.wa?.sla_breached_count ?? 0) + (b.ig?.sla_breached_count ?? 0) > 0) && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700 ring-1 ring-amber-200">
                    <Clock className="h-2.5 w-2.5" />
                    {(b.wa?.sla_breached_count ?? 0) + (b.ig?.sla_breached_count ?? 0)}
                  </span>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ReportBlock({
  channel, reports, activeId, onSelect,
}: {
  channel: 'wa' | 'ig'; reports: ChannelDay['reports']; activeId: string | null; onSelect: (id: string) => void;
}) {
  const active = reports.find((r) => r.id === activeId) ?? reports[0];
  const Icon = channel === 'wa' ? MessageCircle : Instagram;
  const channelName = channel === 'wa' ? 'WhatsApp' : 'Instagram';
  const copyReport = () => {
    if (!active?.markdown) return;
    navigator.clipboard.writeText(active.markdown).then(
      () => toast.success('Скопировано'),
      () => toast.error('Не удалось скопировать'),
    );
  };
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon className={`h-3.5 w-3.5 ${channel === 'wa' ? 'text-emerald-600' : 'text-pink-500'}`} />
          <span className="text-[12px] font-semibold text-slate-700">{channelName}</span>
          {reports.length > 1 && (
            <div className="ml-2 inline-flex gap-1">
              {reports.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onSelect(r.id)}
                  className={
                    'rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition ' +
                    (active?.id === r.id
                      ? 'bg-cyan-100 text-cyan-800 ring-1 ring-cyan-200'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200')
                  }
                >
                  {r.llm_model.replace('claude-', '').replace(':12b', '')}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
          {active?.cost_usd != null && active.cost_usd > 0 && <span>${active.cost_usd.toFixed(4)}</span>}
          {active?.created_at && <span>{new Date(active.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>}
          <button type="button" onClick={copyReport} className="rounded p-0.5 hover:bg-slate-100" title="Скопировать">
            <Copy className="h-3 w-3" />
          </button>
        </div>
      </div>
      {active?.markdown ? (
        <div
          className="rounded-xl bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-800 whitespace-pre-wrap ring-1 ring-slate-100"
          dangerouslySetInnerHTML={{
            __html: renderMarkdown(active.markdown),
          }}
        />
      ) : (
        <div className="rounded-xl bg-slate-50 p-3 text-[12px] text-slate-400 ring-1 ring-slate-100">
          (отчёт пустой)
        </div>
      )}
    </div>
  );
}

function CriticalCard({ channel, item }: { channel: 'wa' | 'ig'; item: ChannelDay['critical_replies'][number] }) {
  const Icon = channel === 'wa' ? MessageCircle : Instagram;
  const sc = scoreColor(item.score);
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-rose-100">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon className={`h-3 w-3 ${channel === 'wa' ? 'text-emerald-600' : 'text-pink-500'}`} />
          <span className="text-[12px] font-semibold text-slate-800">
            {item.employee_name ?? 'Неизвестный продавец'}
          </span>
          {item.branch_name && (
            <span className="text-[11px] text-slate-500">· {item.branch_name}</span>
          )}
          {item.customer_name && (
            <span className="text-[11px] text-slate-400 truncate">→ {item.customer_name}</span>
          )}
        </div>
        <span className={`shrink-0 inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold ${sc.bg} ${sc.text} ring-1 ${sc.ring}`}>
          {item.score.toFixed(1)}
        </span>
      </div>
      {item.summary && (
        <div className="mt-1.5 text-[12px] text-slate-700">{item.summary}</div>
      )}
      {item.worst_reply && (
        <div className="mt-2 rounded-lg bg-rose-50 border-l-2 border-rose-300 px-2 py-1.5 text-[12px] italic text-rose-900">
          «{item.worst_reply}»
        </div>
      )}
      {item.issues.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.issues.map((i, idx) => (
            <span key={idx} className="text-[10px] rounded-full bg-slate-100 px-1.5 py-0.5 text-slate-600">
              {i}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SlaRow({ channel, item }: { channel: 'wa' | 'ig'; item: ChannelDay['sla_threads'][number] }) {
  const Icon = channel === 'wa' ? MessageCircle : Instagram;
  return (
    <tr className="hover:bg-amber-50/30">
      <td className="px-3 py-2 text-[12px]">
        <Icon className={`h-3 w-3 ${channel === 'wa' ? 'text-emerald-600' : 'text-pink-500'}`} />
      </td>
      <td className="px-3 py-2 text-[12px] text-slate-700">{item.branch_name ?? '—'}</td>
      <td className="px-3 py-2 text-[12px] text-slate-700">{item.customer_name || '—'}</td>
      <td className="px-3 py-2 text-right text-[12px] font-semibold text-amber-700">
        {item.response_minutes != null ? `${item.response_minutes.toFixed(0)} мин` : '—'}
      </td>
    </tr>
  );
}

function SellersTable({ wa, ig }: { wa: ChannelDay['sellers']; ig: ChannelDay['sellers'] }) {
  type Merged = { employee_id: number; full_name: string; branch_name: string; wa: ChannelDay['sellers'][number] | null; ig: ChannelDay['sellers'][number] | null };
  const map = new Map<number, Merged>();
  for (const s of wa) map.set(s.employee_id, { employee_id: s.employee_id, full_name: s.full_name, branch_name: s.branch_name, wa: s, ig: null });
  for (const s of ig) {
    const cur = map.get(s.employee_id);
    if (cur) cur.ig = s;
    else map.set(s.employee_id, { employee_id: s.employee_id, full_name: s.full_name, branch_name: s.branch_name, wa: null, ig: s });
  }
  const list = Array.from(map.values()).sort((a, b) => {
    const av = (a.wa?.avg_score ?? 0) * (a.wa?.threads ?? 0) + (a.ig?.avg_score ?? 0) * (a.ig?.threads ?? 0);
    const bv = (b.wa?.avg_score ?? 0) * (b.wa?.threads ?? 0) + (b.ig?.avg_score ?? 0) * (b.ig?.threads ?? 0);
    return bv - av;
  });
  return (
    <div className="rounded-xl overflow-hidden ring-1 ring-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">Продавец</th>
            <th className="px-3 py-2 text-right">WA</th>
            <th className="px-3 py-2 text-right">IG</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {list.map((s) => (
            <tr key={s.employee_id}>
              <td className="px-3 py-2">
                <div className="text-[12px] font-semibold text-slate-800">{s.full_name}</div>
                <div className="text-[10px] text-slate-400">{s.branch_name}</div>
              </td>
              <td className="px-3 py-2 text-right">
                {s.wa ? (
                  <div>
                    <div className={`text-[12px] font-bold ${scoreColor(s.wa.avg_score).text}`}>
                      {s.wa.avg_score != null ? s.wa.avg_score.toFixed(1) : '—'}
                    </div>
                    <div className="text-[10px] text-slate-400">{s.wa.threads} треда</div>
                  </div>
                ) : <span className="text-[11px] text-slate-300">—</span>}
              </td>
              <td className="px-3 py-2 text-right">
                {s.ig ? (
                  <div>
                    <div className={`text-[12px] font-bold ${scoreColor(s.ig.avg_score).text}`}>
                      {s.ig.avg_score != null ? s.ig.avg_score.toFixed(1) : '—'}
                    </div>
                    <div className="text-[10px] text-slate-400">{s.ig.threads} треда</div>
                  </div>
                ) : <span className="text-[11px] text-slate-300">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CollapseSection({
  title, icon: Icon, tone, defaultOpen, count, children,
}: {
  title: string; icon: any; tone: 'rose' | 'amber' | 'cyan'; defaultOpen: boolean; count: number; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toneCls =
    tone === 'rose' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-600' : 'text-cyan-600';
  const badgeCls =
    tone === 'rose' ? 'bg-rose-50 text-rose-700 ring-rose-200' :
    tone === 'amber' ? 'bg-amber-50 text-amber-700 ring-amber-200' :
    'bg-cyan-50 text-cyan-700 ring-cyan-200';
  return (
    <section className="rounded-2xl bg-white ring-1 ring-sky-100 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50/80"
      >
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${toneCls}`} />
          <h3 className="text-[13px] font-bold tracking-tight text-slate-900">{title}</h3>
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${badgeCls}`}>{count}</span>
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

/** Минимальный markdown-рендер: **жирный**, заголовки строкой. */
function renderMarkdown(md: string): string {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-900">$1</strong>')
    .replace(/^(#{1,6})\s+(.+)$/gm, (_, h, t) => `<div class="mt-2 text-[13px] font-bold text-slate-900">${t}</div>`)
    .replace(/^(\d+\.\s+)(.+)$/gm, '<div class="mt-1"><span class="text-slate-400">$1</span>$2</div>')
    .replace(/^[-•]\s+(.+)$/gm, '<div class="mt-0.5">• $1</div>');
}
