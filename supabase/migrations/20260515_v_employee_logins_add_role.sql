-- Перевыпускаем view v_employee_logins — добавляем колонку role,
-- чтобы POS на логине мог отличить продавца от промоутера.
-- CREATE OR REPLACE не позволяет переставлять колонки, поэтому DROP + CREATE.
DROP VIEW IF EXISTS public.v_employee_logins;

CREATE VIEW public.v_employee_logins AS
SELECT
  e.id           AS employee_id,
  e.full_name,
  e.branch_id,
  e.role::text   AS role,
  ec.id          AS cred_id,
  ec.login,
  ec.is_active,
  ec.creds_version,
  ec.updated_at,
  ec.created_at
FROM employees e
LEFT JOIN employee_credentials ec ON ec.employee_id = e.id
ORDER BY e.id;
