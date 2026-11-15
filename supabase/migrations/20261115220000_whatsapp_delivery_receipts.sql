-- Status callbacks can precede the HTTP response that links a provider message ID.
-- Keep only opaque provider IDs and receipt metadata; never store recipient numbers or message bodies.
begin;

create table if not exists public.whatsapp_delivery_receipts (
  wa_message_id text not null check (length(wa_message_id) between 1 and 1024),
  status text not null check (status in ('sent', 'failed', 'delivered', 'read')),
  provider_timestamp timestamptz,
  error_code text,
  error_message text,
  received_at timestamptz not null default now(),
  primary key (wa_message_id, status)
);
create index if not exists whatsapp_delivery_receipts_received_idx
  on public.whatsapp_delivery_receipts (received_at);

alter table public.whatsapp_delivery_receipts enable row level security;
revoke all on table public.whatsapp_delivery_receipts from public, anon, authenticated;
grant select, insert, update, delete on table public.whatsapp_delivery_receipts to service_role;

-- Bounded maintenance; keeping at least seven days avoids pruning fresh callbacks.
create or replace function public.whatsapp_prune_delivery_receipts(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_deleted integer;
begin
  with expired as (
    select wa_message_id, status
    from public.whatsapp_delivery_receipts
    where received_at < now() - interval '7 days'
    order by received_at
    limit greatest(1, least(coalesce(p_limit, 500), 1000))
    for update skip locked
  )
  delete from public.whatsapp_delivery_receipts r
  using expired e
  where r.wa_message_id = e.wa_message_id and r.status = e.status;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.whatsapp_prune_delivery_receipts(integer) from public, anon, authenticated;
grant execute on function public.whatsapp_prune_delivery_receipts(integer) to service_role;
notify pgrst, 'reload schema';
commit;
