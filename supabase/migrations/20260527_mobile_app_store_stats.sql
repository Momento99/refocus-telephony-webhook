-- Mobile app analytics for /admin/mobile-app (вкладка «Обзор»)
--
-- 1) mobile_store_daily — суточный кэш загрузок из App Store Connect и Google Play.
--    Тянется кроном (см. /api/admin/mobile/sync-stores), читается обзорной страницей.
--    Наши собственные счётчики (вошло/активны/opt-in) НЕ дублируются сюда — они
--    считаются на лету из mobile_push_devices / mobile_phone_identities / mobile_user_settings.
--
-- 2) v_mobile_user_country — оценочная страна наших мобильных пользователей
--    (телефон → customers → последний заказ → branches.country_id). Совпадение по
--    телефону неполное (~50%), поэтому на UI помечается как «оценочно».

-- ───────────────────────────────────────────────────────────── store downloads
create table if not exists public.mobile_store_daily (
  date         date    not null,
  platform     text    not null check (platform in ('ios', 'android')),
  -- ISO-2 страны из отчёта стора; 'ZZ' = страна не указана / агрегат
  country_code text    not null default 'ZZ',
  downloads    integer not null default 0,   -- первые загрузки (Apple Units / Google installs)
  redownloads  integer not null default 0,   -- повторные загрузки, если стор их отдаёт
  updated_at   timestamptz not null default now(),
  primary key (date, platform, country_code)
);

comment on table public.mobile_store_daily is
  'Суточные загрузки приложения по платформам/странам из App Store Connect и Google Play. Источник для /admin/mobile-app.';

create index if not exists mobile_store_daily_platform_date_idx
  on public.mobile_store_daily (platform, date);

-- Только service role (через админский API). Публичных политик нет.
alter table public.mobile_store_daily enable row level security;

-- ─────────────────────────────────────────────── best-effort страна наших юзеров
create or replace view public.v_mobile_user_country as
with cust as (
  select
    mpi.auth_user_id,
    c.id as customer_id
  from public.mobile_phone_identities mpi
  join public.customers c
    on regexp_replace(c.phone, '\D', '', 'g') like '%' || mpi.phone_digits
),
last_order as (
  select distinct on (cu.auth_user_id)
    cu.auth_user_id,
    b.country_id
  from cust cu
  join public.orders o   on o.customer_id = cu.customer_id
  join public.branches b on b.id = o.branch_id
  order by cu.auth_user_id, o.created_at desc nulls last, o.id desc
)
select auth_user_id, country_id
from last_order
where country_id is not null;

comment on view public.v_mobile_user_country is
  'Оценочная страна мобильного пользователя по последнему заказу (матч по телефону, ~50% покрытие).';
