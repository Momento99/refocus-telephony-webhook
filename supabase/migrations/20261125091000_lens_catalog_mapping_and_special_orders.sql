-- Explicit mappings for the Kyrgyz retail catalog. Historical order lines are not rewritten.
CREATE OR REPLACE FUNCTION public._lens_catalog_id(p_lens_type text, p_lens_code text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $function$
DECLARE
  s text := upper(split_part(trim(coalesce(nullif(trim(p_lens_code), ''), p_lens_type, '')), ' ', 1));
  lt text := upper(coalesce(p_lens_type, ''));
BEGIN
  IF s = 'AST_AR_167' OR lt LIKE '1.67 AR (АСТ%' THEN RETURN 'thin-ast-antiglare'; END IF;
  IF s IN ('AST_AR_174','AST_AR_174_MINUS','AST_AR_174_PLUS')
    OR lt LIKE '1.74 AR (−)%' THEN RETURN 'thin-174-ast-antiglare'; END IF;
  IF s IN ('AR_174','AR_MINUS_174','AR_PLUS_174') THEN RETURN 'thin-174-antiglare'; END IF;
  IF s IN ('ASPH_STANDARD','ASPH_WHITE') THEN RETURN 'asph-standard'; END IF;
  IF s = 'ASPH_AR' THEN RETURN 'asph-antiglare'; END IF;
  IF s = 'ASPH_BB' THEN RETURN 'asph-screen'; END IF;
  IF s LIKE 'AST%' OR lt LIKE 'AST%' THEN
    IF s LIKE '%CHAME%' OR lt LIKE '%CHAME%' OR s LIKE '%PHOTO%' THEN RETURN 'ast-chameleon'; END IF;
    IF s LIKE '%BB%' OR s LIKE '%BLUECUT%' THEN RETURN 'ast-screen'; END IF;
    RETURN 'ast-antiglare';
  END IF;
  IF s LIKE 'ASPH%' OR lt LIKE 'ASPH%' THEN
    IF s LIKE '%BB%' THEN RETURN 'asph-screen'; END IF;
    IF s LIKE 'ASPH_AR%' THEN RETURN 'asph-antiglare'; END IF;
    RETURN 'asph-standard';
  END IF;
  IF s LIKE '%167%' OR s LIKE '%174%' OR lt LIKE '%1.67%' OR lt LIKE '%1.74%' THEN
    IF s LIKE '%BB%' OR s LIKE '%BLUECUT%' THEN RETURN 'thin-screen'; END IF;
    RETURN 'thin-antiglare';
  END IF;
  IF s LIKE 'PC_159%' OR s LIKE 'HMC-1.59%' OR lt LIKE 'HMC 1.59%' OR s LIKE '%POLY%' THEN
    RETURN 'polycarbonate';
  END IF;
  IF s LIKE '%MYOPIA%' OR lt LIKE '%MYOPIA%' THEN RETURN 'myopia-control'; END IF;
  IF s LIKE '%CHAME%SCREEN%' OR lt LIKE '%CHAME%SCREEN%' THEN RETURN 'chameleon-screen'; END IF;
  IF s LIKE '%CHAME%' OR lt LIKE '%CHAME%' OR s LIKE '%PHOTO%' OR lt LIKE '%PHOTO%' THEN RETURN 'chameleon'; END IF;
  IF s LIKE 'BB%' OR s LIKE '%BLUECUT%' OR s LIKE '%BBX%' OR lt LIKE '%BLUECUT%' THEN RETURN 'screen'; END IF;
  IF s LIKE 'AR%' THEN RETURN 'antiglare'; END IF;
  RETURN 'standard';
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_kg_lens_branch_override()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.branches WHERE id=NEW.branch_id AND country_id='kg') THEN
    RAISE EXCEPTION 'Для филиалов Кыргызстана действует единый прайс';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS reject_kg_lens_branch_override ON public.lens_branch_prices;
CREATE TRIGGER reject_kg_lens_branch_override
  BEFORE INSERT OR UPDATE ON public.lens_branch_prices
  FOR EACH ROW EXECUTE FUNCTION public.reject_kg_lens_branch_override();

DROP TRIGGER IF EXISTS reject_kg_lens_branch_formula ON public.lens_branch_formula_enabled;
CREATE TRIGGER reject_kg_lens_branch_formula
  BEFORE INSERT OR UPDATE ON public.lens_branch_formula_enabled
  FOR EACH ROW EXECUTE FUNCTION public.reject_kg_lens_branch_override();

-- These made-to-order lenses need the exact prescription and a supplier quote.
-- Exposing them independently avoids silently grouping cylindrical orders as SPH-only stock.
CREATE OR REPLACE VIEW public.v_lens_supplier_quote_queue AS
SELECT i.id AS order_item_id, o.order_no, b.branch_name, o.created_at,
  i.lens_code, lc.name AS lens_name, i.eye, i.sph, i.cyl, i.ax, i.qty
FROM public.order_items i
JOIN public.orders o ON o.id=i.order_id
JOIN public.branches b ON b.id=o.branch_id
JOIN public.lens_catalog lc ON lc.id=public._lens_catalog_id(i.lens_type, i.lens_code)
WHERE public.is_owner()
  AND i.item_type::text='lens'
  AND b.country_id='kg' AND NOT coalesce(b.is_hidden,false)
  AND NOT coalesce(o.is_deleted,false)
  AND o.status IN ('NEW','TO_LAB','IN_LAB')
  AND i.lens_code IN ('AST_AR_167','AST_AR_174','AR_174','CHAME_SCREEN_BLACK','CHAME_SCREEN_BROWN');

REVOKE ALL ON public.v_lens_supplier_quote_queue FROM public, anon;
GRANT SELECT ON public.v_lens_supplier_quote_queue TO authenticated;
CREATE OR REPLACE FUNCTION public._lens_ondemand_family(p_lens_type text, p_lens_code text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  lc text := upper(coalesce(p_lens_code, ''));
  lt text := upper(coalesce(p_lens_type, ''));
begin
  if lc like 'CHAME_SCREEN%' or lt like 'CHAME_SCREEN%' then return null; end if;
  if lc like 'AST_%' or lt like 'AST_%' then
    return null;
  end if;
  if lc like 'ASPH_AR%' or lt like 'ASPH_AR%' then return 'ASPH_AR'; end if;
  if lc like 'ASPH_BB%' or lt like 'ASPH_BB%' then return 'ASPH_BB'; end if;
  if lc like 'ASPH_%'   or lt like 'ASPH_%'   then return 'ASPH_STANDARD'; end if;
  if lc like '%GREEN%'  or lt like '%GREEN%'  then return 'CHAME_GREEN'; end if;
  if lc like '%PURPLE%' or lt like '%PURPLE%' then return 'CHAME_PURPLE'; end if;
  if (lc like '%CHAME%BLUE%' or lt like '%CHAME%BLUE%'
      or lc like '%PHOTOBLUE%' or lt like '%PHOTOBLUE%')
     and lc not like '%BLUECUT%' and lt not like '%BLUECUT%' then
    return 'CHAME_BLUE';
  end if;
  if (lc like '%CHAME%BLACK%' or lt like '%CHAME%BLACK%' or lc like '%PHOTOBLACK%' or lt like '%PHOTOBLACK%')
    then return 'CHAME_BLACK'; end if;
  if (lc like '%CHAME%BROWN%' or lt like '%CHAME%BROWN%' or lc like '%PHOTOBROWN%' or lt like '%PHOTOBROWN%')
    then return 'CHAME_BROWN'; end if;
  if lc like '%MYOPIA%' or lt like '%MYOPIA%' then return 'MYOPIA_CONTROL'; end if;
  if lc like 'PC_159%' or lt like 'PC_159%'
     or lt like 'HMC 1.59%' or lc like 'HMC-1.59%' then
    return 'PC_159_HMC';
  end if;
  return null;
end;
$function$;

NOTIFY pgrst, 'reload schema';
