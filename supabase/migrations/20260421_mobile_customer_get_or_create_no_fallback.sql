-- Убираем автосоздание фейкового клиента «Клиент приложения» при логине в мобильном приложении.
-- Теперь функция:
--   1. Если auth_user уже привязан к реальному клиенту — возвращает его customer_id.
--   2. Если auth_user привязан к legacy-заглушке «Клиент приложения», но настоящего клиента
--      с этим номером уже завели в CRM — перепривязывает на реального клиента.
--   3. Если клиент в CRM найден по номеру (точное или last9) — создаёт связку.
--   4. Если не найден — возвращает NULL (а не плодит фейковых клиентов).
-- Приложение должно уметь работать без связки (показывать прайс, инфо-страницы)
-- и показывать подсказку на вкладках Orders/Glasses, что номер ещё не в базе.

CREATE OR REPLACE FUNCTION public.mobile_customer_get_or_create()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  _phone text;
  _digits text;
  _last9 text;
  _customer_id bigint;
  _count_exact int := 0;
  _count_last9 int := 0;
  _existing_customer_id bigint;
  _existing_full_name text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT cal.customer_id, c.full_name
    INTO _existing_customer_id, _existing_full_name
  FROM public.customer_auth_links cal
  LEFT JOIN public.customers c ON c.id = cal.customer_id
  WHERE cal.auth_user_id = uid
  LIMIT 1;

  SELECT COALESCE(au.phone, au.raw_user_meta_data ->> 'phone_digits')
    INTO _phone
  FROM auth.users au
  WHERE au.id = uid;

  _digits := regexp_replace(COALESCE(_phone, ''), '\D', '', 'g');
  _last9  := right(_digits, 9);

  IF _existing_customer_id IS NOT NULL THEN
    IF _existing_full_name = 'Клиент приложения'
       AND _digits IS NOT NULL AND _digits <> '' THEN
      SELECT c.id INTO _customer_id
      FROM public.customers c
      WHERE regexp_replace(COALESCE(c.phone,''), '\D', '', 'g') = _digits
        AND c.id <> _existing_customer_id
      LIMIT 1;

      IF _customer_id IS NULL AND _last9 <> '' THEN
        SELECT c.id INTO _customer_id
        FROM public.customers c
        WHERE right(regexp_replace(COALESCE(c.phone,''), '\D', '', 'g'), 9) = _last9
          AND c.id <> _existing_customer_id
        LIMIT 1;
      END IF;

      IF _customer_id IS NOT NULL THEN
        UPDATE public.customer_auth_links
           SET customer_id = _customer_id
         WHERE auth_user_id = uid;
        RETURN _customer_id;
      END IF;
    END IF;

    RETURN _existing_customer_id;
  END IF;

  IF _digits IS NULL OR _digits = '' THEN
    RAISE EXCEPTION 'Phone not found in auth.users';
  END IF;

  SELECT count(*) INTO _count_exact
  FROM public.customers c
  WHERE regexp_replace(COALESCE(c.phone,''), '\D', '', 'g') = _digits;

  IF _count_exact = 1 THEN
    SELECT c.id INTO _customer_id
    FROM public.customers c
    WHERE regexp_replace(COALESCE(c.phone,''), '\D', '', 'g') = _digits
    LIMIT 1;

    INSERT INTO public.customer_auth_links(auth_user_id, customer_id)
    VALUES (uid, _customer_id)
    ON CONFLICT (auth_user_id) DO UPDATE SET customer_id = excluded.customer_id;

    INSERT INTO public.mobile_user_settings(auth_user_id)
    VALUES (uid)
    ON CONFLICT (auth_user_id) DO NOTHING;

    RETURN _customer_id;
  END IF;

  SELECT count(*) INTO _count_last9
  FROM public.customers c
  WHERE right(regexp_replace(COALESCE(c.phone,''), '\D', '', 'g'), 9) = _last9;

  IF _count_last9 = 1 THEN
    SELECT c.id INTO _customer_id
    FROM public.customers c
    WHERE right(regexp_replace(COALESCE(c.phone,''), '\D', '', 'g'), 9) = _last9
    LIMIT 1;

    INSERT INTO public.customer_auth_links(auth_user_id, customer_id)
    VALUES (uid, _customer_id)
    ON CONFLICT (auth_user_id) DO UPDATE SET customer_id = excluded.customer_id;

    INSERT INTO public.mobile_user_settings(auth_user_id)
    VALUES (uid)
    ON CONFLICT (auth_user_id) DO NOTHING;

    RETURN _customer_id;
  END IF;

  INSERT INTO public.mobile_user_settings(auth_user_id)
  VALUES (uid)
  ON CONFLICT (auth_user_id) DO NOTHING;

  RETURN NULL;
END
$$;
