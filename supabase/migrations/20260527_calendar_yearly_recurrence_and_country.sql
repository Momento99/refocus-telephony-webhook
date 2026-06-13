-- Ежегодный повтор праздников (yearly_md) + привязка событий к стране (country_id).
-- yearly_md: recurrence_month = месяц (1-12), recurrence_value = день (1-31).

-- ============================================================
-- 1) Новые колонки
-- ============================================================
ALTER TABLE public.franchise_calendar_templates
  ADD COLUMN IF NOT EXISTS recurrence_month integer NULL,
  ADD COLUMN IF NOT EXISTS country_id text NULL REFERENCES public.franchise_countries(id) ON DELETE CASCADE;

ALTER TABLE public.franchise_calendar_events
  ADD COLUMN IF NOT EXISTS country_id text NULL REFERENCES public.franchise_countries(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_fc_templates_country ON public.franchise_calendar_templates(country_id);
CREATE INDEX IF NOT EXISTS idx_fc_events_country    ON public.franchise_calendar_events(country_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'franchise_calendar_templates_recurrence_type_chk'
  ) THEN
    ALTER TABLE public.franchise_calendar_templates
      ADD CONSTRAINT franchise_calendar_templates_recurrence_type_chk
      CHECK (recurrence_type IN ('monthly_day','weekly_dow','yearly_md'));
  END IF;
END$$;

-- ============================================================
-- 2) RPC: country-фильтр + раскрытие yearly_md
-- ============================================================
CREATE OR REPLACE FUNCTION public.app_calendar_events_for_employee(
  p_session_id text,
  p_year       integer,
  p_month      integer
)
RETURNS TABLE (
  id            integer,
  title         text,
  description   text,
  event_date    date,
  event_type    text,
  icon          text,
  color         text,
  is_recurring  boolean,
  is_personal   boolean,
  is_branch     boolean,
  is_global     boolean,
  is_completed  boolean,
  template_id   integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp bigint;
  v_br  bigint;
  v_country text;
  v_month_start date;
  v_month_end   date;
  v_last_day    integer;
BEGIN
  SELECT r.employee_id, r.branch_id INTO v_emp, v_br
    FROM public._calendar_resolve_session(p_session_id) r;

  IF v_emp IS NULL THEN
    RETURN;
  END IF;

  IF v_br IS NOT NULL THEN
    SELECT b.country_id INTO v_country FROM public.branches b WHERE b.id = v_br;
  END IF;

  v_month_start := make_date(p_year, p_month, 1);
  v_month_end   := (v_month_start + interval '1 month - 1 day')::date;
  v_last_day    := EXTRACT(DAY FROM v_month_end)::int;

  RETURN QUERY
  SELECT
    e.id, e.title, e.description, e.event_date, e.event_type,
    COALESCE(e.icon,'CalendarDays'), COALESCE(e.color,'sky'),
    false                                          AS is_recurring,
    (e.employee_id = v_emp)                        AS is_personal,
    (e.employee_id IS NULL AND e.branch_id = v_br) AS is_branch,
    (e.employee_id IS NULL AND e.branch_id IS NULL) AS is_global,
    EXISTS (
      SELECT 1 FROM public.franchise_calendar_event_completions c
       WHERE c.event_id = e.id AND c.employee_id = v_emp
    )                                              AS is_completed,
    NULL::integer                                  AS template_id
  FROM public.franchise_calendar_events e
  WHERE e.audience IN ('employee','both')
    AND e.event_date BETWEEN v_month_start AND v_month_end
    AND (e.employee_id IS NULL OR e.employee_id = v_emp)
    AND (e.branch_id IS NULL OR e.branch_id = v_br OR e.employee_id = v_emp)
    AND (e.country_id IS NULL OR e.country_id = v_country);

  RETURN QUERY
  WITH active_tpl AS (
    SELECT t.*
      FROM public.franchise_calendar_templates t
     WHERE t.is_active
       AND t.audience IN ('employee','both')
       AND (t.employee_id IS NULL OR t.employee_id = v_emp)
       AND (t.branch_id   IS NULL OR t.branch_id   = v_br OR t.employee_id = v_emp)
       AND (t.country_id  IS NULL OR t.country_id  = v_country)
  ),
  monthly AS (
    SELECT
      -(t.id * 1000) AS id, t.title, t.description,
      make_date(p_year, p_month,
        CASE WHEN t.recurrence_value = 0 THEN v_last_day
             ELSE LEAST(t.recurrence_value, v_last_day) END) AS event_date,
      COALESCE(NULLIF(t.event_type,''),'custom') AS event_type,
      COALESCE(t.icon,'CalendarDays') AS icon, COALESCE(t.color,'sky') AS color,
      true AS is_recurring,
      (t.employee_id = v_emp) AS is_personal,
      (t.employee_id IS NULL AND t.branch_id = v_br) AS is_branch,
      (t.employee_id IS NULL AND t.branch_id IS NULL) AS is_global,
      false AS is_completed, t.id AS template_id
    FROM active_tpl t WHERE t.recurrence_type = 'monthly_day'
  ),
  weekly AS (
    SELECT
      -(t.id * 1000 + d) AS id, t.title, t.description,
      make_date(p_year, p_month, d) AS event_date,
      COALESCE(NULLIF(t.event_type,''),'custom') AS event_type,
      COALESCE(t.icon,'CalendarDays') AS icon, COALESCE(t.color,'sky') AS color,
      true AS is_recurring,
      (t.employee_id = v_emp) AS is_personal,
      (t.employee_id IS NULL AND t.branch_id = v_br) AS is_branch,
      (t.employee_id IS NULL AND t.branch_id IS NULL) AS is_global,
      false AS is_completed, t.id AS template_id
    FROM active_tpl t
    CROSS JOIN generate_series(1, v_last_day) AS d
    WHERE t.recurrence_type = 'weekly_dow'
      AND EXTRACT(DOW FROM make_date(p_year, p_month, d))::int = t.recurrence_value
  ),
  yearly AS (
    SELECT
      -(t.id * 1000) AS id, t.title, t.description,
      make_date(p_year, p_month, LEAST(GREATEST(t.recurrence_value,1), v_last_day)) AS event_date,
      COALESCE(NULLIF(t.event_type,''),'custom') AS event_type,
      COALESCE(t.icon,'CalendarDays') AS icon, COALESCE(t.color,'sky') AS color,
      true AS is_recurring,
      (t.employee_id = v_emp) AS is_personal,
      (t.employee_id IS NULL AND t.branch_id = v_br) AS is_branch,
      (t.employee_id IS NULL AND t.branch_id IS NULL) AS is_global,
      false AS is_completed, t.id AS template_id
    FROM active_tpl t
    WHERE t.recurrence_type = 'yearly_md'
      AND t.recurrence_month = p_month
  )
  SELECT * FROM monthly
  UNION ALL SELECT * FROM weekly
  UNION ALL SELECT * FROM yearly;
END;
$$;

REVOKE ALL ON FUNCTION public.app_calendar_events_for_employee(text, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.app_calendar_events_for_employee(text, integer, integer) TO anon, authenticated, service_role;
