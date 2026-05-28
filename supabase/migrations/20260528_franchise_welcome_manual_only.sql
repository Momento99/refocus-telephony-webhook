-- 2026-05-28: убираем автоматический welcome лиду из триггера новой заявки.
-- Welcome теперь шлётся руками через wa.me-кнопку в карточке лида,
-- чтобы сообщение шло с личного +996 555, а не с розничного +996 705 (Cloud API).
-- Owner alert (раздел 3) и timeline event (раздел 1) остаются без изменений.

CREATE OR REPLACE FUNCTION public.franchise_application_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_crm_url text;
  v_owner_phone text;
BEGIN
  SELECT value INTO v_crm_url FROM franchise_config WHERE key = 'crm_base_url';
  SELECT value INTO v_owner_phone FROM franchise_config WHERE key = 'owner_whatsapp';

  -- 1. Timeline event: заявка получена
  INSERT INTO franchise_application_events(application_id, event_type, payload, note)
  VALUES (
    NEW.id,
    'application_received',
    jsonb_build_object(
      'source', NEW.source,
      'name', NEW.name,
      'phone', NEW.phone,
      'city', NEW.city,
      'pd_consent_at', NEW.pd_consent_at
    ),
    'Заявка получена от ' || NEW.name || ' (' || NEW.phone || ')'
  );

  -- 2. Welcome лиду УБРАН из автоочереди. Шлётся руками через wa.me-кнопку в CRM.
  --    Событие welcome_sent_manually пишется со стороны фронта.

  -- 3. Alert владельцу — остаётся автоматическим
  INSERT INTO franchise_whatsapp_outbox(
    application_id, recipient_role, phone_number,
    template_name, template_language, template_variables
  ) VALUES (
    NEW.id, 'owner', v_owner_phone,
    'franchise_alert_ru', 'ru',
    jsonb_build_object(
      '1', NEW.name,
      '2', NEW.phone,
      '3', COALESCE(NEW.city, 'не указан'),
      '4', COALESCE(NEW.source, 'unknown'),
      '5', v_crm_url || '/admin/franchise-applications/' || NEW.id::text
    )
  );

  INSERT INTO franchise_application_events(application_id, event_type, note)
  VALUES (NEW.id, 'owner_alert_queued', 'Alert владельцу поставлен в очередь');

  RETURN NEW;
END;
$function$;
