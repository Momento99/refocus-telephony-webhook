-- Добавляем колонку readiness (0 | 25 | 50 | 75 | 100)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'franchise_hq_items' and column_name = 'readiness'
  ) then
    alter table franchise_hq_items add column readiness integer not null default 0;
  end if;
end $$;

-- Миграция старых данных:
-- Если content заполнен, а readiness = 0 (никогда не выставлялся вручную) →
-- считаем документ готовым на 100% и отмечаем completed = true
update franchise_hq_items
set
  readiness = 100,
  completed = true
where
  content <> ''
  and readiness = 0;
