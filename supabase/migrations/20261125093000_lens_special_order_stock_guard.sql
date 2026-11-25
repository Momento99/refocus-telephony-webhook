-- A quote-only item must never consume an unrelated spherical stock SKU.
CREATE OR REPLACE FUNCTION public._lens_family_from_lens_type(p_lens_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN upper(split_part(trim(p_lens_type), ' ', 1)) IN ('AR_174','AR_MINUS_174','AR_PLUS_174','CHAME_SCREEN','CHAME_SCREEN_BLACK','CHAME_SCREEN_BROWN','BB_167')
      THEN NULL
    WHEN p_lens_type LIKE 'CHAME\_%' ESCAPE '\' THEN 'CHAME'
    WHEN p_lens_type LIKE 'AR\_%' ESCAPE '\' THEN 'AR'
    WHEN p_lens_type LIKE 'WHITE_167%' THEN 'WHITE_167'
    WHEN p_lens_type LIKE 'WHITE%' THEN 'WHITE'
    WHEN p_lens_type LIKE 'BBX%' THEN 'BBX'
    WHEN p_lens_type LIKE 'BB%' THEN 'BB'
    ELSE split_part(p_lens_type,' ',1)
  END;
$function$;

DO $migration$
DECLARE
  sig regprocedure;
  current_definition text;
  old_match constant text := 'when l.key0 like ''ast_%'' then null';
  guard constant text := $guard$when l.key0 in ('ar_174','ar_minus_174','ar_plus_174','chame_screen','chame_screen_black','chame_screen_brown','bb_167') then null
        $guard$;
BEGIN
  SELECT p.oid::regprocedure INTO STRICT sig
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='lens_writeoff_order';
  current_definition := pg_get_functiondef(sig);
  IF strpos(current_definition,guard) > 0 THEN RETURN; END IF;
  IF (length(current_definition)-length(replace(current_definition,old_match,'')))/length(old_match) <> 4 THEN
    RAISE EXCEPTION 'Unexpected inventory writeoff function. Specialty safeguards were not installed.';
  END IF;
  EXECUTE replace(current_definition,old_match,guard || old_match);
END;
$migration$;
