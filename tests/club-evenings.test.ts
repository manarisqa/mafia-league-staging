import assert from "node:assert/strict";
import test from "node:test";
import { eveningReadiness } from "../src/lib/evening-roster";
import { eveningReturn } from "../src/lib/evening-return";
import { ADMIN, EVENING, HOST, PAST, USER, database } from "./support/database";

test("one table requires a separate host and the right number of confirmed players", () => {
  const players = Array.from({ length: 10 }, (_, i) => String(i));
  assert.deepEqual(eveningReadiness(10, "host", [...players.slice(0, 9), "host", "host"]), {
    confirmed: 9, missing: 1, hasHost: true, ready: false,
  });
  assert.equal(eveningReadiness(9, "host", [...players.slice(0, 9), "host"]).ready, true);
  assert.equal(eveningReadiness(10, null, players).ready, false);
  assert.deepEqual(eveningReadiness(9, "host", players), {
    confirmed: 10, missing: 0, hasHost: true, ready: true,
  });
});

test("invite auth return allows only a local evening detail route", () => {
  assert.equal(eveningReturn(`/evenings/${EVENING.toUpperCase()}`), `/evenings/${EVENING}`);
  for (const value of ["//example.test", "https://example.test", "/admin", "/evenings/../admin",
    `/evenings/${EVENING}?next=/admin`, [`/evenings/${EVENING}`], null]) {
    assert.equal(eveningReturn(value), undefined);
  }
});

test("actual attendance has private, revisioned rosters independent of RSVP and Skill", async () => {
  const db = await database();
  const counts = async () => (await db.query<{ logs: number; attendees: number }>(
    "select (select count(*)::int from evening_attendance_logs) as logs, (select count(*)::int from evening_attendees) as attendees",
  )).rows[0];
  const revision = async (expected: number, attendees: string[], evening = PAST) => (
    await db.query<{ saved: number }>("select save_evening_attendance($1,$2,$3::uuid[]) as saved", [evening, expected, attendees])
  ).rows[0].saved;
  const own = async (id: string, from: string | null = null, until: string | null = null) => (
    await db.query<{ id: string }>("select id from my_evening_attendance($1,0,$2,$3)", [id, from, until])
  ).rows;
  try {
    const { rows: [{ id: player }] } = await db.query<{ id: string }>("select id from players where user_id=$1", [USER]);
    const before = (await db.query("select league_snapshot()")).rows;
    assert.deepEqual(await counts(), { logs: 0, attendees: 0 });

    await db.exec(`set role authenticated; set "request.jwt.claim.sub" = '${USER}';`);
    await assert.rejects(revision(0, [player]), /Нужны права администратора/);
    assert.deepEqual(await own(player), []);
    await db.exec(`set "request.jwt.claim.sub" = '${ADMIN}';`);

    await assert.rejects(revision(0, [player], EVENING), /после начала/);
    await assert.rejects(revision(0, [EVENING]), /список присутствовавших/);
    assert.equal(await revision(0, []), 1);
    assert.deepEqual(await counts(), { logs: 1, attendees: 0 });
    assert.equal(await revision(1, [player, HOST, player]), 2);
    assert.equal(await revision(1, [HOST, player]), 2);
    await assert.rejects(revision(1, [HOST]), /Журнал изменён/);
    assert.deepEqual(await counts(), { logs: 1, attendees: 2 });
    assert.deepEqual((await db.query("select league_snapshot()")).rows, before);

    await db.exec(`set "request.jwt.claim.sub" = '${USER}';`);
    assert.deepEqual(await counts(), { logs: 0, attendees: 0 });
    assert.deepEqual(await own(player), [{ id: PAST }]);
    assert.deepEqual(await own(player, "2099-01-01"), []);
    assert.deepEqual(await own(HOST), []);
    await assert.rejects(db.query("delete from evening_attendees"), /permission denied/);
    await db.exec("reset role");
    await assert.rejects(db.query("update evenings set starts_at = starts_at - interval '1 day' where id=$1", [PAST]), /журналом посещаемости/);
    await db.exec("set role anon");
    await assert.rejects(own(player), /permission denied/);
    await assert.rejects(counts(), /permission denied/);
  } finally {
    await db.close();
  }
});
