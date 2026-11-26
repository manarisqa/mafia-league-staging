/** Original v33 engine, without the former app shell, auth, D1 or UI scaffolding.
 * It has no network or database writes. Rules editions stay in each protocol. */
import { ZodError } from "zod";
import {
  checksum, exportProtocol as exportFrozen, importProtocol as importFrozen,
  validateDraft as validateFrozen, type Draft,
} from "../league/legacy/referee-protocol";
import { normalizeProtocolTimestamp } from "../protocol-timestamp";

export {
  createDraft, createCurrentDraft, append, derive, suggestedResult,
  effectiveEvents, roleErrors, checksum,
  SCHEMA, REGULATION, CURRENT_REGULATION,
} from "../league/legacy/referee-protocol";
export type { Draft, Table, Command, RefEvent } from "../league/legacy/referee-protocol";

function replayWithOlderTimestamps(value: unknown, error: unknown, inEnvelope = false): Draft {
  if (!(error instanceof ZodError) || !error.issues.length || !error.issues.every((issue) => {
    if (issue.code !== "invalid_format" || issue.format !== "datetime") return false;
    if (inEnvelope && issue.path[0] !== "payload") return false;
    const path = inEnvelope ? issue.path.slice(1) : issue.path;
    return (path.length === 1 && path[0] === "gameStartAt")
      || (path.length === 3 && path[0] === "events" && path[2] === "observedAt");
  })) throw error;

  // The frozen schema has already checked the shape and collection limits.
  const original = value as Draft;
  const draft = validateFrozen({
    ...original,
    gameStartAt: normalizeProtocolTimestamp(original.gameStartAt),
    events: original.events.map((event) => ({
      ...event, observedAt: normalizeProtocolTimestamp(event.observedAt),
    })),
  });
  return {
    ...draft,
    gameStartAt: original.gameStartAt,
    events: draft.events.map((event, index) => ({ ...event, observedAt: original.events[index].observedAt })),
  };
}

export function validateDraft(value: unknown): Draft {
  try {
    return validateFrozen(value);
  } catch (error) {
    return replayWithOlderTimestamps(value, error);
  }
}

export async function exportProtocol(draft: Draft) {
  try {
    return await exportFrozen(draft);
  } catch (error) {
    replayWithOlderTimestamps(draft, error);
    return JSON.stringify({ payload: draft, sha256: await checksum(draft) }, null, 2);
  }
}

export async function importProtocol(raw: string) {
  try {
    return await importFrozen(raw);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    const envelope = JSON.parse(raw);
    const draft = replayWithOlderTimestamps(envelope?.payload, error, true);
    if (await checksum(draft) !== envelope.sha256) throw new Error("Контрольная сумма не совпадает.");
    return draft;
  }
}
