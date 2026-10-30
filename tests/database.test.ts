import assert from "node:assert/strict";
import { test, before, after, beforeEach, afterEach } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { database, ADMIN, USER, EVENING, PAST, CLASSIC, SHORT, HOST, rowRevision, seats } from "./support/database";
import { SnapshotSchema, projectLeague } from "../src/lib/league/core";
let db: PGlite;
let userPlayer: string;
before(async () => {
  db = await database(true);
  userPlayer = (await db.query<{ id: string }>("select id from players where user_id=$1", [USER])).rows[0].id;
});
after(async () => db.close());
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });
async function actor(id: string | null) {
  await db.exec(`set local role ${id ? "authenticated" : "anon"}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id ?? ""]);
}
async function reject(sql: string, params: unknown[] = [], message: RegExp = /./) {
  await db.exec("savepoint rejected_write");
  await assert.rejects(async () => {
    await db.query(sql, params);
    await db.exec("set constraints all immediate");
  }, message);
  await db.exec("rollback to savepoint rejected_write; release savepoint rejected_write");
}
async function reopen() {
  const rev = await rowRevision(db, "games", CLASSIC);
  await actor(ADMIN);
  return Number((await db.query<{ rev: number }>("select reopen_game($1,$2) as rev", [CLASSIC, rev])).rows[0].rev);
}
async function snapshot() {
  return SnapshotSchema.parse((await db.query<{ state: unknown }>("select league_snapshot() as state")).rows[0].state);
}

test("signup publishes nickname in every projection and creates no administrator", async () => {
  const id = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  await db.query("insert into auth.users values($1,'private-name@example.invalid',$2)", [id, JSON.stringify({ nickname: "  Мандрівник  ", display_name: "DO NOT PUBLISH" })]);
  const player = (await db.query<{ id: string; display_name: string; nickname: string }>("select * from players where user_id=$1", [id])).rows[0];
  assert.equal(player.display_name, "Мандрівник");
  assert.equal(player.nickname, "Мандрівник");
  await actor(id);
  assert.equal((await db.query<{ admin: boolean }>("select is_admin() as admin")).rows[0].admin, false);
  await actor(null);
  const wire = await snapshot();
  assert.equal(wire.players.find((p) => p.id === player.id)?.display_name, "Мандрівник");
  assert(!JSON.stringify(wire).includes("private-name"));
  assert(projectLeague(wire).stats.has(player.id));
});

test("direct Auth signup cannot bypass invalid-nickname checks or expose email as nickname", async () => {
  const id = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  for (const nickname of ["", "X".repeat(41), "<Ник>", "Сова\u200b", "Fox\n7"]) {
    await reject("insert into auth.users values($1,'private@example.invalid',$2)", [id, JSON.stringify({ nickname })], /Invalid gaming nickname/);
  }
  await db.query("insert into auth.users values($1,'private@example.invalid','{}')", [id]);
  assert.equal((await db.query<{ display_name: string }>("select display_name from players where user_id=$1", [id])).rows[0].display_name, "Игрок");
});

test("nickname length boundary agrees with the existing database column", async () => {
  const id = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  await db.query("insert into auth.users values($1,'private@example.invalid',$2)", [id, JSON.stringify({ nickname: "Я".repeat(40) })]);
  assert.equal((await db.query<{ nickname: string }>("select nickname from players where user_id=$1", [id])).rows[0].nickname, "Я".repeat(40));
});

test("isolated preview seed is complete, synthetic, future usable and refuses a second import", async () => {
  const preview = await database(false, false, true);
  try {
    const wire = SnapshotSchema.parse((await preview.query<{ data: unknown }>("select league_snapshot() as data")).rows[0].data);
    assert.equal(wire.games.length, 25);
    const league = projectLeague(wire);
    assert.equal(league.ratings.predictions.length, 20);
    assert(wire.evenings.some((e) => e.status === "planned" && Date.parse(e.starts_at) > Date.now()));
    assert(wire.players.some((p) => p.display_name === "Мандрівник"));
    assert(!JSON.stringify(wire).includes("PRIVATE SYNTHETIC"));
    await assert.rejects(preview.exec(readFileSync("supabase/preview-seed.sql", "utf8")), /empty isolated database/);
    await preview.exec("rollback");
    assert.equal((await preview.query<{ n: number }>("select count(*)::int as n from games")).rows[0].n, 25);
  } finally { await preview.close(); }
});

test("upgrade preserves note in admin-only table and removes public column", async () => {
  await actor(ADMIN);
  assert.equal((await db.query<{ note: string }>("select note from evening_notes where evening_id=$1", [EVENING])).rows[0].note, "PRIVATE TEST NOTE");
  await actor(null);
  assert.equal((await db.query("select * from evening_notes")).rows.length, 0);
  await reject("select note from evenings", [], /does not exist/);
  const wire = JSON.stringify(await snapshot());
  assert(!wire.includes("PRIVATE TEST NOTE")); assert(!wire.includes("user_id"));
});
test("anonymous snapshot contains completed games and never draft roles", async () => {
  await reopen();
  await actor(null);
  assert.equal((await db.query("select * from game_players where game_id=$1", [CLASSIC])).rows.length, 0);
  assert.deepEqual((await snapshot()).games.map((g) => g.id), [SHORT]);
});
test("ordinary account cannot save games, read notes or mutate club revision", async () => {
  const rev = await rowRevision(db, "games", CLASSIC);
  await actor(USER);
  await reject("select reopen_game($1,$2)", [CLASSIC, rev], /администратора/);
  await reject("update club_revision set revision=0", [], /permission denied/);
  assert.equal((await db.query("select * from evening_notes")).rows.length, 0);
});
test("admin table mutations cannot bypass versioned game/evening/RSVP RPCs", async () => {
  await actor(ADMIN);
  for (const sql of ["delete from games", "delete from game_players", "update evenings set place='X'", "delete from evening_signups", "update evening_notes set note='X'"]) await reject(sql, [], /permission denied/);
  await reject("select save_game($1,null,'[]',null,false)", [CLASSIC], /does not exist/);
});
test("privileged direct INSERT cannot commit an empty completed game", async () => {
  await reject("insert into games(evening_id,game_no,format,status,winner,host_player_id) values($1,99,'classic10','finished','red',$2)", [EVENING, HOST], /неверный состав/);
});
test("completed game validates role edits, format edits, deletes and host changes", async () => {
  await reject("update game_players set role='don' where game_id=$1 and seat=1", [CLASSIC], /неверный состав/);
  await reject("update games set format='short9',rules_version='club-short9-no-first-shot-v1' where id=$1", [CLASSIC], /неверный состав/);
  await reject("delete from game_players where game_id=$1 and seat=1", [CLASSIC], /неверный состав/);
  await reject("update games set host_player_id=null where id=$1", [CLASSIC], /ведущего/);
  await reject("update games set host_player_id=(select player_id from game_players where game_id=$1 and seat=1) where id=$1", [CLASSIC], /Ведущий/);
});
test("RPC requires host and rolls back invalid composition without losing draft", async () => {
  const initialSeats = await seats(db);
  const rev = await reopen();
  await reject("select save_game($1,null,$2,'red',true,$3)", [CLASSIC, JSON.stringify(initialSeats), rev], /ведущего/);
  await reject("select save_game($1,$2,$3,'red',true,$4)", [CLASSIC, HOST, JSON.stringify(initialSeats.slice(1)), rev], /неверный состав/);
  assert.deepEqual(await seats(db), initialSeats);
  assert.equal(await rowRevision(db, "games", CLASSIC), rev);
});
test("valid finish, audit history and stale-editor rejection are transactional", async () => {
  const rows = await seats(db);
  const rev = await reopen();
  await db.query("select save_game($1,$2,$3,'red',true,$4)", [CLASSIC, HOST, JSON.stringify(rows), rev]);
  const saved = await rowRevision(db, "games", CLASSIC);
  assert(saved > rev);
  await reject("select reopen_game($1,$2)", [CLASSIC, rev], /другом окне/);
  assert.equal(await rowRevision(db, "games", CLASSIC), saved);
  const audit = await db.query("select * from club_audit where table_name='games' and record_id=$1", [CLASSIC]);
  assert(audit.rows.length >= 2);
  await db.exec("set constraints all immediate");
});
test("technical results and removals need reasons and remain outside Skill", async () => {
  const rows = await seats(db);
  let rev = await reopen();
  await reject("select save_game($1,$2,$3,'red',true,$4,'technical','')", [CLASSIC, HOST, JSON.stringify(rows), rev], /причину/);
  await db.query("select save_game($1,$2,$3,'red',true,$4,'technical','Решение ведущего')", [CLASSIC, HOST, JSON.stringify(rows), rev]);
  assert.equal(projectLeague(await snapshot()).ratings.predictions.length, 0);
  rev = Number((await db.query<{ rev: number }>("select reopen_game($1,$2) as rev", [CLASSIC, await rowRevision(db, "games", CLASSIC)])).rows[0].rev);
  rows[0].removed = true;
  await db.query("select save_game($1,$2,$3,'red',true,$4,'normal','Удаление игрока')", [CLASSIC, HOST, JSON.stringify(rows), rev]);
  assert.equal(projectLeague(await snapshot()).ratings.predictions.length, 0);
});
test("finished game in an open evening is present in snapshot, history input and Skill", async () => {
  await db.query("update evenings set status='planned' where id=$1", [PAST]);
  await actor(null);
  const league = projectLeague(await snapshot());
  assert.equal(league.games.length, 2);
  assert.equal(league.ratings.predictions.length, 1);
  for (const g of league.games) assert.equal(g.played_at, "2026-10-31T18:00:00+00:00");
});
test("cancelled evenings and voided games disappear from every projection", async () => {
  await db.query("update games set voided=true where id=$1", [CLASSIC]);
  await actor(null);
  assert.deepEqual((await snapshot()).games.map((g) => g.id), [SHORT]);
  await actor(ADMIN);
  await db.exec("reset role");
  await db.query("update evenings set status='cancelled' where id=$1", [PAST]);
  await actor(null);
  assert.equal((await snapshot()).games.length, 0);
});
test("game numbers allocated under evening lock, duplicate numbers rejected", async () => {
  await actor(ADMIN);
  const a = (await db.query<{ id: string }>("select create_game($1,'classic10') as id", [EVENING])).rows[0].id;
  const b = (await db.query<{ id: string }>("select create_game($1,'short9') as id", [EVENING])).rows[0].id;
  assert.notEqual(a, b);
  assert.deepEqual((await db.query<{ game_no: number }>("select game_no from games where id in ($1,$2) order by game_no", [a, b])).rows.map((g) => g.game_no), [1, 2]);
});
test("evening deletion locks and refuses any existing games", async () => {
  const rev = await rowRevision(db, "evenings", PAST);
  await actor(ADMIN);
  await reject("select delete_evening($1,$2)", [PAST, rev], /с партиями/);
});
test("evening saves are atomic with notes; stale note/metadata changes rejected", async () => {
  const e = (await db.query<{ starts_at: Date; revision: number; season_id: string }>("select * from evenings where id=$1", [EVENING])).rows[0];
  await actor(ADMIN);
  const params = [EVENING, e.revision, e.starts_at.toISOString(), "New place", 10, "planned", HOST, "NEW PRIVATE NOTE", e.season_id];
  await db.query("select save_evening($1,$2,$3,$4,$5::smallint,$6,$7,$8,$9)", params);
  params[7] = "STALE NOTE";
  await reject("select save_evening($1,$2,$3,$4,$5::smallint,$6,$7,$8,$9)", params, /другом окне/);
  assert.equal((await db.query<{ note: string }>("select note from evening_notes where evening_id=$1", [EVENING])).rows[0].note, "NEW PRIVATE NOTE");
});
test("own RSVP supports every existing status and cancellation, but not another player's", async () => {
  await actor(USER);
  let rev = 0;
  for (const status of ["going", "late", "maybe", "not_going"]) {
    rev = Number((await db.query<{ rev: number }>("select set_rsvp($1,$2,$3,$4) as rev", [EVENING, userPlayer, status, rev])).rows[0].rev);
    assert(rev > 0);
  }
  await reject("select set_rsvp($1,$2,'going',0)", [EVENING, HOST], /только свою/);
  await db.query("select set_rsvp($1,$2,'cancel',$3)", [EVENING, userPlayer, rev]);
  assert.equal((await db.query("select * from evening_signups where player_id=$1", [userPlayer])).rows.length, 0);
});
test("RSVP rejects stale updates, delete/recreate ABA and full-table admission", async () => {
  await actor(USER);
  const rev = Number((await db.query<{ rev: number }>("select set_rsvp($1,$2,'going',0) as rev", [EVENING, userPlayer])).rows[0].rev);
  await db.query("select set_rsvp($1,$2,'cancel',$3)", [EVENING, userPlayer, rev]);
  const recreated = Number((await db.query<{ rev: number }>("select set_rsvp($1,$2,'going',0) as rev", [EVENING, userPlayer])).rows[0].rev);
  assert(recreated > rev);
  await reject("select set_rsvp($1,$2,'late',$3)", [EVENING, userPlayer, rev], /другом окне/);
  await db.exec("reset role");
  await db.query("insert into evening_signups(evening_id,player_id,status) select $1,id,'going' from players where id not in(select player_id from evening_signups where evening_id=$1) and user_id is null order by id limit 3", [EVENING]);
  await db.exec("set constraints all immediate; set constraints all deferred");
  await actor(ADMIN);
  const other = (await db.query<{ id: string }>("select id from players where id not in(select player_id from evening_signups where evening_id=$1) order by id limit 1", [EVENING])).rows[0].id;
  await reject("select set_rsvp($1,$2,'late',0)", [EVENING, other], /места заняты/);
  await db.query("select set_rsvp($1,$2,'maybe',0)", [EVENING, other]);
});
for (const status of ["finished", "cancelled", "past"] as const) test(`RSVP insert/update/delete blocked for ${status} evening, including admin`, async () => {
  await db.query("insert into evening_signups(evening_id,player_id,status) values($1,$2,'going')", [EVENING, userPlayer]);
  const rev = Number((await db.query<{ revision: number }>("select revision from evening_signups where evening_id=$1 and player_id=$2", [EVENING, userPlayer])).rows[0].revision);
  if (status === "past") await db.query("update evenings set starts_at=now()-interval '1 day' where id=$1", [EVENING]);
  else await db.query("update evenings set status=$2 where id=$1", [EVENING, status]);
  for (const user of [USER, ADMIN]) {
    await actor(user);
    for (const value of ["late", "cancel"]) await reject("select set_rsvp($1,$2,$3,$4)", [EVENING, userPlayer, value, rev], /Запись закрыта/);
  }
});
test("account linking retains historical identity and transfers existing RSVP", async () => {
  const historical = "00000000-0000-0000-0000-000000000101";
  await actor(USER);
  await db.query("select set_rsvp($1,$2,'maybe',0)", [EVENING, userPlayer]);
  await actor(ADMIN);
  await db.query("select link_account($1,$2,$3,$4)", [historical, userPlayer, Number((await db.query<{revision:number}>("select revision from players where id=$1",[historical])).rows[0].revision), Number((await db.query<{revision:number}>("select revision from players where id=$1",[userPlayer])).rows[0].revision)]);
  assert.equal((await db.query<{ user_id: string }>("select user_id from players where id=$1", [historical])).rows[0].user_id, USER);
  assert.equal((await db.query("select * from players where id=$1", [userPlayer])).rows.length, 0);
  await db.exec("set constraints all immediate");
});
test("migration supports clean database plus current seed", async () => {
  const clean = await database();
  try { assert.equal((await clean.query<{ n: number }>("select count(*)::int as n from games")).rows[0].n, 2); }
  finally { await clean.close(); }
});

test("player editing and linking use versions and cannot discard recorded game history", async () => {
  const id="00000000-0000-0000-0000-000000000101";
  const rev=Number((await db.query<{revision:number}>("select revision from players where id=$1",[id])).rows[0].revision);
  await actor(ADMIN);
  await db.query("select save_player($1,$2,'Updated name','Nick','club_member')",[id,rev]);
  await reject("select save_player($1,$2,'Stale name','','newbie')",[id,rev],/другом окне/);
  await reject("select link_account($1,$2,$3,$4)",[id,userPlayer,rev,1],/изменён/);
  const fresh=Number((await db.query<{revision:number}>("select revision from players where id=$1",[id])).rows[0].revision);
  await reject("select delete_player($1,$2)",[id,fresh],/Нельзя удалить/);
  await reject("update players set display_name='bypass' where id=$1",[id],/permission denied/);
});

test("complete valid transaction passes deferred checks even when parent is inserted first", async () => {
  const g="30000000-0000-0000-0000-000000000001";
  await db.query("insert into games(id,evening_id,game_no,format,status,winner,host_player_id) values($1,$2,99,'classic10','finished','red',$3)",[g,EVENING,HOST]);
  await db.query("insert into game_players(game_id,seat,player_id,role) select $1,seat,player_id,role from game_players where game_id=$2",[g,CLASSIC]);
  await db.exec("set constraints all immediate");
  assert.equal((await db.query<{n:number}>("select count(*)::int as n from game_players where game_id=$1",[g])).rows[0].n,10);
});
test("capacity reduction rolls back evening fields and private note together", async () => {
  await db.query("insert into evening_signups(evening_id,player_id,status) select $1,id,'going' from players where id not in(select player_id from evening_signups where evening_id=$1) order by id limit 4",[EVENING]);
  const e=(await db.query<{revision:number;starts_at:Date;season_id:string}>("select * from evenings where id=$1",[EVENING])).rows[0];
  await actor(ADMIN);
  await reject("select save_evening($1,$2,$3,'Changed',9::smallint,'planned',$4,'SHOULD ROLLBACK',$5)",[EVENING,e.revision,e.starts_at.toISOString(),HOST,e.season_id],/места заняты/);
  assert.equal(await rowRevision(db,"evenings",EVENING),Number(e.revision));
  assert.equal((await db.query<{note:string}>("select note from evening_notes where evening_id=$1",[EVENING])).rows[0].note,"PRIVATE TEST NOTE");
});
for(const problem of ["composition","capacity"] as const) test(`migration fails atomically on historical ${problem} corruption`,async()=>{
  const old=await database(false,true);
  try {
    await old.query("update evenings set note='PRESERVE ORIGINAL NOTE' where id=$1",[EVENING]);
    if(problem==="composition") await old.query("update game_players set role='don' where game_id=$1 and seat=1",[CLASSIC]);
    else await old.query("insert into evening_signups(evening_id,player_id,status) select $1,id,'going' from players on conflict(evening_id,player_id) do update set status='going'",[EVENING]);
    await assert.rejects(old.exec(readFileSync("supabase/migrations/20261030030000_league_core.sql","utf8")),problem==="composition"?/неверный состав/:/места заняты/);
    await old.exec("rollback");
    assert.equal((await old.query<{note:string}>("select note from evenings where id=$1",[EVENING])).rows[0].note,"PRESERVE ORIGINAL NOTE");
    assert.equal((await old.query<{name:string|null}>("select to_regclass('public.evening_notes') as name")).rows[0].name,null);
  } finally { await old.close(); }
});
