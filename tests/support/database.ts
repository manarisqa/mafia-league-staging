import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
export const ADMIN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
export const USER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
export const EVENING = "00000000-0000-0000-0000-0000000000e1";
export const PAST = "00000000-0000-0000-0000-0000000000e0";
export const CLASSIC = "00000000-0000-0000-0000-0000000000f1";
export const SHORT = "00000000-0000-0000-0000-0000000000f2";
export const HOST = "00000000-0000-0000-0000-000000000111";
export async function database(upgrade = false, legacyOnly = false, preview = false) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated;
    alter default privileges in schema public grant usage,select on sequences to anon,authenticated;`);
  for (const file of readdirSync(resolve("supabase/migrations")).sort()) {
    if (legacyOnly && file.startsWith("20261030030000")) {
      await db.exec(readFileSync(resolve("tests/fixtures/pre-sprint-seed.sql"), "utf8"));
      return db;
    }
    if (upgrade && file.startsWith("20261030030000")) {
      await db.exec(readFileSync(resolve("tests/fixtures/pre-sprint-seed.sql"), "utf8"));
      await db.exec(`update public.evenings set note='PRIVATE TEST NOTE' where id='${EVENING}'`);
    }
    await db.exec(readFileSync(resolve("supabase/migrations", file), "utf8"));
  }
  if (!upgrade) await db.exec(readFileSync(resolve(preview ? "supabase/preview-seed.sql" : "supabase/seed.sql"), "utf8"));
  await db.exec(`insert into auth.users values('${ADMIN}','admin@example.invalid','{}'),('${USER}','user@example.invalid','{}');
    insert into public.admins(user_id) values('${ADMIN}');
    update public.evenings set starts_at=now()+interval '30 days' where id='${EVENING}';`);
  return db;
}
export async function rowRevision(db: PGlite, table: "games" | "evenings", id: string) {
  return Number((await db.query<{ revision: number }>(`select revision from public.${table} where id=$1`, [id])).rows[0].revision);
}
export async function seats(db: PGlite, game = CLASSIC) {
  return (await db.query<{ seat: number; player: string; role: string; fouls: number; removed: boolean }>(
    "select seat,player_id as player,role,fouls,removed from game_players where game_id=$1 order by seat", [game])).rows;
}
