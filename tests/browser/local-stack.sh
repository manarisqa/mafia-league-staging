#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
stack=${QA_STACK_NAME:-mafia-engineering-b}
[[ $stack =~ ^mafia-[a-z0-9-]+$ ]] || exit 2
db=$stack-db
auth=$stack-auth
rest=$stack-rest
network=$stack-net

if [[ ${1:-} == stop ]]; then
  for container in "$rest" "$auth" "$db"; do
    if [[ $(docker inspect --format '{{index .Config.Labels "mafia.synthetic"}}' "$container" 2>/dev/null || true) == "$stack" ]]; then
      docker rm -f -v "$container" >/dev/null
    fi
  done
  if [[ $(docker network inspect --format '{{index .Labels "mafia.synthetic"}}' "$network" 2>/dev/null || true) == "$stack" ]]; then
    docker network rm "$network" >/dev/null
  fi
  exit
fi
[[ ${1:-} == start ]] || { echo "Usage: $0 start|stop" >&2; exit 2; }

auth_port=${QA_AUTH_PORT:-55421}
rest_port=${QA_REST_PORT:-55422}
jwt_secret=synthetic-mafia-engineering-b-jwt-key-local-only
pg_password=synthetic-mafia-pg
password=${QA_PASSWORD:-Synthetic-QA-Only-2026}
db_url=postgres://postgres:$pg_password@db:5432/postgres

token() {
  node --input-type=module - "$1" "$jwt_secret" <<'JS'
import { createHmac } from "node:crypto";
const [role, secret] = process.argv.slice(2);
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const body = encode({ alg: "HS256", typ: "JWT" }) + "." + encode({ role, exp: 2147483647 });
console.log(body + "." + createHmac("sha256", secret).update(body).digest("base64url"));
JS
}

wait_for() {
  for ((i = 0; i < 60; i++)); do
    if "$@"; then return; fi
    sleep 1
  done
  echo "Local service did not become ready" >&2
  return 1
}
psql_local() { docker exec -i "$db" psql -qX -U postgres -v ON_ERROR_STOP=1 "$@"; }

docker network create --label "mafia.synthetic=$stack" "$network" >/dev/null
docker run -d --name "$db" --label "mafia.synthetic=$stack" --network "$network" --network-alias db \
  -e POSTGRES_PASSWORD="$pg_password" postgres:16.16 >/dev/null
wait_for docker exec "$db" pg_isready -q -h 127.0.0.1 -U postgres
psql_local <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
grant usage on schema auth,public to anon,authenticated,service_role;
alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated,service_role;
alter default privileges in schema public grant usage,select on sequences to anon,authenticated,service_role;
SQL

docker run -d --name "$auth" --label "mafia.synthetic=$stack" --network "$network" \
  -p "127.0.0.1:$auth_port:9999" -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 \
  -e API_EXTERNAL_URL="http://127.0.0.1:$auth_port" -e GOTRUE_SITE_URL=http://127.0.0.1:55420 \
  -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="$db_url?search_path=auth" -e DB_NAMESPACE=auth \
  -e "GOTRUE_JWT_SECRET=$jwt_secret" -e GOTRUE_JWT_ADMIN_ROLES=service_role -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
  -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
  supabase/gotrue:v2.177.0 >/dev/null
wait_for curl -fs -o /dev/null "http://127.0.0.1:$auth_port/health"

for file in supabase/migrations/*.sql; do
  if [[ ${QA_BEFORE_RESTART_MIGRATION:-0} == 1 && $file == *guided_referee_restart.sql ]]; then break; fi
  psql_local < "$file" >/dev/null
done
psql_local < supabase/preview-seed.sql >/dev/null
service_key=$(token service_role)
for email in "${QA_ADMIN_EMAIL:-qa-admin@example.test}" "${QA_PLAYER_EMAIL:-qa-player@example.test}"; do
  body=$(node -e 'console.log(JSON.stringify({email:process.argv[1],password:process.argv[2],email_confirm:true,user_metadata:{nickname:process.argv[3]}}))' \
    "$email" "$password" "${email%@*}")
  curl -fsS -o /dev/null -H "Authorization: Bearer $service_key" -H "Content-Type: application/json" \
    --data "$body" "http://127.0.0.1:$auth_port/admin/users"
done
psql_local -v admin_email="${QA_ADMIN_EMAIL:-qa-admin@example.test}" <<'SQL'
insert into public.admins(user_id) select id from auth.users where email = :'admin_email';
SQL

docker run -d --name "$rest" --label "mafia.synthetic=$stack" --network "$network" \
  -p "127.0.0.1:$rest_port:3000" -e "PGRST_DB_URI=$db_url" -e PGRST_DB_SCHEMA=public \
  -e PGRST_DB_ANON_ROLE=anon -e "PGRST_JWT_SECRET=$jwt_secret" \
  postgrest/postgrest:v12.2.3 >/dev/null
wait_for curl -fs -o /dev/null "http://127.0.0.1:$rest_port/"
printf 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:%s\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=%s\n' \
  "${QA_GATEWAY_PORT:-55423}" "$(token anon)"
