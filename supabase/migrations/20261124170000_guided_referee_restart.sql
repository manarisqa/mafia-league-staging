begin;

-- Existing visibility rules hide drafts that have never been submitted. A restart
-- keeps a permanent private receipt for the attempt ID and erases its saved actions.
alter table public.guided_referee_drafts
  add column restarted_as uuid,
  add column restarted_at timestamptz,
  add constraint guided_restart_receipt check (
    (restarted_as is null and restarted_at is null) or
    (restarted_as is not null and restarted_at is not null and restarted_as <> id and status = 'revoked'
      and submitted_at is null and game_id is null)
  );

create or replace function public.guided_guest(p_action text, p_id uuid, p_secret text, p_revision integer, p_payload jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.guided_referee_drafts;
  hash bytea;
  ev uuid;
  fmt public.game_format;
  round_n smallint;
  new_status text;
  attempt jsonb;
  replacement uuid;
begin
  if p_id is null or coalesce(p_secret, '') !~ '^[0-9a-f]{64}$' or p_revision is null or p_revision < 0
      or coalesce(p_action, '') not in ('read','save','submit','revoke','restart')
  then return jsonb_build_object('error','invalid'); end if;

  hash := sha256(convert_to(p_secret, 'UTF8'));
  -- Serialize by attempt even when the first request has not created a row.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 24120000));
  if p_action = 'restart' then
    attempt := p_payload->'attempt';
    if coalesce(p_payload->>'replacement','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      or attempt->'events' is distinct from '[]'::jsonb
      or octet_length(p_payload::text) > 480000
    then return jsonb_build_object('error','invalid'); end if;
    replacement := (p_payload->>'replacement')::uuid;
    if replacement = p_id then return jsonb_build_object('error','invalid'); end if;

    select * into d from public.guided_referee_drafts where id = p_id for update;
    if found then
      if d.capability_hash <> hash then return jsonb_build_object('error','denied'); end if;
      if d.submitted_at is not null or d.game_id is not null
        or (d.restarted_as is not null and d.restarted_as <> replacement)
      then return jsonb_build_object('error','restart_protected'); end if;
      if d.restarted_as = replacement
      then return jsonb_build_object('revision',d.revision,'status','revoked'); end if;
      if (d.payload - 'events') is distinct from (attempt - 'events')
      then return jsonb_build_object('error','conflict'); end if;
      update public.guided_referee_drafts
        set status = 'revoked', expires_at = 'infinity', touched_at = now(), revision = revision + 1,
            restarted_as = replacement, restarted_at = now(), payload = '{}'::jsonb
        where id = p_id returning * into d;
    else
      if coalesce(attempt->>'round','') !~ '^[0-9]{1,5}$'
        or coalesce(attempt->>'evening','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        or coalesce(attempt->>'format','') not in ('classic10','short9')
        or (attempt->>'round')::integer not between 1 and 32767
      then return jsonb_build_object('error','invalid'); end if;
      ev := (attempt->>'evening')::uuid;
      fmt := (attempt->>'format')::public.game_format;
      round_n := (attempt->>'round')::smallint;
      if not public.guided_valid_payload(p_id,attempt,ev,round_n,fmt)
        or not exists (select from public.evenings where id = ev)
      then return jsonb_build_object('error','invalid'); end if;
      if not public.guided_limit('restart', 80, interval '1 hour')
      then return jsonb_build_object('error','rate'); end if;
      insert into public.guided_referee_drafts(id,evening_id,round_no,format,capability_hash,expires_at,payload,status,
          restarted_as,restarted_at)
        values(p_id,ev,round_n,fmt,hash,'infinity','{}','revoked',replacement,now()) returning * into d;
    end if;
    return jsonb_build_object('revision',d.revision,'status','revoked');
  end if;
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
    delete from public.guided_referee_drafts where expires_at <= now() and submitted_at is null and restarted_as is null;
    delete from public.guided_referee_limits where started_at < now() - interval '1 day' and bucket like 'read:%';
    if (select count(*) from public.guided_referee_drafts where submitted_at is null and restarted_as is null) >= 400
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
      or exists (select from public.guided_referee_drafts competing
        where competing.evening_id = d.evening_id and competing.round_no = d.round_no
          and competing.id <> d.id and competing.status in ('submitted','clarify'))
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

notify pgrst, 'reload schema';
commit;
