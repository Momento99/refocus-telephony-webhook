-- Split the existing 1.67 stock family from the ordinary 1.56 antiglare family.
-- SKU ids, order prices and historical stock movements remain as recorded.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.lens_family_map WHERE family = 'AR' AND refractive_index = 1.67
  ) THEN
    IF EXISTS (
      SELECT 1 FROM public.lens_family_map WHERE family = 'AR_167' AND refractive_index = 1.67
    ) THEN
      RAISE EXCEPTION 'Conflicting 1.67 antiglare stock mappings';
    END IF;
    UPDATE public.lens_family_map
    SET family = 'AR_167'
    WHERE family = 'AR' AND refractive_index = 1.67 AND coating::text = 'AR';
    IF NOT FOUND THEN RAISE EXCEPTION 'Unexpected 1.67 antiglare coating'; END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.lens_family_map
    WHERE family = 'AR_167' AND refractive_index = 1.67 AND coating::text = 'AR'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.lens_family_map
    WHERE family = 'AR' AND refractive_index = 1.56 AND coating::text = 'AR'
  ) THEN
    RAISE EXCEPTION 'Expected distinct 1.56 and 1.67 antiglare stock mappings';
  END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION public._lens_family_from_lens_type(p_lens_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN upper(split_part(trim(p_lens_type), ' ', 1)) IN
      ('AR_174','AR_MINUS_174','AR_PLUS_174','CHAME_SCREEN','CHAME_SCREEN_BLACK','CHAME_SCREEN_BROWN','BB_167')
      THEN NULL
    WHEN upper(split_part(trim(p_lens_type), ' ', 1)) IN ('AR_167','AR_MINUS_167','AR_PLUS_167')
      THEN 'AR_167'
    WHEN p_lens_type LIKE 'CHAME\_%' ESCAPE '\' THEN 'CHAME'
    WHEN p_lens_type LIKE 'AR\_%' ESCAPE '\' THEN 'AR'
    WHEN p_lens_type LIKE 'WHITE_167%' THEN 'WHITE_167'
    WHEN p_lens_type LIKE 'WHITE%' THEN 'WHITE'
    WHEN p_lens_type LIKE 'BBX%' THEN 'BBX'
    WHEN p_lens_type LIKE 'BB%' THEN 'BB'
    ELSE split_part(p_lens_type,' ',1)
  END;
$function$;

-- Existing demand reports and procurement batch creation use these normalizers.
CREATE OR REPLACE FUNCTION public.normalize_lens_family_key(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN upper(split_part(trim(p_raw), ' ', 1)) IN ('AR_167','AR_MINUS_167','AR_PLUS_167') THEN 'AR_167'
    ELSE nullif(regexp_replace(regexp_replace(btrim(coalesce(p_raw,'')), '\s*\[.*$', '', 'g'), '_(PLUS|MINUS)$', '', 'i'),'')
  END;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_lens_family(p_lens_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN upper(split_part(trim(p_lens_type), ' ', 1)) IN ('AR_167','AR_MINUS_167','AR_PLUS_167') THEN 'AR_167'
    ELSE nullif(regexp_replace(regexp_replace(regexp_replace(coalesce(p_lens_type,''), '\s*\[[^\]]*\]\s*$', ''), '(_PLUS|_MINUS)$', ''), '\s+', ' ', 'g'),'')
  END;
$function$;

-- Allow 1.67 specifically in the existing central-warehouse demand and issue paths.
DO $migration$
DECLARE
  issue_function text := pg_get_functiondef('public.lens_issue_from_order_sokuluk(bigint,text,boolean)'::regprocedure);
  stock_view text := pg_get_viewdef('public.v_sokuluk_lens_needs'::regclass, true);
  legacy_signature regprocedure;
  legacy_function text;
  legacy_arm constant text := $arm$when l.key0 like 'ar_%' or l.key0 = 'ar' then 'ar'$arm$;
  legacy_167_arm constant text := $arm$when l.key0 in ('ar_167','ar_minus_167','ar_plus_167') then 'ar_167'$arm$;
BEGIN
  IF strpos(issue_function,'oi.family = ''AR_167''') = 0 THEN
    IF strpos(issue_function,'fm.refractive_index = 1.56::numeric') = 0
      OR strpos(issue_function,'ls1.refractive_index = 1.56::numeric') = 0 THEN
      RAISE EXCEPTION 'Unexpected Sokuluk lens issue definition';
    END IF;
    issue_function := replace(issue_function, 'fm.refractive_index = 1.56::numeric',
      'fm.refractive_index = case when oi.family = ''AR_167'' then 1.67::numeric else 1.56::numeric end');
    issue_function := replace(issue_function, 'ls1.refractive_index = 1.56::numeric',
      'ls1.refractive_index = case when m.family = ''AR_167'' then 1.67::numeric else 1.56::numeric end');
    EXECUTE issue_function;
  END IF;

  IF strpos(stock_view,'oi.family = ''AR_167''') = 0 THEN
    IF strpos(stock_view,'fm.refractive_index = 1.56') = 0
      OR strpos(stock_view,'ls1.refractive_index = 1.56') = 0 THEN
      RAISE EXCEPTION 'Unexpected Sokuluk lens demand view definition';
    END IF;
    stock_view := replace(stock_view, 'fm.refractive_index = 1.56',
      'fm.refractive_index = case when oi.family = ''AR_167'' then 1.67 else 1.56 end');
    stock_view := replace(stock_view, 'ls1.refractive_index = 1.56',
      'ls1.refractive_index = case when m.family = ''AR_167'' then 1.67 else 1.56 end');
    EXECUTE 'CREATE OR REPLACE VIEW public.v_sokuluk_lens_needs AS ' || stock_view;
  END IF;

  SELECT p.oid::regprocedure INTO STRICT legacy_signature
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'lens_writeoff_order';
  legacy_function := pg_get_functiondef(legacy_signature);
  IF strpos(legacy_function,legacy_167_arm) = 0 THEN
    IF (length(legacy_function) - length(replace(legacy_function,legacy_arm,''))) / length(legacy_arm) <> 4 THEN
      RAISE EXCEPTION 'Unexpected legacy lens writeoff definition';
    END IF;
    EXECUTE replace(legacy_function,legacy_arm,legacy_167_arm || E'\n        ' || legacy_arm);
  END IF;
END;
$migration$;
