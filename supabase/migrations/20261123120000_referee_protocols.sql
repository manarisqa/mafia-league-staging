begin;

create table public.referee_protocols (
  id text primary key check (id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  owner_id uuid references auth.users(id) on delete set null default auth.uid(),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  payload jsonb not null,
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  title text generated always as (payload->>'title') stored,
  format text generated always as (payload->>'format') stored,
  approved_game_id uuid unique,
  approved_game_revision bigint,
  approved_at timestamptz,
  approval jsonb,
  check ((approved_game_id is null and approved_game_revision is null and approved_at is null and approval is null)
      or (approved_game_id is not null and approved_game_revision is not null and approved_at is not null and approval is not null))
);
comment on column public.referee_protocols.approved_game_id is
  'Permanent approval receipt. Retains the game UUID if an admin later deletes the game.';
create index referee_protocols_owner_updated on public.referee_protocols(owner_id, updated_at desc);
alter table public.referee_protocols enable row level security;
revoke all on public.referee_protocols from public, anon, authenticated;
grant select on public.referee_protocols to authenticated;
create policy referee_protocols_owner_read on public.referee_protocols for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_admin()));

create function public.save_referee_protocol(p_payload jsonb, p_checksum text, p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  saved public.referee_protocols;
  draft_id text := p_payload->>'draftId';
begin
  perform public.require_club_admin();
  if p_payload is null or p_checksum is null or p_expected_revision is null or p_expected_revision < 0
     or coalesce(draft_id, '') !~ '^[a-zA-Z0-9_-]{1,100}$'
     or p_checksum !~ '^[0-9a-f]{64}$'
     or octet_length(p_payload::text) > 2000000
     or p_payload->>'schema' is distinct from 'mafia-league-referee-protocol-v1'
     or coalesce(p_payload->>'format', '') not in ('classic10', 'short9')
     or coalesce(length(p_payload->>'title'), 0) not between 1 and 100
     or coalesce(p_payload->>'status', '') not in ('draft', 'completed_unapproved')
     or jsonb_typeof(p_payload->'events') is distinct from 'array'
  then raise exception using errcode='22023', message='Invalid referee protocol'; end if;

  if jsonb_array_length(p_payload->'events') > 2000 or
     p_payload->'clientRevision' is distinct from to_jsonb(jsonb_array_length(p_payload->'events'))
  then raise exception using errcode='22023', message='Invalid referee log'; end if;

  if p_expected_revision = 0 then
    insert into public.referee_protocols(id, payload, checksum)
      values (draft_id, p_payload, p_checksum) on conflict (id) do nothing;
  end if;

  select * into saved from public.referee_protocols where id = draft_id and owner_id = auth.uid() for update;
  if not found then raise exception using errcode='42501', message='Protocol unavailable'; end if;
  if saved.payload = p_payload and saved.checksum = p_checksum then return saved.revision; end if;
  if saved.approved_at is not null or saved.revision <> p_expected_revision
     or (saved.payload - array['events','status','clientRevision']) <> (p_payload - array['events','status','clientRevision'])
     or jsonb_array_length(saved.payload->'events') >= jsonb_array_length(p_payload->'events')
     or exists (
       select 1 from jsonb_array_elements(saved.payload->'events') with ordinality as prior(event, position)
       where prior.event is distinct from (p_payload->'events')->((prior.position - 1)::integer)
     )
  then raise exception using errcode='40001', message='Protocol version conflict'; end if;

  update public.referee_protocols
     set payload = p_payload, checksum = p_checksum, revision = revision + 1, updated_at = now()
   where id = draft_id returning revision into saved.revision;
  return saved.revision;
end $$;

create function public.approve_referee_protocol(
  p_protocol text, p_protocol_revision bigint, p_checksum text, p_game uuid, p_expected_revision bigint,
  p_host uuid, p_seats jsonb, p_winner public.game_winner, p_result_type text, p_reason text
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  saved public.referee_protocols;
  game public.games;
  receipt jsonb := jsonb_build_object('host', p_host, 'seats', p_seats, 'winner', p_winner,
                                     'type', p_result_type, 'reason', p_reason);
  game_revision bigint;
  active jsonb[] := array[]::jsonb[];
  undone jsonb[] := array[]::jsonb[];
  event jsonb;
  command jsonb;
  result jsonb;
  initial_seat jsonb;
  submitted jsonb;
  bound_player text;
  recorded_role text;
  fouls integer;
  warnings integer;
  removed boolean;
  uuid_pattern constant text := '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$';
begin
  perform public.require_club_admin();
  select * into saved from public.referee_protocols where id = p_protocol and owner_id = auth.uid() for update;
  if not found then raise exception using errcode='42501', message='Protocol unavailable'; end if;
  if saved.revision is distinct from p_protocol_revision or saved.checksum is distinct from p_checksum
  then raise exception using errcode='40001', message='Protocol version conflict'; end if;
  if saved.approved_game_id is not null then
    if saved.approved_game_id = p_game and saved.approval = receipt then return saved.approved_game_revision; end if;
    raise exception using errcode='23505', message='Protocol already approved';
  end if;
  if saved.payload->>'status' <> 'completed_unapproved' then
    raise exception using errcode='22023', message='Protocol is not completed';
  end if;
  -- Same lock order as the existing Core game mutations. The lock and unique
  -- receipt cover different protocols attempting to approve the same game.
  game := public.lock_game_revision(p_game, p_expected_revision);
  if exists (select 1 from public.referee_protocols where approved_game_id = p_game) then
    raise exception using errcode='23505', message='Game already has an approved protocol';
  end if;
  if game.status <> 'in_progress' or game.format::text <> saved.format
     or exists (select 1 from public.evenings where id = game.evening_id and status = 'cancelled')
     or p_host is null or p_winner is null
  then raise exception using errcode='22023', message='Game is not available for approval'; end if;

  -- An authenticated admin can call RPCs directly. Check that the approved
  -- projection still matches the saved observations, including undo/redo.
  for event in select value from jsonb_array_elements(saved.payload->'events') loop
    command := event->'command';
    case command->>'type'
      when 'observation_undone' then
        if active[cardinality(active)]->>'id' is distinct from command->>'target'
        then raise exception using errcode='22023', message='Invalid undo'; end if;
        undone := array_append(undone, active[cardinality(active)]);
        active := active[1:cardinality(active)-1];
      when 'observation_redone' then
        if undone[cardinality(undone)]->>'id' is distinct from command->>'target'
        then raise exception using errcode='22023', message='Invalid redo'; end if;
        active := array_append(active, undone[cardinality(undone)]);
        undone := undone[1:cardinality(undone)-1];
      else
        active := array_append(active, event);
        undone := array[]::jsonb[];
    end case;
  end loop;

  select e->'command' into result from unnest(active) with ordinality as log(e, position)
    where e->'command'->>'type' = 'game_finished' order by position desc limit 1;
  bound_player := saved.payload->'host'->>'optionalPublicPlayerId';
  if result->>'confidence' is distinct from 'observed'
     or coalesce(result->>'outcome', '') not in ('normal', 'technical', 'draw')
     or p_winner::text is distinct from (case when result->>'outcome' = 'draw' then 'draw' else result->>'winner' end)
     or p_result_type is distinct from (case when result->>'outcome' = 'technical' then 'technical' else 'normal' end)
     or p_reason is distinct from result->>'basis'
     or (case when bound_player ~* uuid_pattern then bound_player::uuid <> p_host else false end)
     or jsonb_typeof(p_seats) is distinct from 'array'
     or jsonb_typeof(saved.payload->'seats') is distinct from 'array'
  then raise exception using errcode='22023', message='Projection does not match protocol'; end if;

  if jsonb_array_length(saved.payload->'seats') <> (case saved.format when 'short9' then 9 else 10 end)
     or jsonb_array_length(saved.payload->'seats') <> jsonb_array_length(p_seats)
  then raise exception using errcode='22023', message='Incomplete protocol seats'; end if;

  for initial_seat in select value from jsonb_array_elements(saved.payload->'seats') loop
    select value into submitted from jsonb_array_elements(p_seats) where value->>'seat' = initial_seat->>'number';
    bound_player := initial_seat->>'optionalPublicPlayerId';
    recorded_role := initial_seat->>'role';
    fouls := 0;
    warnings := 0;
    removed := false;
    for command in select e->'command' from unnest(active) e where e->'command'->>'seat' = initial_seat->>'number' loop
      case command->>'type'
        when 'seat_assigned' then bound_player := command->>'playerId';
        when 'role_recorded', 'role_confirmed' then recorded_role := command->>'role';
        when 'ordinary_foul' then fouls := fouls + 1;
        when 'technical_warning_manual' then warnings := warnings + 1;
        when 'removed' then removed := true;
        else null;
      end case;
    end loop;
    if submitted is null or recorded_role is null or recorded_role is distinct from submitted->>'role'
       or to_jsonb(fouls) is distinct from submitted->'fouls'
       or to_jsonb(removed or fouls >= 4 or warnings >= 2) is distinct from submitted->'removed'
       or (case when bound_player ~* uuid_pattern then bound_player::uuid is distinct from (submitted->>'player')::uuid else false end)
    then raise exception using errcode='22023', message='Seating does not match protocol'; end if;
  end loop;

  game_revision := public.save_game(p_game, p_host, p_seats, p_winner, true, p_expected_revision, p_result_type, p_reason);
  update public.referee_protocols
     set approved_game_id = p_game, approved_game_revision = game_revision,
         approved_at = now(), approval = receipt, updated_at = now()
   where id = p_protocol;
  return game_revision;
end $$;

revoke all on function public.save_referee_protocol(jsonb,text,bigint) from public, anon, authenticated;
revoke all on function public.approve_referee_protocol(text,bigint,text,uuid,bigint,uuid,jsonb,public.game_winner,text,text) from public, anon, authenticated;
grant execute on function public.save_referee_protocol(jsonb,text,bigint) to authenticated;
grant execute on function public.approve_referee_protocol(text,bigint,text,uuid,bigint,uuid,jsonb,public.game_winner,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
