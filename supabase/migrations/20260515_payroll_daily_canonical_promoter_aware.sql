-- payroll_daily_canonical: для role='promoter' обнуляем штрафы, соц.фонд и НДФЛ.
-- bonus, hour_pay и paid_sum остаются без изменений (промоутер получает свой % с продаж,
-- сделанных в период его смены — логика времени смены уже корректна).
CREATE OR REPLACE FUNCTION public.payroll_daily_canonical(
  p_from date DEFAULT NULL::date,
  p_to date DEFAULT NULL::date,
  p_branch_id bigint DEFAULT NULL::bigint,
  p_employee_id bigint DEFAULT NULL::bigint
)
 RETURNS TABLE(
   employee_id bigint,
   full_name text,
   branch_id bigint,
   day date,
   hours numeric,
   hourly_rate numeric,
   hour_pay numeric,
   paid_sum numeric,
   bonus_percent numeric,
   bonus numeric,
   penalties numeric,
   social_fund_day numeric,
   income_tax_day numeric,
   net_day numeric
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH emp AS (
  SELECT
    e.id::bigint AS employee_id,
    e.full_name,
    e.branch_id::bigint AS branch_id,
    e.role::text AS role,
    COALESCE(pp.hourly_rate,   e.hourly_rate,         0)::numeric AS hourly_rate,
    COALESCE(pp.has_bonus,     e.has_bonus,       false)           AS has_bonus,
    COALESCE(pp.bonus_percent, e.bonus_percent::numeric, 0)::numeric AS bonus_percent
  FROM public.employees e
  LEFT JOIN public.employee_payroll_profiles pp
    ON pp.employee_id = e.id
   AND COALESCE(pp.active, true) = true
  WHERE COALESCE(e.is_active, true) = true
    AND (p_branch_id   IS NULL OR e.branch_id = p_branch_id)
    AND (p_employee_id IS NULL OR e.id        = p_employee_id)
),
session_day AS (
  SELECT
    s.employee_id::bigint AS employee_id,
    s.branch_id::bigint   AS branch_id,
    (COALESCE((s.ended_at AT TIME ZONE 'UTC'), s.opened_at, s.started_at)
       AT TIME ZONE 'Asia/Bishkek')::date AS day,
    SUM(
      GREATEST(0, LEAST(
        EXTRACT(epoch FROM (COALESCE((s.ended_at AT TIME ZONE 'UTC'), now()) - s.started_at)) / 3600.0,
        16
      ))
    )::numeric AS hours
  FROM public.attendance_sessions s
  WHERE COALESCE(s.end_reason, '') <> 'demo_cleanup'
    AND COALESCE(s.status, 'open') NOT IN ('cancelled', 'demo')
    AND (p_branch_id   IS NULL OR s.branch_id = p_branch_id)
    AND (p_employee_id IS NULL OR s.employee_id = p_employee_id)
    AND (p_from IS NULL
         OR (COALESCE((s.ended_at AT TIME ZONE 'UTC'), s.opened_at, s.started_at)
              AT TIME ZONE 'Asia/Bishkek')::date >= p_from)
    AND (p_to IS NULL
         OR (COALESCE((s.ended_at AT TIME ZONE 'UTC'), s.opened_at, s.started_at)
              AT TIME ZONE 'Asia/Bishkek')::date <= p_to)
  GROUP BY 1, 2, 3
),
payment_day AS (
  SELECT
    o.seller_employee_id::bigint AS employee_id,
    o.branch_id::bigint          AS branch_id,
    (COALESCE(p.created_at, (p.paid_at AT TIME ZONE 'UTC'))
       AT TIME ZONE 'Asia/Bishkek')::date AS day,
    SUM(p.amount)::numeric AS paid_sum
  FROM public.payments p
  JOIN public.orders   o ON o.id = p.order_id
  WHERE o.is_deleted IS DISTINCT FROM TRUE
    AND o.seller_employee_id IS NOT NULL
    AND (COALESCE(p.created_at, (p.paid_at AT TIME ZONE 'UTC'))
           AT TIME ZONE 'Asia/Bishkek')::date < DATE '2026-04-18'
    AND (p_branch_id   IS NULL OR o.branch_id            = p_branch_id)
    AND (p_employee_id IS NULL OR o.seller_employee_id   = p_employee_id)
    AND (p_from IS NULL
         OR (COALESCE(p.created_at, (p.paid_at AT TIME ZONE 'UTC'))
              AT TIME ZONE 'Asia/Bishkek')::date >= p_from)
    AND (p_to IS NULL
         OR (COALESCE(p.created_at, (p.paid_at AT TIME ZONE 'UTC'))
              AT TIME ZONE 'Asia/Bishkek')::date <= p_to)
  GROUP BY 1, 2, 3

  UNION ALL

  SELECT
    sess.employee_id::bigint AS employee_id,
    sess.branch_id::bigint   AS branch_id,
    (pay.paid_local)::date   AS day,
    SUM(pay.amount)::numeric AS paid_sum
  FROM public.v_paid_sales_per_payment pay
  JOIN public.attendance_sessions sess
    ON sess.branch_id = pay.branch_id
   AND pay.paid_local >= (sess.started_at AT TIME ZONE 'Asia/Bishkek')
   AND pay.paid_local <  COALESCE(
         (sess.ended_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bishkek',
         (now() AT TIME ZONE 'Asia/Bishkek')
       )
  WHERE (pay.paid_local)::date >= DATE '2026-04-18'
    AND sess.employee_id IS NOT NULL
    AND sess.branch_id   IS NOT NULL
    AND COALESCE(sess.end_reason, '') <> 'demo_cleanup'
    AND COALESCE(sess.status, 'open') NOT IN ('cancelled', 'demo')
    AND (p_branch_id   IS NULL OR sess.branch_id   = p_branch_id)
    AND (p_employee_id IS NULL OR sess.employee_id = p_employee_id)
    AND (p_from IS NULL OR (pay.paid_local)::date >= p_from)
    AND (p_to   IS NULL OR (pay.paid_local)::date <= p_to)
  GROUP BY 1, 2, 3
),
payment_day_agg AS (
  SELECT employee_id, branch_id, day, SUM(paid_sum)::numeric AS paid_sum
  FROM payment_day
  GROUP BY employee_id, branch_id, day
),
penalty_day AS (
  SELECT
    s.employee_id::bigint AS employee_id,
    s.branch_id::bigint   AS branch_id,
    (COALESCE((s.ended_at AT TIME ZONE 'UTC'), s.opened_at, s.started_at)
       AT TIME ZONE 'Asia/Bishkek')::date AS day,
    SUM(sp.amount)::numeric AS penalties
  FROM public.attendance_session_penalties sp
  JOIN public.attendance_sessions s ON s.id = sp.session_id
  WHERE COALESCE(sp.cancelled, sp.is_cancelled, false) = false
    AND COALESCE(s.end_reason, '') <> 'demo_cleanup'
    AND COALESCE(s.status, 'open') NOT IN ('cancelled', 'demo')
    AND (p_branch_id   IS NULL OR s.branch_id = p_branch_id)
    AND (p_employee_id IS NULL OR s.employee_id = p_employee_id)
    AND (p_from IS NULL
         OR (COALESCE((s.ended_at AT TIME ZONE 'UTC'), s.opened_at, s.started_at)
              AT TIME ZONE 'Asia/Bishkek')::date >= p_from)
    AND (p_to IS NULL
         OR (COALESCE((s.ended_at AT TIME ZONE 'UTC'), s.opened_at, s.started_at)
              AT TIME ZONE 'Asia/Bishkek')::date <= p_to)
  GROUP BY 1, 2, 3
),
all_days AS (
  SELECT employee_id, branch_id, day FROM session_day
  UNION
  SELECT employee_id, branch_id, day FROM payment_day_agg
  UNION
  SELECT employee_id, branch_id, day FROM penalty_day
),
cfg AS (
  SELECT
    COALESCE(social_fund_monthly, 0)::numeric AS social_fund_monthly,
    COALESCE(income_tax_monthly,  0)::numeric AS income_tax_monthly
  FROM public.payroll_config
  ORDER BY id
  LIMIT 1
)
SELECT
  e.employee_id,
  e.full_name,
  d.branch_id,
  d.day,
  ROUND(COALESCE(s.hours, 0), 3) AS hours,
  e.hourly_rate,
  ROUND(COALESCE(s.hours, 0) * e.hourly_rate, 2) AS hour_pay,
  ROUND(COALESCE(p.paid_sum, 0), 2) AS paid_sum,
  e.bonus_percent,
  ROUND(
    CASE
      WHEN e.has_bonus THEN COALESCE(p.paid_sum, 0) * e.bonus_percent / 100.0
      ELSE 0
    END
  , 2) AS bonus,
  -- Промоутер: штрафов нет.
  CASE
    WHEN e.role = 'promoter' THEN 0::numeric
    ELSE ROUND(COALESCE(pe.penalties, 0), 2)
  END AS penalties,
  -- Промоутер: соц.фонд не удерживается.
  CASE
    WHEN e.role = 'promoter' THEN 0::numeric
    ELSE ROUND(
      (SELECT social_fund_monthly FROM cfg)
      / EXTRACT(day FROM (date_trunc('month', d.day::timestamp) + INTERVAL '1 month - 1 day'))
    , 2)
  END AS social_fund_day,
  -- Промоутер: НДФЛ не удерживается.
  CASE
    WHEN e.role = 'promoter' THEN 0::numeric
    ELSE ROUND(
      (SELECT income_tax_monthly FROM cfg)
      / EXTRACT(day FROM (date_trunc('month', d.day::timestamp) + INTERVAL '1 month - 1 day'))
    , 2)
  END AS income_tax_day,
  -- net_day: для промоутера = hour_pay + bonus (без штрафов и налогов).
  CASE
    WHEN e.role = 'promoter' THEN
      ROUND(
          COALESCE(s.hours, 0) * e.hourly_rate
        + CASE
            WHEN e.has_bonus THEN COALESCE(p.paid_sum, 0) * e.bonus_percent / 100.0
            ELSE 0
          END
      , 2)
    ELSE
      ROUND(
          COALESCE(s.hours, 0) * e.hourly_rate
        + CASE
            WHEN e.has_bonus THEN COALESCE(p.paid_sum, 0) * e.bonus_percent / 100.0
            ELSE 0
          END
        - COALESCE(pe.penalties, 0)
        - ((SELECT social_fund_monthly FROM cfg)
           / EXTRACT(day FROM (date_trunc('month', d.day::timestamp) + INTERVAL '1 month - 1 day')))
        - ((SELECT income_tax_monthly FROM cfg)
           / EXTRACT(day FROM (date_trunc('month', d.day::timestamp) + INTERVAL '1 month - 1 day')))
      , 2)
  END AS net_day
FROM all_days d
JOIN emp e
  ON e.employee_id = d.employee_id
 AND e.branch_id   = d.branch_id
LEFT JOIN session_day s
  ON s.employee_id = d.employee_id
 AND s.branch_id   = d.branch_id
 AND s.day         = d.day
LEFT JOIN payment_day_agg p
  ON p.employee_id = d.employee_id
 AND p.branch_id   = d.branch_id
 AND p.day         = d.day
LEFT JOIN penalty_day pe
  ON pe.employee_id = d.employee_id
 AND pe.branch_id   = d.branch_id
 AND pe.day         = d.day
ORDER BY d.day, e.employee_id;
$function$;
