-- Таблица для хранения статусов, заметок и содержимого пунктов плана франшизы
create table if not exists franchise_hq_items (
  id          text        primary key,    -- например '1.1', '6.3', '13.7'
  status      text        not null default 'Нет'
                check (status in ('Есть', 'Частично', 'Нет', 'Не нужно сейчас')),
  completed   boolean     not null default false,
  notes       text        not null default '',
  content     text        not null default '',   -- основной текст (может быть несколько страниц)
  updated_at  timestamptz not null default now()
);

-- Если таблица уже существует, добавить поле content если его нет
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'franchise_hq_items' and column_name = 'content'
  ) then
    alter table franchise_hq_items add column content text not null default '';
  end if;
end $$;

-- Автоматически обновлять updated_at при изменении строки
create or replace function set_franchise_hq_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists franchise_hq_items_updated_at on franchise_hq_items;
create trigger franchise_hq_items_updated_at
  before update on franchise_hq_items
  for each row execute procedure set_franchise_hq_updated_at();

-- RLS: только авторизованные пользователи
alter table franchise_hq_items enable row level security;

drop policy if exists "Allow all for authenticated users" on franchise_hq_items;
create policy "Allow all for authenticated users"
  on franchise_hq_items
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
