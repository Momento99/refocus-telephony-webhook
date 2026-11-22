-- Run against a test copy of the CRM database after the promoter rollout.
-- Uses fixture staff and existing test-copy sales from 20 November. Roll back
-- fixture rows at the end. RPCs can advance sequences, so use a test database.
BEGIN;

DO $$
DECLARE
  home_branch CONSTANT bigint := 1;
  away_branch CONSTANT bigint := 2;
  payroll_day CONSTANT date := DATE '2026-11-20';
  promoter_name CONSTANT text := 'Ксения Проверочная';
  promoter_id bigint;
  new_promoter_id bigint;
  seller_id bigint;
  promoter_login text := 'accept-promoter-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  new_promoter_login text := 'accept-new-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  seller_login text := 'accept-seller-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  fixture_pins text[];
  client_id uuid := gen_random_uuid();
  home_terminal public.terminals%ROWTYPE;
  away_terminal public.terminals%ROWTYPE;
  hidden_terminal public.terminals%ROWTYPE;
  result jsonb;
  shift_result record;
  home_shift bigint;
  away_shift bigint;
  expected_home_bonus numeric;
  expected_away_bonus numeric;
  totals record;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  SELECT * INTO STRICT home_terminal FROM public.terminals t
  WHERE t.branch_id = home_branch AND t.kind = 'pos' AND t.is_active AND t.is_enabled;
  SELECT * INTO STRICT away_terminal FROM public.terminals t
  WHERE t.branch_id = away_branch AND t.kind = 'pos' AND t.is_active AND t.is_enabled;
  SELECT t.* INTO STRICT hidden_terminal FROM public.terminals t
  JOIN public.branches b ON b.id = t.branch_id
  WHERE b.is_hidden AND t.kind = 'pos' AND t.is_active AND t.is_enabled
  ORDER BY t.id LIMIT 1;

  SELECT array_agg(candidate.pin ORDER BY candidate.pin) INTO fixture_pins
  FROM (
    SELECT digits.pin
    FROM generate_series(1000, 9999) i
    CROSS JOIN LATERAL (SELECT i::text AS pin) digits
    WHERE NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.pos_pin::text = digits.pin)
      AND NOT EXISTS (
        SELECT 1 FROM public.employee_credentials c
        WHERE c.is_active AND c.pin_sha256 = extensions.digest(digits.pin, 'sha256')
      )
      AND NOT EXISTS (
        SELECT 1 FROM private.roaming_staff_credentials c
        WHERE c.is_active AND c.pin_sha256 = extensions.digest(digits.pin, 'sha256')
      )
    ORDER BY digits.pin LIMIT 3
  ) candidate;
  IF cardinality(fixture_pins) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'No unused fixture PINs';
  END IF;

  INSERT INTO public.employees(full_name, role, branch_id, is_active, login)
  VALUES (promoter_name, 'promoter', home_branch, true, promoter_login)
  RETURNING id INTO promoter_id;
  INSERT INTO public.employees(full_name, role, branch_id, is_active, login)
  VALUES ('Сергей Проверочный', 'seller', home_branch, true, seller_login)
  RETURNING id INTO seller_id;
  INSERT INTO public.employee_credentials(employee_id, login, pin_plain, pin_hash, pin_sha256, is_active)
  SELECT id, login, pin, extensions.crypt(pin, extensions.gen_salt('bf', 10)),
    extensions.digest(pin, 'sha256'), true
  FROM (VALUES (promoter_id, promoter_login, fixture_pins[1]),
               (seller_id, seller_login, fixture_pins[2])) fixture(id, login, pin);
  INSERT INTO public.employee_payroll_profiles(
    employee_id, branch_id, hourly_rate, has_bonus, bonus_percent, bonus_per_order, max_paid_hours
  ) VALUES (promoter_id, home_branch, 80, true, 0, 150, 5);

  result := public.owner_enroll_roaming_promoter(promoter_id, promoter_name);
  IF (result->>'enabled')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Enrollment did not preserve the existing individual PIN';
  END IF;
  INSERT INTO public.employees(full_name, role, branch_id, is_active)
  VALUES ('Промоутер 2', 'promoter', home_branch, true)
  RETURNING id INTO new_promoter_id;
  result := public.owner_enroll_roaming_promoter(new_promoter_id, 'Оксана Проверочная');
  IF (result->>'enabled')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'A promoter without a PIN gained branch access';
  END IF;
  result := public.app_set_employee_login_pin(new_promoter_id, new_promoter_login, fixture_pins[3]);
  IF (result->>'ok')::boolean IS DISTINCT FROM true OR NOT EXISTS (
    SELECT 1 FROM public.v_employee_logins v WHERE v.employee_id = new_promoter_id
      AND v.is_active AND v.can_work_all_branches AND v.allowed_branch_ids @> ARRAY[home_branch, away_branch]
  ) THEN
    RAISE EXCEPTION 'The existing PIN form could not activate a named promoter';
  END IF;
  BEGIN
    PERFORM public.owner_enroll_roaming_promoter(seller_id, 'Сергей Проверочный');
    RAISE EXCEPTION 'The promoter enrollment RPC accepted a seller';
  EXCEPTION WHEN no_data_found THEN
    NULL;
  END;
  IF NOT EXISTS (
    SELECT 1 FROM public.v_employee_logins v
    WHERE v.employee_id = promoter_id AND v.login = promoter_login
      AND v.full_name = promoter_name AND v.is_active AND v.can_work_all_branches
      AND v.allowed_branch_ids = private.promoter_pos_branch_ids(promoter_id)
      AND ARRAY[home_branch, away_branch] <@ v.allowed_branch_ids
      AND NOT (hidden_terminal.branch_id = ANY(v.allowed_branch_ids))
  ) OR NOT EXISTS (
    SELECT 1 FROM public.v_employee_logins v
    WHERE v.employee_id = seller_id AND v.is_active AND NOT v.can_work_all_branches
      AND v.allowed_branch_ids = ARRAY[home_branch]
  ) OR has_function_privilege('anon', 'public.owner_enroll_roaming_promoter(bigint,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'The POS directory or enrollment grants do not match the branch access policy';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);

  SELECT * INTO STRICT shift_result FROM public.open_employee_session_login_pin_v2(
    seller_login, fixture_pins[2], away_terminal.terminal_code, NULL, client_id
  );
  IF shift_result.error IS DISTINCT FROM 'branch_mismatch' OR shift_result.session_id IS NOT NULL THEN
    RAISE EXCEPTION 'A seller could open a shift outside the assigned branch';
  END IF;
  SELECT * INTO STRICT shift_result FROM public.open_employee_session_login_pin_v2(
    seller_login, fixture_pins[2], home_terminal.terminal_code, NULL, client_id
  );
  IF shift_result.error IS NOT NULL OR shift_result.session_id IS NULL THEN
    RAISE EXCEPTION 'An ordinary home-branch seller could not open a shift';
  END IF;

  result := public.fn_pos_open_by_branch(promoter_login, fixture_pins[2], home_terminal.id, client_id);
  IF result->>'error' IS DISTINCT FROM 'wrong_pin' OR result->>'attendance_session_id' IS NOT NULL THEN
    RAISE EXCEPTION 'The promoter login accepted a different person''s PIN';
  END IF;
  result := public.fn_pos_open_by_branch(promoter_login, fixture_pins[1], hidden_terminal.id, client_id);
  IF result->>'error' IS DISTINCT FROM 'branch_mismatch' OR result->>'attendance_session_id' IS NOT NULL THEN
    RAISE EXCEPTION 'The promoter could open a shift in a hidden branch';
  END IF;

  result := public.fn_pos_open_by_branch(promoter_login, fixture_pins[1], home_terminal.id, client_id);
  home_shift := (result->>'attendance_session_id')::bigint;
  IF result->>'error' IS NOT NULL OR home_shift IS NULL OR result->>'actor_proof' IS NULL
    OR (result->>'employee_id')::bigint IS DISTINCT FROM promoter_id
    OR (result->>'branch_id')::bigint IS DISTINCT FROM home_branch THEN
    RAISE EXCEPTION 'The POS open RPC did not bind the promoter to the home terminal';
  END IF;
  result := public.open_roaming_employee_session(promoter_login, fixture_pins[1], away_terminal.terminal_code, client_id);
  IF result->>'error' IS DISTINCT FROM 'active_shift_other_branch'
    OR (result->>'previous_session_id')::bigint IS DISTINCT FROM home_shift THEN
    RAISE EXCEPTION 'The same employee could open concurrent shifts in multiple branches';
  END IF;
  result := public.close_roaming_employee_session(promoter_login, fixture_pins[1], home_shift, client_id);
  IF (result->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'The promoter could not close the home-branch shift';
  END IF;
  result := public.open_roaming_employee_session(promoter_login, fixture_pins[1], away_terminal.terminal_code, client_id);
  away_shift := (result->>'attendance_session_id')::bigint;
  IF result->>'error' IS NOT NULL OR away_shift IS NULL OR away_shift = home_shift
    OR result->>'actor_proof' IS NULL OR (result->>'employee_id')::bigint IS DISTINCT FROM promoter_id
    OR (result->>'branch_id')::bigint IS DISTINCT FROM away_branch THEN
    RAISE EXCEPTION 'The same named promoter could not open a shift at the new terminal';
  END IF;
  result := public.close_roaming_employee_session(promoter_login, fixture_pins[1], away_shift, client_id);
  IF (result->>'ok')::boolean IS DISTINCT FROM true OR (
    SELECT count(*) FROM public.attendance_sessions s
    WHERE s.id IN (home_shift, away_shift) AND s.employee_id = promoter_id AND s.ended_at IS NOT NULL
      AND ((s.id = home_shift AND s.branch_id = home_branch AND s.terminal_id = home_terminal.id)
        OR (s.id = away_shift AND s.branch_id = away_branch AND s.terminal_id = away_terminal.id))
  ) <> 2 OR EXISTS (
    SELECT 1 FROM private.roaming_login_proofs p
    WHERE p.attendance_session_id IN (home_shift, away_shift) AND p.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Closing a shift did not preserve its branch/terminal or revoke the login proof';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  UPDATE public.attendance_sessions SET
    started_at = (payroll_day + TIME '09:00') AT TIME ZONE 'Asia/Bishkek',
    opened_at = (payroll_day + TIME '09:00') AT TIME ZONE 'Asia/Bishkek',
    ended_at = ((payroll_day + TIME '12:00') AT TIME ZONE 'Asia/Bishkek') AT TIME ZONE 'UTC'
  WHERE id = home_shift;
  UPDATE public.attendance_sessions SET
    started_at = (payroll_day + TIME '12:00') AT TIME ZONE 'Asia/Bishkek',
    opened_at = (payroll_day + TIME '12:00') AT TIME ZONE 'Asia/Bishkek',
    ended_at = ((payroll_day + TIME '16:00') AT TIME ZONE 'Asia/Bishkek') AT TIME ZONE 'UTC'
  WHERE id = away_shift;

  SELECT count(*) * 150 INTO expected_home_bonus
  FROM public.orders o JOIN public.attendance_sessions s ON s.id = home_shift
  WHERE o.branch_id = s.branch_id AND o.is_deleted IS DISTINCT FROM true
    AND o.created_at >= s.started_at AT TIME ZONE 'UTC' AND o.created_at < s.ended_at;
  SELECT count(*) * 150 INTO expected_away_bonus
  FROM public.orders o JOIN public.attendance_sessions s ON s.id = away_shift
  WHERE o.branch_id = s.branch_id AND o.is_deleted IS DISTINCT FROM true
    AND o.created_at >= s.started_at AT TIME ZONE 'UTC' AND o.created_at < s.ended_at;
  IF expected_home_bonus = 0 OR expected_away_bonus = 0 THEN
    RAISE EXCEPTION 'The test copy must include qualifying orders for both payroll fixture shifts';
  END IF;

  SELECT count(*) AS branch_count, sum(p.hours) AS hours, sum(p.hour_pay) AS hour_pay,
    sum(p.bonus) FILTER (WHERE p.branch_id = home_branch) AS home_bonus,
    sum(p.bonus) FILTER (WHERE p.branch_id = away_branch) AS away_bonus,
    sum(p.penalties + p.social_fund_day + p.income_tax_day) AS deductions,
    sum(p.net_day) AS net_total
  INTO STRICT totals
  FROM public.payroll_daily_canonical(payroll_day, payroll_day, NULL, promoter_id) p;
  IF totals.branch_count IS DISTINCT FROM 2::bigint OR totals.hours IS DISTINCT FROM 5::numeric
    OR totals.hour_pay IS DISTINCT FROM 400::numeric OR totals.deductions IS DISTINCT FROM 0::numeric
    OR totals.home_bonus IS DISTINCT FROM expected_home_bonus OR totals.away_bonus IS DISTINCT FROM expected_away_bonus
    OR totals.net_total IS DISTINCT FROM 400 + expected_home_bonus + expected_away_bonus THEN
    RAISE EXCEPTION 'Promoter payroll did not cap total paid hours and attribute each branch bonus to the named employee';
  END IF;
END;
$$;

ROLLBACK;
