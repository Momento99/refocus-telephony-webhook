-- Без этой политики DELETE в /admin/employee-calendar (и в /admin/franchise-calendar)
-- молча не удалял строки: на franchise_calendar_events были только INSERT/SELECT/UPDATE
-- политики, а RLS включён.
DROP POLICY IF EXISTS fce_delete ON public.franchise_calendar_events;
CREATE POLICY fce_delete ON public.franchise_calendar_events
  FOR DELETE TO authenticated
  USING (true);
