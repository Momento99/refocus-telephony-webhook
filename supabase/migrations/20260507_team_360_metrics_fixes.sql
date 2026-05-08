-- Фиксы метрик /admin/team (2026-05-07).
-- Найдены при аудите rpc_employee_360. Эффект:
--   #1 late_minutes_total — у Аэлины было 1010 мин/неделя → стало 296 мин (реальные опоздания)
--   #6 hours_worked — для активных смен использовалось now()-started, завышало в моменте
--   #9 voice — был хардкод branch_id=5, заменён на флаг is_voice_pilot
--
-- Также добавлен флаг branches.is_voice_pilot (true только для Tokmok пока).
--
-- Граница дня для late_minutes — в TZ филиала, не UTC: ночные смены через
-- 18:00 UTC (00:00 Bishkek) теперь правильно попадают в новый день.

alter table public.branches
  add column if not exists is_voice_pilot boolean not null default false;

update public.branches set is_voice_pilot = true where id = 5;

create or replace function public.rpc_employee_360(p_from date, p_to date)
returns table(
  employee_id bigint, full_name text, role text, is_active boolean,
  branch_id bigint, branch_name text,
  audio_chunks_count integer, audio_avg_score numeric,
  audio_rude_count integer, audio_pushy_count integer,
  wa_threads_count integer, wa_analyzed_count integer,
  wa_avg_score numeric, wa_critical_count integer,
  ig_threads_count integer, ig_analyzed_count integer,
  ig_avg_score numeric, ig_critical_count integer,
  orders_count integer, revenue_total numeric, avg_check numeric,
  frame_items_count integer, lens_items_count integer,
  sessions_count integer, hours_worked numeric,
  penalty_minutes integer, penalty_count integer,
  late_minutes_total integer, afk_minutes_total integer,
  bonus_amount numeric, fine_amount numeric,
  feedback_daily_count integer, feedback_weekly_count integer,
  feedback_avg_mood numeric, is_voice_pilot boolean
)
language sql security definer set search_path = public
as $$
WITH
emps AS (
  SELECT e.id, e.full_name, e.role::text AS role, e.is_active, e.branch_id,
         b.name AS branch_name, COALESCE(b.is_voice_pilot, false) AS is_voice_pilot
  FROM employees e
  LEFT JOIN branches b ON b.id = e.branch_id
  WHERE e.is_active = true
    AND COALESCE(b.is_workshop, false) = false
    AND e.role::text IN ('seller','manager')
),
audio AS (
  SELECT ac.employee_id, COUNT(*)::int AS chunks_count,
         AVG(cs.overall_score)::numeric(4,2) AS avg_score,
         COUNT(*) FILTER (WHERE cs.was_rude IS TRUE)::int AS rude_count,
         COUNT(*) FILTER (WHERE cs.was_pushy IS TRUE)::int AS pushy_count
  FROM service_qa.audio_chunks ac
  JOIN service_qa.chunk_scores cs ON cs.chunk_id = ac.id AND cs.status = 'completed'
  WHERE ac.chunk_started_at >= (p_from::timestamptz)
    AND ac.chunk_started_at <  ((p_to + 1)::timestamptz)
    AND ac.employee_id IS NOT NULL
  GROUP BY ac.employee_id
),
wa_threads AS (
  SELECT wt.assigned_seller_employee_id AS employee_id,
         COUNT(DISTINCT wt.id)::int AS threads_count
  FROM whatsapp_threads wt
  WHERE wt.first_customer_message_at >= (p_from::timestamptz)
    AND wt.first_customer_message_at <  ((p_to + 1)::timestamptz)
    AND wt.assigned_seller_employee_id IS NOT NULL
  GROUP BY 1
),
wa_quality AS (
  SELECT employee_id, COUNT(*)::int AS analyzed_count,
         AVG(score)::numeric(4,2) AS avg_score,
         COUNT(*) FILTER (WHERE score < 5)::int AS critical_count
  FROM whatsapp_thread_quality
  WHERE created_at >= (p_from::timestamptz)
    AND created_at <  ((p_to + 1)::timestamptz)
    AND employee_id IS NOT NULL
  GROUP BY employee_id
),
ig_threads AS (
  SELECT it.assigned_seller_employee_id AS employee_id,
         COUNT(DISTINCT it.id)::int AS threads_count
  FROM instagram_threads it
  WHERE it.first_customer_message_at >= (p_from::timestamptz)
    AND it.first_customer_message_at <  ((p_to + 1)::timestamptz)
    AND it.assigned_seller_employee_id IS NOT NULL
  GROUP BY 1
),
ig_quality AS (
  SELECT employee_id, COUNT(*)::int AS analyzed_count,
         AVG(score)::numeric(4,2) AS avg_score,
         COUNT(*) FILTER (WHERE score < 5)::int AS critical_count
  FROM instagram_thread_quality
  WHERE created_at >= (p_from::timestamptz)
    AND created_at <  ((p_to + 1)::timestamptz)
    AND employee_id IS NOT NULL
  GROUP BY employee_id
),
sales AS (
  SELECT o.seller_employee_id AS employee_id,
         COUNT(*)::int AS orders_count,
         COALESCE(SUM(o.total_amount),0)::numeric AS revenue_total,
         CASE WHEN COUNT(*) > 0 THEN (SUM(o.total_amount)/COUNT(*))::numeric(12,2) ELSE 0 END AS avg_check,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.item_type::text = 'frame'
         ))::int AS frame_items_count,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.item_type::text = 'lens'
         ))::int AS lens_items_count
  FROM orders o
  WHERE o.created_at >= (p_from::timestamptz)
    AND o.created_at <  ((p_to + 1)::timestamptz)
    AND COALESCE(o.is_deleted, false) = false
    AND o.seller_employee_id IS NOT NULL
  GROUP BY o.seller_employee_id
),
sess AS (
  -- #6: hours считаются ТОЛЬКО по закрытым сменам (раньше для активной use now()).
  SELECT s.employee_id, COUNT(*)::int AS sessions_count,
    ROUND(
      COALESCE(SUM(EXTRACT(EPOCH FROM (s.ended_at::timestamptz - s.started_at)) / 3600.0)
        FILTER (WHERE s.ended_at IS NOT NULL), 0)::numeric, 2
    ) AS hours_worked,
    COALESCE(SUM(s.afk_minutes), 0)::int AS afk_minutes_total
  FROM attendance_sessions s
  WHERE s.started_at >= (p_from::timestamptz)
    AND s.started_at <  ((p_to + 1)::timestamptz)
    AND s.employee_id IS NOT NULL
  GROUP BY s.employee_id
),
sess_first_per_day AS (
  -- #1: late_minutes только первой смены дня (раньше суммировали все смены,
  --     вторая смена дня считалась как «опоздание на work_open» → завышение в 5×).
  -- Граница дня — в TZ филиала, не UTC.
  SELECT s.employee_id,
         (s.started_at AT TIME ZONE COALESCE(b.timezone, 'Asia/Bishkek'))::date AS day,
         s.late_minutes,
         ROW_NUMBER() OVER (
           PARTITION BY s.employee_id,
             (s.started_at AT TIME ZONE COALESCE(b.timezone, 'Asia/Bishkek'))::date
           ORDER BY s.started_at ASC
         ) AS rn
  FROM attendance_sessions s
  LEFT JOIN branches b ON b.id = s.branch_id
  WHERE s.started_at >= (p_from::timestamptz)
    AND s.started_at <  ((p_to + 1)::timestamptz)
    AND s.employee_id IS NOT NULL
),
late_per_emp AS (
  SELECT employee_id, COALESCE(SUM(late_minutes), 0)::int AS late_minutes_total
  FROM sess_first_per_day WHERE rn = 1
  GROUP BY employee_id
),
pen AS (
  SELECT s.employee_id,
         COALESCE(SUM(pp.minutes), 0)::int AS penalty_minutes,
         COUNT(*)::int AS penalty_count
  FROM attendance_session_penalties pp
  JOIN attendance_sessions s ON s.id = pp.session_id
  WHERE s.started_at >= (p_from::timestamptz)
    AND s.started_at <  ((p_to + 1)::timestamptz)
    AND COALESCE(pp.is_cancelled, false) = false
    AND COALESCE(pp.cancelled, false) = false
  GROUP BY s.employee_id
),
adj AS (
  SELECT employee_id,
    COALESCE(SUM(CASE WHEN kind = 'bonus' OR amount > 0 THEN amount ELSE 0 END), 0)::numeric AS bonus_amount,
    COALESCE(SUM(CASE WHEN kind = 'fine'  OR amount < 0 THEN ABS(amount) ELSE 0 END), 0)::numeric AS fine_amount
  FROM payroll_adjustments
  WHERE period >= p_from AND period <= p_to
  GROUP BY employee_id
),
fb_daily AS (
  SELECT employee_id, COUNT(*)::int AS c, AVG(mood)::numeric(3,2) AS avg_mood
  FROM feedback_daily_responses
  WHERE day >= p_from AND day <= p_to
  GROUP BY employee_id
),
fb_weekly AS (
  SELECT employee_id, COUNT(*)::int AS c, AVG(mood)::numeric(3,2) AS avg_mood
  FROM feedback_weekly_responses
  WHERE week_start >= p_from AND week_start <= p_to
  GROUP BY employee_id
)
SELECT
  e.id, e.full_name, e.role, e.is_active, e.branch_id, e.branch_name,
  COALESCE(a.chunks_count,0), a.avg_score, COALESCE(a.rude_count,0), COALESCE(a.pushy_count,0),
  COALESCE(wt.threads_count,0), COALESCE(wq.analyzed_count,0), wq.avg_score, COALESCE(wq.critical_count,0),
  COALESCE(it.threads_count,0), COALESCE(iq.analyzed_count,0), iq.avg_score, COALESCE(iq.critical_count,0),
  COALESCE(sl.orders_count,0), COALESCE(sl.revenue_total,0), COALESCE(sl.avg_check,0),
  COALESCE(sl.frame_items_count,0), COALESCE(sl.lens_items_count,0),
  COALESCE(s.sessions_count,0), COALESCE(s.hours_worked,0),
  COALESCE(p.penalty_minutes,0), COALESCE(p.penalty_count,0),
  COALESCE(lp.late_minutes_total,0), COALESCE(s.afk_minutes_total,0),
  COALESCE(ad.bonus_amount,0), COALESCE(ad.fine_amount,0),
  COALESCE(fd.c,0), COALESCE(fw.c,0),
  CASE WHEN COALESCE(fd.c,0)+COALESCE(fw.c,0) = 0 THEN NULL
       ELSE ((COALESCE(fd.avg_mood,0)*COALESCE(fd.c,0) + COALESCE(fw.avg_mood,0)*COALESCE(fw.c,0))
              / (COALESCE(fd.c,0)+COALESCE(fw.c,0)))::numeric(3,2)
  END,
  e.is_voice_pilot
FROM emps e
LEFT JOIN audio a            ON a.employee_id = e.id
LEFT JOIN wa_threads wt      ON wt.employee_id = e.id
LEFT JOIN wa_quality wq      ON wq.employee_id = e.id
LEFT JOIN ig_threads it      ON it.employee_id = e.id
LEFT JOIN ig_quality iq      ON iq.employee_id = e.id
LEFT JOIN sales sl           ON sl.employee_id = e.id
LEFT JOIN sess s             ON s.employee_id = e.id
LEFT JOIN late_per_emp lp    ON lp.employee_id = e.id
LEFT JOIN pen p              ON p.employee_id = e.id
LEFT JOIN adj ad             ON ad.employee_id = e.id
LEFT JOIN fb_daily fd        ON fd.employee_id = e.id
LEFT JOIN fb_weekly fw       ON fw.employee_id = e.id
ORDER BY e.branch_name, e.full_name;
$$;
