-- POS хранит pos_session_id по-разному в зависимости от терминала/версии:
-- attendance_sessions.id (число), attendance_sessions.client_uuid (uuid)
-- ИЛИ user_sessions.id (uuid). Раньше резолв смотрел только attendance_sessions,
-- поэтому сотрудники, залогиненные через user_sessions (напр. Аделя/Сокулук),
-- видели пустой календарь. Добавлен поиск в user_sessions.
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
    SELECT s.employee_id, s.branch_id INTO v_emp, v_br
      FROM public.attendance_sessions s
     WHERE s.id = p_session_id::bigint LIMIT 1;
  END IF;

  IF v_emp IS NULL THEN
    BEGIN
      SELECT s.employee_id, s.branch_id INTO v_emp, v_br
        FROM public.attendance_sessions s
       WHERE s.client_uuid = p_session_id::uuid LIMIT 1;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;

  IF v_emp IS NULL THEN
    BEGIN
      SELECT u.employee_id, u.branch_id INTO v_emp, v_br
        FROM public.user_sessions u
       WHERE u.id = p_session_id::uuid LIMIT 1;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;

  IF v_emp IS NOT NULL AND v_br IS NULL THEN
    SELECT e.branch_id INTO v_br FROM public.employees e WHERE e.id = v_emp;
  END IF;

  RETURN QUERY SELECT v_emp, v_br;
END;
$$;

REVOKE ALL ON FUNCTION public._calendar_resolve_session(text) FROM public;
GRANT EXECUTE ON FUNCTION public._calendar_resolve_session(text) TO anon, authenticated, service_role;
