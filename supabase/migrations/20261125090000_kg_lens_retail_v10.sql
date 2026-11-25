-- The v10 retail assortment for Refocus branches in Kyrgyzstan.
-- Keep country-specific prices and historical order lines independent of the release.
ALTER TABLE public.lens_catalog
  ADD COLUMN IF NOT EXISTS retail_scope text NOT NULL DEFAULT 'all'
  CHECK (retail_scope IN ('all', 'kg', 'outside_kg'));

INSERT INTO public.lens_catalog
  (id, name, category, price_from, price_to, sort_order, display_index, accrue_box_reserve, retail_scope)
VALUES
  ('thin-ast-antiglare',     'Утончённая 1,67 · антиблик при астигматизме', 'premium', 3100, 3500, 13, '1.67', false, 'kg'),
  ('thin-174-antiglare',     'Утончённая 1,74 · антиблик',                  'premium', 3500, 4000, 14, '1.74', false, 'kg'),
  ('thin-174-ast-antiglare', 'Утончённая 1,74 · антиблик при астигматизме', 'premium', 3900, 4800, 15, '1.74', false, 'kg')
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name, sort_order = excluded.sort_order, retail_scope = 'kg', is_active = true;

UPDATE public.lens_catalog
SET retail_scope = 'outside_kg', sort_order = 18
WHERE id = 'thin-screen';

WITH prices(id, sort_order, name) AS (
  VALUES
    ('standard', 1, 'Стандартная'),
    ('antiglare', 2, 'Антиблик'),
    ('screen', 3, 'Защита от экранов'),
    ('chameleon', 4, 'Хамелеон'),
    ('chameleon-screen', 5, 'Хамелеон + защита от экранов'),
    ('ast-antiglare', 6, 'Антиблик при астигматизме'),
    ('ast-screen', 7, 'Защита от экранов при астигматизме'),
    ('ast-chameleon', 8, 'Хамелеон при астигматизме'),
    ('asph-standard', 9, 'Асферическая стандартная'),
    ('asph-antiglare', 10, 'Асферическая антиблик'),
    ('asph-screen', 11, 'Асферическая защита от экранов'),
    ('thin-antiglare', 12, 'Утончённая 1,67 · антиблик'),
    ('polycarbonate', 16, 'Поликарбонат'),
    ('myopia-control', 17, 'Контроль миопии')
)
UPDATE public.lens_catalog l SET name=p.name, sort_order=p.sort_order
FROM prices p WHERE l.id=p.id;

INSERT INTO public.lens_catalog_prices (country_id,lens_id,price_from,price_to)
SELECT 'kg', id, price_from, price_to
FROM (VALUES
  ('standard',400,550),('antiglare',650,900),('screen',900,1350),
  ('chameleon',1000,1250),('chameleon-screen',1900,2400),
  ('ast-antiglare',1050,1450),('ast-screen',1250,1750),('ast-chameleon',1350,1800),
  ('asph-standard',1000,1300),('asph-antiglare',1600,2100),('asph-screen',2200,3000),
  ('thin-antiglare',2500,2800),('thin-ast-antiglare',3100,3500),
  ('thin-174-antiglare',3500,4000),('thin-174-ast-antiglare',3900,4800),
  ('polycarbonate',2850,3550),('myopia-control',8900,9600)
) AS v(id,price_from,price_to)
ON CONFLICT (country_id,lens_id) DO UPDATE SET
  price_from=excluded.price_from, price_to=excluded.price_to;

DELETE FROM public.lens_branch_prices
WHERE branch_id IN (SELECT id FROM public.branches WHERE country_id='kg');
DELETE FROM public.lens_branch_formula_enabled
WHERE branch_id IN (SELECT id FROM public.branches WHERE country_id='kg');

CREATE OR REPLACE VIEW public.lens_catalog_localized AS
SELECT fc.id AS country_id, fc.name AS country_name, fc.currency, fc.currency_symbol,
  fc.exchange_rate, fc.rate_updated_at, lc.id AS lens_id, lc.name AS lens_name,
  lc.category, lc.sort_order, lc.is_active,
  coalesce(lcp.price_from, CASE WHEN fc.id='kg' THEN lc.price_from ELSE round(lc.price_from*fc.exchange_rate)::integer END) AS price_from,
  coalesce(lcp.price_to, CASE WHEN fc.id='kg' THEN lc.price_to ELSE round(lc.price_to*fc.exchange_rate)::integer END) AS price_to,
  (lcp.lens_id IS NOT NULL) AS is_overridden,
  lc.cost_price_from, lc.cost_price_to, lc.cost_price_updated_at
FROM public.franchise_countries fc
CROSS JOIN public.lens_catalog lc
LEFT JOIN public.lens_catalog_prices lcp ON lcp.country_id=fc.id AND lcp.lens_id=lc.id
WHERE fc.is_active AND lc.is_active AND (
  lc.retail_scope='all' OR
  (lc.retail_scope='kg' AND fc.id='kg') OR
  (lc.retail_scope='outside_kg' AND fc.id<>'kg')
);

NOTIFY pgrst, 'reload schema';
