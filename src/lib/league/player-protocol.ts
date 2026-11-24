import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { getPublicClient } from "../supabase";
import type { ProtocolFact } from "./player-insights";

const factsSchema = z.array(z.object({
  gameId: z.string().uuid(),
  revision: z.number().int().nonnegative().safe(),
  bestHits: z.number().int().min(0).max(3).nullable(),
}).strict());

export async function getPlayerProtocolFacts(
  playerId: string, startDay: string | null, endDay: string | null,
): Promise<ProtocolFact[] | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("club");
  const db = getPublicClient();
  if (!db) return null;
  const { data, error } = await db.rpc("player_protocol_facts", { p_player: playerId, p_start: startDay, p_end: endDay });
  if (error) return null;
  const facts = factsSchema.safeParse(data);
  return facts.success ? facts.data : null;
}
