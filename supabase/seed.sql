-- ДЕМОНСТРАЦИОННЫЕ данные для проверки сайта. Это не настоящие игроки и игры.
-- Запускайте только в пустой базе для пробы; настоящие данные клуба вносятся через админку.

insert into public.seasons (id, name, starts_on)
values ('00000000-0000-0000-0000-0000000000a1', 'Сезон 2026 / 2027', '2026-09-01');

-- 12 демо-игроков.
insert into public.players (id, display_name, status, joined_on)
select
  ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid,
  'Игрок ' || lpad(n::text, 2, '0'),
  case when n <= 7 then 'club_member'::public.player_status else 'newbie'::public.player_status end,
  date '2026-09-01'
from generate_series(1, 12) as n;

-- Ближайший вечер: 6 записавшихся из 10.
insert into public.evenings (id, season_id, starts_at, place, capacity, status, host_player_id)
values (
  '00000000-0000-0000-0000-0000000000e1',
  '00000000-0000-0000-0000-0000000000a1',
  '2026-11-14 19:00:00+01', 'Грац', 10, 'planned',
  '00000000-0000-0000-0000-000000000112'
);

insert into public.evening_signups (evening_id, player_id, status)
select '00000000-0000-0000-0000-0000000000e1',
       ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid,
       case when n = 6 then 'late'::public.signup_status else 'going'::public.signup_status end
from generate_series(1, 6) as n;

-- Прошедший вечер с двумя партиями (Классика 10 и Short9).
insert into public.evenings (id, season_id, starts_at, place, capacity, status, host_player_id)
values (
  '00000000-0000-0000-0000-0000000000e0',
  '00000000-0000-0000-0000-0000000000a1',
  '2026-10-31 19:00:00+01', 'Грац', 10, 'finished',
  '00000000-0000-0000-0000-000000000111'
);

insert into public.games (id, evening_id, game_no, format, host_player_id, rules_version) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e0', 1, 'classic10', '00000000-0000-0000-0000-000000000111', 'club-v1'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e0', 2, 'short9',    '00000000-0000-0000-0000-000000000111', 'club-short9-no-first-shot-v1');

-- Игроки 01–10 за столом Классики 10; роли идут по местам 1..10.
insert into public.game_players (game_id, seat, player_id, role)
select '00000000-0000-0000-0000-0000000000f1', n,
       ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid,
       (array['civilian','sheriff','civilian','don','civilian','mafia','civilian','civilian','mafia','civilian'])[n]::public.game_role
from generate_series(1, 10) as n;

-- Игроки 01–09 за столом Short9.
insert into public.game_players (game_id, seat, player_id, role)
select '00000000-0000-0000-0000-0000000000f2', n,
       ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid,
       (array['civilian','sheriff','don','civilian','mafia','civilian','mafia','civilian','civilian'])[n]::public.game_role
from generate_series(1, 9) as n;

-- Завершаем партии только после того, как все игроки добавлены (так работает проверка состава).
update public.games set status = 'finished', winner = 'red'   where id = '00000000-0000-0000-0000-0000000000f1';
update public.games set status = 'finished', winner = 'black' where id = '00000000-0000-0000-0000-0000000000f2';
