import test from "node:test";
import assert from "node:assert/strict";
import { database, ADMIN, EVENING, HOST, USER } from "./support/database";
import { CURRENT_RULES_REVISION, FAIR_QUEUE, FAIR_SEAT, PROCEDURE, type Draft } from "../src/lib/referee/guided/protocol";
import { append, projection, validate } from "../src/lib/referee/guided/reducer";

test("guest capability, append-only revisions, immutable originals and atomic publication", async () => {
  const db = await database();
  const id = "50500000-0000-4000-8000-000000000001";
  const secret = "ba".repeat(32);
  const failKey = "ff".repeat(32);
  const at = new Date().toISOString();
  const players = (await db.query<{ id: string; name: string }>(
    "select id,display_name as name from players where id <> $1 order by id limit 9", [HOST],
  )).rows;
  const ids = players.map((p) => p.id);
  const initial: Draft = {
    id, version: PROCEDURE, rulesRevision: CURRENT_RULES_REVISION, evening: EVENING, round: 100, format: "short9", startedAt: at,
    host: { id: null, name: "QA private guest host" }, players,
    organization: { attendance: ids.map((player) => ({ id: player, status: "ready" })), queue: FAIR_QUEUE,
      proposed: ids, override: null, seats: FAIR_SEAT, cut: at, eligibleGames: [], original: ids, swaps: [] },
    events: [],
  };
  let draft = initial;
  try {
    for (const [index, role] of (["civilian","civilian","civilian","civilian","civilian","sheriff","mafia","mafia","don"] as const).entries()) {
      draft = append(draft, { type: "role", seat: index + 1, role });
    }
    draft = append(draft, { type: "advance", seconds: null });
    draft = append(draft, { type: "exception", outcome: "technical", winner: "black", reason: "Synthetic test arbitration" });
    const result = projection(draft, validate(draft).state)!;
    const actor = (role: "anon" | "authenticated", user = "") => db.exec(
      "reset role; set role " + role + "; select set_config('request.jwt.claim.sub','" + user + "',false)");
    const receive = async (action: string, key: string, revision: number, payload?: unknown, draftId = id) => {
      const response = await db.query<{ result: Record<string, unknown> }>(
        "select guided_guest($1,$2,$3,$4,$5) as result", [action, draftId, key, revision, payload ? JSON.stringify(payload) : null],
      );
      return response.rows[0].result;
    };
    const review = async (action: string, revision: number, params: unknown = null, payload: unknown = null) => {
      const response = await db.query<{ result: Record<string, unknown> }>(
        "select guided_review($1,$2,$3,$4,$5,$6,$7) as result",
        [id, revision, action, action === "approve" ? "" : "QA verified correction", payload && JSON.stringify(payload), null, params && JSON.stringify(params)],
      );
      return response.rows[0].result;
    };
    await actor("anon");
    await assert.rejects(db.query("select payload from guided_referee_drafts"), /permission denied/);
    await assert.rejects(db.query("select * from guided_referee_versions"), /permission denied/);
    const priorId = "50500000-0000-4000-8000-000000000002";
    const offlineId = "50500000-0000-4000-8000-000000000003";
    const restart = { attempt: { ...initial, id: priorId }, replacement: id };
    const offline = { attempt: { ...initial, id: offlineId }, replacement: priorId };
    const before = (await db.query("select league_snapshot() as snapshot, guided_catalog()->'history' as history")).rows;
    assert.deepEqual(await receive("restart", secret, 0, offline, offlineId), { status: "revoked", revision: 1 });
    assert.deepEqual(await receive("submit", secret, 0, { ...draft, id: offlineId }, offlineId), { error: "denied" });
    assert.deepEqual(await receive("save", secret, 0, { ...draft, id: priorId }, priorId), { status: "draft", revision: 1 });
    assert.deepEqual(await receive("restart", failKey, 0, restart, priorId), { error: "denied" });
    assert.deepEqual(await receive("restart", secret, 0, restart, priorId), { status: "revoked", revision: 2 });
    assert.deepEqual(await receive("restart", secret, 0, restart, priorId), { status: "revoked", revision: 2 });
    assert.deepEqual(await receive("restart", secret, 0, { ...restart, replacement: offlineId }, priorId), { error: "restart_protected" });
    assert.deepEqual(await receive("read", secret, 0, null, priorId), { error: "denied" });
    assert.deepEqual(await receive("submit", secret, 1, { ...draft, id: priorId }, priorId), { error: "denied" });
    assert.deepEqual((await db.query("select league_snapshot() as snapshot, guided_catalog()->'history' as history")).rows, before);
    await db.exec("reset role");
    assert.deepEqual((await db.query("select restarted_as,payload,submitted_at,game_id from guided_referee_drafts where id=$1", [priorId])).rows,
      [{ restarted_as: id, payload: {}, submitted_at: null, game_id: null }]);
    assert.equal((await db.query("select * from guided_referee_versions")).rows.length, 0);
    await actor("anon");
    assert.deepEqual(await receive("save", secret, 0, initial), { status: "draft", revision: 1 });
    assert.deepEqual(await receive("read", failKey, 0), { error: "denied" });
    assert.deepEqual(await receive("save", failKey, 0, initial), { error: "denied" });
    assert.deepEqual(await receive("submit", secret, 1, initial), { error: "invalid" });
    assert.deepEqual(await receive("submit", secret, 1, draft), { status: "submitted", revision: 2 });
    assert.deepEqual(await receive("submit", secret, 1, draft), { status: "submitted", revision: 2 });
    assert.deepEqual(await receive("restart", secret, 0, { attempt: initial, replacement: priorId }), { error: "restart_protected" });
    const competingId = "50500000-0000-4000-8000-000000000004";
    assert.deepEqual(await receive("submit", secret, 0, { ...draft, id: competingId }, competingId), { error: "round" });
    assert.deepEqual(await receive("save", secret, 1, draft), { error: "conflict" });
    assert.equal((await db.query("select id from games where evening_id=$1 and game_no=100", [EVENING])).rows.length, 0);
    await assert.rejects(review("approve", 2, result), /permission denied/);
    await actor("authenticated", USER);
    assert.equal((await db.query("select id,payload from guided_referee_drafts")).rows.length, 0);
    await assert.rejects(review("approve", 2, result), /права администратора/);
    await actor("authenticated", ADMIN);
    await assert.rejects(db.query("select capability_hash from guided_referee_drafts"), /permission denied/);
    assert.equal((await review("clarify", 2)).revision, 3);
    const clarified = append(draft, { type: "note", reason: "QA guest clarification" });
    await actor("anon");
    assert.deepEqual(await receive("restart", secret, 0, { attempt: initial, replacement: priorId }), { error: "restart_protected" });
    assert.deepEqual(await receive("submit", secret, 3, clarified), { status: "submitted", revision: 4 });
    await actor("authenticated", ADMIN);
    const corrected = append(clarified, { type: "note", reason: "QA source verified" });
    assert.equal((await review("correction", 4, null, corrected)).revision, 5);
    assert.deepEqual(await review("approve", 4, result), { error: "conflict" });
    const wrongRole = { ...result, seats: result.seats.map((seat, index) => index === 0 ? { ...seat, role: "don" } : seat) };
    await assert.rejects(review("approve", 5, wrongRole), /неверный состав/);
    assert.equal((await db.query("select id from games where evening_id=$1 and game_no=100", [EVENING])).rows.length, 0);
    const receipt = await review("approve", 5, result);
    assert.equal(receipt.status, "approved");
    assert.deepEqual(await review("approve", 5, result), receipt);
    const versions = await db.query<{ kind: string; payload: Draft }>("select kind,payload from guided_referee_versions order by revision");
    assert.deepEqual(versions.rows.map((v) => v.kind), ["submitted", "clarify", "submitted", "correction", "approved"]);
    assert.deepEqual(versions.rows[0].payload, draft);
    await actor("anon");
    assert.deepEqual(await receive("restart", secret, 0, { attempt: initial, replacement: priorId }), { error: "restart_protected" });
    const games = await db.query<{ data: Record<string, unknown> }>("select league_snapshot() as data");
    assert(!JSON.stringify(games.rows).includes("QA private guest host"));
    assert(JSON.stringify(games.rows).includes(String(receipt.game)));
    assert.deepEqual(await receive("revoke", secret, 6), { status: "revoked", revision: 6 });
    assert.deepEqual(await receive("read", secret, 6), { error: "denied" });
  } finally { await db.close(); }
});
