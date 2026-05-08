-- Зеркальная функция для Instagram + универсальная rpc_operator_messaging_scores
-- (WhatsApp + Instagram вместе). Формула та же, что в rpc_operator_whatsapp_scores.

drop function if exists public.rpc_operator_instagram_scores(timestamptz, timestamptz, bigint);

create or replace function public.rpc_operator_instagram_scores(
  p_from timestamptz, p_to timestamptz, p_branch_id bigint default null
)
returns table (
  employee_id bigint, full_name text, branch_id bigint, branch_name text,
  threads integer, responded integer, avg_min numeric, sla_pct numeric, score numeric
)
language sql stable security definer set search_path = public
as $$
  with raw as (
    select t.assigned_seller_employee_id as emp_id, t.branch_id,
      case when t.first_seller_response_at is null then null
        else extract(epoch from (t.first_seller_response_at - t.first_customer_message_at))/60.0 end as reply_min,
      t.first_seller_response_at as r_at
    from instagram_threads t
    where t.first_customer_message_at >= p_from and t.first_customer_message_at < p_to
      and t.assigned_seller_employee_id is not null
      and (p_branch_id is null or t.branch_id = p_branch_id)
  ),
  agg as (
    select emp_id, branch_id, count(*)::int as threads, count(r_at)::int as responded,
      coalesce(avg(reply_min) filter (where reply_min is not null), 0) as avg_min,
      case when count(r_at)=0 then 0
        else 100.0 * count(*) filter (where reply_min is not null and reply_min <= 10)::numeric / count(r_at)::numeric end as sla_pct
    from raw group by emp_id, branch_id
  ),
  scored as (
    select a.emp_id as employee_id,
      coalesce(e.full_name,'— неизвестно —') as full_name,
      a.branch_id,
      coalesce(b.name, b.branch_name, '—') as branch_name,
      a.threads, a.responded,
      round(a.avg_min::numeric,2) as avg_min,
      round(a.sla_pct::numeric,1) as sla_pct,
      greatest(0, 10 - least(4, 0.05 * greatest(0, 80 - a.sla_pct)) - least(3, 0.1 * greatest(0, a.avg_min - 10)))::numeric(4,2) as score
    from agg a left join employees e on e.id = a.emp_id left join branches b on b.id = a.branch_id
  )
  select employee_id, full_name, branch_id, branch_name, threads, responded, avg_min, sla_pct, score
  from scored order by score desc, threads desc;
$$;

grant execute on function public.rpc_operator_instagram_scores(timestamptz, timestamptz, bigint)
  to authenticated, anon, service_role;

comment on function public.rpc_operator_instagram_scores is
  'Оценка продавцов Instagram за период.';

-- ─── Объединённая по двум каналам ──────────────────────────────────────────

drop function if exists public.rpc_operator_messaging_scores(timestamptz, timestamptz, bigint, text);

create or replace function public.rpc_operator_messaging_scores(
  p_from timestamptz, p_to timestamptz, p_branch_id bigint default null, p_channel text default null
)
returns table (
  employee_id bigint, full_name text, branch_id bigint, branch_name text,
  threads integer, responded integer, avg_min numeric, sla_pct numeric, score numeric
)
language sql stable security definer set search_path = public
as $$
  with raw as (
    select t.assigned_seller_employee_id as emp_id, t.branch_id,
      case when t.first_seller_response_at is null then null
        else extract(epoch from (t.first_seller_response_at - t.first_customer_message_at))/60.0 end as reply_min,
      t.first_seller_response_at as r_at
    from whatsapp_threads t
    where (p_channel is null or p_channel = 'whatsapp')
      and t.first_customer_message_at >= p_from and t.first_customer_message_at < p_to
      and t.assigned_seller_employee_id is not null
      and (p_branch_id is null or t.branch_id = p_branch_id)
    union all
    select t.assigned_seller_employee_id, t.branch_id,
      case when t.first_seller_response_at is null then null
        else extract(epoch from (t.first_seller_response_at - t.first_customer_message_at))/60.0 end,
      t.first_seller_response_at
    from instagram_threads t
    where (p_channel is null or p_channel = 'instagram')
      and t.first_customer_message_at >= p_from and t.first_customer_message_at < p_to
      and t.assigned_seller_employee_id is not null
      and (p_branch_id is null or t.branch_id = p_branch_id)
  ),
  agg as (
    select emp_id, branch_id, count(*)::int as threads, count(r_at)::int as responded,
      coalesce(avg(reply_min) filter (where reply_min is not null), 0) as avg_min,
      case when count(r_at)=0 then 0
        else 100.0 * count(*) filter (where reply_min is not null and reply_min <= 10)::numeric / count(r_at)::numeric end as sla_pct
    from raw group by emp_id, branch_id
  ),
  scored as (
    select a.emp_id as employee_id,
      coalesce(e.full_name,'— неизвестно —') as full_name,
      a.branch_id,
      coalesce(b.name, b.branch_name, '—') as branch_name,
      a.threads, a.responded,
      round(a.avg_min::numeric,2) as avg_min,
      round(a.sla_pct::numeric,1) as sla_pct,
      greatest(0, 10 - least(4, 0.05 * greatest(0, 80 - a.sla_pct)) - least(3, 0.1 * greatest(0, a.avg_min - 10)))::numeric(4,2) as score
    from agg a left join employees e on e.id = a.emp_id left join branches b on b.id = a.branch_id
  )
  select employee_id, full_name, branch_id, branch_name, threads, responded, avg_min, sla_pct, score
  from scored order by score desc, threads desc;
$$;

grant execute on function public.rpc_operator_messaging_scores(timestamptz, timestamptz, bigint, text)
  to authenticated, anon, service_role;

comment on function public.rpc_operator_messaging_scores is
  'Оценка продавцов: WhatsApp + Instagram. p_channel=null — оба канала вместе.';
