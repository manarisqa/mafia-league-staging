import test from "node:test";
import assert from "node:assert/strict";
import { CURRENT_RULES_REVISION, FAIR_QUEUE, FAIR_SEAT, PROCEDURE, actionSchema, draftSchema, inEveningWindow, seatCount, type Action, type Draft, type Format } from "../src/lib/referee/guided/protocol";
import { append, checkAnswer, focusSeat, projection, replay, timing, validate } from "../src/lib/referee/guided/reducer";
import { fairSeats, queue, type Round } from "../src/lib/referee/guided/fair";

const advance: Action = { type: "advance", seconds: null };
const unknown: Action = { type: "check", mode: "unknown", seconds: null };
const uuid = (i: number) => "00000000-0000-4000-8000-" + String(i).padStart(12, "0");
const at = "2026-11-24T18:00:00Z";
const registry = Array.from({ length: 41 }, (_, index) => ({ id: uuid(index + 1), name: "QA " + (index + 1), novice: index > 10 }));

test("the planned-evening window includes the exact 18-hour boundary", () => {
  const now = Date.parse(at);
  assert(inEveningWindow("2026-11-24T01:00:00+01:00", now));
  assert(!inEveningWindow("2026-11-24T00:59:59.999+01:00", now));
  assert(inEveningWindow("2026-11-24T19:00:00Z", now));
  assert(!inEveningWindow("invalid", now));
});

function fixture(format: Format = "classic10") {
  const players = registry.slice(0, seatCount(format));
  const ids = players.map((p) => p.id);
  return {
    id: uuid(100), evening: uuid(101), round: 1, format, version: PROCEDURE, startedAt: at,
    host: { id: registry.at(-1)!.id, name: "QA Host" },
    players: players.map(({ id, name }) => ({ id, name })),
    organization: {
      queue: FAIR_QUEUE, seats: FAIR_SEAT, cut: at, eligibleGames: [], override: null, proposed: ids, original: ids,
      swaps: [], attendance: ids.map((id) => ({ id, status: "ready" as const })),
    },
    events: [],
  } satisfies Draft;
}

test("guided draft validation retains PostgreSQL IDs and timestamp strings on restore", () => {
  const draft = fixture();
  draft.id = "00000000-0000-0000-0000-0000000000a1";
  draft.startedAt = "2026-11-24T19:00+0100";
  assert.deepEqual(validate(JSON.parse(JSON.stringify(draft))).draft, draft);
  assert.throws(() => validate({ ...draft, id: "not-a-uuid" }));
  assert.throws(() => validate({ ...draft, startedAt: "2026-11-24T19:00+0199" }));
  assert.throws(() => validate({ ...draft, unexpected: true }));
});

test("protocol collection limits are checked before validating their elements", () => {
  const draft = fixture();
  const invalid = draftSchema.safeParse({ ...draft, players: Array(11).fill(null) });
  assert.equal(invalid.success, false);
  assert.deepEqual(invalid.error.issues.map(({ code, path }) => ({ code, path })), [
    { code: "too_big", path: ["players"] },
  ]);
  assert(actionSchema.safeParse({ type: "best", targets: [1, 2, 3], seconds: null }).success);
  const targets = actionSchema.safeParse({ type: "best", targets: [1, 2, 3, null], seconds: null });
  assert.equal(targets.success, false);
  assert.deepEqual(targets.error.issues.map(({ code, path }) => ({ code, path })), [
    { code: "too_big", path: ["targets"] },
  ]);
});

function flow(format: Format = "classic10", rulesRevision?: Draft["rulesRevision"]) {
  let d: Draft = fixture(format);
  if (rulesRevision) d = { ...d, rulesRevision };
  const now = () => replay(d).state;
  const run = (...actions: Action[]) => { for (const a of actions) d = append(d, a); return now(); };
  const roles = () => {
    const cards = [...Array<string>(seatCount(format) - 4).fill("civilian"), "sheriff", "mafia", "mafia", "don"] as const;
    cards.forEach((role, i) => run({ type: "role", seat: i + 1, role: role as "civilian" }));
    return now();
  };
  const firstDay = () => {
    roles();
    run(advance, advance);
    if (format === "classic10") run(advance, advance);
    else run(unknown, unknown);
    return run(advance, advance);
  };
  const speeches = (nominations: number[] = []) => {
    let index = 0;
    while (now().step === "speechReady") {
      run({ type: "speechStart" });
      if (nominations[index]) run({ type: "nominate", target: nominations[index] });
      run(advance);
      index++;
    }
    return now();
  };
  const night = () => { speeches(); return run(advance, advance, advance); };
  return { now, run, roles, firstDay, night, speeches, draft: () => d };
}

test("new Classic10 zero night records acquaintance without fabricating a check", () => {
  const f = flow();
  f.roles();
  assert.equal(f.run(advance).step, "agreement");
  assert.equal(timing(f.now()), 60);
  assert.equal(f.run(advance).step, "donAck");
  assert.equal(f.run(advance).step, "sheriffAck");
  assert.equal(timing(f.now()), 20);
  assert.throws(() => f.run(unknown));
  assert.equal(f.run(advance).step, "seating");
  assert.equal(timing(f.now()), 30);
  assert.equal(f.run(advance, advance).first, 1);
  assert.deepEqual(f.now().checks, []);
  assert.equal(f.night().step, "shot");
});

test("current Short9 has N0 checks, N1 checks, N2 first shot and no best move", () => {
  const f = flow("short9");
  f.roles();
  f.run(advance, advance);
  assert.equal(f.now().step, "donCheck");
  assert.equal(checkAnswer(f.now(), 6), "sheriff");
  f.run({ type: "check", mode: "observed", target: 6, answer: "sheriff", seconds: 3.6 },
    { type: "check", mode: "observed", target: 9, answer: "black", seconds: 4.1 }, advance, advance);
  assert.equal(f.night().step, "donCheck");
  assert.throws(() => f.run({ type: "shot", target: 2 }));
  f.run(unknown, unknown, advance, advance);
  assert.equal(f.night().step, "shot");
  f.run({ type: "shot", target: 1 }, unknown, unknown, advance);
  assert.equal(f.now().step, "morning");
  assert.equal(f.now().checks[0].seconds, 3.6);
});

test("cyclic speaking order, duplicate nominations and third foul debt during own and other speech", () => {
  const f = flow();
  f.firstDay();
  const foul = (seat: number): Action => ({ type: "discipline", seat, kind: "ordinary" });
  f.run({ type: "speechStart" }, { type: "nominate", target: 3 }, foul(1), foul(1), foul(1), foul(2), foul(2), foul(2));
  assert.equal(timing(f.now()), 60);
  f.run(advance, { type: "speechStart" });
  assert.equal(timing(f.now()), 10);
  assert.throws(() => f.run({ type: "nominate", target: 3 }));
  f.run({ type: "nominate", target: 4 });
  assert.throws(() => f.run({ type: "nominate", target: 5 }));
  f.run(advance);
  f.speeches();
  f.run(advance, { type: "count", value: 0 });
  assert.deepEqual(f.now().vote.counts, [0]);
  f.run({ type: "count", value: 1 }, { type: "confirmVote" }, advance, advance, advance);
  f.run({ type: "shotNone", mode: "miss" }, unknown, unknown, advance, advance);
  assert.equal(f.now().first, 2);
  for (let i = 0; i < 8; i++) f.run({ type: "speechStart" }, advance);
  assert.equal(focusSeat(f.now()), 1);
  assert.equal(timing(f.run({ type: "speechStart" })), 10);
});

test("discipline before and after announcement preserves only announced results and queues one skip", () => {
  const f = flow();
  f.firstDay();
  f.speeches([1, 2]);
  f.run(advance, { type: "count", value: 5 });
  f.run({ type: "discipline", seat: 5, kind: "remove", reason: "QA removal before announcement" });
  assert.equal(f.now().step, "dayAnnounce");
  assert.equal(f.now().vote.cancelled, true);
  f.run(advance);
  assert.deepEqual(f.now().last, []);
  f.run(advance, { type: "shot", target: 1 }, unknown, unknown, advance);
  assert.equal(f.now().step, "best");
  f.run({ type: "best", targets: [2, 3, 4], seconds: null }, advance);
  assert.equal(f.now().step, "last");
  f.run({ type: "discipline", seat: 4, kind: "remove", reason: "QA during last words" },
    { type: "discipline", seat: 8, kind: "remove", reason: "QA second removal" });
  assert.deepEqual(f.now().last, [1]);
  assert.equal(f.now().skipNext, true);
  f.run(advance);
  assert.equal(f.now().vote.cancelled, true);
  assert.equal(f.now().skipNext, false);
});

test("tie stages start empty, same group uses strict majority, all-out draw takes precedence", () => {
  const f = flow();
  f.firstDay();
  f.speeches([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  f.run(advance);
  for (let i = 0; i < 10; i++) f.run({ type: "count", value: 1 });
  assert.equal(f.run({ type: "confirmVote" }).step, "defense");
  for (let i = 1; i <= 10; i++) {
    assert.equal(focusSeat(f.now()), i);
    f.run(advance);
  }
  assert.deepEqual(f.now().vote.counts, []);
  for (let i = 0; i < 10; i++) f.run({ type: "count", value: 1 });
  assert.equal(f.run({ type: "confirmVote" }).step, "joint");
  assert.equal(f.run({ type: "joint", yes: 6 }, advance).terminal, "draw");
  for (let i = 1; i <= 10; i++) {
    assert.equal(focusSeat(f.now()), i);
    assert.throws(() => f.run({ type: "nominate", target: 2 }));
    f.run(advance);
  }
  assert.equal(f.run({ type: "finish" }).result?.outcome, "draw");
  assert.throws(() => f.run(advance));
});

test("three shoot-capable quiet nights stop the game and unknown shot cannot advance", () => {
  for (const format of ["classic10", "short9"] as const) {
    const f = flow(format);
    f.firstDay();
    if (format === "short9") {
      f.night(); f.run(unknown, unknown, advance, advance);
      assert.equal(f.now().quietNights, 0);
    }
    for (let n = 1; n <= 3; n++) {
      f.night(); f.run({ type: "shotNone", mode: "miss" }, unknown, unknown, advance);
      assert.equal(f.now().quietNights, n);
      if (n < 3) f.run(advance);
    }
    assert.equal(f.now().step, "finish");
    assert.equal(f.run({ type: "finish" }).result?.outcome, "draw");
  }
  const f = flow();
  f.firstDay();
  f.night();
  assert.equal(f.run({ type: "shotNone", mode: "unknown" }).step, "resolveNight");
  assert.equal(f.run(advance).terminal, "cancelled");
  f.run({ type: "finish" });
  assert.equal(projection(f.draft(), f.now()), null);
});

test("N1 pending target may check, best move accepts distinct exited targets except self", () => {
  const f = flow();
  f.firstDay();
  f.speeches([1, 2]);
  f.run(advance, { type: "count", value: 10 }, { type: "count", value: 0 }, { type: "confirmVote" }, advance, advance, advance);
  f.run({ type: "shot", target: 7 });
  assert.equal(checkAnswer(f.now(), 7), "sheriff");
  f.run({ type: "check", mode: "observed", target: 7, answer: "sheriff", seconds: 4 });
  assert.equal(checkAnswer(f.now(), 8), "black");
  assert.throws(() => f.run({ type: "check", mode: "observed", target: 8, answer: "red", seconds: 2 }));
  f.run({ type: "check", mode: "observed", target: 8, answer: "black", seconds: 5 }, advance);
  assert.equal(f.now().step, "best");
  assert.throws(() => f.run({ type: "best", targets: [7, 1, 2], seconds: null }));
  assert.equal(f.run({ type: "best", targets: [1, 2, 3], seconds: 12 }).step, "morning");
});

test("current rules allow both living roles to check the original roster after exits and require the full timed window", () => {
  for (const format of ["classic10", "short9"] as const) {
    const f = flow(format, CURRENT_RULES_REVISION);
    f.firstDay();
    const sheriff = seatCount(format) - 3;
    const don = seatCount(format);
    f.run({ type: "discipline", seat: 2, kind: "remove", reason: "QA direct removal" });
    f.speeches();
    f.run(advance, advance);
    if (format === "classic10") f.run({ type: "shot", target: sheriff });
    assert.equal(checkAnswer(f.now(), don), null);
    assert.equal(checkAnswer(f.now(), 2), "not_sheriff");
    assert.throws(() => f.run({ type: "check", mode: "noTarget", seconds: 19.9 }));
    const check: Action = { type: "check", mode: "observed", target: 2, answer: "not_sheriff", seconds: 20 };
    assert.throws(() => f.run({ ...check, seconds: 19 }));
    f.run(check);
    assert.equal(checkAnswer(f.now(), sheriff), null);
    assert.equal(checkAnswer(f.now(), 2), "red");
    assert.throws(() => f.run({ type: "check", mode: "unknown", seconds: 5 }));
    f.run({ type: "check", mode: "observed", target: 2, answer: "red", seconds: 20.4 });
    assert.equal(validate(JSON.parse(JSON.stringify(f.draft()))).state.step, "resolveNight");

    // A role removed before the check has no targets and no timed observation.
    const absent = flow(format, CURRENT_RULES_REVISION);
    absent.firstDay();
    absent.run({ type: "discipline", seat: don, kind: "remove", reason: "QA removed Don" });
    absent.speeches();
    absent.run(advance, advance);
    if (format === "classic10") absent.run({ type: "shotNone", mode: "miss" });
    assert.equal(checkAnswer(absent.now(), 2), null);
    assert.throws(() => absent.run(check));
    assert.equal(absent.run({ type: "check", mode: "absent", seconds: null }).step, "sheriffCheck");
  }
});

test("discipline revisions preserve old technical warnings and reject them for newly created games", () => {
  const warning: Action = { type: "discipline", seat: 2, kind: "technical", reason: "QA original rule" };
  const original = flow();
  original.firstDay();
  original.run(warning, warning);
  const restored = validate(JSON.parse(JSON.stringify(original.draft())));
  assert.equal(restored.draft.rulesRevision, undefined);
  assert.equal(restored.state.seats[1].warnings, 2);
  assert.equal(restored.state.seats[1].removed, true);
  original.speeches();
  original.run(advance, advance, { type: "shotNone", mode: "miss" });
  assert.equal(checkAnswer(original.now(), 2), null);
  original.run({ type: "check", mode: "noTarget", seconds: 4 });

  const current = flow("classic10", CURRENT_RULES_REVISION);
  current.firstDay();
  assert.throws(() => current.run(warning));
  for (let i = 1; i <= 4; i++) {
    const state = current.run({ type: "discipline", seat: 2, kind: "ordinary" });
    assert.equal(state.seats[1].fouls, i);
    assert.equal(state.seats[1].removed, i === 4);
    if (i === 3) assert.equal(state.seats[1].debt, true);
  }
  assert.throws(() => current.run({ type: "discipline", seat: 3, kind: "remove" }));
  assert.equal(current.run({ type: "discipline", seat: 3, kind: "remove", reason: "QA direct removal" }).seats[2].removed, true);
});

test("validation rejects invalid bindings and forged or duplicate actions including undone history", () => {
  const f = flow();
  f.firstDay();
  const draft = f.draft();
  assert.equal(validate(draft).state.step, "speechReady");
  assert.throws(() => validate({ ...draft, host: { id: draft.players[0].id, name: "QA" } }));
  const changed = { ...draft, events: [...draft.events, draft.events[0]] };
  assert.throws(() => validate(changed));
  const latest = draft.events.at(-1)!;
  f.run({ type: "undo", target: latest.id, reason: "QA undo" });
  assert.equal(f.now().step, "morning");
  f.run({ type: "redo", target: latest.id, reason: "QA redo" });
  assert.equal(f.now().step, "speechReady");
  assert.throws(() => validate({ ...f.draft(), events: f.draft().events.map((e, i) => i === 0 ? { ...e, action: advance } : e) }));
});

function seeded(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

test("FairQueue rotates 14 ready players and separates opt-out, late, novice and host", () => {
  const attendance = registry.slice(0, 14).map((p) => ({ id: p.id, status: "ready" as const }));
  const host = registry.at(-1)!.id;
  const rounds: Round[] = [];
  const random = seeded(112);
  for (let i = 0; i < 6; i++) {
    const players = queue(registry, attendance, host, "classic10", rounds, random);
    assert.equal(new Set(players).size, 10);
    rounds.push({ attendance, host, players });
  }
  for (const { id } of attendance) {
    const flags = rounds.map((r) => r.players.includes(id));
    assert([4, 5].includes(flags.filter(Boolean).length));
    assert(!flags.some((flag, i) => !flag && flags[i + 1] === false));
  }
  const all = registry.map((p, i) => ({ id: p.id, status: i === 1 ? "pause" as const : i === 2 ? "observe" as const : "ready" as const }));
  const selected = queue(registry, all, host, "short9", rounds, random);
  assert.equal(selected.length, 9);
  assert(!selected.includes(host) && !selected.includes(registry[1].id) && !selected.includes(registry[2].id));
  for (const n of [9, 10, 11, 14, 40]) {
    const field = registry.slice(0, n).map((p) => ({ id: p.id, status: "ready" as const }));
    assert.equal(queue(registry, field, host, "classic10", [], random).length, Math.min(n, 10));
  }
});

test("FairSeat is global, seeded, symmetric without observations and favors an underexposed seat", () => {
  const ids = registry.slice(0, 10).map((p) => p.id);
  const history = Array.from({ length: 30 }, (_, i) => ({
    id: uuid(200 + i), at, format: "classic10" as const, seats: [{ player: ids[0], seat: 1 }],
  }));
  assert.deepEqual(fairSeats(ids, "classic10", history, seeded(7)), fairSeats(ids, "classic10", history, seeded(7)));
  const exposure = Array<number>(10).fill(0), neutral = Array<number>(10).fill(0);
  const random = seeded(1506);
  for (let i = 0; i < 750; i++) {
    const selected = fairSeats(ids, "classic10", history, random);
    assert.equal(new Set(selected).size, 10);
    exposure[selected.indexOf(ids[0])]++;
    neutral[fairSeats(ids, "classic10", [], random).indexOf(ids[0])]++;
  }
  assert(exposure[1] > exposure[0] * 2, JSON.stringify(exposure));
  assert(neutral.every((n) => n >= 52 && n <= 100), JSON.stringify(neutral));
});
