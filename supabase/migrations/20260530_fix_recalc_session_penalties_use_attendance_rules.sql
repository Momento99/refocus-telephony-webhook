-- FIX: штрафы за опоздание/ранний уход перестали начисляться с ~апреля 2026.
-- Причина: recalc_session_penalties (срабатывает последним из 4 триггеров на закрытии смены)
-- читал ПУСТУЮ legacy-таблицу penalty_rules через _pick_penalty, удалял строки штрафов и
-- затирал penalty_total в 0. Платёжка (payroll_daily_canonical → CTE penalty_day) читает
-- именно строки attendance_session_penalties, поэтому штрафы нигде не учитывались.
--
-- Решение: переписываем recalc_session_penalties на актуальную таблицу attendance_penalty_rules
-- (rule_type/threshold_m/amount), согласованно с fn_session_penalty / fn_finalize_attendance.
-- Промоутеры — без штрафов. «Ранний уход» на авто-закрытых сменах (stale_heartbeat/auto_eod/auto19)
-- считается как обычно, без исключений по end_reason (решение владельца, 2026-05-30).
--
-- Архитектуру триггеров намеренно не трогаем (минимальный фикс): дубли finalize-триггеров и
-- параллельная attendance_penalties_daily остаются как есть — на платёжку они не влияют.

CREATE OR REPLACE FUNCTION public.recalc_session_penalties(p_session_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_branch_id  bigint;
  v_role       text;
  v_late_m     int    := 0;
  v_early_m    int    := 0;
  v_late_amt   bigint := 0;
  v_late_thr   int    := 0;
  v_early_amt  bigint := 0;
  v_early_thr  int    := 0;
  v_total      bigint := 0;
begin
  -- 1. Смена + роль сотрудника
  select s.branch_id,
         coalesce(e.role::text, 'seller'),
         coalesce(s.late_minutes, 0),
         coalesce(s.early_leave_minutes, 0)
    into v_branch_id, v_role, v_late_m, v_early_m
  from public.attendance_sessions s
  left join public.employees e on e.id = s.employee_id
  where s.id = p_session_id;

  if not found then
    return;
  end if;

  -- 2. Идемпотентность: чистим прежние штрафы по смене
  delete from public.attendance_session_penalties where session_id = p_session_id;

  -- 3. Промоутер: штрафов за расписание нет
  if v_role = 'promoter' then
    update public.attendance_sessions set penalty_total = 0 where id = p_session_id;
    return;
  end if;

  -- 4. Суммы и пороги из АКТУАЛЬНОЙ таблицы правил (как в fn_session_penalty):
  --    берём наибольший подходящий порог (threshold_m <= минут) и его сумму.
  select coalesce(max(amount), 0), coalesce(max(threshold_m), 0)
    into v_late_amt, v_late_thr
  from public.attendance_penalty_rules
  where rule_type = 'late' and threshold_m <= v_late_m;

  select coalesce(max(amount), 0), coalesce(max(threshold_m), 0)
    into v_early_amt, v_early_thr
  from public.attendance_penalty_rules
  where rule_type = 'early' and threshold_m <= v_early_m;

  -- 5. Пишем строки штрафов (их читает платёжка: payroll_daily_canonical)
  if v_late_amt > 0 then
    insert into public.attendance_session_penalties
      (session_id, type, minutes, threshold_min, amount, is_cancelled, cancel_reason, cancelled_at, cancelled_by, cancelled)
    values
      (p_session_id, 'late', v_late_m, v_late_thr, v_late_amt, false, null, null, null, false);
  end if;

  if v_early_amt > 0 then
    insert into public.attendance_session_penalties
      (session_id, type, minutes, threshold_min, amount, is_cancelled, cancel_reason, cancelled_at, cancelled_by, cancelled)
    values
      (p_session_id, 'early', v_early_m, v_early_thr, v_early_amt, false, null, null, null, false);
  end if;

  -- 6. Итог по смене (совпадает с fn_session_penalty)
  v_total := v_late_amt + v_early_amt;
  update public.attendance_sessions set penalty_total = v_total where id = p_session_id;
end;
$function$;
