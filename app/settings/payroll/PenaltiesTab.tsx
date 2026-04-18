'use client';

import React, { useEffect, useRef, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import { Clock, LogOut, Trash2, Plus, Save, ChevronRight, X, AlertCircle, Calendar, History, CheckCircle2, DoorOpen, RefreshCw, Timer } from 'lucide-react';

/* ---------- types ---------- */

type RuleType = 'late' | 'early';

type PenaltyRule = {
  id: number;
  rule_type: RuleType;
  threshold_m: number;
  amount: number;
};

type Branch = {
  id: number;
  name: string;
  schedule_start: string; // "HH:MM"
  schedule_end: string;
  sunday_off: boolean;
  mixed_weekdays?: boolean;
};

type SessionPenaltyRow = {
  id: number;
  session_id: number;
  employee_id: number;
  employee_name: string;
  branch_name: string;
  work_date: string;
  type: string;
  minutes: number | null;
  amount: number;
  is_cancelled: boolean;
  cancel_reason: string | null;
};

type EmployeeSummary = {
  employee_id: number;
  employee_name: string;
  branch_name: string;
  active_count: number;
  active_total: number;
};

type AttendanceRow = {
  session_id: number;
  full_name: string;
  branch_name: string;
  started_at: string | null;
  ended_at: string | null;
  late_minutes: number;
  early_leave_minutes: number;
  penalty_total: number;
  flag_late: boolean;
  flag_early_leave: boolean;
  flag_afk: boolean;
  flag_no_close: boolean;
  work_date?: string | null;
};

/* ---------- helpers ---------- */

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES_STEP = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function pad2(n: number) {
  return String(n).padStart(2, '0');
}
function parseTimeStr(v: string | null | undefined) {
  if (!v) return { h: 9, m: 0 };
  const [hStr, mStr] = String(v).split(':');
  return {
    h: Math.min(23, Math.max(0, Number(hStr) || 0)),
    m: Math.min(59, Math.max(0, Number(mStr) || 0)),
  };
}
function normHHMM(v: any): string {
  return v ? String(v).slice(0, 5) : '';
}

/* ---------- attendance helpers ---------- */
const TZ = 'Asia/Bishkek';

function fmtTime(iso?: string | null, assumeUtc = false): string {
  if (!iso) return '—';
  try {
    let s = String(iso).trim();
    const hasTZ = /Z$|[+-]\d{2}:\d{2}$/.test(s);
    if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
    const d = !hasTZ && assumeUtc ? new Date(s + 'Z') : new Date(s);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  } catch { return '—'; }
}

function todayISO(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function shiftISO(base: string, delta: number): string {
  const [y, m, d] = base.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function formatDayLabel(iso: string): string {
  try {
    const t = todayISO();
    if (iso === t) return 'Сегодня';
    if (iso === shiftISO(t, -1)) return 'Вчера';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit' });
  } catch { return iso; }
}

function TimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { h, m } = parseTimeStr(value);
  return (
    <div className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-white/90 px-2.5 py-1.5 text-xs shadow-sm">
      <Clock className="h-3.5 w-3.5 text-sky-500 shrink-0" />
      <select
        value={pad2(h)}
        onChange={(e) => onChange(`${e.target.value}:${pad2(m)}`)}
        className="bg-transparent text-[12px] text-slate-900 outline-none cursor-pointer"
      >
        {HOURS.map((v) => <option key={v} value={pad2(v)}>{pad2(v)}</option>)}
      </select>
      <span className="text-slate-400">:</span>
      <select
        value={pad2(m)}
        onChange={(e) => onChange(`${pad2(h)}:${e.target.value}`)}
        className="bg-transparent text-[12px] text-slate-900 outline-none cursor-pointer"
      >
        {MINUTES_STEP.map((v) => <option key={v} value={pad2(v)}>{pad2(v)}</option>)}
      </select>
    </div>
  );
}

function Shell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-sky-200 bg-gradient-to-br from-white via-slate-50 to-sky-50/85 px-5 py-4 shadow-[0_22px_60px_rgba(15,23,42,0.55)] backdrop-blur-xl text-slate-900 ${className}`}>
      {children}
    </div>
  );
}

function emptyTier() {
  return { threshold_m: '', amount: '' };
}

/* ---------- Modal ---------- */

function PenaltyModal({
  employee,
  penalties,
  loading,
  onCancel,
  onClose,
}: {
  employee: { id: number; name: string };
  penalties: SessionPenaltyRow[];
  loading: boolean;
  onCancel: (penaltyId: number, sessionId: number) => Promise<void>;
  onClose: () => void;
}) {
  const activePenalties = penalties.filter((p) => !p.is_cancelled);
  const total = activePenalties.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* panel */}
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-3xl border border-sky-200 bg-gradient-to-br from-white via-slate-50 to-sky-50/90 shadow-[0_30px_80px_rgba(15,23,42,0.65)] overflow-hidden">

        {/* header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <div className="text-[16px] font-bold text-slate-900">{employee.name}</div>
            {activePenalties.length > 0 && (
              <div className="mt-0.5 text-[12px] text-slate-500">
                Активных штрафов: <span className="font-semibold text-rose-600">{activePenalties.length}</span>
                {' · '}итого <span className="font-semibold text-rose-600">{total.toLocaleString('ru-RU')} сом</span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center gap-3 text-slate-500 py-8 justify-center">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-400" />
              Загрузка…
            </div>
          )}

          {!loading && penalties.length === 0 && (
            <div className="py-10 text-center text-slate-500 text-sm">Штрафов нет</div>
          )}

          {!loading && penalties.length > 0 && (
            <div className="space-y-2">
              {penalties.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 rounded-2xl px-4 py-3 ring-1 transition-all ${
                    p.is_cancelled
                      ? 'bg-slate-50 ring-slate-200 opacity-50'
                      : 'bg-white ring-slate-200 hover:ring-sky-200'
                  }`}
                >
                  {/* date */}
                  <span className="shrink-0 text-[12px] tabular-nums text-slate-500 w-20">{p.work_date}</span>

                  {/* type badge */}
                  <span className={`shrink-0 inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium ${
                    p.type === 'late'
                      ? 'bg-sky-100 text-sky-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {p.type === 'late'
                      ? <><Clock className="h-3 w-3" /> Опоздание</>
                      : <><LogOut className="h-3 w-3 rotate-180" /> Ранний уход</>}
                  </span>

                  {/* minutes */}
                  {p.minutes != null && (
                    <span className="text-[12px] text-slate-500 shrink-0">{p.minutes} мин</span>
                  )}

                  {/* amount */}
                  <span className={`ml-auto text-[13px] font-bold tabular-nums shrink-0 ${p.is_cancelled ? 'line-through text-slate-400' : 'text-rose-600'}`}>
                    {p.amount.toLocaleString('ru-RU')} сом
                  </span>

                  {/* cancel */}
                  {p.is_cancelled ? (
                    <span className="text-[10px] text-slate-400 shrink-0 w-24 text-right">
                      {p.cancel_reason ? `Отменён: ${p.cancel_reason}` : 'Отменён'}
                    </span>
                  ) : (
                    <button
                      onClick={() => onCancel(p.id, p.session_id)}
                      title="Отменить штраф"
                      className="shrink-0 ml-1 rounded-xl p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* footer hint */}
        <div className="shrink-0 px-6 py-3 border-t border-slate-100 bg-slate-50/80 text-[11px] text-slate-400 flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Отмена штрафа не удаляет запись — она помечается отменённой и учитывается при следующем расчёте.
        </div>
      </div>
    </div>
  );
}

/* ===========================================
   КОМПОНЕНТ
=========================================== */
export default function PenaltiesTab() {
  const sbRef = useRef<ReturnType<typeof getBrowserSupabase> | null>(null);

  const [rules, setRules] = useState<PenaltyRule[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employeeSummaries, setEmployeeSummaries] = useState<EmployeeSummary[]>([]);

  const [loading, setLoading] = useState(true);
  const [penLoad, setPenLoad] = useState(false);

  const [addForm, setAddForm] = useState<Record<RuleType, { threshold_m: string; amount: string }>>({
    late: emptyTier(),
    early: emptyTier(),
  });

  // Modal state
  const [modalEmployee, setModalEmployee] = useState<{ id: number; name: string } | null>(null);
  const [modalPenalties, setModalPenalties] = useState<SessionPenaltyRow[]>([]);
  const [modalLoading, setModalLoading] = useState(false);

  // Attendance state
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState<string>(() => todayISO());
  const [dateTo, setDateTo] = useState<string>(() => todayISO());
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [closeReason, setCloseReason] = useState<string>('user');

  async function loadAttendance() {
    const sb = sbRef.current;
    if (!sb) return;
    setAttendanceLoading(true);
    try {
      let q = sb.from('v_attendance_today__probe').select('*');
      if (dateFrom) q = q.gte('work_date', dateFrom);
      if (dateTo) q = q.lte('work_date', dateTo);
      const { data, error } = await q
        .order('work_date', { ascending: false })
        .order('ended_at', { nullsFirst: true })
        .order('started_at', { ascending: false });
      if (error) throw error;
      setAttendanceRows((data ?? []) as AttendanceRow[]);
    } catch (e: any) {
      alert(e?.message || 'Не удалось загрузить посещаемость');
    } finally {
      setAttendanceLoading(false);
    }
  }

  async function endShift(sessionId: number) {
    const sb = sbRef.current;
    if (!sb) return;
    if (!confirm('Закрыть смену и применить штрафы?')) return;
    try {
      const { data, error } = await sb.rpc('fn_logout_and_close', {
        p_session_id: sessionId,
        p_reason: closeReason || 'user',
      });
      if (error) throw error;
      alert(`Смена закрыта. Начислено штрафов: ${data?.penalty_total ?? 0} сом`);
      void loadAttendance();
    } catch (e: any) {
      alert(e?.message || 'Ошибка закрытия смены');
    }
  }

  useEffect(() => {
    sbRef.current = getBrowserSupabase();
    void loadAll();
    void loadAttendance();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sbRef.current) void loadAttendance();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  async function loadAll() {
    const sb = sbRef.current!;
    setLoading(true);
    try {
      // 1) Правила
      const { data: rData, error: rErr } = await sb
        .from('attendance_penalty_rules')
        .select('id, rule_type, threshold_m, amount')
        .in('rule_type', ['late', 'early'])
        .order('rule_type')
        .order('threshold_m');
      if (rErr) throw rErr;
      setRules((rData ?? []) as PenaltyRule[]);

      // 2) Филиалы + расписание
      const { data: bData, error: bErr } = await sb
        .from('branches')
        .select('id, name')
        .order('id');
      if (bErr) throw bErr;

      const { data: whData, error: whErr } = await sb
        .from('branch_workhours')
        .select('branch_id, dow, start_at, end_at, is_day_off');
      if (whErr) throw whErr;

      const byBranch = new Map<number, any[]>();
      (whData ?? []).forEach((r: any) => {
        const bid = Number(r.branch_id);
        byBranch.set(bid, [...(byBranch.get(bid) ?? []), r]);
      });

      setBranches(
        (bData ?? []).map((b: any) => {
          const id = Number(b.id);
          const list = byBranch.get(id) ?? [];
          const sundayRow = list.find((x: any) => Number(x.dow) === 0);
          const mondayRow = list.find((x: any) => Number(x.dow) === 1);
          const weekdays = list.filter((x: any) => Number(x.dow) >= 1 && Number(x.dow) <= 6);
          const base = mondayRow ?? weekdays.find((x: any) => !x.is_day_off) ?? null;
          const wk = weekdays.filter((x: any) => !x.is_day_off && x.start_at && x.end_at);
          const mixed = wk.length >= 2 && wk.some(
            (x: any) => normHHMM(x.start_at) !== normHHMM(wk[0].start_at) || normHHMM(x.end_at) !== normHHMM(wk[0].end_at)
          );
          return {
            id,
            name: String(b.name),
            schedule_start: base ? normHHMM(base.start_at) : '',
            schedule_end: base ? normHHMM(base.end_at) : '',
            sunday_off: sundayRow ? Boolean(sundayRow.is_day_off) : true,
            mixed_weekdays: mixed,
          };
        })
      );

      // 3) Компактный список сотрудников со штрафами
      await loadEmployeeSummaries(sb);
    } catch (e: any) {
      alert(e?.message ?? 'Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  }

  /* Загружает последние 200 штрафов, группирует по сотруднику */
  async function loadEmployeeSummaries(sb: ReturnType<typeof getBrowserSupabase>) {
    setPenLoad(true);
    try {
      const { data: penRaw, error: pErr } = await sb
        .from('attendance_session_penalties')
        .select('id, session_id, type, amount, is_cancelled, cancelled, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (pErr) throw pErr;
      if (!penRaw?.length) { setEmployeeSummaries([]); return; }

      const sessionIds = [...new Set(penRaw.map((p: any) => p.session_id).filter(Boolean))];
      const { data: sessions } = await sb
        .from('attendance_sessions')
        .select('id, employee_id, branch_id')
        .in('id', sessionIds as number[]);

      const sessionMap = new Map<number, any>();
      const empIds = new Set<number>();
      const branchIds = new Set<number>();
      (sessions ?? []).forEach((s: any) => {
        sessionMap.set(Number(s.id), s);
        if (s.employee_id) empIds.add(Number(s.employee_id));
        if (s.branch_id) branchIds.add(Number(s.branch_id));
      });

      const [empRes, brRes] = await Promise.all([
        empIds.size ? sb.from('employees').select('id, full_name').in('id', [...empIds]) : Promise.resolve({ data: [] }),
        branchIds.size ? sb.from('branches').select('id, name').in('id', [...branchIds]) : Promise.resolve({ data: [] }),
      ]);
      const empMap = new Map<number, string>((empRes.data ?? []).map((e: any) => [Number(e.id), e.full_name]));
      const brMap = new Map<number, string>((brRes.data ?? []).map((b: any) => [Number(b.id), b.name]));

      // Группируем по сотруднику
      const byEmp = new Map<number, EmployeeSummary>();
      for (const p of penRaw) {
        const ses = p.session_id ? sessionMap.get(Number(p.session_id)) : null;
        if (!ses?.employee_id) continue;
        const empId = Number(ses.employee_id);
        const isCancelled = Boolean(p.is_cancelled) || Boolean(p.cancelled);
        const existing = byEmp.get(empId);
        if (existing) {
          if (!isCancelled) {
            existing.active_count += 1;
            existing.active_total += Number(p.amount ?? 0);
          }
        } else {
          byEmp.set(empId, {
            employee_id: empId,
            employee_name: empMap.get(empId) ?? '—',
            branch_name: ses.branch_id ? (brMap.get(Number(ses.branch_id)) ?? '—') : '—',
            active_count: isCancelled ? 0 : 1,
            active_total: isCancelled ? 0 : Number(p.amount ?? 0),
          });
        }
      }

      // Сортируем: сначала с активными штрафами по сумме, потом остальные
      const list = [...byEmp.values()].sort((a, b) => {
        if (a.active_total !== b.active_total) return b.active_total - a.active_total;
        return a.employee_name.localeCompare(b.employee_name, 'ru');
      });

      setEmployeeSummaries(list);
    } catch (e) {
      console.error(e);
    } finally {
      setPenLoad(false);
    }
  }

  /* Загружает все штрафы конкретного сотрудника для модалки */
  async function openEmployeeModal(empId: number, empName: string) {
    setModalEmployee({ id: empId, name: empName });
    setModalPenalties([]);
    setModalLoading(true);

    const sb = sbRef.current!;
    try {
      // Получаем все смены сотрудника, в которых были штрафы
      const { data: sessions } = await sb
        .from('attendance_sessions')
        .select('id, branch_id, started_at')
        .eq('employee_id', empId)
        .order('started_at', { ascending: false });

      if (!sessions?.length) { setModalLoading(false); return; }

      const sessionIds = sessions.map((s: any) => Number(s.id));
      const branchIds = [...new Set(sessions.map((s: any) => s.branch_id).filter(Boolean))];

      const brRes = branchIds.length
        ? await sb.from('branches').select('id, name').in('id', branchIds)
        : { data: [] };
      const brMap = new Map<number, string>((brRes.data ?? []).map((b: any) => [Number(b.id), b.name]));
      const sesMap = new Map<number, any>(sessions.map((s: any) => [Number(s.id), s]));

      const { data: penRaw, error: pErr } = await sb
        .from('attendance_session_penalties')
        .select('id, session_id, type, minutes, amount, is_cancelled, cancelled, cancel_reason, created_at')
        .in('session_id', sessionIds)
        .order('created_at', { ascending: false });
      if (pErr) throw pErr;

      setModalPenalties(
        (penRaw ?? []).map((p: any) => {
          const ses = p.session_id ? sesMap.get(Number(p.session_id)) : null;
          const rawType = String(p.type ?? '');
          const uiType = rawType === 'early' || rawType === 'early_leave' ? 'early' : 'late';
          return {
            id: Number(p.id),
            session_id: p.session_id ? Number(p.session_id) : 0,
            employee_id: empId,
            employee_name: empName,
            branch_name: ses?.branch_id ? (brMap.get(Number(ses.branch_id)) ?? '—') : '—',
            work_date: (ses?.started_at ?? p.created_at ?? '').slice(0, 10),
            type: uiType,
            minutes: p.minutes != null ? Number(p.minutes) : null,
            amount: Number(p.amount ?? 0),
            is_cancelled: Boolean(p.is_cancelled) || Boolean(p.cancelled),
            cancel_reason: p.cancel_reason ?? null,
          };
        })
      );
    } catch (e: any) {
      alert(e?.message ?? 'Ошибка загрузки');
    } finally {
      setModalLoading(false);
    }
  }

  /* ---------- rule mutations ---------- */

  async function deleteRule(id: number) {
    if (!confirm('Удалить этот порог?')) return;
    const { error } = await sbRef.current!.from('attendance_penalty_rules').delete().eq('id', id);
    if (error) { alert(error.message); return; }
    setRules((r) => r.filter((x) => x.id !== id));
  }

  async function addRule(type: RuleType) {
    const form = addForm[type];
    const thr = parseInt(form.threshold_m, 10);
    const amt = parseInt(form.amount, 10);
    if (!Number.isFinite(thr) || thr < 1) { alert('Порог должен быть ≥ 1 минуты'); return; }
    if (!Number.isFinite(amt) || amt < 0) { alert('Сумма должна быть ≥ 0'); return; }

    const { data, error } = await sbRef.current!
      .from('attendance_penalty_rules')
      .insert([{ rule_type: type, threshold_m: thr, amount: amt }])
      .select()
      .single();
    if (error) { alert(error.message); return; }
    setRules((r) => [...r, data as PenaltyRule].sort((a, b) => a.rule_type.localeCompare(b.rule_type) || a.threshold_m - b.threshold_m));
    setAddForm((f) => ({ ...f, [type]: emptyTier() }));
  }

  /* ---------- branch schedule ---------- */

  function updateSchedule(id: number, field: 'schedule_start' | 'schedule_end', val: string) {
    setBranches((prev) => prev.map((b) => b.id === id ? { ...b, [field]: val } : b));
  }
  function updateSundayOff(id: number, val: boolean) {
    setBranches((prev) => prev.map((b) => b.id === id ? { ...b, sunday_off: val } : b));
  }

  async function saveSchedule(branchId: number) {
    const sb = sbRef.current!;
    const branch = branches.find((b) => b.id === branchId);
    if (!branch) return;

    const { h: sh, m: sm } = parseTimeStr(branch.schedule_start);
    const { h: eh, m: em } = parseTimeStr(branch.schedule_end);
    const start = `${pad2(sh)}:${pad2(sm)}`;
    const end = `${pad2(eh)}:${pad2(em)}`;

    if (start >= end) { alert('Начало должно быть раньше конца'); return; }

    const payload: any[] = [];
    for (let dow = 1; dow <= 6; dow++) {
      payload.push({ branch_id: branchId, dow, start_at: `${start}:00`, end_at: `${end}:00`, is_day_off: false });
    }
    payload.push(branch.sunday_off
      ? { branch_id: branchId, dow: 0, start_at: null, end_at: null, is_day_off: true }
      : { branch_id: branchId, dow: 0, start_at: `${start}:00`, end_at: `${end}:00`, is_day_off: false }
    );

    const { error } = await sb.from('branch_workhours').upsert(payload, { onConflict: 'branch_id,dow' });
    if (error) { alert(error.message); return; }

    await sb.from('attendance_branch_schedules').upsert(
      { branch_id: branchId, start_time: `${start}:00`, end_time: `${end}:00` },
      { onConflict: 'branch_id' }
    );

    alert('График сохранён.');
    void loadAll();
  }

  /* ---------- cancel penalty ---------- */

  async function cancelPenalty(penaltyId: number, sessionId: number) {
    const sb = sbRef.current!;
    const reason = window.prompt('Причина отмены (необязательно):', '');
    if (reason === null) return;

    const { error } = await sb.from('attendance_session_penalties').update({
      is_cancelled: true, cancelled: true,
      cancel_reason: reason || null,
      cancelled_at: new Date().toISOString(),
    }).eq('id', penaltyId);
    if (error) { alert(error.message); return; }

    // Пересчёт penalty_total по смене
    const { data: rows } = await sb.from('attendance_session_penalties')
      .select('amount, is_cancelled, cancelled').eq('session_id', sessionId);
    const total = (rows ?? []).reduce((acc: number, r: any) => {
      return acc + ((r.is_cancelled || r.cancelled) ? 0 : Number(r.amount ?? 0));
    }, 0);
    await sb.from('attendance_sessions').update({ penalty_total: Math.round(total) }).eq('id', sessionId);

    // Обновляем данные в модалке
    setModalPenalties((prev) =>
      prev.map((p) =>
        p.id === penaltyId
          ? { ...p, is_cancelled: true, cancel_reason: reason || null }
          : p
      )
    );

    // Обновляем компактный список
    const sb2 = sbRef.current!;
    await loadEmployeeSummaries(sb2);
  }

  /* ---------- render ---------- */

  const lateRules = rules.filter((r) => r.rule_type === 'late');
  const earlyRules = rules.filter((r) => r.rule_type === 'early');

  function RuleColumn({ type, ruleList }: { type: RuleType; ruleList: PenaltyRule[] }) {
    const isLate = type === 'late';
    const form = addForm[type];
    return (
      <div className="flex-1 min-w-[220px]">
        <div className={`flex items-center gap-2 mb-3 text-[13px] font-semibold ${isLate ? 'text-sky-700' : 'text-amber-700'}`}>
          {isLate
            ? <Clock className="h-4 w-4" />
            : <LogOut className="h-4 w-4 rotate-180" />}
          {isLate ? 'Опоздание' : 'Ранний уход'}
        </div>

        <div className="space-y-1.5">
          {ruleList.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl bg-white ring-1 ring-slate-200 px-3 py-2">
              <span className="text-[12px] text-slate-700">
                &gt; <span className="font-semibold tabular-nums text-slate-900">{r.threshold_m} мин</span>
              </span>
              <span className="text-[12px] font-semibold tabular-nums text-teal-700">
                {r.amount} сом
              </span>
              <button
                onClick={() => deleteRule(r.id)}
                className="ml-auto text-slate-400 hover:text-rose-500 transition-colors"
                title="Удалить порог"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {ruleList.length === 0 && (
            <div className="text-[11px] text-slate-400 px-1">Нет правил — штраф не начисляется</div>
          )}
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500 shrink-0">&gt;</span>
          <input
            type="number"
            min={1}
            value={form.threshold_m}
            onChange={(e) => setAddForm((f) => ({ ...f, [type]: { ...f[type], threshold_m: e.target.value } }))}
            placeholder="мин"
            className="w-16 rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-[12px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
          />
          <input
            type="number"
            min={0}
            value={form.amount}
            onChange={(e) => setAddForm((f) => ({ ...f, [type]: { ...f[type], amount: e.target.value } }))}
            placeholder="сом"
            className="w-20 rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-[12px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
          />
          <button
            onClick={() => addRule(type)}
            className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-cyan-400 to-sky-400 px-2.5 py-1.5 text-[11px] font-medium text-slate-900 hover:brightness-110"
          >
            <Plus className="h-3 w-3" /> Добавить
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center gap-3 text-slate-600 py-6">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-400" />
          Загрузка…
        </div>
      </Shell>
    );
  }

  return (
    <>
      <div className="space-y-5">

        {/* ── Правила штрафов ── */}
        <Shell>
          <div className="mb-4">
            <div className="text-[15px] font-semibold text-slate-900">Правила штрафов</div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Единые для всех филиалов. Минуты считаются относительно расписания каждого филиала.
            </p>
          </div>

          <div className="flex flex-wrap gap-6">
            <RuleColumn type="late" ruleList={lateRules} />
            <div className="w-px bg-slate-200 self-stretch hidden sm:block" />
            <RuleColumn type="early" ruleList={earlyRules} />
          </div>

          <div className="mt-4 rounded-xl bg-sky-50 border border-sky-100 px-4 py-2.5 text-[11px] text-sky-700 leading-relaxed">
            <span className="font-semibold">Как работает:</span> при закрытии смены система читает расписание конкретного филиала
            из <span className="font-mono">branch_workhours</span>, вычисляет минуты опоздания / раннего ухода и применяет
            первый подходящий порог из этой таблицы. Кант (10:00) и Сокулук (09:00) — разное время, одни правила.
          </div>
        </Shell>

        {/* ── График работы ── */}
        <Shell>
          <div className="mb-3">
            <div className="text-[15px] font-semibold text-slate-900">График работы филиалов</div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Расписание используется для расчёта опозданий и раннего ухода (<span className="font-mono">branch_workhours</span>).
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                  <th className="px-3 py-2 text-left">Филиал</th>
                  <th className="px-3 py-2 text-left">Начало (Пн–Сб)</th>
                  <th className="px-3 py-2 text-left">Конец (Пн–Сб)</th>
                  <th className="px-3 py-2 text-left">Вс выходной</th>
                  <th className="px-3 py-2 w-28" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {branches.map((b) => (
                  <tr key={b.id}>
                    <td className="px-3 py-2.5">
                      <span className="font-medium text-slate-900">{b.name}</span>
                      {b.mixed_weekdays && (
                        <span className="ml-2 text-[10px] text-amber-600">разные времена в БД</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <TimePicker value={b.schedule_start} onChange={(v) => updateSchedule(b.id, 'schedule_start', v)} />
                    </td>
                    <td className="px-3 py-2.5">
                      <TimePicker value={b.schedule_end} onChange={(v) => updateSchedule(b.id, 'schedule_end', v)} />
                    </td>
                    <td className="px-3 py-2.5">
                      <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(b.sunday_off)}
                          onChange={(e) => updateSundayOff(b.id, e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        Да
                      </label>
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => saveSchedule(b.id)}
                        className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-slate-900
                                   bg-gradient-to-r from-cyan-400 to-sky-400
                                   hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
                      >
                        <Save className="h-3 w-3" /> Сохранить
                      </button>
                    </td>
                  </tr>
                ))}
                {!branches.length && (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">Нет филиалов</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Shell>

        {/* ── Штрафы сотрудников ── */}
        <Shell>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-[15px] font-semibold text-slate-900">Штрафы сотрудников</div>
              <p className="mt-0.5 text-[11px] text-slate-500">По последним 200 записям. Нажмите на строку, чтобы посмотреть детали.</p>
            </div>
            {penLoad && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-400" />
            )}
          </div>

          {!penLoad && employeeSummaries.length === 0 && (
            <div className="py-8 text-center text-slate-500 text-sm">Штрафов нет</div>
          )}

          {employeeSummaries.length > 0 && (
            <div className="space-y-1.5">
              {employeeSummaries.map((emp) => (
                <button
                  key={emp.employee_id}
                  onClick={() => openEmployeeModal(emp.employee_id, emp.employee_name)}
                  className="w-full flex items-center gap-3 rounded-2xl bg-white ring-1 ring-slate-200 px-4 py-3 text-left hover:ring-sky-300 hover:bg-sky-50/60 transition-all group"
                >
                  {/* avatar placeholder */}
                  <div className="shrink-0 h-8 w-8 rounded-xl bg-gradient-to-br from-cyan-400 to-sky-500 flex items-center justify-center text-white text-[12px] font-bold">
                    {emp.employee_name.charAt(0).toUpperCase()}
                  </div>

                  {/* name + branch */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-slate-900 truncate">{emp.employee_name}</div>
                    <div className="text-[11px] text-slate-500 truncate">{emp.branch_name}</div>
                  </div>

                  {/* badges */}
                  <div className="shrink-0 flex items-center gap-2">
                    {emp.active_count > 0 ? (
                      <>
                        <span className="inline-flex items-center gap-1 rounded-lg bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                          {emp.active_count} шт
                        </span>
                        <span className="text-[13px] font-bold tabular-nums text-rose-600">
                          {emp.active_total.toLocaleString('ru-RU')} сом
                        </span>
                      </>
                    ) : (
                      <span className="text-[11px] text-slate-400">все отменены</span>
                    )}
                  </div>

                  <ChevronRight className="shrink-0 h-4 w-4 text-slate-400 group-hover:text-sky-500 transition-colors" />
                </button>
              ))}
            </div>
          )}
        </Shell>

        {/* ── История смен / Посещаемость ── */}
        <Shell>
          {/* Заголовок + фильтры */}
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
                <History className="h-4 w-4 text-slate-500" />
                История смен
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Посещаемость по всем филиалам — вход, выход, опоздания, ранние уходы, штрафы.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Быстрые диапазоны */}
              {[
                { label: 'Сегодня', from: () => todayISO(), to: () => todayISO() },
                { label: 'Вчера', from: () => shiftISO(todayISO(), -1), to: () => shiftISO(todayISO(), -1) },
                { label: '7 дн', from: () => shiftISO(todayISO(), -6), to: () => todayISO() },
                { label: '30 дн', from: () => shiftISO(todayISO(), -29), to: () => todayISO() },
              ].map((btn) => (
                <button
                  key={btn.label}
                  onClick={() => { setDateFrom(btn.from()); setDateTo(btn.to()); }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm hover:border-sky-300 hover:text-sky-700 transition-colors"
                >
                  <Calendar className="h-3 w-3" />
                  {btn.label}
                </button>
              ))}

              {/* Даты */}
              <div className="flex items-center gap-1 text-[11px] text-slate-500">
                <span>с</span>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
                <span>по</span>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
              </div>

              {/* Филиал */}
              <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-300">
                <option value="all">Все филиалы</option>
                {[...new Set(attendanceRows.map((r) => r.branch_name))].sort().map((bn) => (
                  <option key={bn} value={bn}>{bn}</option>
                ))}
              </select>

              {/* Причина закрытия */}
              <select value={closeReason} onChange={(e) => setCloseReason(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-300">
                <option value="user">Обычное закрытие</option>
                <option value="excused">Уважительная причина</option>
                <option value="system">Системное</option>
              </select>

              {/* Обновить */}
              <button
                onClick={() => void loadAttendance()}
                disabled={attendanceLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-400 to-sky-400 px-3 py-1.5 text-[11px] font-semibold text-slate-900 hover:brightness-110 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${attendanceLoading ? 'animate-spin' : ''}`} />
                Обновить
              </button>
            </div>
          </div>

          {/* Таблица */}
          <div className="overflow-hidden rounded-2xl border border-slate-100">
            <div className="overflow-auto max-h-[60vh]">
              <table className="min-w-[900px] w-full text-sm">
                <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200">
                  <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 text-left">Сотрудник</th>
                    <th className="px-3 py-2 text-left">Филиал</th>
                    <th className="px-3 py-2 text-left">Дата</th>
                    <th className="px-3 py-2 text-left">Вход</th>
                    <th className="px-3 py-2 text-left">Выход</th>
                    <th className="px-3 py-2 text-right">Опозд.</th>
                    <th className="px-3 py-2 text-right">Ранний уход</th>
                    <th className="px-3 py-2 text-right">Штраф</th>
                    <th className="px-3 py-2 text-center">Статус</th>
                    <th className="px-3 py-2 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceLoading && (
                    <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-500 bg-white">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-400" />
                        Загружаем…
                      </span>
                    </td></tr>
                  )}
                  {!attendanceLoading && attendanceRows.filter(r => branchFilter === 'all' || r.branch_name === branchFilter).length === 0 && (
                    <tr><td colSpan={10} className="px-3 py-10 text-center text-slate-500 bg-white">
                      Нет данных за выбранный период
                    </td></tr>
                  )}
                  {!attendanceLoading && (() => {
                    const filtered = attendanceRows.filter(r => branchFilter === 'all' || r.branch_name === branchFilter);
                    // группируем по рабочему дню
                    const grouped = new Map<string, AttendanceRow[]>();
                    filtered.forEach((r) => {
                      const wd = r.work_date ?? (r.started_at ? String(r.started_at).slice(0, 10) : 'unknown');
                      grouped.set(wd, [...(grouped.get(wd) ?? []), r]);
                    });
                    const days = [...grouped.entries()].sort(([a], [b]) => b.localeCompare(a));
                    return days.map(([day, rows]) => (
                      <React.Fragment key={day}>
                        {/* День-разделитель */}
                        <tr className="bg-slate-50">
                          <td colSpan={10} className="px-3 py-1.5">
                            <div className="flex items-center gap-2 text-[11px] text-slate-600">
                              <Calendar className="h-3.5 w-3.5 text-slate-400" />
                              <span className="font-semibold">{formatDayLabel(day)}</span>
                              <span className="text-slate-400">{day} · смен: {rows.length}</span>
                            </div>
                          </td>
                        </tr>
                        {/* Строки дня */}
                        {rows.map((r) => {
                          const hasIssue = r.flag_late || r.flag_early_leave || r.flag_no_close;
                          return (
                            <tr key={r.session_id} className={`border-b border-slate-100 ${hasIssue ? 'bg-rose-50/60' : 'bg-white hover:bg-slate-50/80'}`}>
                              <td className="px-3 py-2 text-[12px] font-medium text-slate-900">{r.full_name}</td>
                              <td className="px-3 py-2 text-[12px] text-slate-600">{r.branch_name}</td>
                              <td className="px-3 py-2 text-[12px] text-slate-500 tabular-nums">{r.work_date ?? '—'}</td>
                              <td className="px-3 py-2 text-[12px] tabular-nums text-slate-700">{fmtTime(r.started_at)}</td>
                              <td className="px-3 py-2 text-[12px] tabular-nums text-slate-700">{fmtTime(r.ended_at, true)}</td>
                              <td className={`px-3 py-2 text-right tabular-nums text-[12px] ${r.late_minutes >= 10 ? 'text-rose-600 font-semibold' : 'text-slate-600'}`}>
                                {r.late_minutes > 0 ? `${r.late_minutes} мин` : '—'}
                              </td>
                              <td className={`px-3 py-2 text-right tabular-nums text-[12px] ${r.early_leave_minutes >= 10 ? 'text-amber-600 font-semibold' : 'text-slate-600'}`}>
                                {r.early_leave_minutes > 0 ? `${r.early_leave_minutes} мин` : '—'}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-[12px] font-semibold text-rose-600">
                                {r.penalty_total > 0 ? `${r.penalty_total} сом` : '—'}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <div className="flex flex-wrap justify-center gap-1">
                                  {r.flag_late && <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">Опоздал</span>}
                                  {r.flag_early_leave && <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Ранний уход</span>}
                                  {r.flag_no_close && <span className="rounded-md bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">Не закрыта</span>}
                                  {!r.flag_late && !r.flag_early_leave && !r.flag_no_close && (
                                    <span className="inline-flex items-center gap-0.5 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                                      <Timer className="h-2.5 w-2.5" /> ок
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right">
                                {!r.ended_at ? (
                                  <button
                                    onClick={() => endShift(r.session_id)}
                                    className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-500"
                                  >
                                    <DoorOpen className="h-3.5 w-3.5" /> Закрыть
                                  </button>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                                    <CheckCircle2 className="h-3.5 w-3.5" /> закрыта
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </Shell>

      </div>

      {/* ── Modal ── */}
      {modalEmployee && (
        <PenaltyModal
          employee={modalEmployee}
          penalties={modalPenalties}
          loading={modalLoading}
          onCancel={cancelPenalty}
          onClose={() => { setModalEmployee(null); setModalPenalties([]); }}
        />
      )}
    </>
  );
}
