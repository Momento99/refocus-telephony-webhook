-- Premia za kachestvo messaging communications po filialam.
-- Pravila:
--   - Period = kalendarnyi mesyats v Asia/Bishkek
--   - Combined score = (wa_avg * wa_threads + ig_avg * ig_threads) / total_threads
--     po SEGMENTAM (whatsapp_thread_quality.branch_id, ne whatsapp_threads.branch_id),
--     chtoby pri peredache treda v drugoi filial otsenka shla v fakticheskii filial
--   - Smena schitaetsya tolko esli ended_at is not null AND dlitelnost >= 5 chasov
--   - Min threads = ceil(1.5 * shifts)
--   - Score >= 8.5 => bonus_eligible = true
--   - Bonus 500 KGS kazhdomu prodavtsu, kto otrabatal >= 50% smen filiala

-- ─── 1. RPC: bonus po filialu ───────────────────────────────────────────────

drop function if exists public.rpc_branch_messaging_score(timestamptz, timestamptz, bigint);

create or replace function public.rpc_branch_messaging_score(
  p_from timestamptz,
  p_to timestamptz,
  p_branch_id bigint default null
)
returns table (
  branch_id            bigint,
  branch_name          text,
  wa_threads           int,
  ig_threads           int,
  total_threads        int,
  wa_avg               numeric,
  ig_avg               numeric,
  combined_score       numeric,
  total_shifts         int,
  min_threads_required int,
  min_threads_ok       boolean,
  score_ok             boolean,
  bonus_eligible       boolean,
  bonus_amount         int
)
language sql stable security definer set search_path = public
as $$
  with wa as (
    select q.branch_id, count(*)::int as threads, avg(q.score)::numeric as avg_s
    from whatsapp_thread_quality q
    where q.created_at >= p_from and q.created_at < p_to
      and q.branch_id is not null
      and (p_branch_id is null or q.branch_id = p_branch_id)
    group by q.branch_id
  ),
  ig as (
    select q.branch_id, count(*)::int as threads, avg(q.score)::numeric as avg_s
    from instagram_thread_quality q
    where q.created_at >= p_from and q.created_at < p_to
      and q.branch_id is not null
      and (p_branch_id is null or q.branch_id = p_branch_id)
    group by q.branch_id
  ),
  shifts as (
    select s.branch_id, count(*)::int as shifts_count
    from attendance_sessions s
    where s.started_at >= p_from and s.started_at < p_to
      and s.ended_at is not null
      and extract(epoch from (s.ended_at::timestamptz - s.started_at)) >= 18000
      and (p_branch_id is null or s.branch_id = p_branch_id)
    group by s.branch_id
  ),
  combined_raw as (
    select
      coalesce(wa.branch_id, ig.branch_id, sh.branch_id)        as branch_id,
      coalesce(wa.threads, 0)                                   as wa_threads,
      coalesce(ig.threads, 0)                                   as ig_threads,
      wa.avg_s                                                  as wa_avg_raw,
      ig.avg_s                                                  as ig_avg_raw,
      coalesce(sh.shifts_count, 0)                              as total_shifts
    from wa
    full outer join ig on ig.branch_id = wa.branch_id
    full outer join shifts sh on sh.branch_id = coalesce(wa.branch_id, ig.branch_id)
  ),
  scored as (
    select c.branch_id,
      c.wa_threads, c.ig_threads,
      c.wa_threads + c.ig_threads as total_threads,
      case when c.wa_threads > 0 then round(c.wa_avg_raw, 2) else null end as wa_avg,
      case when c.ig_threads > 0 then round(c.ig_avg_raw, 2) else null end as ig_avg,
      case
        when (c.wa_threads + c.ig_threads) = 0 then null
        else round(
          ((coalesce(c.wa_avg_raw, 0) * c.wa_threads + coalesce(c.ig_avg_raw, 0) * c.ig_threads)
            / (c.wa_threads + c.ig_threads))::numeric, 2)
      end as combined_score,
      c.total_shifts,
      ceil(1.5 * c.total_shifts)::int as min_threads_required
    from combined_raw c
    where c.branch_id is not null
  )
  select
    s.branch_id,
    coalesce(b.name, b.branch_name, '—') as branch_name,
    s.wa_threads, s.ig_threads, s.total_threads,
    s.wa_avg, s.ig_avg, s.combined_score,
    s.total_shifts,
    s.min_threads_required,
    (s.total_threads >= s.min_threads_required and s.min_threads_required > 0) as min_threads_ok,
    (s.combined_score is not null and s.combined_score >= 8.5)                  as score_ok,
    (s.total_threads >= s.min_threads_required and s.min_threads_required > 0
      and s.combined_score is not null and s.combined_score >= 8.5)             as bonus_eligible,
    case when s.total_threads >= s.min_threads_required and s.min_threads_required > 0
              and s.combined_score is not null and s.combined_score >= 8.5
         then 500 else 0 end                                                    as bonus_amount
  from scored s
  left join branches b on b.id = s.branch_id
  order by s.combined_score desc nulls last;
$$;

grant execute on function public.rpc_branch_messaging_score(timestamptz, timestamptz, bigint)
  to authenticated, anon, service_role;

comment on function public.rpc_branch_messaging_score is
  'Bonus za kachestvo messaging po filialam. Combined score WA+IG po segmentam (quality.branch_id). Min threads = 1.5*shifts. Score>=8.5 => 500 KGS.';

-- ─── 2. RPC: poluchateli premii v filiale ───────────────────────────────────

drop function if exists public.rpc_branch_monthly_bonus_recipients(timestamptz, timestamptz, bigint);

create or replace function public.rpc_branch_monthly_bonus_recipients(
  p_from timestamptz,
  p_to timestamptz,
  p_branch_id bigint
)
returns table (
  employee_id          bigint,
  full_name            text,
  shifts_worked        int,
  total_branch_shifts  int,
  share_pct            numeric,
  eligible             boolean
)
language sql stable security definer set search_path = public
as $$
  with per_emp as (
    select s.employee_id, count(*)::int as shifts_worked
    from attendance_sessions s
    where s.branch_id = p_branch_id
      and s.started_at >= p_from and s.started_at < p_to
      and s.ended_at is not null
      and extract(epoch from (s.ended_at::timestamptz - s.started_at)) >= 18000
      and s.employee_id is not null
    group by s.employee_id
  ),
  branch_total as (
    select coalesce(sum(shifts_worked), 0)::int as total
    from per_emp
  )
  select
    p.employee_id,
    coalesce(e.full_name, '— неизвестно —')                     as full_name,
    p.shifts_worked,
    bt.total                                                    as total_branch_shifts,
    case when bt.total > 0
      then round(100.0 * p.shifts_worked / bt.total, 1)
      else 0 end                                                as share_pct,
    (bt.total > 0 and p.shifts_worked::numeric / bt.total >= 0.5) as eligible
  from per_emp p
  cross join branch_total bt
  left join employees e on e.id = p.employee_id
  order by p.shifts_worked desc;
$$;

grant execute on function public.rpc_branch_monthly_bonus_recipients(timestamptz, timestamptz, bigint)
  to authenticated, anon, service_role;

-- ─── 3. Tablitsa istorii vyplat ─────────────────────────────────────────────

create table if not exists public.branch_monthly_bonus_history (
  id                       bigserial primary key,
  branch_id                bigint not null references public.branches(id),
  period_year              int not null,
  period_month             int not null,
  combined_score           numeric(4,2),
  wa_avg                   numeric(4,2),
  ig_avg                   numeric(4,2),
  total_threads            int  not null default 0,
  total_shifts             int  not null default 0,
  min_threads_required     int  not null default 0,
  bonus_eligible           boolean not null default false,
  bonus_amount_per_person  int  not null default 0,
  recipients               jsonb not null default '[]'::jsonb,
  total_payout             int  not null default 0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (branch_id, period_year, period_month)
);

create index if not exists branch_monthly_bonus_history_period_idx
  on public.branch_monthly_bonus_history (period_year, period_month);

-- ─── 4. Funktsiya snapshota mesyatsa ────────────────────────────────────────

create or replace function public.fn_branch_monthly_bonus_snapshot(
  p_year int default null,
  p_month int default null
)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_year       int;
  v_month      int;
  v_from       timestamptz;
  v_to         timestamptz;
  v_count      int := 0;
  r            record;
  recipients_json  jsonb;
  payout_total int;
begin
  if p_year is null or p_month is null then
    -- proshlyi mesyats po Asia/Bishkek
    v_year  := extract(year from ((now() at time zone 'Asia/Bishkek') - interval '1 month'))::int;
    v_month := extract(month from ((now() at time zone 'Asia/Bishkek') - interval '1 month'))::int;
  else
    v_year  := p_year;
    v_month := p_month;
  end if;

  v_from := (make_date(v_year, v_month, 1)::timestamp at time zone 'Asia/Bishkek');
  v_to   := ((make_date(v_year, v_month, 1) + interval '1 month')::timestamp at time zone 'Asia/Bishkek');

  for r in
    select * from public.rpc_branch_messaging_score(v_from, v_to, null)
  loop
    select coalesce(jsonb_agg(jsonb_build_object(
        'employee_id', rec.employee_id,
        'full_name', rec.full_name,
        'shifts_worked', rec.shifts_worked,
        'total_branch_shifts', rec.total_branch_shifts,
        'share_pct', rec.share_pct,
        'eligible', rec.eligible
      ) order by rec.shifts_worked desc), '[]'::jsonb)
    into recipients_json
    from public.rpc_branch_monthly_bonus_recipients(v_from, v_to, r.branch_id) rec;

    if r.bonus_eligible then
      payout_total := 500 * (
        select count(*)
        from jsonb_array_elements(recipients_json) elt
        where (elt->>'eligible')::boolean
      );
    else
      payout_total := 0;
    end if;

    insert into public.branch_monthly_bonus_history (
      branch_id, period_year, period_month,
      combined_score, wa_avg, ig_avg,
      total_threads, total_shifts, min_threads_required,
      bonus_eligible, bonus_amount_per_person,
      recipients, total_payout
    ) values (
      r.branch_id, v_year, v_month,
      r.combined_score, r.wa_avg, r.ig_avg,
      r.total_threads, r.total_shifts, r.min_threads_required,
      r.bonus_eligible,
      case when r.bonus_eligible then 500 else 0 end,
      recipients_json, payout_total
    )
    on conflict (branch_id, period_year, period_month) do update set
      combined_score          = excluded.combined_score,
      wa_avg                  = excluded.wa_avg,
      ig_avg                  = excluded.ig_avg,
      total_threads           = excluded.total_threads,
      total_shifts            = excluded.total_shifts,
      min_threads_required    = excluded.min_threads_required,
      bonus_eligible          = excluded.bonus_eligible,
      bonus_amount_per_person = excluded.bonus_amount_per_person,
      recipients              = excluded.recipients,
      total_payout            = excluded.total_payout,
      updated_at              = now();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.fn_branch_monthly_bonus_snapshot(int, int)
  to service_role;

-- ─── 5. pg_cron: ezhednevno v 18:30 UTC (= 00:30 Bishkek) ───────────────────
--   Funktsiya sama proveryaet, chto segodnya po Bishkek = 1-e chislo,
--   i tolko togda snapshotit proshlyi mesyats. Inache tikhii NO-OP.

create or replace function public.fn_branch_monthly_bonus_cron_tick()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_today_dom int;
begin
  v_today_dom := extract(day from (now() at time zone 'Asia/Bishkek'))::int;
  if v_today_dom = 1 then
    return public.fn_branch_monthly_bonus_snapshot(null, null);
  end if;
  return 0;
end;
$$;

grant execute on function public.fn_branch_monthly_bonus_cron_tick()
  to service_role;

-- otmenyaem staryi job s tem zhe imenem (esli est)
do $$
declare j_id bigint;
begin
  select jobid into j_id from cron.job where jobname = 'branch_monthly_bonus_snapshot';
  if j_id is not null then perform cron.unschedule(j_id); end if;
end $$;

select cron.schedule(
  'branch_monthly_bonus_snapshot',
  '30 18 * * *',
  $cron$select public.fn_branch_monthly_bonus_cron_tick();$cron$
);
