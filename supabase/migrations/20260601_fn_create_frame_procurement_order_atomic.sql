-- Atomic creation of frame_procurement_orders + its items in a single
-- plpgsql transaction. Replaces the previous non-transactional pattern in
-- /api/admin/frame-procurement/orders POST handler, where a failure in the
-- items insert led to a separate DELETE that could itself fail (RLS/network)
-- and orphan the order header.

CREATE OR REPLACE FUNCTION public.fn_create_frame_procurement_order(
  p_branch_id           bigint,
  p_branch_ids          bigint[],
  p_status              text,
  p_sales_window_days   integer,
  p_target_warehouse_qty integer,
  p_supplier_min_qty    integer,
  p_recognized_by       text,
  p_qty_by_section      jsonb,
  p_total_qty           integer,
  p_sent_at             timestamptz,
  p_items               jsonb
)
RETURNS public.frame_procurement_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.frame_procurement_orders;
BEGIN
  INSERT INTO public.frame_procurement_orders (
    branch_id,
    branch_ids,
    status,
    cold_start,
    proxy_branch_id,
    sales_window_days,
    target_warehouse_qty,
    supplier_min_qty,
    recognized_by,
    qty_by_section,
    total_qty,
    sent_at
  ) VALUES (
    p_branch_id,
    p_branch_ids,
    p_status,
    false,
    NULL,
    p_sales_window_days,
    p_target_warehouse_qty,
    p_supplier_min_qty,
    p_recognized_by,
    COALESCE(p_qty_by_section, '{}'::jsonb),
    p_total_qty,
    p_sent_at
  )
  RETURNING * INTO v_order;

  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    INSERT INTO public.frame_procurement_order_items (
      order_id,
      catalog_id,
      color_label,
      color_name,
      qty,
      bbox
    )
    SELECT
      v_order.id,
      (it->>'catalog_id')::uuid,
      it->>'color_label',
      it->>'color_name',
      (it->>'qty')::integer,
      CASE WHEN it ? 'bbox' THEN it->'bbox' ELSE NULL END
    FROM jsonb_array_elements(p_items) AS it;
  END IF;

  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_frame_procurement_order(
  bigint, bigint[], text, integer, integer, integer, text, jsonb, integer, timestamptz, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fn_create_frame_procurement_order(
  bigint, bigint[], text, integer, integer, integer, text, jsonb, integer, timestamptz, jsonb
) TO authenticated, service_role;
