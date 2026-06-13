-- Режим рабочего дня по календарю: 'closed' | 'short' | 'normal'.
-- Учитывает разовые события и ежегодные шаблоны (yearly_md) для филиала/страны/сети.
-- Только общефилиальные/сетевые записи (employee_id IS NULL) — персональные на режим не влияют.
-- STABLE, читает только календарь, ничего не пишет.
CREATE OR REPLACE FUNCTION public.fn_calendar_day_mode(p_branch_id bigint, p_date date)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_country text;
  v_closed  boolean := false;
  v_short   boolean := false;
  v_month   int := EXTRACT(MONTH FROM p_date)::int;
  v_day     int := EXTRACT(DAY   FROM p_date)::int;
BEGIN
  SELECT country_id INTO v_country FROM public.branches WHERE id = p_branch_id;

  SELECT
    EXISTS (
      SELECT 1 FROM public.franchise_calendar_events e
      WHERE e.event_date = p_date AND e.event_type = 'closed'
        AND e.audience IN ('employee','both') AND e.employee_id IS NULL
        AND (e.branch_id IS NULL OR e.branch_id = p_branch_id)
        AND (e.country_id IS NULL OR e.country_id = v_country)
    )
    OR EXISTS (
      SELECT 1 FROM public.franchise_calendar_templates t
      WHERE t.is_active AND t.event_type = 'closed'
        AND t.recurrence_type = 'yearly_md'
        AND t.recurrence_month = v_month AND t.recurrence_value = v_day
        AND t.audience IN ('employee','both') AND t.employee_id IS NULL
        AND (t.branch_id IS NULL OR t.branch_id = p_branch_id)
        AND (t.country_id IS NULL OR t.country_id = v_country)
    )
  INTO v_closed;

  IF v_closed THEN RETURN 'closed'; END IF;

  SELECT
    EXISTS (
      SELECT 1 FROM public.franchise_calendar_events e
      WHERE e.event_date = p_date AND e.event_type = 'short_day'
        AND e.audience IN ('employee','both') AND e.employee_id IS NULL
        AND (e.branch_id IS NULL OR e.branch_id = p_branch_id)
        AND (e.country_id IS NULL OR e.country_id = v_country)
    )
    OR EXISTS (
      SELECT 1 FROM public.franchise_calendar_templates t
      WHERE t.is_active AND t.event_type = 'short_day'
        AND t.recurrence_type = 'yearly_md'
        AND t.recurrence_month = v_month AND t.recurrence_value = v_day
        AND t.audience IN ('employee','both') AND t.employee_id IS NULL
        AND (t.branch_id IS NULL OR t.branch_id = p_branch_id)
        AND (t.country_id IS NULL OR t.country_id = v_country)
    )
  INTO v_short;

  IF v_short THEN RETURN 'short'; END IF;
  RETURN 'normal';
END;
$$;

REVOKE ALL ON FUNCTION public.fn_calendar_day_mode(bigint, date) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_calendar_day_mode(bigint, date) TO anon, authenticated, service_role;
