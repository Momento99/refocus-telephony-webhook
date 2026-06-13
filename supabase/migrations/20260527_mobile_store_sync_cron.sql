-- Суточная синхронизация загрузок из App Store / Google Play.
-- Дёргает CRM-роут /api/admin/mobile/sync-stores (Bearer cron_secret), который
-- пишет в public.mobile_store_daily. До добавления ключей сторов роут отвечает
-- «not_configured» и ничего не делает — задачу можно держать включённой заранее.
--
-- Зеркало паттерна whatsapp_scheduler_via_http (crm_url + cron_secret из vault).
-- 30 07 UTC ≈ 13:30 по Бишкеку — отчёты сторов за прошлый день уже доступны.

select cron.schedule(
  'mobile_store_sync_daily',
  '30 7 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'crm_url')
           || '/api/admin/mobile/sync-stores',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{"days":3}'::jsonb
  );
  $$
);
