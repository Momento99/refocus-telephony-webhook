-- Expose customer_messaging_enabled in the public-facing view
-- so the admin UI can read & display it.
-- (DROP+CREATE because Postgres won't let CREATE OR REPLACE add columns
--  in the middle of an existing column list.)

DROP VIEW IF EXISTS public.whatsapp_api_config_public;

CREATE VIEW public.whatsapp_api_config_public AS
SELECT
  id,
  waba_id,
  phone_number_id,
  business_phone,
  display_name,
  webhook_verify_token,
  is_active,
  customer_messaging_enabled,
  updated_by,
  updated_at,
  created_at,
  access_token IS NOT NULL AND length(access_token) > 0 AS has_access_token
FROM whatsapp_api_config;
