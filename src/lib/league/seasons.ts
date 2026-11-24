import { resultFor } from "../rating";
import { clubDate, type ClubGame, type ClubSnapshot, type LeagueProjection } from "./core";
import { inClubPeriod, type ClubPeriod } from "./period";

export const SEASON_FORMATS = ["classic10", "short9"] as const;
export type SeasonFormat = (typeof SEASON_FORMATS)[number];
export type SeasonPlayer = {
  id: string;
  name: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  evenings: number;
};

const historyEvenings = (snapshot: ClubSnapshot, games: LeagueProjection["games"]) => {
  const playedEvenings = new Set(games.map((game) => game.evening_id));
  return snapshot.evenings.filter((evening) =>
    evening.status === "finished" || playedEvenings.has(evening.id),
  );
};

export function clubSeasonYears(league: LeagueProjection, now: string): number[] {
  const dates = [
    now,
    ...historyEvenings(league.snapshot, league.games).map((evening) => evening.starts_at),
    ...league.games.map((game) => game.played_at),
  ];
  return [...new Set(dates.map((date) => Number(clubDate(date).slice(0, 4))))].sort((a, b) => b - a);
}

function formatResults(games: ClubGame[], names: Map<string, string>) {
  const players = new Map<string, SeasonPlayer & { eveningIds: Set<string> }>();
  const outcomes = { red: 0, black: 0, draw: 0 };
  for (const game of games) {
    if (!game.winner) continue;
    outcomes[game.winner]++;
    for (const seat of game.seats) {
      const name = names.get(seat.player_id);
      if (!name) continue;
      const player = players.get(seat.player_id) ??
        { id: seat.player_id, name, games: 0, wins: 0, losses: 0, draws: 0, evenings: 0, eveningIds: new Set<string>() };
      player.games++;
      const result = resultFor(seat.role, game.winner);
      if (result === "win") player.wins++;
      if (result === "loss") player.losses++;
      if (result === "draw") player.draws++;
      player.eveningIds.add(game.evening_id);
      players.set(seat.player_id, player);
    }
  }
  return {
    games: games.length,
    outcomes,
    players: [...players.values()].map(({ eveningIds, ...player }) => ({ ...player, evenings: eveningIds.size })),
  };
}

/** Games use their play date, evenings use their announced start date. */
export function clubSeasonSummary(league: LeagueProjection, period: ClubPeriod, options: { normalOnly?: boolean } = {}) {
  const games = league.games.filter((game) =>
    (!options.normalOnly || game.result_type === "normal") && inClubPeriod(clubDate(game.played_at), period),
  );
  const names = new Map(league.snapshot.players.map((player) => [player.id, player.display_name]));
  const formats = {
    classic10: formatResults(games.filter((game) => game.format === "classic10"), names),
    short9: formatResults(games.filter((game) => game.format === "short9"), names),
  };
  const evenings = historyEvenings(league.snapshot, league.games)
    .filter((evening) => inClubPeriod(clubDate(evening.starts_at), period)).length;
  return {
    evenings,
    games: games.length,
    players: new Set(games.flatMap((game) => game.seats.map((seat) => seat.player_id))).size,
    formats,
  };
}

export const NOMINATION_METRICS = ["evenings", "wins"] as const;
export type NominationMetric = (typeof NOMINATION_METRICS)[number];

/** All ties share the displayed maximum. Zero wins gives no candidates. */
export function preliminaryCandidates(players: SeasonPlayer[], metric: NominationMetric): SeasonPlayer[] {
  const best = players.reduce((highest, player) => Math.max(highest, player[metric]), 0);
  return best > 0 ? players.filter((player) => player[metric] === best) : [];
}
