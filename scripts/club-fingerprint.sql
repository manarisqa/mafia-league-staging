-- Run during a write freeze. Emits counts and digests, never table contents.
begin isolation level repeatable read read only;
set local timezone = 'UTC';
set local datestyle = 'ISO, YMD';
set local intervalstyle = 'iso_8601';
set local extra_float_digits = 3;
select format(
  'select %L, count(*), encode(sha256(convert_to(coalesce(string_agg(digest, '''' order by digest), ''''), ''UTF8'')), ''hex'')
     from (select encode(sha256(convert_to(to_jsonb(t)::text, ''UTF8'')), ''hex'') as digest from %I.%I t) rows',
  schemaname || '.' || tablename, schemaname, tablename)
from pg_tables where schemaname in ('public', 'auth')
order by schemaname, tablename
\gexec
commit;
