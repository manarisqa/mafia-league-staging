#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  cat >&2 <<USAGE
Usage:
  $0 backup NEW_BUNDLE_DIRECTORY
  $0 verify BUNDLE_DIRECTORY
  $0 restore-empty BUNDLE_DIRECTORY EMPTY_DB_NAME

Connection settings come from libpq (e.g. PGSERVICE and PGPASSFILE).
Pre-provision the destination's roles and required extensions on an isolated PostgreSQL cluster.
USAGE
  exit 2
}
[[ $# -ge 2 ]] || usage
bundle=$2

verify() (
  cd -- "$bundle"
  sha256sum --check --strict SHA256SUMS
  # Read and decompress the full archive, including data segments.
  pg_restore --file=/dev/null club.dump
)

case $1 in
  backup)
    [[ $# == 2 ]] || usage
    mkdir -m 700 -- "$bundle"
    (
      cd -- "$bundle"
      pg_dump --format=custom --file=club.dump
      pg_restore --list club.dump > archive-toc.txt
      sha256sum club.dump archive-toc.txt > SHA256SUMS
    )
    verify
    ;;
  verify)
    [[ $# == 2 ]] || usage
    verify
    ;;
  restore-empty)
    [[ $# == 3 && $3 =~ ^[a-zA-Z_][a-zA-Z_0-9]*$ ]] || usage
    verify
    target=$3
    empty=$(psql -X -qAt --dbname="$target" -v ON_ERROR_STOP=1 <<'SQL'
select not exists (
  select 1 from pg_namespace
  where nspname not in ('information_schema','public') and nspname !~ '^pg_'
) and not exists (
  select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
) and not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
);
SQL
)
    [[ $empty == t ]] || { echo "Refusing restore into initialized database: $target" >&2; exit 3; }
    # No --clean, no --create, and no object ownership or grant suppression.
    pg_restore --exit-on-error --single-transaction --dbname="$target" -- "$bundle/club.dump"
    ;;
  *) usage ;;
esac
