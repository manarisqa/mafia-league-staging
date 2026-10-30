-- New signups publish a gaming nickname. Existing player IDs, labels and games
-- are deliberately preserved; legacy accounts can still be linked by admins.
begin;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  nm text;
begin
  nm := normalize(btrim(coalesce(new.raw_user_meta_data ->> 'nickname',
                               new.raw_user_meta_data ->> 'display_name', 'Игрок')), NFC);
  if char_length(nm) not between 1 and 40
     or nm !~ '[[:alnum:]]'
     or nm ~ '[[:cntrl:]<>]'
     or nm ~ U&'[\200B-\200F\202A-\202E\2060-\206F\FEFF]' then
    raise exception 'Invalid gaming nickname' using errcode = '23514';
  end if;

  insert into public.players (user_id, display_name, nickname, status, joined_on)
  values (new.id, nm, nm, 'newbie', current_date);
  return new;
end $$;

-- Trigger use only; the nickname metadata never grants account privileges.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
