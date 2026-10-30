import { z } from "zod";
import { eligibility, rate, MODEL, type Game, type Role, type State } from "./legacy/model";
import { resultFor, sideOf } from "../rating";

const id = z.string().uuid();
const revision = z.number().int().nonnegative().safe();
const role = z.enum(["civilian", "sheriff", "don", "mafia"]);
export const SnapshotSchema = z.object({
  revision,
  players: z.array(z.object({ id, display_name: z.string(), status: z.enum(["club_member", "newbie"]), joined_on: z.string().nullable(), revision })),
  seasons: z.array(z.object({ id, name: z.string(), starts_on: z.string(), ends_on: z.string().nullable() })),
  evenings: z.array(z.object({ id, starts_at: z.string().datetime({ offset: true }), place: z.string(), capacity: z.number(), status: z.enum(["planned", "finished", "cancelled"]), season_id: id.nullable(), host_player_id: id.nullable(), revision })),
  games: z.array(z.object({
    id, evening_id: id, game_no: z.number().int().positive(), format: z.enum(["classic10", "short9"]),
    status: z.enum(["in_progress", "finished"]), winner: z.enum(["red", "black", "draw"]).nullable(),
    host_player_id: id.nullable(), played_at: z.string().datetime({ offset: true }), finished_at: z.string().nullable(),
    result_type: z.enum(["normal", "technical"]), result_reason: z.string(), voided: z.boolean(),
    model_version: z.string(), rules_version: z.string(), revision,
    seats: z.array(z.object({ seat: z.number().int(), player_id: id, role, fouls: z.number().int(), removed: z.boolean() })),
  })),
});
export type ClubSnapshot = z.infer<typeof SnapshotSchema>;
export type ClubGame = ClubSnapshot["games"][number];
export const EMPTY_SNAPSHOT: ClubSnapshot = { revision: 0, players: [], seasons: [], evenings: [], games: [] };

/** Vienna date of play, never the date of entry/correction. */
export function clubDate(iso: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const value = (key: string) => p.find((v) => v.type === key)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** Shared history/rating/profile policy, independent of evening closure. */
export function completedGames(s: ClubSnapshot): ClubGame[] {
  const evenings = new Map(s.evenings.map((e) => [e.id, e]));
  return s.games.filter((g) => g.status === "finished" && g.winner !== null && !g.voided &&
    evenings.has(g.evening_id) && evenings.get(g.evening_id)!.status !== "cancelled")
    .sort((a, b) => a.played_at.localeCompare(b.played_at) || a.evening_id.localeCompare(b.evening_id) || a.game_no - b.game_no || a.id.localeCompare(b.id));
}

/** Storage adapter only: never change the copied algorithm or its parameters. */
export function modelState(s: ClubSnapshot): State {
  const games = completedGames(s);
  const evenings = new Map(s.evenings.map((e) => [e.id, e]));
  return {
    revision: s.revision,
    players: s.players.map((p) => ({ id: p.id, name: p.display_name, active: true, rev: p.revision })),
    seasons: s.seasons.map((x) => ({ id: x.id, name: x.name, archived: x.ends_on !== null, rev: 1 })),
    sessions: s.evenings.map((e) => ({ id: e.id, name: e.place, date: clubDate(e.starts_at), seasonId: e.season_id ?? "unassigned", closed: e.status === "finished", deleted: e.status === "cancelled", rev: e.revision,
      attendees: [...new Set(games.filter((g) => g.evening_id === e.id).flatMap((g) => g.seats.map((p) => p.player_id)))] })),
    games: games.map((g) => {
      const game: Game = {
        id: g.id, sessionId: g.evening_id, number: g.game_no, format: g.format,
        winner: g.winner === "draw" ? null : g.winner, type: g.winner === "draw" ? "cancelled" : g.result_type,
        reason: g.result_reason, voided: g.voided, modelVersion: g.model_version, rulesVersion: g.rules_version,
        createdAt: g.played_at, rev: g.revision, eligible: false, eligibilityReason: "",
        players: g.seats.map((p) => ({ playerId: p.player_id, seat: p.seat, role: p.role, fouls: p.fouls, removed: p.removed })),
      };
      game.eligibilityReason = eligibility(game) || (!evenings.get(g.evening_id)?.season_id ? "Не назначен сезон" : "");
      game.eligible = game.eligibilityReason === "";
      return game;
    }),
  };
}
export type SideStats = { games: number; wins: number };
export type PlayerStats = {
  playerId: string; games: number; wins: number; losses: number; draws: number; winRate: number | null;
  rating: number; sd: number; low: number; high: number; skillGames: number; provisional: boolean;
};

/** One calculation feeds all surfaces, including absent-player covariance updates. */
export function projectLeague(snapshot: ClubSnapshot) {
  const state = modelState(snapshot);
  const ratings = rate(state);
  const games = completedGames(snapshot);
  const stats = new Map<string, PlayerStats>();
  for (const p of snapshot.players) {
    const played = games.flatMap((g) => {
      const seat = g.seats.find((s) => s.player_id === p.id);
      return seat ? [resultFor(seat.role, g.winner!)] : [];
    });
    const r = ratings.players[p.id];
    const wins = played.filter((v) => v === "win").length;
    stats.set(p.id, { playerId: p.id, games: played.length, wins,
      losses: played.filter((v) => v === "loss").length, draws: played.filter((v) => v === "draw").length,
      winRate: played.length ? wins / played.length : null,
      rating: r.rating, sd: r.sd, low: r.low, high: r.high, skillGames: r.n, provisional: r.provisional });
  }
  return { snapshot, state, ratings, games, stats, modelVersion: MODEL };
}
export type LeagueProjection = ReturnType<typeof projectLeague>;
export function profileStats(league: LeagueProjection, id: string) {
  const empty = (): SideStats => ({ games: 0, wins: 0 });
  const sides = { red: empty(), black: empty() };
  const roles: Record<Role, SideStats> = { civilian: empty(), sheriff: empty(), don: empty(), mafia: empty() };
  const reasons = new Map(league.state.games.map((g) => [g.id, g.eligibilityReason]));
  const history = league.games.flatMap((g) => {
    const seat = g.seats.find((p) => p.player_id === id);
    if (!seat) return [];
    const result = resultFor(seat.role, g.winner!);
    const win = result === "win" ? 1 : 0;
    sides[sideOf(seat.role)].games++; sides[sideOf(seat.role)].wins += win;
    roles[seat.role].games++; roles[seat.role].wins += win;
    return [{ gameId: g.id, no: g.game_no, startsAt: g.played_at, format: g.format, role: seat.role, result,
      eveningId: g.evening_id, skillReason: reasons.get(g.id) ?? "" }];
  });
  return { sides, roles, history: history.reverse(), evenings: new Set(history.map((g) => g.eveningId)).size,
    ratingPoints: [{ gameId: null, startsAt: null, rating: 1000, sd: 100 }, ...league.ratings.players[id].history.map((h) => ({ ...h, startsAt: league.games.find((g) => g.id === h.gameId)!.played_at }))] };
}
