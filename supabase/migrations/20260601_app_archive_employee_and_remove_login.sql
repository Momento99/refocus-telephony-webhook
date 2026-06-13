-- ============================================================================
-- Управление сотрудниками со страницы /settings/payroll: надёжное удаление и
-- снятие доступа в смену.
--
-- Контекст / причины:
--  * employees ссылается из ~20 таблиц (pos_focus_events, payments, attendance,
--    payroll_*, и т.д.), почти все с ON DELETE NO ACTION/RESTRICT. Поэтому
--    жёсткое DELETE сотрудника с историей блокируется БД by design.
--    Правильное «удаление» = мягкое (is_active=false) + освобождение логина.
--  * employee_credentials.login/pin_hash/pin_sha256 — NOT NULL, поэтому
--    «снять логин» нельзя через UPDATE ... = null. Удаляем строку креда
--    целиком (на employee_credentials никто не ссылается по FK).
--  * Прямой UPDATE/DELETE employee_credentials из браузера (authenticated)
--    молча блокируется RLS (нет политики UPDATE/DELETE для authenticated —
--    только service_role). Поэтому эти операции делаем через SECURITY DEFINER.
-- ============================================================================

-- Снять логин/PIN у сотрудника (сам сотрудник остаётся активным).
create or replace function public.app_remove_employee_login(p_employee_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- credential.login NOT NULL → не обнуляем, а удаляем строку целиком
  delete from public.employee_credentials where employee_id = p_employee_id;

  -- освобождаем логин на источнике истины (employees.login nullable)
  update public.employees
     set login = null, pin_hash = null, updated_at = now()
   where id = p_employee_id;
end;
$$;

-- Мягко удалить (архивировать) сотрудника: скрыть + снять логин.
-- Историю (focus_events, payments, payroll, attendance) НЕ трогаем.
create or replace function public.app_archive_employee(p_employee_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- закрыть открытую смену, если есть
  update public.attendance_sessions
     set ended_at = now()
   where employee_id = p_employee_id
     and ended_at is null;

  -- снять доступ в смену (удаляем кред целиком — login NOT NULL)
  delete from public.employee_credentials where employee_id = p_employee_id;

  -- скрыть сотрудника и освободить логин
  update public.employees
     set login = null, pin_hash = null, is_active = false, updated_at = now()
   where id = p_employee_id;
end;
$$;

-- Доступ: только авторизованным (не anon) — функции деструктивные и SECURITY DEFINER.
revoke all on function public.app_remove_employee_login(bigint) from public;
revoke all on function public.app_archive_employee(bigint) from public;
grant execute on function public.app_remove_employee_login(bigint) to authenticated;
grant execute on function public.app_archive_employee(bigint) to authenticated;
