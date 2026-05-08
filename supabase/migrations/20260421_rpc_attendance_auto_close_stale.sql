-- Автозакрытие зависших смен.
--
-- Безопасное правило: закрываем ТОЛЬКО если heartbeat пришёл хотя бы раз
-- и с тех пор протух (>15 минут). Смены, у которых heartbeat никогда не
-- писался (старые терминалы без usePosHeartbeat), НЕ трогаем — иначе
-- ломаем нормально идущие смены старой версии POS.
--
-- Вызывается при загрузке /my-shift; безопасно дёргать чаще.

create or replace function public.rpc_attendance_auto_close_stale()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with stale as (
    select id, last_heartbeat_at as stop_at
    from attendance_sessions
    where ended_at is null
      and last_heartbeat_at is not null
      and last_heartbeat_at < now() - interval '15 minutes'
  )
  update attendance_sessions a
     set ended_at   = stale.stop_at,
         status     = 'auto_closed',
         end_reason = coalesce(a.end_reason, 'stale_heartbeat')
    from stale where stale.id = a.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.rpc_attendance_auto_close_stale()
  to authenticated, anon, service_role;

comment on function public.rpc_attendance_auto_close_stale is
  'Автозакрытие зависших смен: только если heartbeat был и протух >15 мин. Смены без пингов (старые терминалы) не трогает.';
