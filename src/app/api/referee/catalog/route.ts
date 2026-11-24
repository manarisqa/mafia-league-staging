import { SnapshotSchema } from "@/lib/league/core";
import { getPublicClient } from "@/lib/supabase";

export async function GET() {
  const db = getPublicClient();
  const response = await db?.rpc("guided_catalog");
  let catalog = response?.data;
  if (db && response?.error?.code === "PGRST202") {
    // Existing Preview can still record on the device while the owner reviews the additive migration.
    const fallback = await db.rpc("league_snapshot");
    const legacy = SnapshotSchema.safeParse(fallback.data);
    if (legacy.success) {
      const { players, evenings, games } = legacy.data;
      catalog = {
        players: players.map((p) => ({ id: p.id, name: p.display_name, novice: p.status === "newbie" })),
        evenings: evenings.filter((e) => e.status === "planned" && Date.parse(e.starts_at) >= Date.now() - 64_800_000)
          .slice(0, 8).map((e) => ({
            id: e.id, place: e.place, startsAt: e.starts_at, host: e.host_player_id, confirmed: [],
            round: 1 + Math.max(0, ...games.filter((g) => g.evening_id === e.id).map((g) => g.game_no)),
          })),
        history: games.slice(-1000).map((g) => ({
          id: g.id, at: g.played_at, format: g.format,
          seats: g.seats.map((p) => ({ player: p.player_id, seat: p.seat })),
        })),
      };
    }
  }
  return Response.json(catalog ?? { error: "unavailable" }, {
    status: catalog ? 200 : 503, headers: { "Cache-Control": "no-store" },
  });
}
