-- 20260427_terminals_add_kind.sql
-- Добавляем колонку `kind`, чтобы различать кассовые терминалы и тач-экраны
-- (Lens Kiosk). До этого POS-логин при поиске терминалов одного филиала
-- мог выбрать tачскрин-киоск (`branch_id` совпадает) и открыть смену не на том
-- устройстве. Идемпотентно: безопасно перезапускать.

-- 1) Колонка с дефолтом 'pos' и NOT NULL.
ALTER TABLE public.terminals
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'pos';

-- 2) CHECK-ограничение допустимых значений. Пересоздаём, чтобы повторный запуск
--    не падал, если констрейнт уже есть.
ALTER TABLE public.terminals
  DROP CONSTRAINT IF EXISTS terminals_kind_check;
ALTER TABLE public.terminals
  ADD CONSTRAINT terminals_kind_check CHECK (kind IN ('pos', 'kiosk'));

-- 3) Backfill существующих киосков. Любая запись, у которой terminal_code
--    или name содержат KIOSK/Киоск, помечается как 'kiosk'. Прогоняем только
--    тех, у кого ещё стоит дефолт 'pos', — чтобы не перетереть ручные правки.
UPDATE public.terminals
SET kind = 'kiosk'
WHERE kind = 'pos'
  AND (
    terminal_code ILIKE '%KIOSK%'
    OR code         ILIKE '%KIOSK%'
    OR name         ILIKE '%Киоск%'
  );

-- 4) Композитный индекс — POS-логин фильтрует по (branch_id, kind).
CREATE INDEX IF NOT EXISTS terminals_branch_kind_idx
  ON public.terminals (branch_id, kind);

-- 5) Описание колонки.
COMMENT ON COLUMN public.terminals.kind IS
  'Тип терминала: ''pos'' — кассовый аппарат, ''kiosk'' — сенсорный экран Lens Kiosk.';

-- 6) Перечитать схему PostgREST, чтобы REST-клиенты сразу увидели новую колонку.
NOTIFY pgrst, 'reload schema';
