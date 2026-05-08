-- HARDENING: закрываем критическую дыру безопасности на премиях.
--
-- Проблема (найдена в аудите 2026-05-07):
--   1) После CREATE TABLE branch_monthly_bonus_history Postgres дал anon/authenticated
--      полный CRUD (SELECT, INSERT, UPDATE, DELETE, TRUNCATE) — default Supabase grants
--      на public schema. RLS была OFF. Зарплатные данные были доступны любому anon.
--   2) fn_branch_monthly_bonus_snapshot() и fn_branch_monthly_bonus_cron_tick() имели
--      EXECUTE для anon/authenticated — anon мог вручную триггерить пересчёт.

revoke all on public.branch_monthly_bonus_history from anon, authenticated, public;

alter table public.branch_monthly_bonus_history enable row level security;

drop policy if exists branch_bonus_history_select_owner on public.branch_monthly_bonus_history;
create policy branch_bonus_history_select_owner
  on public.branch_monthly_bonus_history
  for select
  to authenticated
  using (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'owner'
  );

revoke execute on function public.fn_branch_monthly_bonus_snapshot(int, int) from anon, authenticated, public;
revoke execute on function public.fn_branch_monthly_bonus_cron_tick() from anon, authenticated, public;
grant execute on function public.fn_branch_monthly_bonus_snapshot(int, int) to service_role;
grant execute on function public.fn_branch_monthly_bonus_cron_tick() to service_role;

comment on table public.branch_monthly_bonus_history is
  'История ежемесячных премий по филиалам. RLS: SELECT — только owner. Запись — service_role (через snapshot функцию).';
