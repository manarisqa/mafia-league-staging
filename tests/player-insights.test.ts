import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { completedGames, EMPTY_SNAPSHOT, type ClubGame, type ClubSnapshot } from "../src/lib/league/core";
import { ALL_CLUB_HISTORY, clubYearPeriod } from "../src/lib/league/period";
import {
  collectPlayerGames, filterPlayerGames, insightPage, observedWinRate, playerActivity, summarizePairs, summarizePlayer, summarizeTable,
  type InsightGame, type ProtocolFact,
} from "../src/lib/league/player-insights";
import { CLASSIC, SHORT, database } from "./support/database";

const alice = "00000000-0000-0000-0000-000000000101";
const bob = "00000000-0000-0000-0000-000000000102";
const caseGame = (id: string, overrides: Partial<InsightGame> = {}): InsightGame => ({
  id, evening_id: "played", game_no: 1, format: "classic10", status: "finished", winner: "red",
  host_player_id: null, played_at: "2026-12-31T23:10:00Z", finished_at: null,
  result_type: "normal", result_reason: "", voided: false, rules_version: "club-v1", model_version: "team-logit-v1", revision: 1,
  seats: [{ seat: 1, player_id: alice, role: "civilian", fouls: 0, removed: false },
    { seat: 2, player_id: bob, role: "sheriff", fouls: 0, removed: false }], ...overrides,
});
const sample = (games: InsightGame[]) => collectPlayerGames(games, alice);
const expected = (games = 0, wins = 0, losses = 0, draws = 0) => ({ games, wins, losses, draws, known: wins + losses + draws });

test("no history produces empty lists and a missing win rate, with counts available for small samples", () => {
  const none = summarizePlayer([]);
  assert.deepEqual(none.total, expected());
  assert.equal(observedWinRate(none.total), null);
  assert.deepEqual(summarizePairs([]), []);
  assert.deepEqual(insightPage([], 13), { rows: [], page: 1, pages: 1 });

  const small = summarizePlayer(sample([caseGame("0")])).total;
  assert.deepEqual(small, expected(1, 1));
  assert.equal(observedWinRate(small), null);
  const ten = summarizePlayer(sample(Array.from({ length: 10 }, (_, i) => caseGame(String(i), {
    winner: i < 7 ? "red" : i < 9 ? "black" : "draw",
  })))).total;
  assert.deepEqual(ten, expected(10, 7, 2, 1));
  assert.equal(observedWinRate(ten), 0.7);
});

test("Vienna calendar filters, incomplete roles, mixed formats and reasons for excluding games", () => {
  const known = caseGame("1");
  const unknown = caseGame("2", { format: "short9", seats: known.seats.map((p) => p.player_id === alice ? { ...p, role: null } : p) });
  const priorQuarter = caseGame("3", { played_at: "2026-12-31T22:50:00Z", winner: "draw" });
  const cancelled = caseGame("4", { evening_id: "cancelled" });
  const voided = caseGame("5", { voided: true });
  const draft = caseGame("6", { status: "in_progress", winner: null });
  const evening = (id: string, status: "planned" | "cancelled"): ClubSnapshot["evenings"][number] => ({
    id, status, starts_at: known.played_at, place: "", capacity: 10, host_player_id: null, season_id: null, revision: 1,
  });
  const published = completedGames({ ...EMPTY_SNAPSHOT, evenings: [evening("played", "planned"), evening("cancelled", "cancelled")],
    games: [known, priorQuarter, cancelled, voided, draft] as ClubGame[],
  });
  assert.deepEqual(published.map((game) => game.id), ["3", "1"]);

  const list = sample([...published, unknown, voided, draft]);
  assert.equal(list.length, 3);
  assert.deepEqual(filterPlayerGames(list, clubYearPeriod(2026, 4), "all", "all").map((p) => p.game.id), ["3"]);
  assert.deepEqual(filterPlayerGames(list, clubYearPeriod(2027, 1), "short9", "all").map((p) => p.game.id), ["2"]);
  assert.deepEqual(filterPlayerGames(list, ALL_CLUB_HISTORY, "short9", "civilian"), []);
  assert.deepEqual(filterPlayerGames(list, clubYearPeriod(2027), "all", "red").map((p) => p.game.id), ["1"]);
  const grouped = summarizePlayer(list);
  assert.deepEqual(grouped.total, expected(3, 1, 0, 1));
  assert.deepEqual(grouped.formats.get("short9"), expected(1));
  assert.deepEqual(grouped.roles.get(null), expected(1));
  assert.deepEqual(grouped.sides.get("red"), expected(2, 1, 0, 1));
  assert.deepEqual([...playerActivity(list).months], [["2027-01", { classic10: 1, short9: 1 }], ["2026-12", { classic10: 1, short9: 0 }]]);
});

test("discipline defaults are unknown, recorded zero hits are known, corrections invalidate stale facts", () => {
  const plain = caseGame("unknown");
  const observed = caseGame("approval", { seats: plain.seats.map((seat) => ({ ...seat, seat: seat.seat + 1 })) });
  const discipline = caseGame("manual", { seats: plain.seats.map((seat) => ({ ...seat, fouls: 2, removed: true })) });
  const stale = { gameId: "unknown", revision: 0, bestHits: 3 };
  const score = { gameId: "approval", revision: 1, bestHits: 0 };
  const result = summarizeTable(sample([plain, observed, discipline]), [score, stale]);
  assert.deepEqual([...result.seats], [[1, 2], [2, 1]]);
  assert.deepEqual([result.fouls, result.foulGames, result.removals, result.removalGames], [2, 2, 1, 2]);
  assert.deepEqual(result.bestMoves, [{ gameId: "approval", date: observed.played_at, hits: 0 }]);
  const noProvenance = summarizeTable(sample([plain]), []);
  assert.deepEqual([noProvenance.foulGames, noProvenance.removalGames, noProvenance.bestMoves.length], [0, 0, 0]);
});

test("same-side, opposing and missing sides use separate denominators", () => {
  const known = caseGame("same");
  const withOtherRole = (role: InsightGame["seats"][number]["role"]) => known.seats.map((seat) => seat.player_id === bob ? { ...seat, role } : seat);
  const list = sample([known, caseGame("other", { winner: "black", seats: withOtherRole("don") }),
    caseGame("unconfirmed", { winner: "red", seats: withOtherRole(null) })]);
  assert.deepEqual(summarizePairs(list), [{ playerId: bob, together: expected(1, 1), against: expected(1, 0, 1), unknown: 1, total: 3 }]);
});

test("protocol facts migration preserves populated public snapshot and releases only approved replay facts", async () => {
  const db = await database();
  try {
    // Reapply to a populated fixture, with both old and guided formats present.
    const migration = readFileSync("supabase/migrations/20261124180000_player_protocol_facts.sql", "utf8");
    await db.exec(`drop function public.player_protocol_facts(uuid,date,date);
      drop function public.insight_best_hits(jsonb[],boolean,smallint,jsonb);
      drop function public.insight_active_events(jsonb,boolean)`);
    const getSnapshot = async () => (await db.query("select league_snapshot()")).rows;
    const snapshot = await getSnapshot();
    await db.exec(migration);
    assert.deepEqual(await getSnapshot(), snapshot);

    const { rows: [classic] } = await db.query<{ revision: number }>("select revision from games where id=$1", [CLASSIC]);
    const { rows: lineup } = await db.query<{ seat: number; player_id: string; role: string }>(
      "select seat,player_id,role from game_players where game_id=$1 order by seat", [CLASSIC]);
    const victim = lineup.find((seat) => seat.role === "civilian")!;
    const reds = lineup.filter((seat) => ["civilian", "sheriff"].includes(seat.role) && seat.seat !== victim.seat).slice(0, 3);
    const blacks = lineup.filter((seat) => ["don", "mafia"].includes(seat.role)).slice(0, 2);
    const legacyEvent = (id: string, command: object) => ({ id, phase: "N1", command });
    const legacyBase = [
      legacyEvent("shot", { type: "shot_observation", mode: "independent", shots: blacks.map((p) => ({ actor: p.seat, target: victim.seat })) }),
      legacyEvent("resolved", { type: "night_result" }),
      legacyEvent("known", { type: "best_move", trio: [...blacks, reds[0]].map((p) => p.seat) }),
      legacyEvent("undo", { type: "observation_undone", target: "known" }),
      legacyEvent("redo", { type: "observation_redone", target: "known" }),
      legacyEvent("finished", { type: "game_finished" }),
    ];
    const insertLegacy = async (events: unknown[], revision = classic.revision) => db.query(`insert into referee_protocols
      (id,payload,checksum,approved_game_id,approved_game_revision,approved_at,approval)
      values('insight-test',$1,$2,$3,$4,now(),'{}')`, [JSON.stringify({ events, localPrivateName: "PRIVATE LEGACY SOURCE" }), "a".repeat(64), CLASSIC, revision]);
    await insertLegacy(legacyBase);
    const factsFor = async (id: string) => (await db.query<{ facts: ProtocolFact[] }>("select player_protocol_facts($1) as facts", [id])).rows[0].facts;

    await db.exec("set role anon");
    assert.deepEqual(await factsFor(victim.player_id), [{ gameId: CLASSIC, revision: classic.revision, bestHits: 2 }]);
    assert.deepEqual(await factsFor(blacks[0].player_id), [{ gameId: CLASSIC, revision: classic.revision, bestHits: null }]);
    assert.deepEqual((await db.query("select player_protocol_facts($1,'1900-01-01','1901-01-01') as facts", [victim.player_id])).rows, [{ facts: [] }]);
    await assert.rejects(db.query("select payload from referee_protocols"), /permission denied/);
    await assert.rejects(db.query("select public.insight_active_events('[]',true)"), /permission denied/);
    await db.exec("reset role");
    await db.query("delete from referee_protocols where id='insight-test'");

    const guidedEvent = (id: string, action: object) => ({ id, action });
    const guidedEvents = [
      guidedEvent("shot", { type: "shot", target: victim.seat }),
      guidedEvent("resolved", { type: "advance" }),
      guidedEvent("different", { type: "best", targets: [...blacks, reds[0]].map((p) => p.seat) }),
      guidedEvent("undo", { type: "undo", target: "different" }),
      guidedEvent("zero", { type: "best", targets: reds.map((p) => p.seat) }),
      guidedEvent("finished", { type: "finish" }),
    ];
    const payload = { events: guidedEvents, players: lineup.map((p) => ({ id: p.player_id })), host: { name: "PRIVATE QA HOST" } };
    await db.query(`insert into guided_referee_drafts (id,evening_id,round_no,format,capability_hash,status,game_id,payload,submitted_at)
      select '01000000-0000-4000-8000-000000000000',evening_id,game_no,format,decode(repeat('ab',32),'hex'),'approved',id,$2,now()
      from games where id = $1`, [CLASSIC, JSON.stringify(payload)]);
    await db.exec("set role anon");
    assert.deepEqual(await factsFor(victim.player_id), [{ gameId: CLASSIC, revision: classic.revision, bestHits: 0 }]);
    await assert.rejects(db.query("select payload from guided_referee_drafts"), /permission denied/);
    await db.exec("reset role");
    await db.query("update guided_referee_drafts set status='archived' where game_id=$1", [CLASSIC]);
    assert.deepEqual(await factsFor(victim.player_id), []);
    const absent = (await db.query<{ player_id: string }>("select player_id from game_players where game_id=$1 limit 1", [SHORT])).rows[0];
    assert.deepEqual(await factsFor(absent.player_id), []);
  } finally { await db.close(); }
});
