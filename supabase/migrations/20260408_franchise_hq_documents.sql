-- Добавляем колонку documents в таблицу franchise_hq_items
-- Каждый документ: { name: string, url: string }
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'franchise_hq_items' and column_name = 'documents'
  ) then
    alter table franchise_hq_items add column documents jsonb not null default '[]'::jsonb;
  end if;
end $$;
