import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import { analyticsRange, ClubAnalyticsSchema } from "../src/lib/club-analytics";
import { ADMIN, CLASSIC, PAST, SHORT, USER, database } from "./support/database";

let db: PGlite;

before(async () => { db = await database(true); });
after(async () => { await db?.close(); });
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });

async function actor(id: string | null) {
  await db.exec(`set local role ${id ? "authenticated" : "anon"}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id ?? ""]);
}

async function rejected(from: string | null, to: string | null, error: RegExp) {
  await db.exec("savepoint analytics_error");
  try {
    await assert.rejects(() => analytics(from, to), error);
  } finally {
    await db.exec("rollback to savepoint analytics_error; release savepoint analytics_error");
  }
}

async function analytics(from: string | null, to: string | null) {
  const wire = await db.query<{ data: unknown }>("select public.club_analytics($1,$2) as data", [from, to]);
  return ClubAnalyticsSchema.parse(wire.rows[0].data);
}

function fixturePlayer(index: number) {
  return "00000000-0000-0000-0000-0000000001" + String(index).padStart(2, "0");
}

async function evening(startsAt: string, status = "finished") {
  const result = await db.query<{ id: string }>(
    "insert into public.evenings(starts_at, place, status) values($1,'Synthetic analytics', $2) returning id",
    [startsAt, status],
  );
  return result.rows[0].id;
}

async function attendance(id: string, people: number[]) {
  await actor(ADMIN);
  await db.query("select public.save_evening_attendance($1,0,$2::uuid[])", [id, people.map(fixturePlayer)]);
  await db.exec("reset role");
}

test("analytics date input uses local calendar days across midnight and rejects oversized or invalid ranges", () => {
  const now = new Date("2026-12-31T23:30:00Z");
  const defaults = analyticsRange(undefined, undefined, now);
  assert.deepEqual(defaults.range, { from: "2026-10-04", to: "2027-01-15" });
  assert.equal(defaults.invalid, false);
  assert.deepEqual(analyticsRange("2024-01-01", "2024-12-31", now).range, { from: "2024-01-01", to: "2024-12-31" });
  for (const [from, to] of [
    ["2024-01-01", "2025-01-01"],
    ["2025-03-01", "2025-02-28"],
    ["2025-02-29", "2025-03-01"],
    ["2025-02-28", undefined],
    [["2024-01-01", "2024-02-01"], "2024-03-01"],
  ]) {
    assert.deepEqual(analyticsRange(from, to, now), { ...defaults, invalid: true });
  }
});

test("analytics requires club admin and independently rejects bad ranges at the database boundary", async () => {
  await actor(null);
  await rejected("2024-01-01", "2024-01-02", /permission denied/);
  await actor(USER);
  await rejected("2024-01-01", "2024-01-02", /administrator required/);
  await actor(ADMIN);
  for (const [from, to] of [[null, "2024-01-02"], ["-infinity", "2024-01-02"], ["2024-01-01", "2025-01-01"]]) {
    await rejected(from, to, /366 calendar days/);
  }
  const empty = await analytics("2024-01-01", "2024-12-31");
  assert.deepEqual(empty.evenings, { scheduled: 0, upcoming: 0, held: 0, cancelled: 0, unresolved: 0, recorded: 0, visits: null });
});

test("Vienna evening date anchors game totals and absent rosters preserve unknown attendance", async () => {
  await db.query("update public.evenings set starts_at = '2024-10-31 23:30:00+00' where id=$1", [PAST]);
  await actor(ADMIN);
  const justBefore = await analytics("2024-10-31", "2024-10-31");
  assert.equal(justBefore.evenings.scheduled, 0);
  const report = await analytics("2024-11-01", "2024-11-01");
  assert.deepEqual(report.evenings, { scheduled: 1, upcoming: 0, held: 1, cancelled: 0, unresolved: 0, recorded: 0, visits: null });
  assert.deepEqual(report.games, { classic10: 1, short9: 1, players: 10 });
  assert.deepEqual(report.months, [{ month: "2024-11", held: 1, recorded: 0, visits: null, games: 2 }]);
  assert.equal(report.recent[0].attendance, null);
  assert(!JSON.stringify(report).includes("PRIVATE TEST NOTE"));
  assert(!JSON.stringify(report).includes(fixturePlayer(1)));

  await db.exec("reset role");
  await db.query("update public.games set voided=true where id=$1", [SHORT]);
  await db.query("update public.games set status='in_progress',winner=null where id=$1", [CLASSIC]);
  await actor(ADMIN);
  assert.deepEqual((await analytics("2024-11-01", "2024-11-01")).games, { classic10: 0, short9: 0, players: 0 });
});

test("roster coverage, repeated visits and RSVP matches use only their own denominators", async () => {
  const prior = await evening("2025-01-01 18:00+01");
  const first = await evening("2025-01-10 18:00+01", "planned");
  const second = await evening("2025-01-15 18:00+01");
  const zero = await evening("2025-01-20 18:00+01");
  await evening("2025-01-13 18:00+01", "cancelled");
  await evening("2025-01-18 18:00+01", "planned");
  const followup = await evening("2025-02-02 18:00+01");
  await db.query(`insert into public.evening_signups(evening_id,player_id,status) values
    ($1,$2,'going'),($1,$3,'late'),($1,$4,'maybe'),($1,$5,'going'),($6,$2,'going')`,
    [first, fixturePlayer(1), fixturePlayer(2), fixturePlayer(3), fixturePlayer(4), zero],
  );
  await attendance(prior, [1]);
  await attendance(first, [1, 2]);
  await attendance(second, [2, 3]);
  await attendance(zero, []);
  await attendance(followup, [3]);

  await actor(ADMIN);
  const report = await analytics("2025-01-10", "2025-01-20");
  assert.deepEqual(report.evenings, { scheduled: 5, upcoming: 0, held: 3, cancelled: 1, unresolved: 1, recorded: 3, visits: 4 });
  assert.deepEqual(report.rsvp, { confirmed: 4, matched: 2 });
  assert.deepEqual(report.people, { unique: 3, first: 2, returning: 1, eligible: 2, returned: 2, gaps: 2, medianDays: 7 });
  assert.equal(report.recent[0].attendance, 0);
  assert.equal(report.recent[0].confirmed, 1);
  assert.equal(report.recent[0].matched, 0);

  await db.exec("reset role");
  await evening("2025-01-31 19:00+01");
  await actor(ADMIN);
  const incomplete = await analytics("2025-01-10", "2025-01-20");
  assert.equal(incomplete.people.eligible, 0);
  assert.equal(incomplete.people.returned, 0);
  assert.equal(incomplete.people.first, 2);
});

test("recent detail has a fixed limit and unfinished evenings do not inflate held totals", async () => {
  await db.exec(`
    insert into public.evenings(starts_at,place,status)
    select timestamp '2025-03-01 19:00' at time zone 'Europe/Vienna' + d * interval '1 day', 'Synthetic analytics', 'finished'
    from generate_series(0,14) d;
    insert into public.evenings(starts_at,place,status)
    values (now() + interval '1 day', 'Synthetic future', 'planned');`);
  await actor(ADMIN);
  const history = await analytics("2025-03-01", "2025-03-31");
  assert.equal(history.evenings.held, 15);
  assert.equal(history.recent.length, 12);
  assert.equal(history.recent.at(-1)?.starts_at.slice(0, 10), "2025-03-04");
  const today = analyticsRange(undefined, undefined).range;
  assert.equal((await analytics(today.from, today.to)).evenings.upcoming, 1);
});
