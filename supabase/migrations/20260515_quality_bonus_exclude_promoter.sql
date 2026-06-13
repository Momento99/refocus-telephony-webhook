-- rpc_branch_monthly_bonus_recipients: исключаем промоутеров из получателей премии 500 ₸.
CREATE OR REPLACE FUNCTION public.rpc_branch_monthly_bonus_recipients(
  p_from timestamp with time zone,
  p_to timestamp with time zone,
  p_branch_id bigint
)
 RETURNS TABLE(
   employee_id bigint,
   full_name text,
   shifts_worked integer,
   total_branch_shifts integer,
   share_pct numeric,
   eligible boolean
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with per_emp as (
    select s.employee_id, count(*)::int as shifts_worked
    from attendance_sessions s
    join employees e on e.id = s.employee_id
    where s.branch_id = p_branch_id
      and s.started_at >= p_from and s.started_at < p_to
      and s.ended_at is not null
      and extract(epoch from (s.ended_at::timestamptz - s.started_at)) >= 18000
      and s.employee_id is not null
      and coalesce(e.role::text, 'seller') <> 'promoter'
    group by s.employee_id
  ),
  branch_total as (
    select coalesce(sum(shifts_worked), 0)::int as total
    from per_emp
  )
  select
    p.employee_id,
    coalesce(e.full_name, 'unknown')                            as full_name,
    p.shifts_worked,
    bt.total                                                    as total_branch_shifts,
    case when bt.total > 0
      then round(100.0 * p.shifts_worked / bt.total, 1)
      else 0 end                                                as share_pct,
    (bt.total > 0 and p.shifts_worked::numeric / bt.total >= 0.5) as eligible
  from per_emp p
  cross join branch_total bt
  left join employees e on e.id = p.employee_id
  order by p.shifts_worked desc;
$function$;
