-- Media stays in a private bucket. Validate the same per-device capability that
-- PIN login issues; a guessed attendance id or terminal code is insufficient.
BEGIN;

CREATE OR REPLACE FUNCTION public.whatsapp_authorize_pos(
  p_pos_session_id text,
  p_client_uuid uuid,
  p_terminal_code text
)
RETURNS TABLE(employee_id bigint, branch_id bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $function$
DECLARE
  v_attendance_id bigint;
  v_user_session public.user_sessions%ROWTYPE;
BEGIN
  IF p_client_uuid IS NULL OR NULLIF(btrim(p_terminal_code), '') IS NULL
     OR NULLIF(btrim(p_pos_session_id), '') IS NULL THEN
    RAISE EXCEPTION 'Смена кассы не подтверждена' USING ERRCODE = '42501';
  END IF;

  IF p_pos_session_id ~ '^[0-9]{1,18}$' THEN
    v_attendance_id := p_pos_session_id::bigint;
  ELSIF p_pos_session_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_user_session FROM public.user_sessions u
    WHERE u.id = p_pos_session_id::uuid
      AND u.ended_at IS NULL AND NOT COALESCE(u.force_logout, false)
      AND u.started_at >= statement_timestamp() - interval '18 hours';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Смена кассы не подтверждена' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Смена кассы не подтверждена' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT s.employee_id, s.branch_id
  FROM public.attendance_sessions s
  JOIN public.pos_session_capabilities cap
    ON cap.attendance_session_id = s.id
   AND cap.employee_id = s.employee_id
   AND cap.branch_id = s.branch_id
   AND cap.terminal_id = s.terminal_id
   AND cap.client_uuid_hash = extensions.digest(p_client_uuid::text, 'sha256')
  JOIN public.terminals t ON t.id = s.terminal_id AND t.branch_id = s.branch_id
  JOIN public.employees e ON e.id = s.employee_id
  WHERE (s.id = v_attendance_id OR (
      v_attendance_id IS NULL AND s.employee_id = v_user_session.employee_id
      AND s.branch_id = v_user_session.branch_id AND s.terminal_id = v_user_session.terminal_id
    ))
    AND s.ended_at IS NULL
    AND s.started_at >= statement_timestamp() - interval '18 hours'
    AND COALESCE(s.status, 'open') NOT IN ('cancelled', 'demo')
    AND COALESCE(s.end_reason, '') <> 'demo_cleanup'
    AND COALESCE(t.is_active, true) AND COALESCE(t.is_enabled, true)
    AND COALESCE(e.is_active, true)
    AND e.role::text IN ('seller', 'promoter', 'manager', 'owner')
    AND private.staff_can_work_branch(e.id, s.branch_id)
    AND (
      upper(replace(btrim(t.terminal_code), '-', '')) = upper(replace(btrim(p_terminal_code), '-', ''))
      OR upper(replace(btrim(t.code), '-', '')) = upper(replace(btrim(p_terminal_code), '-', ''))
    )
  ORDER BY s.id DESC LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Смена кассы не подтверждена' USING ERRCODE = '42501';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.whatsapp_authorize_pos(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_authorize_pos(text, uuid, text) TO service_role;
COMMENT ON FUNCTION public.whatsapp_authorize_pos(text, uuid, text) IS
  'Server-only POS media gate. Requires active attendance and a private PIN-issued device capability; never returns the capability hash.';

-- A private bucket can still inherit permissive object policies created for
-- other features. This restrictive policy affects only this bucket. The
-- service-role media proxy (and its short-lived signed download) retains access.
DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'storage' AND c.relname = 'objects' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Storage objects RLS must be enabled before private WhatsApp media is exposed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'storage' AND c.relname = 'objects'
      AND p.polname = 'whatsapp_media_private_access'
  ) THEN
    CREATE POLICY whatsapp_media_private_access ON storage.objects
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (bucket_id <> 'whatsapp-media')
      WITH CHECK (bucket_id <> 'whatsapp-media');
  END IF;
END;
$policy$;

COMMIT;
