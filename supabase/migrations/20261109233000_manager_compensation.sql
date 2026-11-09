-- Private management compensation. Individual agreements are seeded separately.
begin;

create table crm_security.manager_compensation_object_backup as
select 'function'::text as object_kind,
       format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as object_identity,
       pg_get_functiondef(p.oid) as definition, p.proacl::text as acl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'fn_payroll_close_month_v5', 'admin_net_profit_by_day',
  'fn_finance_summary_todate_v2', 'crm_manager_payroll_by_day'
)
union all
select 'view', format('%I.%I', n.nspname, c.relname), pg_get_viewdef(c.oid), c.relacl::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('v_payroll_monthly', 'v_payroll_monthly_canonical_v5');

create table crm_security.manager_compensation_terms (
  employee_id bigint primary key references public.employees(id),
  auth_user_id uuid not null unique references auth.users(id),
  cost_branch_id bigint not null references public.branches(id),
  effective_from date not null,
  monthly_fixed numeric(14,2) not null check (monthly_fixed >= 0 and monthly_fixed <> 'NaN'::numeric),
  monthly_target numeric(14,2) not null check (monthly_target > 0 and monthly_target <> 'NaN'::numeric),
  monthly_bonus numeric(14,2) not null check (monthly_bonus >= 0 and monthly_bonus <> 'NaN'::numeric),
  owned_branch_ids bigint[] not null check (cardinality(owned_branch_ids) > 0
    and array_position(owned_branch_ids, null) is null and 0 < all(owned_branch_ids)),
  created_at timestamptz not null default now()
);

create table crm_security.manager_compensation_snapshots (
  employee_id bigint not null references crm_security.manager_compensation_terms(employee_id),
  month date not null check (month = date_trunc('month', month)::date),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  closed_at timestamptz not null default now(),
  closed_by uuid,
  primary key (employee_id, month)
);

alter table crm_security.manager_compensation_terms enable row level security;
alter table crm_security.manager_compensation_snapshots enable row level security;
revoke all on crm_security.manager_compensation_terms,
  crm_security.manager_compensation_snapshots from public, anon, authenticated, crm_manager;

create function crm_security.manager_compensation_immutable()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'Management agreements and closed snapshots are immutable'
    using errcode = '55000';
end;
$$;

create trigger manager_compensation_terms_immutable
before update or delete on crm_security.manager_compensation_terms
for each row execute function crm_security.manager_compensation_immutable();
create trigger manager_compensation_snapshots_immutable
before update or delete on crm_security.manager_compensation_snapshots
for each row execute function crm_security.manager_compensation_immutable();
create trigger manager_compensation_terms_no_truncate
before truncate on crm_security.manager_compensation_terms
for each statement execute function crm_security.manager_compensation_immutable();
create trigger manager_compensation_snapshots_no_truncate
before truncate on crm_security.manager_compensation_snapshots
for each statement execute function crm_security.manager_compensation_immutable();

create function public._manager_compensation_calculate(
  p_month date,
  p_employee_id bigint default null,
  p_as_of_date date default (now() at time zone 'Asia/Bishkek')::date
)
returns table (
  employee_id bigint, full_name text, auth_user_id uuid, cost_branch_id bigint,
  month date, "from" date, "to" date, as_of_date date,
  days_in_month integer, active_days integer, accrued_days integer,
  monthly_fixed numeric, fixed_for_period numeric, fixed_accrued numeric,
  target_for_period numeric, net_receipts numeric, refunds numeric, net_revenue numeric,
  bonus_for_period numeric, bonus_earned numeric, provisional_bonus numeric,
  total_accrued numeric, projected_total numeric, maximum_total numeric,
  progress numeric, closed boolean
)
language sql stable security definer
set search_path = pg_catalog, public, crm_security, pg_temp as $$
with period as (
  select date_trunc('month', p_month)::date as month,
         (date_trunc('month', p_month) + interval '1 month - 1 day')::date as month_end
), terms as (
  select t.*, e.full_name, p.month, p.month_end,
         greatest(t.effective_from, p.month) as period_from,
         extract(day from p.month_end)::integer as days_in_month,
         (p.month_end - greatest(t.effective_from, p.month) + 1)::integer as active_days
  from crm_security.manager_compensation_terms t
  join public.employees e on e.id = t.employee_id
  cross join period p
  where t.effective_from <= p.month_end
    and (p_employee_id is null or t.employee_id = p_employee_id)
), live as (
  select t.*,
         greatest(0, least(p_as_of_date, t.month_end) - t.period_from + 1)::integer as accrued_days,
         round(t.monthly_fixed * t.active_days / t.days_in_month, 2) as fixed_for_period,
         round(t.monthly_target * t.active_days / t.days_in_month, 2) as target_for_period,
         round(t.monthly_bonus * t.active_days / t.days_in_month, 2) as bonus_for_period,
         coalesce(m.receipts, 0)::numeric as net_receipts,
         coalesce(m.refunds, 0)::numeric as refunds
  from terms t
  left join lateral (
    select sum(ev.amount) filter (where ev.amount > 0) as receipts,
           -sum(ev.amount) filter (where ev.amount < 0) as refunds
    from public.v_finance_money_events ev
    where ev.branch_id = any(t.owned_branch_ids)
      and ev.occurred_at >= (t.period_from::timestamp at time zone 'Asia/Bishkek')
      and ev.occurred_at < ((least(t.month_end, p_as_of_date) + 1)::timestamp at time zone 'Asia/Bishkek')
  ) m on true
), amounts as (
  select l.*,
         round(l.monthly_fixed * l.accrued_days / l.days_in_month, 2) as fixed_accrued,
         l.net_receipts - l.refunds as net_revenue,
         case when l.net_receipts - l.refunds >= l.target_for_period
              then l.bonus_for_period else 0::numeric end as provisional_bonus
  from live l
), earned as (
  select a.*,
         case when p_as_of_date > a.month_end then a.provisional_bonus
              else 0::numeric end as bonus_earned
  from amounts a
), rows as (
  select a.employee_id, a.full_name, a.auth_user_id, a.cost_branch_id,
         a.month, a.period_from as "from", a.month_end as "to", p_as_of_date as as_of_date,
         a.days_in_month, a.active_days, a.accrued_days,
         a.monthly_fixed, a.fixed_for_period, a.fixed_accrued,
         a.target_for_period, a.net_receipts, a.refunds, a.net_revenue,
         a.bonus_for_period, a.bonus_earned, a.provisional_bonus,
         a.fixed_accrued + a.bonus_earned as total_accrued,
         a.fixed_for_period + a.provisional_bonus as projected_total,
         a.fixed_for_period + a.bonus_for_period as maximum_total,
         round(greatest(0::numeric, least(100::numeric,
           100 * a.net_revenue / a.target_for_period)), 2) as progress,
         false as closed
  from earned a
), selected as (
  select r.employee_id,
         coalesce(s.payload, to_jsonb(r)) as payload
  from rows r
  left join crm_security.manager_compensation_snapshots s
    on s.employee_id = r.employee_id and s.month = r.month
)
select s.employee_id, x.full_name, x.auth_user_id, x.cost_branch_id,
       x.month, x."from", x."to", x.as_of_date,
       x.days_in_month, x.active_days, x.accrued_days,
       x.monthly_fixed, x.fixed_for_period, x.fixed_accrued,
       x.target_for_period, x.net_receipts, x.refunds, x.net_revenue,
       x.bonus_for_period, x.bonus_earned, x.provisional_bonus,
       x.total_accrued, x.projected_total, x.maximum_total, x.progress, x.closed
from selected s
cross join lateral jsonb_to_record(s.payload) as x(
  full_name text, auth_user_id uuid, cost_branch_id bigint,
  month date, "from" date, "to" date, as_of_date date,
  days_in_month integer, active_days integer, accrued_days integer,
  monthly_fixed numeric, fixed_for_period numeric, fixed_accrued numeric,
  target_for_period numeric, net_receipts numeric, refunds numeric, net_revenue numeric,
  bonus_for_period numeric, bonus_earned numeric, provisional_bonus numeric,
  total_accrued numeric, projected_total numeric, maximum_total numeric,
  progress numeric, closed boolean
);
$$;

create function public._manager_compensation_daily(
  p_from date, p_to date,
  p_as_of_date date default (now() at time zone 'Asia/Bishkek')::date
)
returns table (employee_id bigint, branch_id bigint, day date,
               fixed_day numeric, bonus_day numeric, management_day numeric)
language sql stable security definer
set search_path = pg_catalog, public, crm_security, pg_temp as $$
with months as (
  select gs::date as month
  from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') gs
), days as (
  select c.*, gs::date as day
  from months m
  cross join lateral public._manager_compensation_calculate(m.month, null, p_as_of_date) c
  cross join lateral generate_series(c."from", c."from" + c.accrued_days - 1, interval '1 day') gs
  where gs::date between p_from and p_to
), amounts as (
  select d.employee_id, d.cost_branch_id as branch_id, d.day,
         round(d.monthly_fixed * (d.day - d."from" + 1) / d.days_in_month, 2)
           - round(d.monthly_fixed * (d.day - d."from") / d.days_in_month, 2) as fixed_day,
         case when d.day = d."to" then d.bonus_earned else 0::numeric end as bonus_day
  from days d
)
select a.employee_id, a.branch_id, a.day, a.fixed_day, a.bonus_day,
       a.fixed_day + a.bonus_day as management_day
from amounts a;
$$;

create function public.get_manager_compensation(p_month date, p_auth_user_id uuid default null)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, crm_security, auth, pg_temp as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (session_user = 'postgres' and current_setting('role', true) in ('', 'none', 'postgres')) then
    raise exception 'Server access required' using errcode = '42501';
  end if;
  if p_month is null then
    raise exception 'Month is required' using errcode = '22004';
  end if;
  select coalesce(jsonb_agg(to_jsonb(c) - 'auth_user_id' order by c.employee_id), '[]'::jsonb)
    into v_result
  from public._manager_compensation_calculate(v_month) c
  where p_auth_user_id is null or c.auth_user_id = p_auth_user_id;
  return jsonb_build_object('month', v_month,
    'as_of_date', (now() at time zone 'Asia/Bishkek')::date, 'rows', v_result);
end;
$$;

create function public._manager_compensation_freeze(p_month date)
returns integer language plpgsql security definer
set search_path = pg_catalog, public, crm_security, auth, pg_temp as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_inserted integer;
begin
  if p_month is null or v_month >= public.fn_current_business_month() then
    raise exception 'Only completed months can be frozen' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('payroll-close:' || v_month, 0));
  if exists (
    select 1 from public.payroll_entries e where e.period = v_month
  ) and exists (
    select 1 from public._manager_compensation_calculate(v_month) c where not c.closed
  ) then
    raise exception 'Closed payroll month has no matching management snapshot' using errcode = '55000';
  end if;
  insert into crm_security.manager_compensation_snapshots(employee_id, month, payload, closed_by)
  select c.employee_id, c.month, to_jsonb(c) || jsonb_build_object('closed', true), auth.uid()
  from public._manager_compensation_calculate(v_month, null,
    greatest((now() at time zone 'Asia/Bishkek')::date, (v_month + interval '1 month')::date)) c
  on conflict (employee_id, month) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- Monthly totals and financial integration follow below.

create function public._manager_compensation_monthly(p_month date, p_employee_id bigint)
returns table (employee_id bigint, month date, cost_branch_id bigint,
               management_fixed numeric, management_bonus numeric, management_total numeric)
language plpgsql stable security definer
set search_path = pg_catalog, public, crm_security, auth, pg_temp as $$
begin
  perform public._refocus_require_owner();
  return query
  select c.employee_id, c.month, c.cost_branch_id,
         c.fixed_accrued, c.bonus_earned, c.total_accrued
  from public._manager_compensation_calculate(p_month, p_employee_id) c;
end;
$$;

create or replace view public.v_payroll_monthly as
with daily as (
  select d.employee_id, date_trunc('month', d.day)::date as month,
         min(d.branch_id) as fallback_branch_id,
         sum(d.hours) as hours_total, sum(d.hour_pay) as hour_pay_total,
         sum(d.bonus) as bonus_total, sum(d.penalties) as penalties_total,
         sum(d.social_fund_day) as social_fund_total,
         sum(d.income_tax_day) as income_tax_total,
         sum(d.plan_premium) as plan_premium_total,
         sum(d.net_day) as net_fixed_sum
  from public.v_payroll_daily_fixed d
  group by d.employee_id, date_trunc('month', d.day)::date
), adjustments as (
  select a.employee_id, a.month, min(a.branch_id) as fallback_branch_id,
         sum(a.adjustments_sum) as adjustments_sum
  from public.v_payroll_adjustments_monthly a
  group by a.employee_id, a.month
), management as (
  select c.employee_id, c.month, c.cost_branch_id as fallback_branch_id,
         c.management_fixed, c.management_bonus, c.management_total
  from crm_security.manager_compensation_terms t
  cross join lateral generate_series(
    date_trunc('month', t.effective_from),
    date_trunc('month', now() at time zone 'Asia/Bishkek'), interval '1 month'
  ) m
  cross join lateral public._manager_compensation_monthly(m::date, t.employee_id) c
), keys as (
  select employee_id, month from daily
  union select employee_id, month from adjustments
  union select employee_id, month from management
)
select k.employee_id,
       coalesce(e.branch_id, d.fallback_branch_id, a.fallback_branch_id, g.fallback_branch_id) as branch_id,
       k.month,
       coalesce(d.hours_total, 0::numeric) as hours_total,
       coalesce(d.hour_pay_total, 0::numeric) as hour_pay_total,
       coalesce(d.bonus_total, 0::numeric) as bonus_total,
       coalesce(d.penalties_total, 0::numeric) as penalties_total,
       coalesce(d.social_fund_total, 0::numeric) as social_fund_total,
       coalesce(d.income_tax_total, 0::numeric) as income_tax_total,
       coalesce(d.plan_premium_total, 0::numeric) as plan_premium_total,
       coalesce(a.adjustments_sum, 0::numeric) as adjustments_sum,
       coalesce(d.net_fixed_sum, 0)::numeric + coalesce(a.adjustments_sum, 0::numeric)
         + coalesce(g.management_total, 0::numeric) as net_total,
       coalesce(g.management_fixed, 0::numeric) as management_fixed,
       coalesce(g.management_bonus, 0::numeric) as management_bonus,
       coalesce(g.management_total, 0::numeric) as management_total
from keys k
left join daily d on d.employee_id = k.employee_id and d.month = k.month
left join adjustments a on a.employee_id = k.employee_id and a.month = k.month
left join management g on g.employee_id = k.employee_id and g.month = k.month
left join public.employees e on e.id = k.employee_id
where public._payroll_is_owner_strict_v5();

create or replace view public.v_payroll_monthly_canonical_v5 as
with manual as (
  select employee_id, month, sum(adjustments_sum) as manual_adjustments
  from public.v_payroll_adjustments_monthly_base group by employee_id, month
), final_plan as (
  select employee_id, month, sum(payout_amount) as v5_plan_payout
  from public.payroll_plan_payouts_v5 group by employee_id, month
)
select m.employee_id, m.branch_id, m.month, m.hours_total, m.hour_pay_total,
       m.bonus_total, m.penalties_total, m.social_fund_total, m.income_tax_total,
       m.plan_premium_total, m.adjustments_sum, m.net_total,
       coalesce(x.manual_adjustments, 0::numeric) as manual_adjustments,
       coalesce(fp.v5_plan_payout, 0::numeric) as v5_plan_payout,
       m.management_fixed, m.management_bonus, m.management_total
from public.v_payroll_monthly m
left join manual x on x.employee_id = m.employee_id and x.month = m.month
left join final_plan fp on fp.employee_id = m.employee_id and fp.month = m.month
where public._payroll_is_owner_strict_v5();





-- Generated integration below. Source SQL is preserved in the private rollback backup.

CREATE OR REPLACE FUNCTION public.fn_payroll_close_month_v5(p_month date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_catalog'
AS $function$
DECLARE
  v_month date := date_trunc('month', p_month)::date;
  v_activation date;
  v_uses_v5 boolean;
  v_new_payout_rows integer := 0;
  v_plan_rows integer := 0;
  v_final_payout_rows integer := 0;
  v_source_rows integer := 0;
  v_inserted integer := 0;
  v_closed_at timestamptz := now();
BEGIN
  PERFORM public._refocus_require_owner();
  IF p_month IS NULL THEN
    RAISE EXCEPTION 'month is required' USING ERRCODE = '22004';
  END IF;
  IF v_month >= public.fn_current_business_month() THEN
    RAISE EXCEPTION 'Only a completed month can be closed'
      USING ERRCODE = '22023';
  END IF;

  -- Shared with the adjustment and archive-insert guards. No adjustment can
  -- pass its "not closed yet" check between the source SELECT and archive INSERT.
  PERFORM pg_advisory_xact_lock(hashtextextended('payroll-close:' || v_month, 0));
  PERFORM public._manager_compensation_freeze(v_month);

  SELECT activation_month INTO v_activation
  FROM public.payroll_incentive_v5_config WHERE id = 1;
  v_uses_v5 := v_month >= v_activation;
  IF v_uses_v5 THEN
    v_new_payout_rows := public._payroll_finalize_payouts_v5_internal(v_month);
    PERFORM public._payroll_assert_month_ready_v5(v_month, true);
    SELECT count(*) INTO v_plan_rows
    FROM public.payroll_branch_plans_v5 p WHERE p.month = v_month;
    SELECT count(*) INTO v_final_payout_rows
    FROM public.payroll_plan_payouts_v5 p WHERE p.month = v_month;
  END IF;

  SELECT count(*) INTO v_source_rows
  FROM public.v_payroll_monthly_canonical_v5 m
  WHERE m.month = v_month;
  IF v_source_rows = 0 THEN
    RAISE EXCEPTION 'No canonical payroll rows exist for month %', v_month
      USING ERRCODE = '22023';
  END IF;

  WITH source AS (
    SELECT
      m.*,
      (
        m.plan_premium_total
        + GREATEST(0, m.adjustments_sum - m.manual_adjustments)
      )::numeric AS plan_incentive_total,
      (
        m.bonus_total
        + m.plan_premium_total
        + GREATEST(0, m.adjustments_sum - m.manual_adjustments)
        + m.manual_adjustments
        + m.management_bonus
      )::numeric AS archived_bonus_total,
      (
        m.net_total
        + m.penalties_total
        + m.social_fund_total
        + m.income_tax_total
      )::numeric AS archived_gross_total
    FROM public.v_payroll_monthly_canonical_v5 m
    WHERE m.month = v_month
  )
  INSERT INTO public.payroll_entries(
    employee_id, branch_id, period, base_salary, bonus,
    hours_worked, hourly_rate, bonus_from_sales, daily_bonus, bonus_total,
    gross_total, social_fund, income_tax, net_total, snapshot
  )
  SELECT
    m.employee_id::integer,
    m.branch_id::integer,
    v_month,
    m.archived_gross_total - m.archived_bonus_total,
    m.bonus_total,
    m.hours_total,
    CASE WHEN m.hours_total > 0 THEN m.hour_pay_total / m.hours_total ELSE NULL END,
    m.bonus_total,
    m.plan_incentive_total + m.manual_adjustments + m.management_bonus,
    m.archived_bonus_total,
    m.archived_gross_total,
    m.social_fund_total,
    m.income_tax_total,
    m.net_total,
    jsonb_build_object(
      'schema_version', 'payroll-close-v5-atomic',
      'source', 'v_payroll_monthly_canonical_v5',
      'incentive_source', CASE WHEN v_uses_v5 THEN 'v5_finalized' ELSE 'legacy' END,
      'closed_at', v_closed_at,
      'closed_by', auth.uid(),
      'employee_id', m.employee_id,
      'branch_id', m.branch_id,
      'month', m.month,
      'hours_total', m.hours_total,
      'hour_pay_total', m.hour_pay_total,
      'bonus_total', m.bonus_total,
      'penalties_total', m.penalties_total,
      'social_fund_total', m.social_fund_total,
      'income_tax_total', m.income_tax_total,
      'plan_premium_total', m.plan_premium_total,
      'adjustments_sum', m.adjustments_sum,
      'manual_adjustments', m.manual_adjustments,
      'v5_plan_payout', m.v5_plan_payout,
      'plan_incentive_total', m.plan_incentive_total,
      'archived_bonus_total', m.archived_bonus_total,
      'archived_gross_total', m.archived_gross_total,
      'management_fixed', m.management_fixed,
      'management_bonus', m.management_bonus,
      'management_total', m.management_total,
      'manager_compensation', (
        SELECT to_jsonb(c) - 'auth_user_id'
        FROM public._manager_compensation_calculate(v_month, m.employee_id) c
      ),
      'net_total', m.net_total
    )
  FROM source m
  ON CONFLICT (employee_id, period) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN jsonb_build_object(
    'ok', true,
    'month', v_month,
    'inserted', v_inserted,
    'skipped', v_source_rows - v_inserted,
    'source_rows', v_source_rows,
    'source', CASE WHEN v_uses_v5 THEN 'v5_finalized' ELSE 'legacy' END,
    'preparation', jsonb_build_object(
      'activation_month', v_activation,
      'uses_v5', v_uses_v5,
      'new_payout_rows', v_new_payout_rows,
      'frozen_plan_rows', v_plan_rows,
      'final_payout_rows', v_final_payout_rows,
      'ready', true
    )
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_net_profit_by_day(from_dt date, to_dt date, branches text[] DEFAULT NULL::text[])
 RETURNS TABLE(day date, orders_count integer, income numeric, refunds numeric, opex_total numeric, cogs_total numeric, payroll_total numeric, net_profit numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._refocus_require_owner();
  RETURN QUERY
  WITH
  days AS ( SELECT gs::date AS d FROM generate_series(from_dt, to_dt, interval '1 day') gs ),
  branch_ids AS ( SELECT b.id FROM branches b WHERE branches IS NOT NULL AND b.name = ANY(branches) ),
  orders_f AS ( SELECT o.id, o.branch_id FROM orders o WHERE branches IS NULL OR o.branch_id IN (SELECT id FROM branch_ids) ),
  payments_f AS ( SELECT p.order_id, p.amount, p.created_at, o.branch_id FROM payments p JOIN orders_f o ON o.id = p.order_id ),
  refunds_f AS ( SELECT r.order_id, r.amount, r.created_at FROM refunds r JOIN orders_f o ON o.id = r.order_id WHERE COALESCE(r.status,'done') = 'done' ),
  expenses_f AS ( SELECT e.amount, e.expense_date FROM expenses e WHERE branches IS NULL OR e.branch_id IN (SELECT id FROM branch_ids) ),
  opex_daily_active AS ( SELECT dr.daily_rate, dr.branch_id FROM opex_daily_rates dr WHERE dr.is_active AND (branches IS NULL OR dr.branch_id IN (SELECT id FROM branch_ids)) AND dr.branch_id IN (SELECT DISTINCT branch_id FROM orders_f) ),
  branch_cogs_rate AS ( SELECT r.branch_id, SUM(r.amount_per_order) AS rate_per_order FROM cogs_per_order_rates r
        WHERE r.is_active AND (branches IS NULL OR r.branch_id IN (SELECT id FROM branch_ids))
          AND NOT (lower(translate(r.item,'ёЁ','ее')) ~ 'линз|lens') GROUP BY r.branch_id ),
  lens_cogs_by_day AS ( SELECT o.created_at::date AS d, SUM(public._order_lens_cogs(o.id)) AS lens_cogs
        FROM orders o
        WHERE (branches IS NULL OR o.branch_id IN (SELECT id FROM branch_ids))
          AND o.is_deleted = false AND o.created_at::date BETWEEN from_dt AND to_dt
        GROUP BY o.created_at::date ),
  income_by_day AS ( SELECT d.d, COALESCE(SUM(p.amount) FILTER (WHERE p.amount > 0), 0) AS income FROM days d LEFT JOIN payments_f p ON p.created_at::date = d.d GROUP BY d.d ),
  refunds_by_day AS ( SELECT d.d, COALESCE(SUM(r.amount), 0) AS refunds FROM days d LEFT JOIN refunds_f r ON r.created_at::date = d.d GROUP BY d.d ),
  orders_by_day AS ( SELECT d.d, COALESCE(COUNT(DISTINCT p.order_id) FILTER (WHERE p.amount > 0), 0)::int AS orders_count FROM days d LEFT JOIN payments_f p ON p.created_at::date = d.d GROUP BY d.d ),
  opex_manual_by_day AS ( SELECT d.d, COALESCE(SUM(e.amount), 0) AS opex_manual FROM days d LEFT JOIN expenses_f e ON e.expense_date = d.d GROUP BY d.d ),
  opex_daily_by_day AS ( SELECT d.d, COALESCE(SUM(r.daily_rate), 0) AS opex_daily FROM days d LEFT JOIN opex_daily_active r ON TRUE GROUP BY d.d ),
  opex_total_by_day AS ( SELECT d.d, (om.opex_manual + od.opex_daily) AS opex_total FROM days d LEFT JOIN opex_manual_by_day om ON om.d = d.d LEFT JOIN opex_daily_by_day od ON od.d = d.d ),
  cogs_by_day AS ( SELECT d.d, COALESCE(SUM(bcr.rate_per_order), 0) + COALESCE(MAX(lcd.lens_cogs), 0) AS cogs_total
        FROM days d
        LEFT JOIN payments_f p ON p.created_at::date = d.d
        LEFT JOIN branch_cogs_rate bcr ON bcr.branch_id = p.branch_id
        LEFT JOIN lens_cogs_by_day lcd ON lcd.d = d.d
        GROUP BY d.d ),
  payroll_rules_f AS ( SELECT pr.base_per_day, pr.bonus_per_order FROM payroll_rules pr WHERE pr.is_active AND (branches IS NULL OR pr.branch_id IN (SELECT id FROM branch_ids)) ),
  base_payroll_by_day AS (
    SELECT d.d, COALESCE(SUM(pr.base_per_day), 0)
      + COALESCE(SUM(pr.bonus_per_order), 0) * COALESCE(ob.orders_count, 0) AS payroll_total
    FROM days d LEFT JOIN payroll_rules_f pr ON TRUE
    LEFT JOIN orders_by_day ob ON ob.d = d.d GROUP BY d.d, ob.orders_count
  ),
  management_by_day AS (
    SELECT c.day, SUM(c.management_day) AS management_total
    FROM public._manager_compensation_daily(from_dt, to_dt) c
    WHERE branches IS NULL OR c.branch_id IN (SELECT id FROM branch_ids)
    GROUP BY c.day
  ),
  payroll_by_day AS (
    SELECT b.d, b.payroll_total + COALESCE(m.management_total, 0) AS payroll_total
    FROM base_payroll_by_day b LEFT JOIN management_by_day m ON m.day = b.d
  )
  SELECT d.d AS day, ob.orders_count, ibd.income, rbd.refunds, otd.opex_total, cbd.cogs_total, pbd.payroll_total,
    ibd.income - rbd.refunds - otd.opex_total - cbd.cogs_total - pbd.payroll_total AS net_profit
  FROM days d
  LEFT JOIN income_by_day ibd ON ibd.d = d.d
  LEFT JOIN refunds_by_day rbd ON rbd.d = d.d
  LEFT JOIN orders_by_day ob ON ob.d = d.d
  LEFT JOIN opex_total_by_day otd ON otd.d = d.d
  LEFT JOIN cogs_by_day cbd ON cbd.d = d.d
  LEFT JOIN payroll_by_day pbd ON pbd.d = d.d
  ORDER BY d.d;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_finance_summary_todate_v2(p_branch_id integer, p_month date, p_today date)
 RETURNS TABLE(days_elapsed integer, orders_count integer, total_income numeric, total_refunds numeric, opex_total numeric, cogs_total numeric, payroll_total numeric, net_profit numeric, avg_frame_check numeric, avg_lens_check numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_start     date := date_trunc('month', p_month)::date;
  v_month_end date := (v_start + interval '1 month - 1 day')::date;
  v_end       date := LEAST(p_today, v_month_end);
  v_days      int  := (v_end - v_start + 1);
BEGIN
  PERFORM public._refocus_require_owner();
  RETURN QUERY
  WITH
  income AS (
    SELECT COALESCE(SUM(p.amount), 0) AS v
    FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE (o.branch_id = p_branch_id OR p_branch_id = 0)
      AND p.amount > 0
      AND p.created_at >= v_start AND p.created_at <  (v_end + 1)
  ),
  refunds AS (
    SELECT COALESCE(SUM(r.amount), 0) AS v
    FROM refunds r JOIN orders o ON o.id = r.order_id
    WHERE (o.branch_id = p_branch_id OR p_branch_id = 0)
      AND COALESCE(r.status,'done') = 'done'
      AND r.created_at >= v_start AND r.created_at <  (v_end + 1)
  ),
  orders_cte AS (
    SELECT COUNT(DISTINCT p.order_id)::int AS cnt
    FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE (o.branch_id = p_branch_id OR p_branch_id = 0)
      AND p.amount > 0
      AND p.created_at >= v_start AND p.created_at <  (v_end + 1)
  ),
  opex_daily AS ( SELECT COALESCE(SUM(d.daily_rate), 0) * v_days AS v FROM opex_daily_rates d WHERE (d.branch_id = p_branch_id OR p_branch_id = 0) AND d.is_active ),
  opex_manual AS ( SELECT COALESCE(SUM(e.amount), 0) AS v FROM expenses e WHERE (e.branch_id = p_branch_id OR p_branch_id = 0) AND e.expense_date >= v_start AND e.expense_date < (v_end + 1) ),
  opex AS ( SELECT (SELECT v FROM opex_daily) + (SELECT v FROM opex_manual) AS v ),
  cogs_nonlens AS (
    SELECT COALESCE(SUM(rate.per_order_rate * COALESCE(cnt.branch_orders, 0)), 0) AS v
    FROM (
      SELECT r.branch_id, SUM(r.amount_per_order) AS per_order_rate
      FROM cogs_per_order_rates r
      WHERE (r.branch_id = p_branch_id OR p_branch_id = 0) AND r.is_active
        AND NOT (lower(translate(r.item,'ёЁ','ее')) ~ 'линз|lens')
      GROUP BY r.branch_id
    ) rate
    LEFT JOIN (
      SELECT o.branch_id, COUNT(DISTINCT p.order_id) AS branch_orders
      FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE (o.branch_id = p_branch_id OR p_branch_id = 0)
        AND p.amount > 0
        AND p.created_at >= v_start AND p.created_at < (v_end + 1)
      GROUP BY o.branch_id
    ) cnt ON cnt.branch_id = rate.branch_id
  ),
  lens_real AS (
    SELECT COALESCE(SUM(public._order_lens_cogs(o.id)), 0) AS v
    FROM ( SELECT DISTINCT o.id
           FROM payments p JOIN orders o ON o.id = p.order_id
           WHERE (o.branch_id = p_branch_id OR p_branch_id = 0)
             AND p.amount > 0
             AND p.created_at >= v_start AND p.created_at < (v_end + 1) ) o
  ),
  cogs AS ( SELECT (SELECT v FROM cogs_nonlens) + (SELECT v FROM lens_real) AS v ),
  payroll_fixed AS ( SELECT COALESCE(SUM(pr.base_per_day), 0) * v_days AS v FROM payroll_rules pr WHERE (pr.branch_id = p_branch_id OR p_branch_id = 0) AND pr.is_active ),
  payroll_bonus AS ( SELECT COALESCE(SUM(pr.bonus_per_order), 0) * (SELECT cnt FROM orders_cte) AS v FROM payroll_rules pr WHERE (pr.branch_id = p_branch_id OR p_branch_id = 0) AND pr.is_active ),
  management AS (
    SELECT COALESCE(SUM(c.management_day), 0) AS v
    FROM public._manager_compensation_daily(v_start, v_end) c
    WHERE p_branch_id = 0 OR c.branch_id = p_branch_id
  ),
  payroll AS (
    SELECT (SELECT v FROM payroll_fixed) + (SELECT v FROM payroll_bonus)
      + (SELECT v FROM management) AS v
  ),
  paid_orders AS (
    SELECT DISTINCT p.order_id
    FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE (o.branch_id = p_branch_id OR p_branch_id = 0)
      AND p.amount > 0
      AND p.created_at >= v_start AND p.created_at <  (v_end + 1)
  ),
  frame_lens_per_order AS (
    SELECT oi.order_id,
      SUM(CASE WHEN oi.item_type = 'frame' THEN COALESCE(oi.price, 0) * COALESCE(oi.qty, 1) ELSE 0 END) AS frame_sum,
      SUM(CASE WHEN oi.item_type = 'lens'  THEN COALESCE(oi.price, 0) * COALESCE(oi.qty, 1) ELSE 0 END) AS lens_sum
    FROM order_items oi
    WHERE oi.order_id IN (SELECT order_id FROM paid_orders)
    GROUP BY oi.order_id
  ),
  frame_lens_totals AS (
    SELECT COALESCE(SUM(frame_sum), 0)::numeric AS total_frame_amount,
      COALESCE(SUM(lens_sum),  0)::numeric AS total_lens_amount,
      COUNT(*) FILTER (WHERE frame_sum > 0) AS frame_orders_count,
      COUNT(*) FILTER (WHERE lens_sum  > 0) AS lens_orders_count
    FROM frame_lens_per_order
  )
  SELECT
    v_days, (SELECT cnt FROM orders_cte), (SELECT v FROM income), (SELECT v FROM refunds),
    (SELECT v FROM opex), (SELECT v FROM cogs), (SELECT v FROM payroll),
    (SELECT v FROM income) - (SELECT v FROM refunds) - (SELECT v FROM opex) - (SELECT v FROM cogs) - (SELECT v FROM payroll) AS net_profit,
    CASE WHEN (SELECT frame_orders_count FROM frame_lens_totals) > 0 THEN ROUND((SELECT total_frame_amount FROM frame_lens_totals) / NULLIF((SELECT frame_orders_count FROM frame_lens_totals), 0)) ELSE 0 END,
    CASE WHEN (SELECT lens_orders_count FROM frame_lens_totals) > 0 THEN ROUND((SELECT total_lens_amount FROM frame_lens_totals) / NULLIF((SELECT lens_orders_count FROM frame_lens_totals), 0)) ELSE 0 END;
END;
$function$
;

-- The existing aggregate endpoint gains one explicitly named management column.
-- Its identity is unchanged and it has no SQL dependants.
drop function public.crm_manager_payroll_by_day(date, date, bigint[]);
create function public.crm_manager_payroll_by_day(p_from date, p_to date, p_branch_ids bigint[] default null)
returns table (day date, branch_id bigint, hours numeric, hour_pay numeric,
               bonus numeric, penalties numeric, net_day numeric, management_day numeric)
language plpgsql stable security definer
set search_path = pg_catalog, public, crm_security, auth, pg_temp as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server access required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  return query
  with source as (
    select p.day, p.branch_id, p.hours, p.hour_pay, p.bonus, p.penalties,
           p.net_day, 0::numeric as management_day
    from public.payroll_daily_canonical(p_from, p_to, null::bigint, null::bigint) p
    where p.day between p_from and p_to
      and (p_branch_ids is null or p.branch_id = any(p_branch_ids))
    union all
    select c.day, c.branch_id, 0::numeric, 0::numeric, 0::numeric,
           0::numeric, c.management_day, c.management_day
    from public._manager_compensation_daily(p_from, p_to) c
    where p_branch_ids is null or c.branch_id = any(p_branch_ids)
  )
  select s.day, s.branch_id, sum(coalesce(s.hours, 0)), sum(coalesce(s.hour_pay, 0)),
         sum(coalesce(s.bonus, 0)), sum(coalesce(s.penalties, 0)),
         sum(coalesce(s.net_day, 0)), sum(coalesce(s.management_day, 0))
  from source s group by s.day, s.branch_id order by s.day, s.branch_id;
end;
$$;


-- Global legacy default privileges include several API roles. Remove every
-- inherited explicit grant before allowing the reviewed entry points.
do $$
declare
  object_record record;
  role_record record;
begin
  for object_record in
    select p.oid, p.proowner, p.proacl, format('%I.%I(%s)', n.nspname, p.proname,
      pg_get_function_identity_arguments(p.oid)) as identity
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname in (
      '_manager_compensation_calculate', '_manager_compensation_daily',
      '_manager_compensation_monthly', '_manager_compensation_freeze',
      'get_manager_compensation', 'crm_manager_payroll_by_day'
    )) or (n.nspname = 'crm_security' and p.proname = 'manager_compensation_immutable')
  loop
    execute format('revoke all on function %s from public', object_record.identity);
    for role_record in
      select distinct r.rolname
      from aclexplode(coalesce(object_record.proacl, acldefault('f', object_record.proowner))) a
      join pg_roles r on r.oid = a.grantee where a.grantee <> object_record.proowner
    loop
      execute format('revoke all on function %s from %I', object_record.identity, role_record.rolname);
    end loop;
  end loop;
  for object_record in
    select c.oid, c.relowner, c.relacl, format('%I.%I', n.nspname, c.relname) as identity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'crm_security' and c.relname in (
      'manager_compensation_terms', 'manager_compensation_snapshots',
      'manager_compensation_object_backup'
    )
  loop
    execute format('revoke all on table %s from public', object_record.identity);
    for role_record in
      select distinct r.rolname
      from aclexplode(coalesce(object_record.relacl, acldefault('r', object_record.relowner))) a
      join pg_roles r on r.oid = a.grantee where a.grantee <> object_record.relowner
    loop
      execute format('revoke all on table %s from %I', object_record.identity, role_record.rolname);
    end loop;
  end loop;
end;
$$;

grant execute on function public.get_manager_compensation(date, uuid),
  public.crm_manager_payroll_by_day(date, date, bigint[]) to service_role;
grant execute on function public._manager_compensation_monthly(date, bigint)
  to authenticated, service_role;
notify pgrst, 'reload schema';

commit;
