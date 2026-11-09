'use client';

import React, { useState, useEffect } from 'react';
import AICenterTabs from '../AICenterTabs';
import { toast } from 'react-hot-toast';
import {
  Trophy, Sparkles, Loader2, Copy, Building2, CheckCircle2,
  CloudRain, Snowflake, Megaphone, Target, Users, UserRound, MessageSquareText, Wind,
  Glasses, ShoppingBag, Gauge, Clock, AlertTriangle, Repeat,
  TrendingUp, TrendingDown, Lock, ChevronDown, Network, History, X, ChevronRight,
  Send, Pencil, Monitor, Flame, HelpCircle, Check,
} from 'lucide-react';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0));
const USD_KGS = 89; // примерный курс доллара к сому для показа стоимости генераций
const som = (usd: any) => fmt(Number(usd || 0) * USD_KGS) + ' сом';
const ddmmyyyy = (iso?: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '');
const fmtDateTime = (iso?: string) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso.slice(0, 16).replace('T', ' '); }
};
const TIER: Record<string, { label: string; cls: string }> = {
  A: { label: 'данные ≥1 года', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  B: { label: 'есть история', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  C: { label: 'мало данных', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
};
const AGE_LABEL: Record<string, string> = {
  a17: 'до 17', a18_25: '18–25', a26_35: '26–35', a36_45: '36–45', a46_60: '46–60', a60p: '60+',
};
// Доминирующая возрастная группа покупателей (без 'unknown').
const topAgeLabel = (age: any): string | null => {
  if (!age) return null;
  let best: string | null = null, bestN = 0;
  for (const k of Object.keys(AGE_LABEL)) {
    const n = Number(age[k] || 0);
    if (n > bestN) { bestN = n; best = k; }
  }
  return best && bestN > 0 ? AGE_LABEL[best] : null;
};

// ── Визуальные примитивы карточки разбора ──────────────────────────────────
const CHIP_TONE: Record<string, string> = {
  good: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-700 ring-amber-200',
  bad: 'bg-rose-50 text-rose-700 ring-rose-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
  muted: 'bg-slate-50 text-slate-600 ring-slate-200',
};
function Chip({ icon: Icon, children, tone = 'muted' }: { icon?: any; children: React.ReactNode; tone?: keyof typeof CHIP_TONE }) {
  return (
    <span className={'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ' + CHIP_TONE[tone]}>
      {Icon && <Icon className="h-3 w-3" />}{children}
    </span>
  );
}
// Секция вторичных метрик: если внутри нет ни одного чипа — не рисуем (карточки не выглядят рвано).
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const arr = React.Children.toArray(children).filter(Boolean);
  if (arr.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="flex flex-wrap gap-1.5">{arr}</div>
    </div>
  );
}
// Крупный KPI с дельтой-стрелкой (0/null — не рисуем, чтобы не шуметь).
function Kpi({ label, value, hint, delta }: { label: string; value: string; hint?: string; delta?: number | null }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold leading-none text-slate-900">{value}</div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
        {hint && <span className="text-slate-500">{hint}</span>}
        {delta != null && delta !== 0 && (
          <span className={'inline-flex items-center gap-0.5 font-semibold ' + (delta > 0 ? 'text-emerald-600' : 'text-rose-600')}>
            {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {delta > 0 ? '+' : ''}{delta}%
          </span>
        )}
      </div>
    </div>
  );
}

// ── Личный отчёт сотрудника: оценка/10, подскоры, рендер по разделам ───────────
const SCORE_TONE: Record<string, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  cyan: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  orange: 'bg-amber-50 text-amber-700 ring-amber-200', // 'Ниже' — в брендовом amber (orange вне палитры)
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
  slate: 'bg-slate-50 text-slate-500 ring-slate-200',
};
const subTone = (v: number | null) =>
  v == null ? 'bg-slate-50 text-slate-400' : v >= 7 ? 'bg-emerald-50 text-emerald-700' : v >= 5 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700';
const MOOD_EMOJI = ['', '😫', '😕', '😐', '🙂', '😄'];

function SubScore({ label, value }: { label: string; value: number | null }) {
  return (
    <div className={'rounded-xl px-2 py-1.5 text-center ' + subTone(value)}>
      <div className="text-[10px] font-medium uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-base font-bold leading-none">{value == null ? '—' : value.toFixed(1)}</div>
    </div>
  );
}

// Рендер текста-отчёта: **Заголовок** → подзаголовок секции, inline **жирный**, переносы строк.
function ReportText({ text }: { text: string }) {
  const lines = (text || '').split('\n');
  return (
    <div className="mt-3 rounded-xl border-l-[3px] border-cyan-400 bg-slate-50 px-4 py-3 text-[13px] leading-6 text-slate-800">
      {lines.map((ln, i) => {
        const h = ln.match(/^\s*\*\*(.+?)\*\*\s*$/);
        if (h) return <div key={i} className="mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-900 first:mt-0">{h[1]}</div>;
        if (!ln.trim()) return <div key={i} className="h-1.5" />;
        const parts = ln.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
          p.startsWith('**') && p.endsWith('**') ? <strong key={j} className="text-slate-900">{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>);
        return <div key={i} className="whitespace-pre-wrap">{parts}</div>;
      })}
    </div>
  );
}

// Текстовая подпись периода генерации (для шапки результата).
const periodText = (e: any) => {
  if (!e) return '';
  if (e.period === 'all') return `с открытия — по ${ddmmyyyy(e.week_end)}`;
  return e.period_label || `неделя ${ddmmyyyy(e.week)} — ${ddmmyyyy(e.week_end)}`;
};
const ruAgree = (a: string) => (a === 'yes' ? 'да' : a === 'partial' ? 'частично' : a === 'no' ? 'нет' : a);
// Подпись периода в строке истории (из сохранённых period/period_from/period_to).
const histPeriodText = (run: any) => {
  const a = run.period_from ? ddmmyyyy(run.period_from) : '';
  const b = run.period_to && run.period_to !== run.period_from ? `—${ddmmyyyy(run.period_to)}` : '';
  if (run.period === 'all') return `с открытия ${a}${b}`;
  if (run.period === 'month') return `месяц ${a}${b}`;
  return `неделя ${a}${b}`;
};

export default function WeeklyRecapPage() {
  const [week, setWeek] = useState('');
  const [period, setPeriod] = useState<'week' | 'month' | 'all'>('week');
  const [emp, setEmp] = useState<any>(null);
  const [empLoading, setEmpLoading] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [histTotal, setHistTotal] = useState<{ count: number; cost_usd: number } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewingEmpAt, setViewingEmpAt] = useState<string | null>(null);
  // Доставка на кассу: активация по филиалам, правка текста, статусы+ответы.
  const [activation, setActivation] = useState<any[]>([]);
  const [activationOpen, setActivationOpen] = useState(false);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [delivering, setDelivering] = useState<number | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);
  const [deliveries, setDeliveries] = useState<Record<number, any>>({}); // ключ — employee_id

  async function loadHistory() {
    try {
      const r = await fetch('/api/admin/weekly-recap/history');
      const j = await r.json();
      if (r.ok) { setHistory((j.runs || []).filter((x: any) => x.kind === 'employees')); setHistTotal(j.total || null); }
    } catch { /* история не критична */ }
  }
  useEffect(() => { loadHistory(); }, []);

  async function openRun(run: any) {
    const t = toast.loading('Открываю сохранённую генерацию…');
    try {
      const r = await fetch(`/api/admin/weekly-recap/history?id=${run.id}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Не удалось открыть');
      setEmp(j.payload);
      setEdited({}); setEditing({}); setDeliveries({}); // чистим правки/статусы прошлого разбора
      setViewingEmpAt(j.created_at);
      setHistoryOpen(false);
      toast.success('Открыто из истории', { id: t });
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка', { id: t });
    }
  }

  async function genEmployees() {
    setEmpLoading(true);
    setEmp(null);
    setEdited({}); setEditing({}); setDeliveries({}); // не тянуть правки/статусы с прошлого разбора
    const t = toast.loading('Opus 4.8 готовит личные заметки…');
    try {
      const r = await fetch('/api/admin/weekly-recap/employees', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ week: week || undefined, period }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Ошибка генерации');
      setEmp(j);
      setViewingEmpAt(null);
      loadHistory();
      toast.success('Личные заметки готовы', { id: t });
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка', { id: t });
    } finally {
      setEmpLoading(false);
    }
  }

  async function copyOne(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Скопировано');
    } catch {
      toast.error('Не удалось скопировать');
    }
  }

  // ── Доставка на кассу ───────────────────────────────────────────────
  async function loadActivation() {
    try {
      const r = await fetch('/api/admin/weekly-recap/activation');
      const j = await r.json();
      if (r.ok) setActivation(j.activation || []);
    } catch { /* не критично */ }
  }
  useEffect(() => { loadActivation(); }, []);

  async function toggleActivation(branchId: number, enabled: boolean) {
    if (toggling === branchId) return; // защита от двойного клика
    setToggling(branchId);
    setActivation((prev) => prev.map((a) => (a.branch_id === branchId ? { ...a, enabled } : a)));
    try {
      const r = await fetch('/api/admin/weekly-recap/activation', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ branch_id: branchId, enabled }),
      });
      if (!r.ok) throw new Error();
      toast.success(enabled ? 'Касса: показ включён' : 'Касса: показ выключен');
    } catch {
      setActivation((prev) => prev.map((a) => (a.branch_id === branchId ? { ...a, enabled: !enabled } : a)));
      toast.error('Не удалось сохранить');
    } finally {
      setToggling(null);
    }
  }

  async function loadDeliveries(branchId: number, periodFrom?: string) {
    try {
      const url = `/api/admin/weekly-recap/deliveries?branch_id=${branchId}${periodFrom ? `&period_from=${periodFrom}` : ''}`;
      const r = await fetch(url);
      const j = await r.json();
      if (r.ok) {
        setDeliveries((prev) => {
          const next = { ...prev };
          for (const d of j.deliveries || []) next[Number(d.employee_id)] = d;
          return next;
        });
      }
    } catch { /* статусы не критичны */ }
  }
  // При показе разбора подтягиваем статусы доставки по филиалам.
  useEffect(() => {
    if (!emp?.branches) return;
    for (const b of emp.branches) loadDeliveries(Number(b.branch_id), emp.week);
  }, [emp]);

  async function confirmBranch(b: any) {
    setDelivering(Number(b.branch_id));
    const t = toast.loading('Подтверждаю показ на кассе…');
    try {
      const employees = (b.employees || []).map((e: any) => {
        const text = edited[e.employee_id] ?? e.text;
        return {
          employee_id: e.employee_id,
          employee_name: e.employee_name,
          text,
          facts: { ...e, text },
          coshift: !!e.coshift,
          coshift_names: e.coshift ? (b.employees.filter((x: any) => x.coshift).map((x: any) => x.employee_name)) : null,
        };
      });
      const r = await fetch('/api/admin/weekly-recap/deliver', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          branch_id: b.branch_id,
          period: emp.period || 'week',
          period_from: emp.week,
          period_to: emp.week_end,
          run_id: emp.run_id || null,
          employees,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Ошибка');
      toast.success(j.test ? 'Готово — тест-филиал покажет сразу при открытии смены' : `Готово — покажется ${ddmmyyyy(j.publish_on)}`, { id: t });
      loadDeliveries(Number(b.branch_id), emp.week);
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка', { id: t });
    } finally {
      setDelivering(null);
    }
  }

  async function revokeDelivery(employeeId: number) {
    const d = deliveries[employeeId];
    if (!d?.id) return;
    const t = toast.loading('Отзываю…');
    try {
      const r = await fetch('/api/admin/weekly-recap/deliveries', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'revoke', id: d.id }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Ошибка'); }
      toast.success('Отозвано — на кассе не покажется', { id: t });
      setDeliveries((prev) => { const n = { ...prev }; delete n[employeeId]; return n; });
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка', { id: t });
    }
  }

  return (
    <div className="text-slate-50">
      {/* header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
            <Trophy className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-50">Личные отчёты</div>
            <div className="mt-0.5 text-[12px] text-cyan-300/50">
              Разбор по каждому продавцу — показ на кассе при открытии смены или в личные сообщения
            </div>
          </div>
        </div>
        {/* управление вынесено в карточку под вкладками */}
      </div>

      <AICenterTabs />

      {/* управление: период + дата + действия */}
      <div className="mb-4 rounded-2xl bg-white p-4 ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
        <div className="flex flex-wrap items-center gap-3">
          {/* выбор периода */}
          <div className="inline-flex rounded-xl bg-slate-50 p-1 ring-1 ring-sky-200">
            {([['week', 'Неделя'], ['month', 'Месяц'], ['all', 'С открытия']] as const).map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                onClick={() => setPeriod(val)}
                className={
                  'rounded-lg px-3 py-1.5 text-xs font-semibold transition ' +
                  (period === val ? 'bg-cyan-500 text-white shadow-[0_2px_8px_rgba(34,211,238,0.30)]' : 'text-slate-600 hover:bg-white')
                }
              >
                {lbl}
              </button>
            ))}
          </div>

          {/* дата-якорь (неделя/месяц); для «с открытия» дата не нужна */}
          {period !== 'all' ? (
            <label className="inline-flex items-center gap-2 text-[12px] text-slate-500">
              {period === 'week' ? 'Неделя (любой её день):' : 'Месяц (любой его день):'}
              <input
                type="date"
                value={week}
                onChange={(e) => setWeek(e.target.value)}
                className="rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70"
              />
              <span className="font-semibold text-slate-700">{week ? ddmmyyyy(week) : period === 'week' ? 'последняя неделя' : 'текущий месяц'}</span>
            </label>
          ) : (
            <span className="text-[12px] text-slate-500">С открытия каждого филиала по сегодня</span>
          )}

          <span className="ml-auto" />
          <button
            onClick={genEmployees}
            disabled={empLoading}
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 disabled:opacity-50"
          >
            {empLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Личные отчёты
          </button>
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className={
              'inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium ring-1 transition ' +
              (historyOpen ? 'bg-cyan-50 text-cyan-700 ring-cyan-200' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50')
            }
          >
            <History className="h-4 w-4" /> История{history.length > 0 ? ` (${history.length})` : ''}
          </button>
          <button
            onClick={() => setActivationOpen((v) => !v)}
            className={
              'inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium ring-1 transition ' +
              (activationOpen ? 'bg-cyan-50 text-cyan-700 ring-cyan-200' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50')
            }
          >
            <Monitor className="h-4 w-4" /> Касса
          </button>
        </div>
        <div className="mt-2 text-[11px] text-slate-400">
          {period === 'week' && 'Отчёт за неделю (понедельник — суббота) по каждому продавцу: оценка, продажи, линзы, оправы, переписка, дисциплина, долги, прогресс. Отправляете каждому в личные сообщения.'}
          {period === 'month' && 'Отчёт за календарный месяц по каждому продавцу. Дисциплина — сводкой за месяц, прогресс — к прошлому месяцу.'}
          {period === 'all' && 'Отчёт с открытия каждого филиала по сегодня. Окно длинное — генерация может занять чуть дольше.'}
        </div>
      </div>

      {historyOpen && (
        <div className="mb-4 rounded-2xl bg-white p-4 ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <div className="mb-3 flex items-center gap-2">
            <History className="h-4 w-4 text-cyan-600" />
            <span className="text-sm font-bold text-slate-900">История генераций</span>
            <span className="hidden text-[11px] text-slate-400 sm:inline">открываются без новой генерации и без оплаты</span>
            <span className="ml-auto" />
            {histTotal && histTotal.count > 0 && (
              <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-700 ring-1 ring-cyan-200">
                За всё время: {histTotal.count} ген. ≈ {som(histTotal.cost_usd)}
              </span>
            )}
            <button onClick={() => setHistoryOpen(false)} className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>
          {history.length === 0 ? (
            <div className="py-6 text-center text-[12px] text-slate-400">Пока нет сохранённых генераций. Сгенерируйте разбор — он появится здесь.</div>
          ) : (
            <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
              {history.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => openRun(run)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ring-1 ring-slate-100 transition hover:bg-sky-50/50 hover:ring-sky-200"
                  >
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-50 ring-1 ring-amber-100">
                      <UserRound className="h-4 w-4 text-amber-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-900">Личные отчёты</div>
                      <div className="truncate text-[11px] text-slate-500">
                        {histPeriodText(run)}
                        {' · '}{fmtDateTime(run.created_at)}
                        {run.cost_usd != null ? ` · ≈ ${som(run.cost_usd)}` : ''}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                  </button>
              ))}
            </div>
          )}
        </div>
      )}

      {activationOpen && (
        <div className="mb-4 rounded-2xl bg-white p-4 ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <div className="mb-3 flex items-center gap-2">
            <Monitor className="h-4 w-4 text-cyan-600" />
            <span className="text-sm font-bold text-slate-900">Показ на кассе по филиалам</span>
            <span className="hidden text-[11px] text-slate-400 sm:inline">включите — и подтверждённый разбор всплывёт у продавца на открытии смены в понедельник</span>
            <button onClick={() => setActivationOpen(false)} className="ml-auto rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {activation.map((a) => (
              <div key={a.branch_id} className="flex items-center justify-between rounded-xl px-3 py-2 ring-1 ring-slate-100">
                <span className="text-sm font-medium text-slate-800">
                  {a.name}{a.branch_id === 18 ? <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">тест · любое время</span> : ''}
                </span>
                <button
                  onClick={() => toggleActivation(a.branch_id, !a.enabled)}
                  disabled={toggling === a.branch_id}
                  className={
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold ring-1 transition focus:outline-none focus:ring-2 focus:ring-cyan-400/70 disabled:opacity-50 ' +
                    (a.enabled ? 'bg-cyan-50 text-cyan-700 ring-cyan-200 hover:bg-cyan-100' : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50')
                  }
                >
                  <span className={'h-1.5 w-1.5 rounded-full ' + (a.enabled ? 'bg-cyan-500' : 'bg-slate-300')} />
                  {a.enabled ? 'Вкл' : 'Выкл'}
                </button>
              </div>
            ))}
            {activation.length === 0 && <div className="py-4 text-center text-[12px] text-slate-400 sm:col-span-2">Загрузка филиалов…</div>}
          </div>
        </div>
      )}

      {!emp && !empLoading && (
        <div className="rounded-2xl bg-white px-5 py-10 text-center ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <div className="text-sm font-semibold text-slate-600">
            {period === 'all'
              ? 'Нажмите «Личные отчёты» — соберём разбор с открытия каждого филиала.'
              : `Выберите ${period === 'week' ? 'неделю' : 'месяц'} (или оставьте пусто — возьмём ${period === 'week' ? 'последнюю' : 'текущий'}) и нажмите «Личные отчёты».`}
          </div>
          <div className="mt-1 text-[12px] text-slate-400">Цифры считаются из базы, нейросеть только формулирует текст и ничего не выдумывает.</div>
        </div>
      )}

      {empLoading && (
        <div className="rounded-2xl bg-white px-5 py-10 text-center ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-cyan-500" />
          <div className="mt-2 text-sm text-slate-500">Считаю факт-лист и пишу личные отчёты…</div>
        </div>
      )}


      {emp && (
        <div className="mt-6">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <UserRound className="h-4 w-4 text-cyan-300" />
            <span className="text-sm font-bold text-slate-50">Личные отчёты</span>
            <span className="text-[12px] text-cyan-300/50">{periodText(emp)}{emp.llm ? ` · эта генерация ≈ ${som(emp.llm.cost_usd)}` : ''}</span>
            {viewingEmpAt && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2.5 py-0.5 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-400/40">
                <History className="h-3 w-3" /> из истории · {fmtDateTime(viewingEmpAt)}
              </span>
            )}
          </div>
          {emp.owner_notes?.length > 0 && (
            <div className="mb-4 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                <Lock className="h-3 w-3" /> Только для вас · сотрудникам не отправлять
              </div>
              <ul className="mt-2 space-y-1.5">
                {emp.owner_notes.map((n: string, i: number) => (
                  <li key={i} className="flex gap-2 text-[13px] text-slate-700"><span className="text-amber-500">•</span><span>{n}</span></li>
                ))}
              </ul>
            </div>
          )}
          <div className="space-y-4">
            {emp.branches.map((b: any) => {
              const act = activation.find((a: any) => Number(a.branch_id) === Number(b.branch_id));
              const enabled = act ? !!act.enabled : false;
              const empIds = (b.employees || []).map((e: any) => Number(e.employee_id));
              const dels = empIds.map((id: number) => deliveries[id]).filter(Boolean).filter((d: any) => d.status !== 'revoked');
              const confirmedAll = empIds.length > 0 && dels.length >= empIds.length;
              const seenN = dels.filter((d: any) => d.status === 'seen').length;
              const objN = dels.filter((d: any) => d.has_objection).length;
              return (
              <div key={b.branch_id} className="rounded-2xl bg-white p-4 ring-1 ring-sky-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Building2 className="h-4 w-4 shrink-0 text-cyan-600" />
                    <span className="truncate text-sm font-bold text-slate-900">{b.branch_name}</span>
                    <span className="shrink-0 text-[11px] text-slate-400">{b.employees.length} сотр.</span>
                  </div>
                  {dels.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">прочитали {seenN}/{dels.length}</span>
                      {objN > 0 && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-200">возражений {objN}</span>}
                    </div>
                  )}
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => toggleActivation(Number(b.branch_id), !enabled)}
                      disabled={toggling === Number(b.branch_id)}
                      className={
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1 transition focus:outline-none focus:ring-2 focus:ring-cyan-400/70 disabled:opacity-50 ' +
                        (enabled ? 'bg-cyan-50 text-cyan-700 ring-cyan-200 hover:bg-cyan-100' : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50')
                      }
                      title="Показ разбора на кассе этого филиала"
                    >
                      <Monitor className="h-3.5 w-3.5" />
                      {enabled ? 'Касса вкл' : 'Касса выкл'}
                    </button>
                    <button
                      onClick={() => confirmBranch(b)}
                      disabled={delivering === Number(b.branch_id)}
                      className={
                        'inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-cyan-300/70 disabled:opacity-50 ' +
                        (confirmedAll
                          ? 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                          : 'bg-cyan-500 text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] hover:bg-cyan-400')
                      }
                      title="Подтвердить показ на кассе филиала"
                    >
                      {delivering === Number(b.branch_id) ? <Loader2 className="h-4 w-4 animate-spin" /> : confirmedAll ? <CheckCircle2 className="h-4 w-4 text-cyan-600" /> : <Send className="h-4 w-4" />}
                      {confirmedAll ? 'Подтверждено · обновить' : 'Подтвердить → на кассу'}
                    </button>
                  </div>
                </div>
                {!enabled && (
                  <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 ring-1 ring-amber-200">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Показ на кассе этого филиала выключен — продавцы не увидят разбор, пока не включите «Касса».
                  </div>
                )}
                <div className="space-y-2">
                  {b.employees.map((e: any) => {
                    const sc = e.score;
                    const tone = SCORE_TONE[sc?.tone || 'slate'];
                    const sub = sc?.sub;
                    const good = e.summary_signals?.good || [];
                    const fix = e.summary_signals?.fix || [];
                    const notes = e.mood?.real_notes || [];
                    return (
                    <div key={e.employee_id} className="rounded-2xl bg-white p-4 ring-1 ring-sky-100 shadow-[0_4px_16px_rgba(15,23,42,0.06)]">
                      {/* шапка: имя + балл */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-sm font-bold text-slate-600">
                            {(e.employee_name || '?').trim().charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-base font-bold text-slate-900">{e.employee_name}</div>
                            <div className="mt-0.5 flex flex-wrap gap-1.5">
                              <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-700 ring-1 ring-cyan-200">{e.branch_name}</span>
                              {e.coshift && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700 ring-1 ring-sky-200">общая смена</span>}
                              {!!e.discipline?.broken_schedule && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">проверьте график</span>}
                              {Number(e.discipline?.streak_no_late) >= 10 && <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200"><Flame className="h-3 w-3" /> {e.discipline.streak_no_late} дней без опозданий</span>}
                              {e.progress && (
                                <span className={'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ' + (e.progress.score_now >= e.progress.score_prev ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200')}>
                                  {e.progress.score_now >= e.progress.score_prev ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                  {e.progress.score_prev} → {e.progress.score_now}
                                </span>
                              )}
                              {edited[e.employee_id] != null && edited[e.employee_id] !== e.text && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-700 ring-1 ring-cyan-200">
                                  <Pencil className="h-3 w-3" /> изменено
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <div className={'grid place-items-center rounded-2xl px-3 py-1 text-center ring-1 ' + tone}>
                            <div className="text-2xl font-bold leading-none">{sc?.final != null ? sc.final.toFixed(1) : '—'}<span className="text-sm font-semibold opacity-60">/10</span></div>
                            <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{sc?.label || 'мало данных'}</div>
                          </div>
                          <button
                            onClick={() => setEditing((p) => ({ ...p, [e.employee_id]: !p[e.employee_id] }))}
                            className={
                              'inline-flex h-9 w-9 items-center justify-center rounded-xl ring-1 transition ' +
                              (editing[e.employee_id] ? 'bg-cyan-50 text-cyan-600 ring-cyan-200' : 'text-slate-500 ring-slate-200 hover:bg-cyan-50 hover:text-cyan-600 hover:ring-cyan-200')
                            }
                            title="Править текст перед показом"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => copyOne(edited[e.employee_id] ?? e.text)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 ring-1 ring-slate-200 transition hover:bg-cyan-50 hover:text-cyan-600 hover:ring-cyan-200"
                            title="Копировать отчёт"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {/* подскоры */}
                      {sub && (
                        <div className={'mt-3 grid gap-2 ' + (sub.voice != null ? 'grid-cols-4' : 'grid-cols-3')}>
                          <SubScore label="Продажи" value={sub.sales} />
                          <SubScore label="Сервис" value={sub.service} />
                          <SubScore label="Дисциплина" value={sub.discipline} />
                          {sub.voice != null && <SubScore label="Настрой" value={sub.voice} />}
                        </div>
                      )}

                      {/* до премии (командная, по филиалу) */}
                      {e.premium && e.premium.target > 0 && (
                        <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide text-slate-500"><Target className="h-3 w-3" /> До премии {fmt(e.premium.bonus_each)} с / чел</span>
                            <span className={e.premium.reached ? 'font-bold text-emerald-700' : 'font-bold text-slate-900'}>
                              {e.premium.reached ? 'план выполнен 👍' : 'осталось ' + fmt(e.premium.remaining) + ' с'}
                            </span>
                          </div>
                          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200">
                            <div className={'h-full rounded-full ' + (e.premium.reached ? 'bg-emerald-500' : 'bg-cyan-500')} style={{ width: (e.premium.reached ? 100 : Math.min(100, Math.round((100 * e.premium.current) / e.premium.target))) + '%' }} />
                          </div>
                          <div className="mt-1 text-[10px] text-slate-400">по филиалу: {fmt(e.premium.current)} из {fmt(e.premium.target)} с</div>
                        </div>
                      )}

                      {/* долги клиентов по филиалу (когда заметно выше сети) */}
                      {e.debts && e.debts.high && (
                        <div className="mt-3 rounded-xl bg-rose-50/60 p-3 ring-1 ring-rose-100">
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-rose-700"><AlertTriangle className="h-3 w-3" /> Долги клиентов по филиалу</div>
                          <div className="mt-1 text-[13px] text-slate-700">
                            {fmt(e.debts.debt_sum)} с — {e.debts.debt_pct}% от продаж{e.debts.best_branch ? `, в ${e.debts.best_branch} ${e.debts.best_pct}%` : ''}. Дозванивать и закрывать остатки.
                          </div>
                        </div>
                      )}

                      {/* итог: что хорошо / что подтянуть */}
                      {(good.length > 0 || fix.length > 0) && (
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {good.length > 0 && (
                            <div className="rounded-xl bg-emerald-50/60 p-2.5 ring-1 ring-emerald-100">
                              <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Хорошо</div>
                              <ul className="space-y-0.5">{good.map((g: string, i: number) => <li key={i} className="text-[12px] text-slate-700">• {g}</li>)}</ul>
                            </div>
                          )}
                          {fix.length > 0 && (
                            <div className="rounded-xl bg-amber-50/60 p-2.5 ring-1 ring-amber-100">
                              <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700"><AlertTriangle className="h-3 w-3" /> Подтянуть</div>
                              <ul className="space-y-0.5">{fix.map((g: string, i: number) => <li key={i} className="text-[12px] text-slate-700">• {g}</li>)}</ul>
                            </div>
                          )}
                        </div>
                      )}

                      {/* текст-отчёт по разделам (с правкой перед показом на кассе) */}
                      {editing[e.employee_id] ? (
                        <div className="mt-3">
                          <textarea
                            value={edited[e.employee_id] ?? e.text}
                            onChange={(ev) => setEdited((p) => ({ ...p, [e.employee_id]: ev.target.value }))}
                            rows={14}
                            className="w-full rounded-xl bg-white p-3 text-[13px] leading-6 text-slate-800 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70"
                          />
                          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400">
                            <span className="min-w-0 flex-1">Правка уходит в показ на кассе при «Подтвердить». Исходный отчёт не меняется.</span>
                            {edited[e.employee_id] != null && edited[e.employee_id] !== e.text && (
                              <button
                                onClick={() => setEdited((p) => { const n = { ...p }; delete n[e.employee_id]; return n; })}
                                className="shrink-0 rounded-lg px-2 py-0.5 font-medium text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50"
                              >
                                Сбросить правку
                              </button>
                            )}
                            <button
                              onClick={() => setEditing((p) => ({ ...p, [e.employee_id]: false }))}
                              className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-cyan-50 px-2 py-0.5 font-semibold text-cyan-700 ring-1 ring-cyan-200 hover:bg-cyan-100"
                            >
                              <Check className="h-3 w-3" /> Готово
                            </button>
                          </div>
                        </div>
                      ) : (
                        <ReportText text={edited[e.employee_id] ?? e.text} />
                      )}

                      {/* статус доставки на кассу + ответы продавца (петля обратной связи) */}
                      {deliveries[Number(e.employee_id)] && (() => {
                        const d = deliveries[Number(e.employee_id)];
                        return (
                          <div className={'mt-3 rounded-xl p-3 ring-1 ' + (d.has_objection ? 'bg-rose-50/60 ring-rose-100' : 'bg-sky-50/40 ring-sky-100')}>
                            <div className="flex flex-wrap items-center gap-2 text-[11px]">
                              <span className="font-semibold uppercase tracking-wide text-slate-500">Касса</span>
                              <span className={'rounded-full px-2 py-0.5 font-semibold ring-1 ' + (d.status === 'seen' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-amber-200')}>
                                {d.status === 'seen' ? `прочитал${d.seen_at ? ' · ' + fmtDateTime(d.seen_at) : ''}` : `ждёт показа${d.publish_on ? ' · ' + ddmmyyyy(d.publish_on) : ''}`}
                              </span>
                              {d.avg_clarity != null && <span className="text-slate-500">понятность {d.avg_clarity}/5</span>}
                              {d.agree_summary?.length > 0 && <span className={d.has_objection ? 'font-semibold text-rose-600' : 'text-slate-500'}>согласие: {d.agree_summary.map(ruAgree).join(', ')}</span>}
                              {d.focus_choice && <span className="text-slate-500">фокус: {d.focus_choice}</span>}
                              <button
                                onClick={() => revokeDelivery(Number(e.employee_id))}
                                className="ml-auto inline-flex items-center gap-1 rounded-lg bg-white px-2 py-0.5 text-[11px] font-medium text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-100"
                                title="Отозвать показ на кассе"
                              >
                                <X className="h-3 w-3" /> Отозвать
                              </button>
                            </div>
                            {(d.questions?.length > 0 || d.comments?.length > 0) && (
                              <div className="mt-2 space-y-1.5">
                                {d.questions?.map((q: any, i: number) => (
                                  <div key={'q' + i} className="flex items-start gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[12px] text-slate-700 ring-1 ring-slate-200">
                                    <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /><span>{q.question_text || q.question_transcript}</span>
                                  </div>
                                ))}
                                {d.comments?.map((c: any, i: number) => (
                                  <div key={'c' + i} className="flex items-start gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[12px] text-slate-700 ring-1 ring-slate-200">
                                    <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /><span>{c.comment}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* фидбэк сотрудника (что писал в конце смены) */}
                      {e.mood && (
                        <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{MOOD_EMOJI[Math.min(5, Math.max(1, Math.round(Number(e.mood.mood_week) || 3)))] || '😐'}</span>
                            <div>
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Фидбэк в конце смены</div>
                              <div className="text-[12px] text-slate-600">настроение {Number(e.mood.mood_week).toFixed(1)}/5</div>
                            </div>
                          </div>
                          {notes.length > 0 && (
                            <div className="mt-2 space-y-1.5">
                              {notes.map((t: string, i: number) => {
                                const hot = /кондиционер|жарко|душно|кулл?ер|жара/i.test(t);
                                return <div key={i} className={'rounded-lg px-3 py-1.5 text-[12px] ring-1 ' + (hot ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-white text-slate-700 ring-slate-200')}>«{t}»</div>;
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
