import assert from "node:assert/strict";
import { test } from "node:test";
import { clubDate, EMPTY_SNAPSHOT, projectLeague, type ClubGame, type ClubSnapshot } from "../src/lib/league/core";
import { ALL_CLUB_HISTORY, clubYearPeriod, inClubPeriod, parseClubPeriod } from "../src/lib/league/period";
import { clubSeasonSummary, clubSeasonYears, preliminaryCandidates } from "../src/lib/league/seasons";

const timing = {
  december: "2026-12-31T22:55:00Z",
  january: "2026-12-31T23:05:00Z",
  april: "2027-03-31T22:00:00Z",
};

function fixture(): ClubSnapshot {
  const evening = (id: string, starts_at: string, status: ClubSnapshot["evenings"][number]["status"]) => ({
    id, starts_at, status, capacity: 10, place: "Graz", season_id: null, host_player_id: null, revision: 1,
  });
  const original: ClubGame = {
    id: "game-1", evening_id: "new-year", game_no: 1, format: "classic10", status: "finished", winner: "red",
    played_at: timing.december, finished_at: "2027-12-30T00:00:00Z", host_player_id: null, voided: false,
    result_type: "normal", result_reason: "", revision: 1, rules_version: "historical", model_version: "team-logit-v1",
    seats: [
      { seat: 1, player_id: "civilian", role: "civilian", fouls: 0, removed: false },
      { seat: 2, player_id: "don", role: "don", fouls: 0, removed: false },
    ],
  };
  return {
    ...EMPTY_SNAPSHOT,
    players: ["civilian", "don", "spectator"].map((id) => ({
      id, display_name: id, status: "club_member", joined_on: null, revision: 1,
    })),
    evenings: [
      evening("new-year", timing.december, "finished"),
      evening("closed-empty", timing.april, "finished"),
      evening("cancelled", timing.january, "cancelled"),
      evening("future", "2028-02-06T19:00:00Z", "planned"),
    ],
    games: [
      original,
      { ...original, id: "game-2", game_no: 2, format: "short9", played_at: timing.january, winner: "black" },
      { ...original, id: "game-3", game_no: 3, format: "short9", played_at: timing.january, winner: "draw" },
      { ...original, id: "void", game_no: 4, voided: true, played_at: timing.april },
      { ...original, id: "draft", game_no: 5, status: "in_progress", played_at: timing.april },
      { ...original, id: "cancelled-game", evening_id: "cancelled", played_at: timing.january },
    ],
  };
}

test("Vienna year and quarter boundaries use the local play day", () => {
  assert.equal(clubDate(timing.december), "2026-12-31");
  assert.equal(clubDate(timing.january), "2027-01-01");
  assert.equal(clubDate(timing.april), "2027-04-01");
  const first = clubYearPeriod(2027, 1);
  assert.deepEqual(parseClubPeriod("2027-q1"), first);
  assert.equal(inClubPeriod(clubDate(timing.december), first), false);
  assert.equal(inClubPeriod(clubDate(timing.january), first), true);
  assert.equal(inClubPeriod(clubDate(timing.april), first), false);
  assert.equal(inClubPeriod(clubDate(timing.april), clubYearPeriod(2027, 2)), true);
  assert.equal(parseClubPeriod("2027-q0"), null);
  assert.equal(parseClubPeriod(["2027"]), null);
  assert.equal(parseClubPeriod("all"), ALL_CLUB_HISTORY);
});

test("season summaries separate formats and date evenings by start and games by play", () => {
  const league = projectLeague(fixture());
  assert.deepEqual(clubSeasonYears(league, timing.january), [2027, 2026]);
  const first = clubSeasonSummary(league, clubYearPeriod(2026, 4));
  assert.deepEqual([first.evenings, first.games, first.players], [1, 1, 2]);
  assert.deepEqual(first.formats.classic10.outcomes, { red: 1, black: 0, draw: 0 });
  assert.equal(first.formats.short9.games, 0);

  const second = clubSeasonSummary(league, clubYearPeriod(2027, 1));
  assert.deepEqual([second.evenings, second.games, second.players], [0, 2, 2]);
  assert.deepEqual(second.formats.short9.outcomes, { red: 0, black: 1, draw: 1 });
  assert.deepEqual(second.formats.short9.players.find((player) => player.id === "don"),
    { id: "don", name: "don", games: 2, wins: 1, losses: 0, draws: 1, evenings: 1 });

  const third = clubSeasonSummary(league, clubYearPeriod(2027, 2));
  assert.deepEqual([third.evenings, third.games, third.players], [1, 0, 0]);
  const all = clubSeasonSummary(league, ALL_CLUB_HISTORY);
  assert.deepEqual([all.evenings, all.games, all.players], [2, 3, 2]);
  assert.equal(all.formats.classic10.players[0].games, 1);
});

test("preliminary nominations keep ties together, show denominators and skip empty candidates", () => {
  const snapshot = fixture();
  snapshot.games.push({
    ...snapshot.games[1], id: "technical", game_no: 6, result_type: "technical", winner: "red",
  });
  const league = projectLeague(snapshot);
  const summary = clubSeasonSummary(league, ALL_CLUB_HISTORY);
  const normal = clubSeasonSummary(league, ALL_CLUB_HISTORY, { normalOnly: true });
  assert.equal(summary.formats.short9.games, 3);
  assert.equal(normal.formats.short9.games, 2);
  const players = normal.formats.short9.players;
  assert.deepEqual(preliminaryCandidates(players, "evenings").map(({ id }) => id), ["civilian", "don"]);
  assert.deepEqual(preliminaryCandidates(players, "wins").map(({ id, wins, games }) => ({ id, wins, games })),
    [{ id: "don", wins: 1, games: 2 }]);
  assert.deepEqual(preliminaryCandidates(players.filter(({ wins }) => wins === 0), "wins"), []);
  const empty = clubSeasonSummary(projectLeague(EMPTY_SNAPSHOT), ALL_CLUB_HISTORY);
  assert.deepEqual(preliminaryCandidates(empty.formats.short9.players, "evenings"), []);
});
