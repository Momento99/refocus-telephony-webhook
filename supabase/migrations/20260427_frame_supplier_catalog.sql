-- Каталог поставщика оправ (китайский WeChat-каталог).
-- Каждая запись = одно фото из каталога. На фото может быть несколько цветов
-- одной и той же модели — они хранятся в colors[] с bbox для последующей
-- аннотации (рисуем красные цифры заказа поверх).

create extension if not exists "pgcrypto";

create table if not exists public.frame_supplier_catalog (
  id              uuid primary key default gen_random_uuid(),

  -- Дедупликация: SHA-256 от исходного PNG/JPEG.
  -- Один и тот же скриншот не распознаём дважды (экономия LLM-токенов).
  image_hash      text unique not null,

  -- Путь в Supabase Storage bucket 'frame-supplier-catalog'.
  storage_path    text not null,
  width_px        int  not null,
  height_px       int  not null,

  -- Распознавание
  recognized_by   text check (recognized_by in ('opus-4.7','gpt-5','manual')),
  recognized_at   timestamptz,
  confidence      numeric(3,2),         -- 0..1, уверенность модели
  raw_response    jsonb,                -- полный JSON от LLM (для отладки)

  -- Артикул поставщика, например "38007-53-16-147" или "MZ021-49-19-146"
  supplier_model  text,

  -- Категория Refocus (одна на всё фото — модель одна, цвета разные)
  type_code       text check (type_code in ('PA','MA','RP','RM','KD','RL')),
  gender          text check (gender in ('F','M','U')),

  -- Цвета: jsonb-массив объектов вида:
  --   { "label":"C1", "name_ru":"чёрный", "bbox":[0.05,0.10,0.90,0.13] }
  -- bbox в долях изображения (0..1), чтобы корректно работать после ресайза.
  colors          jsonb not null default '[]'::jsonb,

  -- Подсветка: модель не уверена и нужно ручное подтверждение
  needs_review    boolean not null default false,

  -- Человек поправил тип/пол/цвета руками
  manually_corrected boolean not null default false,

  -- Заметки/диагностика от LLM
  notes           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_frame_supplier_catalog_type
  on public.frame_supplier_catalog (type_code, gender);

create index if not exists idx_frame_supplier_catalog_review
  on public.frame_supplier_catalog (needs_review)
  where needs_review;

create index if not exists idx_frame_supplier_catalog_created
  on public.frame_supplier_catalog (created_at desc);

-- updated_at автоматический
create or replace function public.tg_frame_supplier_catalog_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists trg_frame_supplier_catalog_touch on public.frame_supplier_catalog;
create trigger trg_frame_supplier_catalog_touch
  before update on public.frame_supplier_catalog
  for each row execute function public.tg_frame_supplier_catalog_touch();

-- RLS: только owner-роль из app_metadata
alter table public.frame_supplier_catalog enable row level security;

drop policy if exists "frame_supplier_catalog_owner_all" on public.frame_supplier_catalog;
create policy "frame_supplier_catalog_owner_all"
  on public.frame_supplier_catalog
  for all
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner');

-- service_role обходит RLS для серверных API
grant all on public.frame_supplier_catalog to service_role;
