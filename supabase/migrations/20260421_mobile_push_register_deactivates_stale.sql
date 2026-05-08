-- При регистрации нового push-токена в приложении деактивируем
-- все остальные активные записи того же (auth_user_id, platform),
-- у которых device_id другой И last_seen_at старше 7 дней.
-- Свежие активные устройства (напр. телефон + планшет одного юзера)
-- остаются живыми — мульти-девайс поведение сохраняется.

CREATE OR REPLACE FUNCTION public.mobile_push_register(
  p_platform       text,
  p_expo_push_token text,
  p_device_id      text
)
RETURNS public.mobile_push_devices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_user_id uuid;
  v_row public.mobile_push_devices;
BEGIN
  v_auth_user_id := auth.uid();

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_platform IS NULL OR btrim(p_platform) = '' THEN
    RAISE EXCEPTION 'p_platform is required';
  END IF;

  IF p_expo_push_token IS NULL OR btrim(p_expo_push_token) = '' THEN
    RAISE EXCEPTION 'p_expo_push_token is required';
  END IF;

  IF p_device_id IS NULL OR btrim(p_device_id) = '' THEN
    RAISE EXCEPTION 'p_device_id is required';
  END IF;

  UPDATE public.mobile_push_devices
     SET is_active  = false,
         updated_at = now()
   WHERE auth_user_id = v_auth_user_id
     AND platform     = p_platform
     AND device_id IS DISTINCT FROM p_device_id
     AND is_active    = true
     AND COALESCE(last_seen_at, updated_at) < now() - interval '7 days';

  UPDATE public.mobile_push_devices
     SET expo_push_token = p_expo_push_token,
         is_active       = true,
         last_seen_at    = now(),
         updated_at      = now()
   WHERE auth_user_id = v_auth_user_id
     AND platform     = p_platform
     AND device_id    = p_device_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    INSERT INTO public.mobile_push_devices (
      auth_user_id, platform, expo_push_token, device_id, is_active, last_seen_at
    )
    VALUES (
      v_auth_user_id, p_platform, p_expo_push_token, p_device_id, true, now()
    )
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;
