import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { adminPlayers } from "@/lib/admin-data";
import { fullDateTime } from "@/lib/format";
import { getLocale } from "@/lib/i18n/server";
import { CLOUD_COLUMNS, type CloudProtocol, type RefereeGame } from "@/lib/referee/cloud";
import { refereeText } from "@/lib/i18n/referee";
import { RefereeWorkbench } from "./workbench";

export async function generateMetadata(): Promise<Metadata> {
  return { title: refereeText(await getLocale(), "Пульт ведущего"), robots: { index: false } };
}

export default async function RefereePage() {
  const [{ supabase, user }, locale] = await Promise.all([requireAdmin(), getLocale()]);
  const [registry, cloud, targets] = await Promise.all([
    adminPlayers(supabase),
    supabase.from("referee_protocols").select(CLOUD_COLUMNS).order("updated_at", { ascending: false }),
    supabase.from("games").select("id,revision,game_no,format,evenings!inner(starts_at,place,status)")
      .eq("status", "in_progress").neq("evenings.status", "cancelled").order("played_at", { ascending: false }),
  ]);
  const games: RefereeGame[] = (targets.data ?? []).map((row) => {
    const evening = Array.isArray(row.evenings) ? row.evenings[0] : row.evenings;
    const label = evening ? `${fullDateTime(evening.starts_at, locale)} · ${evening.place} · №${row.game_no}` : `№${row.game_no}`;
    return { id: row.id, revision: Number(row.revision), format: row.format, label };
  });
  const players = registry.map((p) => ({ id: p.id, name: p.nickname?.trim() || p.display_name }));
  const nameCounts = new Map<string, number>();
  const keyOf = (name: string) => name.trim().normalize("NFKC").toLocaleLowerCase();
  for (const player of players) {
    const key = keyOf(player.name);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const duplicateOrder = new Map<string, number>();
  for (const player of players) {
    const key = keyOf(player.name);
    if ((nameCounts.get(key) ?? 0) > 1) {
      const index = (duplicateOrder.get(key) ?? 0) + 1;
      duplicateOrder.set(key, index);
      player.name = `${player.name.slice(0, 57)} · №${index}`;
    }
  }
  return <RefereeWorkbench key={user.id} owner={user.id} locale={locale} players={players} cloudItems={(cloud.data ?? []) as CloudProtocol[]} cloudAvailable={!cloud.error} games={games} />;
}
