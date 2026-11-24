begin;

-- These helpers have no grants outside the migration owner. They replay only
-- correction metadata and select a recorded best move, never an entire log.
create function public.insight_active_events(p_events jsonb, p_guided boolean) returns jsonb[]
language plpgsql immutable set search_path = '' as $$
declare
  active jsonb[] := '{}';
  undone jsonb[] := '{}';
  event jsonb;
  action jsonb;
begin
  if jsonb_typeof(p_events) is distinct from 'array' then return '{}'; end if;
  if jsonb_array_length(p_events) not between 1 and 2000 then return '{}'; end if;
  for event in select value from jsonb_array_elements(p_events) loop
    action := event->(case when p_guided then 'action' else 'command' end);
    case action->>'type'
      when 'undo', 'observation_undone' then
        if action->>'target' is null or active[cardinality(active)]->>'id' is distinct from action->>'target'
        then return '{}'; end if;
        undone := array_append(undone, active[cardinality(active)]);
        active := active[1:cardinality(active)-1];
      when 'redo', 'observation_redone' then
        if action->>'target' is null or undone[cardinality(undone)]->>'id' is distinct from action->>'target'
        then return '{}'; end if;
        active := array_append(active, undone[cardinality(undone)]);
        undone := undone[1:cardinality(undone)-1];
      else
        active := array_append(active, event);
        undone := '{}';
    end case;
  end loop;
  return active;
end $$;
revoke all on function public.insight_active_events(jsonb,boolean) from public, anon, authenticated;

create function public.insight_best_hits(p_events jsonb[], p_guided boolean, p_seat smallint, p_roles jsonb)
returns integer language plpgsql immutable set search_path = '' as $$
declare
  shot jsonb;
  shot_name text := case when p_guided then 'shot' else 'shot_observation' end;
  action_key text := case when p_guided then 'action' else 'command' end;
  shot_position bigint;
  best_position bigint;
  best jsonb;
  victim text;
  valid_targets integer;
  black_targets integer;
begin
  select ev->action_key, position into best, best_position
    from unnest(p_events) with ordinality as log(ev, position)
    where ev->action_key->>'type' = case when p_guided then 'best' else 'best_move' end
      and (p_guided or ev->>'phase' = 'N1')
    order by position limit 1;
  if not found then return null; end if;
  best := best->(case when p_guided then 'targets' else 'trio' end);
  if jsonb_typeof(best) is distinct from 'array' then return null; end if;
  if jsonb_array_length(best) <> 3 then return null; end if;

  select ev->action_key, position into shot, shot_position
    from unnest(p_events) with ordinality as log(ev, position)
    where position < best_position and (p_guided or ev->>'phase' = 'N1')
      and ev->action_key->>'type' in (shot_name, 'shotNone')
    order by position desc limit 1;
  if not found then return null; end if;
  if p_guided and shot->>'type' = 'shot' or not p_guided and shot->>'mode' = 'target' then
    victim := shot->>'target';
  elsif not p_guided and shot->>'mode' = 'independent' and jsonb_typeof(shot->'shots') = 'array' then
    select min(value->>'target') into victim from jsonb_array_elements(shot->'shots')
      having count(*) > 0 and count(*) = count(value->>'target') and count(distinct value->>'target') = 1;
  end if;
  if victim is distinct from p_seat::text then return null; end if;
  if not exists (
    select from unnest(p_events) with ordinality as log(ev, position)
    where shot_position < position and position < best_position
      and ev->action_key->>'type' = case when p_guided then 'advance' else 'night_result' end
      and (p_guided or ev->>'phase' = 'N1')
  ) then return null; end if;

  select count(distinct value), count(*) filter (where p_roles->>value in ('mafia', 'don'))
    into valid_targets, black_targets
    from jsonb_array_elements_text(best)
    where value <> victim and p_roles->>value in ('civilian', 'sheriff', 'mafia', 'don');
  if valid_targets <> 3 then return null; end if;
  return black_targets;
end $$;
revoke all on function public.insight_best_hits(jsonb[],boolean,smallint,jsonb) from public, anon, authenticated;

-- Only the selected player's official games can reach the private sources.
-- Output is allowed in a public profile: game/revision, coverage and score.
-- No identities from payloads, private observations or note text leave SQL.
create function public.player_protocol_facts(p_player uuid, p_start date default null, p_end date default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with sourced as materialized (
    select g.id, g.revision, g.format, p.seat, d.id is not null as guided,
      coalesce(d.payload, r.payload) as payload,
      (select jsonb_object_agg(s.seat, s.role::text)
        from public.game_players s where s.game_id = g.id) as roles
    from public.game_players p
    join public.games g on g.id = p.game_id
    join public.evenings e on e.id = g.evening_id
    left join public.guided_referee_drafts d on d.game_id = g.id and d.status = 'approved'
      and d.evening_id = g.evening_id and d.format = g.format
      and not exists (
        select from public.game_players s where s.game_id = g.id
          and d.payload->'players'->(s.seat - 1)->>'id' is distinct from s.player_id::text
      )
    left join public.referee_protocols r on r.approved_game_id = g.id and r.approved_game_revision = g.revision
    where p.player_id = p_player and g.status = 'finished' and g.winner is not null
      and not g.voided and e.status <> 'cancelled'
      and (p_start is null or g.played_at >= p_start::timestamp at time zone 'Europe/Vienna')
      and (p_end is null or g.played_at < (p_end + 1)::timestamp at time zone 'Europe/Vienna')
      and (d.id is not null or r.id is not null)
  ), replayed as materialized (
    select id, revision, format, seat, guided, roles, public.insight_active_events(payload->'events', guided) as events
    from sourced
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'gameId', id,
    'revision', revision,
    'bestHits', case when not guided or format = 'classic10'
      then public.insight_best_hits(events, guided, seat, roles) end
  ) order by id), '[]'::jsonb)
  from replayed
  where exists (
    select from unnest(events) as ev
    where case when guided then ev->'action'->>'type' in ('finish', 'exception')
      else ev->'command'->>'type' = 'game_finished' end
  );
$$;
revoke all on function public.player_protocol_facts(uuid,date,date) from public, anon, authenticated;
grant execute on function public.player_protocol_facts(uuid,date,date) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
