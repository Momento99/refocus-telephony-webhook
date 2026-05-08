-- Единая логика жизненного цикла смен (2026-05-07).
--
-- Старая модель:
--   - rpc_attendance_auto_close_stale закрывала смену через 15 минут без heartbeat
--   - При перезагрузке или коротком сбое питания смена резалась на куски
--   - Это ломало премию (порог 5 часов) и зарплату
--
-- Новая модель:
--   - Heartbeat-based авто-close ОТМЕНЁН (rpc_attendance_auto_close_stale → noop)
--   - Смена закрывается только в трёх случаях:
--       (a) ручное закрытие в POS
--       (b) cron fn_attendance_close_eod в work_close + 30 мин филиала
--       (c) cron fn_attendance_close_overnight в 06:00 Bishkek (страховка)
--   - При повторном логине того же дня — смена продолжается (already_open)

-- ─── 1. rpc_attendance_auto_close_stale → noop (legacy compat) ──────────────
create or replace function public.rpc_attendance_auto_close_stale()
returns int
language sql
security definer
set search_path = public
as $$
  -- legacy noop: 15-min auto-close отменён в пользу EOD-логики (close_eod + close_overnight)
  select 0;
$$;

comment on function public.rpc_attendance_auto_close_stale is
  'Legacy noop с 2026-05-07. Раньше закрывала смены через 15 мин без heartbeat — ломало премию при ребуте. Теперь закрытие — только EOD cron или вручную.';

-- ─── 2. fn_attendance_close_eod ─────────────────────────────────────────────
-- Закрывает смены текущего дня после work_close + 30 мин филиала.
-- ended_at = LEAST(last_heartbeat_at, work_close+30) — чтобы не завышать длительность,
-- если продавец ушёл раньше work_close.
create or replace function public.fn_attendance_close_eod()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  with candidates as (
    select s.id, s.last_heartbeat_at,
      -- момент закрытия: work_close + 30 мин в TZ филиала, как timestamptz
      ((current_date::timestamp + coalesce(b.work_close, '18:30:00'::time) + interval '30 minutes')
        at time zone coalesce(b.timezone, 'Asia/Bishkek')) as close_at_dt
    from attendance_sessions s
    join branches b on b.id = s.branch_id
    where s.ended_at is null
  ),
  due as (
    select id,
      least(coalesce(last_heartbeat_at, close_at_dt), close_at_dt) as ended_at_calc
    from candidates
    where now() >= close_at_dt
  )
  update attendance_sessions a
     set ended_at   = due.ended_at_calc,
         status     = 'auto_closed',
         end_reason = coalesce(a.end_reason, 'auto_eod')
    from due where due.id = a.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.fn_attendance_close_eod() from public, anon, authenticated;
grant execute on function public.fn_attendance_close_eod() to service_role;

comment on function public.fn_attendance_close_eod is
  'Закрывает открытые смены после work_close+30мин филиала. ended_at = min(last_heartbeat, work_close+30) — не завышает длительность.';

-- ─── 3. fn_attendance_close_overnight ───────────────────────────────────────
-- Утренняя страховка: закрывает все смены, начатые вчера и раньше, если они
-- ещё открыты (на случай если EOD cron не сработал).
create or replace function public.fn_attendance_close_overnight()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_today_start_bishkek timestamptz;
begin
  -- начало сегодняшнего дня по Bishkek
  v_today_start_bishkek := (date_trunc('day', now() at time zone 'Asia/Bishkek'))
                           at time zone 'Asia/Bishkek';

  with candidates as (
    select s.id, s.last_heartbeat_at,
      ((s.started_at::date::timestamp + coalesce(b.work_close, '18:30:00'::time) + interval '30 minutes')
        at time zone coalesce(b.timezone, 'Asia/Bishkek')) as work_close_dt
    from attendance_sessions s
    join branches b on b.id = s.branch_id
    where s.ended_at is null
      and s.started_at < v_today_start_bishkek
  ),
  due as (
    select id, least(coalesce(last_heartbeat_at, work_close_dt), work_close_dt) as ended_at_calc
    from candidates
  )
  update attendance_sessions a
     set ended_at   = due.ended_at_calc,
         status     = 'auto_closed',
         end_reason = coalesce(a.end_reason, 'auto_overnight')
    from due where due.id = a.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.fn_attendance_close_overnight() from public, anon, authenticated;
grant execute on function public.fn_attendance_close_overnight() to service_role;

comment on function public.fn_attendance_close_overnight is
  'Утренняя страховка: закрывает смены ВЧЕРАШНЕГО дня. ended_at рассчитывается по work_close филиала + 30 мин или last_heartbeat.';

-- ─── 4. pg_cron расписания ──────────────────────────────────────────────────
-- Удаляем старые если есть
do $$
declare j_id bigint;
begin
  for j_id in select jobid from cron.job where jobname in ('attendance_close_eod','attendance_close_overnight')
  loop
    perform cron.unschedule(j_id);
  end loop;
end $$;

-- EOD: каждый час с 17:00 до 21:00 Bishkek (= 11:00 до 15:00 UTC).
-- Покрывает SK/BV/KB (close 17:00 → cron 17:30+) и KT/TK (close 18:00 → cron 18:30+).
select cron.schedule(
  'attendance_close_eod',
  '0 11-15 * * *',
  $cron$select public.fn_attendance_close_eod();$cron$
);

-- Overnight: 06:00 Bishkek (= 00:00 UTC)
select cron.schedule(
  'attendance_close_overnight',
  '0 0 * * *',
  $cron$select public.fn_attendance_close_overnight();$cron$
);
