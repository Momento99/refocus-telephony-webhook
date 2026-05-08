-- =====================================================================
-- ЗАКУПКА ОПРАВ — единый SQL для применения через Supabase SQL Editor
-- =====================================================================
-- Что делает:
--   1) Создаёт таблицу frame_supplier_catalog (каталог поставщика + распознанные данные)
--   2) Создаёт frame_procurement_orders + frame_procurement_order_items (заказы)
--   3) Настраивает RLS-политики Storage для bucket 'frame-supplier-catalog'
--      (сам bucket уже создан через API, политики донастроим тут)
--
-- Идемпотентно: безопасно перезапускать. Все CREATE с IF NOT EXISTS,
-- триггеры/политики дропаются перед созданием.
--
-- Где запускать:
--   https://supabase.com/dashboard/project/hbvuwnzemdifaapktaol/sql/new
--   → вставить весь файл → Run
-- =====================================================================

create extension if not exists "pgcrypto";

-- ────────────────────────────────────────────────────────────────────────
-- 1) frame_supplier_catalog
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.frame_supplier_catalog (
  id              uuid primary key default gen_random_uuid(),

  image_hash      text unique not null,
  storage_path    text not null,
  width_px        int  not null,
  height_px       int  not null,

  recognized_by   text check (recognized_by in ('opus-4.7','gpt-5','manual')),
  recognized_at   timestamptz,
  confidence      numeric(3,2),
  raw_response    jsonb,

  supplier_model  text,

  type_code       text check (type_code in ('PA','MA','RP','RM','KD','RL')),
  gender          text check (gender in ('F','M','U')),

  colors          jsonb not null default '[]'::jsonb,

  needs_review    boolean not null default false,
  manually_corrected boolean not null default false,
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

alter table public.frame_supplier_catalog enable row level security;

drop policy if exists "frame_supplier_catalog_owner_all" on public.frame_supplier_catalog;
create policy "frame_supplier_catalog_owner_all"
  on public.frame_supplier_catalog
  for all
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner');

grant all on public.frame_supplier_catalog to service_role;

-- ────────────────────────────────────────────────────────────────────────
-- 2) frame_procurement_orders + items
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.frame_procurement_orders (
  id                 uuid primary key default gen_random_uuid(),

  branch_id          bigint references public.branches(id) on delete restrict,

  status             text not null default 'draft'
    check (status in ('draft','sent','received','cancelled')),

  cold_start         boolean not null default false,
  proxy_branch_id    bigint references public.branches(id) on delete set null,
  sales_window_days  int not null default 60,
  target_warehouse_qty int not null default 1000,
  supplier_min_qty   int not null default 500,

  recognized_by      text,
  qty_by_section     jsonb not null default '{}'::jsonb,
  total_qty          int not null default 0,

  notes              text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  sent_at            timestamptz,
  received_at        timestamptz
);

create index if not exists idx_frame_procurement_orders_branch
  on public.frame_procurement_orders (branch_id, status, created_at desc);

create or replace function public.tg_frame_procurement_orders_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists trg_frame_procurement_orders_touch on public.frame_procurement_orders;
create trigger trg_frame_procurement_orders_touch
  before update on public.frame_procurement_orders
  for each row execute function public.tg_frame_procurement_orders_touch();

create table if not exists public.frame_procurement_order_items (
  id           uuid primary key default gen_random_uuid(),

  order_id     uuid not null
    references public.frame_procurement_orders(id) on delete cascade,

  catalog_id   uuid not null
    references public.frame_supplier_catalog(id) on delete restrict,

  color_label  text not null,
  color_name   text,
  qty          int  not null check (qty > 0),

  bbox         jsonb,

  created_at   timestamptz not null default now()
);

create index if not exists idx_frame_procurement_order_items_order
  on public.frame_procurement_order_items (order_id);

create index if not exists idx_frame_procurement_order_items_catalog
  on public.frame_procurement_order_items (catalog_id);

create unique index if not exists uniq_procurement_item_color
  on public.frame_procurement_order_items (order_id, catalog_id, color_label);

alter table public.frame_procurement_orders enable row level security;
alter table public.frame_procurement_order_items enable row level security;

drop policy if exists "frame_procurement_orders_owner_all" on public.frame_procurement_orders;
create policy "frame_procurement_orders_owner_all"
  on public.frame_procurement_orders
  for all
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner');

drop policy if exists "frame_procurement_order_items_owner_all" on public.frame_procurement_order_items;
create policy "frame_procurement_order_items_owner_all"
  on public.frame_procurement_order_items
  for all
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner');

grant all on public.frame_procurement_orders to service_role;
grant all on public.frame_procurement_order_items to service_role;

-- ────────────────────────────────────────────────────────────────────────
-- 3) Storage RLS — bucket уже создан через API, добавляем политики
--    (сам insert into storage.buckets идемпотентен через on conflict)
-- ────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'frame-supplier-catalog',
  'frame-supplier-catalog',
  false,
  10485760,
  array['image/png','image/jpeg','image/webp']::text[]
)
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "frame_supplier_catalog_owner_select" on storage.objects;
create policy "frame_supplier_catalog_owner_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'frame-supplier-catalog'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  );

drop policy if exists "frame_supplier_catalog_owner_insert" on storage.objects;
create policy "frame_supplier_catalog_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'frame-supplier-catalog'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  );

drop policy if exists "frame_supplier_catalog_owner_update" on storage.objects;
create policy "frame_supplier_catalog_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'frame-supplier-catalog'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  );

drop policy if exists "frame_supplier_catalog_owner_delete" on storage.objects;
create policy "frame_supplier_catalog_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'frame-supplier-catalog'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  );

-- =====================================================================
-- Готово. Должны появиться 3 таблицы:
--   public.frame_supplier_catalog
--   public.frame_procurement_orders
--   public.frame_procurement_order_items
-- =====================================================================
