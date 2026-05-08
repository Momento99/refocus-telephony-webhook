-- ─── Phase 1: Warranty visibility infrastructure ─────────────────────────────
-- Adds:
--   1. order_warranty_uses — audit table tracking when warranties were used
--   2. orders_with_warranties — view that extends orders_view with computed
--      warranty status fields (active / used / expired) per warranty type
--   3. use_adaptation_warranty(...) RPC
--   4. use_prescription_warranty(...) RPC
--
-- Anchor: orders.delivered_at (when customer physically picked up glasses).
--
-- Warranty model (per passport §8.1–§8.4):
--   • adaptation  — 14 days, full replacement, ONE PER PAIR (no recursion).
--                   The pair received as replacement does NOT get its own
--                   adaptation warranty. Old pair's adaptation_status flips
--                   to 'used' and links to the new order via replacement_order_id.
--   • prescription — 60 days, free lens re-do at our cost.
--   • lifetime_service — always active (adjustments, screws, cleaning, polish).
--
-- All three warranties live ON the original delivered order. The replacement
-- order (if any) gets its own 60-day prescription window from ITS delivered_at,
-- but never gets adaptation. Lifetime service applies to all delivered pairs.

-- ─── 1. order_warranty_uses ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.order_warranty_uses (
  id                    BIGSERIAL PRIMARY KEY,
  order_id              BIGINT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  warranty_type         TEXT NOT NULL CHECK (warranty_type IN ('adaptation', 'prescription')),
  used_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_by_employee_id   BIGINT REFERENCES public.employees(id),
  replacement_order_id  BIGINT REFERENCES public.orders(id),
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_warranty_uses_unique UNIQUE (order_id, warranty_type)
);

COMMENT ON TABLE public.order_warranty_uses IS
  'Audit log of warranty usage. One row per (order_id, warranty_type). No deletions or modifications — once a warranty is used, it stays used.';

COMMENT ON COLUMN public.order_warranty_uses.replacement_order_id IS
  'For adaptation warranty: the new order created as the swap. Never set for prescription.';

CREATE INDEX IF NOT EXISTS idx_order_warranty_uses_order_id
  ON public.order_warranty_uses(order_id);
CREATE INDEX IF NOT EXISTS idx_order_warranty_uses_replacement
  ON public.order_warranty_uses(replacement_order_id)
  WHERE replacement_order_id IS NOT NULL;

-- ─── 2. orders_with_warranties view ─────────────────────────────────────────
-- Wraps the existing orders_view and appends warranty fields.
-- POS will switch its query from orders_view → orders_with_warranties.

CREATE OR REPLACE VIEW public.orders_with_warranties AS
SELECT
  ov.*,

  -- ── Adaptation warranty (14 days from delivered_at) ────────────────────
  CASE
    WHEN ov.status != 'DELIVERED' OR ov.delivered_at IS NULL THEN NULL
    WHEN au.used_at IS NOT NULL THEN 'used'
    WHEN ov.delivered_at + INTERVAL '14 days' < NOW() THEN 'expired'
    ELSE 'active'
  END AS adaptation_status,

  -- Days remaining (NULL when not applicable, 0 when expired today)
  CASE
    WHEN ov.status != 'DELIVERED' OR ov.delivered_at IS NULL THEN NULL
    WHEN au.used_at IS NOT NULL THEN NULL
    ELSE GREATEST(
      0,
      EXTRACT(DAY FROM (ov.delivered_at + INTERVAL '14 days' - NOW()))::int
    )
  END AS adaptation_days_remaining,

  (ov.delivered_at + INTERVAL '14 days')::timestamptz AS adaptation_expires_at,
  au.used_at                                          AS adaptation_used_at,
  au.replacement_order_id                             AS adaptation_replacement_order_id,

  -- ── Prescription warranty (60 days from delivered_at) ──────────────────
  CASE
    WHEN ov.status != 'DELIVERED' OR ov.delivered_at IS NULL THEN NULL
    WHEN pu.used_at IS NOT NULL THEN 'used'
    WHEN ov.delivered_at + INTERVAL '60 days' < NOW() THEN 'expired'
    ELSE 'active'
  END AS prescription_status,

  CASE
    WHEN ov.status != 'DELIVERED' OR ov.delivered_at IS NULL THEN NULL
    WHEN pu.used_at IS NOT NULL THEN NULL
    ELSE GREATEST(
      0,
      EXTRACT(DAY FROM (ov.delivered_at + INTERVAL '60 days' - NOW()))::int
    )
  END AS prescription_days_remaining,

  (ov.delivered_at + INTERVAL '60 days')::timestamptz AS prescription_expires_at,
  pu.used_at                                          AS prescription_used_at,

  -- ── Lifetime service (always active for any DELIVERED order) ──────────
  CASE
    WHEN ov.status = 'DELIVERED' THEN 'active'
    ELSE NULL
  END AS lifetime_service_status

FROM public.orders_view ov
LEFT JOIN public.order_warranty_uses au
  ON au.order_id = ov.order_no AND au.warranty_type = 'adaptation'
LEFT JOIN public.order_warranty_uses pu
  ON pu.order_id = ov.order_no AND pu.warranty_type = 'prescription';

COMMENT ON VIEW public.orders_with_warranties IS
  'Extends orders_view with computed warranty status. POS reads from this view.';

-- ─── 3. RPC: use_adaptation_warranty ────────────────────────────────────────
-- Called by POS when seller actually uses the 14-day swap. Validates window
-- and prior usage; inserts audit row. Replacement order is OPTIONAL at this
-- point (can be NULL if seller hasn't created the new order yet).

CREATE OR REPLACE FUNCTION public.use_adaptation_warranty(
  p_order_id              bigint,
  p_employee_id           bigint DEFAULT NULL,
  p_replacement_order_id  bigint DEFAULT NULL,
  p_notes                 text   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status        text;
  v_delivered_at  timestamptz;
  v_already_used  boolean;
  v_use_id        bigint;
BEGIN
  -- Order must exist, be DELIVERED, and within 14 days
  SELECT status, delivered_at
    INTO v_status, v_delivered_at
  FROM orders WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order not found');
  END IF;

  IF v_status != 'DELIVERED' OR v_delivered_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order not in DELIVERED status');
  END IF;

  IF v_delivered_at + INTERVAL '14 days' < NOW() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'adaptation window expired');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM order_warranty_uses
    WHERE order_id = p_order_id AND warranty_type = 'adaptation'
  ) INTO v_already_used;

  IF v_already_used THEN
    RETURN jsonb_build_object('ok', false, 'error', 'adaptation warranty already used');
  END IF;

  INSERT INTO order_warranty_uses
    (order_id, warranty_type, used_by_employee_id, replacement_order_id, notes)
  VALUES
    (p_order_id, 'adaptation', p_employee_id, p_replacement_order_id, p_notes)
  RETURNING id INTO v_use_id;

  RETURN jsonb_build_object('ok', true, 'use_id', v_use_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.use_adaptation_warranty(bigint, bigint, bigint, text) TO authenticated, service_role;

-- ─── 4. RPC: use_prescription_warranty ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.use_prescription_warranty(
  p_order_id     bigint,
  p_employee_id  bigint DEFAULT NULL,
  p_notes        text   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status        text;
  v_delivered_at  timestamptz;
  v_already_used  boolean;
  v_use_id        bigint;
BEGIN
  SELECT status, delivered_at
    INTO v_status, v_delivered_at
  FROM orders WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order not found');
  END IF;

  IF v_status != 'DELIVERED' OR v_delivered_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order not in DELIVERED status');
  END IF;

  IF v_delivered_at + INTERVAL '60 days' < NOW() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'prescription window expired');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM order_warranty_uses
    WHERE order_id = p_order_id AND warranty_type = 'prescription'
  ) INTO v_already_used;

  IF v_already_used THEN
    RETURN jsonb_build_object('ok', false, 'error', 'prescription warranty already used');
  END IF;

  INSERT INTO order_warranty_uses
    (order_id, warranty_type, used_by_employee_id, notes)
  VALUES
    (p_order_id, 'prescription', p_employee_id, p_notes)
  RETURNING id INTO v_use_id;

  RETURN jsonb_build_object('ok', true, 'use_id', v_use_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.use_prescription_warranty(bigint, bigint, text) TO authenticated, service_role;
