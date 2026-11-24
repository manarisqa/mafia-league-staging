#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
stack=${QA_STACK_NAME:-mafia-engineering-b}
db=$stack-db
[[ $(docker inspect --format '{{index .Config.Labels "mafia.synthetic"}}' "$db") == "$stack" ]] ||
  { echo "This test requires the labelled local synthetic stack" >&2; exit 2; }
mode=${1:-current}
[[ $mode == current || $mode == upgrade ]] || exit 2

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
sandbox=$(docker exec "$db" mktemp -d)
target=qa_restore_$(basename "$sandbox" | tr -cd 'a-zA-Z0-9')
psql_local() { docker exec -i "$db" psql -qX -U postgres -v ON_ERROR_STOP=1 "$@"; }
archive() { docker exec -e PGUSER=postgres -e PGDATABASE=postgres "$db" bash "$sandbox/club-backup.sh" "$@"; }
data() { psql_local -d "$1" -At -f - < scripts/club-fingerprint.sql; }
skill() { psql_local -d "$1" -Atc 'select public.league_snapshot()' | node --import tsx scripts/club-skill.ts; }

# Historical sentinel has a linked Auth owner and official game; guided
# history, cancellation receipts and versions are populated by browser tests.
psql_local <<'SQL'
insert into public.referee_protocols(id, owner_id, payload, checksum,
  approved_game_id, approved_game_revision, approved_at, approval)
select 'qa-backup-historical', u.id,
  '{"schema":"mafia-league-referee-protocol-v1","title":"Synthetic archive","format":"classic10","events":[]}',
  repeat('a',64), g.id,g.revision,g.finished_at,'{"fixture":true}'
from (select user_id as id from public.admins order by user_id limit 1) u
cross join (select id,revision,finished_at from public.games where format='classic10' order by id limit 1) g
on conflict (id) do nothing;
SQL

docker cp scripts/club-backup.sh "$db:$sandbox/club-backup.sh"
bundle=$sandbox/backup
data postgres > "$work/source.rows"
skill postgres > "$work/source.skill"
archive backup "$bundle"
docker exec "$db" createdb -U postgres --template=template0 "$target"
archive restore-empty "$bundle" "$target"
data "$target" > "$work/restore.rows"
skill "$target" > "$work/restore.skill"
diff -u "$work/source.rows" "$work/restore.rows"
diff -u "$work/source.skill" "$work/restore.skill"

schema() {
  docker exec "$db" pg_dump -U postgres --schema-only -d "$1" |
    sed '/^\\restrict /d; /^\\unrestrict /d'
}
schema postgres > "$work/source.schema"
schema "$target" > "$work/restore.schema"
cmp "$work/source.schema" "$work/restore.schema"
echo "PASS full restore: row IDs and contents, Auth links, protocols, ownership, constraints, RLS, grants and Skill $(cat "$work/restore.skill")"

if archive restore-empty "$bundle" "$target"; then
  echo "Repeated restore was accepted" >&2; exit 1
else
  [[ $? == 3 ]]
fi
docker exec "$db" bash -c 'cp -r "$1" "$2" && printf corrupt >> "$2/club.dump"' -- "$bundle" "$sandbox/corrupt"
if archive verify "$sandbox/corrupt"; then
  echo "Corrupted archive was accepted" >&2; exit 1
fi
echo "PASS duplicate import and corrupted archive rejected"

if [[ $mode == upgrade ]]; then
  psql_local -d "$target" < supabase/migrations/20261124170000_guided_referee_restart.sql >/dev/null
  data "$target" > "$work/upgrade.rows"
  # The pre-migration fixture has no guided drafts. Public/Auth rows must be unchanged.
  diff -u "$work/source.rows" "$work/upgrade.rows"
  skill "$target" > "$work/upgrade.skill"
  diff -u "$work/source.skill" "$work/upgrade.skill"
  echo "PASS additive migration on restored previous schema"
fi

if psql_local -d "$target" -c 'begin; create table public.qa_abort_probe(id int); select 1/0; commit;'; then
  echo "The simulated migration failure was accepted" >&2; exit 1
fi
[[ $(psql_local -d "$target" -Atc "select to_regclass('public.qa_abort_probe') is null") == t ]]
data postgres > "$work/source-after.rows"
diff -u "$work/source.rows" "$work/source-after.rows"
echo "PASS rollback: a failed target transaction left no partial schema, and source remains available"
