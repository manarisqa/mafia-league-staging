-- Apply with the matching application release, in one transaction. No hosted DB is
-- changed by adding this file. Existing results/notes are preserved, not repaired.
begin;

create sequence public.club_entity_revision;
grant usage on sequence public.club_entity_revision to authenticated;
alter table public.players add column revision bigint not null default nextval('public.club_entity_revision');
alter table public.evenings add column revision bigint not null default nextval('public.club_entity_revision');
alter table public.games add column revision bigint not null default nextval('public.club_entity_revision');
alter table public.evening_signups add column revision bigint not null default nextval('public.club_entity_revision');

-- Row-level policies cannot hide a column. Move notes out of the public table.
create table public.evening_notes (
  evening_id uuid primary key references public.evenings(id) on delete cascade,
  note text check (char_length(note) <= 500)
);
alter table public.evening_notes enable row level security;
create policy evening_notes_admin_read on public.evening_notes for select using (public.is_admin());
insert into public.evening_notes select id, note from public.evenings where note is not null;
alter table public.evenings drop column note;
grant select on public.evening_notes to authenticated;

alter table public.games
  add column played_at timestamptz,
  add column result_type text not null default 'normal' check (result_type in ('normal','technical')),
  add column voided boolean not null default false,
  add column model_version text not null default 'team-logit-v1' check (model_version = 'team-logit-v1'),
  add column rules_version text not null default 'club-v1',
  add column result_reason text not null default '' check (char_length(result_reason) <= 1000);
update public.games g set played_at = e.starts_at,
  rules_version = case g.format when 'short9' then 'club-short9-no-first-shot-v1' else 'club-v1' end
  from public.evenings e where e.id = g.evening_id;
alter table public.games alter column played_at set not null;
alter table public.games add constraint games_rules_version check (
  rules_version = case format when 'short9' then 'club-short9-no-first-shot-v1' else 'club-v1' end
);
alter table public.game_players
  add column fouls smallint not null default 0 check (fouls between 0 and 20),
  add column removed boolean not null default false;

create table public.club_revision (id boolean primary key default true check(id), revision bigint not null default 1);
insert into public.club_revision(id) values(true);
alter table public.club_revision enable row level security;
create policy club_revision_read on public.club_revision for select using(true);
grant select on public.club_revision to anon, authenticated;
create table public.club_audit (
  id bigint generated always as identity primary key,
  table_name text not null, record_id uuid not null, actor_id uuid,
  before_data jsonb, after_data jsonb, at timestamptz not null default now()
);
alter table public.club_audit enable row level security;
create policy club_audit_admin_read on public.club_audit for select using(public.is_admin());
grant select on public.club_audit to authenticated;

create function public.bump_entity_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.revision := nextval('public.club_entity_revision');
  return new;
end $$;
create function public.audit_club_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b jsonb; a jsonb;
begin
  if tg_op <> 'INSERT' then b := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then a := to_jsonb(new); end if;
  insert into public.club_audit(table_name,record_id,actor_id,before_data,after_data)
    values(tg_table_name,coalesce(a->>'id',b->>'id',a->>'evening_id',b->>'evening_id',a->>'game_id',b->>'game_id')::uuid,
      auth.uid(),b,a);
  return null;
end $$;
create function public.touch_club_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin update public.club_revision set revision = revision + 1 where id; return null; end $$;
do $$ declare t text; begin
  foreach t in array array['players','evenings','games','evening_signups'] loop
    execute format('create trigger entity_revision before update on public.%I for each row execute function public.bump_entity_revision()',t);
  end loop;
  foreach t in array array['players','evenings','games','game_players','evening_signups','evening_notes'] loop
    execute format('create trigger club_audit after insert or update or delete on public.%I for each row execute function public.audit_club_row()',t);
  end loop;
  foreach t in array array['players','seasons','evenings','games','game_players'] loop
    execute format('create trigger club_revision after insert or update or delete on public.%I for each statement execute function public.touch_club_revision()',t);
  end loop;
end $$;

-- Validate the final transaction state on every path (including privileged SQL),
-- not just the first transition from draft to finished.
drop trigger games_validate_finished on public.games;
drop function public.validate_finished_game();
create function public.assert_finished_game(p_id uuid) returns void
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
  if g.host_player_id is null then raise exception 'Партия %: назначьте отдельного ведущего',p_id; end if;
  if exists(select 1 from public.game_players where game_id=p_id and player_id=g.host_player_id) then
    raise exception 'Ведущий не может сидеть за столом';
  end if;
  if g.finished_at is null then raise exception 'У завершённой партии нет времени сохранения результата'; end if;
  if (g.result_type<>'normal' or exists(select 1 from public.game_players where game_id=p_id and removed))
     and length(trim(g.result_reason))=0 then raise exception 'Укажите причину технического результата или удаления'; end if;
end $$;
create function public.validate_game_transaction() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='games' then perform public.assert_finished_game(new.id);
  else
    if tg_op<>'INSERT' then perform public.assert_finished_game(old.game_id); end if;
    if tg_op<>'DELETE' then perform public.assert_finished_game(new.game_id); end if;
  end if;
  return null;
end $$;
create constraint trigger validate_game_commit after insert or update on public.games
  deferrable initially deferred for each row execute function public.validate_game_transaction();
create constraint trigger validate_seats_commit after insert or update or delete on public.game_players
  deferrable initially deferred for each row execute function public.validate_game_transaction();
create function public.game_defaults() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op='INSERT' and new.played_at is null then
    select starts_at into new.played_at from public.evenings where id=new.evening_id;
  end if;
  if new.status='finished' then new.finished_at:=coalesce(new.finished_at,now()); end if;
  return new;
end $$;
create trigger game_defaults before insert or update on public.games for each row execute function public.game_defaults();
-- Any seating edit invalidates an open editor's revision, even outside save_game.
create function public.lock_seating_game() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' and new.game_id<>old.game_id then raise exception 'Нельзя переносить место в другую партию'; end if;
  update public.games set revision=revision where id=case when tg_op='DELETE' then old.game_id else new.game_id end;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger seating_revision before insert or update or delete on public.game_players for each row execute function public.lock_seating_game();

-- Serialize admissions with evening edits; check capacity at commit so account
-- linking can move an existing signup without temporarily consuming two places.
create function public.lock_signup_evening() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' and new.evening_id<>old.evening_id then raise exception 'Нельзя переносить запись в другой вечер'; end if;
  perform 1 from public.evenings where id=case when tg_op='DELETE' then old.evening_id else new.evening_id end for update;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger signup_evening_lock before insert or update or delete on public.evening_signups for each row execute function public.lock_signup_evening();
create function public.assert_evening_capacity(p_evening uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.evening_signups where evening_id=p_evening and status in ('going','late'))>
     (select capacity from public.evenings where id=p_evening) then
    raise exception 'Все места заняты. Выберите «Возможно» или свяжитесь с организатором';
  end if;
end $$;
create function public.validate_capacity_transaction() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='evenings' then perform public.assert_evening_capacity(new.id);
  else perform public.assert_evening_capacity(case when tg_op='DELETE' then old.evening_id else new.evening_id end); end if;
  return null;
end $$;
create constraint trigger signup_capacity after insert or update or delete on public.evening_signups
  deferrable initially deferred for each row execute function public.validate_capacity_transaction();
create constraint trigger evening_capacity after insert or update on public.evenings
  deferrable initially deferred for each row execute function public.validate_capacity_transaction();

create function public.require_club_admin() returns void
language plpgsql set search_path = '' as $$
begin if not public.is_admin() then raise exception 'Нужны права администратора'; end if; end $$;
create function public.lock_game_revision(p_game uuid,p_expected_revision bigint) returns public.games
language plpgsql set search_path = '' as $$
declare g public.games; ev uuid;
begin
  perform public.require_club_admin();
  select evening_id into ev from public.games where id=p_game;
  perform 1 from public.evenings where id=ev for update;
  select * into g from public.games where id=p_game for update;
  if not found then raise exception 'Партия не найдена'; end if;
  if p_expected_revision is null or g.revision<>p_expected_revision then
    raise exception using errcode='40001',message='Партия изменена в другом окне. Обновите страницу; ваши поля не очищены';
  end if;
  return g;
end $$;

create function public.create_game(p_evening uuid,p_format public.game_format) returns uuid
language plpgsql security definer set search_path = '' as $$
declare e public.evenings; result uuid;
begin
  perform public.require_club_admin();
  select * into e from public.evenings where id=p_evening for update;
  if not found or e.status='cancelled' then raise exception 'Вечер не найден или отменён'; end if;
  insert into public.games(evening_id,game_no,format,host_player_id,played_at,rules_version)
    select e.id,coalesce(max(game_no),0)+1,p_format,e.host_player_id,e.starts_at,
      case p_format when 'short9' then 'club-short9-no-first-shot-v1' else 'club-v1' end
    from public.games where evening_id=e.id returning id into result;
  return result;
end $$;

drop function public.save_game(uuid,uuid,jsonb,public.game_winner,boolean);
create function public.save_game(p_game uuid,p_host uuid,p_seats jsonb,p_winner public.game_winner,
  p_finish boolean,p_expected_revision bigint,p_result_type text default 'normal',p_reason text default '') returns bigint
language plpgsql security definer set search_path = '' as $$
declare g public.games; result bigint;
begin
  g:=public.lock_game_revision(p_game,p_expected_revision);
  if g.status='finished' then raise exception 'Сначала верните завершённую партию в черновик'; end if;
  if p_seats is null or jsonb_typeof(p_seats)<>'array' or jsonb_array_length(p_seats)>10 then raise exception 'Неверная рассадка'; end if;
  if p_finish is null or (p_finish and p_winner is null) then raise exception 'Выберите победителя'; end if;
  delete from public.game_players where game_id=p_game;
  insert into public.game_players(game_id,seat,player_id,role,fouls,removed)
    select p_game,(e->>'seat')::smallint,(e->>'player')::uuid,(e->>'role')::public.game_role,
      coalesce((e->>'fouls')::smallint,0),coalesce((e->>'removed')::boolean,false)
    from jsonb_array_elements(p_seats) e;
  update public.games set host_player_id=p_host,started_at=coalesce(started_at,now()),
    status=case when p_finish then 'finished'::public.game_status else 'in_progress'::public.game_status end,
    winner=case when p_finish then p_winner else null end,result_type=p_result_type,result_reason=trim(p_reason)
    where id=p_game returning revision into result;
  -- Explicit validation gives a useful RPC error; deferred checks also cover SQL.
  perform public.assert_finished_game(p_game);
  return result;
end $$;
create function public.reopen_game(p_game uuid,p_expected_revision bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare g public.games; result bigint;
begin
  g:=public.lock_game_revision(p_game,p_expected_revision);
  update public.games set status='in_progress',winner=null,finished_at=null where id=p_game returning revision into result;
  return result;
end $$;
create function public.delete_game(p_game uuid,p_expected_revision bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare g public.games;
begin
  g:=public.lock_game_revision(p_game,p_expected_revision);
  if g.status='finished' then raise exception 'Сначала верните партию в черновик'; end if;
  delete from public.games where id=p_game;
  return g.evening_id;
end $$;

create function public.save_evening(p_id uuid,p_expected_revision bigint,p_starts_at timestamptz,p_place text,
  p_capacity smallint,p_status public.evening_status,p_host uuid,p_note text,p_season uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.evenings; result uuid;
begin
  perform public.require_club_admin();
  if length(trim(p_place)) not between 1 and 100 or length(p_note)>500 then raise exception 'Проверьте место и заметку'; end if;
  if p_id is null then
    if p_expected_revision is distinct from 0::bigint then raise exception using errcode='40001',message='Неверная версия нового вечера'; end if;
    insert into public.evenings(starts_at,place,capacity,status,host_player_id,season_id)
      values(p_starts_at,trim(p_place),p_capacity,p_status,p_host,p_season) returning id into result;
  else
    select * into e from public.evenings where id=p_id for update;
    if not found then raise exception 'Вечер не найден'; end if;
    if p_expected_revision is null or e.revision<>p_expected_revision then
      raise exception using errcode='40001',message='Вечер изменён в другом окне. Обновите страницу';
    end if;
    if e.starts_at is distinct from p_starts_at
       and exists(select 1 from public.games where evening_id=e.id) then
      raise exception 'У вечера с партиями нельзя менять дату';
    end if;
    update public.evenings set starts_at=p_starts_at,place=trim(p_place),capacity=p_capacity,status=p_status,
      host_player_id=p_host,season_id=p_season where id=p_id;
    result:=p_id;
  end if;
  insert into public.evening_notes values(result,nullif(trim(p_note),'')) on conflict(evening_id) do update set note=excluded.note;
  perform public.assert_evening_capacity(result);
  return (select jsonb_build_object('id',id,'revision',revision) from public.evenings where id=result);
end $$;
create function public.delete_evening(p_evening uuid,p_expected_revision bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.evenings;
begin
  perform public.require_club_admin();
  select * into e from public.evenings where id=p_evening for update;
  if not found then raise exception 'Вечер не найден'; end if;
  if p_expected_revision is null or e.revision<>p_expected_revision then raise exception using errcode='40001',message='Вечер изменён. Обновите страницу'; end if;
  if exists(select 1 from public.games where evening_id=p_evening) then raise exception 'Нельзя удалить вечер с партиями'; end if;
  delete from public.evenings where id=p_evening;
end $$;

create function public.set_rsvp(p_evening uuid,p_player uuid,p_status text,p_expected_revision bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare e public.evenings; s public.evening_signups; result bigint;
begin
  if not public.is_admin() and not public.owns_player(p_player) then raise exception 'Можно менять только свою запись'; end if;
  select * into e from public.evenings where id=p_evening for update;
  if not found or e.status<>'planned' or e.starts_at<=now() then raise exception 'Запись закрыта: вечер начался, завершён или отменён'; end if;
  select * into s from public.evening_signups where evening_id=p_evening and player_id=p_player for update;
  if p_expected_revision is null or coalesce(s.revision,0)<>p_expected_revision then
    raise exception using errcode='40001',message='Запись изменена в другом окне. Обновите страницу';
  end if;
  if p_status='cancel' then
    delete from public.evening_signups where evening_id=p_evening and player_id=p_player;
    return 0;
  end if;
  insert into public.evening_signups(evening_id,player_id,status) values(p_evening,p_player,p_status::public.signup_status)
    on conflict(evening_id,player_id) do update set status=excluded.status returning revision into result;
  perform public.assert_evening_capacity(p_evening);
  return result;
end $$;

create function public.save_player(p_id uuid,p_expected_revision bigint,p_name text,p_nickname text,p_status public.player_status) returns bigint
language plpgsql security definer set search_path = '' as $$
declare p public.players; result bigint;
begin
  perform public.require_club_admin();
  if p_id is null then
    if p_expected_revision is distinct from 0::bigint then raise exception using errcode='40001',message='Неверная версия нового игрока'; end if;
    insert into public.players(display_name,nickname,status,joined_on)
      values(trim(p_name),nullif(trim(p_nickname),''),p_status,(now() at time zone 'Europe/Vienna')::date) returning revision into result;
  else
    select * into p from public.players where id=p_id for update;
    if not found then raise exception 'Игрок не найден'; end if;
    if p_expected_revision is null or p.revision<>p_expected_revision then raise exception using errcode='40001',message='Профиль изменён в другом окне. Обновите страницу'; end if;
    update public.players set display_name=trim(p_name),nickname=nullif(trim(p_nickname),''),status=p_status where id=p_id returning revision into result;
  end if;
  return result;
end $$;
create function public.delete_player(p_player uuid,p_expected_revision bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.players;
begin
  perform public.require_club_admin();
  select * into p from public.players where id=p_player for update;
  if not found then raise exception 'Игрок не найден'; end if;
  if p_expected_revision is null or p.revision<>p_expected_revision then raise exception using errcode='40001',message='Профиль изменён. Обновите страницу'; end if;
  if exists(select 1 from public.game_players where player_id=p_player)
     or exists(select 1 from public.games where host_player_id=p_player) then raise exception 'Нельзя удалить участника или ведущего записанной партии'; end if;
  delete from public.players where id=p_player;
end $$;

-- Keep Ilya's account-link implementation, but lock/version both identities.
alter function public.link_account(uuid,uuid) rename to link_account_before_core;
revoke all on function public.link_account_before_core(uuid,uuid) from public,anon,authenticated;
create function public.link_account(historical uuid,account uuid,p_historical_revision bigint,p_account_revision bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare h public.players; a public.players;
begin
  perform public.require_club_admin();
  perform 1 from public.players where id in(historical,account) order by id for update;
  select * into h from public.players where id=historical;
  select * into a from public.players where id=account;
  if h.id is null or a.id is null then raise exception 'Профиль не найден'; end if;
  if p_historical_revision is null or p_account_revision is null
     or h.revision<>p_historical_revision or a.revision<>p_account_revision then
    raise exception using errcode='40001',message='Один из профилей изменён. Обновите страницу';
  end if;
  perform public.link_account_before_core(historical,account);
end $$;

-- One public MVCC snapshot, no note/account identifiers/draft roles, no REST row
-- truncation. All public selectors and Skill use this same completed-game policy.
create function public.league_snapshot() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'revision',(select revision from public.club_revision where id),
    'players',coalesce((select jsonb_agg(jsonb_build_object('id',id,'display_name',display_name,'status',status,'joined_on',joined_on,'revision',revision) order by id) from public.players),'[]'::jsonb),
    'seasons',coalesce((select jsonb_agg(to_jsonb(s) order by id) from public.seasons s),'[]'::jsonb),
    'evenings',coalesce((select jsonb_agg(jsonb_build_object('id',id,'starts_at',starts_at,'place',place,'capacity',capacity,'status',status,'season_id',season_id,'host_player_id',host_player_id,'revision',revision) order by starts_at,id) from public.evenings),'[]'::jsonb),
    'games',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('seats',coalesce((select jsonb_agg(to_jsonb(p) order by seat) from public.game_players p where game_id=g.id),'[]'::jsonb)) order by played_at,evening_id,game_no,id)
      from public.games g where g.status='finished' and not g.voided and exists(select 1 from public.evenings e where e.id=g.evening_id and e.status<>'cancelled')),'[]'::jsonb)
  );
$$;

-- Authenticated clients must use the CAS RPCs, including administrators. The
-- earlier account-link trigger/function stays server-owned and transactional.
revoke insert,update,delete on public.players,public.games,public.game_players,public.evenings,public.evening_signups,public.evening_notes from public,anon,authenticated;
revoke all on public.club_audit,public.club_revision from public,anon,authenticated;
grant select on public.club_audit to authenticated;
grant select on public.club_revision to anon,authenticated;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'bump_entity_revision','audit_club_row','touch_club_revision','assert_finished_game','validate_game_transaction','game_defaults',
      'lock_seating_game','lock_signup_evening','assert_evening_capacity','validate_capacity_transaction','require_club_admin','lock_game_revision',
      'create_game','save_game','reopen_game','delete_game','save_evening','delete_evening','set_rsvp','save_player','delete_player','link_account')
  loop execute format('revoke all on function %s from public,anon,authenticated',f.signature); end loop;
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('create_game','save_game','reopen_game','delete_game','save_evening','delete_evening','set_rsvp','save_player','delete_player','link_account')
  loop execute format('grant execute on function %s to authenticated',f.signature); end loop;
end $$;
grant execute on function public.league_snapshot() to anon,authenticated;

-- Fail without changing data if historical corruption needs human correction.
do $$ declare g record; e record; begin
  for g in select id from public.games where status='finished' loop perform public.assert_finished_game(g.id); end loop;
  for e in select id from public.evenings loop perform public.assert_evening_capacity(e.id); end loop;
end $$;
notify pgrst, 'reload schema';
commit;
