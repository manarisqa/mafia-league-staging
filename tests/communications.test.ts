import assert from "node:assert/strict";
import test from "node:test";
import { notificationPreview, simulateTelegram } from "../src/lib/club/communications";
import { ADMIN, database, EVENING, PAST, USER } from "./support/database";

test("Telegram simulation uses Vienna time and calls the mock only for eligible languages", () => {
  const preview = notificationPreview.parse({
    status: "ready", key: "0123456789abcdef".repeat(2), starts_at: "2026-07-12T17:15:00Z",
    place: "Грац", evening_status: "cancelled", capacity: 9, games: 0,
    candidate: 3, duplicates: 1, limited: 0, ru: 0, uk: 2, recorded: 0,
  });
  assert.equal(preview.status, "ready");
  let simulations = 0;
  const drafts = simulateTelegram("change", preview, {
    simulate(draft) {
      simulations++;
      return { ...draft, status: "simulated" };
    },
  });
  assert.equal(simulations, 1);
  assert.deepEqual(drafts.map((draft) => [draft.locale, draft.audienceSize, draft.status]), [["uk", 2, "simulated"]]);
  assert.match(drafts[0].text, /скасовано.*\n.*19:15 \(Europe\/Vienna\)/u);
});

test("private communications gate event eligibility, consent, dry-run deduplication and frequency", async () => {
  const db = await database();
  const actor = (user: string) => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`);
  const one = async (sql: string, args: unknown[] = []) => (await db.query<{ result: unknown }>(sql, args)).rows[0].result;
  const preview = (category: string, key: string | null = null, evening = EVENING) =>
    one("select club_notification_preview($1,$2,$3) as result", [evening, category, key]).then(notificationPreview.parse);
  const categories = ["announcement", "reminder", "ready", "change", "recap"];
  const preferences = (chosen: string[], revision = 0) =>
    one("select save_club_notification_preferences($1,'uk',$2) as result", [chosen, revision]);

  try {
    await db.exec("set role anon");
    await assert.rejects(db.query("select club_member_preferences()"), /permission denied/u);
    await assert.rejects(db.query("select * from club_feedback"), /permission denied/u);
    await actor(USER);
    assert.deepEqual(await one("select club_member_preferences() as result"), { notifications: null, feedback: null });
    await assert.rejects(db.query("select * from club_notification_preferences"), /permission denied/u);
    await assert.rejects(db.query("select * from club_notification_dry_runs"), /permission denied/u);
    await assert.rejects(preview("announcement"), /права администратора/u);
    await assert.rejects(preferences(["invalid"]), /invalid_preferences/u);
    await assert.rejects(preferences([null as unknown as string]), /invalid_preferences/u);
    assert.equal(await preferences(categories), "saved");
    assert.equal(await preferences(categories), "saved");
    assert.equal(await preferences([]), "conflict");

    await actor(ADMIN);
    assert.deepEqual(await one("select club_member_preferences() as result"), { notifications: null, feedback: null });
    const initial = await preview("announcement");
    assert.equal(initial.status, "ready");
    assert.equal(initial.uk, 1);
    assert.equal(initial.recorded, 0);
    assert.deepEqual(await one("select club_notification_log() as result"), []);
    assert.equal((await preview("reminder")).status, "unavailable");
    assert.equal((await preview("recap")).status, "unavailable");

    await db.exec("reset role");
    await db.query("update evenings set starts_at=now()+interval '2 hours',capacity=9,host_player_id=(select id from players where user_id=$2) where id=$1", [EVENING, USER]);
    await db.query("delete from evening_signups where evening_id=$1", [EVENING]);
    await db.query("insert into evening_signups select $1,id,'going' from players where user_id=$2", [EVENING, USER]);
    await db.query("insert into evening_signups select $1,id,'going' from players where user_id is null order by id limit 8", [EVENING]);

    await actor(ADMIN);
    assert.equal((await preview("ready")).status, "unavailable", "host RSVP does not fill a seat");
    assert.equal((await preview("announcement", initial.key)).status, "stale");
    const changed = await preview("change");
    assert.equal(changed.status, "ready");
    assert.equal((await preview("reminder")).status, "ready");

    await db.exec("reset role");
    await db.query("insert into evening_signups select $1,id,'late' from players p where user_id is null and not exists(select from evening_signups s where s.evening_id=$1 and s.player_id=p.id) order by p.id limit 1", [EVENING]);
    await actor(ADMIN);
    const ready = await preview("ready");
    assert.equal(ready.status, "ready");
    const announcement = await preview("announcement");
    assert.equal(announcement.status, "ready");
    const first = await preview("announcement", announcement.key);
    assert.equal(first.status, "ready");
    assert.equal(first.recorded, 1);
    const duplicate = await preview("announcement", announcement.key);
    assert.equal(duplicate.status, "ready");
    assert.equal(duplicate.duplicates, 1);
    assert.equal(duplicate.recorded, 0);
    const second = await preview("ready", ready.key);
    assert.equal(second.status, "ready");
    assert.equal(second.recorded, 1);
    const limited = await preview("reminder");
    assert.equal(limited.status, "ready");
    assert.equal(limited.limited, 1);
    assert.equal(limited.uk, 0);
    const log = await one("select club_notification_log() as result");
    assert.ok(Array.isArray(log));
    assert.equal(log.length, 2);
    assert.doesNotMatch(JSON.stringify(log), /bbbbbbbb|@(example|invalid)|delivered/u);

    await actor(USER);
    assert.equal(await preferences([], 1), "saved");
    await actor(ADMIN);
    const withdrawn = await preview("ready");
    assert.equal(withdrawn.status, "ready");
    assert.equal(withdrawn.candidate, 0);

    await db.exec("reset role");
    await db.query("update evenings set status='cancelled' where id=$1", [EVENING]);
    await db.query("update evenings set starts_at=now()-interval '1 day' where id=$1", [PAST]);
    await actor(ADMIN);
    assert.equal((await preview("reminder")).status, "unavailable");
    const cancellation = await preview("change");
    assert.equal(cancellation.status, "ready");
    assert.equal(cancellation.evening_status, "cancelled");
    const recap = await preview("recap", null, PAST);
    assert.equal(recap.status, "ready");
    assert.equal(recap.games, 2);
  } finally {
    await db.close();
  }
});

test("feedback is private, reversible, and suppressed per measure below five answers", async () => {
  const db = await database();
  const actor = (user: string) => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`);
  const summary = async () => (await db.query<{ result: unknown }>("select club_feedback_summary() as result")).rows[0].result;
  const save = async (index: number, revision: number, remove = false) => (await db.query<{ result: unknown }>(
    "select save_club_feedback($1::smallint,$2::smallint,$3::smallint,$4,$5,$6,$7) as result",
    remove ? [null, null, null, [], [], null, revision]
      : [index === 0 ? 3 : 5, index === 0 ? 4 : null, null, ["schedule", "schedule"], ["fri"], `QA suggestion ${index}`, revision],
  )).rows[0].result;
  const ids = [USER, ...[1, 2, 3, 4].map((index) => `40000000-0000-4000-8000-00000000000${index}`)];
  const empty = { scores: [], reasons: [], days: [], suggestions: [] };

  try {
    for (const id of ids.slice(1)) await db.query("insert into auth.users values($1,$2,'{}')", [id, `${id}@example.test`]);
    for (const [index, id] of ids.entries()) {
      await actor(id);
      assert.equal(await save(index, 0), "saved");
      assert.equal(await save(index, 0), "saved");
      await assert.rejects(summary(), /права администратора/u);
      if (index === 3) {
        await actor(ADMIN);
        assert.deepEqual(await summary(), empty);
      }
    }
    await actor(ADMIN);
    await assert.rejects(db.query("select * from club_feedback"), /permission denied/u);
    assert.deepEqual(await summary(), {
      scores: [{ key: "atmosphere", responses: 5, average: 4.6 }],
      reasons: [{ key: "schedule", responses: 5 }],
      days: [{ key: "fri", responses: 5 }],
      suggestions: ids.map((_id, index) => `QA suggestion ${index}`),
    });
    await actor(USER);
    assert.equal(await save(0, 0, true), "conflict");
    assert.equal(await save(0, 1, true), "saved");
    const own = (await db.query<{ result: unknown }>("select club_member_preferences() as result")).rows[0].result;
    assert.deepEqual(own, {
      notifications: null,
      feedback: { atmosphere: null, comfort: null, organization: null, reasons: [], days: [], suggestion: null, revision: 2 },
    });
    await actor(ADMIN);
    assert.deepEqual(await summary(), empty);
  } finally {
    await db.close();
  }
});
