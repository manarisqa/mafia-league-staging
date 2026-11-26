import assert from "node:assert/strict";
import test from "node:test";
import { mergeRecoveredDraft, type LocalDraft } from "../src/app/referee/local";
import { CURRENT_RULES_REVISION, FAIR_QUEUE, FAIR_SEAT, PROCEDURE } from "../src/lib/referee/guided/protocol";

const id = "10000000-0000-4000-8000-000000000001";
const at = "2026-11-26T12:00:00Z";
const record: LocalDraft = {
  draft: {
    id, version: PROCEDURE, rulesRevision: CURRENT_RULES_REVISION, evening: id, round: 1,
    format: "classic10", startedAt: at, host: { id: null, name: "QA" }, players: [], events: [],
    organization: { attendance: [], proposed: [], original: [], swaps: [], override: null,
      cut: at, eligibleGames: [], queue: FAIR_QUEUE, seats: FAIR_SEAT },
  },
  secret: "", serial: 2, revision: 3, status: "draft", synced: 0, outbox: false, note: null,
};

test("code recovery rejects a stale revision or unacknowledged local edits", () => {
  assert.throws(() => mergeRecoveredDraft(record, { ...record, revision: 2 }), /conflict/);
  assert.throws(() => mergeRecoveredDraft({ ...record, synced: -1 }, { ...record, revision: 4 }), /conflict/);
  assert.equal(mergeRecoveredDraft(record, { ...record, revision: 4 }).revision, 4);
});

test("code recovery preserves a queued submission until the server acknowledges it", () => {
  const queued = { ...record, outbox: true };
  assert.equal(mergeRecoveredDraft(queued, record).outbox, true);
  assert.throws(() => mergeRecoveredDraft(queued, { ...record, revision: 4 }), /conflict/);
  assert.equal(mergeRecoveredDraft(queued, { ...record, revision: 4, status: "submitted" }).outbox, false);
});
