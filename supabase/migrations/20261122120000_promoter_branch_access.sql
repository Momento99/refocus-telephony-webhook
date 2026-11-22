begin;

-- Promoters may work at open POS branches in their own network. Hidden and
-- workshop branches are not part of the promoter POS directory.
create view private.v_organization_pos_branches as
select b.organization_id, array_agg(b.id order by b.id) as branch_ids
from public.branches b
where b.organization_id is not null and not b.is_hidden and not coalesce(b.is_workshop, false)
  and exists (
    select 1 from public.terminals t
    where t.branch_id = b.id and t.kind = 'pos'
      and coalesce(t.is_active, true) and t.is_enabled
  )
group by b.organization_id;

create function private.promoter_pos_branch_ids(p_employee_id bigint)
returns bigint[] language sql stable security definer
set search_path = pg_catalog, public, private, pg_temp as $$
  select coalesce((
    select network.branch_ids
    from public.employees e
    join public.branches home on home.id = e.branch_id
    join private.v_organization_pos_branches network on network.organization_id = home.organization_id
    where e.id = p_employee_id and e.is_active and e.role::text = 'promoter'
  ), '{}'::bigint[]);
$$;

-- Keep the public POS directory readable without granting anonymous access
-- to private functions or to the credential tables.
create view private.v_staff_pos_branch_access as
select e.id as employee_id, eligibility.personal_login_active,
  case
    when not coalesce(e.is_active, false) then '{}'::bigint[]
    when a.can_work_all_branches and not eligibility.personal_login_active then '{}'::bigint[]
    when a.can_work_all_branches and e.role::text = 'promoter' then coalesce(network.branch_ids, '{}'::bigint[])
    when e.branch_id is not null then array[e.branch_id]
    else '{}'::bigint[]
  end as allowed_branch_ids
from public.employees e
left join private.roaming_staff_access a on a.employee_id = e.id
left join private.roaming_staff_credentials rc on rc.employee_id = e.id
left join public.branches home on home.id = e.branch_id
left join private.v_organization_pos_branches network on network.organization_id = home.organization_id
cross join lateral (
  select coalesce(a.can_work_all_branches and rc.is_active and e.is_active
    and e.role::text = a.expected_role, false) as personal_login_active
) eligibility;

create function private.staff_pos_branch_ids(p_employee_id bigint)
returns bigint[] language sql stable security definer
set search_path = pg_catalog, public, private, pg_temp as $$
  select coalesce((
    select allowed_branch_ids from private.v_staff_pos_branch_access
    where employee_id = p_employee_id
  ), '{}'::bigint[]);
$$;

create or replace function private.staff_can_work_branch(p_employee_id bigint, p_branch_id bigint)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, private, pg_temp as $$
  select coalesce(p_branch_id = any(private.staff_pos_branch_ids(p_employee_id)), false);
$$;

revoke all on function private.promoter_pos_branch_ids(bigint),
  private.staff_pos_branch_ids(bigint) from public, anon, authenticated, crm_manager, service_role;
revoke all on private.v_organization_pos_branches, private.v_staff_pos_branch_access
  from public, anon, authenticated, crm_manager, service_role;

-- The directory flag selects the personal PIN RPC on older POS clients. Keep
-- it for existing enrolled sellers; the branch list expresses actual access.
create or replace view public.v_employee_logins as
select e.id as employee_id, e.full_name, e.branch_id, e.role::text as role,
  ec.id as cred_id, coalesce(rc.login, ec.login) as login,
  case when a.can_work_all_branches then scope.personal_login_active
    else ec.is_active and e.is_active end as is_active,
  coalesce(rc.creds_version, ec.creds_version) as creds_version,
  coalesce(rc.updated_at, ec.updated_at) as updated_at, ec.created_at,
  coalesce(a.can_work_all_branches, false) as can_work_all_branches,
  scope.allowed_branch_ids
from public.employees e
join private.v_staff_pos_branch_access scope on scope.employee_id = e.id
left join public.employee_credentials ec on ec.employee_id = e.id
left join private.roaming_staff_access a on a.employee_id = e.id
left join private.roaming_staff_credentials rc on rc.employee_id = e.id
order by e.id;

create or replace function public.admin_roaming_staff()
returns table(employee_id bigint, full_name text, role text, login text, enabled boolean,
  allowed_branch_ids bigint[], creds_version integer)
language plpgsql stable security definer
set search_path = pg_catalog, public, private, pg_temp as $$
begin
  perform public._refocus_require_owner();
  return query
  select a.employee_id, e.full_name, a.expected_role, rc.login::text,
    private.roaming_staff_enabled(a.employee_id), private.staff_pos_branch_ids(a.employee_id),
    rc.creds_version
  from private.roaming_staff_access a
  join public.employees e on e.id = a.employee_id
  left join private.roaming_staff_credentials rc on rc.employee_id = e.id
  order by a.employee_id;
end;
$$;

-- Older clients can update the attendance table directly. The same branch and
-- terminal restrictions apply there, while historical owner corrections can
-- still record the branch where the work happened.
create or replace function private.guard_roaming_session_branch()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare
  uses_personal_pin boolean;
  terminal_branch bigint;
begin
  if public._payroll_is_owner_strict_v5() then return new; end if;
  select exists (
    select 1 from private.roaming_staff_access a
    where a.employee_id = new.employee_id and a.can_work_all_branches
  ) into uses_personal_pin;

  if tg_op = 'UPDATE' and (uses_personal_pin or exists (
    select 1 from private.roaming_staff_access a
    where a.employee_id = old.employee_id and a.can_work_all_branches
  )) then
    if new.employee_id is distinct from old.employee_id
      or new.branch_id is distinct from old.branch_id
      or new.terminal_id is distinct from old.terminal_id
      or new.started_at is distinct from old.started_at
      or new.opened_at is distinct from old.opened_at then
      raise exception 'A personal shift keeps its original employee, branch and terminal'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if uses_personal_pin and nullif(current_setting('roaming.verified_employee_id', true), '')
    is distinct from new.employee_id::text then
    raise exception 'Individual PIN verification is required' using errcode = '42501';
  end if;

  if new.terminal_id is not null then
    select t.branch_id into terminal_branch from public.terminals t
    where t.id = new.terminal_id and coalesce(t.is_active, true) and t.is_enabled
      and (not uses_personal_pin or t.kind = 'pos');
    if terminal_branch is null or (new.branch_id is not null and terminal_branch <> new.branch_id) then
      raise exception 'The shift must use a terminal in its actual branch' using errcode = '42501';
    end if;
  end if;

  if new.employee_id is not null and (
    (uses_personal_pin and (terminal_branch is null or new.branch_id is null))
    or (coalesce(new.branch_id, terminal_branch) is not null
      and not private.staff_can_work_branch(new.employee_id, coalesce(new.branch_id, terminal_branch)))
  ) then
    raise exception 'The employee cannot open a shift in this branch' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Preserve login result contracts and require branch authorization in both
-- personal PIN and legacy entry points.
create or replace function public.open_employee_session_login_pin_v2(
  p_login text, p_pin text, p_terminal_code text, p_opened_at timestamptz default null,
  p_client_uuid uuid default null
) returns table(session_id bigint, error text)
language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp as $$
declare
  employee_row record;
  terminal_row record;
  active_row public.attendance_sessions%rowtype;
  is_roaming boolean;
  opened_at_value timestamptz;
begin
  session_id := null;
  error := null;
  select e.id, coalesce(a.can_work_all_branches, false) as roaming
    into employee_row
  from public.employees e
  left join private.roaming_staff_access a on a.employee_id = e.id
  left join private.roaming_staff_credentials rc on rc.employee_id = e.id
  left join public.employee_credentials c on c.employee_id = e.id
  where coalesce(e.is_active, false) and (
    (coalesce(a.can_work_all_branches, false)
      and rc.login = lower(trim(p_login))::public.citext and rc.is_active
      and p_pin ~ '^[0-9]{4}$'
      and rc.pin_sha256 = extensions.digest(p_pin, 'sha256')
      and e.role::text = a.expected_role)
    or (not coalesce(a.can_work_all_branches, false)
      and lower(c.login::text) = lower(trim(p_login)) and c.is_active
      and (c.pin_sha256 = extensions.digest(p_pin, 'sha256')
        or (c.pin_hash ~ '^\$[12][a-z]?\$'
          and extensions.crypt(p_pin, c.pin_hash) = c.pin_hash)))
  ) limit 1;
  if not found then error := 'wrong_pin'; return next; return; end if;

  is_roaming := employee_row.roaming;
  select t.id, t.branch_id into terminal_row
  from public.terminals t
  where (upper(replace(trim(t.code), '-', '')) = upper(replace(trim(p_terminal_code), '-', ''))
    or upper(replace(trim(t.terminal_code), '-', '')) = upper(replace(trim(p_terminal_code), '-', '')))
    and coalesce(t.is_active, true) and t.is_enabled
    and (not is_roaming or t.kind = 'pos')
  order by t.id limit 1;
  if not found or terminal_row.branch_id is null then
    error := 'terminal_not_found'; return next; return;
  end if;
  if is_roaming and p_client_uuid is null then
    error := 'device_required'; return next; return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('employee-shift-open:' || employee_row.id, 0));
  if not private.staff_can_work_branch(employee_row.id, terminal_row.branch_id) then
    error := 'branch_mismatch'; return next; return;
  end if;
  select * into active_row from public.attendance_sessions s
  where s.employee_id = employee_row.id and s.ended_at is null
  order by s.id desc limit 1 for update;
  if found then
    if is_roaming and active_row.started_at < now() - interval '18 hours' then
      error := 'active_shift_expired'; return next; return;
    end if;
    if (is_roaming or active_row.branch_id is not null)
      and active_row.branch_id is distinct from terminal_row.branch_id then
      error := 'active_shift_other_branch'; return next; return;
    end if;
    if is_roaming and active_row.terminal_id is distinct from terminal_row.id then
      error := 'active_shift_other_terminal'; return next; return;
    end if;
    if not is_roaming then
      update public.attendance_sessions set
        terminal_id = coalesce(terminal_id, terminal_row.id),
        branch_id = coalesce(branch_id, terminal_row.branch_id)
      where id = active_row.id;
    end if;
    session_id := active_row.id;
    error := 'already_open';
  else
    opened_at_value := case when is_roaming then now() else coalesce(p_opened_at, now()) end;
    if is_roaming then
      perform set_config('roaming.verified_employee_id', employee_row.id::text, true);
    end if;
    insert into public.attendance_sessions(
      employee_id, branch_id, terminal_id, opened_at, started_at, status
    ) values (
      employee_row.id, terminal_row.branch_id, terminal_row.id,
      opened_at_value, opened_at_value, 'active'
    ) returning id into session_id;
  end if;
  if p_client_uuid is not null then
    insert into public.pos_session_capabilities(
      attendance_session_id, employee_id, branch_id, terminal_id, client_uuid_hash, refreshed_at
    ) select s.id, s.employee_id, s.branch_id, s.terminal_id,
        extensions.digest(p_client_uuid::text, 'sha256'), now()
      from public.attendance_sessions s where s.id = session_id
    on conflict (attendance_session_id) do update set
      employee_id = excluded.employee_id, branch_id = excluded.branch_id,
      terminal_id = excluded.terminal_id, client_uuid_hash = excluded.client_uuid_hash,
      refreshed_at = now();
  end if;
  perform public.ensure_penalties_today_from_views(session_id);
  return next;
end;
$$;

-- Keep the old sign-in APIs for branch-bound credentials. Their original
-- output contracts and grants stay intact.
do $$
declare
  definition text;
  before_guard text;
  after_guard text;
begin
  definition := pg_get_functiondef('public.fn_pos_open_by_branch(text,text,integer)'::regprocedure);
  before_guard := '    AND branch_id = v_branch.id';
  after_guard := before_guard || chr(10)
    || '    AND private.staff_can_work_branch(v_emp.employee_id, branch_id)';
  if cardinality(string_to_array(definition, before_guard)) <> 2 then
    raise exception 'Legacy POS terminal lookup has an unexpected definition';
  end if;
  execute replace(definition, before_guard, after_guard);

  definition := pg_get_functiondef('public.open_employee_session_login_pin(text,text,text,timestamp with time zone,uuid)'::regprocedure);
  before_guard := '  -- есть активная смена?';
  after_guard := $guard$  if not private.staff_can_work_branch(v_emp.id, v_term.branch_id) then
    return query select null::bigint, 'branch_mismatch';
    return;
  end if;

  -- есть активная смена?$guard$;
  if cardinality(string_to_array(definition, before_guard)) <> 2 then
    raise exception 'Legacy attendance lookup has an unexpected definition';
  end if;
  execute replace(definition, before_guard, after_guard);
end;
$$;

notify pgrst, 'reload schema';
commit;
