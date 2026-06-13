-- Team 360 (/admin/team): co-presence-aware атрибуция продаж + исключение тест-филиала.
-- Дата: 2026-05-29.
--
-- ЧТО МЕНЯЕМ И ПОЧЕМУ:
-- 1) Выручка/заказы теперь распределяются ПО ФАКТУ ПРИСУТСТВИЯ на смене, а не по тому,
--    кто пробил чек (seller_employee_id). Для каждого заказа берём всех активных
--    продавцов/менеджеров с ОТКРЫТОЙ сменой в этом филиале В МОМЕНТ заказа и делим
--    сумму ПОРОВНУ между ними:
--      • Посменные филиалы (Кара-Балта): в любой момент на смене 1 человек → делить нечего,
--        результат идентичен прежнему (проверено на майских данных: diff = 0 по всем
--        соло/посменным филиалам).
--      • Одновременные смены (Токмок): двое продавцов на смене → 50/50; их продажи сближаются.
--      • ПРОМОУТЕРЫ в знаменатель НЕ входят (их роли нет в emps); заказы, пробитые под
--        промоутером во время общей смены, уходят присутствующим продавцам.
--    Fallback: если в момент заказа никого из emps нет на смене — берём seller_employee_id,
--    но только если он сам продавец/менеджер; иначе заказ выпадает из оценки (это нормально:
--    оцениваем только продавцов/менеджеров).
-- 2) Тестовый филиал и тест-учётки исключаем через НОВЫЙ флаг branches.is_hidden
--    (id = 18 «Тест» вместе с сотрудником «Тестер», который привязан к этому филиалу).
--
-- ВАЖНО: сигнатура функции НЕ меняется (CREATE OR REPLACE безопасен, без DROP).
-- Меняются только CTE emps (доб. фильтр is_hidden) и блок sales (доб. order_credit + дележ).
-- avg_check считается по ПОЛНОЙ сумме чека (размер сделки — сигнал апселла),
-- а revenue_total — по доле присутствия (для оценки выручки/час).

alter table public.branches
  add column if not exists is_hidden boolean not null default false;

update public.branches set is_hidden = true where id = 18;  -- «Тест»

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
    AND COALESCE(b.is_hidden, false) = false      -- #2: исключаем тест-филиал
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
order_credit AS (
  -- Атрибуция по факту присутствия на смене + дележ выручки поровну (см. шапку миграции).
  SELECT cr.order_id, cr.employee_id, cr.total_amount, cr.is_frame, cr.is_lens,
         (cr.total_amount::numeric / cr.n) AS rev_share
  FROM (
    SELECT o.id AS order_id, o.total_amount,
           EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.item_type::text = 'frame') AS is_frame,
           EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.item_type::text = 'lens')  AS is_lens,
           emp AS employee_id,
           array_length(ce.emps_arr, 1) AS n
    FROM orders o
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        -- активные продавцы/менеджеры с открытой сменой в этом филиале в момент заказа
        (SELECT array_agg(DISTINCT s.employee_id)
           FROM attendance_sessions s
          WHERE s.branch_id = o.branch_id
            AND s.started_at <= o.created_at
            AND COALESCE(s.ended_at, now()) >= o.created_at
            AND s.employee_id IN (SELECT id FROM emps)),
        -- fallback: тот, кто пробил чек, если он сам продавец/менеджер
        (SELECT ARRAY[o.seller_employee_id] WHERE o.seller_employee_id IN (SELECT id FROM emps))
      ) AS emps_arr
    ) ce
    CROSS JOIN LATERAL unnest(ce.emps_arr) AS emp
    WHERE o.created_at >= (p_from::timestamptz)
      AND o.created_at <  ((p_to + 1)::timestamptz)
      AND COALESCE(o.is_deleted, false) = false
      AND o.seller_employee_id IS NOT NULL
      AND ce.emps_arr IS NOT NULL
  ) cr
),
sales AS (
  SELECT employee_id,
         COUNT(*)::int AS orders_count,                                   -- заказы, в которых участвовал
         COALESCE(SUM(rev_share), 0)::numeric AS revenue_total,           -- доля выручки (для выручки/час)
         CASE WHEN COUNT(*) > 0 THEN (SUM(total_amount)/COUNT(*))::numeric(12,2) ELSE 0 END AS avg_check,  -- полный чек
         COUNT(*) FILTER (WHERE is_frame)::int AS frame_items_count,
         COUNT(*) FILTER (WHERE is_lens)::int AS lens_items_count
  FROM order_credit
  GROUP BY employee_id
),
sess AS (
  -- hours считаются ТОЛЬКО по закрытым сменам (для активной не используем now()).
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
  -- Берём день по локальному TZ филиала, не UTC. Это важно для ночных смен:
  -- старт 20:25 UTC = 02:25 Bishkek следующего дня → должен попасть в новый день.
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
