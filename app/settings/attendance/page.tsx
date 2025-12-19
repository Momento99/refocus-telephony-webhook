// app/settings/attendance/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import {
  CheckCircle2,
  AlertTriangle,
  Timer,
  DoorOpen,
  RefreshCw,
  Calendar,
  History,
} from 'lucide-react';

type Row = {
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
  work_date?: string | null; // дата рабочего дня (YYYY-MM-DD)
};

const TZ = 'Asia/Bishkek';

/**
 * Форматируем время в HH:mm.
 * Если assumeUtcIfNoTZ = true и в строке нет часового пояса,
 * считаем, что это UTC и добавляем +6 ч (через timeZone).
 */
const fmtTime = (iso?: string | null, assumeUtcIfNoTZ = false) => {
  if (!iso) return '—';

  try {
    let s = String(iso).trim();
    const hasTZ = /Z$|[+-]\d{2}:\d{2}$/.test(s);

    // "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS"
    if (s.includes(' ') && !s.includes('T')) {
      s = s.replace(' ', 'T');
    }

    let d: Date;

    if (!hasTZ && assumeUtcIfNoTZ) {
      // нет часового пояса → трактуем как UTC
      d = new Date(s + 'Z');
    } else {
      // есть TZ или не хотим насильно UTC
      d = new Date(s);
    }

    return d.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: TZ,
    });
  } catch {
    return '—';
  }
};

/** YYYY-MM-DD для input[type=date] без плясок с таймзоной. */
function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shiftISO(baseISO: string, deltaDays: number): string {
  const [y, m, d] = baseISO.split('-').map((n) => parseInt(n, 10));
  const base = new Date(y, (m ?? 1) - 1, d ?? 1);
  base.setDate(base.getDate() + deltaDays);
  const yy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, '0');
  const dd = String(base.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Подпись для заголовка дня. */
function formatDayLabel(iso: string): string {
  try {
    const t = todayISO();
    const yest = shiftISO(t, -1);
    if (iso === t) return 'Сегодня';
    if (iso === yest) return 'Вчера';

    const [yy, mm, dd] = iso.split('-').map((x) => parseInt(x, 10));
    const d = new Date(yy, (mm ?? 1) - 1, dd ?? 1);
    const base = d.toLocaleDateString('ru-RU', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
    });
    return base;
  } catch {
    return iso;
  }
}

/* ====== Небольшие UI-хелперы под общий стиль Refocus ====== */

const CardShell = ({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={`rounded-3xl border border-white/20 bg-white/95 shadow-[0_24px_70px_rgba(15,23,42,0.7)] backdrop-blur-xl ${className}`}
  >
    {children}
  </div>
);

const SoftChip = ({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-sky-50/90 hover:border-sky-200 transition"
  >
    {children}
  </button>
);

const SoftSelect = ({
  value,
  onChange,
  children,
  title,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
  title?: string;
}) => (
  <select
    value={value}
    onChange={onChange}
    title={title}
    className="rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-xs md:text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
  >
    {children}
  </select>
);

const PrimaryButton = ({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-500 via-cyan-400 to-indigo-500 px-4 py-1.5 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(59,130,246,0.6)] hover:brightness-110 active:scale-[.97] disabled:opacity-60 disabled:cursor-not-allowed transition"
  >
    {children}
  </button>
);

export default function AttendanceHistoryPage() {
  const [sb, setSb] =
    useState<ReturnType<typeof getBrowserSupabase> | null>(null);
  const [data, setData] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [reason, setReason] = useState<string>('user');

  // Диапазон дат (по рабочему дню)
  const [dateFrom, setDateFrom] = useState<string>(() => todayISO());
  const [dateTo, setDateTo] = useState<string>(() => todayISO());

  useEffect(() => {
    setSb(getBrowserSupabase());
  }, []);

  async function load() {
    if (!sb) return;
    setLoading(true);
    try {
      let query = sb.from('v_attendance_today__probe').select('*');

      // Фильтрация по диапазону рабочих дат (нужна колонка work_date::date во вью)
      if (dateFrom) {
        query = query.gte('work_date', dateFrom);
      }
      if (dateTo) {
        query = query.lte('work_date', dateTo);
      }

      const { data, error } = await query
        .order('work_date', { ascending: false })
        .order('ended_at', { nullsFirst: true })
        .order('started_at', { ascending: false });

      if (error) throw error;
      setData((data || []) as Row[]);
    } catch (e: any) {
      alert(e?.message || 'Не удалось получить посещаемость');
    } finally {
      setLoading(false);
    }
  }

  // Первичная загрузка и авто-перезагрузка при смене диапазона
  useEffect(() => {
    if (sb) {
      void load();
    }
  }, [sb, dateFrom, dateTo]);

  const branches = useMemo(() => {
    const set = new Set<string>();
    data.forEach((r) => set.add(r.branch_name));
    return ['all', ...Array.from(set)];
  }, [data]);

  const filteredRows = useMemo(
    () =>
      data.filter(
        (r) => branchFilter === 'all' || r.branch_name === branchFilter,
      ),
    [data, branchFilter],
  );

  // Группировка по рабочему дню
  const groupedByDay = useMemo(() => {
    const map = new Map<string, Row[]>();

    filteredRows.forEach((r) => {
      const wd =
        r.work_date ??
        (r.started_at ? String(r.started_at).slice(0, 10) : 'Без даты');
      if (!map.has(wd)) map.set(wd, []);
      map.get(wd)!.push(r);
    });

    // последние дни сверху
    return Array.from(map.entries()).sort(([d1], [d2]) =>
      d1 === d2 ? 0 : d1 < d2 ? 1 : -1,
    );
  }, [filteredRows]);

  async function endShift(sessionId: number) {
    if (!sb || !sessionId) return;
    if (!confirm('Закрыть смену и применить штрафы?')) return;
    try {
      const { data, error } = await sb.rpc('fn_logout_and_close', {
        p_session_id: sessionId,
        p_reason: reason || 'user',
      });
      if (error) throw error;
      alert(
        `Смена закрыта. Начислено штрафов: ${data?.penalty_total ?? 0} сом`,
      );
      await load();
    } catch (e: any) {
      alert(e?.message || 'Ошибка закрытия смены');
    }
  }

  const quickRangeButtons: {
    key: string;
    label: string;
    from: () => string;
    to: () => string;
  }[] = [
    {
      key: 'today',
      label: 'Сегодня',
      from: () => todayISO(),
      to: () => todayISO(),
    },
    {
      key: 'yesterday',
      label: 'Вчера',
      from: () => shiftISO(todayISO(), -1),
      to: () => shiftISO(todayISO(), -1),
    },
    {
      key: '7d',
      label: '7 дней',
      from: () => shiftISO(todayISO(), -6),
      to: () => todayISO(),
    },
    {
      key: '30d',
      label: '30 дней',
      from: () => shiftISO(todayISO(), -29),
      to: () => todayISO(),
    },
  ];

  if (!sb) {
    // Прелоадер в общем стиле (без белого прямоугольника на весь экран)
    return (
      <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
          <div className="h-7 w-64 rounded-full bg-slate-900/40 mb-2 animate-pulse" />
          <div className="h-4 w-80 rounded-full bg-slate-900/30 animate-pulse" />
          <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl h-80 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {/* Заголовок страницы */}
        <div className="flex flex-col gap-2">
          <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 via-cyan-400 to-indigo-500 shadow-[0_12px_35px_rgba(59,130,246,0.7)]">
              <History size={18} className="text-white" />
            </span>
            <span className="bg-gradient-to-r from-sky-100 to-indigo-200 bg-clip-text text-transparent">
              Посещаемость
            </span>
          </h1>
          <p className="text-xs text-slate-300 max-w-md">
            История смен по всем филиалам: вход, выход, опоздания, ранние
            уходы и штрафы по каждому сотруднику.
          </p>
        </div>

        {/* Основная карточка: фильтры + таблица */}
        <CardShell className="px-4 py-4 md:px-5 md:py-5 space-y-4">
          {/* Фильтры */}
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-[11px] text-slate-500 uppercase tracking-wide">
                  Быстрый диапазон
                </span>
                <div className="flex flex-wrap gap-1">
                  {quickRangeButtons.map((btn) => (
                    <SoftChip
                      key={btn.key}
                      onClick={() => {
                        const f = btn.from();
                        const t = btn.to();
                        setDateFrom(f);
                        setDateTo(t);
                      }}
                    >
                      <Calendar size={12} className="text-slate-500" />
                      {btn.label}
                    </SoftChip>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span>с</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white/95 px-2 py-1 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
                <span>по</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white/95 px-2 py-1 text-xs text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 items-center justify-start md:justify-end">
              {/* Филиал */}
              <SoftSelect
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
              >
                {branches.map((b) => (
                  <option key={b} value={b}>
                    {b === 'all' ? 'Все филиалы' : b}
                  </option>
                ))}
              </SoftSelect>

              {/* Причина закрытия смены */}
              <SoftSelect
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                title="Причина закрытия (для логов/аналитики)"
              >
                <option value="user">Обычное закрытие</option>
                <option value="excused">Уважительная причина</option>
                <option value="system">Системное</option>
              </SoftSelect>

              {/* Обновить */}
              <PrimaryButton onClick={load} disabled={loading}>
                <RefreshCw
                  size={16}
                  className={loading ? 'animate-spin' : ''}
                />
                Обновить
              </PrimaryButton>
            </div>
          </div>

          {/* Таблица в белой карточке */}
          <div className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/90">
            <div className="overflow-auto max-h-[70vh] rounded-2xl">
              <table className="min-w-[960px] w-full text-sm">
                <thead className="bg-white text-slate-700 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">
                      Сессия
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">
                      Сотрудник
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">
                      Филиал
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">
                      Старт
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">
                      Конец
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">
                      Опозд., мин
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">
                      Ранний уход, мин
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">
                      Штраф, сом
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">
                      Флаги
                    </th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide">
                      Действие
                    </th>
                  </tr>
                </thead>

                {groupedByDay.length === 0 ? (
                  <tbody>
                    <tr>
                      <td
                        colSpan={10}
                        className="px-3 py-10 text-center text-slate-500 bg-white"
                      >
                        Нет данных за выбранный период
                      </td>
                    </tr>
                  </tbody>
                ) : (
                  groupedByDay.map(([dayIso, rows]) => (
                    <tbody key={dayIso}>
                      {/* заголовок дня */}
                      <tr className="bg-slate-100/90">
                        <td colSpan={10} className="px-3 py-2 text-xs">
                          <div className="flex items-center gap-2 text-slate-700">
                            <div className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-200">
                              <Calendar
                                size={14}
                                className="text-slate-600"
                              />
                            </div>
                            <span className="font-semibold">
                              {formatDayLabel(dayIso)}
                            </span>
                            <span className="text-slate-400">
                              ({dayIso}) · смен: {rows.length}
                            </span>
                          </div>
                        </td>
                      </tr>

                      {/* строки за день */}
                      {rows.map((r) => {
                        const danger =
                          r.flag_no_close ||
                          r.flag_afk ||
                          r.flag_late ||
                          r.flag_early_leave;
                        return (
                          <tr
                            key={r.session_id}
                            className={
                              danger
                                ? 'bg-rose-50/80'
                                : 'bg-white hover:bg-slate-50'
                            }
                          >
                            <td className="px-3 py-2 text-slate-700 tabular-nums">
                              {r.session_id}
                            </td>
                            <td className="px-3 py-2 text-slate-800">
                              {r.full_name}
                            </td>
                            <td className="px-3 py-2 text-slate-800">
                              {r.branch_name}
                            </td>
                            <td className="px-3 py-2 text-slate-800">
                              {fmtTime(r.started_at)}{' '}
                              {/* started_at: нормальный timestamptz */}
                            </td>
                            <td className="px-3 py-2 text-slate-800">
                              {fmtTime(r.ended_at, true)}{' '}
                              {/* ended_at без TZ считаем UTC → +6ч */}
                            </td>
                            <td
                              className={`px-3 py-2 tabular-nums ${
                                r.late_minutes >= 10
                                  ? 'text-rose-600 font-semibold'
                                  : 'text-slate-800'
                              }`}
                            >
                              {r.late_minutes}
                            </td>
                            <td
                              className={`px-3 py-2 tabular-nums ${
                                r.early_leave_minutes >= 10
                                  ? 'text-rose-600 font-semibold'
                                  : 'text-slate-800'
                              }`}
                            >
                              {r.early_leave_minutes}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-slate-800">
                              {r.penalty_total}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap items-center gap-2">
                                {r.flag_late && badge('Опоздал', 'rose')}
                                {r.flag_early_leave &&
                                  badge('Ранний уход', 'rose')}
                                {r.flag_afk && badge('AFK', 'amber')}
                                {r.flag_no_close &&
                                  badge('Не закрыта', 'orange')}
                                {!r.flag_late &&
                                  !r.flag_early_leave &&
                                  !r.flag_afk &&
                                  !r.flag_no_close &&
                                  okBadge()}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {!r.ended_at ? (
                                <button
                                  type="button"
                                  onClick={() => endShift(r.session_id)}
                                  className="inline-flex items-center gap-2 rounded-full bg-indigo-600 text-white px-3 py-1.5 text-xs md:text-sm font-medium shadow-sm hover:bg-indigo-500"
                                >
                                  <DoorOpen size={16} /> Закрыть
                                </button>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-slate-500 text-xs md:text-sm">
                                  <CheckCircle2 size={16} /> закрыта
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  ))
                )}
              </table>
            </div>
          </div>

          <p className="mt-1 text-[11px] text-slate-500 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-100">
              <AlertTriangle size={10} className="text-slate-500" />
            </span>
            Источник данных:{' '}
            <code className="px-1 py-0.5 rounded bg-slate-100 text-[10px] text-slate-700">
              v_attendance_today__probe
            </code>
            . Время старта и окончания берём из колонок{' '}
            <code className="px-1 py-0.5 rounded bg-slate-100 text-[10px] text-slate-700">
              started_at
            </code>{' '}
            и{' '}
            <code className="px-1 py-0.5 rounded bg-slate-100 text-[10px] text-slate-700">
              ended_at
            </code>
            , а закрытие смены идёт через RPC{' '}
            <code className="px-1 py-0.5 rounded bg-slate-100 text-[10px] text-slate-700">
              fn_logout_and_close
            </code>
            .
          </p>
        </CardShell>
      </div>
    </div>
  );
}

function badge(text: string, color: 'rose' | 'amber' | 'orange') {
  const map = {
    rose: 'bg-rose-100 text-rose-700 border border-rose-200',
    amber: 'bg-amber-100 text-amber-800 border border-amber-200',
    orange: 'bg-orange-100 text-orange-800 border border-orange-200',
  } as const;
  return (
    <span className={`px-2 py-0.5 rounded-md text-xs ${map[color]}`}>
      {text}
    </span>
  );
}

function okBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-emerald-100 text-emerald-700 border border-emerald-200">
      <Timer size={12} /> ок
    </span>
  );
}
