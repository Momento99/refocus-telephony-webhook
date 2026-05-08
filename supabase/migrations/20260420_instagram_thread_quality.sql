-- AI-оценки Instagram: зеркало whatsapp_quality_reports + whatsapp_thread_quality.

create table if not exists public.instagram_quality_reports (
  id            uuid primary key default gen_random_uuid(),
  period_from   date not null,
  period_to     date not null,
  branch_id     bigint references branches(id),
  requested_by  uuid,
  llm_model     text,
  prompt_version text,
  threads_analyzed integer,
  report_json   jsonb,
  report_markdown text,
  error_message text,
  status        text not null default 'pending',
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create table if not exists public.instagram_thread_quality (
  id          bigserial primary key,
  report_id   uuid        not null references instagram_quality_reports(id) on delete cascade,
  thread_id   uuid        not null references instagram_threads(id)         on delete cascade,
  branch_id   bigint      references branches(id),
  employee_id bigint      references employees(id),
  score       numeric(3,1) not null check (score >= 0 and score <= 10),
  verdict     text        not null check (verdict in ('good','ok','bad')),
  issues      text[]      not null default array[]::text[],
  summary     text,
  worst_reply text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_itq_report   on instagram_thread_quality(report_id);
create index if not exists idx_itq_thread   on instagram_thread_quality(thread_id);
create index if not exists idx_itq_employee on instagram_thread_quality(employee_id);
create index if not exists idx_itq_branch   on instagram_thread_quality(branch_id);
create index if not exists idx_itq_verdict  on instagram_thread_quality(verdict) where verdict = 'bad';

alter table public.instagram_quality_reports enable row level security;
alter table public.instagram_thread_quality  enable row level security;

drop policy if exists iqr_read   on public.instagram_quality_reports;
drop policy if exists iqr_write  on public.instagram_quality_reports;
drop policy if exists itq_read   on public.instagram_thread_quality;
drop policy if exists itq_insert on public.instagram_thread_quality;

create policy iqr_read   on public.instagram_quality_reports for select to authenticated using (true);
create policy iqr_write  on public.instagram_quality_reports for all to authenticated using (true) with check (true);
create policy itq_read   on public.instagram_thread_quality for select to authenticated using (true);
create policy itq_insert on public.instagram_thread_quality for insert to authenticated with check (true);

comment on table public.instagram_quality_reports is 'AI-отчёты по Instagram диалогам (зеркало whatsapp_quality_reports).';
comment on table public.instagram_thread_quality  is 'AI-оценка каждого Instagram диалога.';
