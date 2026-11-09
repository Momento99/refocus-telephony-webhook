begin;

-- Access and PIN authority are private because the legacy employee directory
-- has broad client grants. This migration does not activate roaming or reset a PIN.
create table private.roaming_staff_access (
  employee_id bigint primary key references public.employees(id),
  expected_role text not null check (expected_role in ('seller', 'promoter')),
  allowed_branch_ids bigint[] not null default '{}'::bigint[],
  can_work_all_branches boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not can_work_all_branches or cardinality(allowed_branch_ids)>0)
);
create table private.roaming_staff_credentials (
  employee_id bigint primary key references private.roaming_staff_access(employee_id),
  login public.citext not null unique,
  pin_hash text not null,
  pin_sha256 bytea not null,
  is_active boolean not null default true,
  creds_version integer not null default 1,
  updated_at timestamptz not null default now()
);
create table private.roaming_login_proofs (
  proof_hash bytea primary key,
  employee_id bigint not null references private.roaming_staff_access(employee_id),
  attendance_session_id bigint not null references public.attendance_sessions(id),
  user_session_id uuid not null references public.user_sessions(id),
  branch_id bigint not null,
  terminal_id integer not null,
  client_uuid_hash bytea not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index roaming_login_proofs_attendance_idx
  on private.roaming_login_proofs(attendance_session_id);
create table private.roaming_staff_definition_backup (
  object_kind text not null,
  object_identity text not null,
  definition text not null,
  original_acl aclitem[],
  primary key (object_kind, object_identity)
);

revoke all on private.roaming_staff_access, private.roaming_staff_credentials,
  private.roaming_login_proofs, private.roaming_staff_definition_backup
  from public, anon, authenticated, crm_manager, service_role;

do $$
begin
  if has_schema_privilege('anon', 'private', 'USAGE')
    or has_schema_privilege('authenticated', 'private', 'USAGE')
    or has_schema_privilege('crm_manager', 'private', 'USAGE') then
    raise exception 'The roaming authority requires a closed private schema';
  end if;
end;
$$;

insert into private.roaming_staff_definition_backup
select 'function', p.oid::regprocedure::text, pg_get_functiondef(p.oid),
       coalesce(p.proacl, acldefault('f',p.proowner))
from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (
  'fn_pos_open_by_branch','open_employee_session_login_pin_v2',
  'payroll_daily_canonical','pos_create_order_atomic',
  '_refocus_authorize_order_action','app_set_employee_login_pin',
  'app_set_employee_pin','set_employee_login_pin','set_employee_login_active',
  'app_remove_employee_login',
  'admin_list_employee_credentials','get_active_sales_session_id'
);
insert into private.roaming_staff_definition_backup
select 'view', c.oid::regclass::text, pg_get_viewdef(c.oid,true), c.relacl
from pg_class c where c.relnamespace='public'::regnamespace and c.relname in (
  'v_employee_logins','v_employee_credentials_admin','v_payroll_daily_fixed'
);
insert into private.roaming_staff_definition_backup
select 'table_acl',c.oid::regclass::text,'',c.relacl from pg_class c
where c.oid='public.employee_credentials'::regclass;

create function private.roaming_staff_enabled(p_employee_id bigint)
returns boolean language sql stable security definer
set search_path=pg_catalog,public,private,pg_temp as $$
  select exists (
    select 1 from private.roaming_staff_access a
    join public.employees e on e.id=a.employee_id
    join private.roaming_staff_credentials c on c.employee_id=a.employee_id
    where a.employee_id=p_employee_id and a.can_work_all_branches
      and c.is_active and coalesce(e.is_active,false)
      and e.role::text=a.expected_role
  );
$$;

create function private.staff_can_work_branch(p_employee_id bigint,p_branch_id bigint)
returns boolean language sql stable security definer
set search_path=pg_catalog,public,private,pg_temp as $$
  select exists (
    select 1 from public.employees e
    left join private.roaming_staff_access a on a.employee_id=e.id
    where e.id=p_employee_id and coalesce(e.is_active,false)
      and case when coalesce(a.can_work_all_branches,false) then
        private.roaming_staff_enabled(e.id) and p_branch_id=any(a.allowed_branch_ids)
        else e.branch_id=p_branch_id end
  );
$$;

create function private.roaming_pin_employee(p_login text,p_pin text)
returns bigint language sql stable security definer
set search_path=pg_catalog,public,private,pg_temp as $$
  select c.employee_id from private.roaming_staff_credentials c
  where c.login=lower(trim(p_login))::public.citext
    and p_pin ~ '^[0-9]{4}$'
    and c.pin_sha256=extensions.digest(p_pin,'sha256')
    and private.roaming_staff_enabled(c.employee_id);
$$;

create function private.set_roaming_staff_credentials(
  p_employee_id bigint,p_login text,p_pin text,p_is_active boolean default true,
  p_enable_roaming boolean default true
) returns bigint language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
declare
  normalized_login public.citext := lower(trim(p_login))::public.citext;
  credential_id bigint;
  password_hash text;
  password_digest bytea;
  marker text;
begin
  perform public._refocus_require_owner();
  if not exists (
    select 1 from private.roaming_staff_access a
    join public.employees e on e.id=a.employee_id
    where a.employee_id=p_employee_id and e.role::text=a.expected_role
      and coalesce(e.is_active,false)
  ) then
    raise exception 'This credential setup requires an owner-approved existing employee'
      using errcode='42501';
  end if;
  if p_login is null or length(normalized_login)<3 or length(normalized_login)>32
    or normalized_login::text ~ '[^a-z0-9_.-]' or p_pin is null
    or p_pin !~ '^[0-9]{4}$' then
    raise exception 'A login and a four-digit individual PIN are required'
      using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('roaming-credential-setup',0));
  perform pg_advisory_xact_lock(hashtextextended('employee-shift-open:'||p_employee_id,0));
  if exists (select 1 from public.employee_credentials c
             where c.login=normalized_login and c.employee_id<>p_employee_id)
    or exists (select 1 from private.roaming_staff_credentials c
                where c.login=normalized_login and c.employee_id<>p_employee_id) then
    raise exception 'Login already belongs to another employee' using errcode='23505';
  end if;
  password_digest := extensions.digest(p_pin,'sha256');
  if exists (select 1 from public.branches b where b.pos_pin::text=p_pin) then
    raise exception 'The individual PIN must differ from shared branch PINs'
      using errcode='23505';
  end if;
  if exists (select 1 from private.roaming_staff_credentials c
             where c.employee_id<>p_employee_id and c.is_active
               and c.pin_sha256=password_digest)
    or exists (select 1 from public.employee_credentials c
                where c.employee_id<>p_employee_id and c.is_active
                  and c.pin_sha256=password_digest) then
    raise exception 'PIN is already assigned to another active employee'
      using errcode='23505';
  end if;
  select c.id into strict credential_id from public.employee_credentials c
  where c.employee_id=p_employee_id for update;
  password_hash := extensions.crypt(p_pin,extensions.gen_salt('bf',10));
  insert into private.roaming_staff_credentials(
    employee_id,login,pin_hash,pin_sha256,is_active
  ) values (p_employee_id,normalized_login,password_hash,password_digest,p_is_active)
  on conflict(employee_id) do update set
    login=excluded.login,pin_hash=excluded.pin_hash,pin_sha256=excluded.pin_sha256,
    is_active=excluded.is_active,
    creds_version=private.roaming_staff_credentials.creds_version+1,updated_at=now();
  -- A legacy row remains for its stable directory ID. It is not an authority
  -- for roaming staff, and its random marker cannot reveal the individual PIN.
  marker := encode(extensions.gen_random_bytes(32),'hex');
  update public.employee_credentials set login=normalized_login,is_active=false,
    pin_plain=null,pin_hash=extensions.crypt(marker,extensions.gen_salt('bf',10)),
    pin_sha256=extensions.digest(marker,'sha256'),
    creds_version=creds_version+1,updated_at=now()
  where id=credential_id;
  update public.employees set login=normalized_login,pin=null,pin_hash=null,updated_at=now()
  where id=p_employee_id;
  update private.roaming_staff_access set can_work_all_branches=p_enable_roaming,
    updated_at=now() where employee_id=p_employee_id;
  update private.roaming_login_proofs set revoked_at=now()
  where employee_id=p_employee_id and revoked_at is null;
  return credential_id;
end;
$$;

create function public.configure_roaming_staff_credentials(
  p_employee_id bigint,p_login text,p_pin text,p_enable_roaming boolean default true
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
declare credential_id bigint;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception 'Server access required' using errcode='42501';
  end if;
  credential_id := private.set_roaming_staff_credentials(
    p_employee_id,p_login,p_pin,true,p_enable_roaming
  );
  return jsonb_build_object('ok',true,'employee_id',p_employee_id,
    'credential_id',credential_id,'can_work_all_branches',p_enable_roaming);
end;
$$;

create or replace view public.v_employee_logins as
select e.id as employee_id,e.full_name,e.branch_id,e.role::text as role,
  ec.id as cred_id,coalesce(rc.login,ec.login) as login,
  case when a.can_work_all_branches then coalesce(rc.is_active,false) else ec.is_active end as is_active,
  coalesce(rc.creds_version,ec.creds_version) as creds_version,
  coalesce(rc.updated_at,ec.updated_at) as updated_at,ec.created_at,
  coalesce(a.can_work_all_branches,false) as can_work_all_branches,
  case when coalesce(a.can_work_all_branches,false) then a.allowed_branch_ids
    when e.branch_id is null then '{}'::bigint[] else array[e.branch_id] end as allowed_branch_ids
from public.employees e
left join public.employee_credentials ec on ec.employee_id=e.id
left join private.roaming_staff_access a on a.employee_id=e.id
left join private.roaming_staff_credentials rc on rc.employee_id=e.id
order by e.id;

create or replace function public.open_employee_session_login_pin_v2(
  p_login text,p_pin text,p_terminal_code text,p_opened_at timestamptz default null,
  p_client_uuid uuid default null
) returns table(session_id bigint,error text)
language plpgsql security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare
  employee_row record;
  terminal_row record;
  active_row public.attendance_sessions%rowtype;
  is_roaming boolean;
  opened_at_value timestamptz;
begin
  session_id := null;
  error := null;
  select e.id,e.branch_id,e.role::text as role,
         coalesce(a.can_work_all_branches,false) as roaming
  into employee_row
  from public.employees e
  left join private.roaming_staff_access a on a.employee_id=e.id
  left join private.roaming_staff_credentials rc on rc.employee_id=e.id
  left join public.employee_credentials c on c.employee_id=e.id
  where coalesce(e.is_active,false) and (
    (coalesce(a.can_work_all_branches,false)
      and rc.login=lower(trim(p_login))::public.citext and rc.is_active
      and p_pin ~ '^[0-9]{4}$'
      and rc.pin_sha256=extensions.digest(p_pin,'sha256')
      and e.role::text=a.expected_role)
    or (not coalesce(a.can_work_all_branches,false)
      and lower(c.login::text)=lower(trim(p_login)) and c.is_active
      and (c.pin_sha256=extensions.digest(p_pin,'sha256')
        or (c.pin_hash ~ '^\$[12][a-z]?\$'
          and extensions.crypt(p_pin,c.pin_hash)=c.pin_hash)))
  ) limit 1;
  if not found then error:='wrong_pin'; return next; return; end if;
  is_roaming := employee_row.roaming;
  select t.id,t.branch_id into terminal_row from public.terminals t
  where (upper(replace(trim(t.code),'-',''))=upper(replace(trim(p_terminal_code),'-',''))
    or upper(replace(trim(t.terminal_code),'-',''))=upper(replace(trim(p_terminal_code),'-','')))
    and coalesce(t.is_active,true) and coalesce(t.is_enabled,true)
  order by t.id limit 1;
  if not found or terminal_row.branch_id is null then
    error:='terminal_not_found'; return next; return;
  end if;
  if is_roaming and (p_client_uuid is null
      or not private.staff_can_work_branch(employee_row.id,terminal_row.branch_id)) then
    error:=case when p_client_uuid is null then 'device_required' else 'branch_mismatch' end;
    return next; return;
  end if;
  -- Ordinary staff retain their existing terminal flow. A private capability
  -- never grants a different employee permission to use the roaming PIN path.
  perform pg_advisory_xact_lock(hashtextextended('employee-shift-open:'||employee_row.id,0));
  select * into active_row from public.attendance_sessions s
  where s.employee_id=employee_row.id and s.ended_at is null
  order by s.id desc limit 1 for update;
  if found then
    if is_roaming and active_row.started_at<now()-interval '18 hours' then
      error:='active_shift_expired'; return next; return;
    end if;
    if is_roaming and active_row.branch_id is distinct from terminal_row.branch_id then
      error:='active_shift_other_branch'; return next; return;
    end if;
    if is_roaming and active_row.terminal_id is distinct from terminal_row.id then
      error:='active_shift_other_terminal'; return next; return;
    end if;
    if not is_roaming then
      update public.attendance_sessions set
        terminal_id=coalesce(terminal_id,terminal_row.id),
        branch_id=coalesce(branch_id,terminal_row.branch_id)
      where id=active_row.id;
    end if;
    session_id:=active_row.id;
    error:='already_open';
  else
    opened_at_value:=case when is_roaming then now() else coalesce(p_opened_at,now()) end;
    if is_roaming then
      perform set_config('roaming.verified_employee_id',employee_row.id::text,true);
    end if;
    insert into public.attendance_sessions(
      employee_id,branch_id,terminal_id,opened_at,started_at,status
    ) values (
      employee_row.id,terminal_row.branch_id,terminal_row.id,
      opened_at_value,opened_at_value,'active'
    ) returning id into session_id;
  end if;
  if p_client_uuid is not null then
    insert into public.pos_session_capabilities(
      attendance_session_id,employee_id,branch_id,terminal_id,client_uuid_hash,refreshed_at
    ) select s.id,s.employee_id,s.branch_id,s.terminal_id,
             extensions.digest(p_client_uuid::text,'sha256'),now()
      from public.attendance_sessions s where s.id=session_id
    on conflict(attendance_session_id) do update set
      employee_id=excluded.employee_id,branch_id=excluded.branch_id,
      terminal_id=excluded.terminal_id,client_uuid_hash=excluded.client_uuid_hash,
      refreshed_at=excluded.refreshed_at;
  end if;
  perform public.ensure_penalties_today_from_views(session_id);
  return next;
end;
$$;

create function private.guard_roaming_session_branch()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
declare terminal_branch bigint;
begin
  if not exists (select 1 from private.roaming_staff_access a
                 where a.employee_id=new.employee_id and a.can_work_all_branches)
    and not (tg_op='UPDATE' and exists (
      select 1 from private.roaming_staff_access a
      where a.employee_id=old.employee_id and a.can_work_all_branches
    )) then
    return new;
  end if;
  if public._payroll_is_owner_strict_v5() then return new; end if;
  if tg_op='UPDATE' then
    if new.employee_id is distinct from old.employee_id
      or new.branch_id is distinct from old.branch_id
      or new.terminal_id is distinct from old.terminal_id
      or new.started_at is distinct from old.started_at
      or new.opened_at is distinct from old.opened_at then
      raise exception 'A roaming shift keeps its original employee, branch and terminal'
        using errcode='42501';
    end if;
    return new;
  end if;
  if nullif(current_setting('roaming.verified_employee_id',true),'')
       is distinct from new.employee_id::text then
    raise exception 'Individual roaming PIN verification is required' using errcode='42501';
  end if;
  select t.branch_id into terminal_branch from public.terminals t
  where t.id=new.terminal_id and coalesce(t.is_active,true) and coalesce(t.is_enabled,true);
  if terminal_branch is distinct from new.branch_id
    or not private.staff_can_work_branch(new.employee_id,new.branch_id) then
    raise exception 'The roaming shift must use its actual permitted terminal branch'
      using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger a_roaming_session_branch_guard
before insert or update of employee_id,branch_id,terminal_id,started_at,opened_at
on public.attendance_sessions for each row
execute function private.guard_roaming_session_branch();

create function public.fn_pos_open_by_branch(
  p_login text,p_pin text,p_terminal_id integer,p_client_uuid uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
declare
  employee_id_value bigint;
  terminal_row record;
  attendance_row record;
  previous_shift record;
  user_session uuid;
  actor_proof uuid;
  staff_role text;
begin
  if p_client_uuid is null then
    return jsonb_build_object('session_id',null,'error','device_required');
  end if;
  employee_id_value:=private.roaming_pin_employee(p_login,p_pin);
  if employee_id_value is null then
    return jsonb_build_object('session_id',null,'error','wrong_pin');
  end if;
  select t.id,t.branch_id,t.terminal_code into terminal_row
  from public.terminals t where t.id=p_terminal_id
    and t.kind='pos' and coalesce(t.is_active,true) and coalesce(t.is_enabled,true);
  if not found then
    return jsonb_build_object('session_id',null,'error','terminal_not_found');
  end if;
  if not private.staff_can_work_branch(employee_id_value,terminal_row.branch_id) then
    return jsonb_build_object('session_id',null,'error','branch_mismatch');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('employee-shift-open:'||employee_id_value,0));
  select * into attendance_row from public.open_employee_session_login_pin_v2(
    p_login,p_pin,terminal_row.terminal_code,now(),p_client_uuid
  );
  if attendance_row.error is not null and attendance_row.error<>'already_open' then
    select s.id,s.branch_id,s.terminal_id into previous_shift
    from public.attendance_sessions s
    where s.employee_id=employee_id_value and s.ended_at is null order by s.id desc limit 1;
    return jsonb_build_object('session_id',null,'error',attendance_row.error,
      'previous_session_id',previous_shift.id,'previous_branch_id',previous_shift.branch_id);
  end if;
  select s.id into user_session from public.user_sessions s
  where s.employee_id=employee_id_value and s.branch_id=terminal_row.branch_id
    and s.terminal_id=terminal_row.id and s.ended_at is null
    and not coalesce(s.force_logout,false) and s.started_at>=now()-interval '18 hours'
  order by s.started_at desc limit 1;
  if user_session is null then
    insert into public.user_sessions(
      employee_id,branch_id,terminal_id,device_id,started_at,last_active
    ) values (
      employee_id_value,terminal_row.branch_id,terminal_row.id,
      terminal_row.terminal_code,now(),now()
    ) returning id into user_session;
  end if;
  actor_proof:=gen_random_uuid();
  select a.expected_role into staff_role from private.roaming_staff_access a
  where a.employee_id=employee_id_value;
  insert into private.roaming_login_proofs(
    proof_hash,employee_id,attendance_session_id,user_session_id,
    branch_id,terminal_id,client_uuid_hash,expires_at
  ) values (
    extensions.digest(actor_proof::text,'sha256'),employee_id_value,
    attendance_row.session_id,user_session,terminal_row.branch_id,terminal_row.id,
    extensions.digest(p_client_uuid::text,'sha256'),now()+interval '18 hours'
  );
  return jsonb_build_object('session_id',user_session,'error',null,
    'employee_id',employee_id_value,'role',staff_role,'branch_id',terminal_row.branch_id,
    'terminal_id',terminal_row.id,'attendance_session_id',attendance_row.session_id,
    'can_work_all_branches',true,'actor_proof',actor_proof);
end;
$$;

create function public.open_roaming_employee_session(
  p_login text,p_pin text,p_terminal_code text,p_client_uuid uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
declare terminal_id_value integer;
begin
  select t.id into terminal_id_value from public.terminals t
  where (upper(replace(trim(t.code),'-',''))=upper(replace(trim(p_terminal_code),'-',''))
    or upper(replace(trim(t.terminal_code),'-',''))=upper(replace(trim(p_terminal_code),'-','')))
    and t.kind='pos' and coalesce(t.is_active,true) and coalesce(t.is_enabled,true)
  order by t.id limit 1;
  if terminal_id_value is null then
    return jsonb_build_object('session_id',null,'error','terminal_not_found');
  end if;
  return public.fn_pos_open_by_branch(p_login,p_pin,terminal_id_value,p_client_uuid);
end;
$$;

create function private.roaming_sales_actor(
  p_terminal_code text,p_employee_id bigint,p_client_uuid uuid,p_actor_proof uuid,
  p_lock boolean default false
) returns table(session_id bigint,employee_id bigint,branch_id bigint)
language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
declare actor_row record;
begin
  if p_actor_proof is null or p_client_uuid is null then
    raise exception 'A personal cashier proof is required' using errcode='42501';
  end if;
  if p_lock then
    perform pg_advisory_xact_lock(hashtextextended('employee-shift-open:'||p_employee_id,0));
  end if;
  select s.id as session_id,s.employee_id,s.branch_id into actor_row
  from private.roaming_login_proofs p
  join public.attendance_sessions s on s.id=p.attendance_session_id
  join public.user_sessions us on us.id=p.user_session_id
  join public.pos_session_capabilities c on c.attendance_session_id=s.id
  join public.terminals t on t.id=s.terminal_id
  join private.roaming_staff_access a on a.employee_id=s.employee_id
  where p.proof_hash=extensions.digest(p_actor_proof::text,'sha256')
    and p.employee_id=p_employee_id and s.employee_id=p_employee_id
    and a.expected_role='seller' and private.roaming_staff_enabled(s.employee_id)
    and p.revoked_at is null and p.expires_at>now()
    and p.client_uuid_hash=extensions.digest(p_client_uuid::text,'sha256')
    and c.client_uuid_hash=p.client_uuid_hash and c.employee_id=s.employee_id
    and c.branch_id=s.branch_id and c.terminal_id=s.terminal_id
    and p.branch_id=s.branch_id and p.terminal_id=s.terminal_id
    and us.employee_id=s.employee_id and us.branch_id=s.branch_id
    and us.terminal_id=s.terminal_id and us.ended_at is null
    and not coalesce(us.force_logout,false)
    and s.ended_at is null and s.started_at>=now()-interval '18 hours'
    and coalesce(s.status,'open') not in ('cancelled','demo')
    and coalesce(s.end_reason,'')<>'demo_cleanup'
    and t.branch_id=s.branch_id and coalesce(t.is_active,true) and coalesce(t.is_enabled,true)
    and (upper(replace(trim(t.code),'-',''))=upper(replace(trim(p_terminal_code),'-',''))
      or upper(replace(trim(t.terminal_code),'-',''))=upper(replace(trim(p_terminal_code),'-','')))
    and private.staff_can_work_branch(s.employee_id,s.branch_id)
  limit 1;
  if not found then
    raise exception 'The personal cashier proof is invalid or the shift has ended'
      using errcode='42501';
  end if;
  if p_lock then
    perform 1 from public.attendance_sessions s
    where s.id=actor_row.session_id and s.ended_at is null for update;
    if not found then
      raise exception 'The cashier shift has ended' using errcode='42501';
    end if;
  end if;
  return query select actor_row.session_id,actor_row.employee_id,actor_row.branch_id;
end;
$$;

create function public.get_active_sales_session_id(
  p_terminal_code text,p_preferred_employee_id bigint,p_client_uuid uuid,p_actor_proof uuid
) returns table(session_id bigint,employee_id bigint,branch_id bigint)
language sql stable security definer
set search_path=pg_catalog,public,private,pg_temp as $$
  select * from private.roaming_sales_actor(
    p_terminal_code,p_preferred_employee_id,p_client_uuid,p_actor_proof,false
  );
$$;

create function public.close_roaming_employee_session(
  p_login text,p_pin text,p_session_id bigint,p_client_uuid uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
declare employee_id_value bigint; previous_row public.attendance_sessions%rowtype;
begin
  employee_id_value:=private.roaming_pin_employee(p_login,p_pin);
  if employee_id_value is null or p_client_uuid is null then
    return jsonb_build_object('ok',false,'error','wrong_pin');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('employee-shift-open:'||employee_id_value,0));
  select * into previous_row from public.attendance_sessions s
  where s.id=p_session_id and s.employee_id=employee_id_value for update;
  if not found then
    return jsonb_build_object('ok',false,'error','session_not_found');
  end if;
  if previous_row.ended_at is null then
    -- Explicit user confirmation closes the real previous shift at the current
    -- server time. Its original branch/terminal and start timestamp are retained.
    update public.attendance_sessions set ended_at=now() at time zone 'UTC',
      status='completed',end_reason='roaming_explicit_close'
    where id=p_session_id and ended_at is null;
  end if;
  update private.roaming_login_proofs set revoked_at=now()
  where attendance_session_id=p_session_id and revoked_at is null;
  update public.user_sessions set ended_at=coalesce(ended_at,now()),force_logout=true
  where employee_id=employee_id_value and branch_id=previous_row.branch_id
    and terminal_id=previous_row.terminal_id and ended_at is null;
  return jsonb_build_object('ok',true,'session_id',p_session_id);
end;
$$;

-- A legacy table mutation cannot install a different PIN for a roaming account.
create function private.clear_public_roaming_pin()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
begin
  if exists (select 1 from private.roaming_staff_access a
             where a.employee_id=new.id and a.can_work_all_branches) then
    new.pin:=null;
    new.pin_hash:=null;
  end if;
  return new;
end;
$$;
create trigger clear_public_roaming_pin
before insert or update of pin,pin_hash on public.employees
for each row execute function private.clear_public_roaming_pin();

-- Keep each original function's implementation and existing ACL. Add the
-- verified-person requirement only to the explicitly enabled roaming accounts.
do $$
declare definition text; original_body text; updated_body text; expected_count integer;
begin
  select pg_get_functiondef(p.oid),p.prosrc into definition,original_body
  from pg_proc p where p.oid='public.fn_pos_open_by_branch(text,text,integer)'::regprocedure;
  updated_body:=replace(original_body,'BEGIN', $guard$BEGIN
  IF EXISTS (
    SELECT 1 FROM private.roaming_staff_credentials rc
    JOIN private.roaming_staff_access a ON a.employee_id=rc.employee_id
    WHERE rc.login=lower(trim(p_login))::public.citext AND a.can_work_all_branches
  ) THEN
    RETURN jsonb_build_object('session_id',null,'error','device_required');
  END IF;
$guard$);
  if updated_body=original_body then raise exception 'Legacy POS login shape changed'; end if;
  execute replace(definition,original_body,updated_body);

  select pg_get_functiondef(p.oid),p.prosrc into definition,original_body
  from pg_proc p where p.oid='public._refocus_authorize_order_action(bigint,text,uuid)'::regprocedure;
  updated_body:=replace(original_body,'AND e.branch_id = v_order_branch',
    'AND private.staff_can_work_branch(e.id,v_order_branch)');
  if updated_body=original_body then raise exception 'Order action branch guard changed'; end if;
  execute replace(definition,original_body,updated_body);

  select pg_get_functiondef(p.oid),p.prosrc into definition,original_body
  from pg_proc p where p.oid='public.pos_create_order_atomic(jsonb,jsonb,jsonb)'::regprocedure;
  updated_body:=replace(original_body,'  INSERT INTO public.orders (',$guard$
  IF v_session_id IS NULL AND NULLIF(p_order->>'actor_proof','') IS NOT NULL THEN
    SELECT proof.attendance_session_id INTO v_session_id
    FROM private.roaming_login_proofs proof
    WHERE proof.proof_hash=extensions.digest((p_order->>'actor_proof')::uuid::text,'sha256');
    IF v_session_id IS NULL THEN
      RAISE EXCEPTION 'A valid personal cashier proof is required' USING ERRCODE='42501';
    END IF;
  ELSIF v_session_id IS NULL THEN
    SELECT candidate.session_id INTO v_session_id
    FROM public._order_seller_candidates(
      (p_order->>'branch_id')::bigint,statement_timestamp(),NULL,NULL
    ) candidate
    WHERE NOT EXISTS (
      SELECT 1 FROM private.roaming_staff_access a
      WHERE a.employee_id=candidate.employee_id AND a.can_work_all_branches
    )
    ORDER BY candidate.started_at,candidate.session_id LIMIT 1;
    IF v_session_id IS NULL THEN
      RAISE EXCEPTION 'An authorized seller shift and personal cashier login are required'
        USING ERRCODE='42501';
    END IF;
  END IF;
  IF v_session_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.attendance_sessions s
    JOIN private.roaming_staff_access a ON a.employee_id=s.employee_id
    WHERE s.id=v_session_id AND a.can_work_all_branches
  ) THEN
    DECLARE verified_actor record; terminal_code_value text; actor_employee_id bigint;
    BEGIN
      SELECT s.employee_id,t.terminal_code INTO actor_employee_id,terminal_code_value
      FROM public.attendance_sessions s JOIN public.terminals t ON t.id=s.terminal_id
      WHERE s.id=v_session_id;
      SELECT * INTO verified_actor FROM private.roaming_sales_actor(
        terminal_code_value,actor_employee_id,
        NULLIF(p_order->>'client_uuid','')::uuid,
        NULLIF(p_order->>'actor_proof','')::uuid,true
      );
      IF verified_actor.session_id IS DISTINCT FROM v_session_id
        OR verified_actor.branch_id IS DISTINCT FROM (p_order->>'branch_id')::bigint THEN
        RAISE EXCEPTION 'The order must use the verified cashier and actual branch'
          USING ERRCODE='42501';
      END IF;
    END;
  END IF;
  INSERT INTO public.orders (
$guard$);
  if updated_body=original_body then raise exception 'Atomic order insert shape changed'; end if;
  execute replace(definition,original_body,updated_body);

  select pg_get_functiondef(p.oid),p.prosrc into definition,original_body
  from pg_proc p where p.oid='public.get_active_sales_session_id(text)'::regprocedure;
  updated_body:=replace(original_body,E'  ) c\n  ORDER BY',$guard$  ) c
  WHERE NOT EXISTS (
    SELECT 1 FROM private.roaming_staff_access a
    WHERE a.employee_id=c.employee_id AND a.can_work_all_branches
  )
  ORDER BY$guard$);
  if updated_body=original_body then raise exception 'Primary seller lookup shape changed'; end if;
  execute replace(definition,original_body,updated_body);
end;
$$;

-- Owner-facing credential tools delegate roaming resets to the private
-- authority. Ordinary employee behavior remains inside the original functions.
do $$
declare definition text; original_body text; updated_body text;
begin
  select pg_get_functiondef(p.oid),p.prosrc into definition,original_body
  from pg_proc p where p.oid='public.set_employee_login_pin(bigint,text,text,boolean)'::regprocedure;
  updated_body:=replace(original_body,E'begin\r\n',$guard$begin
  PERFORM public._refocus_require_owner();
  IF EXISTS (SELECT 1 FROM private.roaming_staff_access a
             WHERE a.employee_id=p_employee_id AND a.can_work_all_branches) THEN
    PERFORM private.set_roaming_staff_credentials(p_employee_id,p_login,p_pin_plain,p_is_active,true);
    RETURN QUERY SELECT ec.id,ec.employee_id,rc.login::text,rc.is_active,rc.updated_at
    FROM public.employee_credentials ec
    JOIN private.roaming_staff_credentials rc ON rc.employee_id=ec.employee_id
    WHERE ec.employee_id=p_employee_id;
    RETURN;
  END IF;
$guard$);
  if updated_body=original_body then raise exception 'Credential setter shape changed'; end if;
  execute replace(definition,original_body,updated_body);

  select pg_get_functiondef(p.oid),p.prosrc into definition,original_body
  from pg_proc p where p.oid='public.app_set_employee_login_pin(bigint,text,text)'::regprocedure;
  updated_body:=replace(original_body,E'begin\r\n',$guard$begin
  PERFORM public._refocus_require_owner();
  IF EXISTS (SELECT 1 FROM private.roaming_staff_access a
             WHERE a.employee_id=p_employee_id AND a.can_work_all_branches) THEN
    PERFORM private.set_roaming_staff_credentials(p_employee_id,p_login,p_pin,true,true);
    RETURN jsonb_build_object('ok',true);
  END IF;
$guard$);
  if updated_body=original_body then raise exception 'Legacy credential setter shape changed'; end if;
  execute replace(definition,original_body,updated_body);
end;
$$;
create or replace function public.app_set_employee_pin(p_login text,p_pin text)
returns void language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
declare employee_id_value bigint; credential_active boolean;
begin
  perform public._refocus_require_owner();
  select c.employee_id,c.is_active into employee_id_value,credential_active
  from private.roaming_staff_credentials c
  join private.roaming_staff_access a on a.employee_id=c.employee_id
  where c.login=lower(trim(p_login))::public.citext and a.can_work_all_branches;
  if found then
    perform private.set_roaming_staff_credentials(employee_id_value,p_login,p_pin,credential_active,true);
  else
    update public.employees set pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',10))
    where login=p_login;
  end if;
end;
$$;

create or replace function public.set_employee_login_active(p_employee_id bigint,p_active boolean)
returns public.employee_credentials language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
declare result public.employee_credentials%rowtype;
begin
  perform public._refocus_require_owner();
  if exists (select 1 from private.roaming_staff_access a
             where a.employee_id=p_employee_id and a.can_work_all_branches) then
    update private.roaming_staff_credentials set is_active=p_active,
      creds_version=creds_version+1,updated_at=now() where employee_id=p_employee_id;
    update private.roaming_login_proofs set revoked_at=now()
    where employee_id=p_employee_id and revoked_at is null;
    select * into result from public.employee_credentials where employee_id=p_employee_id;
    result.is_active:=p_active;
    return result;
  end if;
  update public.employee_credentials set is_active=p_active,creds_version=creds_version+1
  where employee_id=p_employee_id returning * into result;
  return result;
end;
$$;

create or replace function public.app_remove_employee_login(p_employee_id bigint)
returns void language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
begin
  perform public._refocus_require_owner();
  if exists (select 1 from private.roaming_staff_access a
             where a.employee_id=p_employee_id and a.can_work_all_branches) then
    update private.roaming_staff_credentials set is_active=false,
      creds_version=creds_version+1,updated_at=now() where employee_id=p_employee_id;
    update private.roaming_login_proofs set revoked_at=now()
    where employee_id=p_employee_id and revoked_at is null;
    update public.employee_credentials set is_active=false,pin_plain=null,
      creds_version=creds_version+1,updated_at=now() where employee_id=p_employee_id;
  else
    delete from public.employee_credentials where employee_id=p_employee_id;
  end if;
  update public.employees set login=null,pin=null,pin_hash=null,updated_at=now()
  where id=p_employee_id;
end;
$$;

create function public.admin_roaming_staff()
returns table(employee_id bigint,full_name text,role text,login text,enabled boolean,
  allowed_branch_ids bigint[],creds_version integer)
language plpgsql stable security definer
set search_path=pg_catalog,public,private,pg_temp as $$
begin
  perform public._refocus_require_owner();
  return query select a.employee_id,e.full_name,a.expected_role,rc.login::text,
    private.roaming_staff_enabled(a.employee_id),a.allowed_branch_ids,rc.creds_version
  from private.roaming_staff_access a
  join public.employees e on e.id=a.employee_id
  left join private.roaming_staff_credentials rc on rc.employee_id=a.employee_id
  order by a.employee_id;
end;
$$;

-- The directory continues to expose aliases/active state, not private PIN data.
-- Raw credential tables and the existing administrative projections are owner-only.
revoke select on public.employee_credentials from anon,authenticated;
create or replace view public.v_employee_credentials_admin as
select ec.id as cred_id,e.id as employee_id,e.full_name,e.branch_id,b.name as branch_name,
  coalesce(rc.login,ec.login)::text as login,coalesce(rc.is_active,ec.is_active) as is_active,
  coalesce(rc.updated_at,ec.updated_at) as updated_at,
  case when rc.employee_id is not null then null::text else ec.pin_sha256::text end as pin_sha256,
  case when rc.employee_id is not null then null::text else ec.pin_plain end as pin_plain
from public.employee_credentials ec
join public.employees e on e.id=ec.employee_id
left join public.branches b on b.id=e.branch_id
left join private.roaming_staff_credentials rc on rc.employee_id=e.id
where public._payroll_is_owner_strict_v5();
create or replace function public.admin_list_employee_credentials()
returns table(cred_id bigint,employee_id bigint,full_name text,branch_id integer,
  branch_name text,login text,is_active boolean,updated_at timestamptz,pin_sha256 text)
language plpgsql stable security definer
set search_path=pg_catalog,public,private,pg_temp as $$
begin
  perform public._refocus_require_owner();
  return query select v.cred_id,v.employee_id,v.full_name,v.branch_id::integer,
    v.branch_name,v.login,v.is_active,v.updated_at,v.pin_sha256
  from public.v_employee_credentials_admin v;
end;
$$;

-- Keep non-roaming and single-branch calculations byte-for-byte in base_rows.
-- Only roaming multi-branch days allocate the daily cap and tax once.
do $$ begin
  if (select md5(prosrc) from pg_proc where oid='public.payroll_daily_canonical(date,date,bigint,bigint)'::regprocedure)<>'b08f0810ca2c68d6a4bbf13d77c75f46' then
    raise exception 'The canonical payroll definition changed during preparation';
  end if;
end $$;
CREATE OR REPLACE FUNCTION public.payroll_daily_canonical(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_branch_id bigint DEFAULT NULL::bigint, p_employee_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(employee_id bigint, full_name text, branch_id bigint, day date, hours numeric, hourly_rate numeric, hour_pay numeric, paid_sum numeric, bonus_percent numeric, bonus numeric, penalties numeric, social_fund_day numeric, income_tax_day numeric, net_day numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH roaming_staff AS (
  SELECT employee_id FROM private.roaming_staff_access
),
emp AS (
  SELECT
    e.id::bigint AS employee_id,
    e.full_name,
    e.branch_id::bigint AS branch_id,
    e.role::text AS role,
    COALESCE(pp.hourly_rate,   e.hourly_rate,         0)::numeric AS hourly_rate,
    COALESCE(pp.has_bonus,     e.has_bonus,       false)           AS has_bonus,
    COALESCE(pp.bonus_percent, e.bonus_percent::numeric, 0)::numeric AS bonus_percent,
    pp.bonus_per_order::numeric AS bonus_per_order,
    COALESCE(pp.max_paid_hours, 5)::numeric AS max_paid_hours
  FROM public.employees e
  LEFT JOIN public.employee_payroll_profiles pp
    ON pp.employee_id = e.id
   AND COALESCE(pp.active, true) = true
  WHERE COALESCE(e.is_active, true) = true
    AND (p_branch_id IS NULL OR e.branch_id=p_branch_id OR e.role='master'
         OR e.id IN (SELECT employee_id FROM roaming_staff))
    AND (p_employee_id IS NULL OR e.id        = p_employee_id)
),
session_day AS (
  SELECT
    s.employee_id::bigint AS employee_id,
    s.branch_id::bigint   AS branch_id,
    (COALESCE((s.ended_at AT TIME ZONE 'UTC'), s.opened_at, s.started_at)
       AT TIME ZONE 'Asia/Bishkek')::date AS day,
    SUM(
      GREATEST(0, LEAST(
        EXTRACT(epoch FROM (COALESCE((s.ended_at AT TIME ZONE 'UTC'), now()) - s.started_at)) / 3600.0,
        16
      ))
    )::numeric AS hours
  FROM public.attendance_sessions s
  WHERE COALESCE(s.end_reason, '') <> 'demo_cleanup'
    AND COALESCE(s.status, 'open') NOT IN ('cancelled', 'demo')
    AND s.employee_id NOT IN (SELECT id FROM public.employees WHERE role = 'master')
    AND (p_branch_id IS NULL OR s.branch_id=p_branch_id
         OR s.employee_id IN (SELECT employee_id FROM roaming_staff))
    AND (p_employee_id IS NULL OR s.employee_id = p_employee_id)
    AND (p_from IS NULL
         OR (COALESCE((s.ended_at AT TIME ZONE 'UTC'), s.opened_at, s.started_at)
              AT TIME ZONE 'Asia/Bishkek')::date >= p_from)
    AND (p_to IS NULL
         OR (COALESCE((s.ended_at AT TIME ZONE 'UTC'), s.opened_at, s.started_at)
              AT TIME ZONE 'Asia/Bishkek')::date <= p_to)
  GROUP BY 1, 2, 3
),
promoter_orders AS (
  SELECT
    s.employee_id::bigint AS employee_id,
    s.branch_id::bigint   AS branch_id,
    (COALESCE((s.ended_at AT TIME ZONE 'UTC'), s.opened_at, s.started_at)
       AT TIME ZONE 'Asia/Bishkek')::date AS day,
    COUNT(DISTINCT o.id)::numeric AS order_count
  FROM public.attendance_sessions s
  JOIN public.employees pe
    ON pe.id = s.employee_id AND pe.role = 'promoter'
  JOIN public.orders o
    ON o.branch_id = s.branch_id
   AND o.is_deleted IS DISTINCT FROM TRUE
   AND o.created_at >= (s.started_at AT TIME ZONE 'UTC')
   AND o.created_at <  COALESCE(s.ended_at, (now() AT TIME ZONE 'UTC'))
  WHERE COALESCE(s.end_reason, '') <> 'demo_cleanup'
    AND COALESCE(s.status, 'open') NOT IN ('cancelled', 'demo')
    AND (p_branch_id IS NULL OR s.branch_id=p_branch_id
         OR s.employee_id IN (SELECT employee_id FROM roaming_staff))
    AND (p_employee_id IS NULL OR s.employee_id = p_employee_id)
    AND (p_from IS NULL
         OR (COALESCE((s.ended_at AT TIME ZONE 'UTC'), s.opened_at, s.started_at)
              AT TIME ZONE 'Asia/Bishkek')::date >= p_from)
    AND (p_to IS NULL
         OR (COALESCE((s.ended_at AT TIME ZONE 'UTC'), s.opened_at, s.started_at)
              AT TIME ZONE 'Asia/Bishkek')::date <= p_to)
  GROUP BY 1, 2, 3
),
payment_day AS (
  SELECT
    o.seller_employee_id::bigint AS employee_id,
    o.branch_id::bigint          AS branch_id,
    (COALESCE(p.created_at, (p.paid_at AT TIME ZONE 'UTC'))
       AT TIME ZONE 'Asia/Bishkek')::date AS day,
    SUM(p.amount)::numeric AS paid_sum
  FROM public.payments p
  JOIN public.orders   o ON o.id = p.order_id
  WHERE o.is_deleted IS DISTINCT FROM TRUE
    AND o.seller_employee_id IS NOT NULL
    AND (COALESCE(p.created_at, (p.paid_at AT TIME ZONE 'UTC'))
           AT TIME ZONE 'Asia/Bishkek')::date < DATE '2026-04-18'
    AND (p_branch_id IS NULL OR o.branch_id=p_branch_id
         OR o.seller_employee_id IN (SELECT employee_id FROM roaming_staff))
    AND (p_employee_id IS NULL OR o.seller_employee_id   = p_employee_id)
    AND (p_from IS NULL
         OR (COALESCE(p.created_at, (p.paid_at AT TIME ZONE 'UTC'))
              AT TIME ZONE 'Asia/Bishkek')::date >= p_from)
    AND (p_to IS NULL
         OR (COALESCE(p.created_at, (p.paid_at AT TIME ZONE 'UTC'))
              AT TIME ZONE 'Asia/Bishkek')::date <= p_to)
  GROUP BY 1, 2, 3

  UNION ALL

  SELECT
    sess.employee_id::bigint AS employee_id,
    sess.branch_id::bigint   AS branch_id,
    (pay.paid_local)::date   AS day,
    SUM(pay.amount)::numeric AS paid_sum
  FROM public.v_paid_sales_per_payment pay
  JOIN public.attendance_sessions sess
    ON sess.branch_id = pay.branch_id
   AND pay.paid_local >= (sess.started_at AT TIME ZONE 'Asia/Bishkek')
   AND pay.paid_local <  COALESCE(
         (sess.ended_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bishkek',
         (now() AT TIME ZONE 'Asia/Bishkek')
       )
  WHERE (pay.paid_local)::date >= DATE '2026-04-18'
    AND sess.employee_id IS NOT NULL
    AND sess.branch_id   IS NOT NULL
    AND sess.employee_id NOT IN (SELECT id FROM public.employees WHERE role = 'master')
    AND COALESCE(sess.end_reason, '') <> 'demo_cleanup'
    AND COALESCE(sess.status, 'open') NOT IN ('cancelled', 'demo')
    AND (p_branch_id IS NULL OR sess.branch_id=p_branch_id
         OR sess.employee_id IN (SELECT employee_id FROM roaming_staff))
    AND (p_employee_id IS NULL OR sess.employee_id = p_employee_id)
    AND (p_from IS NULL OR (pay.paid_local)::date >= p_from)
    AND (p_to   IS NULL OR (pay.paid_local)::date <= p_to)
  GROUP BY 1, 2, 3
),
payment_day_agg AS (
  SELECT employee_id, branch_id, day, SUM(paid_sum)::numeric AS paid_sum
  FROM payment_day
  GROUP BY employee_id, branch_id, day
),
penalty_day AS (
  SELECT
    s.employee_id::bigint AS employee_id,
    s.branch_id::bigint   AS branch_id,
    (COALESCE((s.ended_at AT TIME ZONE 'UTC'), s.opened_at, s.started_at)
       AT TIME ZONE 'Asia/Bishkek')::date AS day,
    SUM(sp.amount)::numeric AS penalties
  FROM public.attendance_session_penalties sp
  JOIN public.attendance_sessions s ON s.id = sp.session_id
  WHERE COALESCE(sp.cancelled, sp.is_cancelled, false) = false
    AND s.employee_id NOT IN (SELECT id FROM public.employees WHERE role = 'master')
    AND COALESCE(s.end_reason, '') <> 'demo_cleanup'
    AND COALESCE(s.status, 'open') NOT IN ('cancelled', 'demo')
    AND (p_branch_id IS NULL OR s.branch_id=p_branch_id
         OR s.employee_id IN (SELECT employee_id FROM roaming_staff))
    AND (p_employee_id IS NULL OR s.employee_id = p_employee_id)
    AND (p_from IS NULL
         OR (COALESCE((s.ended_at AT TIME ZONE 'UTC'), s.opened_at, s.started_at)
              AT TIME ZONE 'Asia/Bishkek')::date >= p_from)
    AND (p_to IS NULL
         OR (COALESCE((s.ended_at AT TIME ZONE 'UTC'), s.opened_at, s.started_at)
              AT TIME ZONE 'Asia/Bishkek')::date <= p_to)
  GROUP BY 1, 2, 3
),
master_day AS (
  SELECT
    mso.employee_id::bigint AS employee_id,
    me.branch_id::bigint    AS branch_id,
    mso.work_date           AS day,
    SUM(mso.pairs_made)::numeric AS pairs
  FROM public.master_shift_output mso
  JOIN public.employees me ON me.id = mso.employee_id AND me.role = 'master'
  WHERE (p_branch_id   IS NULL OR me.branch_id    = p_branch_id)
    AND (p_employee_id IS NULL OR mso.employee_id = p_employee_id)
    AND (p_from IS NULL OR mso.work_date >= p_from)
    AND (p_to   IS NULL OR mso.work_date <= p_to)
  GROUP BY 1, 2, 3
),
all_days AS (
  SELECT employee_id, branch_id, day FROM session_day
  UNION
  SELECT employee_id, branch_id, day FROM payment_day_agg
  UNION
  SELECT employee_id, branch_id, day FROM penalty_day
  UNION
  SELECT employee_id, branch_id, day FROM master_day
),
cfg AS (
  SELECT
    COALESCE(social_fund_monthly, 0)::numeric AS social_fund_monthly,
    COALESCE(income_tax_monthly,  0)::numeric AS income_tax_monthly,
    COALESCE(master_piece_rate, 150)::numeric AS master_piece_rate
  FROM public.payroll_config
  ORDER BY id
  LIMIT 1
)
, base_rows AS (
SELECT
  e.employee_id,
  e.full_name,
  d.branch_id,
  d.day,
  CASE
    WHEN e.role = 'master' THEN 0::numeric
    WHEN e.role = 'promoter' AND d.day >= DATE '2026-06-21'
      THEN ROUND(LEAST(COALESCE(s.hours, 0), e.max_paid_hours), 3)
    ELSE ROUND(COALESCE(s.hours, 0), 3)
  END AS hours,
  e.hourly_rate,
  CASE
    WHEN e.role = 'master' THEN 0::numeric
    WHEN e.role = 'promoter' AND d.day >= DATE '2026-06-21'
      THEN ROUND(LEAST(COALESCE(s.hours, 0), e.max_paid_hours) * e.hourly_rate, 2)
    ELSE ROUND(COALESCE(s.hours, 0) * e.hourly_rate, 2)
  END AS hour_pay,
  CASE WHEN e.role = 'master' THEN 0::numeric ELSE ROUND(COALESCE(p.paid_sum, 0), 2) END AS paid_sum,
  e.bonus_percent,
  CASE
    WHEN e.role = 'master' THEN 0::numeric
    WHEN e.role = 'promoter' AND d.day >= DATE '2026-06-21' AND e.bonus_per_order IS NOT NULL
      THEN ROUND(COALESCE(po.order_count, 0) * e.bonus_per_order, 2)
    ELSE ROUND(
      CASE WHEN e.has_bonus THEN COALESCE(p.paid_sum, 0) * e.bonus_percent / 100.0 ELSE 0 END
    , 2)
  END AS bonus,
  CASE
    WHEN e.role IN ('promoter','master') THEN 0::numeric
    ELSE ROUND(COALESCE(pe.penalties, 0), 2)
  END AS penalties,
  CASE
    WHEN e.role IN ('promoter','master') THEN 0::numeric
    ELSE ROUND(
      (SELECT social_fund_monthly FROM cfg)
      / EXTRACT(day FROM (date_trunc('month', d.day::timestamp) + INTERVAL '1 month - 1 day'))
    , 2)
  END AS social_fund_day,
  CASE
    WHEN e.role IN ('promoter','master') THEN 0::numeric
    ELSE ROUND(
      (SELECT income_tax_monthly FROM cfg)
      / EXTRACT(day FROM (date_trunc('month', d.day::timestamp) + INTERVAL '1 month - 1 day'))
    , 2)
  END AS income_tax_day,
  CASE
    WHEN e.role = 'master' THEN
      ROUND(COALESCE(md.pairs, 0) * (SELECT master_piece_rate FROM cfg), 2)
    WHEN e.role = 'promoter' THEN
      ROUND(
          (CASE WHEN d.day >= DATE '2026-06-21'
                THEN LEAST(COALESCE(s.hours, 0), e.max_paid_hours)
                ELSE COALESCE(s.hours, 0) END) * e.hourly_rate
        + (CASE
             WHEN d.day >= DATE '2026-06-21' AND e.bonus_per_order IS NOT NULL
               THEN COALESCE(po.order_count, 0) * e.bonus_per_order
             WHEN e.has_bonus
               THEN COALESCE(p.paid_sum, 0) * e.bonus_percent / 100.0
             ELSE 0 END)
      , 2)
    ELSE
      ROUND(
          COALESCE(s.hours, 0) * e.hourly_rate
        + CASE WHEN e.has_bonus THEN COALESCE(p.paid_sum, 0) * e.bonus_percent / 100.0 ELSE 0 END
        - COALESCE(pe.penalties, 0)
        - ((SELECT social_fund_monthly FROM cfg)
           / EXTRACT(day FROM (date_trunc('month', d.day::timestamp) + INTERVAL '1 month - 1 day')))
        - ((SELECT income_tax_monthly FROM cfg)
           / EXTRACT(day FROM (date_trunc('month', d.day::timestamp) + INTERVAL '1 month - 1 day')))
      , 2)
  END AS net_day
FROM all_days d
JOIN emp e
  ON e.employee_id = d.employee_id
 AND (e.branch_id=d.branch_id OR e.role='master'
      OR e.employee_id IN (SELECT employee_id FROM roaming_staff))
LEFT JOIN session_day s
  ON s.employee_id = d.employee_id AND s.branch_id = d.branch_id AND s.day = d.day
LEFT JOIN promoter_orders po
  ON po.employee_id = d.employee_id AND po.branch_id = d.branch_id AND po.day = d.day
LEFT JOIN payment_day_agg p
  ON p.employee_id = d.employee_id AND p.branch_id = d.branch_id AND p.day = d.day
LEFT JOIN penalty_day pe
  ON pe.employee_id = d.employee_id AND pe.branch_id = d.branch_id AND pe.day = d.day
LEFT JOIN master_day md
  ON md.employee_id = d.employee_id AND md.branch_id = d.branch_id AND md.day = d.day
), roaming_values AS (
  SELECT b.*, e.role AS staff_role, e.max_paid_hours,
    COALESCE(s.hours,0)::numeric AS raw_hours,
    SUM(COALESCE(s.hours,0)) OVER staff_day AS total_hours,
    COUNT(*) OVER staff_day AS branch_count,
    ROW_NUMBER() OVER (PARTITION BY b.employee_id,b.day ORDER BY b.branch_id) AS branch_rank,
    ROUND((SELECT social_fund_monthly FROM cfg)
      / EXTRACT(day FROM date_trunc('month',b.day::timestamp)+interval '1 month - 1 day'),2) AS daily_social_fund,
    ROUND((SELECT income_tax_monthly FROM cfg)
      / EXTRACT(day FROM date_trunc('month',b.day::timestamp)+interval '1 month - 1 day'),2) AS daily_income_tax
  FROM base_rows b
  JOIN roaming_staff r ON r.employee_id=b.employee_id
  JOIN emp e ON e.employee_id=b.employee_id
  LEFT JOIN session_day s ON s.employee_id=b.employee_id
    AND s.branch_id=b.branch_id AND s.day=b.day
  WINDOW staff_day AS (PARTITION BY b.employee_id,b.day)
), roaming_shares AS (
  SELECT r.*,
    CASE WHEN staff_role='promoter' AND day>=date '2026-06-21'
      THEN LEAST(total_hours,max_paid_hours) ELSE total_hours END AS paid_day_hours,
    CASE WHEN staff_role='promoter' AND day>=date '2026-06-21'
      THEN CASE WHEN total_hours>0
        THEN raw_hours*LEAST(1::numeric,max_paid_hours/total_hours) ELSE 0 END
      ELSE raw_hours END AS paid_branch_hours,
    CASE WHEN total_hours>0 THEN raw_hours/total_hours
      ELSE 1::numeric/branch_count END AS branch_weight
  FROM roaming_values r
), roaming_rounded AS (
  SELECT r.*, ROUND(paid_branch_hours,3) AS hours_part,
    ROUND(paid_branch_hours*hourly_rate,2) AS hour_pay_part,
    CASE WHEN staff_role IN ('promoter','master') THEN 0::numeric
      ELSE ROUND(daily_social_fund*branch_weight,2) END AS social_fund_part,
    CASE WHEN staff_role IN ('promoter','master') THEN 0::numeric
      ELSE ROUND(daily_income_tax*branch_weight,2) END AS income_tax_part
  FROM roaming_shares r
), roaming_corrected AS (
  SELECT r.*,
    CASE WHEN branch_rank=branch_count THEN ROUND(paid_day_hours,3)
      -COALESCE(SUM(hours_part) OVER preceding_branches,0)
      ELSE hours_part END AS corrected_hours,
    CASE WHEN branch_rank=branch_count THEN ROUND(paid_day_hours*hourly_rate,2)
      -COALESCE(SUM(hour_pay_part) OVER preceding_branches,0)
      ELSE hour_pay_part END AS corrected_hour_pay,
    CASE WHEN staff_role IN ('promoter','master') THEN 0::numeric
      WHEN branch_rank=branch_count THEN daily_social_fund
        -COALESCE(SUM(social_fund_part) OVER preceding_branches,0)
      ELSE social_fund_part END AS corrected_social_fund,
    CASE WHEN staff_role IN ('promoter','master') THEN 0::numeric
      WHEN branch_rank=branch_count THEN daily_income_tax
        -COALESCE(SUM(income_tax_part) OVER preceding_branches,0)
      ELSE income_tax_part END AS corrected_income_tax
  FROM roaming_rounded r
  WINDOW preceding_branches AS (
    PARTITION BY employee_id,day ORDER BY branch_id
    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
  )
)
SELECT b.employee_id,b.full_name,b.branch_id,b.day,
  CASE WHEN r.branch_count>1 THEN r.corrected_hours ELSE b.hours END AS hours,
  b.hourly_rate,
  CASE WHEN r.branch_count>1 THEN r.corrected_hour_pay ELSE b.hour_pay END AS hour_pay,
  b.paid_sum,b.bonus_percent,b.bonus,b.penalties,
  CASE WHEN r.branch_count>1 THEN r.corrected_social_fund ELSE b.social_fund_day END AS social_fund_day,
  CASE WHEN r.branch_count>1 THEN r.corrected_income_tax ELSE b.income_tax_day END AS income_tax_day,
  CASE WHEN r.branch_count>1 THEN ROUND(r.corrected_hour_pay+b.bonus-b.penalties
    -r.corrected_social_fund-r.corrected_income_tax,2) ELSE b.net_day END AS net_day
FROM base_rows b
LEFT JOIN roaming_corrected r ON r.employee_id=b.employee_id
  AND r.branch_id=b.branch_id AND r.day=b.day
WHERE p_branch_id IS NULL OR b.branch_id=p_branch_id
ORDER BY b.day,b.employee_id,b.branch_id;
$function$;


do $$
declare definition text; patched text;
begin
  select pg_get_viewdef('public.v_payroll_daily_fixed'::regclass,true) into definition;
  patched:=replace(definition,'p.employee_id = d.employee_id','p.employee_id = d.employee_id AND p.branch_id = d.branch_id');
  if patched=definition then raise exception 'Payroll today join shape changed'; end if;
  execute 'create or replace view public.v_payroll_daily_fixed as '||patched;
end;
$$;

-- All newly introduced private functions are internal owner-context helpers.
-- Their containing schema is closed and they have no client EXECUTE grants.
do $$
declare fn record; role_list text;
begin
  select string_agg(format('%I',rolname),', ') into role_list
  from pg_roles where rolname<>'postgres';
  for fn in select p.oid::regprocedure::text as identity
    from pg_proc p where p.pronamespace='private'::regnamespace and p.proname in (
      'roaming_staff_enabled','staff_can_work_branch','roaming_pin_employee',
      'set_roaming_staff_credentials','guard_roaming_session_branch',
      'roaming_sales_actor','clear_public_roaming_pin'
    )
  loop
    execute format('revoke all on function %s from public, %s',fn.identity,role_list);
  end loop;
end;
$$;
revoke all on function public.configure_roaming_staff_credentials(bigint,text,text,boolean)
  from public,anon,authenticated,crm_manager;
grant execute on function public.configure_roaming_staff_credentials(bigint,text,text,boolean)
  to service_role;
revoke all on function public.admin_roaming_staff() from public,anon,crm_manager;
grant execute on function public.admin_roaming_staff() to authenticated,service_role;
revoke all on function public.fn_pos_open_by_branch(text,text,integer,uuid),
  public.open_roaming_employee_session(text,text,text,uuid),
  public.get_active_sales_session_id(text,bigint,uuid,uuid),
  public.close_roaming_employee_session(text,text,bigint,uuid)
  from public,crm_manager;
grant execute on function public.fn_pos_open_by_branch(text,text,integer,uuid),
  public.open_roaming_employee_session(text,text,text,uuid),
  public.get_active_sales_session_id(text,bigint,uuid,uuid),
  public.close_roaming_employee_session(text,text,bigint,uuid)
  to anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
