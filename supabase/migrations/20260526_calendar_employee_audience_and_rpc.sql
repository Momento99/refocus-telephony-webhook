-- Расширение календаря франчайзи до календаря сотрудников.
-- Добавляет адресацию (franchise | employee | both) + персональные события
-- + RPC для POS-приложения.

-- ============================================================
-- 1) Расширяем таблицу шаблонов (повторяющиеся события)
-- ============================================================
ALTER TABLE public.franchise_calendar_templates
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'franchise',
  ADD COLUMN IF NOT EXISTS employee_id bigint NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'custom';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'franchise_calendar_templates_audience_chk'
  ) THEN
    ALTER TABLE public.franchise_calendar_templates
      ADD CONSTRAINT franchise_calendar_templates_audience_chk
      CHECK (audience IN ('franchise','employee','both'));
  END IF;
END$$;

-- ============================================================
-- 2) Расширяем таблицу разовых событий (event_type уже есть)
-- ============================================================
ALTER TABLE public.franchise_calendar_events
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'franchise',
  ADD COLUMN IF NOT EXISTS employee_id bigint NULL REFERENCES public.employees(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'franchise_calendar_events_audience_chk'
  ) THEN
    ALTER TABLE public.franchise_calendar_events
      ADD CONSTRAINT franchise_calendar_events_audience_chk
      CHECK (audience IN ('franchise','employee','both'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_fc_events_emp        ON public.franchise_calendar_events(employee_id, event_date);
CREATE INDEX IF NOT EXISTS idx_fc_events_branch_dt  ON public.franchise_calendar_events(branch_id, event_date);
CREATE INDEX IF NOT EXISTS idx_fc_events_audience   ON public.franchise_calendar_events(audience);
CREATE INDEX IF NOT EXISTS idx_fc_templates_emp     ON public.franchise_calendar_templates(employee_id);
CREATE INDEX IF NOT EXISTS idx_fc_templates_audience ON public.franchise_calendar_templates(audience);

-- ============================================================
-- 3) Таблица отметок «выполнено» для задач
-- ============================================================
CREATE TABLE IF NOT EXISTS public.franchise_calendar_event_completions (
  id            bigserial PRIMARY KEY,
  event_id      integer NOT NULL REFERENCES public.franchise_calendar_events(id) ON DELETE CASCADE,
  employee_id   bigint NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  completed_at  timestamptz NOT NULL DEFAULT now(),
  note          text NULL,
  UNIQUE (event_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_fcec_event ON public.franchise_calendar_event_completions(event_id);
CREATE INDEX IF NOT EXISTS idx_fcec_emp   ON public.franchise_calendar_event_completions(employee_id);

-- ============================================================
-- 4) Helper: резолв session_id (text) -> employee_id, branch_id
-- ============================================================
CREATE OR REPLACE FUNCTION public._calendar_resolve_session(p_session_id text)
RETURNS TABLE(employee_id bigint, branch_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp bigint;
  v_br  bigint;
BEGIN
  IF p_session_id ~ '^[0-9]+$' THEN
    SELECT s.employee_id, s.branch_id
      INTO v_emp, v_br
      FROM public.attendance_sessions s
     WHERE s.id = p_session_id::bigint
     LIMIT 1;
  END IF;

  IF v_emp IS NULL THEN
    BEGIN
      SELECT s.employee_id, s.branch_id
        INTO v_emp, v_br
        FROM public.attendance_sessions s
       WHERE s.client_uuid = p_session_id::uuid
       LIMIT 1;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  IF v_emp IS NOT NULL AND v_br IS NULL THEN
    SELECT e.branch_id INTO v_br
      FROM public.employees e
     WHERE e.id = v_emp;
  END IF;

  RETURN QUERY SELECT v_emp, v_br;
END;
$$;

REVOKE ALL ON FUNCTION public._calendar_resolve_session(text) FROM public;
GRANT EXECUTE ON FUNCTION public._calendar_resolve_session(text) TO anon, authenticated, service_role;

-- ============================================================
-- 5) RPC: события сотрудника за месяц
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
  v_month_start date;
  v_month_end   date;
  v_last_day    integer;
BEGIN
  SELECT r.employee_id, r.branch_id INTO v_emp, v_br
    FROM public._calendar_resolve_session(p_session_id) r;

  IF v_emp IS NULL THEN
    RETURN;
  END IF;

  v_month_start := make_date(p_year, p_month, 1);
  v_month_end   := (v_month_start + interval '1 month - 1 day')::date;
  v_last_day    := EXTRACT(DAY FROM v_month_end)::int;

  RETURN QUERY
  SELECT
    e.id,
    e.title,
    e.description,
    e.event_date,
    e.event_type,
    COALESCE(e.icon,'CalendarDays'),
    COALESCE(e.color,'sky'),
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
    AND (e.branch_id IS NULL OR e.branch_id = v_br OR e.employee_id = v_emp);

  RETURN QUERY
  WITH active_tpl AS (
    SELECT t.*
      FROM public.franchise_calendar_templates t
     WHERE t.is_active
       AND t.audience IN ('employee','both')
       AND (t.employee_id IS NULL OR t.employee_id = v_emp)
       AND (t.branch_id   IS NULL OR t.branch_id   = v_br OR t.employee_id = v_emp)
  ),
  monthly AS (
    SELECT
      -(t.id * 100)                                              AS id,
      t.title, t.description,
      make_date(p_year, p_month,
        CASE WHEN t.recurrence_value = 0
             THEN v_last_day
             ELSE LEAST(t.recurrence_value, v_last_day)
        END)                                                     AS event_date,
      COALESCE(NULLIF(t.event_type,''),'custom')                 AS event_type,
      COALESCE(t.icon,'CalendarDays')                            AS icon,
      COALESCE(t.color,'sky')                                    AS color,
      true                                                       AS is_recurring,
      (t.employee_id = v_emp)                                    AS is_personal,
      (t.employee_id IS NULL AND t.branch_id = v_br)             AS is_branch,
      (t.employee_id IS NULL AND t.branch_id IS NULL)            AS is_global,
      false                                                      AS is_completed,
      t.id                                                       AS template_id
    FROM active_tpl t
    WHERE t.recurrence_type = 'monthly_day'
  ),
  weekly AS (
    SELECT
      -(t.id * 100 + d)                                          AS id,
      t.title, t.description,
      make_date(p_year, p_month, d)                              AS event_date,
      COALESCE(NULLIF(t.event_type,''),'custom')                 AS event_type,
      COALESCE(t.icon,'CalendarDays')                            AS icon,
      COALESCE(t.color,'sky')                                    AS color,
      true                                                       AS is_recurring,
      (t.employee_id = v_emp)                                    AS is_personal,
      (t.employee_id IS NULL AND t.branch_id = v_br)             AS is_branch,
      (t.employee_id IS NULL AND t.branch_id IS NULL)            AS is_global,
      false                                                      AS is_completed,
      t.id                                                       AS template_id
    FROM active_tpl t
    CROSS JOIN generate_series(1, v_last_day) AS d
    WHERE t.recurrence_type = 'weekly_dow'
      AND EXTRACT(DOW FROM make_date(p_year, p_month, d))::int = t.recurrence_value
  )
  SELECT * FROM monthly
  UNION ALL
  SELECT * FROM weekly;
END;
$$;

REVOKE ALL ON FUNCTION public.app_calendar_events_for_employee(text, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.app_calendar_events_for_employee(text, integer, integer) TO anon, authenticated, service_role;

-- ============================================================
-- 6) RPC: отметить / снять отметку выполнения задачи
-- ============================================================
CREATE OR REPLACE FUNCTION public.app_calendar_mark_done(
  p_session_id text,
  p_event_id   integer,
  p_done       boolean
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp bigint;
  v_br  bigint;
  v_event_branch integer;
  v_event_employee bigint;
BEGIN
  SELECT r.employee_id, r.branch_id INTO v_emp, v_br
    FROM public._calendar_resolve_session(p_session_id) r;

  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'session_not_resolved';
  END IF;

  SELECT branch_id, employee_id
    INTO v_event_branch, v_event_employee
    FROM public.franchise_calendar_events
   WHERE id = p_event_id;

  IF v_event_branch IS NULL AND v_event_employee IS NULL THEN
    NULL;
  ELSIF v_event_employee = v_emp THEN
    NULL;
  ELSIF v_event_employee IS NULL AND v_event_branch = v_br THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_done THEN
    INSERT INTO public.franchise_calendar_event_completions(event_id, employee_id)
    VALUES (p_event_id, v_emp)
    ON CONFLICT (event_id, employee_id) DO NOTHING;
  ELSE
    DELETE FROM public.franchise_calendar_event_completions
     WHERE event_id = p_event_id AND employee_id = v_emp;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.app_calendar_mark_done(text, integer, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.app_calendar_mark_done(text, integer, boolean) TO anon, authenticated, service_role;

-- ============================================================
-- 7) RLS для completions
-- ============================================================
ALTER TABLE public.franchise_calendar_event_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fcec_read_all ON public.franchise_calendar_event_completions;
CREATE POLICY fcec_read_all ON public.franchise_calendar_event_completions
  FOR SELECT USING (true);

DROP POLICY IF EXISTS fcec_no_direct_write ON public.franchise_calendar_event_completions;
CREATE POLICY fcec_no_direct_write ON public.franchise_calendar_event_completions
  FOR ALL USING (false) WITH CHECK (false);
