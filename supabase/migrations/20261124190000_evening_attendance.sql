begin;

-- A log row means that the organizer recorded a complete roster, including
-- an explicitly empty one. Historical evenings without a log stay unknown.
create table public.evening_attendance_logs (
  evening_id uuid primary key references public.evenings(id) on delete restrict,
  revision integer not null default 1 check (revision > 0),
  recorded_at timestamptz not null default now()
);
create table public.evening_attendees (
  evening_id uuid not null references public.evening_attendance_logs(evening_id),
  player_id uuid not null references public.players(id) on delete restrict,
  primary key (evening_id, player_id)
);
create index evening_attendees_player_idx on public.evening_attendees(player_id, evening_id);

alter table public.evening_attendance_logs enable row level security;
alter table public.evening_attendees enable row level security;
revoke all on public.evening_attendance_logs, public.evening_attendees from public, anon, authenticated;
grant select on public.evening_attendance_logs, public.evening_attendees to authenticated;
create policy evening_attendance_logs_admin on public.evening_attendance_logs
  for select to authenticated using ((select public.is_admin()));
create policy evening_attendees_admin on public.evening_attendees
  for select to authenticated using ((select public.is_admin()));

create trigger club_audit after insert or update or delete on public.evening_attendance_logs
  for each row execute function public.audit_club_row();
create trigger club_audit after insert or delete on public.evening_attendees
  for each row execute function public.audit_club_row();

create function public.keep_attendance_evening_date() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.starts_at is distinct from new.starts_at
     and exists (select 1 from public.evening_attendance_logs where evening_id = old.id) then
    raise exception 'У вечера с журналом посещаемости нельзя менять дату.';
  end if;
  return new;
end $$;
revoke all on function public.keep_attendance_evening_date() from public, anon, authenticated;
create trigger keep_attendance_evening_date before update of starts_at on public.evenings
  for each row execute function public.keep_attendance_evening_date();

create function public.save_evening_attendance(
  p_evening uuid, p_expected_revision integer, p_attendees uuid[]
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  e public.evenings;
  current_revision integer;
  previous_ids uuid[];
  requested_ids uuid[];
begin
  perform public.require_club_admin();
  if p_expected_revision is null or p_expected_revision < 0
     or p_attendees is null or cardinality(p_attendees) > 500
     or array_position(p_attendees, null) is not null then
    raise exception 'Проверьте список присутствовавших.';
  end if;

  select * into e from public.evenings where id = p_evening for update;
  if not found or e.status = 'cancelled' or e.starts_at > now() then
    raise exception 'Посещаемость доступна после начала неотменённого вечера.';
  end if;

  select coalesce(array_agg(distinct id order by id), '{}') into requested_ids
    from unnest(p_attendees) as requested(id);
  if (select count(*) from public.players where id = any(requested_ids)) <> cardinality(requested_ids) then
    raise exception 'Проверьте список присутствовавших.';
  end if;

  select revision into current_revision from public.evening_attendance_logs where evening_id = p_evening;
  if current_revision is not null then
    select coalesce(array_agg(player_id order by player_id), '{}') into previous_ids
      from public.evening_attendees where evening_id = p_evening;
    if previous_ids = requested_ids then return current_revision; end if;
  end if;
  if coalesce(current_revision, 0) <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Журнал изменён в другом окне. Обновите страницу.';
  end if;

  insert into public.evening_attendance_logs as log (evening_id) values (p_evening)
    on conflict (evening_id) do update set revision = log.revision + 1, recorded_at = now()
    returning revision into current_revision;
  delete from public.evening_attendees
    where evening_id = p_evening and not (player_id = any(requested_ids));
  insert into public.evening_attendees(evening_id, player_id)
    select p_evening, id from unnest(requested_ids) as requested(id)
    on conflict do nothing;
  return current_revision;
end $$;

create function public.my_evening_attendance(
  p_player uuid, p_offset integer default 0, p_start_day date default null, p_end_day date default null
)
returns table(id uuid, "startsAt" timestamptz, place text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.starts_at, e.place
  from public.evening_attendees a
  join public.evenings e on e.id = a.evening_id
  where public.owns_player(p_player)
    and a.player_id = p_player and e.status <> 'cancelled' and e.starts_at <= now()
    and (p_start_day is null or e.starts_at >= (p_start_day::timestamp at time zone 'Europe/Vienna'))
    and (p_end_day is null or e.starts_at < (p_end_day::timestamp at time zone 'Europe/Vienna'))
  order by e.starts_at desc, e.id desc
  limit 13 offset greatest(p_offset, 0)
$$;

revoke all on function public.save_evening_attendance(uuid, integer, uuid[]),
  public.my_evening_attendance(uuid, integer, date, date) from public, anon, authenticated;
grant execute on function public.save_evening_attendance(uuid, integer, uuid[]),
  public.my_evening_attendance(uuid, integer, date, date) to authenticated;

notify pgrst, 'reload schema';
commit;
