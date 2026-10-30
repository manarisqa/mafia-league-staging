-- SYNTHETIC PREVIEW ONLY. Run after all migrations, in a newly created project.
-- Refuses to overwrite any club or Auth data. No accounts or admin credentials.
begin;
do $$
begin
  if exists(select 1 from public.players) or exists(select 1 from public.seasons)
     or exists(select 1 from public.evenings) or exists(select 1 from auth.users) then
    raise exception 'Preview seed requires an empty isolated database';
  end if;
end $$;

insert into public.seasons(id, name, starts_on)
values ('00000000-0000-0000-0000-0000000000a1', 'Тестовий сезон / Тестовый сезон', current_date - 60);

insert into public.players(id, display_name, nickname, status, joined_on)
select ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid,
       nick, nick, case when n <= 8 then 'club_member'::public.player_status else 'newbie'::public.player_status end,
       current_date - 60
from unnest(array['Сова','Мандрівник','Лис','Хмара','Вектор','Іскра','Тінь','Капітан','Луна','Фенікс','Ведучий','Ведущий'])
     with ordinality as names(nick,n);

-- Dynamic dates keep the RSVP scenario usable after this branch is reopened.
insert into public.evenings(id, season_id, starts_at, place, capacity, status, host_player_id)
values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1',
  ((current_date + 7 + time '19:00') at time zone 'Europe/Vienna'), 'Тест · Graz', 10, 'planned',
  '00000000-0000-0000-0000-000000000112');
insert into public.evening_signups(evening_id, player_id, status)
select '00000000-0000-0000-0000-0000000000e1',
       ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid,
       case when n=6 then 'late'::public.signup_status else 'going'::public.signup_status end
from generate_series(1,6) n;
insert into public.evening_notes(evening_id,note)
values ('00000000-0000-0000-0000-0000000000e1','PRIVATE SYNTHETIC ORGANIZER NOTE');

-- Five historical evenings; twenty Classic10 + five Short9 games.
do $$
declare
  ev uuid;
  game uuid;
  day_at timestamptz;
  e int;
  g int;
  size int;
begin
  for e in 1..5 loop
    ev := gen_random_uuid();
    day_at := ((current_date - (42 - e*7) + time '19:00') at time zone 'Europe/Vienna');
    insert into public.evenings(id,season_id,starts_at,place,capacity,status,host_player_id)
    values(ev,'00000000-0000-0000-0000-0000000000a1',day_at,'Тест · Graz',10,'finished','00000000-0000-0000-0000-000000000111');
    for g in 1..5 loop
      game := gen_random_uuid();
      size := case when g=5 then 9 else 10 end;
      insert into public.games(id,evening_id,game_no,format,host_player_id,played_at,started_at,rules_version)
      values(game,ev,g,case when size=9 then 'short9'::public.game_format else 'classic10'::public.game_format end,
        '00000000-0000-0000-0000-000000000111',day_at+(g-1)*interval '50 minutes',day_at+(g-1)*interval '50 minutes',
        case when size=9 then 'club-short9-no-first-shot-v1' else 'club-v1' end);
      insert into public.game_players(game_id,seat,player_id,role)
      select game,n,('00000000-0000-0000-0000-0000000001' || lpad((((n+e+g-2)%10)+1)::text,2,'0'))::uuid,
        (case n when 1 then 'don' when 2 then 'mafia' when 3 then 'mafia' when 4 then 'sheriff' else 'civilian' end)::public.game_role
      from generate_series(1,size) n;
      update public.games set status='finished',winner=case when (e+g)%3=0 then 'black'::public.game_winner else 'red'::public.game_winner end,
        finished_at=day_at+(g-1)*interval '50 minutes'+interval '40 minutes' where id=game;
    end loop;
  end loop;
end $$;
set constraints all immediate;
commit;
