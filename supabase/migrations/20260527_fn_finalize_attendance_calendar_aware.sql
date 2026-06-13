-- Учёт сокращённых/закрытых дней календаря в расчёте штрафов посещаемости.
-- Для обычного дня (v_day_mode='normal') поведение идентично прежней версии.
-- Новое: short → ранний уход считается от 14:00; closed → штрафы опоздания/ухода = 0.
-- Вызов календаря защищён EXCEPTION → 'normal', чтобы сбой не ломал закрытие смены.
CREATE OR REPLACE FUNCTION public.fn_finalize_attendance(p_session_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_branch_id     bigint;
  v_started_at    timestamptz;
  v_ended_at      timestamptz;
  v_last_active   timestamptz;

  v_dow           int;
  v_wh_start      time;
  v_wh_end        time;
  v_is_day_off    boolean;

  v_late_m        int := 0;
  v_early_m       int := 0;
  v_afk_m         int := 0;

  v_penalty       bigint := 0;

  v_local_start   timestamp;
  v_local_end     timestamp;
  v_local_last    timestamp;

  v_have_wh       boolean := false;

  v_day_mode      text := 'normal';
  v_shift_date    date;
begin
  select branch_id,
         started_at,
         ended_at,
         coalesce(last_active_at, started_at),
         coalesce(late_minutes, 0),
         coalesce(early_leave_minutes, 0)
    into v_branch_id, v_started_at, v_ended_at, v_last_active, v_late_m, v_early_m
  from public.attendance_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'attendance_sessions % not found', p_session_id;
  end if;

  if v_ended_at is null then
    v_ended_at := now();
  end if;

  v_local_start := (v_started_at  at time zone 'Asia/Bishkek')::timestamp;
  v_local_end   := (v_ended_at    at time zone 'Asia/Bishkek')::timestamp;
  v_local_last  := (v_last_active at time zone 'Asia/Bishkek')::timestamp;
  v_dow := extract(dow from (v_started_at at time zone 'Asia/Bishkek'))::int;

  select bw.start_at, bw.end_at, bw.is_day_off
    into v_wh_start, v_wh_end, v_is_day_off
  from public.branch_workhours bw
  where bw.branch_id = v_branch_id and bw.dow = v_dow
  limit 1;

  v_have_wh := (coalesce(v_is_day_off,false) = false) and v_wh_start is not null;

  -- Режим дня по календарю. Любой сбой => 'normal' (не ломаем закрытие смены).
  v_shift_date := (v_started_at at time zone 'Asia/Bishkek')::date;
  begin
    v_day_mode := public.fn_calendar_day_mode(v_branch_id, v_shift_date);
  exception when others then
    v_day_mode := 'normal';
  end;

  -- Сокращённый день: конец рабочего дня = 14:00
  if v_day_mode = 'short' and v_have_wh then
    v_wh_end := time '14:00';
  end if;

  if v_have_wh then
    v_late_m := greatest(0, floor(extract(epoch from (v_local_start::time - v_wh_start)) / 60)::int);
  end if;

  if v_have_wh and v_wh_end is not null then
    v_early_m := greatest(0, floor(extract(epoch from (v_wh_end - v_local_end::time)) / 60)::int);
  end if;

  v_afk_m := greatest(0, floor(extract(epoch from (v_local_end - v_local_last)) / 60)::int);

  -- Закрытый день (праздник-выходной): без штрафов
  if v_day_mode = 'closed' then
    v_late_m  := 0;
    v_early_m := 0;
  end if;

  update public.attendance_sessions
     set late_minutes        = v_late_m,
         early_leave_minutes = v_early_m
   where id = p_session_id;

  v_penalty := public.fn_session_penalty(p_session_id);

  update public.attendance_sessions
     set penalty_total = v_penalty
   where id = p_session_id;

  return json_build_object(
    'late_minutes',         v_late_m,
    'early_leave_minutes',  v_early_m,
    'afk_minutes',          v_afk_m,
    'penalty_total',        v_penalty,
    'is_day_off',           coalesce(v_is_day_off,false),
    'day_mode',             v_day_mode
  );
end
$function$;
