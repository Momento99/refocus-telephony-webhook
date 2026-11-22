begin;

create function private.set_enrolled_roaming_credentials(
  p_employee_id bigint,
  p_login text,
  p_pin text,
  p_is_active boolean
) returns bigint
language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  marker text;
begin
  perform public._refocus_require_owner();
  perform pg_advisory_xact_lock(hashtextextended('roaming-credential-setup', 0));
  perform pg_advisory_xact_lock(hashtextextended('employee-shift-open:' || p_employee_id, 0));

  if exists (select 1 from private.roaming_staff_access a
      where a.employee_id = p_employee_id and a.expected_role = 'promoter' and not a.can_work_all_branches)
    and exists (select 1 from public.attendance_sessions s
      where s.employee_id = p_employee_id and s.ended_at is null) then
    raise exception 'Закройте текущую смену перед подключением промоутера' using errcode = '55000';
  end if;

  -- Keep a stable directory ID even for a newly named promoter. The marker
  -- cannot be used to sign in and never contains the employee's PIN.
  if not exists (select 1 from public.employee_credentials where employee_id = p_employee_id) then
    marker := encode(extensions.gen_random_bytes(32), 'hex');
    insert into public.employee_credentials (employee_id, login, pin_hash, pin_sha256, is_active)
    values (p_employee_id, lower(btrim(p_login)),
      extensions.crypt(marker, extensions.gen_salt('bf', 10)),
      extensions.digest(marker, 'sha256'), false);
  end if;

  return private.set_roaming_staff_credentials(p_employee_id, p_login, p_pin, p_is_active, true);
end;
$$;

revoke all on function private.set_enrolled_roaming_credentials(bigint,text,text,boolean)
  from public, anon, authenticated, crm_manager, service_role;

create function public.owner_enroll_roaming_promoter(p_employee_id bigint, p_full_name text)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  personal_name text := btrim(p_full_name);
  branch_ids bigint[];
  access_role text;
  legacy_credential public.employee_credentials%rowtype;
begin
  perform public._refocus_require_owner();

  if personal_name is null or length(personal_name) not between 2 and 120
    or personal_name ~ '[[:cntrl:]]'
    or lower(personal_name) ~ '^(промоутер([[:space:][:punct:]]|$)|новый сотрудник$)' then
    raise exception 'Укажите имя промоутера' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('roaming-credential-setup', 0));
  perform pg_advisory_xact_lock(hashtextextended('employee-shift-open:' || p_employee_id, 0));
  perform 1 from public.employees e
  where e.id = p_employee_id and e.role = 'promoter' and e.is_active
  for update;
  if not found then
    raise exception 'Активный промоутер не найден' using errcode = 'P0002';
  end if;

  branch_ids := private.promoter_pos_branch_ids(p_employee_id);
  if coalesce(cardinality(branch_ids), 0) = 0 then
    raise exception 'Для промоутера нет действующих касс' using errcode = '22023';
  end if;

  select a.expected_role into access_role
  from private.roaming_staff_access a where a.employee_id = p_employee_id for update;
  if found and access_role <> 'promoter' then
    raise exception 'В карточке уже настроен другой доступ к кассе' using errcode = '22023';
  end if;

  update public.employees e set full_name = personal_name, updated_at = now()
  where e.id = p_employee_id and e.full_name is distinct from personal_name;

  insert into private.roaming_staff_access (employee_id, expected_role, allowed_branch_ids)
  values (p_employee_id, 'promoter', branch_ids)
  on conflict (employee_id) do update set allowed_branch_ids = excluded.allowed_branch_ids,
    updated_at = now()
  where private.roaming_staff_access.allowed_branch_ids is distinct from excluded.allowed_branch_ids;

  if exists (select 1 from private.roaming_staff_credentials c where c.employee_id = p_employee_id) then
    update private.roaming_staff_access a set can_work_all_branches = true, updated_at = now()
    where a.employee_id = p_employee_id and not a.can_work_all_branches;
  else
    if exists (select 1 from public.attendance_sessions s where s.employee_id = p_employee_id and s.ended_at is null) then
      raise exception 'Закройте текущую смену перед подключением промоутера' using errcode = '55000';
    end if;

    select * into legacy_credential from public.employee_credentials c
    where c.employee_id = p_employee_id and c.is_active for update;
    if found and legacy_credential.pin_plain ~ '^[0-9]{4}$'
      and legacy_credential.pin_sha256 = extensions.digest(legacy_credential.pin_plain, 'sha256') then
      -- A shared or conflicting legacy PIN requires a new individual PIN in
      -- the existing credentials form. Never return the old PIN to the client.
      begin
        perform private.set_enrolled_roaming_credentials(p_employee_id,
          legacy_credential.login::text, legacy_credential.pin_plain, true);
      exception when unique_violation or invalid_parameter_value then
        null;
      end;
    end if;
  end if;

  return jsonb_build_object('employee_id', p_employee_id, 'full_name', personal_name,
    'enabled', private.roaming_staff_enabled(p_employee_id));
end;
$$;

revoke all on function public.owner_enroll_roaming_promoter(bigint,text)
  from public, anon, authenticated, crm_manager;
grant execute on function public.owner_enroll_roaming_promoter(bigint,text) to service_role;

-- Keep payroll's existing PIN form as the credential entry point. A promoter
-- awaiting PIN setup is already approved by the owner in the private registry.
do $$
declare
  f record;
  updated_body text;
  old_guard constant text := 'WHERE a.employee_id=p_employee_id AND a.can_work_all_branches) THEN';
  new_guard constant text := $guard$WHERE a.employee_id=p_employee_id AND (a.can_work_all_branches OR (
    a.expected_role='promoter' AND EXISTS (
      SELECT 1 FROM public.employees e WHERE e.id=p_employee_id AND e.is_active AND e.role='promoter'
    )
  ))) THEN$guard$;
begin
  for f in
    select p.oid, p.prosrc, pg_get_functiondef(p.oid) as definition
    from pg_proc p where p.oid in ('public.app_set_employee_login_pin(bigint,text,text)'::regprocedure,
      'public.set_employee_login_pin(bigint,text,text,boolean)'::regprocedure)
  loop
    updated_body := replace(f.prosrc, old_guard, new_guard);
    if updated_body = f.prosrc then
      raise exception 'Existing credential setter changed: %', f.oid::regprocedure;
    end if;
    updated_body := replace(updated_body,
      'private.set_roaming_staff_credentials(p_employee_id,p_login,p_pin,true,true)',
      'private.set_enrolled_roaming_credentials(p_employee_id,p_login,p_pin,true)');
    updated_body := replace(updated_body,
      'private.set_roaming_staff_credentials(p_employee_id,p_login,p_pin_plain,p_is_active,true)',
      'private.set_enrolled_roaming_credentials(p_employee_id,p_login,p_pin_plain,p_is_active)');
    if position('private.set_enrolled_roaming_credentials(' in updated_body) = 0 then
      raise exception 'Private credential delegation changed: %', f.oid::regprocedure;
    end if;
    execute replace(f.definition, f.prosrc, updated_body);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
