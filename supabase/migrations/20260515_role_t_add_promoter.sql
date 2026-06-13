-- Добавляем значение 'promoter' в enum role_t (если ещё не существует).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'role_t' AND e.enumlabel = 'promoter'
  ) THEN
    ALTER TYPE role_t ADD VALUE 'promoter';
  END IF;
END$$;
