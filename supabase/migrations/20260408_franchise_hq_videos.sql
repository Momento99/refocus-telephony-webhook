-- Добавляем колонку videos в таблицу franchise_hq_items
-- Каждое видео: { title: string, url: string }
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'franchise_hq_items' and column_name = 'videos'
  ) then
    alter table franchise_hq_items add column videos jsonb not null default '[]'::jsonb;
  end if;
end $$;
