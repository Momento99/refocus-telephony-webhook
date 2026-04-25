-- Widen unique constraint on whatsapp_followup_queue to (order_id, scenario)
-- so the same order can have day-3 and day-12 aftercare in addition to order_ready.
-- Old constraint was UNIQUE(order_id) which prevented multiple scenarios per order.

DROP INDEX IF EXISTS public.idx_wa_followup_order_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_followup_order_scenario_unique
  ON public.whatsapp_followup_queue (order_id, scenario)
  WHERE status IN ('pending', 'sent');
