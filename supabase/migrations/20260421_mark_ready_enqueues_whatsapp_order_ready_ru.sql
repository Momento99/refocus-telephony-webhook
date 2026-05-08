-- mark_ready теперь кроме смены статуса на READY ставит строку
-- в whatsapp_followup_queue с шаблоном order_ready_ru,
-- если у заказа notify_whatsapp=true и есть активное согласие в whatsapp_consents.
-- Переменные шаблона собираются из customers/branches/franchise_countries.

CREATE OR REPLACE FUNCTION public.mark_ready(order_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id      bigint;
  v_branch_id        bigint;
  v_notify_whatsapp  boolean;
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

  v_has_consent      boolean;
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
  RETURNING customer_id, branch_id, notify_whatsapp, total_amount, paid_amount
  INTO v_customer_id, v_branch_id, v_notify_whatsapp, v_total, v_paid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Заказ не найден или уже имеет статус READY/DELIVERED';
  END IF;

  IF v_notify_whatsapp IS NOT TRUE THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM whatsapp_consents
    WHERE order_id = mark_ready.order_id AND revoked_at IS NULL
  ) INTO v_has_consent;
  IF NOT v_has_consent THEN
    RETURN;
  END IF;

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
