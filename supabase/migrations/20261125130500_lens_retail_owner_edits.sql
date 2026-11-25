-- Retail storefronts keep read access. Administrative catalog changes require an owner session.
ALTER TABLE public.lens_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lens_catalog_prices ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
ON TABLE public.lens_catalog, public.lens_catalog_prices FROM PUBLIC, anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES
ON TABLE public.lens_catalog, public.lens_catalog_prices FROM authenticated;

CREATE POLICY lens_catalog_read ON public.lens_catalog
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY lens_catalog_owner_write ON public.lens_catalog
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND (public.is_owner() OR auth.jwt()->'app_metadata'->>'role' = 'owner'))
  WITH CHECK (auth.uid() IS NOT NULL AND (public.is_owner() OR auth.jwt()->'app_metadata'->>'role' = 'owner'));

CREATE POLICY lens_catalog_prices_read ON public.lens_catalog_prices
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY lens_catalog_prices_owner_write ON public.lens_catalog_prices
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND (public.is_owner() OR auth.jwt()->'app_metadata'->>'role' = 'owner'))
  WITH CHECK (auth.uid() IS NOT NULL AND (public.is_owner() OR auth.jwt()->'app_metadata'->>'role' = 'owner'));
