-- ─── Drop WhatsApp opt-in requirement ───────────────────────────────────────
-- Business decision (2026-04-25): we send Utility-category WhatsApp templates
-- to all customers with a valid phone number, without requiring a separate
-- opt-in checkbox or consent record.
--
-- Rationale: aftercare and order_ready messages are Utility templates tied to
-- a real transaction the customer just made. Meta WhatsApp Business Policy
-- allows this without explicit per-customer opt-in for Utility category.
--
-- This migration:
--   1. Removes the notify_whatsapp + whatsapp_consents checks from:
--      - mark_ready()                  (sends order_ready_ru)
--      - enqueue_whatsapp_aftercare()  (sends day-3 + day-12 templates)
--   2. Keeps phone-format check (>= 10 digits after stripping non-digits).
--   3. Keeps already-queued dedup check (prevents duplicates).
--
-- The scheduler is also updated separately to skip its consent-revoked check.
--
-- To re-enable opt-in later, either revert this migration or restore the
-- two checks: COALESCE(notify_whatsapp,false)=true AND EXISTS(consents…).

-- ─── 1. mark_ready ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_ready(order_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id      bigint;
  v_branch_id        bigint;
  v_total            numeric;
  v_paid             numeric;

  v_customer_phone   text;
  v_first_name       text;
  v_full_name        text;

  v_branch_name      text;
  v_work_hours       text;
  v_country_id       text;

  v_currency_symbol  text;

  v_debt             numeric;
  v_debt_str         text;

  v_has_queued       boolean;
BEGIN
  UPDATE public.orders
  SET
    status   = 'READY'::order_status_t,
    ready_at = COALESCE(ready_at, NOW())
  WHERE id = order_id
    AND COALESCE(is_deleted, false) = false
    AND status IS DISTINCT FROM 'READY'::order_status_t
    AND status IS DISTINCT FROM 'DELIVERED'::order_status_t
  RETURNING customer_id, branch_id, total_amount, paid_amount
  INTO v_customer_id, v_branch_id, v_total, v_paid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Заказ не найден или уже имеет статус READY/DELIVERED';
  END IF;

  -- Dedup: don't enqueue twice for the same order.
  SELECT EXISTS (
    SELECT 1 FROM whatsapp_followup_queue
    WHERE order_id = mark_ready.order_id
      AND scenario  = 'order_ready'
      AND status IN ('pending', 'sent')
  ) INTO v_has_queued;
  IF v_has_queued THEN
    RETURN;
  END IF;

  SELECT c.first_name, c.full_name, regexp_replace(COALESCE(c.phone,''), '\D', '', 'g')
    INTO v_first_name, v_full_name, v_customer_phone
  FROM customers c
  WHERE c.id = v_customer_id;

  IF v_customer_phone IS NULL OR length(v_customer_phone) < 10 THEN
    RETURN;
  END IF;

  IF v_first_name IS NULL OR length(btrim(v_first_name)) = 0 THEN
    v_first_name := NULLIF(btrim(split_part(COALESCE(v_full_name,''), ' ', 1)), '');
  END IF;
  IF v_first_name IS NULL THEN
    v_first_name := 'Клиент';
  END IF;

  SELECT b.name, b.work_hours, b.country_id
    INTO v_branch_name, v_work_hours, v_country_id
  FROM branches b
  WHERE b.id = v_branch_id;

  IF v_work_hours IS NULL OR length(btrim(v_work_hours)) = 0 THEN
    v_work_hours := 'уточняйте у продавца';
  END IF;

  SELECT fc.currency_symbol
    INTO v_currency_symbol
  FROM franchise_countries fc
  WHERE fc.id = v_country_id;
  v_currency_symbol := COALESCE(NULLIF(btrim(v_currency_symbol), ''), 'с');

  v_debt := GREATEST(COALESCE(v_total, 0) - COALESCE(v_paid, 0), 0);
  v_debt_str :=
    regexp_replace(
      to_char(round(v_debt)::bigint, 'FM999999999999'),
      '(\d)(?=(\d{3})+$)', '\1 ', 'g'
    ) || ' ' || v_currency_symbol;

  INSERT INTO whatsapp_followup_queue (
    customer_id,
    order_id,
    branch_id,
    phone_number,
    scenario,
    scheduled_at,
    template_name,
    template_language,
    template_variables,
    status,
    attempts
  ) VALUES (
    v_customer_id,
    mark_ready.order_id,
    v_branch_id,
    v_customer_phone,
    'order_ready',
    NOW(),
    'order_ready_ru',
    'ru',
    jsonb_build_object(
      '1', v_first_name,
      '2', v_branch_name,
      '3', v_work_hours,
      '4', v_debt_str
    ),
    'pending',
    0
  );
END
$$;

-- ─── 2. enqueue_whatsapp_aftercare ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION enqueue_whatsapp_aftercare()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tz             text := 'Asia/Bishkek';  -- TODO: per-branch timezone when multi-country
  v_today          date := (now() AT TIME ZONE v_tz)::date;
  v_day3_anchor    date := v_today - INTERVAL '3 days';
  v_day12_anchor   date := v_today - INTERVAL '12 days';
  v_day3_count     int := 0;
  v_day12_count    int := 0;
BEGIN
  -- ─── Day 3 ─────────────────────────────────────────────────────────────────
  WITH eligible AS (
    SELECT
      o.id            AS order_id,
      o.customer_id,
      o.branch_id,
      regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') AS phone_digits,
      COALESCE(
        NULLIF(btrim(c.first_name), ''),
        NULLIF(btrim(split_part(COALESCE(c.full_name, ''), ' ', 1)), ''),
        'Клиент'
      ) AS first_name,
      COALESCE(NULLIF(btrim(b.name), ''), 'Refocus') AS branch_name,
      (o.delivered_at AT TIME ZONE v_tz)::date AS delivery_date
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    JOIN branches  b ON b.id = o.branch_id
    WHERE o.status = 'DELIVERED'
      AND o.delivered_at IS NOT NULL
      AND (o.delivered_at AT TIME ZONE v_tz)::date = v_day3_anchor
      AND length(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g')) >= 10
  ),
  deduped AS (
    SELECT DISTINCT ON (customer_id, delivery_date)
      order_id, customer_id, branch_id, phone_digits, first_name, branch_name, delivery_date
    FROM eligible
    ORDER BY customer_id, delivery_date, order_id
  )
  INSERT INTO whatsapp_followup_queue (
    customer_id, order_id, branch_id, phone_number,
    scenario, template_name, template_language, template_variables,
    scheduled_at, status
  )
  SELECT
    d.customer_id, d.order_id, d.branch_id, d.phone_digits,
    'aftercare_day3', 'aftercare_day3_generic_ru', 'ru',
    jsonb_build_object('1', d.first_name, '2', d.branch_name),
    now(), 'pending'
  FROM deduped d
  WHERE NOT EXISTS (
    SELECT 1 FROM whatsapp_followup_queue q
    WHERE q.customer_id = d.customer_id
      AND q.scenario = 'aftercare_day3'
      AND (q.scheduled_at AT TIME ZONE v_tz)::date = v_today
      AND q.status IN ('pending', 'sent')
  );
  GET DIAGNOSTICS v_day3_count = ROW_COUNT;

  -- ─── Day 12 ────────────────────────────────────────────────────────────────
  WITH eligible AS (
    SELECT
      o.id            AS order_id,
      o.customer_id,
      o.branch_id,
      regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') AS phone_digits,
      (o.delivered_at AT TIME ZONE v_tz)::date AS delivery_date
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.status = 'DELIVERED'
      AND o.delivered_at IS NOT NULL
      AND (o.delivered_at AT TIME ZONE v_tz)::date = v_day12_anchor
      AND length(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g')) >= 10
  ),
  deduped AS (
    SELECT DISTINCT ON (customer_id, delivery_date)
      order_id, customer_id, branch_id, phone_digits, delivery_date
    FROM eligible
    ORDER BY customer_id, delivery_date, order_id
  )
  INSERT INTO whatsapp_followup_queue (
    customer_id, order_id, branch_id, phone_number,
    scenario, template_name, template_language, template_variables,
    scheduled_at, status
  )
  SELECT
    d.customer_id, d.order_id, d.branch_id, d.phone_digits,
    'aftercare_day12', 'aftercare_day12_guarantee_ru', 'ru',
    '{}'::jsonb,
    now(), 'pending'
  FROM deduped d
  WHERE NOT EXISTS (
    SELECT 1 FROM whatsapp_followup_queue q
    WHERE q.customer_id = d.customer_id
      AND q.scenario = 'aftercare_day12'
      AND (q.scheduled_at AT TIME ZONE v_tz)::date = v_today
      AND q.status IN ('pending', 'sent')
  );
  GET DIAGNOSTICS v_day12_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'today',          v_today,
    'day3_anchor',    v_day3_anchor,
    'day12_anchor',   v_day12_anchor,
    'day3_enqueued',  v_day3_count,
    'day12_enqueued', v_day12_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION enqueue_whatsapp_aftercare() TO service_role;
