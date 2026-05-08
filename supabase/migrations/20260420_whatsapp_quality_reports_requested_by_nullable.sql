-- Cron-вызов /api/admin/whatsapp/analyze не имеет «пользователя».
-- Делаем requested_by nullable, чтобы еженедельный автоанализ мог писать отчёты.
alter table public.whatsapp_quality_reports alter column requested_by drop not null;
