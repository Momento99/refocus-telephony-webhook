-- Заказы оправ у китайского поставщика.
-- Заказ = снимок алгоритма распределения + список items (модель × цвет × кол-во).

create table if not exists public.frame_procurement_orders (
  id                 uuid primary key default gen_random_uuid(),

  -- Кому везём (Токмок, потом другие филиалы)
  branch_id          bigint references public.branches(id) on delete restrict,

  -- Жизненный цикл
  status             text not null default 'draft'
    check (status in ('draft','sent','received','cancelled')),

  -- Снимок параметров алгоритма (для воспроизводимости)
  cold_start         boolean not null default false,
  proxy_branch_id    bigint references public.branches(id) on delete set null,
  sales_window_days  int not null default 60,
  target_warehouse_qty int not null default 1000,
  supplier_min_qty   int not null default 500,

  -- Какой моделью распознавали каталог: 'opus-4.7' | 'gpt-5' | 'mixed' | 'manual'
  recognized_by      text,

  -- Итоговое распределение по секциям — для отчётности.
  -- Пример: {"PA_F": 178, "PA_M": 134, "MA_F": 120, "MA_M": 80, ...}
  qty_by_section     jsonb not null default '{}'::jsonb,

  -- Сумма всех items.qty (cached для быстрых отчётов)
  total_qty          int not null default 0,

  -- Заметки от человека
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

-- ────────────────────────────────────────────────────────────────────────
-- Items: модель × цвет × кол-во
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.frame_procurement_order_items (
  id           uuid primary key default gen_random_uuid(),

  order_id     uuid not null
    references public.frame_procurement_orders(id) on delete cascade,

  catalog_id   uuid not null
    references public.frame_supplier_catalog(id) on delete restrict,

  -- Конкретная цветовая строка на фото
  color_label  text not null,    -- "C1", "C2", "渐变紫" и т.п.
  color_name   text,             -- "чёрный", "коричневый" — приведено к ru
  qty          int  not null check (qty > 0),

  -- Snapshot bbox на момент аннотации (на случай, если в каталоге потом
  -- bbox обновится — заказ должен рендерится тем же, чем был сформирован)
  bbox         jsonb,

  created_at   timestamptz not null default now()
);

create index if not exists idx_frame_procurement_order_items_order
  on public.frame_procurement_order_items (order_id);

create index if not exists idx_frame_procurement_order_items_catalog
  on public.frame_procurement_order_items (catalog_id);

-- Уникальность: одна модель/цвет в одном заказе только один раз
create unique index if not exists uniq_procurement_item_color
  on public.frame_procurement_order_items (order_id, catalog_id, color_label);

-- ────────────────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────────────────

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
