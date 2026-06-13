-- Список тест-аккаунтов, исключаемых из статистики /admin/mobile-app.
-- Обратимо: чтобы вернуть пользователя в статистику — удалить строку.
-- Данные пользователя НЕ удаляются, только фильтруются в обзоре.

create table if not exists public.mobile_excluded_users (
  auth_user_id uuid primary key,
  reason       text,
  created_at   timestamptz not null default now()
);

comment on table public.mobile_excluded_users is
  'Тест-аккаунты, исключаемые из обзора мобильного приложения (не влияет на сами данные).';

alter table public.mobile_excluded_users enable row level security;

-- Тест-аккаунты: студия тестировщиков (996700000001, 24 устройства) и dev/QA (996555244966)
insert into public.mobile_excluded_users (auth_user_id, reason)
values
  ('ef1bb784-7386-4992-b542-3173d9271262', 'Тестовые установки (студия, номер 996700000001)'),
  ('aac83f50-ae2e-4873-99bc-80f8bb60cf0c', 'Dev/QA-аккаунт (996555244966)')
on conflict (auth_user_id) do nothing;
