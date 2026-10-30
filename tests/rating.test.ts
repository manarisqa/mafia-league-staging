import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { rate, MODEL, RULES, SHORT_RULES, eligibility, orderedGames, type State, type Game } from "../src/lib/league/legacy/model";
import { rate as frozen } from "./fixtures/frozen-v1";
import { projectLeague, profileStats, clubDate, SnapshotSchema, type ClubSnapshot } from "../src/lib/league/core";
const base: State = JSON.parse(readFileSync("tests/fixtures/v33-baseline.json", "utf8"));
const golden = JSON.parse(readFileSync("tests/fixtures/v33-rating-golden.json", "utf8"));
const source = JSON.parse(readFileSync("src/lib/league/legacy/provenance.json", "utf8"));
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

test("v33 model and referee are byte-for-byte originals, with pinned reference fixtures", () => {
  assert.equal(source.commit, "a4e6cbc1bc486e97915043779f3ba89a051cfa10");
  for (const [file, sha] of Object.entries(source.files)) assert.equal(digest(`src/lib/league/legacy/${file}`), sha);
  assert.equal(source.files["model.ts"], "1adac23c3fabb53a2f293eeaf316ab8379c64e2f6cdf85e14ce6e3a809ce39da");
  assert.equal(digest("tests/fixtures/frozen-v1.ts"), source.frozenFormulaSHA256);
  assert.equal(digest("tests/fixtures/v33-baseline.json"), source.baselineSHA256);
});
test("every original baseline rating, interval, prediction and history matches its golden", () => {
  assert.deepEqual(rate(base), golden);
  assert(Object.values(rate(base).players).every((p) => p.provisional));
});
const synthetic: State = {
  revision: 1,
  players: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, active: true, rev: 1 })),
  seasons: [{ id: "season-1", name: "Season", archived: false, rev: 1 }],
  sessions: [{ id: "e", name: "Evening", date: "2026-10-01", seasonId: "season-1", attendees: Array.from({ length: 12 }, (_, i) => `p${i}`), closed: false, rev: 1 }],
  games: [],
};
const roles = ["don", "mafia", "mafia", "sheriff", "civilian", "civilian", "civilian", "civilian", "civilian", "civilian"] as const;
for (let i = 0; i < 80; i++) synthetic.games.push({ id: `g${i}`, sessionId: "e", number: i + 1, format: "classic10", winner: i % 3 ? "red" : "black", type: "normal", reason: "", eligible: true, eligibilityReason: "", voided: false, modelVersion: MODEL, rulesVersion: RULES, createdAt: "2026-10-01T19:00:00Z", rev: 1,
  players: roles.map((role, j) => ({ playerId: `p${(j + i) % 12}`, seat: j + 1, role, fouls: 0, removed: false })) });
function scores(r: ReturnType<typeof rate>) {
  return { ...r, players: Object.fromEntries(Object.entries(r.players).map(([id, p]) => [id, { rating: p.rating, sd: p.sd, low: p.low, high: p.high, n: p.n, provisional: p.provisional }])) };
}
test("80 prefixes match the frozen original formula exactly (history policy intentionally differs)", () => {
  for (let i = 1; i <= synthetic.games.length; i++) {
    const s = { ...synthetic, games: synthetic.games.slice(0, i) };
    assert.deepEqual(scores(rate(s)), scores(frozen(s)));
  }
});
for (const kind of ["short9", "technical", "removed", "voided", "draw", "bad-roles", "bad-version"] as const) test(`${kind} does not change main Skill or its history`, () => {
  const g: Game = structuredClone(synthetic.games[0]); g.id = "excluded"; g.number = 81;
  if (kind === "short9") { g.format = "short9"; g.rulesVersion = SHORT_RULES; g.players.pop(); }
  if (kind === "technical") g.type = "technical";
  if (kind === "removed") g.players[0].removed = true;
  if (kind === "voided") g.voided = true;
  if (kind === "draw") { g.type = "cancelled"; g.winner = null; }
  if (kind === "bad-roles") g.players[0].role = "civilian";
  if (kind === "bad-version") g.modelVersion = "tournament-experiment";
  assert(eligibility(g));
  assert.deepEqual(rate({ ...synthetic, games: [...synthetic.games, g] }), rate(synthetic));
});
test("fouls alone have no Skill bonus/penalty; covariance can update absent players", () => {
  const s = structuredClone(synthetic); s.games[0].players[0].fouls = 3;
  assert.deepEqual(rate(s), rate(synthetic));
  const before = rate({ ...s, games: s.games.slice(0, 10) });
  const after = rate({ ...s, games: s.games.slice(0, 11) });
  const absent = s.players.filter((p) => !s.games[10].players.some((q) => q.playerId === p.id));
  assert(absent.some((p) => before.players[p.id].rating !== after.players[p.id].rating));
  for (const p of Object.values(after.players)) assert.equal(p.history.at(-1)!.rating, p.rating);
});
function storage(): ClubSnapshot {
  const ids = new Map<string, string>(); let index = 0;
  const uuid = (key: string) => { if (!ids.has(key)) ids.set(key, `10000000-0000-0000-0000-${String(++index).padStart(12, "0")}`); return ids.get(key)!; };
  return {
    revision: base.revision,
    players: base.players.map((p) => ({ id: uuid(p.id), display_name: p.name, status: "club_member", joined_on: null, revision: p.rev })),
    seasons: base.seasons.map((s) => ({ id: uuid(s.id), name: s.name, starts_on: "2026-09-01", ends_on: null })),
    evenings: base.sessions.map((e) => ({ id: uuid(e.id), starts_at: `${e.date}T19:00:00+02:00`, place: e.name, status: e.deleted ? "cancelled" : "planned", capacity: 10, season_id: uuid(e.seasonId), host_player_id: null, revision: e.rev })),
    games: base.games.map((g) => ({ id: uuid(g.id), evening_id: uuid(g.sessionId), game_no: g.number, format: g.format ?? "classic10", status: "finished", winner: g.winner, host_player_id: null,
      played_at: `${base.sessions.find((e) => e.id === g.sessionId)!.date}T19:00:00+02:00`, finished_at: "2026-10-30T09:00:00Z", result_type: "normal", result_reason: "", voided: g.voided, model_version: g.modelVersion, rules_version: g.rulesVersion, revision: g.rev,
      seats: g.players.map((p) => ({ seat: p.seat!, player_id: uuid(p.playerId), role: p.role, fouls: p.fouls ?? 0, removed: p.removed ?? false })) })),
  };
}
test("Supabase adapter matches original scores and profile curve endpoints", () => {
  const s = SnapshotSchema.parse(storage()); const league = projectLeague(s);
  for (const [i, player] of s.players.entries()) {
    const expected = golden.players[base.players[i].id]; const actual = league.stats.get(player.id)!;
    for (const key of ["rating", "sd", "low", "high", "provisional"] as const) assert.equal(actual[key], expected[key]);
    assert.equal(actual.skillGames, expected.n);
    assert.equal(profileStats(league, player.id).ratingPoints.at(-1)!.rating, actual.rating);
  }
});
test("shared policy retains completed open-evening games, excludes draft/void/cancelled; dates survive edits", () => {
  const s = storage(); const id = s.players[0].id;
  assert.equal(projectLeague(s).games.length, orderedGames(base).length);
  const original = profileStats(projectLeague(s), id).history.map((g) => g.startsAt);
  s.games.forEach((g) => g.finished_at = "2030-01-01T12:00:00Z");
  assert.deepEqual(profileStats(projectLeague(s), id).history.map((g) => g.startsAt), original);
  s.games[0].status = "in_progress"; s.games[2].voided = true;
  assert.equal(projectLeague(s).games.length, 0);
  s.games[0].status = "finished"; s.games[2].voided = false; s.evenings[0].status = "cancelled";
  assert.equal(projectLeague(s).games.length, 0);
});
test("Short9 remains descriptive; no season is explicit exclusion instead of invented season baseline", () => {
  const s = storage(); const g = s.games[0]; g.format = "short9"; g.rules_version = SHORT_RULES;
  g.seats.splice(g.seats.findIndex((p) => p.role === "civilian"), 1); g.seats.forEach((p, i) => p.seat = i + 1);
  s.games = [g]; const league = projectLeague(s); const p = league.stats.get(g.seats[0].player_id)!;
  assert.equal(p.games, 1); assert.equal(p.skillGames, 0); assert.equal(p.rating, 1000);
  assert.match(league.state.games[0].eligibilityReason, /Short 9/);
  const unassigned = storage(); unassigned.evenings.forEach((e) => e.season_id = null);
  assert.equal(projectLeague(unassigned).ratings.predictions.length, 0);
  assert(projectLeague(unassigned).state.games.every((g) => g.eligibilityReason === "Не назначен сезон"));
});
test("Vienna game dates handle midnight and summer/winter offsets", () => {
  assert.equal(clubDate("2026-10-30T23:30:00Z"), "2026-10-31");
  assert.equal(clubDate("2026-07-01T22:30:00Z"), "2026-07-02");
});
