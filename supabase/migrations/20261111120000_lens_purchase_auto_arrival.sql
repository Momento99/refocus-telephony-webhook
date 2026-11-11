begin;

-- Arrival is a lifecycle estimate. Inventory continues to use the existing
-- warehouse count, and these functions never create lens lots or cash entries.
alter table public.lens_purchase_batches
  add column if not exists auto_receive_at timestamptz,
  add column if not exists auto_received_at timestamptz;

comment on column public.lens_purchase_batches.auto_receive_at is
  'Расчётная дата автоматической отметки прибытия. Срок фиксируется при отправке партии.';
comment on column public.lens_purchase_batches.auto_received_at is
  'Время автоматической отметки. received_at в такой партии является расчётной датой, а не подтверждением физической приёмки.';

create table if not exists public.lens_purchase_auto_arrival_policy (
  location_id uuid primary key references public.locations(id),
  delivery_days integer not null check (delivery_days between 1 and 365),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.lens_purchase_auto_arrival_policy enable row level security;
revoke all on table public.lens_purchase_auto_arrival_policy
  from public, anon, authenticated, service_role, crm_manager;

insert into public.lens_purchase_auto_arrival_policy(location_id, delivery_days, enabled)
values ('ce4fba36-c242-4e04-abdf-6883e906e4bf', 30, true)
on conflict (location_id) do nothing;

create or replace function public.tg_lens_purchase_auto_arrival()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_days integer;
  v_metadata_changed boolean;
  v_provenance_changed boolean;
  v_database_role text := coalesce(current_setting('role', true), '');
  v_database_writer boolean;
begin
  v_database_writer := v_database_role in ('postgres', 'service_role')
    or (v_database_role in ('none', '') and session_user in ('postgres', 'supabase_admin'));
  if tg_op = 'INSERT' then
    v_metadata_changed := new.auto_receive_at is not null or new.auto_received_at is not null;
    v_provenance_changed := new.auto_received_at is not null;
  else
    v_metadata_changed := new.auto_receive_at is distinct from old.auto_receive_at
      or new.auto_received_at is distinct from old.auto_received_at;
    v_provenance_changed := new.auto_received_at is distinct from old.auto_received_at;
  end if;

  if v_provenance_changed and not v_database_writer then
    raise exception 'Automatic arrival provenance is managed by the scheduler' using errcode = '42501';
  end if;

  if v_metadata_changed
    and not (
      v_database_writer
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
    ) then
    raise exception 'Only an owner can change automatic arrival metadata' using errcode = '42501';
  end if;

  if new.status = 'in_transit' and new.auto_receive_at is null then
    select p.delivery_days into v_days
    from public.lens_purchase_auto_arrival_policy p
    where p.location_id = new.to_location_id;
    if found then
      new.ordered_at := coalesce(new.ordered_at, now());
      new.auto_receive_at := new.ordered_at + make_interval(days => v_days);
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function public.tg_lens_purchase_auto_arrival()
  from public, anon, authenticated, service_role, crm_manager;

drop trigger if exists trg_lens_purchase_auto_arrival on public.lens_purchase_batches;
create trigger trg_lens_purchase_auto_arrival
before insert or update of status, ordered_at, to_location_id, auto_receive_at, auto_received_at
on public.lens_purchase_batches
for each row execute function public.tg_lens_purchase_auto_arrival();

-- Existing deadlines, including owner postponements, survive policy changes
-- and migration retries. A draft's creation date never starts the delivery clock.
update public.lens_purchase_batches b
set auto_receive_at = b.ordered_at + make_interval(days => p.delivery_days)
from public.lens_purchase_auto_arrival_policy p
where b.to_location_id = p.location_id
  and b.status = 'in_transit'
  and b.ordered_at is not null
  and b.auto_receive_at is null;

create or replace function public.lens_purchase_auto_arrival_get(p_location_id uuid)
returns table(location_id uuid, delivery_days integer, enabled boolean, updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  perform public._require_owner();
  return query select p.location_id, p.delivery_days, p.enabled, p.updated_at
    from public.lens_purchase_auto_arrival_policy p where p.location_id = p_location_id;
end;
$function$;

create or replace function public.lens_purchase_auto_arrival_set(
  p_location_id uuid, p_delivery_days integer, p_enabled boolean
)
returns table(location_id uuid, delivery_days integer, enabled boolean, updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  perform public._require_owner();
  if p_delivery_days is null or p_delivery_days not between 1 and 365 or p_enabled is null then
    raise exception 'Invalid automatic arrival policy' using errcode = '22023';
  end if;
  update public.lens_purchase_auto_arrival_policy p
    set delivery_days = p_delivery_days, enabled = p_enabled, updated_at = now(), updated_by = auth.uid()
    where p.location_id = p_location_id;
  if not found then
    raise exception 'Automatic arrival is not configured for this location' using errcode = '22023';
  end if;
  return query select p.location_id, p.delivery_days, p.enabled, p.updated_at
    from public.lens_purchase_auto_arrival_policy p where p.location_id = p_location_id;
end;
$function$;

create or replace function public.lens_purchase_auto_arrival_defer(p_batch_id uuid, p_days integer default 7)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_batch public.lens_purchase_batches%rowtype;
  v_due timestamptz;
begin
  perform public._require_owner();
  if p_days is null or p_days not between 1 and 365 then
    raise exception 'Invalid postponement period' using errcode = '22023';
  end if;
  select b.* into v_batch from public.lens_purchase_batches b where b.id = p_batch_id for update;
  if not found then raise exception 'Batch not found' using errcode = '22023'; end if;
  if v_batch.status <> 'in_transit' or v_batch.auto_receive_at is null
    or not exists (select 1 from public.lens_purchase_auto_arrival_policy p where p.location_id = v_batch.to_location_id) then
    raise exception 'Only a scheduled in-transit batch can be postponed' using errcode = '22023';
  end if;
  v_due := greatest(now(), v_batch.auto_receive_at) + make_interval(days => p_days);
  update public.lens_purchase_batches set auto_receive_at = v_due where id = p_batch_id;
  return v_due;
end;
$function$;

revoke all on function public.lens_purchase_auto_arrival_get(uuid)
  from public, anon, authenticated, service_role, crm_manager;
revoke all on function public.lens_purchase_auto_arrival_set(uuid, integer, boolean)
  from public, anon, authenticated, service_role, crm_manager;
revoke all on function public.lens_purchase_auto_arrival_defer(uuid, integer)
  from public, anon, authenticated, service_role, crm_manager;
grant execute on function public.lens_purchase_auto_arrival_get(uuid) to authenticated;
grant execute on function public.lens_purchase_auto_arrival_set(uuid, integer, boolean) to authenticated;
grant execute on function public.lens_purchase_auto_arrival_defer(uuid, integer) to authenticated;

create or replace function public.lens_purchase_auto_arrival_run()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_now timestamptz := now();
  v_batch record;
  v_count integer := 0;
  v_enabled boolean;
begin
  select p.enabled into v_enabled
  from public.lens_purchase_auto_arrival_policy p
  where p.location_id = 'ce4fba36-c242-4e04-abdf-6883e906e4bf'
  for share;
  if not coalesce(v_enabled, false) then return 0; end if;

  for v_batch in
    select b.id
    from public.lens_purchase_batches b
    where b.to_location_id = 'ce4fba36-c242-4e04-abdf-6883e906e4bf'
      and b.status = 'in_transit'
      and b.ordered_at is not null
      and b.auto_receive_at <= v_now
      and b.auto_received_at is null
      and exists (select 1 from public.lens_purchase_batch_items i where i.batch_id = b.id and i.qty > 0)
    order by b.auto_receive_at, b.id
    for update of b skip locked
  loop
    -- Same metadata-only outcome as mark_received. The confirmation flags
    -- close the legacy POS stock-credit button, without confirming a count.
    update public.lens_purchase_batches b
      set status = 'received', received_at = coalesce(b.received_at, b.auto_receive_at), auto_received_at = v_now,
          is_confirmed = true, confirmed_at = coalesce(b.confirmed_at, v_now),
          receipt_confirmed_at = coalesce(b.receipt_confirmed_at, v_now)
      where b.id = v_batch.id and b.status = 'in_transit'
        and b.auto_receive_at <= v_now and b.auto_received_at is null;
    if found then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.lens_purchase_auto_arrival_run()
  from public, anon, authenticated, service_role, crm_manager;
grant execute on function public.lens_purchase_auto_arrival_run() to postgres;

-- Remove inherited default ACL grants to application-specific roles as well.
-- Restore only the three owner-gated browser RPC grants afterwards.
do $block$
declare
  v_object record;
  v_grantee record;
begin
  for v_object in
    select p.oid, p.proowner as owner_id, p.proacl as acl, 'f'::"char" as acl_type,
           'FUNCTION ' || p.oid::regprocedure::text as identity
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('tg_lens_purchase_auto_arrival', 'lens_purchase_auto_arrival_get',
        'lens_purchase_auto_arrival_set', 'lens_purchase_auto_arrival_defer', 'lens_purchase_auto_arrival_run')
    union all
    select c.oid, c.relowner, c.relacl, 'r'::"char", 'TABLE public.lens_purchase_auto_arrival_policy'
    from pg_class c where c.oid = 'public.lens_purchase_auto_arrival_policy'::regclass
  loop
    for v_grantee in
      select distinct a.grantee
      from aclexplode(coalesce(v_object.acl, acldefault(v_object.acl_type, v_object.owner_id))) a
      where a.grantee <> v_object.owner_id
    loop
      execute format('REVOKE ALL ON %s FROM %s CASCADE', v_object.identity,
        case when v_grantee.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(v_grantee.grantee)) end);
    end loop;
  end loop;
end;
$block$;

grant execute on function public.lens_purchase_auto_arrival_get(uuid) to authenticated;
grant execute on function public.lens_purchase_auto_arrival_set(uuid, integer, boolean) to authenticated;
grant execute on function public.lens_purchase_auto_arrival_defer(uuid, integer) to authenticated;

comment on function public.lens_purchase_auto_arrival_run() is
  'Cron-only estimated arrival. Updates batch metadata and never writes stock or cash.';

select cron.schedule('lens-purchase-auto-arrival', '0 * * * *', 'select public.lens_purchase_auto_arrival_run();');

commit;
