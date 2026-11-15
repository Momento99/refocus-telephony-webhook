-- pg_net defaults to 5000ms; the WhatsApp scheduler can legitimately run for 60s.
-- Change only HTTP wait time, preserving Vault-based auth, URL, cadence and active state.
-- This migration never invokes the scheduler and is safe to reapply after the guarded repair.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
SELECT pg_advisory_xact_lock(2026111517001::bigint);
DO $migration$
DECLARE
  current_command text; current_schedule text; current_active boolean;
  command_hash text;
  target_command text := $cron$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'crm_url')
             || '/api/admin/whatsapp/scheduler',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 65000
    );
  $cron$;
BEGIN
  SELECT command, schedule, active INTO current_command, current_schedule, current_active
    FROM cron.job WHERE jobid = 17 AND jobname = 'whatsapp_scheduler_via_http';
  IF current_command IS NULL OR current_schedule <> '*/5 * * * *' THEN
    RAISE EXCEPTION 'WhatsApp scheduler cron identity or cadence changed';
  END IF;
  command_hash := encode(extensions.digest(current_command, 'sha256'), 'hex');
  IF command_hash NOT IN ('b53ff097eba0886d6fc3490dc163a1763182d28f65b522f41f1ba7cb97a63ba2', '67de0c5728ff1e083a2832a66ec0aacc4c0192f536afa78efad401d1f335e297') THEN
    RAISE EXCEPTION 'WhatsApp scheduler command changed; refusing to overwrite';
  END IF;
  IF command_hash <> '67de0c5728ff1e083a2832a66ec0aacc4c0192f536afa78efad401d1f335e297' THEN
    PERFORM cron.alter_job(17, command := target_command);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobid = 17 AND command = target_command
      AND schedule = current_schedule AND active = current_active
  ) THEN RAISE EXCEPTION 'WhatsApp scheduler timeout verification failed'; END IF;
END;
$migration$;
COMMIT;
