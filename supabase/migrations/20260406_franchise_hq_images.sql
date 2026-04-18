-- Добавляем колонку images в таблицу franchise_hq_items
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'franchise_hq_items' and column_name = 'images'
  ) then
    alter table franchise_hq_items add column images text[] not null default '{}';
  end if;
end $$;
