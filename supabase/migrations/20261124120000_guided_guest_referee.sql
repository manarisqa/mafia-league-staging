begin;

create table public.guided_referee_drafts (
  id uuid primary key,
  evening_id uuid not null,
  round_no smallint not null check (round_no > 0),
  format public.game_format not null,
  capability_hash bytea not null,
  expires_at timestamptz not null default now() + interval '30 days',
  touched_at timestamptz not null default now(),
  revision integer not null default 1,
  payload jsonb not null,
  status text not null check (status in ('draft', 'submitted', 'clarify', 'approved', 'rejected', 'revoked', 'archived')),
  review_note text,
  submitted_at timestamptz,
  game_id uuid unique
);
create index guided_referee_evening_round on public.guided_referee_drafts(evening_id, round_no)
  where submitted_at is not null;
create index guided_referee_status on public.guided_referee_drafts(status, touched_at desc);
create index guided_referee_expiry on public.guided_referee_drafts(expires_at);
create table public.guided_referee_versions (
  draft_id uuid not null references public.guided_referee_drafts(id) on delete cascade,
  revision integer not null,
  kind text not null check (kind in ('submitted', 'clarify', 'correction', 'approved', 'rejected', 'archived')),
  payload jsonb,
  reason text,
  actor uuid,
  created_at timestamptz not null default now(),
  primary key (draft_id, revision)
);
create table public.guided_referee_limits (
  bucket text primary key,
  started_at timestamptz not null,
  used integer not null
);
alter table public.guided_referee_drafts enable row level security;
alter table public.guided_referee_versions enable row level security;
alter table public.guided_referee_limits enable row level security;
revoke all on public.guided_referee_drafts, public.guided_referee_versions, public.guided_referee_limits from public, anon, authenticated;
-- The admin inbox never selects the capability hash.
grant select (id, evening_id, round_no, format, expires_at, touched_at, revision, payload, status,
  review_note, submitted_at, game_id) on public.guided_referee_drafts to authenticated;
grant select on public.guided_referee_versions to authenticated;
create policy guided_referee_admin_drafts on public.guided_referee_drafts for select to authenticated
  using ((select public.is_admin()) and submitted_at is not null);
create policy guided_referee_admin_versions on public.guided_referee_versions for select to authenticated
  using ((select public.is_admin()));

create function public.guided_limit(p_bucket text, p_count integer, p_window interval) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.guided_referee_limits as l values (p_bucket, now(), 1)
  on conflict (bucket) do update
    set started_at = case when l.started_at <= now() - p_window then now() else l.started_at end,
        used = case when l.started_at <= now() - p_window then 1 else l.used + 1 end
    where l.started_at <= now() - p_window or l.used < p_count
  returning used into n;
  return n is not null;
end $$;
revoke all on function public.guided_limit(text,integer,interval) from public, anon, authenticated;

create function public.guided_valid_payload(p_id uuid, p_payload jsonb, p_evening uuid, p_round smallint, p_format public.game_format)
returns boolean language plpgsql stable set search_path = '' as $$
declare n integer := case when p_format = 'classic10' then 10 else 9 end;
begin
  if p_payload is null or octet_length(p_payload::text) > 480000
      or p_payload->>'id' is distinct from p_id::text or p_payload->>'evening' is distinct from p_evening::text
      or p_payload->>'round' is distinct from p_round::text or p_payload->>'format' is distinct from p_format::text
      or p_payload->>'version' is distinct from 'mafia-league-guided-2026-11-24-v1'
      or coalesce(p_payload->>'startedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      or jsonb_typeof(p_payload->'host') is distinct from 'object'
      or jsonb_typeof(p_payload->'organization') is distinct from 'object'
      or jsonb_typeof(p_payload->'players') is distinct from 'array'
      or jsonb_typeof(p_payload->'events') is distinct from 'array'
  then return false; end if;
  if jsonb_array_length(p_payload->'events') > 900 or jsonb_array_length(p_payload->'players') <> n
      or (select count(distinct player->>'id') from jsonb_array_elements(p_payload->'players') player) <> n
      or exists (
        select 1 from jsonb_array_elements(p_payload->'players') player
        where not exists (select from public.players where id::text = player->>'id')
             or coalesce(length(player->>'name'),0) not between 1 and 64
             or player->>'id' = p_payload->'host'->>'id'
      )
      or exists (select from jsonb_array_elements(p_payload->'events') event
        where coalesce(event->>'id','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
          or jsonb_typeof(event->'action') is distinct from 'object'
          or coalesce(event->'action'->>'type','') not in (
            'role','roleSwap','advance','speechStart','nominate','discipline','count','confirmVote','joint',
            'shot','shotNone','check','best','finish','exception','note','undo','redo'
          ))
      or (p_payload->'host'->>'id' is not null and not exists (
        select from public.players where id::text = p_payload->'host'->>'id'
      ))
  then return false; end if;
  return true;
end $$;
revoke all on function public.guided_valid_payload(uuid,jsonb,uuid,smallint,public.game_format) from public, anon, authenticated;

create function public.guided_guest(p_action text, p_id uuid, p_secret text, p_revision integer, p_payload jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.guided_referee_drafts;
  hash bytea;
  ev uuid;
  fmt public.game_format;
  round_n smallint;
  new_status text;
begin
  if p_id is null or coalesce(p_secret, '') !~ '^[0-9a-f]{64}$' or p_revision is null or p_revision < 0
      or coalesce(p_action, '') not in ('read','save','submit','revoke')
  then return jsonb_build_object('error','invalid'); end if;

  hash := sha256(convert_to(p_secret, 'UTF8'));
  select * into d from public.guided_referee_drafts where id = p_id and capability_hash = hash
      and expires_at > now() and status <> 'revoked' for update;
  if p_action = 'read' then
    if not found then return jsonb_build_object('error','denied'); end if;
    if not public.guided_limit('read:' || p_id::text, 45, interval '1 minute')
      then return jsonb_build_object('error','rate'); end if;
    return jsonb_build_object('revision',d.revision,'status',d.status,'note',d.review_note,'payload',d.payload);
  end if;
  if not found then
    if p_action = 'revoke' or p_revision <> 0 or exists (select from public.guided_referee_drafts where id = p_id)
    then return jsonb_build_object('error','denied'); end if;
    if p_payload is null or octet_length(p_payload::text) > 480000
      or coalesce(p_payload->>'round','') !~ '^[0-9]{1,5}$'
      or coalesce(p_payload->>'evening','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      or coalesce(p_payload->>'format','') not in ('classic10','short9')
      or (p_payload->>'round')::integer not between 1 and 32767
    then return jsonb_build_object('error','invalid'); end if;
    ev := (p_payload->>'evening')::uuid;
    fmt := (p_payload->>'format')::public.game_format;
    round_n := (p_payload->>'round')::smallint;
    if not public.guided_valid_payload(p_id,p_payload,ev,round_n,fmt)
      or not exists (select from public.evenings where id = ev and status <> 'cancelled')
    then return jsonb_build_object('error','invalid'); end if;
    if not public.guided_limit('create', 80, interval '1 hour') then return jsonb_build_object('error','rate'); end if;
    -- The quota lives in Postgres and therefore also covers direct scoped RPC requests.
    delete from public.guided_referee_drafts where expires_at <= now() and submitted_at is null;
    delete from public.guided_referee_limits where started_at < now() - interval '1 day' and bucket like 'read:%';
    if (select count(*) from public.guided_referee_drafts where submitted_at is null) >= 400
    then return jsonb_build_object('error','rate'); end if;
    insert into public.guided_referee_drafts(id,evening_id,round_no,format,capability_hash,payload,status)
      values (p_id,ev,round_n,fmt,hash,p_payload,'draft') on conflict do nothing returning * into d;
    if not found then
      select * into d from public.guided_referee_drafts where id = p_id and capability_hash = hash
        and expires_at > now() and status <> 'revoked' for update;
      if not found then return jsonb_build_object('error','denied'); end if;
    else
      p_revision := 1;
    end if;
  end if;

  if p_action = 'revoke' then
    if d.revision <> p_revision then return jsonb_build_object('error','conflict'); end if;
    if d.submitted_at is not null then
      update public.guided_referee_drafts set expires_at = now() where id = p_id;
    else
      update public.guided_referee_drafts set status = 'revoked', expires_at = now() where id = p_id;
    end if;
    return jsonb_build_object('revision',d.revision,'status','revoked');
  end if;
  if d.payload = p_payload and ((p_action = 'save' and d.status in ('draft','clarify'))
     or (p_action = 'submit' and d.status in ('submitted','approved','rejected','archived')))
  then return jsonb_build_object('revision',d.revision,'status',d.status); end if;
  if d.revision <> p_revision or d.status not in ('draft','clarify') or d.revision >= 200
  then return jsonb_build_object('error','conflict'); end if;
  if not public.guided_valid_payload(p_id,p_payload,d.evening_id,d.round_no,d.format)
     or (d.payload - 'events') <> (p_payload - 'events')
     or jsonb_array_length(d.payload->'events') > jsonb_array_length(p_payload->'events')
     or exists (
       select from jsonb_array_elements(d.payload->'events') with ordinality prior(event, position)
       where prior.event is distinct from (p_payload->'events')->((prior.position - 1)::integer)
     )
  then return jsonb_build_object('error','conflict'); end if;
  if p_action = 'save' and d.touched_at > clock_timestamp() - interval '1 second' and d.revision > 1
    then return jsonb_build_object('error','rate'); end if;

  new_status := case when p_action = 'submit' then 'submitted' else d.status end;
  if p_action = 'submit' then
    if not exists (select from jsonb_array_elements(p_payload->'events') e
      where e->'action'->>'type' in ('finish','exception'))
    then return jsonb_build_object('error','invalid'); end if;
    perform 1 from public.evenings where id = d.evening_id and status <> 'cancelled' for update;
    if not found then return jsonb_build_object('error','invalid'); end if;
    if exists(select from public.games where evening_id = d.evening_id and game_no = d.round_no)
    then return jsonb_build_object('error','round'); end if;
    if (select count(*) from public.guided_referee_drafts where status in ('submitted','clarify')) >= 300
      or not public.guided_limit('submit', 80, interval '1 hour')
    then return jsonb_build_object('error','rate'); end if;
  end if;
  update public.guided_referee_drafts set payload = p_payload, revision = revision + 1, status = new_status,
     touched_at = clock_timestamp(), submitted_at = case when p_action = 'submit' then now() else submitted_at end
   where id = p_id returning * into d;
  if p_action = 'submit' then
    insert into public.guided_referee_versions(draft_id,revision,kind,payload) values (p_id,d.revision,'submitted',p_payload);
  end if;
  return jsonb_build_object('revision',d.revision,'status',d.status);
end $$;
revoke all on function public.guided_guest(text,uuid,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.guided_guest(text,uuid,text,integer,jsonb) to anon, authenticated;

create function public.guided_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'players', coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'name',coalesce(nullif(btrim(p.nickname),''),p.display_name),'novice',p.status = 'newbie')
      order by coalesce(nullif(btrim(p.nickname),''),p.display_name),p.id) from public.players p),'[]'::jsonb),
    'evenings', coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'place',e.place,'startsAt',e.starts_at,'host',e.host_player_id,
      'round',1 + coalesce((select max(g.game_no) from public.games g where g.evening_id = e.id),0),
      'confirmed', coalesce((select jsonb_agg(s.player_id) from public.evening_signups s
        where s.evening_id = e.id and s.status in ('going','late')),'[]'::jsonb))
      order by e.starts_at)
      from (select * from public.evenings where status = 'planned' and starts_at >= now() - interval '18 hours'
        order by starts_at limit 8) e),'[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'at',g.played_at,'format',g.format,
      'seats',coalesce((select jsonb_agg(jsonb_build_object('player',p.player_id,'seat',p.seat))
        from public.game_players p where p.game_id = g.id),'[]'::jsonb)))
      from (select g.* from public.games g join public.evenings e on e.id = g.evening_id
        where g.status = 'finished' and not g.voided and e.status <> 'cancelled'
        order by g.played_at desc, g.game_no desc, g.id limit 1000) g),'[]'::jsonb)
  );
$$;
revoke all on function public.guided_catalog() from public, anon, authenticated;
grant execute on function public.guided_catalog() to anon, authenticated;

create function public.guided_review(p_id uuid, p_revision integer, p_action text, p_reason text,
    p_payload jsonb default null, p_host uuid default null, p_projection jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.guided_referee_drafts;
  g uuid;
  game_revision bigint;
  official_host uuid;
  review_status text;
begin
  perform public.require_club_admin();
  select * into d from public.guided_referee_drafts where id = p_id and submitted_at is not null for update;
  if not found then return jsonb_build_object('error','denied'); end if;
  if p_action = 'approve' and d.status = 'approved' and p_revision in (d.revision - 1, d.revision)
  then return jsonb_build_object('game',d.game_id,'status',d.status,'revision',d.revision); end if;
  if d.revision <> p_revision or d.status not in ('submitted','clarify')
    or coalesce(p_action,'') not in ('approve','correction','clarify','rejected','archived')
    or (p_action <> 'approve' and coalesce(length(btrim(p_reason)),0) not between 3 and 500)
  then return jsonb_build_object('error','conflict'); end if;

  if p_action = 'correction' then
    if not public.guided_valid_payload(p_id,p_payload,d.evening_id,d.round_no,d.format)
      or (d.payload - 'events') <> (p_payload - 'events')
    then return jsonb_build_object('error','invalid'); end if;
    review_status := 'submitted';
  elsif p_action = 'approve' then
    if d.status <> 'submitted' or jsonb_typeof(p_projection->'seats') is distinct from 'array'
      or coalesce(p_projection->>'winner','') not in ('red','black','draw')
      or coalesce(p_projection->>'type','') not in ('normal','technical')
      or exists (
        select from jsonb_array_elements(p_projection->'seats') with ordinality s(player,n)
         where s.player->>'seat' is distinct from s.n::text
           or s.player->>'player' is distinct from d.payload->'players'->(s.n::integer - 1)->>'id'
      )
    then return jsonb_build_object('error','invalid'); end if;
    official_host := coalesce((d.payload->'host'->>'id')::uuid,p_host);
    if official_host is not null and not exists (select from public.players where id = official_host)
    then return jsonb_build_object('error','host'); end if;
    perform 1 from public.evenings where id = d.evening_id and status <> 'cancelled' for update;
    if not found then return jsonb_build_object('error','invalid'); end if;
    if exists(select from public.games where evening_id = d.evening_id and game_no = d.round_no)
    then return jsonb_build_object('error','round'); end if;
    insert into public.games(evening_id,game_no,format,host_player_id,played_at,started_at,rules_version)
      values(d.evening_id,d.round_no,d.format,official_host,(d.payload->>'startedAt')::timestamptz,(d.payload->>'startedAt')::timestamptz,
        case d.format when 'short9' then 'club-short9-no-first-shot-v1' else 'club-v1' end)
      returning id, revision into g, game_revision;
    -- Establish the private provenance before invoking the existing Core validator.
    -- If any part of the transaction fails, the game and its marker both roll back.
    update public.guided_referee_drafts set game_id = g where id = p_id;
    perform public.save_game(g,official_host,p_projection->'seats',(p_projection->>'winner')::public.game_winner,
      true,game_revision,p_projection->>'type',p_projection->>'reason');
    review_status := 'approved';
  else
    review_status := p_action;
  end if;

  update public.guided_referee_drafts set revision = revision + 1, touched_at = now(), status = review_status,
    review_note = nullif(btrim(p_reason),''), payload = case when p_action = 'correction' then p_payload else payload end,
    game_id = g where id = p_id returning * into d;
  insert into public.guided_referee_versions(draft_id,revision,kind,payload,reason,actor)
    values (p_id,d.revision,case when p_action = 'approve' then 'approved' else p_action end,
      case when p_action in ('correction','approve') then d.payload end, d.review_note, auth.uid());
  return jsonb_build_object('game',d.game_id,'status',d.status,'revision',d.revision);
end $$;
revoke all on function public.guided_review(uuid,integer,text,text,jsonb,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.guided_review(uuid,integer,text,text,jsonb,uuid,jsonb) to authenticated;

-- The guided path stores optional unverified attribution privately. Legacy
-- official recording still requires a registered, separate host.
create or replace function public.assert_finished_game(p_id uuid) returns void
language plpgsql set search_path = '' as $$
declare g public.games; n int; total int; civ int; sher int; don int; maf int;
begin
  select * into g from public.games where id=p_id;
  if not found or g.status <> 'finished' then return; end if;
  n := case g.format when 'classic10' then 10 else 9 end;
  select count(*),count(*) filter(where role='civilian'),count(*) filter(where role='sheriff'),
    count(*) filter(where role='don'),count(*) filter(where role='mafia')
    into total,civ,sher,don,maf from public.game_players where game_id=p_id;
  if total<>n or civ<>n-4 or sher<>1 or don<>1 or maf<>2
     or exists(select 1 from public.game_players where game_id=p_id and seat>n) then
    raise exception 'Партия %: неверный состав или набор ролей',p_id;
  end if;
  if g.host_player_id is null and not exists (
    select 1 from public.guided_referee_drafts where game_id = p_id and status in ('submitted','approved')
  ) then raise exception 'Партия %: назначьте отдельного ведущего',p_id; end if;
  if exists(select 1 from public.game_players where game_id=p_id and player_id=g.host_player_id) then
    raise exception 'Ведущий не может сидеть за столом';
  end if;
  if g.finished_at is null then raise exception 'У завершённой партии нет времени сохранения результата'; end if;
  if (g.result_type<>'normal' or exists(select 1 from public.game_players where game_id=p_id and removed))
     and length(trim(g.result_reason))=0 then raise exception 'Укажите причину технического результата или удаления'; end if;
end $$;

-- RSVP describes attendance. The physical format still controls the number of seats.
create or replace function public.assert_evening_capacity(p_evening uuid) returns void
language plpgsql set search_path = '' as $$
begin return; end $$;
drop trigger signup_capacity on public.evening_signups;
drop trigger evening_capacity on public.evenings;
notify pgrst, 'reload schema';
commit;
