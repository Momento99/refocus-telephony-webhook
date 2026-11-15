-- A single WhatsApp writer, with ambiguous sends kept out of automatic retries.
-- Deployment: pause cron jobs 16 and 17, drain existing work, apply this migration,
-- resume 16 (Instagram only), deploy the matching CRM, then resume 17.
-- No dispatcher is invoked by this migration. Source guards accept original or target bodies.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

DO $guard$
DECLARE body_hash text; status_check text;
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE
      (jobid = 16 AND jobname = 'messaging_safety_net' AND NOT active) OR
      (jobid = 17 AND jobname = 'whatsapp_scheduler_via_http' AND NOT active)) <> 2 THEN
    RAISE EXCEPTION 'Pause both messaging cron jobs 16 and 17 before this migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM cron.job_run_details r JOIN pg_stat_activity a ON a.pid = r.job_pid
    WHERE r.jobid IN (16,17) AND r.end_time IS NULL AND a.state <> 'idle'
  ) THEN RAISE EXCEPTION 'Messaging cron work is still running'; END IF;
  IF EXISTS (SELECT 1 FROM public.wa_messages_inflight) OR
     EXISTS (SELECT 1 FROM public.whatsapp_dispatcher_inflight) THEN
    RAISE EXCEPTION 'Legacy WhatsApp requests are still in flight; restore cron and retry later';
  END IF;

  SELECT encode(extensions.digest(prosrc, 'sha256'), 'hex') INTO body_hash
    FROM pg_proc WHERE oid = 'public.fn_messaging_recover_stuck_sending()'::regprocedure;
  IF body_hash NOT IN ('a2e16597fd8a553bdd6b5c114e6a863d4c3ef0d5970eec72e36ff772275f88a0', '5ab58feda32c9f31d1e344c64319734aa52287d21eded5037a652f674b311227') THEN
    RAISE EXCEPTION 'Refusing to overwrite changed function public.fn_messaging_recover_stuck_sending';
  END IF;

  SELECT encode(extensions.digest(prosrc, 'sha256'), 'hex') INTO body_hash
    FROM pg_proc WHERE oid = 'public.fn_messaging_safety_net_tick()'::regprocedure;
  IF body_hash NOT IN ('39c8ad96561b64188a11bbe59e224d1e5d6304745f56409fac4976005eca17d8', 'c760f1ce9f7ee43a093963a907afb391f906699c62fa75523800b58d4c263993') THEN
    RAISE EXCEPTION 'Refusing to overwrite changed function public.fn_messaging_safety_net_tick';
  END IF;

  SELECT pg_get_constraintdef(oid, true) INTO status_check FROM pg_constraint
    WHERE conrelid = 'public.whatsapp_followup_queue'::regclass
      AND conname = 'whatsapp_followup_queue_status_check';
  IF status_check IS NULL OR status_check NOT IN (
    'CHECK (status = ANY (ARRAY[''pending''::text, ''sent''::text, ''failed''::text, ''cancelled''::text]))',
    'CHECK (status = ANY (ARRAY[''pending''::text, ''sending''::text, ''sent''::text, ''failed''::text, ''cancelled''::text]))'
  ) THEN RAISE EXCEPTION 'Unexpected WhatsApp followup status constraint'; END IF;
END;
$guard$;

ALTER TABLE public.whatsapp_followup_queue
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_wa_message_id text;
ALTER TABLE public.whatsapp_followup_queue
  DROP CONSTRAINT whatsapp_followup_queue_status_check;
ALTER TABLE public.whatsapp_followup_queue
  ADD CONSTRAINT whatsapp_followup_queue_status_check
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled'));
COMMENT ON COLUMN public.whatsapp_followup_queue.accepted_wa_message_id IS
  'Provider acceptance recorded before local bookkeeping; a non-null value prohibits automatic retransmission.';

CREATE OR REPLACE FUNCTION public.fn_messaging_recover_stuck_sending()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_ig int;
BEGIN
  -- WhatsApp uncertain sends must never be requeued automatically.
  -- Instagram keeps its existing recovery policy and database worker.
  WITH upd AS (
    UPDATE public.instagram_messages
       SET status = 'pending'
     WHERE status = 'sending'
       AND updated_at < now() - interval '5 minutes'
    RETURNING 1
  ) SELECT count(*)::int INTO v_ig FROM upd;

  RETURN jsonb_build_object('wa_recovered', 0, 'ig_recovered', v_ig);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_messaging_safety_net_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  recovered jsonb;
  ig_collected int; ig_sent int;
BEGIN
  recovered := public.fn_messaging_recover_stuck_sending();
  -- WhatsApp has one writer: the HTTP scheduler and its shared CAS sender.
  -- Preserve the existing Instagram worker and cadence.
  ig_collected := public.fn_ig_messages_dispatcher_collect();
  ig_sent      := public.fn_ig_messages_dispatcher_send();

  RETURN jsonb_build_object(
    'recovered', recovered,
    'wa', jsonb_build_object('collected', 0, 'submitted', 0),
    'ig', jsonb_build_object('collected', ig_collected, 'submitted', ig_sent),
    'tick_at', now()
  );
END;
$function$;


-- These SECURITY DEFINER workers are not browser APIs. Keep trusted service access.
REVOKE ALL ON FUNCTION public.fn_wa_messages_dispatcher_send() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_wa_messages_dispatcher_collect() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_whatsapp_dispatcher_send() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_whatsapp_dispatcher_collect() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_whatsapp_dispatcher_tick() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_messaging_safety_net_tick() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_messaging_recover_stuck_sending() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wa_messages_dispatcher_send(), public.fn_wa_messages_dispatcher_collect(),
  public.fn_whatsapp_dispatcher_send(), public.fn_whatsapp_dispatcher_collect(), public.fn_whatsapp_dispatcher_tick(),
  public.fn_messaging_safety_net_tick(), public.fn_messaging_recover_stuck_sending() TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
