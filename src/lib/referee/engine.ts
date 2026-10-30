/** Original v33 engine, without the former app shell, auth, D1 or UI scaffolding.
 * It has no network or database writes. Rules editions stay in each protocol. */
export {
  createDraft, createCurrentDraft, append, derive, validateDraft, suggestedResult,
  effectiveEvents, exportProtocol, importProtocol, roleErrors, checksum,
  SCHEMA, REGULATION, CURRENT_REGULATION,
} from "../league/legacy/referee-protocol";
export type { Draft, Table, Command, RefEvent } from "../league/legacy/referee-protocol";
