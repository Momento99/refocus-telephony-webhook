-- Preserve the pre-rollout estimate for the retired prescription code.
-- Current 1.74 prescriptions use the new code and their own actual cost.
CREATE OR REPLACE FUNCTION public._lens_cogs_catalog_id(p_lens_type text, p_lens_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN upper(split_part(trim(coalesce(nullif(trim(p_lens_code), ''), p_lens_type)), ' ', 1)) = 'AST_AR_174_MINUS'
      THEN 'ast-antiglare'
    ELSE public._lens_catalog_id(p_lens_type, p_lens_code)
  END;
$function$;

REVOKE ALL ON FUNCTION public._lens_cogs_catalog_id(text,text) FROM public;

DO $migration$
DECLARE
  function_name text;
  function_signature regprocedure;
  function_body text;
  previous_lookup constant text := 'public._lens_catalog_id(oi.lens_type, oi.lens_code)';
  restored_lookup constant text := 'public._lens_cogs_catalog_id(oi.lens_type, oi.lens_code)';
  previous_premium constant text := $keys$,'thin-antiglare','thin-screen')) premium$keys$;
  complete_premium constant text := $keys$,'thin-antiglare','thin-screen','thin-ast-antiglare','thin-174-antiglare','thin-174-ast-antiglare')) premium$keys$;
BEGIN
  FOREACH function_name IN ARRAY ARRAY['_order_lens_cogs','_order_lens_cogs_reserve','app_branch_finance'] LOOP
    SELECT p.oid::regprocedure INTO STRICT function_signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = function_name;
    function_body := pg_get_functiondef(function_signature);

    IF strpos(function_body, restored_lookup) = 0 THEN
      IF (length(function_body) - length(replace(function_body, previous_lookup, ''))) / length(previous_lookup) <> 1 THEN
        RAISE EXCEPTION 'Unexpected function definition for %', function_name;
      END IF;
      EXECUTE replace(function_body, previous_lookup, restored_lookup);
    END IF;
  END LOOP;

  SELECT p.oid::regprocedure INTO STRICT function_signature
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'app_employee_lens_frames';
  function_body := pg_get_functiondef(function_signature);
  IF strpos(function_body, complete_premium) = 0 THEN
    IF (length(function_body) - length(replace(function_body, previous_premium, ''))) / length(previous_premium) <> 1 THEN
      RAISE EXCEPTION 'Unexpected employee lens report definition';
    END IF;
    EXECUTE replace(function_body, previous_premium, complete_premium);
  END IF;
END;
$migration$;
