-- ─── Aftercare follow-up enqueue ─────────────────────────────────────────────
-- Two scheduled WhatsApp messages per delivered order:
--   day 3  → "Как ваши очки?"  (template: aftercare_day3_generic_ru)
--   day 12 → "Гарантия истекает через 2 дня" (template: aftercare_day12_guarantee_ru)
--
-- Dedup rules (matches business agreement):
--   • If customer bought N orders on the SAME delivery date → 1 message of each kind
--     (we pick one order per (customer_id, delivery_date) tuple).
--   • If customer bought on different days → independent message for each delivery date.
--   • Idempotent: re-running on the same day will not duplicate (NOT EXISTS guard).
--
-- Triggered daily by cron at /api/admin/whatsapp/enqueue-aftercare.
-- The existing /api/admin/whatsapp/scheduler picks up queue items and sends them
-- via Meta Cloud API within 5 minutes.
--
-- Meta template status:
--   • aftercare_day3_generic_ru   — already APPROVED, body uses {{1}}=name, {{2}}=branch
--   • aftercare_day12_guarantee_ru — submitted via Graph API, awaits Meta review
--     (until APPROVED, day-12 queue items will fail on send and stay 'failed';
--      day-3 will work normally).

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
  -- Template `aftercare_day3_generic_ru` has TWO variables:
  --   {{1}} = customer first_name (fallback chain: first_name → split(full_name) → 'Клиент')
  --   {{2}} = branch name (fallback: 'Refocus')
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
      AND COALESCE(o.notify_whatsapp, false) = true
      AND length(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g')) >= 10
      AND EXISTS (
        SELECT 1 FROM whatsapp_consents wc
        WHERE wc.order_id = o.id AND wc.revoked_at IS NULL
      )
  ),
  -- One row per (customer, delivery_date): collapses same-day multi-pair purchases.
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
    d.customer_id,
    d.order_id,
    d.branch_id,
    d.phone_digits,
    'aftercare_day3',
    'aftercare_day3_generic_ru',
    'ru',
    jsonb_build_object('1', d.first_name, '2', d.branch_name),
    now(),
    'pending'
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
  -- Template `aftercare_day12_guarantee_ru` has NO variables.
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
      AND COALESCE(o.notify_whatsapp, false) = true
      AND length(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g')) >= 10
      AND EXISTS (
        SELECT 1 FROM whatsapp_consents wc
        WHERE wc.order_id = o.id AND wc.revoked_at IS NULL
      )
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
    d.customer_id,
    d.order_id,
    d.branch_id,
    d.phone_digits,
    'aftercare_day12',
    'aftercare_day12_guarantee_ru',
    'ru',
    '{}'::jsonb,
    now(),
    'pending'
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
