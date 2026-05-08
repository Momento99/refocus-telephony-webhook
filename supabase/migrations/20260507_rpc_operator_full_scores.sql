-- Combined operator score: SLA speed + AI quality.
-- Used by POS OperatorScoreBadge (one number for the seller).
-- The CRM still shows two metrics separately (admin sees both speed and quality).
--
-- Final score = 0.5 * speed_score + 0.5 * ai_avg
--   - if only one of the two metrics has data → that metric alone
--   - if neither → null

drop function if exists public.rpc_operator_full_scores(timestamptz, timestamptz, bigint, text);

create or replace function public.rpc_operator_full_scores(
  p_from      timestamptz,
  p_to        timestamptz,
  p_branch_id bigint default null,
  p_channel   text   default null
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
  speed_score  numeric,
  ai_threads   integer,
  ai_avg       numeric,
  score        numeric
)
language sql stable security definer set search_path = public
as $$
  with sla_raw as (
    select t.assigned_seller_employee_id as emp_id, t.branch_id,
      case when t.first_seller_response_at is null then null
        else extract(epoch from (t.first_seller_response_at - t.first_customer_message_at)) / 60.0 end as reply_min,
      t.first_seller_response_at as r_at
    from whatsapp_threads t
    where (p_channel is null or p_channel = 'whatsapp')
      and t.first_customer_message_at >= p_from and t.first_customer_message_at < p_to
      and t.assigned_seller_employee_id is not null
      and (p_branch_id is null or t.branch_id = p_branch_id)
    union all
    select t.assigned_seller_employee_id, t.branch_id,
      case when t.first_seller_response_at is null then null
        else extract(epoch from (t.first_seller_response_at - t.first_customer_message_at)) / 60.0 end,
      t.first_seller_response_at
    from instagram_threads t
    where (p_channel is null or p_channel = 'instagram')
      and t.first_customer_message_at >= p_from and t.first_customer_message_at < p_to
      and t.assigned_seller_employee_id is not null
      and (p_branch_id is null or t.branch_id = p_branch_id)
  ),
  sla_agg as (
    select emp_id, branch_id,
      count(*)::int                                                     as threads,
      count(r_at)::int                                                  as responded,
      coalesce(avg(reply_min) filter (where reply_min is not null), 0)  as avg_min,
      case when count(r_at) = 0 then 0
        else 100.0 * count(*) filter (where reply_min is not null and reply_min <= 10)::numeric
             / count(r_at)::numeric end                                 as sla_pct
    from sla_raw
    group by emp_id, branch_id
  ),
  ai_raw as (
    select t.assigned_seller_employee_id as emp_id, t.branch_id, q.score
    from whatsapp_thread_quality q
    join whatsapp_threads t on t.id = q.thread_id
    where (p_channel is null or p_channel = 'whatsapp')
      and t.first_customer_message_at >= p_from and t.first_customer_message_at < p_to
      and t.assigned_seller_employee_id is not null
      and (p_branch_id is null or t.branch_id = p_branch_id)
    union all
    select t.assigned_seller_employee_id, t.branch_id, q.score
    from instagram_thread_quality q
    join instagram_threads t on t.id = q.thread_id
    where (p_channel is null or p_channel = 'instagram')
      and t.first_customer_message_at >= p_from and t.first_customer_message_at < p_to
      and t.assigned_seller_employee_id is not null
      and (p_branch_id is null or t.branch_id = p_branch_id)
  ),
  ai_agg as (
    select emp_id, branch_id,
      count(*)::int           as ai_threads,
      avg(score::numeric)     as ai_avg
    from ai_raw
    group by emp_id, branch_id
  ),
  joined as (
    select
      coalesce(s.emp_id, a.emp_id)        as employee_id,
      coalesce(s.branch_id, a.branch_id)  as branch_id,
      coalesce(s.threads, 0)              as threads,
      coalesce(s.responded, 0)            as responded,
      coalesce(s.avg_min, 0)              as avg_min,
      coalesce(s.sla_pct, 0)              as sla_pct,
      coalesce(a.ai_threads, 0)           as ai_threads,
      a.ai_avg                            as ai_avg
    from sla_agg s
    full outer join ai_agg a on a.emp_id = s.emp_id and a.branch_id = s.branch_id
  ),
  scored as (
    select
      j.employee_id, j.branch_id, j.threads, j.responded,
      round(j.avg_min::numeric, 2) as avg_min,
      round(j.sla_pct::numeric, 1) as sla_pct,
      case when j.threads > 0
        then greatest(0,
              10
              - least(4, 0.05 * greatest(0, 80 - j.sla_pct))
              - least(3, 0.1  * greatest(0, j.avg_min - 10))
            )::numeric(4,2)
        else null end as speed_score,
      j.ai_threads,
      case when j.ai_threads > 0 then round(j.ai_avg::numeric, 2) else null end as ai_avg
    from joined j
  ),
  finalized as (
    select s.*,
      case
        when s.speed_score is not null and s.ai_avg is not null
          then round((0.5 * s.speed_score + 0.5 * s.ai_avg)::numeric, 2)
        when s.speed_score is not null then s.speed_score
        when s.ai_avg is not null      then s.ai_avg
        else null
      end as score
    from scored s
  )
  select
    f.employee_id,
    coalesce(e.full_name, '— неизвестно —') as full_name,
    f.branch_id,
    coalesce(b.name, b.branch_name, '—')    as branch_name,
    f.threads, f.responded, f.avg_min, f.sla_pct, f.speed_score,
    f.ai_threads, f.ai_avg, f.score
  from finalized f
  left join employees e on e.id = f.employee_id
  left join branches  b on b.id = f.branch_id
  order by score desc nulls last, threads desc;
$$;

grant execute on function public.rpc_operator_full_scores(timestamptz, timestamptz, bigint, text)
  to authenticated, anon, service_role;

comment on function public.rpc_operator_full_scores is
  'Объединённая оценка оператора: 0.5*SLA скорость + 0.5*AI качество. Если данных только по одной метрике — возвращается она. Используется POS OperatorScoreBadge.';
