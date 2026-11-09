begin;

-- Push the requested dates into the canonical calculation instead of filtering
-- the unbounded daily view after its complete history has been calculated.
create function public.owner_payroll_daily_fixed(p_from date, p_to date)
returns table (
  employee_id bigint,
  branch_id bigint,
  day date,
  hours numeric,
  hour_pay numeric,
  turnover numeric,
  bonus numeric,
  penalties bigint,
  social_fund_day numeric,
  income_tax_day numeric,
  plan_premium numeric,
  net_day integer
)
language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp
as $$
begin
  perform public._refocus_require_owner();
  if p_from is null or p_to is null or p_from>p_to then
    raise exception 'Укажите корректный период зарплаты' using errcode='22023';
  end if;

  return query
  with daily as (
    select c.employee_id, c.branch_id, c.day,
      coalesce(c.hours,0::numeric) as hours,
      coalesce(c.hour_pay,0::numeric) as hour_pay,
      coalesce(c.paid_sum,0::numeric) as employee_turnover,
      coalesce(c.bonus,0::numeric) as bonus,
      coalesce(c.penalties,0::numeric)::bigint as penalties,
      coalesce(c.social_fund_day,0::numeric) as social_fund_day,
      coalesce(c.income_tax_day,0::numeric) as income_tax_day,
      0::numeric as plan_premium
    from public.payroll_daily_canonical(p_from,p_to,null,null) c
    where not (c.employee_id in (
      select e.id from public.employees e where e.role='master'::public.role_t
    ))
    union all
    select mp.employee_id, mp.branch_id, mp.day,
      0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::bigint,
      0::numeric, 0::numeric, 0::numeric
    from public.v_master_pay_by_branch_day mp
    where mp.day between p_from and p_to
      and not (mp.employee_id in (
        select e.id from public.employees e where e.role='master'::public.role_t
      ))
  )
  select d.employee_id, d.branch_id, d.day, d.hours, d.hour_pay,
    case when d.day=current_date
      then coalesce(p.turnover_today_from_payments,d.employee_turnover)
      else d.employee_turnover end as turnover,
    case when d.day=current_date
      then coalesce(p.bonus_today_from_payments,d.bonus)
      else d.bonus end as bonus,
    d.penalties, d.social_fund_day, d.income_tax_day,
    case when d.day<'2026-02-01'::date then d.plan_premium else 0::numeric end,
    round(d.hour_pay
      + case when d.day=current_date
        then coalesce(p.bonus_today_from_payments,d.bonus) else d.bonus end
      - d.penalties::numeric - d.social_fund_day - d.income_tax_day
      + case when d.day<'2026-02-01'::date
        then d.plan_premium else 0::numeric end)::integer
  from daily d
  left join public.v_payroll_today_from_payments p
    on p.employee_id=d.employee_id and p.branch_id=d.branch_id
  union all
  select mso.employee_id, e.branch_id, mso.work_date,
    0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::bigint,
    0::numeric, 0::numeric, 0::numeric,
    round(sum(mso.pairs_made)::numeric * (
      select coalesce(pc.master_piece_rate,150::numeric)
      from public.payroll_config pc order by pc.id limit 1
    ))::integer
  from public.master_shift_output mso
  join public.employees e on e.id=mso.employee_id
  where mso.work_date between p_from and p_to
  group by mso.employee_id, e.branch_id, mso.work_date;
end;
$$;

do $$
declare
  function_record record;
  role_record record;
begin
  select p.proowner,p.proacl into function_record
  from pg_proc p
  where p.oid='public.owner_payroll_daily_fixed(date,date)'::regprocedure;
  revoke all on function public.owner_payroll_daily_fixed(date,date) from public;
  for role_record in
    select distinct r.rolname
    from aclexplode(coalesce(function_record.proacl,
      acldefault('f',function_record.proowner))) a
    join pg_roles r on r.oid=a.grantee
    where a.grantee<>function_record.proowner
  loop
    execute format('revoke all on function public.owner_payroll_daily_fixed(date,date) from %I',
      role_record.rolname);
  end loop;
end;
$$;
grant execute on function public.owner_payroll_daily_fixed(date,date)
  to authenticated,service_role;

notify pgrst,'reload schema';
commit;
