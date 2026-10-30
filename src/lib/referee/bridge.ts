import { z } from "zod";
import { importProtocol, derive, roleErrors } from "./engine";
import { MODEL, RULES, SHORT_RULES } from "../league/legacy/model";

const TargetSchema = z.object({ id: z.string().uuid(), revision: z.number().int().positive().safe(),
  format: z.enum(["classic10", "short9"]), status: z.literal("in_progress") });
export type RefereeTarget = z.infer<typeof TargetSchema>;

/** Prepare an admin review, never publish/save. Caller supplies a target loaded
 * uncached under requireAdmin, and EXPLICIT seat/account mapping. Nicknames are
 * never matched automatically. The private source protocol remains separate. */
export async function prepareRefereeResult(raw: string, target: RefereeTarget,
  mapping: Record<number, string>, hostId: string, knownPlayers: string[]) {
  TargetSchema.parse(target);
  z.string().uuid().parse(hostId);
  const draft = await importProtocol(raw);
  const table = derive(draft);
  if (draft.format !== target.format) throw new Error("Формат протокола не совпадает с партией");
  if (draft.status !== "completed_unapproved" || !table.result || table.result.confidence !== "observed") throw new Error("Нужен завершённый протокол с подтверждённым результатом");
  if (table.result.outcome === "cancelled") throw new Error("Отменённый протокол нельзя превратить в сыгранную партию");
  if (roleErrors(table.seats).length) throw new Error("Подтвердите все роли перед переносом");
  const known = new Set(knownPlayers);
  if (!known.has(hostId)) throw new Error("Ведущий не найден в реестре игроков");
  const seats = table.seats.map((p) => {
    const player = z.string().uuid().parse(mapping[p.number]);
    if (!known.has(player)) throw new Error(`Место ${p.number}: игрок не найден`);
    return { seat: p.number, player, role: p.role!, fouls: p.fouls, removed: p.removed };
  });
  if (new Set(seats.map((p) => p.player)).size !== seats.length || seats.some((p) => p.player === hostId)) throw new Error("Нужны разные игроки и отдельный ведущий");
  if (draft.host?.optionalPublicPlayerId && draft.host.optionalPublicPlayerId !== hostId) throw new Error("Явно разрешите несовпадение ведущего в исходном протоколе");
  return {
    rpc: { p_game: target.id, p_expected_revision: target.revision, p_host: hostId, p_seats: seats,
      p_winner: table.result.outcome === "draw" ? "draw" as const : table.result.winner!, p_finish: true,
      p_result_type: table.result.outcome === "technical" ? "technical" as const : "normal" as const,
      p_reason: table.result.basis },
    provenance: { draftId: draft.draftId, protocolSchema: draft.schema, regulation: draft.normativeRegulationId,
      modelVersion: MODEL, accountingRules: draft.format === "short9" ? SHORT_RULES : RULES },
    gaps: table.gaps,
  };
}
