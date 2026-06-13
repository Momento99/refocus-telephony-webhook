-- Исключаем даты-заглушки дня рождения из возрастной/гендерной статистики.
-- 1911-11-11 и 1966-11-11 подставляют, когда у клиента не спросили дату рождения
-- (это два самых частых «дня рождения» в базе — явные плейсхолдеры, по 9–12 клиентов).
-- 1911-11-11 и так выпадал (возраст 115 вне диапазона 3–90), а вот 1966-11-11
-- (возраст ~60) раньше попадал и в график по возрасту, и в pie по полу.
create or replace function public.admin_age_orders_by_year(from_dt date, to_dt date, branches text[] default null::text[])
 returns table(age integer, gender text, orders_cnt bigint)
 language sql
as $function$
with base as (
  select
    extract(year from age(o.created_at::date, c.birthdate))::int as age_year,
    case c.gender
      when 'M'::gender_code then 'Муж'
      when 'F'::gender_code then 'Жен'
      else null
    end as gender_label
  from public.orders o
  join public.customers c on c.id = o.customer_id
  left join public.branches b on b.id = o.branch_id
  where o.created_at::date between from_dt and to_dt
    and c.birthdate is not null
    -- даты-заглушки «забыли спросить дату рождения» — исключаем из статистики
    and c.birthdate <> all (array['1911-11-11','1966-11-11']::date[])
    and (branches is null or b.name = any (branches))
),
agg as (
  select age_year as age, gender_label as gender, count(*)::bigint cnt
  from base
  where age_year between 3 and 90 and gender_label is not null
  group by age_year, gender_label
)
select gs.age,
       g.gender,
       coalesce(a.cnt, 0)::bigint as orders_cnt
from generate_series(3, 90) as gs(age)
cross join (values ('Жен'), ('Муж')) as g(gender)
left join agg a
  on a.age = gs.age and a.gender = g.gender
order by gs.age, g.gender;
$function$;
