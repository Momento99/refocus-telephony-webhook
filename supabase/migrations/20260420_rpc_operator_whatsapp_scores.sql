-- Unified scoring RPC for WhatsApp operators.
-- Used by POS (/whatsapp-score, OperatorScoreBadge) and CRM (/admin/whatsapp-control).
-- Formula:
--   base 10
--   − 0.05 * max(0, 80 - sla_pct)   capped at −4
--   − 0.1  * max(0, avg_min - 10)   capped at −3
-- SLA = response within 10 minutes.

drop function if exists public.rpc_operator_whatsapp_scores(timestamptz, timestamptz, bigint);

create or replace function public.rpc_operator_whatsapp_scores(
  p_from      timestamptz,
  p_to        timestamptz,
  p_branch_id bigint default null
)
returns table (
  employee_id  bigint,
  full_name    text,
  branch_id    bigint,
  branch_name  text,
  threads      integer,
  responded    integer,
  avg_min      numeric,
  sla_pct      numeric,
  score        numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with raw as (
    select
      t.assigned_seller_employee_id as emp_id,
      t.branch_id,
      t.first_customer_message_at   as q_at,
      t.first_seller_response_at    as r_at,
      case
        when t.first_seller_response_at is null then null
        else extract(epoch from (t.first_seller_response_at - t.first_customer_message_at)) / 60.0
      end as reply_min
    from whatsapp_threads t
    where t.first_customer_message_at >= p_from
      and t.first_customer_message_at <  p_to
      and t.assigned_seller_employee_id is not null
      and (p_branch_id is null or t.branch_id = p_branch_id)
  ),
  agg as (
    select
      emp_id,
      branch_id,
      count(*)::int                                                      as threads,
      count(r_at)::int                                                   as responded,
      coalesce(avg(reply_min) filter (where reply_min is not null), 0)   as avg_min,
      case
        when count(r_at) = 0 then 0
        else 100.0 * count(*) filter (where reply_min is not null and reply_min <= 10)::numeric
             / count(r_at)::numeric
      end as sla_pct
    from raw
    group by emp_id, branch_id
  )
  select
    a.emp_id                                            as employee_id,
    coalesce(e.full_name, '— неизвестно —')             as full_name,
    a.branch_id,
    coalesce(b.name, b.branch_name, '—')                as branch_name,
    a.threads,
    a.responded,
    round(a.avg_min::numeric, 2)                        as avg_min,
    round(a.sla_pct::numeric, 1)                        as sla_pct,
    greatest(0,
      10
      - least(4, 0.05 * greatest(0, 80 - a.sla_pct))
      - least(3, 0.1  * greatest(0, a.avg_min - 10))
    )::numeric(4,2)                                     as score
  from agg a
  left join employees e on e.id = a.emp_id
  left join branches  b on b.id = a.branch_id
  order by score desc, threads desc;
$$;

grant execute on function public.rpc_operator_whatsapp_scores(timestamptz, timestamptz, bigint)
  to authenticated, anon, service_role;

comment on function public.rpc_operator_whatsapp_scores is
  'Оценка продавцов WhatsApp за период. Возвращает threads/responded/avg_min/sla_pct/score (0..10). Используется POS + CRM.';
