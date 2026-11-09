begin;

-- The manager is deliberately independent of authenticated/anon, whose legacy
-- grants are broader than the CRM manager's permissions.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'crm_manager') then
    raise exception 'crm_manager already exists. Review its grants before applying this migration';
  end if;
  create role crm_manager nologin noinherit nobypassrls;
end;
$$;
grant crm_manager to authenticator;
grant usage on schema public, extensions, storage to crm_manager;

-- Keep the exact pre-migration ACLs and trigger definitions for recovery.
create schema if not exists crm_security authorization postgres;
revoke all on schema crm_security from public, anon, authenticated, crm_manager;
create table crm_security.manager_function_acl_backup as
select p.oid as function_oid,
       format('%I.%I(%s)', n.nspname, p.proname,
              pg_get_function_identity_arguments(p.oid)) as function_identity,
       coalesce(p.proacl, acldefault('f', p.proowner)) as acl,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proowner = 'postgres'::regrole
  and p.prokind in ('f', 'p');
create table crm_security.manager_default_acl_backup as
select coalesce(
  (select d.defaclacl from pg_default_acl d
   where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0
     and d.defaclobjtype = 'f'),
  acldefault('f', 'postgres'::regrole)
) as acl;
create table crm_security.manager_legacy_roles as
select oid as role_oid, rolname as role_name from pg_roles
where rolname <> 'crm_manager';
create table crm_security.manager_policy_roles_backup as
select schemaname, tablename, policyname, roles
from pg_policies
where schemaname = 'public' and tablename = 'expenses'
  and policyname = 'exp_staff_read';
create table crm_security.manager_operation_log (
  id bigint generated always as identity primary key,
  manager_user_id uuid not null,
  rpc_name text not null,
  arguments jsonb not null,
  occurred_at timestamptz not null default now()
);
revoke all on all tables in schema crm_security from public, anon, authenticated, crm_manager;

-- Hosted extensions are owned by supabase_admin. Their text/vector/math
-- functions stay unchanged. An unexpected non-extension function stops rollout.
do $$
declare
  fn record;
  legacy_roles text;
begin
  if exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proowner <> 'postgres'::regrole
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid
          and d.deptype = 'e'
      )
  ) then
    raise exception 'Review non-extension functions not owned by postgres';
  end if;

  select string_agg(format('%I', role_name), ', ') into legacy_roles
  from crm_security.manager_legacy_roles;

  -- This legacy PUBLIC SELECT policy calls is_owner(). Limit it to its existing
  -- role audience so manager reads use their own policy and cannot execute the
  -- owner helper as a side effect of evaluating an OR expression.
  if not exists (
    select 1 from crm_security.manager_policy_roles_backup
    where roles = array['public']::name[]
  ) then
    raise exception 'Review expenses exp_staff_read policy audience';
  end if;
  execute format('alter policy exp_staff_read on public.expenses to %s', legacy_roles);

  for fn in
    select b.function_identity
    from crm_security.manager_function_acl_backup b
    where exists (
      select 1 from aclexplode(b.acl) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE'
    )
  loop
    -- Every preexisting role had this access through PUBLIC. Retain it without
    -- making the new non-inheriting manager role an owner/POS RPC caller.
    execute format('grant execute on routine %s to %s', fn.function_identity, legacy_roles);
    execute format('revoke execute on routine %s from public', fn.function_identity);
  end loop;

  -- A schema-specific REVOKE cannot cancel PostgreSQL's global PUBLIC default.
  -- Preserve that default for existing roles, and close it for new roles.
  execute format('alter default privileges for role postgres grant execute on functions to %s', legacy_roles);
  alter default privileges for role postgres revoke execute on functions from public;
end;
$$;

create function public.crm_is_manager()
returns boolean
language sql stable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' = 'crm_manager'
    and nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'app_metadata' ->> 'role' = 'manager'
    and nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub' is not null,
    false
  );
$$;
revoke all on function public.crm_is_manager() from public;
grant execute on function public.crm_is_manager() to crm_manager;

-- The only direct writes are normal order entry and the two permitted content
-- sections. Financial corrections/refunds/warehouse counts use the server RPC
-- proxy. Catalog prices, barcodes, employees and finance source data are read-only.
grant select on public.branches, public.customers, public.orders,
  public.order_items, public.payments, public.refunds, public.frame_barcodes,
  public.frames, public.products, public.lens_catalog, public.expenses,
  public.branch_workhours, public.orders_view, public.orders_with_warranties,
  public.order_payments_view, public.v_frame_labels,
  public.stats_customers_unified to crm_manager;
grant select (id, full_name, branch_id, is_active) on public.employees to crm_manager;
grant insert on public.customers, public.orders, public.order_items, public.payments to crm_manager;
grant update (gender, birthdate) on public.customers to crm_manager;
grant select, insert, update, delete on public.franchise_hq_items,
  public.franchise_calendar_events, public.franchise_calendar_templates to crm_manager;
grant usage, select on sequence public.customers_id_seq, public.orders_id_seq,
  public.order_items_id_seq, public.payments_id_seq,
  public.franchise_calendar_events_id_seq,
  public.franchise_calendar_templates_id_seq to crm_manager;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'branches', 'customers', 'employees', 'expenses', 'frame_barcodes',
    'order_items', 'payments', 'products', 'franchise_hq_items'
  ] loop
    execute format('create policy crm_manager_allow on public.%I as permissive for all to crm_manager using (public.crm_is_manager()) with check (public.crm_is_manager())', table_name);
    execute format('create policy crm_manager_claim_guard on public.%I as restrictive for all to crm_manager using (public.crm_is_manager()) with check (public.crm_is_manager())', table_name);
  end loop;
  foreach table_name in array array['franchise_calendar_events', 'franchise_calendar_templates'] loop
    execute format('create policy crm_manager_allow on public.%I as permissive for all to crm_manager using (public.crm_is_manager()) with check (public.crm_is_manager())', table_name);
    execute format('create policy crm_manager_employee_audience on public.%I as restrictive for all to crm_manager using (public.crm_is_manager() and audience in (''employee'', ''both'')) with check (public.crm_is_manager() and audience in (''employee'', ''both''))', table_name);
  end loop;
end;
$$;

-- The existing HQ bucket policy is PUBLIC. Restrict the manager so unrelated
-- legacy PUBLIC policies cannot also authorize access to application updates.
grant select, insert, update, delete on storage.objects to crm_manager;
create policy crm_manager_hq_bucket on storage.objects as restrictive
  for all to crm_manager
  using (bucket_id = 'franchise-hq-images' and public.crm_is_manager())
  with check (bucket_id = 'franchise-hq-images' and public.crm_is_manager());

-- These trigger-only functions need owner context for their internal sequence
-- and auth.uid calls. Neither function is granted as an executable manager RPC.
alter function public.trg_orders_set_no() security definer;
alter function public.trg_orders_set_no() set search_path = public, pg_temp;
alter function public.set_created_by() security definer;
alter function public.set_created_by() set search_path = public, auth, pg_temp;

-- Branch/day totals for financial analytics. No personal payroll fields or
-- employee identifiers are returned. Only the authenticated server proxy calls it.
create function public.crm_manager_payroll_by_day(
  p_from date, p_to date, p_branch_ids bigint[] default null
) returns table(
  day date, branch_id bigint, hours numeric, hour_pay numeric,
  bonus numeric, penalties numeric, net_day numeric
)
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server access required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  return query
  select p.day, p.branch_id, sum(coalesce(p.hours, 0)),
         sum(coalesce(p.hour_pay, 0)), sum(coalesce(p.bonus, 0)),
         sum(coalesce(p.penalties, 0)), sum(coalesce(p.net_day, 0))
  from public.v_payroll_daily_canonical p
  where p.day between p_from and p_to
    and (p_branch_ids is null or p.branch_id = any(p_branch_ids))
  group by p.day, p.branch_id
  order by p.day, p.branch_id;
end;
$$;

-- Keep the existing owner function untouched. This service-only entry point
-- performs the same bounded count correction with the real manager as actor.
create function public.crm_manager_warehouse_set_counts(
  p_manager_user_id uuid, p_location_id uuid, p_counts jsonb,
  p_comment text default null
) returns void
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  item_key text;
  item_qty integer;
  item_sku uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from auth.users u where u.id = p_manager_user_id
      and u.role = 'crm_manager' and u.raw_app_meta_data ->> 'role' = 'manager'
  ) then
    raise exception 'Invalid manager actor' using errcode = '42501';
  end if;
  if p_counts is null or jsonb_typeof(p_counts) <> 'object' then
    raise exception 'Invalid counts' using errcode = '22023';
  end if;
  if not exists (select 1 from public.locations where id = p_location_id) then
    raise exception 'Unknown location' using errcode = '22023';
  end if;
  foreach item_key in array array['bag', 'case', 'cloth', 'premium'] loop
    item_qty := coalesce((p_counts ->> item_key)::integer, 0);
    if item_qty < 0 then
      raise exception 'Negative quantity for %', item_key using errcode = '22023';
    end if;
    select s.id into item_sku from public.accessory_skus s
    where s.type::text = item_key order by s.created_at asc limit 1;
    if item_sku is null then
      raise exception 'Missing accessory SKU for %', item_key;
    end if;
    insert into public.accessory_balances(accessory_sku_id, location_id, qty)
    values (item_sku, p_location_id, item_qty)
    on conflict (accessory_sku_id, location_id)
    do update set qty = excluded.qty;
  end loop;
  insert into public.accessory_balance_fix_log(location_id, fixed_by, counts, comment)
  values (p_location_id, p_manager_user_id, p_counts, p_comment);
  insert into crm_security.manager_operation_log(manager_user_id, rpc_name, arguments)
  values (p_manager_user_id, 'warehouse_accessory_set_counts', jsonb_build_object(
    'p_location_id', p_location_id, 'p_counts', p_counts, 'p_comment', p_comment
  ));
end;
$$;

create function public.crm_manager_set_actor(p_manager_user_id uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  claims jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from auth.users u where u.id = p_manager_user_id
      and u.role = 'crm_manager' and u.raw_app_meta_data ->> 'role' = 'manager'
  ) then
    raise exception 'Invalid manager actor' using errcode = '42501';
  end if;
  claims := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  perform set_config('request.jwt.claims', (claims || jsonb_build_object(
    'sub', p_manager_user_id::text, 'role', 'service_role'
  ))::text, true);
  perform set_config('request.jwt.claim.sub', p_manager_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
end;
$$;

-- Generate typed wrappers from the existing signatures. The original owner/POS
-- implementations remain unchanged. Only the verified manager UUID is scoped
-- into auth.uid(), and the service role guard remains in force throughout.
do $$
declare
  original_fn record;
  input_name text;
  call_arguments text;
  audit_arguments text;
  actor_guard text;
  call_statement text;
  result_declaration text;
  final_return text;
  wrapper_body text;
  wrapper_count integer := 0;
begin
  for original_fn in
    select p.*, pg_get_function_arguments(p.oid) as arguments,
           pg_get_function_result(p.oid) as result_type
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = any(array[
      'add_payment', 'admin_update_payment_method', 'admin_soft_delete_order',
      'reconciliation_set_manual_v2', 'reconciliation_online_set_manual',
      'reconciliation_fix_transfer', 'pos_order_cancel_v2',
      'pos_order_cash_refund_v2', 'pos_refund_settle_v2',
      'pos_warranty_adjustment'
    ])
  loop
    call_arguments := '';
    audit_arguments := '';
    actor_guard := '';
    foreach input_name in array original_fn.proargnames[1:original_fn.pronargs] loop
      call_arguments := concat_ws(', ', nullif(call_arguments, ''), format('%I => %I', input_name, input_name));
      audit_arguments := concat_ws(', ', nullif(audit_arguments, ''), format('%L, %I', input_name, input_name));
      if input_name in ('p_employee_id', 'p_pos_session_id', 'p_client_uuid') then
        actor_guard := actor_guard || format(
          'if %I is not null then raise exception ''Manager actions cannot impersonate a POS employee/session'' using errcode = ''42501''; end if;', input_name
        );
      end if;
    end loop;
    result_declaration := '';
    final_return := 'return;';
    if original_fn.proretset then
      call_statement := format('return query select * from public.%I(%s);', original_fn.proname, call_arguments);
    elsif original_fn.prorettype = 'void'::regtype then
      call_statement := format('perform public.%I(%s);', original_fn.proname, call_arguments);
    else
      result_declaration := format('operation_result %s;', original_fn.result_type);
      call_statement := format('select public.%I(%s) into operation_result;', original_fn.proname, call_arguments);
      final_return := 'return operation_result;';
    end if;
    wrapper_body := format($wrapper$
      declare
        previous_claims text := current_setting('request.jwt.claims', true);
        previous_sub text := current_setting('request.jwt.claim.sub', true);
        previous_role text := current_setting('request.jwt.claim.role', true);
        %s
      begin
        perform public.crm_manager_set_actor(p_manager_user_id);
        %s
        %s
        insert into crm_security.manager_operation_log(manager_user_id, rpc_name, arguments)
        values (p_manager_user_id, %L, jsonb_build_object(%s));
        perform set_config('request.jwt.claims', coalesce(previous_claims, ''), true);
        perform set_config('request.jwt.claim.sub', coalesce(previous_sub, ''), true);
        perform set_config('request.jwt.claim.role', coalesce(previous_role, ''), true);
        %s
      exception when others then
        perform set_config('request.jwt.claims', coalesce(previous_claims, ''), true);
        perform set_config('request.jwt.claim.sub', coalesce(previous_sub, ''), true);
        perform set_config('request.jwt.claim.role', coalesce(previous_role, ''), true);
        raise;
      end;
    $wrapper$, result_declaration, actor_guard, call_statement,
      original_fn.proname, audit_arguments, final_return);
    execute format(
      'create function public.%I(p_manager_user_id uuid, %s) returns %s language plpgsql security definer set search_path = pg_catalog, public, pg_temp as %L',
      'crm_manager_' || original_fn.proname, original_fn.arguments,
      original_fn.result_type, wrapper_body
    );
    wrapper_count := wrapper_count + 1;
  end loop;
  if wrapper_count <> 10 then
    raise exception 'Expected exactly ten manager operation signatures, got %', wrapper_count;
  end if;
end;
$$;

-- The preserved legacy function defaults intentionally grant existing roles.
-- Remove those defaults again from every new server-only manager function.
do $$
declare
  fn text;
  legacy_role record;
begin
  for fn in
    select p.oid::regprocedure::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname like 'crm_manager\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, crm_manager', fn);
    for legacy_role in select role_name from crm_security.manager_legacy_roles
      where role_name not in ('postgres', 'service_role')
    loop
      execute format('revoke all on function %s from %I', fn, legacy_role.role_name);
    end loop;
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
