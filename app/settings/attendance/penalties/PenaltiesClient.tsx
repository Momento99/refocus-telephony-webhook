'use client';

import { useEffect, useRef, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import { Plus, Save, X, Trash2, Clock, LogOut, Coffee } from 'lucide-react';

type RuleType = 'late' | 'early' | 'afk';

type RuleRow = {
  id: number;
  type: RuleType;
  threshold_min: number;
  amount: number;
  branch_id: number | null;
  branch?: { name?: string } | null;
};

type Branch = {
  id: number;
  name: string;

  // Пн–Сб (единый график)
  schedule_start: string | null; // "HH:MM"
  schedule_end: string | null; // "HH:MM"

  // Воскресенье
  sunday_off: boolean;

  // Если в БД Пн–Сб разные (на всякий случай)
  mixed_weekdays?: boolean;
};

type SessionPenaltyRow = {
  id: number;
  session_id: number;
  employee_name: string;
  branch_name: string;
  work_date: string;
  type: RuleType | 'unknown';
  minutes: number | null;
  amount: number;
  is_cancelled: boolean;
  cancel_reason: string | null;
};

/* ---------- константы для кастомного выбора времени ---------- */

const HOURS = Array.from({ length: 24 }, (_, i) => i); // 00..23
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function pad2(n: number) {
  return n.toString().padStart(2, '0');
}

function parseTimeStr(value: string | null | undefined): { h: number; m: number } {
  if (!value) return { h: 9, m: 0 };
  const parts = String(value).split(':');
  const hStr = parts[0] ?? '0';
  const mStr = parts[1] ?? '0';
  const h = Math.min(23, Math.max(0, Number(hStr) || 0));
  const m = Math.min(59, Math.max(0, Number(mStr) || 0));
  return { h, m };
}

function normHHMM(v: any): string {
  if (!v) return '';
  return String(v).slice(0, 5);
}

type TimePickerProps = {
  value: string | null;
  onChange: (v: string) => void;
};

/* ---------- компактный двухсегментный HH:MM-пикер ---------- */

function TimePicker({ value, onChange }: TimePickerProps) {
  const { h, m } = parseTimeStr(value);

  const onHourChange = (val: string) => {
    const hh = Number(val) || 0;
    onChange(`${pad2(hh)}:${pad2(m)}`);
  };
  const onMinuteChange = (val: string) => {
    const mm = Number(val) || 0;
    onChange(`${pad2(h)}:${pad2(mm)}`);
  };

  return (
    <div
      className="inline-flex items-center gap-2 rounded-2xl border border-sky-200
                 bg-white/90 px-3 py-1.5 text-xs text-slate-900 shadow-sm"
    >
      <Clock className="h-3.5 w-3.5 text-sky-500" />
      <select
        value={pad2(h)}
        onChange={(e) => onHourChange(e.target.value)}
        className="bg-transparent text-[11px] text-slate-900 outline-none border-none focus:ring-0 pr-1 cursor-pointer"
      >
        {HOURS.map((v) => (
          <option key={v} value={pad2(v)} className="bg-white text-[11px] text-slate-900">
            {pad2(v)}
          </option>
        ))}
      </select>
      <span className="opacity-70 text-slate-500">:</span>
      <select
        value={pad2(m)}
        onChange={(e) => onMinuteChange(e.target.value)}
        className="bg-transparent text-[11px] text-slate-900 outline-none border-none focus:ring-0 pl-0 cursor-pointer"
      >
        {MINUTES.map((v) => (
          <option key={v} value={pad2(v)} className="bg-white text-[11px] text-slate-900">
            {pad2(v)}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ---------- оболочка карточки ---------- */

function KpiShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-3xl border border-sky-200 bg-gradient-to-br
                 from-white via-slate-50 to-sky-50/85
                 px-6 py-5 shadow-[0_22px_60px_rgba(15,23,42,0.55)]
                 backdrop-blur-xl text-slate-900"
    >
      {children}
    </div>
  );
}

/* ===========================================
   СТРАНИЦА
=========================================== */

export default function PenaltiesClient() {
  const sbRef = useRef<ReturnType<typeof getBrowserSupabase> | null>(null);

  const [rows, setRows] = useState<RuleRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<RuleRow>>({});

  const [sessionPenalties, setSessionPenalties] = useState<SessionPenaltyRow[]>([]);
  const [penaltiesLoading, setPenaltiesLoading] = useState(false);

  useEffect(() => {
    sbRef.current = getBrowserSupabase();
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    const sb = sbRef.current;
    if (!sb) return;
    setLoading(true);

    try {
      // 1) Правила (основная таблица penalty_rules)
      const { data: rules, error: rErr } = await sb
        .from('penalty_rules')
        .select('id,type,threshold_minutes,penalty_amount,branch_id')
        .order('branch_id', { ascending: true })
        .order('type', { ascending: true })
        .order('threshold_minutes', { ascending: true });
      if (rErr) throw rErr;

      // 2) Филиалы
      const { data: branchesData, error: bErr } = await sb
        .from('branches')
        .select('id,name')
        .order('id', { ascending: true });
      if (bErr) throw bErr;

      // 3) Графики работы (ВАЖНО: штрафы считаются по branch_workhours)
      const { data: whRows, error: whErr } = await sb
        .from('branch_workhours')
        .select('branch_id,dow,start_at,end_at,is_day_off');
      if (whErr) throw whErr;

      const byBranch = new Map<number, any[]>();
      (whRows ?? []).forEach((r: any) => {
        const bid = Number(r.branch_id);
        const arr = byBranch.get(bid) ?? [];
        arr.push(r);
        byBranch.set(bid, arr);
      });

      const branchMap = new Map<number, string>(
        (branchesData ?? []).map((b: any) => [Number(b.id), String(b.name)])
      );

      setBranches(
        (branchesData ?? []).map((b: any) => {
          const id = Number(b.id);
          const list = byBranch.get(id) ?? [];

          const sunday = list.find((x: any) => Number(x.dow) === 0);
          const sundayOff = sunday ? Boolean(sunday.is_day_off) : true;

          const monday = list.find((x: any) => Number(x.dow) === 1);
          const weekdays = list.filter((x: any) => {
            const d = Number(x.dow);
            return d >= 1 && d <= 6;
          });

          const base = monday ?? weekdays.find((x: any) => !x.is_day_off) ?? null;

          const start = base ? normHHMM(base.start_at) : '';
          const end = base ? normHHMM(base.end_at) : '';

          let mixed = false;
          const wk = weekdays.filter((x: any) => !x.is_day_off && x.start_at && x.end_at);
          if (wk.length >= 2) {
            const s0 = normHHMM(wk[0].start_at);
            const e0 = normHHMM(wk[0].end_at);
            mixed = wk.some((x: any) => normHHMM(x.start_at) !== s0 || normHHMM(x.end_at) !== e0);
          }

          return {
            id,
            name: String(b.name),
            schedule_start: start || '',
            schedule_end: end || '',
            sunday_off: sundayOff,
            mixed_weekdays: mixed,
          };
        })
      );

      const merged: RuleRow[] = (rules ?? []).map((r: any) => {
        const bid = r.branch_id === null ? null : Number(r.branch_id);
        const bName = bid != null ? branchMap.get(bid) : undefined;

        const dbType = String(r.type ?? '');
        let type: RuleType;
        if (dbType === 'late_arrival') type = 'late';
        else if (dbType === 'early_leave') type = 'early';
        else type = 'afk';

        return {
          id: Number(r.id),
          type,
          threshold_min: Number(r.threshold_minutes ?? 0),
          amount: Number(r.penalty_amount ?? 0),
          branch_id: bid,
          branch: bid != null && bName ? { name: bName } : null,
        };
      });

      setRows(merged);

      // 4) История штрафов по сменам
      await loadSessionPenalties(sb);
    } catch (e: any) {
      alert(e?.message ?? 'Не удалось загрузить правила/графики');
    } finally {
      setLoading(false);
    }
  }

  async function loadSessionPenalties(sb: ReturnType<typeof getBrowserSupabase>) {
    try {
      setPenaltiesLoading(true);

      // ВАЖНО: выбираем и is_cancelled, и cancelled (в БД есть оба флага)
      const { data: penRaw, error: pErr } = await sb
        .from('attendance_session_penalties')
        .select('id, session_id, type, minutes, amount, is_cancelled, cancelled, cancel_reason, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (pErr) throw pErr;

      if (!penRaw || !penRaw.length) {
        setSessionPenalties([]);
        return;
      }

      const sessionIds = Array.from(
        new Set((penRaw ?? []).map((p: any) => p.session_id).filter((v: any) => v != null))
      );

      const { data: sessions, error: sErr } = await sb
        .from('attendance_sessions')
        .select('id, employee_id, branch_id, started_at')
        .in('id', sessionIds as number[]);
      if (sErr) throw sErr;

      const sessionMap = new Map<number, any>();
      const employeeIds = new Set<number>();
      const branchIds = new Set<number>();

      (sessions ?? []).forEach((s: any) => {
        const id = Number(s.id);
        sessionMap.set(id, s);
        if (s.employee_id != null) employeeIds.add(Number(s.employee_id));
        if (s.branch_id != null) branchIds.add(Number(s.branch_id));
      });

      let employeesMap = new Map<number, string>();
      if (employeeIds.size) {
        const { data: empData, error: eErr } = await sb
          .from('employees')
          .select('id, full_name')
          .in('id', Array.from(employeeIds) as number[]);
        if (eErr) throw eErr;
        employeesMap = new Map((empData ?? []).map((e: any) => [Number(e.id), String(e.full_name ?? '')]));
      }

      let branchesMap = new Map<number, string>();
      if (branchIds.size) {
        const { data: brData, error: bErr2 } = await sb
          .from('branches')
          .select('id, name')
          .in('id', Array.from(branchIds) as number[]);
        if (bErr2) throw bErr2;
        branchesMap = new Map((brData ?? []).map((b: any) => [Number(b.id), String(b.name ?? '')]));
      }

      const formatted: SessionPenaltyRow[] = (penRaw ?? []).map((p: any) => {
        const session = p.session_id ? sessionMap.get(Number(p.session_id)) : null;
        const employeeName =
          session && session.employee_id != null ? employeesMap.get(Number(session.employee_id)) ?? '' : '';
        const branchName =
          session && session.branch_id != null ? branchesMap.get(Number(session.branch_id)) ?? '' : '';

        const startedAt = session?.started_at ?? p.created_at;
        const dateStr = startedAt ? String(startedAt).slice(0, 10) : '';

        const rawType: string = String(p.type ?? '');
        let uiType: RuleType | 'unknown' = 'late';
        if (rawType === 'early' || rawType === 'early_leave') uiType = 'early';
        else if (rawType === 'afk') uiType = 'afk';
        else uiType = 'late';

        const isCancelled = Boolean(p.is_cancelled) || Boolean(p.cancelled);

        return {
          id: Number(p.id),
          session_id: p.session_id ? Number(p.session_id) : 0,
          employee_name: employeeName || '—',
          branch_name: branchName || '—',
          work_date: dateStr,
          type: uiType,
          minutes: p.minutes != null ? Number(p.minutes) : null,
          amount: Number(p.amount ?? 0),
          is_cancelled: isCancelled,
          cancel_reason: p.cancel_reason ?? null,
        };
      });

      setSessionPenalties(formatted);
    } catch (e) {
      console.error(e);
    } finally {
      setPenaltiesLoading(false);
    }
  }

  const toInt = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  };
  const toMoney = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  };

  function startAdd() {
    setEditId(0);
    setDraft({ type: 'late', threshold_min: 10, amount: 200, branch_id: null });
  }
  function startEdit(r: RuleRow) {
    setEditId(r.id);
    setDraft({ ...r, branch: undefined });
  }
  function cancelEdit() {
    setEditId(null);
    setDraft({});
  }

  function validateDraft(d: Partial<RuleRow>): string | null {
    const t = (d.type ?? 'late') as RuleType;
    if (!['late', 'early', 'afk'].includes(t)) return 'Неверный тип';
    const thr = toInt(d.threshold_min);
    if (thr < 0 || thr > 1440) return 'Порог 0–1440 мин';
    const amt = toMoney(d.amount);
    if (amt < 0) return 'Сумма не может быть отрицательной';
    if (d.branch_id !== null && !Number.isFinite(Number(d.branch_id))) {
      return 'Филиал указан некорректно';
    }
    return null;
  }

  async function saveRule() {
    const sb = sbRef.current;
    if (!sb) return;

    const err = validateDraft(draft);
    if (err) {
      alert(err);
      return;
    }

    const uiType = (draft.type ?? 'late') as RuleType;
    const dbType = uiType === 'late' ? 'late_arrival' : uiType === 'early' ? 'early_leave' : 'afk';

    const payload = {
      type: dbType,
      threshold_minutes: toInt(draft.threshold_min),
      penalty_amount: toMoney(draft.amount),
      branch_id: draft.branch_id ?? null,
    };

    try {
      if (editId === 0) {
        const { error } = await sb.from('penalty_rules').insert([payload]);
        if (error) throw error;
      } else {
        const { error } = await sb.from('penalty_rules').update(payload).eq('id', editId!);
        if (error) throw error;
      }
      cancelEdit();
      await load();
    } catch (e: any) {
      alert(e?.message ?? 'Ошибка сохранения (проверь уникальность и RLS).');
    }
  }

  async function removeRule(id: number) {
    const sb = sbRef.current;
    if (!sb) return;
    if (!confirm('Удалить это правило штрафа?')) return;
    try {
      const { error } = await sb.from('penalty_rules').delete().eq('id', id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      alert(e?.message ?? 'Ошибка удаления (обычно RLS).');
    }
  }

  async function recomputeSessionPenaltyTotal(sessionId: number) {
    const sb = sbRef.current;
    if (!sb) return;
    if (!sessionId) return;

    // Считаем сумму НЕотменённых штрафов по смене
    const { data, error } = await sb
      .from('attendance_session_penalties')
      .select('amount, is_cancelled, cancelled')
      .eq('session_id', sessionId);

    if (error) throw error;

    const total = (data ?? []).reduce((acc: number, row: any) => {
      const cancelled = Boolean(row?.is_cancelled) || Boolean(row?.cancelled);
      const amt = Number(row?.amount ?? 0);
      return acc + (cancelled ? 0 : (Number.isFinite(amt) ? amt : 0));
    }, 0);

    // penalty_total в attendance_sessions — не generated, можно обновлять
    const { error: upErr } = await sb
      .from('attendance_sessions')
      .update({ penalty_total: Math.round(total) })
      .eq('id', sessionId);

    if (upErr) throw upErr;
  }

  async function cancelSessionPenalty(penaltyId: number, sessionId: number) {
    const sb = sbRef.current;
    if (!sb) return;

    const reason = window.prompt('Причина отмены штрафа (необязательно, только для отчётов):', '');
    if (reason === null) return;

    try {
      // ВАЖНО: выставляем ОБА флага (is_cancelled и cancelled)
      const { error } = await sb
        .from('attendance_session_penalties')
        .update({
          is_cancelled: true,
          cancelled: true,
          cancel_reason: reason || null,
          cancelled_at: new Date().toISOString(),
          // cancelled_by: null, // если позже добавишь кто отменил — сюда employee_id
        })
        .eq('id', penaltyId);

      if (error) throw error;

      // Чтобы “отмена” реально влияла на итог — пересчёт penalty_total по смене
      await recomputeSessionPenaltyTotal(sessionId);

      // Обновляем список (и статус "Отменён" станет виден)
      await loadSessionPenalties(sb);
    } catch (e: any) {
      alert(e?.message ?? 'Не удалось отменить штраф');
    }
  }

  function updateBranchSchedule(branchId: number, field: 'schedule_start' | 'schedule_end', value: string) {
    setBranches((prev) => prev.map((b) => (b.id === branchId ? { ...b, [field]: value } : b)));
  }

  function updateBranchSundayOff(branchId: number, value: boolean) {
    setBranches((prev) => prev.map((b) => (b.id === branchId ? { ...b, sunday_off: value } : b)));
  }

  async function saveSchedule(branchId: number) {
    const sb = sbRef.current;
    if (!sb) return;

    const branch = branches.find((b) => b.id === branchId);
    if (!branch) return;

    const startParsed = parseTimeStr(branch.schedule_start);
    const endParsed = parseTimeStr(branch.schedule_end);

    const start = `${pad2(startParsed.h)}:${pad2(startParsed.m)}`;
    const end = `${pad2(endParsed.h)}:${pad2(endParsed.m)}`;

    if (start >= end) {
      alert('Время начала должно быть раньше времени конца.');
      return;
    }

    const workhoursPayload: any[] = [];

    // Воскресенье (dow=0)
    if (branch.sunday_off) {
      workhoursPayload.push({
        branch_id: branchId,
        dow: 0,
        start_at: null,
        end_at: null,
        is_day_off: true,
      });
    } else {
      workhoursPayload.push({
        branch_id: branchId,
        dow: 0,
        start_at: `${start}:00`,
        end_at: `${end}:00`,
        is_day_off: false,
      });
    }

    // Пн–Сб (dow=1..6)
    for (let dow = 1; dow <= 6; dow++) {
      workhoursPayload.push({
        branch_id: branchId,
        dow,
        start_at: `${start}:00`,
        end_at: `${end}:00`,
        is_day_off: false,
      });
    }

    try {
      const { error: whSaveErr } = await sb
        .from('branch_workhours')
        .upsert(workhoursPayload, { onConflict: 'branch_id,dow' });
      if (whSaveErr) throw whSaveErr;

      // необязательно, но можно держать синхрон
      const { error: absErr } = await sb
        .from('attendance_branch_schedules')
        .upsert(
          { branch_id: branchId, start_time: `${start}:00`, end_time: `${end}:00` },
          { onConflict: 'branch_id' }
        );
      if (absErr) console.warn('attendance_branch_schedules sync failed:', absErr);

      alert('График сохранён (branch_workhours обновлён).');
      await load();
    } catch (e: any) {
      alert(e?.message ?? 'Не удалось сохранить график (проверь RLS / уникальность).');
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      {/* Хедер */}
      <div
        className="mb-2 rounded-3xl border border-sky-200
                   bg-gradient-to-br from-white via-slate-50 to-sky-50/85
                   px-6 py-4 shadow-[0_22px_60px_rgba(15,23,42,0.55)]
                   backdrop-blur-xl"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Штрафы посещаемости</h1>
            <p className="mt-1 text-xs text-slate-500">
              Опоздания, ранний уход и неактивность считаются по этим правилам.
            </p>
          </div>

          <button
            onClick={startAdd}
            disabled={editId !== null}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-slate-900
                       bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-500
                       shadow-[0_0_16px_rgba(56,189,248,0.45)]
                       hover:brightness-110 focus:outline-none
                       focus:ring-2 focus:ring-cyan-400/60
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={16} /> Добавить правило
          </button>
        </div>
      </div>

      {/* Блок правил штрафов */}
      <KpiShell>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Правила штрафов</h2>
        <table className="w-full text-sm">
          <thead className="bg-slate-50/95 text-slate-500 border-b border-slate-200">
            <tr>
              <th className="px-4 py-2 text-left w-[220px] text-[11px] uppercase tracking-wide">Тип</th>
              <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wide">Порог, минут</th>
              <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wide">Сумма, сом</th>
              <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wide">Филиал</th>
              <th className="px-4 py-2 w-48" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {editId !== null && (
              <tr className="bg-sky-50/80">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {(draft.type ?? 'late') === 'late' && <Clock className="w-4 h-4 text-sky-500" />}
                    {(draft.type ?? 'late') === 'early' && <LogOut className="w-4 h-4 rotate-180 text-amber-500" />}
                    {(draft.type ?? 'late') === 'afk' && <Coffee className="w-4 h-4 text-emerald-500" />}
                    <select
                      value={(draft.type ?? 'late') as string}
                      onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as RuleType }))}
                      className="rounded-xl border border-sky-200 bg-white/90 px-3 py-2 text-sm text-slate-900
                                 focus:outline-none focus:ring-2 focus:ring-cyan-400/60 shadow-sm"
                    >
                      <option value="late">Опоздание</option>
                      <option value="early">Ранний уход</option>
                      <option value="afk">Неактивность</option>
                    </select>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <input
                    inputMode="numeric"
                    value={draft.threshold_min ?? ''}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        threshold_min: Number(e.target.value.replace(/\D/g, '') || 0),
                      }))
                    }
                    className="rounded-xl border border-sky-200 bg-white/90 px-3 py-2 text-sm w-28 tabular-nums text-slate-900
                               focus:outline-none focus:ring-2 focus:ring-cyan-400/60 shadow-sm"
                    placeholder="мин"
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    inputMode="numeric"
                    value={draft.amount ?? ''}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        amount: Number(e.target.value.replace(/\D/g, '') || 0),
                      }))
                    }
                    className="rounded-xl border border-sky-200 bg-white/90 px-3 py-2 text-sm w-28 tabular-nums text-slate-900
                               focus:outline-none focus:ring-2 focus:ring-cyan-400/60 shadow-sm"
                    placeholder="сом"
                  />
                </td>
                <td className="px-4 py-3">
                  <select
                    value={draft.branch_id ?? ''}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        branch_id: e.target.value === '' ? null : Number(e.target.value),
                      }))
                    }
                    className="rounded-xl border border-sky-200 bg-white/90 px-3 py-2 text-sm w-44 text-slate-900
                               focus:outline-none focus:ring-2 focus:ring-cyan-400/60 shadow-sm"
                  >
                    <option value="">Все филиалы</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={saveRule}
                      className="inline-flex items-center gap-1 rounded-full px-4 py-1.5 text-xs font-semibold text-slate-900
                                 bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-500
                                 shadow-[0_0_12px_rgba(56,189,248,0.35)]
                                 hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
                    >
                      <Save size={14} /> Сохранить
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="inline-flex items-center gap-1 rounded-full px-4 py-1.5 text-xs font-semibold
                                 bg-slate-100 text-slate-700 border border-slate-300
                                 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    >
                      <X size={14} /> Отмена
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {rows.map((r) => {
              const branchLabel = r.branch?.name ?? (r.branch_id != null ? `ID ${r.branch_id}` : 'Все филиалы');

              return (
                <tr key={r.id} className="hover:bg-sky-50">
                  <td className="px-4 py-3 text-slate-900">
                    <div className="inline-flex items-center gap-2">
                      {r.type === 'late' && <Clock className="w-4 h-4 text-sky-500" />}
                      {r.type === 'early' && <LogOut className="w-4 h-4 rotate-180 text-amber-500" />}
                      {r.type === 'afk' && <Coffee className="w-4 h-4 text-emerald-500" />}
                      <span className="font-medium">
                        {r.type === 'late' ? 'Опоздание' : r.type === 'early' ? 'Ранний уход' : 'Неактивность'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-800">{r.threshold_min}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-800">{r.amount}</td>
                  <td className="px-4 py-3 text-slate-700">{branchLabel}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => startEdit(r)}
                        className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-900
                                   bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-500
                                   shadow-[0_0_10px_rgba(56,189,248,0.3)]
                                   hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
                      >
                        Редактировать
                      </button>
                      <button
                        onClick={() => removeRule(r.id)}
                        className="inline-flex items-center gap-1 rounded-full
                                   bg-gradient-to-r from-rose-500 to-amber-500
                                   px-3 py-1.5 text-xs font-semibold text-white
                                   shadow-[0_0_14px_rgba(248,113,113,0.45)]
                                   hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-rose-400/60"
                      >
                        <Trash2 size={14} /> Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {!loading && rows.length === 0 && editId === null && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                  Правил пока нет. Нажми «Добавить правило».
                </td>
              </tr>
            )}

            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Загружаем…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </KpiShell>

      {/* Блок графиков работы филиалов */}
      <div className="mt-2">
        <KpiShell>
          <h2 className="text-base font-semibold text-slate-900 mb-1">График работы филиалов</h2>
          <p className="text-[11px] text-slate-500 mb-3">
            Важно: штрафы считаются по <span className="font-semibold">branch_workhours</span>. Здесь редактируется именно она.
          </p>

          <table className="w-full text-sm">
            <thead className="bg-slate-50/95 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wide">Филиал</th>
                <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wide">Начало (Пн–Сб)</th>
                <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wide">Конец (Пн–Сб)</th>
                <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wide">Вс выходной</th>
                <th className="px-4 py-2 w-40" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {branches.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium text-slate-900">{b.name}</span>
                        <span className="text-[11px] text-slate-500">ID {b.id}</span>
                      </div>
                      {b.mixed_weekdays ? (
                        <span className="text-[11px] text-amber-600">
                          В БД разные времена по дням (Пн–Сб). Сейчас показываем базовое значение.
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <TimePicker value={b.schedule_start} onChange={(val) => updateBranchSchedule(b.id, 'schedule_start', val)} />
                  </td>
                  <td className="px-4 py-3">
                    <TimePicker value={b.schedule_end} onChange={(val) => updateBranchSchedule(b.id, 'schedule_end', val)} />
                  </td>
                  <td className="px-4 py-3">
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={Boolean(b.sunday_off)}
                        onChange={(e) => updateBranchSundayOff(b.id, e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Да
                    </label>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => saveSchedule(b.id)}
                      className="inline-flex items-center gap-1 rounded-full px-4 py-1.5 text-xs font-semibold text-slate-900
                                 bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-500
                                 shadow-[0_0_10px_rgba(56,189,248,0.3)]
                                 hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
                    >
                      <Save size={14} /> Сохранить
                    </button>
                  </td>
                </tr>
              ))}

              {!branches.length && !loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Нет филиалов, чтобы задать график.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </KpiShell>
      </div>

      {/* История штрафов по сменам */}
      <div className="mt-2">
        <KpiShell>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Последние штрафы по сменам</h2>
            <p className="text-[11px] text-slate-500">Здесь можно отменить конкретный штраф сотрудника за смену.</p>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-slate-50/95 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wide">Дата</th>
                <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wide">Филиал</th>
                <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wide">Сотрудник</th>
                <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wide">Тип</th>
                <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wide">Минут</th>
                <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wide">Сумма, сом</th>
                <th className="px-4 py-2 w-52" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {penaltiesLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                    Загружаем штрафы…
                  </td>
                </tr>
              )}

              {!penaltiesLoading && sessionPenalties.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                    Пока нет штрафов по сменам.
                  </td>
                </tr>
              )}

              {!penaltiesLoading &&
                sessionPenalties.map((p) => (
                  <tr key={p.id} className="hover:bg-sky-50/80">
                    <td className="px-4 py-3 text-slate-800 tabular-nums">{p.work_date}</td>
                    <td className="px-4 py-3 text-slate-800">{p.branch_name}</td>
                    <td className="px-4 py-3 text-slate-800">{p.employee_name}</td>
                    <td className="px-4 py-3 text-slate-800">
                      {p.type === 'late'
                        ? 'Опоздание'
                        : p.type === 'early'
                        ? 'Ранний уход'
                        : p.type === 'afk'
                        ? 'Неактивность'
                        : p.type}
                    </td>
                    <td className="px-4 py-3 text-slate-800 tabular-nums">{p.minutes ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-800 tabular-nums">{p.amount}</td>
                    <td className="px-4 py-3">
                      {p.is_cancelled ? (
                        <div className="text-xs text-slate-500">Отменён{p.cancel_reason ? `: ${p.cancel_reason}` : ''}</div>
                      ) : (
                        <div className="flex justify-end">
                          <button
                            onClick={() => cancelSessionPenalty(p.id, p.session_id)}
                            className="inline-flex items-center gap-1 rounded-full
                                       bg-gradient-to-r from-rose-500 to-amber-500
                                       px-3 py-1.5 text-xs font-semibold text-white
                                       shadow-[0_0_14px_rgba(248,113,113,0.45)]
                                       hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-rose-400/60"
                          >
                            <Trash2 size={14} /> Отменить штраф
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </KpiShell>
      </div>
    </div>
  );
}
