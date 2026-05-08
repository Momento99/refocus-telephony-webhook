-- Каскадное удаление организации вместе со всеми её филиалами и их "сеттап-обвязкой"
-- (сотрудники, терминалы, склады, франчайзи-доки, фидбек и т.п.).
-- БЛОКИРУЕТ удаление, если у любого филиала есть реальная бизнес-история:
-- orders, pos_shifts, attendance_sessions, payroll_entries, refunds, stock_moves, shipments.
-- Контракты и счета (franchise_contracts, franchise_invoices) не удаляются,
-- у них обнуляется branch_id / organization_id, чтобы сохранить историю платежей.

CREATE OR REPLACE FUNCTION public.fn_delete_organization_cascade(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role            text;
  v_branch_ids      bigint[];
  v_warehouse_ids   uuid[];
  v_blocker         record;
  v_employees_deleted int;
  v_terminals_deleted int;
  v_warehouses_deleted int;
  v_branches_deleted  int;
BEGIN
  v_role := COALESCE(
    auth.jwt() -> 'app_metadata' ->> 'role',
    auth.jwt() ->> 'role'
  );
  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'insufficient_privilege: only owner/manager can delete organization'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::bigint[])
    INTO v_branch_ids
  FROM branches
  WHERE organization_id = p_org_id;

  SELECT COALESCE(array_agg(DISTINCT id), ARRAY[]::uuid[])
    INTO v_warehouse_ids
  FROM warehouses
  WHERE manager_branch_id = ANY(v_branch_ids);

  SELECT
    (SELECT count(*) FROM orders              WHERE branch_id     = ANY(v_branch_ids)) AS orders,
    (SELECT count(*) FROM pos_shifts          WHERE branch_id     = ANY(v_branch_ids)) AS pos_shifts,
    (SELECT count(*) FROM attendance_sessions WHERE branch_id     = ANY(v_branch_ids)) AS attendance,
    (SELECT count(*) FROM payroll_entries     WHERE branch_id     = ANY(v_branch_ids)) AS payroll_entries,
    (SELECT count(*) FROM refunds             WHERE branch_id     = ANY(v_branch_ids)) AS refunds,
    (SELECT count(*) FROM stock_moves         WHERE from_branch_id = ANY(v_branch_ids)
                                               OR to_branch_id    = ANY(v_branch_ids)) AS stock_moves,
    (SELECT count(*) FROM shipments           WHERE from_branch_id = ANY(v_branch_ids)
                                               OR to_branch_id    = ANY(v_branch_ids)) AS shipments
  INTO v_blocker;

  IF (v_blocker.orders + v_blocker.pos_shifts + v_blocker.attendance
      + v_blocker.payroll_entries + v_blocker.refunds
      + v_blocker.stock_moves + v_blocker.shipments) > 0 THEN
    RAISE EXCEPTION
      'organization_has_business_history: orders=%, shifts=%, attendance=%, payroll=%, refunds=%, stock_moves=%, shipments=%',
      v_blocker.orders, v_blocker.pos_shifts, v_blocker.attendance,
      v_blocker.payroll_entries, v_blocker.refunds,
      v_blocker.stock_moves, v_blocker.shipments
      USING ERRCODE = '23503';
  END IF;

  UPDATE warehouses SET manager_branch_id = NULL WHERE manager_branch_id = ANY(v_branch_ids);
  UPDATE branches   SET warehouse_id       = NULL WHERE id = ANY(v_branch_ids);

  UPDATE franchise_contracts SET branch_id = NULL WHERE branch_id = ANY(v_branch_ids);
  UPDATE franchise_invoices  SET branch_id = NULL WHERE branch_id = ANY(v_branch_ids);
  UPDATE expenses            SET branch_id = NULL WHERE branch_id = ANY(v_branch_ids);

  DELETE FROM franchise_documents        WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM franchise_calendar_events  WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM franchise_calendar_templates WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM franchise_checklist_logs   WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM franchise_launch_progress  WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM franchise_messages         WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM franchise_notifications    WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM franchise_supply_orders    WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM franchise_supply_plans     WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM franchise_users            WHERE branch_id = ANY(v_branch_ids);

  DELETE FROM feedback_daily_questions   WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM feedback_daily_responses   WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM feedback_weekly_anonymous  WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM feedback_weekly_responses  WHERE branch_id = ANY(v_branch_ids);

  DELETE FROM frame_barcodes             WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM frames                     WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM inventory_locations        WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM opex_daily_rates           WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM cogs_per_order_rates       WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM order_accessory_writeoffs  WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM payroll_rules              WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM penalty_rules              WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM stock_batches              WHERE branch_id = ANY(v_branch_ids);

  DELETE FROM instagram_quality_reports  WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM instagram_thread_quality   WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM whatsapp_consents          WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM whatsapp_followup_queue    WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM whatsapp_quality_reports   WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM whatsapp_seller_scores     WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM whatsapp_thread_quality    WHERE branch_id = ANY(v_branch_ids);
  DELETE FROM whatsapp_threads           WHERE branch_id = ANY(v_branch_ids);

  DELETE FROM lab_jobs                   WHERE workshop_branch_id = ANY(v_branch_ids);

  DELETE FROM service_qa.weekly_employee_advice WHERE branch_id = ANY(v_branch_ids);

  WITH d AS (DELETE FROM employees WHERE branch_id = ANY(v_branch_ids) RETURNING 1)
  SELECT count(*) INTO v_employees_deleted FROM d;

  WITH d AS (DELETE FROM terminals WHERE branch_id = ANY(v_branch_ids) RETURNING 1)
  SELECT count(*) INTO v_terminals_deleted FROM d;

  WITH d AS (DELETE FROM branches WHERE id = ANY(v_branch_ids) RETURNING 1)
  SELECT count(*) INTO v_branches_deleted FROM d;

  WITH d AS (
    DELETE FROM warehouses
    WHERE id = ANY(v_warehouse_ids)
      AND NOT EXISTS (SELECT 1 FROM branches b WHERE b.warehouse_id = warehouses.id)
    RETURNING 1
  )
  SELECT count(*) INTO v_warehouses_deleted FROM d;

  UPDATE franchise_contracts SET organization_id = NULL WHERE organization_id = p_org_id;
  UPDATE franchise_invoices  SET organization_id = NULL WHERE organization_id = p_org_id;

  DELETE FROM organizations WHERE id = p_org_id;

  RETURN jsonb_build_object(
    'deleted_branches',  v_branches_deleted,
    'deleted_employees', v_employees_deleted,
    'deleted_terminals', v_terminals_deleted,
    'deleted_warehouses', v_warehouses_deleted,
    'branch_ids',        v_branch_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_delete_organization_cascade(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_delete_organization_cascade(uuid) TO authenticated;
