'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import toast from 'react-hot-toast';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  X,
  Loader2,
  RefreshCw,
  Search,
  Building2,
  Plus,
  Ban,
} from 'lucide-react';

/* ──────────── types ──────────── */

type WarningLevel = 'remark' | 'warning' | 'severe';
type DisciplineStatus = 'normal' | 'attention' | 'control' | 'threshold' | 'dismissal';

type Branch = { id: number; name: string };

type EmployeeRow = {
  id: number;
  full_name: string;
  branch_id: number | null;
  branch_name: string | null;
  role: string | null;
  active_remarks: number;
  active_warnings: number;
  active_severe: number;
  total_points: number;
  status: DisciplineStatus;
};

/** Балльная система: 1 / 3 / 5, порог увольнения — 10 */
const DISMISSAL_THRESHOLD = 10;
const LEVEL_POINTS: Record<WarningLevel, number> = {
  remark: 1,
  warning: 3,
  severe: 5,
};

type WarningRow = {
  id: number;
  employee_id: number;
  branch_id: number | null;
  level: WarningLevel;
  reason: string;
  issued_at: string;
  expires_at: string;
  is_cancelled: boolean;
  cancel_reason: string | null;
  cancelled_at: string | null;
  created_by: number | null;
};

/* ──────────── shared style helpers ──────────── */

function Shell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white ring-1 ring-sky-100 px-5 py-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)] text-slate-900 ${className}`}>
      {children}
    </div>
  );
}

const LEVEL_LABEL: Record<WarningLevel, string> = {
  remark: 'Замечание',
  warning: 'Выговор',
  severe: 'Строгий выговор',
};

const LEVEL_LABEL_WITH_PTS: Record<WarningLevel, string> = {
  remark: 'Замечание (1 балл)',
  warning: 'Выговор (3 балла)',
  severe: 'Строгий выговор (5 баллов)',
};

const LEVEL_ICON: Record<WarningLevel, React.ReactNode> = {
  remark: <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />,
  warning: <span className="inline-block h-2.5 w-2.5 bg-orange-500" style={{ clipPath: 'polygon(50% 0, 100% 100%, 0 100%)' }} />,
  severe: <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-500" />,
};

const STATUS_META: Record<DisciplineStatus, {
  label: string;
  color: string;
  bg: string;
  ring: string;
  bar: string;        // цвет заливки прогресс-бара
  icon: React.ReactNode;
}> = {
  normal: {
    label: 'Нормально',
    color: 'text-slate-500',
    bg: 'bg-slate-50',
    ring: 'ring-slate-200',
    bar: 'bg-slate-300',
    icon: <ShieldCheck className="h-3.5 w-3.5" />,
  },
  attention: {
    label: 'Внимание',
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    ring: 'ring-amber-200',
    bar: 'bg-amber-400',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
  },
  control: {
    label: 'На контроле',
    color: 'text-orange-700',
    bg: 'bg-orange-50',
    ring: 'ring-orange-200',
    bar: 'bg-orange-500',
    icon: <ShieldAlert className="h-3.5 w-3.5" />,
  },
  threshold: {
    label: 'Последнее предупреждение',
    color: 'text-rose-700',
    bg: 'bg-rose-50',
    ring: 'ring-rose-200',
    bar: 'bg-rose-500',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
  },
  dismissal: {
    label: 'Порог увольнения',
    color: 'text-rose-800',
    bg: 'bg-rose-100',
    ring: 'ring-rose-300',
    bar: 'bg-rose-600',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
  },
};

/* ──────────── small visual: dots row ──────────── */

/**
 * Прогресс-бар балльной шкалы. Полоска заполняется до DISMISSAL_THRESHOLD баллов;
 * при достижении порога — пульсирует.
 *
 * variant="inline" — компактная полоска фиксированной ширины (для списка)
 * variant="block"  — растягивается на всю ширину родителя (для модалки)
 *
 * Реализация через flex + h-full (без absolute) — стабильнее в разных браузерах.
 */
function PointsBar({
  points,
  status,
  variant = 'inline',
}: {
  points: number;
  status: DisciplineStatus;
  variant?: 'inline' | 'block';
}) {
  const pct = Math.min(100, Math.max(0, Math.round((points / DISMISSAL_THRESHOLD) * 100)));
  const meta = STATUS_META[status];
  const isDismissal = status === 'dismissal';

  if (variant === 'block') {
    return (
      <div className={`flex items-center gap-3 ${isDismissal ? 'animate-pulse' : ''}`}>
        <div className="flex-1 h-3 rounded-full bg-slate-200 overflow-hidden ring-1 ring-slate-300">
          <div
            className={`h-full ${meta.bar} transition-all duration-500 rounded-full`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={`text-[13px] font-bold tabular-nums whitespace-nowrap ${meta.color}`}>
          {points}<span className="text-slate-400 font-normal">/{DISMISSAL_THRESHOLD}</span>
        </span>
      </div>
    );
  }

  // inline-вариант для списка
  return (
    <div className={`inline-flex items-center gap-2 ${isDismissal ? 'animate-pulse' : ''}`}>
      <div className="w-44 h-2.5 rounded-full bg-slate-200 overflow-hidden ring-1 ring-slate-200">
        <div
          className={`h-full ${meta.bar} transition-all duration-500 rounded-full`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[11px] font-bold tabular-nums whitespace-nowrap ${meta.color}`}>
        {points}<span className="text-slate-400">/{DISMISSAL_THRESHOLD}</span>
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: DisciplineStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ring-1 ${meta.bg} ${meta.color} ${meta.ring}`}>
      {meta.icon}
      {meta.label}
    </span>
  );
}

/* ──────────── format date ──────────── */

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return '—'; }
}

/* ──────────── modal ──────────── */

function DisciplineModal({
  employee,
  warnings,
  loading,
  onClose,
  onApply,
  onCancel,
}: {
  employee: EmployeeRow;
  warnings: WarningRow[];
  loading: boolean;
  onClose: () => void;
  onApply: (level: WarningLevel, reason: string) => Promise<void>;
  onCancel: (warningId: number, cancelReason: string) => Promise<void>;
}) {
  const [level, setLevel] = useState<WarningLevel>('remark');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const active = warnings.filter(w => !w.is_cancelled && new Date(w.expires_at) > new Date());
  const history = warnings.filter(w => w.is_cancelled || new Date(w.expires_at) <= new Date());

  async function handleApply() {
    if (!reason.trim()) {
      toast.error('Укажи причину');
      return;
    }
    setBusy(true);
    try {
      await onApply(level, reason.trim());
      setReason('');
      setLevel('remark');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(id: number) {
    const why = window.prompt('Причина отмены взыскания (опционально):') ?? '';
    setBusy(true);
    try {
      await onCancel(id, why);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-3xl bg-white ring-1 ring-sky-100 shadow-[0_30px_80px_rgba(0,0,0,0.4)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-cyan-500 text-white shadow-[0_4px_16px_rgba(34,211,238,0.3)]">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-lg font-bold tracking-tight text-slate-900 truncate">{employee.full_name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                  {employee.branch_name && (
                    <span className="inline-flex items-center gap-1">
                      <Building2 className="h-3.5 w-3.5" /> {employee.branch_name}
                    </span>
                  )}
                  <StatusPill status={employee.status} />
                </div>
              </div>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Прогресс баллов до увольнения */}
          <div className="mt-4 rounded-2xl bg-slate-50 ring-1 ring-slate-200 px-4 py-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Баллы до увольнения
              </div>
              <div className="text-[11px] text-slate-500 tabular-nums">
                Замечание = 1 · Выговор = 3 · Строгий = 5
              </div>
            </div>
            <PointsBar points={employee.total_points} status={employee.status} variant="block" />
            {(employee.active_remarks + employee.active_warnings + employee.active_severe) > 0 && (
              <div className="mt-2 text-[11px] text-slate-500">
                Активные: {employee.active_severe > 0 && <strong className="text-rose-700">{employee.active_severe} строгих × 5 </strong>}
                {employee.active_warnings > 0 && <strong className="text-orange-700">{employee.active_warnings} выговоров × 3 </strong>}
                {employee.active_remarks > 0 && <strong className="text-amber-700">{employee.active_remarks} замечаний × 1</strong>}
                {' '}= <strong className="text-slate-900 tabular-nums">{employee.total_points} баллов</strong>
              </div>
            )}
          </div>
        </div>

        {/* Apply form */}
        <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/40">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-3">
            Применить новое взыскание
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {(['remark', 'warning', 'severe'] as WarningLevel[]).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setLevel(lvl)}
                disabled={busy}
                className={
                  'inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition disabled:opacity-50 ' +
                  (level === lvl
                    ? lvl === 'remark'
                      ? 'bg-amber-500 text-white ring-1 ring-amber-400 shadow-[0_4px_12px_rgba(245,158,11,0.25)]'
                      : lvl === 'warning'
                      ? 'bg-orange-500 text-white ring-1 ring-orange-400 shadow-[0_4px_12px_rgba(249,115,22,0.25)]'
                      : 'bg-rose-500 text-white ring-1 ring-rose-400 shadow-[0_4px_12px_rgba(244,63,94,0.25)]'
                    : 'bg-white text-slate-600 ring-1 ring-sky-200 hover:bg-sky-50')
                }
              >
                {LEVEL_ICON[lvl]}
                {LEVEL_LABEL_WITH_PTS[lvl]}
              </button>
            ))}
          </div>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Причина (например: грубость с клиентом, опоздание на 25 минут)"
            rows={2}
            disabled={busy}
            className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 placeholder:text-slate-400 disabled:opacity-50"
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="text-[11px] text-slate-500">
              Срок действия взыскания — 12 месяцев. Сразу появится в карточке сотрудника на «Моей смене» в POS.
            </div>
            <button
              onClick={handleApply}
              disabled={busy || !reason.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-300/70 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Применить
            </button>
          </div>
        </div>

        {/* Active warnings */}
        <div className="px-6 py-5">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-3">
            Действующие взыскания · {active.length}
          </div>
          {loading ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
            </div>
          ) : active.length === 0 ? (
            <div className="rounded-xl bg-emerald-50 ring-1 ring-emerald-100 px-4 py-3 text-[13px] text-emerald-700">
              Нет действующих взысканий. Сотрудник чист.
            </div>
          ) : (
            <ul className="space-y-2">
              {active.map((w) => (
                <li key={w.id} className="flex items-start gap-3 rounded-xl bg-slate-50 ring-1 ring-slate-200 px-4 py-3">
                  <span className="mt-1 shrink-0">{LEVEL_ICON[w.level]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="font-semibold text-slate-900">{LEVEL_LABEL[w.level]}</span>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-600">{fmtDate(w.issued_at)}</span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-slate-700">{w.reason || '—'}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">Действует до {fmtDate(w.expires_at)}</div>
                  </div>
                  <button
                    onClick={() => handleCancel(w.id)}
                    disabled={busy}
                    title="Отменить взыскание"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 ring-1 ring-slate-200 transition hover:bg-rose-50 hover:text-rose-600 hover:ring-rose-200 disabled:opacity-50"
                  >
                    <Ban className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* History */}
        {history.length > 0 && (
          <div className="px-6 pb-6 border-t border-slate-100 pt-4">
            <details>
              <summary className="cursor-pointer text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-3 select-none hover:text-slate-700">
                История · {history.length} (отменённые и истёкшие)
              </summary>
              <ul className="mt-3 space-y-2">
                {history.map((w) => (
                  <li key={w.id} className="flex items-start gap-3 rounded-xl bg-slate-50/50 ring-1 ring-slate-100 px-4 py-3 opacity-70">
                    <span className="mt-1 shrink-0 grayscale">{LEVEL_ICON[w.level]}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[13px]">
                        <span className="font-semibold text-slate-700">{LEVEL_LABEL[w.level]}</span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-500">{fmtDate(w.issued_at)}</span>
                        {w.is_cancelled && (
                          <span className="ml-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">отменено</span>
                        )}
                        {!w.is_cancelled && new Date(w.expires_at) <= new Date() && (
                          <span className="ml-1 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">истекло</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[12px] text-slate-600">{w.reason || '—'}</div>
                      {w.cancel_reason && (
                        <div className="mt-0.5 text-[11px] text-slate-400">Причина отмены: {w.cancel_reason}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────── main tab component ──────────── */

export default function DisciplinesTab() {
  const sb = useMemo(() => getBrowserSupabase(), []);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [branchFilter, setBranchFilter] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const [modalEmployee, setModalEmployee] = useState<EmployeeRow | null>(null);
  const [modalWarnings, setModalWarnings] = useState<WarningRow[]>([]);
  const [modalLoading, setModalLoading] = useState(false);

  /* ── load branches ── */
  useEffect(() => {
    (async () => {
      const { data } = await sb.from('branches').select('id, name').order('name');
      setBranches((data ?? []) as Branch[]);
    })();
  }, [sb]);

  /* ── load employees + status (без nested-join, надёжнее) ── */
  async function loadEmployees() {
    const isFirstLoad = employees.length === 0;
    if (isFirstLoad) setLoading(true);
    else setRefreshing(true);
    try {
      // 1) сотрудники без join'ов
      const { data: emps, error: e1 } = await sb
        .from('employees')
        .select('id, full_name, branch_id, role')
        .eq('is_active', true)
        .order('full_name');
      if (e1) throw e1;

      // 2) филиалы — отдельным запросом (надёжнее, чем nested select)
      const { data: brs, error: e2 } = await sb
        .from('branches')
        .select('id, name');
      if (e2) throw e2;
      const branchMap = new Map<number, string>((brs ?? []).map((b: any) => [b.id, b.name]));

      // 3) дисциплинарный статус — для всех найденных сотрудников
      const empIds = (emps ?? []).map((r: any) => r.id as number);
      let statusByEmp = new Map<number, Pick<EmployeeRow, 'active_remarks' | 'active_warnings' | 'active_severe' | 'total_points' | 'status'>>();

      if (empIds.length > 0) {
        const { data: statuses, error: e3 } = await sb
          .from('v_employee_discipline_status')
          .select('employee_id, active_remarks, active_warnings, active_severe, total_points, status')
          .in('employee_id', empIds);
        if (e3) throw e3;

        statusByEmp = new Map(
          (statuses ?? []).map((s: any) => [
            s.employee_id as number,
            {
              active_remarks: s.active_remarks ?? 0,
              active_warnings: s.active_warnings ?? 0,
              active_severe: s.active_severe ?? 0,
              total_points: s.total_points ?? 0,
              status: (s.status ?? 'normal') as DisciplineStatus,
            },
          ])
        );
      }

      const rows: EmployeeRow[] = (emps ?? []).map((r: any) => {
        const st = statusByEmp.get(r.id) ?? {
          active_remarks: 0,
          active_warnings: 0,
          active_severe: 0,
          total_points: 0,
          status: 'normal' as DisciplineStatus,
        };
        return {
          id: r.id,
          full_name: r.full_name ?? '—',
          branch_id: r.branch_id ?? null,
          branch_name: r.branch_id != null ? branchMap.get(r.branch_id) ?? null : null,
          role: r.role ?? null,
          ...st,
        };
      });

      setEmployees(rows);
    } catch (err: any) {
      // Supabase-ошибки — это объекты с .message, а не Error-инстанс. Извлекаем человеческий текст.
      const msg =
        err?.message ||
        err?.details ||
        (typeof err === 'string' ? err : null) ||
        'Не удалось загрузить';
      toast.error(`Дисциплинарные взыскания: ${msg}`);
      // eslint-disable-next-line no-console
      console.error('[DisciplinesTab loadEmployees]', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── filter ── */
  const filtered = useMemo(() => {
    let rows = employees;
    if (branchFilter != null) rows = rows.filter((r) => r.branch_id === branchFilter);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.full_name.toLowerCase().includes(q));
    return rows;
  }, [employees, branchFilter, search]);

  /* ── modal data load ── */
  async function openEmployeeModal(emp: EmployeeRow) {
    setModalEmployee(emp);
    setModalWarnings([]);
    setModalLoading(true);
    try {
      const { data, error } = await sb
        .from('employee_warnings')
        .select('id, employee_id, branch_id, level, reason, issued_at, expires_at, is_cancelled, cancel_reason, cancelled_at, created_by')
        .eq('employee_id', emp.id)
        .order('issued_at', { ascending: false });
      if (error) throw error;
      setModalWarnings((data ?? []) as WarningRow[]);
    } catch (err: any) {
      const msg = err?.message || err?.details || 'Не удалось загрузить взыскания';
      toast.error(msg);
      // eslint-disable-next-line no-console
      console.error('[DisciplinesTab openEmployeeModal]', err);
    } finally {
      setModalLoading(false);
    }
  }

  function closeModal() {
    setModalEmployee(null);
    setModalWarnings([]);
  }

  /* ── apply / cancel ── */
  async function applyWarning(level: WarningLevel, reason: string) {
    if (!modalEmployee) return;
    const t = toast.loading('Применяю…');
    try {
      const { error } = await sb.from('employee_warnings').insert({
        employee_id: modalEmployee.id,
        branch_id: modalEmployee.branch_id,
        level,
        reason,
      });
      if (error) throw error;
      toast.dismiss(t);
      toast.success(`${LEVEL_LABEL[level]} применено`);
      // refresh modal warnings + employee status
      await openEmployeeModal(modalEmployee);
      await loadEmployees();
      // refresh local modalEmployee status from new employees state
      const updated = employees.find((e) => e.id === modalEmployee.id);
      if (updated) setModalEmployee(updated);
    } catch (err: any) {
      toast.dismiss(t);
      const msg = err?.message || err?.details || 'Не удалось применить';
      toast.error(msg);
      // eslint-disable-next-line no-console
      console.error('[DisciplinesTab applyWarning]', err);
    }
  }

  async function cancelWarning(warningId: number, cancelReason: string) {
    if (!modalEmployee) return;
    const t = toast.loading('Отменяю…');
    try {
      const { error } = await sb
        .from('employee_warnings')
        .update({
          is_cancelled: true,
          cancel_reason: cancelReason || null,
          cancelled_at: new Date().toISOString(),
        })
        .eq('id', warningId);
      if (error) throw error;
      toast.dismiss(t);
      toast.success('Отменено');
      await openEmployeeModal(modalEmployee);
      await loadEmployees();
    } catch (err: any) {
      toast.dismiss(t);
      const msg = err?.message || err?.details || 'Не удалось отменить';
      toast.error(msg);
      // eslint-disable-next-line no-console
      console.error('[DisciplinesTab cancelWarning]', err);
    }
  }

  // refresh modalEmployee status when employees list updates
  useEffect(() => {
    if (!modalEmployee) return;
    const fresh = employees.find((e) => e.id === modalEmployee.id);
    if (fresh && fresh !== modalEmployee) setModalEmployee(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees]);

  /* ──────────── render ──────────── */

  return (
    <div className="space-y-5">
      {/* Header / filters */}
      <Shell>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[15px] font-semibold text-slate-900">Дисциплинарные взыскания</div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Замечание / Выговор / Строгий выговор. Срок действия — 12 месяцев. Накопление до увольнения по контракту 8.8 §9.
            </p>
          </div>
          <button
            onClick={() => void loadEmployees()}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Обновить
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:flex md:flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setBranchFilter(null)}
              className={
                'rounded-xl px-3 py-1.5 text-[12px] font-semibold transition ' +
                (branchFilter == null
                  ? 'bg-cyan-500 text-white ring-1 ring-cyan-400 shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
                  : 'bg-white text-slate-600 ring-1 ring-sky-200 hover:bg-sky-50')
              }
            >
              Все филиалы
            </button>
            {branches.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setBranchFilter(b.id)}
                className={
                  'rounded-xl px-3 py-1.5 text-[12px] font-semibold transition ' +
                  (branchFilter === b.id
                    ? 'bg-cyan-500 text-white ring-1 ring-cyan-400 shadow-[0_4px_12px_rgba(34,211,238,0.25)]'
                    : 'bg-white text-slate-600 ring-1 ring-sky-200 hover:bg-sky-50')
                }
              >
                {b.name}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full md:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Поиск по имени"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl bg-white pl-9 pr-3 py-2 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400/70 placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* Employee list */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100 ring-1 ring-slate-200" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 px-6 py-10 text-center text-slate-500 text-sm">
            Нет сотрудников по выбранным фильтрам.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 -mx-5">
            {filtered.map((emp) => {
              const initial = (emp.full_name || '?').trim().charAt(0).toUpperCase();
              return (
                <li key={emp.id}>
                  <button
                    type="button"
                    onClick={() => void openEmployeeModal(emp)}
                    className="w-full flex items-center gap-4 px-5 py-3 text-left transition hover:bg-sky-50/40"
                  >
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-cyan-500 text-white text-[16px] font-bold shadow-[0_4px_12px_rgba(34,211,238,0.25)]">
                      {initial}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900 truncate">{emp.full_name}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {emp.branch_name ?? 'без филиала'}{emp.role ? ` · ${emp.role}` : ''}
                      </div>
                    </div>

                    {/* Прогресс-бар баллов до увольнения */}
                    <div className="hidden sm:block mr-4">
                      <PointsBar points={emp.total_points} status={emp.status} />
                      {(emp.active_remarks + emp.active_warnings + emp.active_severe) > 0 && (
                        <div className="mt-1 text-[10px] text-slate-400 tabular-nums text-right">
                          {emp.active_severe > 0 && <>{emp.active_severe}×строг · </>}
                          {emp.active_warnings > 0 && <>{emp.active_warnings}×выг · </>}
                          {emp.active_remarks > 0 && <>{emp.active_remarks}×зам</>}
                        </div>
                      )}
                    </div>

                    <StatusPill status={emp.status} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Shell>

      {/* Modal */}
      {modalEmployee && (
        <DisciplineModal
          employee={modalEmployee}
          warnings={modalWarnings}
          loading={modalLoading}
          onClose={closeModal}
          onApply={applyWarning}
          onCancel={cancelWarning}
        />
      )}
    </div>
  );
}
