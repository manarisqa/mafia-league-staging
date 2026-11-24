import { FORMAT_LABEL, ROLE_LABEL } from "../format";
import { resultFor, sideOf, type Role } from "../rating";
import { clubDate, type ClubGame } from "./core";
import { inClubPeriod, type ClubPeriod } from "./period";

export const insightFormats = ["classic10", "short9"] as const;
export const insightRoles = ["civilian", "sheriff", "mafia", "don"] as const;
export const insightSides = ["red", "black"] as const;
export const minimumWinSample = 10;
export const insightPageSize = 12;

type Format = keyof typeof FORMAT_LABEL;
type Side = (typeof insightSides)[number];
export type RoleFilter = Side | keyof typeof ROLE_LABEL;
export type InsightGame = Omit<ClubGame, "seats"> & {
  seats: (Omit<ClubGame["seats"][number], "role"> & { role: Role | null })[];
};

type Result = ReturnType<typeof resultFor>;
export type GameSample = { games: number; wins: number; losses: number; draws: number; known: number };
export type ProtocolFact = { gameId: string; revision: number; bestHits: number | null };

const emptySample = (): GameSample => ({ games: 0, wins: 0, losses: 0, draws: 0, known: 0 });

function record(sample: GameSample, result: Result | null) {
  sample.games++;
  if (result === null) return;
  sample.known++;
  if (result === "win") sample.wins++;
  else if (result === "loss") sample.losses++;
  else sample.draws++;
}

export function observedWinRate(sample: GameSample) {
  return sample.known >= minimumWinSample ? sample.wins / sample.known : null;
}

export function collectPlayerGames(games: InsightGame[], playerId: string) {
  return games.flatMap((game) => {
    const seat = game.seats.find((candidate) => candidate.player_id === playerId);
    if (!seat || game.status !== "finished" || game.voided || game.winner === null) return [];
    const side: Side | null = seat.role ? (sideOf(seat.role) as Side) : null;
    const result = game.winner === "draw" ? "draw" : seat.role ? resultFor(seat.role, game.winner) : null;
    return [{ game, seat, side, result, day: clubDate(game.played_at) }];
  }).sort((a, b) => Date.parse(b.game.played_at) - Date.parse(a.game.played_at)
    || b.game.game_no - a.game.game_no || b.game.id.localeCompare(a.game.id));
}

type PlayerGame = ReturnType<typeof collectPlayerGames>[number];

export function filterPlayerGames(games: PlayerGame[], period: ClubPeriod, format: Format | "all", role: RoleFilter | "all") {
  return games.filter((row) => inClubPeriod(row.day, period)
    && (format === "all" || row.game.format === format)
    && (role === "all" || row.side === role || row.seat.role === role));
}

export function playerActivity(games: PlayerGame[]) {
  const months = new Map<string, Record<Format, number>>();
  const evenings = new Map<string, number>();
  for (const { game, day } of games) {
    const month = day.slice(0, 7);
    const count = months.get(month) ?? { classic10: 0, short9: 0 };
    count[game.format]++;
    months.set(month, count);
    evenings.set(game.evening_id, (evenings.get(game.evening_id) ?? 0) + 1);
  }
  return { months, evenings };
}

function groupStats<Key>(keys: readonly Key[], games: PlayerGame[], keyFor: (game: PlayerGame) => Key) {
  const groups = new Map(keys.map((key) => [key, emptySample()]));
  for (const game of games) {
    const group = groups.get(keyFor(game));
    if (group) record(group, game.result);
  }
  return groups;
}

export function summarizePlayer(games: PlayerGame[]) {
  const total = emptySample();
  for (const row of games) record(total, row.result);
  return {
    total,
    formats: groupStats(insightFormats, games, ({ game }) => game.format),
    sides: groupStats([...insightSides, null], games, ({ side }) => side),
    roles: groupStats([...insightRoles, null], games, ({ seat }) => seat.role),
  };
}

export function summarizeTable(games: PlayerGame[], facts: ProtocolFact[]) {
  const byGame = new Map(facts.map((fact) => [fact.gameId, fact]));
  const seats = new Map<number, number>();
  let fouls = 0;
  let foulGames = 0;
  let removals = 0;
  let removalGames = 0;
  const bestMoves: { gameId: string; date: string; hits: number }[] = [];
  for (const { seat, game } of games) {
    seats.set(seat.seat, (seats.get(seat.seat) ?? 0) + 1);
    const candidate = byGame.get(game.id);
    const provenance = candidate?.revision === game.revision ? candidate : null;
    // Old game rows contain default 0/false. Positive marks are observable.
    if (seat.fouls > 0 || provenance) {
      fouls += seat.fouls;
      foulGames++;
    }
    if (seat.removed || provenance) {
      removals += Number(seat.removed);
      removalGames++;
    }
    if (provenance?.bestHits != null) {
      bestMoves.push({ gameId: game.id, date: game.played_at, hits: provenance.bestHits });
    }
  }
  return { seats, fouls, foulGames, removals, removalGames, bestMoves };
}

type OtherPlayer = { playerId: string; together: GameSample; against: GameSample; unknown: number; total: number };

export function summarizePairs(games: PlayerGame[]) {
  const pairs = new Map<string, OtherPlayer>();
  for (const { game, seat, side, result } of games) {
    for (const other of game.seats) {
      if (other.player_id === seat.player_id) continue;
      let pair = pairs.get(other.player_id);
      if (!pair) {
        pair = { playerId: other.player_id, together: emptySample(), against: emptySample(), unknown: 0, total: 0 };
        pairs.set(other.player_id, pair);
      }
      pair.total++;
      if (!side || !other.role) {
        pair.unknown++;
      } else {
        record(sideOf(other.role) === side ? pair.together : pair.against, result);
      }
    }
  }
  return [...pairs.values()].sort((a, b) => b.total - a.total || a.playerId.localeCompare(b.playerId));
}

export function parseInsightPage(raw: unknown) {
  if (typeof raw !== "string" || !/^\d{1,6}$/.test(raw)) return 1;
  return Math.max(1, Number(raw));
}

export function insightPage<T>(rows: T[], requested: number, size = insightPageSize) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(requested, pages);
  return { rows: rows.slice((page - 1) * size, page * size), page, pages };
}
