-- 2026-06-01 — multi-branch procurement orders + estimated retail price on catalog
-- Both columns were initially applied directly to production via MCP; this file
-- captures the change for repo reproducibility (fresh dev re-setup).

ALTER TABLE public.frame_supplier_catalog
  ADD COLUMN IF NOT EXISTS estimated_price numeric;

COMMENT ON COLUMN public.frame_supplier_catalog.estimated_price IS
  'Оценочная розничная цена в KGS, выставляет нейросеть при распознавании; правится вручную через карточку.';

ALTER TABLE public.frame_procurement_orders
  ADD COLUMN IF NOT EXISTS branch_ids bigint[];

UPDATE public.frame_procurement_orders
  SET branch_ids = ARRAY[branch_id]
  WHERE branch_ids IS NULL AND branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_frame_procurement_orders_branch_ids
  ON public.frame_procurement_orders USING gin (branch_ids);

COMMENT ON COLUMN public.frame_procurement_orders.branch_ids IS
  'Массив филиалов для общего заказа (Tокмок+Кант). branch_id оставлен для бэккомпата = branch_ids[0].';
