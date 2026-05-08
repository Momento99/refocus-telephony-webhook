-- UI /admin/notifications ожидает колонку country_id на правилах (чтобы переключать
-- «🌍 Все / Кыргызстан / Россия / …»), но колонки в таблице не было, и upsert падал
-- с «Could not find the 'country_id' column of 'notification_rules' in the schema cache».
-- Добавляем колонку (nullable = правило глобальное).

ALTER TABLE public.notification_rules
  ADD COLUMN IF NOT EXISTS country_id text NULL
    REFERENCES public.franchise_countries(id) ON UPDATE CASCADE ON DELETE SET NULL;

COMMENT ON COLUMN public.notification_rules.country_id IS
  'NULL = правило применяется глобально. Иначе — id страны из franchise_countries, для per-country override.';
