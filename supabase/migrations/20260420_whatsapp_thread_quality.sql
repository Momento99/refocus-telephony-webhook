-- Per-thread AI quality scoring. Written by /api/admin/whatsapp/analyze.
-- One row per (thread, report) — so we can rerun analysis without losing history.

create table if not exists public.whatsapp_thread_quality (
  id          bigserial primary key,
  report_id   uuid        not null references whatsapp_quality_reports(id) on delete cascade,
  thread_id   uuid        not null references whatsapp_threads(id)         on delete cascade,
  branch_id   bigint      references branches(id),
  employee_id bigint      references employees(id),
  score       numeric(3,1) not null check (score >= 0 and score <= 10),
  verdict     text        not null check (verdict in ('good','ok','bad')),
  issues      text[]      not null default array[]::text[],
  summary     text,
  worst_reply text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_wtq_report   on whatsapp_thread_quality(report_id);
create index if not exists idx_wtq_thread   on whatsapp_thread_quality(thread_id);
create index if not exists idx_wtq_employee on whatsapp_thread_quality(employee_id);
create index if not exists idx_wtq_branch   on whatsapp_thread_quality(branch_id);
create index if not exists idx_wtq_verdict  on whatsapp_thread_quality(verdict) where verdict = 'bad';

alter table public.whatsapp_thread_quality enable row level security;

drop policy if exists wtq_read   on public.whatsapp_thread_quality;
drop policy if exists wtq_insert on public.whatsapp_thread_quality;

create policy wtq_read on public.whatsapp_thread_quality
  for select to authenticated
  using (true);

create policy wtq_insert on public.whatsapp_thread_quality
  for insert to authenticated
  with check (true);

comment on table public.whatsapp_thread_quality is
  'AI-оценка каждого WhatsApp-диалога: score 0..10, verdict good/ok/bad, issues[], summary. Заполняется /api/admin/whatsapp/analyze.';
