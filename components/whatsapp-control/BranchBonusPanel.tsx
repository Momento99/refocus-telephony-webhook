'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Trophy, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';

/**
 * Панель «Премия за качество общения» по филиалам — для CRM-админки.
 * Показывает текущую (живую) оценку и список получателей за выбранный месяц.
 */

const SCORE_THRESHOLD = 8.5;
const BONUS_AMOUNT = 500;

type ScoreRow = {
  branch_id: number;
  branch_name: string;
  wa_threads: number;
  ig_threads: number;
  total_threads: number;
  wa_avg: number | null;
  ig_avg: number | null;
  combined_score: number | null;
  total_shifts: number;
  min_threads_required: number;
  min_threads_ok: boolean;
  score_ok: boolean;
  bonus_eligible: boolean;
  bonus_amount: number;
};

type Recipient = {
  employee_id: number;
  full_name: string;
  shifts_worked: number;
  total_branch_shifts: number;
  share_pct: number;
  eligible: boolean;
};

function pad2(n: number) { return String(n).padStart(2, '0'); }

function bishkekIso(year: number, month1to12: number, day = 1) {
  return `${year}-${pad2(month1to12)}-${pad2(day)}T00:00:00+06:00`;
}

export default function BranchBonusPanel({ year, month }: { year: number; month: number }) {
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [recipientsByBranch, setRecipientsByBranch] = useState<Record<number, Recipient[]>>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const sb = getBrowserSupabase();
      const from = bishkekIso(year, month + 1, 1);
      const nextY = month === 11 ? year + 1 : year;
      const nextM = month === 11 ? 0 : month + 1;
      const to = bishkekIso(nextY, nextM + 1, 1);

      const { data: scoreData } = await sb.rpc('rpc_branch_messaging_score', {
        p_from: from, p_to: to, p_branch_id: null,
      });
      if (cancelled) return;
      const scoreRows = (Array.isArray(scoreData) ? scoreData : []) as ScoreRow[];
      setRows(scoreRows);

      // подгружаем получателей параллельно по всем филиалам
      const recipMap: Record<number, Recipient[]> = {};
      await Promise.all(
        scoreRows.map(async (r) => {
          const { data } = await sb.rpc('rpc_branch_monthly_bonus_recipients', {
            p_from: from, p_to: to, p_branch_id: r.branch_id,
          });
          recipMap[r.branch_id] = (Array.isArray(data) ? data : []) as Recipient[];
        }),
      );
      if (cancelled) return;
      setRecipientsByBranch(recipMap);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [year, month]);

  const totals = useMemo(() => {
    let eligible = 0, payout = 0, recipientsTotal = 0;
    for (const r of rows) {
      if (r.bonus_eligible) {
        eligible += 1;
        const branchRecips = recipientsByBranch[r.branch_id] ?? [];
        const eligRecips = branchRecips.filter((x) => x.eligible).length;
        payout += BONUS_AMOUNT * eligRecips;
        recipientsTotal += eligRecips;
      }
    }
    return { eligible, payout, recipientsTotal };
  }, [rows, recipientsByBranch]);

  const toggle = (branchId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });
  };

  return (
    <div className="rounded-2xl bg-white/95 backdrop-blur p-5 ring-1 ring-amber-200 shadow-[0_8px_30px_rgba(15,23,42,0.10)]">
      <div className="flex items-center gap-3 mb-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-amber-500 shadow-[0_4px_20px_rgba(245,158,11,0.40)]">
          <Trophy className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1">
          <div className="text-base font-bold text-slate-900">Премия за качество общения</div>
          <div className="text-[12px] text-slate-500">
            Combined WA+IG ≥ {SCORE_THRESHOLD.toFixed(1)} · 1.5 диал./смена · {BONUS_AMOUNT} сом каждому продавцу с ≥ 50% смен
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">К выплате</div>
          <div className="text-2xl font-bold text-amber-600 tabular-nums">
            {totals.payout.toLocaleString('ru-RU')} <span className="text-sm font-semibold text-slate-500">сом</span>
          </div>
          <div className="text-[10px] text-slate-500">
            {totals.eligible} филиалов · {totals.recipientsTotal} человек
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-6 text-slate-500 text-sm">Загрузка…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-6 text-slate-500 text-sm">Нет данных за выбранный месяц</div>
      ) : (
        <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Филиал</th>
                <th className="px-3 py-2 text-right">WA</th>
                <th className="px-3 py-2 text-right">IG</th>
                <th className="px-3 py-2 text-right">Combined</th>
                <th className="px-3 py-2 text-right">Диалогов</th>
                <th className="px-3 py-2 text-right">Минимум</th>
                <th className="px-3 py-2 text-right">Премия</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const recipients = recipientsByBranch[r.branch_id] ?? [];
                const eligRecips = recipients.filter((x) => x.eligible);
                const isExpanded = expanded.has(r.branch_id);
                return (
                  <Fragment key={r.branch_id}>
                    <tr
                      className={`border-t border-slate-100 hover:bg-slate-50 cursor-pointer ${r.bonus_eligible ? 'bg-emerald-50/40' : ''}`}
                      onClick={() => toggle(r.branch_id)}
                    >
                      <td className="px-3 py-2.5 font-semibold text-slate-900">{r.branch_name}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        {r.wa_avg != null ? r.wa_avg.toFixed(1) : '—'}
                        <span className="ml-1 text-[10px] text-slate-400">({r.wa_threads})</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        {r.ig_avg != null ? r.ig_avg.toFixed(1) : '—'}
                        <span className="ml-1 text-[10px] text-slate-400">({r.ig_threads})</span>
                      </td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${r.score_ok ? 'text-emerald-700' : 'text-slate-700'}`}>
                        {r.combined_score != null ? r.combined_score.toFixed(2) : '—'}
                      </td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${r.min_threads_ok ? 'text-slate-700' : 'text-orange-700 font-semibold'}`}>
                        {r.total_threads}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                        {r.min_threads_required} <span className="text-[10px]">({r.total_shifts}см)</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {r.bonus_eligible ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-semibold text-white">
                            ✓ {(BONUS_AMOUNT * eligRecips.length).toLocaleString('ru-RU')} сом
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        {recipients.length > 0 && (
                          isExpanded
                            ? <ChevronUp className="h-4 w-4 text-slate-400 inline" />
                            : <ChevronDown className="h-4 w-4 text-slate-400 inline" />
                        )}
                      </td>
                    </tr>
                    {isExpanded && recipients.length > 0 && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
                            <Users className="h-3 w-3" />
                            Получатели премии
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {recipients.map((rec) => (
                              <span
                                key={rec.employee_id}
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
                                  rec.eligible
                                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                    : 'bg-slate-100 text-slate-500 ring-slate-200'
                                }`}
                                title={rec.eligible ? 'Получает премию' : 'Меньше 50% смен филиала'}
                              >
                                {rec.full_name} · {rec.shifts_worked}/{rec.total_branch_shifts}см ({rec.share_pct.toFixed(0)}%)
                                {rec.eligible && r.bonus_eligible && <span className="ml-1">{BONUS_AMOUNT}с</span>}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
