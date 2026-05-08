-- В enqueue_*_push функциях добавляем дедуп по expo_push_token:
-- если один физический девайс засветился в нескольких строках
-- mobile_push_devices (разные device_id, но одинаковый токен),
-- push отправится только на одну — самую свежую по last_seen_at.
--
-- Функции: enqueue_order_ready_push, enqueue_checkup_push_due,
--          enqueue_checkup_push_for_customer, enqueue_news_test_push_for_customer.

CREATE OR REPLACE FUNCTION public.enqueue_order_ready_push(p_order_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cnt int := 0;
  _title text;
  _body text;
  _order record;
BEGIN
  SELECT o.id, o.order_no, o.customer_id, o.branch_id, o.status
  INTO _order
  FROM public.orders o
  WHERE o.id = p_order_id
    AND COALESCE(o.is_deleted, false) = false
  LIMIT 1;

  IF _order.id IS NULL THEN RETURN 0; END IF;
  IF _order.status NOT IN ('READY', 'DELIVERED') THEN RETURN 0; END IF;

  SELECT COALESCE(template_title, 'Ваш заказ готов'),
         COALESCE(template_body,  'Ваши очки готовы. Можете забрать заказ в удобное время.')
  INTO _title, _body
  FROM public.notification_rules
  WHERE code = 'orders_ready' AND is_enabled = true
  LIMIT 1;

  _title := COALESCE(_title, 'Ваш заказ готов');
  _body  := COALESCE(_body,  'Ваши очки готовы. Можете забрать заказ в удобное время.');

  WITH candidates AS (
    SELECT DISTINCT ON (d.expo_push_token)
           cal.auth_user_id, d.device_id, d.expo_push_token, d.last_seen_at
    FROM public.customer_auth_links cal
    JOIN public.mobile_user_settings mus ON mus.auth_user_id = cal.auth_user_id
    JOIN public.mobile_push_devices d    ON d.auth_user_id   = cal.auth_user_id AND d.is_active = true
    WHERE cal.customer_id = _order.customer_id
      AND mus.notify_orders = true
    ORDER BY d.expo_push_token, COALESCE(d.last_seen_at, d.updated_at) DESC
  )
  INSERT INTO public.notification_dispatch_queue (
    kind, rule_code, customer_id, order_id,
    auth_user_id, device_id, expo_push_token,
    scheduled_at, status, payload
  )
  SELECT
    'orders_ready', 'orders_ready', _order.customer_id, _order.id,
    c.auth_user_id, c.device_id, c.expo_push_token,
    now(), 'queued',
    jsonb_build_object(
      'title', _title, 'body', _body,
      'order_id', _order.id, 'order_no', _order.order_no,
      'branch_id', _order.branch_id, 'customer_id', _order.customer_id,
      'status', _order.status
    )
  FROM candidates c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notification_dispatch_queue q
    WHERE q.kind = 'orders_ready'
      AND q.order_id = _order.id
      AND q.expo_push_token = c.expo_push_token
      AND q.status IN ('queued', 'processing', 'sent')
  );

  GET DIAGNOSTICS _cnt = ROW_COUNT;

  INSERT INTO public.notification_logs (source, kind, status, customer_id, message, meta)
  VALUES (
    'order_ready_status', 'orders_ready',
    CASE WHEN _cnt > 0 THEN 'success' ELSE 'info' END,
    _order.customer_id,
    CASE WHEN _cnt > 0
         THEN 'Push «заказ готов» поставлен в очередь'
         ELSE 'Push «заказ готов» не поставлен: нет app link / opt-in / active device / дубль' END,
    jsonb_build_object('order_id', _order.id, 'order_no', _order.order_no,
                       'status', _order.status, 'queued_count', _cnt)
  );

  RETURN _cnt;
END
$$;


CREATE OR REPLACE FUNCTION public.enqueue_checkup_push_due()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cnt int := 0;
  _rule record;
  _interval_months int := 12;
  _send_delay_minutes int := 0;
BEGIN
  SELECT code, is_enabled, template_title, template_body, send_delay_minutes, checkup_interval_months
  INTO _rule
  FROM public.notification_rules
  WHERE code = 'checkup_reminder'
  LIMIT 1;

  IF _rule.code IS NULL THEN
    RAISE EXCEPTION 'Не найден notification_rules.checkup_reminder';
  END IF;

  IF COALESCE(_rule.is_enabled, false) = false THEN RETURN 0; END IF;

  _interval_months    := greatest(COALESCE(_rule.checkup_interval_months, 12), 1);
  _send_delay_minutes := greatest(COALESCE(_rule.send_delay_minutes, 0), 0);

  WITH candidates AS (
    SELECT DISTINCT ON (d.expo_push_token, cs.customer_id)
           cs.customer_id, cs.full_name, cs.last_order_at,
           cal.auth_user_id, d.device_id, d.expo_push_token
    FROM public.customer_stats cs
    JOIN public.customer_auth_links cal ON cal.customer_id = cs.customer_id
    JOIN public.mobile_user_settings mus ON mus.auth_user_id = cal.auth_user_id
    JOIN public.mobile_push_devices d    ON d.auth_user_id   = cal.auth_user_id AND d.is_active = true
    WHERE cs.last_order_at IS NOT NULL
      AND mus.notify_checkups = true
      AND cs.last_order_at <= now() - make_interval(months => _interval_months)
    ORDER BY d.expo_push_token, cs.customer_id, COALESCE(d.last_seen_at, d.updated_at) DESC
  )
  INSERT INTO public.notification_dispatch_queue (
    kind, rule_code, customer_id,
    auth_user_id, device_id, expo_push_token,
    scheduled_at, status, payload
  )
  SELECT
    'checkup_reminder', 'checkup_reminder', c.customer_id,
    c.auth_user_id, c.device_id, c.expo_push_token,
    now() + make_interval(mins => _send_delay_minutes), 'queued',
    jsonb_build_object(
      'title', COALESCE(nullif(trim(_rule.template_title), ''), 'Пора проверить зрение'),
      'body',  COALESCE(nullif(trim(_rule.template_body),  ''), 'Рекомендуем пройти повторную диагностику зрения в Refocus.'),
      'customer_id', c.customer_id, 'full_name', c.full_name,
      'last_order_at', c.last_order_at, 'interval_months', _interval_months
    )
  FROM candidates c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notification_dispatch_queue q
    WHERE q.kind = 'checkup_reminder'
      AND q.customer_id = c.customer_id
      AND q.expo_push_token = c.expo_push_token
      AND q.status IN ('queued', 'processing', 'sent')
      AND q.created_at > now() - make_interval(months => _interval_months)
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.notification_logs l
    WHERE l.kind = 'checkup_reminder' AND l.status = 'success'
      AND l.customer_id = c.customer_id
      AND l.created_at > now() - make_interval(months => _interval_months)
  );

  GET DIAGNOSTICS _cnt = ROW_COUNT;

  INSERT INTO public.notification_logs (source, kind, status, message, meta)
  VALUES (
    'checkup_scheduler', 'checkup_reminder',
    CASE WHEN _cnt > 0 THEN 'success' ELSE 'info' END,
    CASE WHEN _cnt > 0
         THEN 'Автоматическая проверка диагностики поставила push в очередь'
         ELSE 'Автоматическая проверка диагностики: подходящих клиентов нет' END,
    jsonb_build_object('queued_count', _cnt, 'interval_months', _interval_months)
  );

  RETURN _cnt;
END
$$;


CREATE OR REPLACE FUNCTION public.enqueue_checkup_push_for_customer(p_customer_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cnt int := 0;
  _title text := 'Пора проверить зрение';
  _body  text := 'Рекомендуем пройти повторную диагностику зрения в Refocus.';
  _delay_minutes int := 0;
BEGIN
  SELECT COALESCE(template_title, 'Пора проверить зрение'),
         COALESCE(template_body,  'Рекомендуем пройти повторную диагностику зрения в Refocus.'),
         COALESCE(send_delay_minutes, 0)
  INTO _title, _body, _delay_minutes
  FROM public.notification_rules
  WHERE code = 'checkup_reminder' AND is_enabled = true
  LIMIT 1;

  WITH candidates AS (
    SELECT DISTINCT ON (d.expo_push_token)
           cs.customer_id, cs.full_name, cs.last_order_at,
           cal.auth_user_id, d.device_id, d.expo_push_token
    FROM public.customer_stats cs
    JOIN public.customer_auth_links cal ON cal.customer_id = cs.customer_id
    JOIN public.mobile_user_settings mus ON mus.auth_user_id = cal.auth_user_id
    JOIN public.mobile_push_devices d    ON d.auth_user_id   = cal.auth_user_id AND d.is_active = true
    WHERE cs.customer_id = p_customer_id
      AND mus.notify_checkups = true
    ORDER BY d.expo_push_token, COALESCE(d.last_seen_at, d.updated_at) DESC
  )
  INSERT INTO public.notification_dispatch_queue (
    kind, rule_code, customer_id,
    auth_user_id, device_id, expo_push_token,
    scheduled_at, status, payload
  )
  SELECT
    'checkup_reminder', 'checkup_reminder', c.customer_id,
    c.auth_user_id, c.device_id, c.expo_push_token,
    now() + make_interval(mins => _delay_minutes), 'queued',
    jsonb_build_object(
      'title', _title, 'body', _body,
      'customer_id', c.customer_id, 'full_name', c.full_name,
      'last_order_at', c.last_order_at, 'test_mode', true
    )
  FROM candidates c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notification_dispatch_queue q
    WHERE q.kind = 'checkup_reminder'
      AND q.customer_id = c.customer_id
      AND q.expo_push_token = c.expo_push_token
      AND q.status IN ('queued', 'processing', 'sent')
      AND q.created_at > now() - interval '1 hour'
  );

  GET DIAGNOSTICS _cnt = ROW_COUNT;

  INSERT INTO public.notification_logs (source, kind, status, customer_id, message, meta)
  VALUES (
    'checkup_test', 'checkup_reminder',
    CASE WHEN _cnt > 0 THEN 'success' ELSE 'info' END,
    p_customer_id,
    CASE WHEN _cnt > 0
         THEN 'Тестовое push-напоминание о диагностике поставлено в очередь'
         ELSE 'Тестовое push-напоминание не поставлено: нет app link / opt-in / active device / дубль' END,
    jsonb_build_object('customer_id', p_customer_id, 'queued_count', _cnt)
  );

  RETURN _cnt;
END
$$;


CREATE OR REPLACE FUNCTION public.enqueue_news_test_push_for_customer(
  p_customer_id bigint,
  p_title text DEFAULT 'Тестовая новость Refocus',
  p_body  text DEFAULT 'Это тестовое push-уведомление новостей и акций.'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cnt int := 0;
BEGIN
  WITH candidates AS (
    SELECT DISTINCT ON (d.expo_push_token)
           c.id AS customer_id,
           cal.auth_user_id, d.device_id, d.expo_push_token
    FROM public.customers c
    JOIN public.customer_auth_links cal ON cal.customer_id = c.id
    JOIN public.mobile_user_settings mus ON mus.auth_user_id = cal.auth_user_id
    JOIN public.mobile_push_devices d    ON d.auth_user_id   = cal.auth_user_id AND d.is_active = true
    WHERE c.id = p_customer_id
      AND mus.notify_news = true
    ORDER BY d.expo_push_token, COALESCE(d.last_seen_at, d.updated_at) DESC
  )
  INSERT INTO public.notification_dispatch_queue (
    kind, rule_code, customer_id,
    auth_user_id, device_id, expo_push_token,
    scheduled_at, status, payload
  )
  SELECT
    'news_campaign', 'news_campaign', c.customer_id,
    c.auth_user_id, c.device_id, c.expo_push_token,
    now(), 'queued',
    jsonb_build_object(
      'title', COALESCE(nullif(trim(p_title), ''), 'Тестовая новость Refocus'),
      'body',  COALESCE(nullif(trim(p_body),  ''), 'Это тестовое push-уведомление новостей и акций.'),
      'customer_id', c.customer_id, 'test_mode', true
    )
  FROM candidates c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notification_dispatch_queue q
    WHERE q.kind = 'news_campaign'
      AND q.customer_id = c.customer_id
      AND q.expo_push_token = c.expo_push_token
      AND q.status IN ('queued', 'processing', 'sent')
      AND q.created_at > now() - interval '1 hour'
  );

  GET DIAGNOSTICS _cnt = ROW_COUNT;

  INSERT INTO public.notification_logs (source, kind, status, customer_id, message, meta)
  VALUES (
    'news_test', 'news_campaign',
    CASE WHEN _cnt > 0 THEN 'success' ELSE 'info' END,
    p_customer_id,
    CASE WHEN _cnt > 0
         THEN 'Тестовое push-уведомление новости поставлено в очередь'
         ELSE 'Тестовая новость не поставлена: нет app link / notify_news / active device / дубль' END,
    jsonb_build_object('customer_id', p_customer_id, 'queued_count', _cnt)
  );

  RETURN _cnt;
END
$$;
