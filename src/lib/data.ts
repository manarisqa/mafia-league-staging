import { cacheLife, cacheTag } from "next/cache";
import { DEMO_EVENING, DEMO_RECENT_GAMES, DEMO_TOP_PLAYERS, DEMO_LEAGUE_STATS } from "@/lib/demo";
import { FORMAT_LABEL, eveningParts, shortDate } from "@/lib/format";
import { EMPTY_SNAPSHOT, SnapshotSchema, projectLeague, profileStats, type PlayerStats, type SideStats } from "@/lib/league/core";
import type { Role, Winner } from "@/lib/rating";
import { getPublicClient } from "@/lib/supabase";
export type { SideStats } from "@/lib/league/core";

export function showDemoBadge() {
  return !getPublicClient() || process.env.NEXT_PUBLIC_SHOW_DEMO_BADGE === "true";
}
export type Player = { id: string; name: string; status: "club_member" | "newbie" };
export type RatedPlayer = Player & PlayerStats;

/** Only anonymous credentials enter the shared cache. SQL returns one public
 * MVCC snapshot: no private notes, account IDs or unfinished roles. */
async function getLeague() {
  "use cache";
  cacheLife("minutes"); cacheTag("club");
  const db = getPublicClient();
  if (!db) return projectLeague(EMPTY_SNAPSHOT);
  const { data, error } = await db.rpc("league_snapshot");
  if (error) throw new Error(`Не удалось загрузить лигу. Проверьте миграцию League Core: ${error.message}`);
  return projectLeague(SnapshotSchema.parse(data));
}
export async function getRating(): Promise<RatedPlayer[]> {
  const league = await getLeague();
  return league.snapshot.players.map((p) => ({ id: p.id, name: p.display_name, status: p.status, ...league.stats.get(p.id)! }))
    .sort((a, b) => b.rating - a.rating || b.skillGames - a.skillGames || a.name.localeCompare(b.name, "ru"));
}
export type NextEvening = {
  id: string | null; weekday: string; day: string; month: string; time: string; place: string;
  capacity: number; signedUp: number; hostName: string | null; participants: string[];
};
export async function getNextEvening(): Promise<NextEvening | null> {
  "use cache";
  cacheLife("minutes"); cacheTag("club");
  const db = getPublicClient();
  if (!db) return { ...DEMO_EVENING, id: null, hostName: "Игрок 11" };
  const { snapshot } = await getLeague();
  const ev = snapshot.evenings.filter((e) => e.status === "planned" && Date.parse(e.starts_at) > Date.now())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  if (!ev) return null;
  const { data, error } = await db.from("evening_participants").select("player_id").eq("evening_id", ev.id);
  if (error) throw new Error(`Не удалось загрузить участников: ${error.message}`);
  const ids = new Set((data ?? []).map((p) => p.player_id));
  const participants = snapshot.players.filter((p) => ids.has(p.id)).map((p) => p.display_name);
  return { id: ev.id, ...eveningParts(ev.starts_at), place: ev.place, capacity: ev.capacity,
    signedUp: participants.length, participants,
    hostName: snapshot.players.find((p) => p.id === ev.host_player_id)?.display_name ?? null };
}
export type RecentGame = { id: string; date: string; format: string; status: string };
export async function getRecentGames(limit = 3): Promise<RecentGame[]> {
  if (!getPublicClient()) return DEMO_RECENT_GAMES.slice(0, limit).map((g, i) => ({ id: String(i), ...g }));
  const { games } = await getLeague();
  return [...games].reverse().slice(0, limit).map((g) => ({ id: g.id, date: shortDate(g.played_at), format: FORMAT_LABEL[g.format], status: "Игра завершена" }));
}
export async function getLeagueStats(): Promise<{ value: string; label: string }[]> {
  if (!getPublicClient()) return DEMO_LEAGUE_STATS;
  const { snapshot, games } = await getLeague();
  return [
    { value: String(snapshot.players.length), label: "Игроков" },
    { value: String((await getHistory()).totals.evenings), label: "Вечеров в истории" },
    { value: String(games.length), label: "Сыграно партий" },
  ];
}
export async function getTopPlayers(limit = 3): Promise<{ place: number; name: string; rating: number; provisional?: boolean }[]> {
  if (!getPublicClient()) return DEMO_TOP_PLAYERS;
  return (await getRating()).filter((p) => p.skillGames > 0).slice(0, limit)
    .map((p, i) => ({ place: i + 1, name: p.name, rating: p.rating, provisional: p.provisional }));
}
export type HistoryGame = { id: string; no: number; format: keyof typeof FORMAT_LABEL; winner: Winner; players: number; playedAt: string; skillReason: string };
export type HistoryEvening = { id: string; number: number; startsAt: string; place: string; seasonId: string | null; participants: number; games: HistoryGame[] };
export type SeasonSummary = { id: string; name: string; startsOn: string; endsOn: string | null; evenings: number; games: number; players: number; redWins: number; blackWins: number; draws: number };
export type HistoryTotals = Omit<SeasonSummary, "id" | "name" | "startsOn" | "endsOn">;
function summarize(evenings: HistoryEvening[], ids: Map<string, Set<string>>): HistoryTotals {
  const games = evenings.flatMap((e) => e.games);
  return { evenings: evenings.length, games: games.length, players: new Set(evenings.flatMap((e) => [...ids.get(e.id) ?? []])).size,
    redWins: games.filter((g) => g.winner === "red").length, blackWins: games.filter((g) => g.winner === "black").length, draws: games.filter((g) => g.winner === "draw").length };
}
export async function getHistory(): Promise<{ evenings: HistoryEvening[]; seasons: SeasonSummary[]; totals: HistoryTotals }> {
  const league = await getLeague();
  const { snapshot, games } = league;
  const ids = new Map<string, Set<string>>();
  const reasons = new Map(league.state.games.map((g) => [g.id, g.eligibilityReason]));
  const evenings = snapshot.evenings.filter((e) => e.status !== "cancelled" && (e.status === "finished" || games.some((g) => g.evening_id === e.id)))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id))
    .map((e, i) => {
      const played = games.filter((g) => g.evening_id === e.id).sort((a, b) => a.game_no - b.game_no);
      const players = new Set(played.flatMap((g) => g.seats.map((p) => p.player_id))); ids.set(e.id, players);
      return { id: e.id, number: i + 1, startsAt: e.starts_at, place: e.place, seasonId: e.season_id, participants: players.size,
        games: played.map((g) => ({ id: g.id, no: g.game_no, format: g.format, winner: g.winner!, players: g.seats.length, playedAt: g.played_at, skillReason: reasons.get(g.id) ?? "" })) };
    }).reverse();
  return { evenings, seasons: snapshot.seasons.map((s) => ({ id: s.id, name: s.name, startsOn: s.starts_on, endsOn: s.ends_on,
    ...summarize(evenings.filter((e) => e.seasonId === s.id), ids) })), totals: summarize(evenings, ids) };
}
export type GameProtocol = { id: string; no: number; format: keyof typeof FORMAT_LABEL; winner: Winner; finishedAt: string | null; eveningId: string; eveningStartsAt: string; hostName: string | null; skillReason: string;
  seats: { seat: number; playerId: string; name: string; role: Role; fouls: number; removed: boolean }[] };
export async function getGameProtocol(id: string): Promise<GameProtocol | null> {
  const league = await getLeague();
  const g = league.games.find((g) => g.id === id);
  if (!g) return null;
  const names = new Map(league.snapshot.players.map((p) => [p.id, p.display_name]));
  return { id: g.id, no: g.game_no, format: g.format, winner: g.winner!, finishedAt: g.finished_at, eveningId: g.evening_id,
    eveningStartsAt: g.played_at, hostName: names.get(g.host_player_id!) ?? null,
    skillReason: league.state.games.find((x) => x.id === id)?.eligibilityReason ?? "",
    seats: g.seats.map((p) => ({ seat: p.seat, playerId: p.player_id, name: names.get(p.player_id) ?? "—", role: p.role, fouls: p.fouls, removed: p.removed })) };
}
export type PlayerProfile = Player & PlayerStats & {
  joinedOn: string | null; evenings: number; sides: Record<"red" | "black", SideStats>; roles: Record<Role, SideStats>;
} & ReturnType<typeof profileStats>;
export async function getPlayerProfile(id: string): Promise<PlayerProfile | null> {
  const league = await getLeague();
  const p = league.snapshot.players.find((p) => p.id === id);
  if (!p) return null;
  return { id: p.id, name: p.display_name, status: p.status, joinedOn: p.joined_on,
    ...league.stats.get(id)!, ...profileStats(league, id) };
}
