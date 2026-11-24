begin;

-- One aggregate response per request. The caller's RLS still applies.
create function public.club_analytics(p_from date, p_to date) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'Club administrator required';
  end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
     or p_from < date '1900-01-01' or p_to > date '9999-12-31'
     or p_to < p_from or p_to - p_from > 365 then
    raise exception using errcode = '22023', message = 'Choose a period of at most 366 calendar days';
  end if;

  return (
    with bounds as (
      select
        p_from::timestamp at time zone 'Europe/Vienna' as starts,
        (p_to + 31)::timestamp at time zone 'Europe/Vienna' as followup_ends,
        (now() at time zone 'Europe/Vienna')::date as today
    ),
    -- The extra 30 days are used only to observe a return after a first visit.
    evening_window as materialized (
      select e.id, e.starts_at, e.place, e.status, (e.starts_at at time zone 'Europe/Vienna')::date as day
      from public.evenings e cross join bounds b
      where e.starts_at >= b.starts and e.starts_at < b.followup_ends
    ),
    published_games as materialized (
      select g.id, g.evening_id, g.format
      from evening_window e join public.games g on g.evening_id = e.id
      where e.status <> 'cancelled' and e.starts_at <= now()
        and g.status = 'finished' and not g.voided
    ),
    game_counts as (
      select evening_id, count(*) as games from published_games group by evening_id
    ),
    recorded_counts as (
      select a.evening_id, count(*) as people
      from evening_window e join public.evening_attendees a on a.evening_id = e.id
      group by a.evening_id
    ),
    evening_evidence as materialized (
      select e.*, coalesce(g.games, 0) as games,
        e.status <> 'cancelled' and e.starts_at <= now()
          and (e.status = 'finished' or g.games > 0 or a.people > 0) as held,
        case when l.evening_id is not null then coalesce(a.people, 0) end as attendance
      from evening_window e
      left join game_counts g on g.evening_id = e.id
      left join recorded_counts a on a.evening_id = e.id
      left join public.evening_attendance_logs l on l.evening_id = e.id
    ),
    period_evenings as materialized (
      select id, starts_at, place, status, day, games, coalesce(held, false) as held,
        case when held then attendance end as attendance
      from evening_evidence where day <= p_to
    ),
    period_games as (
      select g.* from published_games g join period_evenings e on e.id = g.evening_id
    ),
    rsvp as materialized (
      select e.id as evening_id, count(s.player_id) as confirmed, count(a.player_id) as matched
      from period_evenings e
      left join public.evening_signups s on s.evening_id = e.id and s.status in ('going', 'late')
      left join public.evening_attendees a on a.evening_id = e.id and a.player_id = s.player_id
      where e.attendance is not null
      group by e.id
    ),
    recorded_visits as materialized (
      select a.player_id, e.id as evening_id, e.starts_at, e.day
      from evening_evidence e join public.evening_attendees a on a.evening_id = e.id
      where e.held and e.attendance is not null
    ),
    period_visits as materialized (
      select * from recorded_visits where day <= p_to
    ),
    period_people as materialized (
      select distinct player_id from period_visits
    ),
    previous_visits as (
      select a.player_id, max(e.starts_at) as previous_start
      from period_people p
      join public.evening_attendees a on a.player_id = p.player_id
      join public.evenings e on e.id = a.evening_id
      join public.evening_attendance_logs l on l.evening_id = e.id
      cross join bounds b
      where e.starts_at < b.starts and e.status <> 'cancelled' and e.starts_at <= now()
      group by a.player_id
    ),
    ordered_visits as materialized (
      select v.*,
        row_number() over visit_order as position,
        lag(starts_at, 1, p.previous_start) over visit_order as previous_start
      from period_visits v left join previous_visits p using (player_id)
      window visit_order as (partition by v.player_id order by v.starts_at, v.evening_id)
    ),
    first_visits as materialized (
      select player_id, evening_id, starts_at, day from ordered_visits where previous_start is null
    ),
    mature_first_evenings as (
      select distinct evening_id, starts_at, day
      from first_visits cross join bounds
      where day + 30 < today
    ),
    observed_first_evenings as (
      select m.evening_id
      from mature_first_evenings m
      where not exists (
        select 1 from evening_evidence e
        where e.held and e.attendance is null
          and (e.starts_at, e.id) > (m.starts_at, m.evening_id) and e.day <= m.day + 30
      )
    ),
    cohort as (
      select count(*) as eligible, count(*) filter (where exists (
        select 1 from recorded_visits r
        where r.player_id = f.player_id
          and (r.starts_at, r.evening_id) > (f.starts_at, f.evening_id)
          and r.day <= f.day + 30
      )) as returned
      from first_visits f join observed_first_evenings c using (evening_id)
    ),
    gaps as (
      select day - (previous_start at time zone 'Europe/Vienna')::date as days
      from ordered_visits where previous_start is not null
    ),
    monthly as (
      select to_char(date_trunc('month', day::timestamp), 'YYYY-MM') as month,
        count(*) filter (where held) as held,
        count(attendance) as recorded, sum(attendance) as visits, sum(games) as games
      from period_evenings
      group by 1
    ),
    totals as (
      select count(*) as scheduled, count(*) filter (where status = 'cancelled') as cancelled,
        count(*) filter (where status = 'planned' and starts_at > now()) as upcoming,
        count(*) filter (where status <> 'cancelled' and starts_at <= now() and not held) as unresolved,
        count(*) filter (where held) as held, count(attendance) as recorded, sum(attendance) as visits
      from period_evenings
    ),
    recent as (
      select e.id, e.place, e.starts_at, e.attendance, e.games, r.confirmed, r.matched
      from period_evenings e left join rsvp r on r.evening_id = e.id
      where e.held order by e.starts_at desc, e.id desc limit 12
    )
    select jsonb_build_object(
      'evenings', (select to_jsonb(t) from totals t),
      'games', (select jsonb_build_object(
        'classic10', count(*) filter (where format = 'classic10'),
        'short9', count(*) filter (where format = 'short9'),
        'players', (select count(distinct p.player_id) from period_games g join public.game_players p on p.game_id = g.id)
      ) from period_games),
      'rsvp', (select jsonb_build_object('confirmed', coalesce(sum(confirmed), 0), 'matched', coalesce(sum(matched), 0)) from rsvp),
      'people', jsonb_build_object(
        'unique', (select count(*) from period_people),
        'first', (select count(*) from first_visits),
        'returning', (select count(*) from ordered_visits where position = 1 and previous_start is not null),
        'eligible', (select eligible from cohort),
        'returned', (select returned from cohort),
        'gaps', (select count(*) from gaps),
        'medianDays', (select percentile_cont(0.5) within group (order by days) from gaps)
      ),
      'months', (select coalesce(jsonb_agg(to_jsonb(m) order by m.month), '[]'::jsonb) from monthly m),
      'recent', (select coalesce(jsonb_agg(to_jsonb(r) order by r.starts_at desc, r.id desc), '[]'::jsonb) from recent r)
    )
  );
end;
$$;

revoke all on function public.club_analytics(date, date) from public, anon, authenticated;
grant execute on function public.club_analytics(date, date) to authenticated;

commit;
