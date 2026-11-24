begin;

create table public.club_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  categories text[] not null check (categories <@ array['announcement','reminder','ready','change','recap']),
  locale text not null check (locale in ('ru','uk')),
  revision integer not null check (revision > 0)
);
create table public.club_feedback (
  user_id uuid primary key references auth.users(id) on delete cascade,
  atmosphere smallint check (atmosphere between 1 and 5),
  comfort smallint check (comfort between 1 and 5),
  organization smallint check (organization between 1 and 5),
  reasons text[] not null check (reasons <@ array['schedule','travel','format','uncertain','other']),
  days text[] not null check (days <@ array['mon','tue','wed','thu','fri','sat','sun']),
  suggestion text check (char_length(suggestion) between 1 and 600),
  revision integer not null check (revision > 0)
);
-- A row records a simulation, never a provider receipt. No Telegram identifier is stored.
create table public.club_notification_dry_runs (
  user_id uuid not null references auth.users(id) on delete cascade,
  evening_id uuid not null references public.evenings(id) on delete cascade,
  category text not null check (category in ('announcement','reminder','ready','change','recap')),
  event_key text not null,
  locale text not null check (locale in ('ru','uk')),
  evening_starts_at timestamptz not null,
  evening_place text not null,
  simulated_at timestamptz not null default now(),
  primary key (user_id,evening_id,category,event_key)
);
create index club_notification_dry_runs_frequency on public.club_notification_dry_runs(user_id,simulated_at desc);
create index club_notification_dry_runs_history on public.club_notification_dry_runs(simulated_at desc);
create index club_audit_evening_changes on public.club_audit(record_id,id desc)
  where table_name='evenings' and before_data is not null and after_data is not null;

alter table public.club_notification_preferences enable row level security;
alter table public.club_feedback enable row level security;
alter table public.club_notification_dry_runs enable row level security;
revoke all on public.club_notification_preferences,public.club_feedback,public.club_notification_dry_runs
  from public,anon,authenticated;

create function public.club_member_preferences() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception using errcode='42501',message='member_required'; end if;
  return jsonb_build_object(
    'notifications',(select jsonb_build_object('categories',p.categories,'locale',p.locale,'revision',p.revision)
      from public.club_notification_preferences p where p.user_id=actor),
    'feedback',(select to_jsonb(f)-'user_id' from public.club_feedback f where f.user_id=actor)
  );
end $$;

create function public.save_club_notification_preferences(p_categories text[], p_locale text,p_revision integer) returns text
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); current_pref public.club_notification_preferences; categories text[];
begin
  if actor is null then raise exception using errcode='42501',message='member_required'; end if;
  if p_categories is null or cardinality(p_categories)>5 or array_position(p_categories,null) is not null
      or not p_categories <@ array['announcement','reminder','ready','change','recap']
      or p_locale is null or p_locale not in ('ru','uk') or p_revision is null or p_revision<0 then
    raise exception using errcode='22023',message='invalid_preferences';
  end if;
  select array(select distinct v from unnest(p_categories) as v order by v) into categories;
  -- Serialize consent changes with dry-run recording so opt-out takes effect at commit.
  perform pg_advisory_xact_lock(2061124,20);
  select * into current_pref from public.club_notification_preferences where user_id=actor;
  if current_pref.categories=categories and current_pref.locale=p_locale then return 'saved'; end if;
  if coalesce(current_pref.revision,0)<>p_revision then return 'conflict'; end if;
  insert into public.club_notification_preferences values(actor,categories,p_locale,p_revision+1)
    on conflict(user_id) do update set categories=excluded.categories,locale=excluded.locale,revision=excluded.revision;
  return 'saved';
end $$;

create function public.save_club_feedback(
  p_atmosphere smallint,p_comfort smallint,p_organization smallint,p_reasons text[],
  p_days text[],p_suggestion text,p_revision integer
) returns text
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); current_feedback public.club_feedback; reasons text[]; days text[]; suggestion text;
begin
  if actor is null then raise exception using errcode='42501',message='member_required'; end if;
  if p_reasons is null or cardinality(p_reasons)>5 or array_position(p_reasons,null) is not null
      or not p_reasons <@ array['schedule','travel','format','uncertain','other']
      or p_days is null or cardinality(p_days)>7 or array_position(p_days,null) is not null
      or not p_days <@ array['mon','tue','wed','thu','fri','sat','sun']
      or p_revision is null or p_revision<0
      or p_atmosphere not between 1 and 5 or p_comfort not between 1 and 5 or p_organization not between 1 and 5
      or char_length(p_suggestion)>600 then
    raise exception using errcode='22023',message='invalid_feedback';
  end if;
  reasons:=array(select distinct v from unnest(p_reasons) as v order by v);
  days:=array(select distinct v from unnest(p_days) as v order by v);
  suggestion:=nullif(btrim(p_suggestion),'');
  -- Lock the account even before the first response exists.
  perform pg_advisory_xact_lock(2061125,hashtext(actor::text));
  select * into current_feedback from public.club_feedback where user_id=actor;
  if (current_feedback.atmosphere,current_feedback.comfort,current_feedback.organization,
      coalesce(current_feedback.reasons,'{}'),coalesce(current_feedback.days,'{}'),current_feedback.suggestion)
    is not distinct from (p_atmosphere,p_comfort,p_organization,reasons,days,suggestion) then return 'saved'; end if;
  if coalesce(current_feedback.revision,0)<>p_revision then return 'conflict'; end if;
  -- An empty response withdraws the contribution while keeping its revision.
  insert into public.club_feedback values(actor,p_atmosphere,p_comfort,p_organization,reasons,days,suggestion,p_revision+1)
    on conflict(user_id) do update set atmosphere=excluded.atmosphere,comfort=excluded.comfort,
      organization=excluded.organization,reasons=excluded.reasons,days=excluded.days,
      suggestion=excluded.suggestion,revision=excluded.revision;
  return 'saved';
end $$;

create function public.club_feedback_summary() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform public.require_club_admin();
  return (
    with scores as (
      select key, count(*) as responses, round(avg(value),1) as average
      from public.club_feedback f
      cross join lateral (values ('atmosphere',f.atmosphere),('comfort',f.comfort),('organization',f.organization)) s(key,value)
      where value is not null group by key having count(*)>=5
    ), reasons as (
      select key,count(*) as responses from public.club_feedback cross join lateral unnest(reasons) t(key)
      group by key having count(*)>=5
    ), days as (
      select key,count(*) as responses from public.club_feedback cross join lateral unnest(days) t(key)
      group by key having count(*)>=5
    ), suggestions as (
      select suggestion from public.club_feedback where suggestion is not null
    )
    select jsonb_build_object(
      'scores',coalesce((select jsonb_agg(to_jsonb(s) order by s.key) from scores s),'[]'),
      'reasons',coalesce((select jsonb_agg(to_jsonb(r) order by r.key) from reasons r),'[]'),
      'days',coalesce((select jsonb_agg(to_jsonb(d) order by d.key) from days d),'[]'),
      'suggestions',case when (select count(*) from suggestions)>=5
        then (select jsonb_agg(suggestion order by suggestion) from (select suggestion from suggestions order by suggestion limit 50) x)
        else '[]'::jsonb end
    )
  );
end $$;

create function public.club_notification_preview(p_evening uuid,p_category text,p_record_key text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  e public.evenings;
  key text;
  change_id bigint;
  party_count integer := 0;
  confirmed integer := 0;
  candidate_count integer;
  duplicate_count integer;
  limited_count integer;
  ru_count integer;
  uk_count integer;
  recorded_count integer;
begin
  perform public.require_club_admin();
  if p_category is null or p_category not in ('announcement','reminder','ready','change','recap') then
    raise exception using errcode='22023',message='invalid_category';
  end if;
  if p_record_key is not null then
    perform pg_advisory_xact_lock(2061124,20);
    perform 1 from public.evenings where id=p_evening for update;
  end if;
  select * into e from public.evenings where id=p_evening;
  if not found then return jsonb_build_object('status','unavailable'); end if;

  if p_category='change' then
    if e.status not in ('planned','cancelled') or e.starts_at<now()-interval '18 hours' then
      return jsonb_build_object('status','unavailable');
    end if;
    select id into change_id from public.club_audit
      where record_id=e.id and table_name='evenings' and before_data is not null and after_data is not null
        and (before_data->'starts_at',before_data->'place',before_data->'capacity',before_data->'status',before_data->'host_player_id')
          is distinct from
          (after_data->'starts_at',after_data->'place',after_data->'capacity',after_data->'status',after_data->'host_player_id')
      order by id desc limit 1;
    if change_id is null then return jsonb_build_object('status','unavailable'); end if;
  elsif p_category='recap' then
    if e.status<>'finished' or e.starts_at<now()-interval '7 days' or e.starts_at>now() then
      return jsonb_build_object('status','unavailable');
    end if;
    select count(*) into party_count from public.games
      where evening_id=e.id and status='finished' and not voided and winner is not null;
    if party_count=0 then return jsonb_build_object('status','unavailable'); end if;
  else
    if e.status<>'planned' or e.starts_at<=now() then return jsonb_build_object('status','unavailable'); end if;
    if p_category='reminder' and e.starts_at>now()+interval '24 hours' then
      return jsonb_build_object('status','unavailable');
    end if;
    if p_category='ready' then
      select count(*) into confirmed from public.evening_signups
        where evening_id=e.id and status in ('going','late') and player_id<>e.host_player_id;
      if e.host_player_id is null or confirmed<e.capacity then return jsonb_build_object('status','unavailable'); end if;
    end if;
  end if;
  -- Scheduling fields participate in preview consistency, but the ledger
  -- deduplicates a category for the evening except for separate public edits.
  key:=md5(jsonb_build_array(e.starts_at,e.place,e.status,e.capacity,e.host_player_id,change_id,party_count,confirmed)::text);
  if p_record_key is not null and p_record_key<>key then return jsonb_build_object('status','stale'); end if;

  if p_record_key is not null then
    delete from public.club_notification_dry_runs d using public.evenings old_evening
      where d.evening_id=old_evening.id and old_evening.status<>'planned'
        and old_evening.starts_at<now()-interval '30 days' and d.simulated_at<now()-interval '30 days';
  end if;

  with eligibility as materialized (
    select p.user_id,p.locale,
      exists(select 1 from public.club_notification_dry_runs d where d.user_id=p.user_id
        and d.evening_id=e.id and d.category=p_category and d.event_key=coalesce(change_id::text,'')) as duplicate,
      (select count(*) from public.club_notification_dry_runs d where d.user_id=p.user_id
        and d.simulated_at>=now()-interval '24 hours')>=2 as limited
    from public.club_notification_preferences p
    join public.players pl on pl.user_id=p.user_id
    left join public.evening_signups s on s.evening_id=e.id and s.player_id=pl.id
    where p_category=any(p.categories) and (
      p_category in ('announcement','recap') or pl.id=e.host_player_id or s.status in ('going','late')
      or (p_category in ('ready','change') and s.status='maybe')
    )
  ), recorded as (
    insert into public.club_notification_dry_runs(user_id,evening_id,category,event_key,locale,evening_starts_at,evening_place)
    select user_id,e.id,p_category,coalesce(change_id::text,''),locale,e.starts_at,e.place from eligibility
      where p_record_key is not null and not duplicate and not limited
    on conflict do nothing returning 1
  )
  select count(*),count(*) filter(where duplicate), count(*) filter(where not duplicate and limited),
    count(*) filter(where not duplicate and not limited and locale='ru'),
    count(*) filter(where not duplicate and not limited and locale='uk'),
    (select count(*) from recorded)
  into candidate_count,duplicate_count,limited_count,ru_count,uk_count,recorded_count
  from eligibility;

  return jsonb_build_object('status','ready','key',key,'starts_at',e.starts_at,'place',e.place,
    'evening_status',e.status,'capacity',e.capacity,'games',party_count,'candidate',candidate_count,
    'duplicates',duplicate_count,'limited',limited_count,'ru',ru_count,'uk',uk_count,'recorded',recorded_count);
end $$;

create function public.club_notification_log() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform public.require_club_admin();
  return (
    select coalesce(jsonb_agg(to_jsonb(t) order by simulated_at desc),'[]') from (
      select d.category,d.simulated_at,d.evening_starts_at as starts_at,d.evening_place as place,count(*) as recipients
      from public.club_notification_dry_runs d
      where d.simulated_at>=now()-interval '30 days'
      group by d.category,d.simulated_at,d.evening_id,d.evening_starts_at,d.evening_place
      order by d.simulated_at desc,d.category,d.evening_id limit 25
    ) t
  );
end $$;

revoke all on function public.club_member_preferences(),
  public.save_club_notification_preferences(text[],text,integer),
  public.save_club_feedback(smallint,smallint,smallint,text[],text[],text,integer),
  public.club_feedback_summary(),public.club_notification_preview(uuid,text,text),
  public.club_notification_log() from public,anon,authenticated;
grant execute on function public.club_member_preferences(),
  public.save_club_notification_preferences(text[],text,integer),
  public.save_club_feedback(smallint,smallint,smallint,text[],text[],text,integer),
  public.club_feedback_summary(),public.club_notification_preview(uuid,text,text),
  public.club_notification_log() to authenticated;

commit;
