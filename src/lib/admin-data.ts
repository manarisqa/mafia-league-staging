import type { SupabaseClient } from "@supabase/supabase-js";

// Данные для админки. БЕЗ кэша: здесь есть то, что не должен видеть посторонний
// (роли в идущих партиях, записи на вечер). Клиент приходит от вошедшего администратора.

export type AdminPlayer = {
  id: string;
  display_name: string;
  nickname: string | null;
  status: "club_member" | "newbie";
  user_id: string | null;
  revision: number;
};

export async function adminPlayers(db: SupabaseClient): Promise<AdminPlayer[]> {
  const { data, error } = await db
    .from("players")
    .select("id, display_name, nickname, status, user_id, revision")
    .order("display_name");
  if (error) throw new Error(`Не удалось загрузить игроков: ${error.message}`);
  return data;
}

export async function adminCounts(db: SupabaseClient) {
  const count = async (table: string, filter?: [string, string]) => {
    let q = db.from(table).select("id", { count: "exact", head: true });
    if (filter) q = q.eq(filter[0], filter[1]);
    const { count: n, error } = await q;
    if (error) throw new Error(`Не удалось посчитать ${table}: ${error.message}`);
    return n ?? 0;
  };
  const [players, evenings, games, playing] = await Promise.all([
    count("players"),
    count("evenings"),
    count("games"),
    count("games", ["status", "in_progress"]),
  ]);
  return { players, evenings, games, playing };
}

export type AdminEvening = {
  id: string;
  starts_at: string;
  place: string;
  capacity: number;
  status: "planned" | "finished" | "cancelled";
  host_player_id: string | null;
  note: string | null;
  revision: number;
  season_id: string | null;
};

export async function adminEvenings(db: SupabaseClient) {
  const { data, error } = await db
    .from("evenings")
    .select("id, starts_at, place, capacity, status, host_player_id, revision, season_id, evening_signups(status)")
    .order("starts_at", { ascending: false });
  if (error) throw new Error(`Не удалось загрузить вечера: ${error.message}`);
  return data.map((e) => ({
    ...(e as unknown as AdminEvening),
    note: null,
    signups: (e.evening_signups as { status: string }[] | null)?.filter((s) => s.status === "going" || s.status === "late").length ?? 0,
  }));
}

export async function adminEvening(db: SupabaseClient, id: string): Promise<AdminEvening | null> {
  const { data, error } = await db
    .from("evenings")
    .select("id, starts_at, place, capacity, status, host_player_id, revision, season_id, evening_notes(note)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Не удалось загрузить вечер: ${error.message}`);
  if (!data) return null;
  const notes = Array.isArray(data.evening_notes) ? data.evening_notes[0] : data.evening_notes;
  return { ...data, note: notes?.note ?? null } as AdminEvening;
}

export type AdminSignup = {
  player_id: string;
  revision: number;
  name: string;
  status: "going" | "late" | "maybe" | "not_going";
};

export async function adminSignups(db: SupabaseClient, eveningId: string): Promise<AdminSignup[]> {
  const { data, error } = await db
    .from("evening_signups")
    .select("player_id, status, revision, players(display_name)")
    .eq("evening_id", eveningId);
  if (error) throw new Error(`Не удалось загрузить записи: ${error.message}`);
  return data
    .map((s) => {
      const p = Array.isArray(s.players) ? s.players[0] : s.players;
      return { player_id: s.player_id, revision: Number(s.revision), status: s.status, name: p?.display_name ?? "—" } as AdminSignup;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export type AdminGame = {
  id: string;
  evening_id: string;
  game_no: number;
  revision: number;
  result_type: "normal" | "technical";
  result_reason: string;
  format: "classic10" | "short9";
  status: "in_progress" | "finished";
  winner: "red" | "black" | "draw" | null;
  host_player_id: string | null;
  seats: { seat: number; player_id: string; role: "civilian" | "sheriff" | "don" | "mafia"; fouls: number; removed: boolean }[];
};

const GAME_COLUMNS =
  "id, evening_id, game_no, format, status, winner, host_player_id, revision, result_type, result_reason, game_players(seat, player_id, role, fouls, removed)";

function toGame(row: Record<string, unknown>): AdminGame {
  const { game_players, ...rest } = row as { game_players: AdminGame["seats"] | null } & Omit<AdminGame, "seats">;
  return { ...rest, seats: [...(game_players ?? [])].sort((a, b) => a.seat - b.seat) };
}

export async function adminGamesOfEvening(db: SupabaseClient, eveningId: string): Promise<AdminGame[]> {
  const { data, error } = await db
    .from("games")
    .select(GAME_COLUMNS)
    .eq("evening_id", eveningId)
    .order("game_no");
  if (error) throw new Error(`Не удалось загрузить партии: ${error.message}`);
  return data.map(toGame);
}

export async function adminGame(db: SupabaseClient, id: string): Promise<AdminGame | null> {
  const { data, error } = await db.from("games").select(GAME_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`Не удалось загрузить партию: ${error.message}`);
  return data ? toGame(data) : null;
}

export async function adminAllGames(db: SupabaseClient) {
  const { data, error } = await db
    .from("games")
    .select("id, game_no, format, status, winner, evenings(starts_at)")
    .order("started_at", { ascending: false, nullsFirst: true });
  if (error) throw new Error(`Не удалось загрузить партии: ${error.message}`);
  return data.map((g) => {
    const ev = Array.isArray(g.evenings) ? g.evenings[0] : g.evenings;
    return {
      id: g.id as string,
      game_no: g.game_no as number,
      format: g.format as AdminGame["format"],
      status: g.status as AdminGame["status"],
      winner: g.winner as AdminGame["winner"],
      starts_at: (ev?.starts_at ?? null) as string | null,
    };
  });
}

export async function adminSeasons(db: SupabaseClient) {
  const { data, error } = await db.from("seasons").select("id, name").order("starts_on", { ascending: false });
  if (error) throw new Error("Не удалось загрузить сезоны");
  return data;
}
