-- Archive the employee in place so historical records retain their employee ID
-- and the payroll profile used to calculate previous periods.
-- The daily calculation joins only days with attendance, payments, penalties or
-- work records. An employee's current status must not filter those past days.
do $$
declare
  definition text := pg_get_functiondef('public.payroll_daily_canonical(date,date,bigint,bigint)'::regprocedure);
  active_filter text := 'WHERE COALESCE(e.is_active, true) = true' || chr(10) || '    AND (p_branch_id';
begin
  if cardinality(string_to_array(definition, active_filter)) <> 2 then
    raise exception 'Unexpected employee filter in payroll_daily_canonical';
  end if;
  execute replace(definition, active_filter, 'WHERE (p_branch_id');
end;
$$;

create or replace function public.app_archive_employee(p_employee_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  archived_at timestamptz;
begin
  perform public._refocus_require_owner();
  perform pg_advisory_xact_lock(hashtextextended('employee-shift-open:' || p_employee_id, 0));
  archived_at := clock_timestamp();

  update public.employees
     set is_active = false, updated_at = archived_at
   where id = p_employee_id;
  if not found then
    raise exception 'Сотрудник не найден' using errcode = 'P0002';
  end if;

  perform public.app_remove_employee_login(p_employee_id);

  update public.attendance_sessions
     set ended_at = archived_at at time zone 'UTC',
         status = 'completed',
         end_reason = 'employee_archived'
   where employee_id = p_employee_id and ended_at is null;

  update public.user_sessions
     set ended_at = archived_at, force_logout = true
   where employee_id = p_employee_id and ended_at is null;
end;
$$;

revoke all on function public.app_archive_employee(bigint) from public, anon, authenticated;
grant execute on function public.app_archive_employee(bigint) to authenticated, service_role;

-- A login may have verified the PIN just before the archive committed.
-- Serialize opening the session with the employee update, including older POS clients.
create function private.guard_archived_employee_session()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  employee_active boolean;
begin
  select e.is_active into employee_active
    from public.employees e
   where e.id = new.employee_id
   for share;

  if employee_active is false then
    raise exception 'Сотрудник находится в архиве' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_archived_employee_session() from public, anon, authenticated;

create trigger guard_archived_employee_shift
before insert or update of employee_id, ended_at on public.attendance_sessions
for each row
when (new.employee_id is not null and new.ended_at is null)
execute function private.guard_archived_employee_session();

create trigger guard_archived_employee_user_session
before insert or update of employee_id, ended_at on public.user_sessions
for each row
when (new.employee_id is not null and new.ended_at is null)
execute function private.guard_archived_employee_session();
