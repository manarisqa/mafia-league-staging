begin;

-- Keep existing player IDs and use the explicit gaming nickname when present.
create or replace function public.league_snapshot() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'revision',(select revision from public.club_revision where id),
    'players',coalesce((select jsonb_agg(jsonb_build_object('id',id,'display_name',coalesce(nullif(btrim(nickname), ''),display_name),'status',status,'joined_on',joined_on,'revision',revision) order by id) from public.players),'[]'::jsonb),
    'seasons',coalesce((select jsonb_agg(to_jsonb(s) order by id) from public.seasons s),'[]'::jsonb),
    'evenings',coalesce((select jsonb_agg(jsonb_build_object('id',id,'starts_at',starts_at,'place',place,'capacity',capacity,'status',status,'season_id',season_id,'host_player_id',host_player_id,'revision',revision) order by starts_at,id) from public.evenings),'[]'::jsonb),
    'games',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('seats',coalesce((select jsonb_agg(to_jsonb(p) order by seat) from public.game_players p where game_id=g.id),'[]'::jsonb)) order by played_at,evening_id,game_no,id)
      from public.games g where g.status='finished' and not g.voided and exists(select 1 from public.evenings e where e.id=g.evening_id and e.status<>'cancelled')),'[]'::jsonb)
  );
$$;

commit;
