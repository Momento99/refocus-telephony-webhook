-- Check stored retail unit prices atomically for POS clients that opt in.
CREATE OR REPLACE FUNCTION public.validate_kg_lens_quote(p_branch_id bigint, p_items jsonb)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE
  item jsonb;
  code text;
  catalog_id text;
  sphere numeric;
  quoted_price numeric;
  current_price numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id=p_branch_id AND country_id='kg') THEN
    RETURN;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) LOOP
    IF item->>'item_type' IS DISTINCT FROM 'lens' THEN CONTINUE; END IF;
    code := item->>'lens_code';
    IF code IS NULL OR code NOT IN (
      'WHITE','AR','BB','CHAME_BLACK','CHAME_BROWN','CHAME_BLUE','CHAME_GREEN','CHAME_PURPLE',
      'CHAME_SCREEN_BLACK','CHAME_SCREEN_BROWN','AST_AR','AST_BB','AST_CHAME_BLACK','AST_CHAME_BROWN',
      'ASPH_STANDARD','ASPH_AR','ASPH_BB','AR_167','AST_AR_167','AR_174','AST_AR_174',
      'PC_159_HMC','MYOPIA_CONTROL'
    ) THEN
      RAISE EXCEPTION 'Линза отсутствует в действующем прайсе' USING ERRCODE='23514';
    END IF;
    sphere := (item->>'sph')::numeric;
    quoted_price := (item->>'price')::numeric;
    IF sphere IS NULL OR mod(abs(sphere),0.25) <> 0 THEN
      RAISE EXCEPTION 'Проверьте сферу линзы' USING ERRCODE='23514';
    END IF;
    catalog_id := public._lens_catalog_id(NULL,code);
    SELECT CASE WHEN abs(sphere) <= 2.75 THEN v.price_from ELSE v.price_to END INTO current_price
    FROM public.v_lens_prices_resolved v
    WHERE v.branch_id=p_branch_id AND v.lens_id=catalog_id;

    IF current_price IS NULL OR quoted_price IS DISTINCT FROM current_price THEN
      RAISE EXCEPTION 'Прайс линз обновился. Проверьте выбранные линзы и подтвердите сумму ещё раз.'
        USING ERRCODE='23514';
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_kg_lens_quote(bigint,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.validate_kg_lens_quote(bigint,jsonb) TO authenticated;

-- Leave all existing seller, session and payment checks in place.
DO $migration$
DECLARE
  current_definition text := pg_get_functiondef('public.pos_create_order_atomic(jsonb,jsonb,jsonb)'::regprocedure);
  insertion_point constant text := '  INSERT INTO public.orders (';
  quote_guard constant text := $guard$  IF coalesce(p_order->>'check_lens_quote','') = 'true' THEN
    PERFORM public.validate_kg_lens_quote((p_order->>'branch_id')::bigint, p_items);
  END IF;
$guard$;
BEGIN
  IF strpos(current_definition,'PERFORM public.validate_kg_lens_quote(') > 0 THEN RETURN; END IF;
  IF (length(current_definition)-length(replace(current_definition,insertion_point,'')))/length(insertion_point) <> 1 THEN
    RAISE EXCEPTION 'Unexpected POS order function. Quote validation was not installed.';
  END IF;
  EXECUTE replace(current_definition,insertion_point,quote_guard || insertion_point);
END;
$migration$;

NOTIFY pgrst, 'reload schema';
