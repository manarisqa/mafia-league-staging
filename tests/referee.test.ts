import assert from "node:assert/strict";
import { test } from "node:test";
import { createCurrentDraft, append, derive, exportProtocol, importProtocol } from "../src/lib/referee/engine";
import { prepareRefereeResult } from "../src/lib/referee/bridge";
import type { Role } from "../src/lib/league/legacy/model";

test("original v33 protocol contract: votes, fouls, unknown observations, undo/redo and imports", async () => {
  await import("./fixtures/v33-referee-contract.mjs");
});
function setup(format: "classic10" | "short9" = "classic10") {
  let d = createCurrentDraft(format, "Synthetic club game", { localNickname: "Separate host" }, "2026-10-30T18:00:00Z");
  d.seats.forEach((_, i) => { d = append(d, { type: "role_recorded", seat: i + 1, role: (["don", "mafia", "mafia", "sheriff"][i] ?? "civilian") as Role }); });
  return d;
}
test("current Short9 keeps edition-specific N1 no-shot rule and exact round trip", async () => {
  let d = setup("short9"); d = append(d, { type: "phase_started", next: "night" });
  const checks = () => {
    d = append(d, { type: "role_check", kind: "don", target: 4, result: "sheriff" });
    d = append(d, { type: "role_check", kind: "sheriff", target: 1, result: "black" });
  };
  checks(); d = append(d, { type: "night_result", unobservedConfirmed: false });
  d = append(d, { type: "phase_started", next: "day" });
  d = append(d, { type: "vote_started" }); d = append(d, { type: "day_result" });
  d = append(d, { type: "phase_started", next: "night" });
  assert.equal(derive(d).round, 1);
  assert.throws(() => append(d, { type: "shot_observation", mode: "miss" }));
  checks(); d = append(d, { type: "night_result", unobservedConfirmed: false });
  assert.equal(derive(d).seats.filter((p) => p.alive).length, 9);
  assert.deepEqual(await importProtocol(await exportProtocol(d)), d);
});
test("bridge prepares actual engine output for existing CAS RPC, never infers player identities", async () => {
  let d = setup(); d = append(d, { type: "phase_started", next: "night" });
  d = append(d, { type: "night_result", unobservedConfirmed: false });
  d = append(d, { type: "phase_started", next: "day" });
  d = append(d, { type: "game_finished", outcome: "technical", winner: "red", basis: "Synthetic referee decision", confidence: "observed" });
  const id = (i: number) => `20000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
  const mapping = Object.fromEntries(d.seats.map((s) => [s.number, id(s.number)]));
  const target = { id: id(100), revision: 5, format: "classic10" as const, status: "in_progress" as const };
  const known = Array.from({ length: 11 }, (_, i) => id(i + 1)); const raw = await exportProtocol(d);
  const ready = await prepareRefereeResult(raw, target, mapping, id(11), known);
  assert.equal(ready.rpc.p_expected_revision, 5); assert.equal(ready.rpc.p_seats.length, 10);
  assert.equal(ready.rpc.p_result_type, "technical"); assert.equal(ready.provenance.draftId, d.draftId);
  assert.equal(ready.provenance.modelVersion, "team-logit-v1");
  await assert.rejects(prepareRefereeResult(raw, target, {}, id(11), known));
  await assert.rejects(prepareRefereeResult(raw, target, mapping, id(1), known), /ведущий|игроки/);
  await assert.rejects(prepareRefereeResult(raw, { ...target, format: "short9" }, mapping, id(11), known), /Формат/);
});
