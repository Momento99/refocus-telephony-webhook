-- График филиала сотрудника (по сессии) для POS-календаря:
-- календарь красит реально нерабочие дни недели по branch_workhours.is_day_off,
-- а не по хардкоду «сб/вс». При смене выходного (напр. на понедельник) —
-- достаточно поменять branch_workhours, календарь отразит автоматически.
CREATE OR REPLACE FUNCTION public.app_calendar_workhours_for_employee(p_session_id text)
RETURNS TABLE (dow integer, is_day_off boolean, start_at time, end_at time)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp bigint;
  v_br  bigint;
BEGIN
  SELECT r.employee_id, r.branch_id INTO v_emp, v_br
    FROM public._calendar_resolve_session(p_session_id) r;

  IF v_br IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT bw.dow, bw.is_day_off, bw.start_at, bw.end_at
  FROM public.branch_workhours bw
  WHERE bw.branch_id = v_br
  ORDER BY bw.dow;
END;
$$;

REVOKE ALL ON FUNCTION public.app_calendar_workhours_for_employee(text) FROM public;
GRANT EXECUTE ON FUNCTION public.app_calendar_workhours_for_employee(text) TO anon, authenticated, service_role;
