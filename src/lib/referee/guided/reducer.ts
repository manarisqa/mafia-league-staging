import { actionSchema, draftSchema, roles, seatCount, type Action, type Draft, type Event, type Format, type Role } from "./protocol";

type Side = "red" | "black";
type Outcome = Side | "draw" | "cancelled";
type Step =
  | "roles" | "ready" | "agreement" | "donAck" | "sheriffAck" | "seating" | "morning"
  | "speechReady" | "speech" | "voteReady" | "count" | "confirmVote" | "defense" | "joint"
  | "dayAnnounce" | "nightReady" | "last" | "shot" | "donCheck" | "sheriffCheck" | "resolveNight"
  | "best" | "finish" | "review";
export type Result = { outcome: Outcome; technical: boolean; basis: string };
type Seat = { number: number; role: Role | null; alive: boolean; fouls: number; warnings: number; removed: boolean; debt: boolean };
type Vote = {
  candidates: number[]; counts: number[]; stage: number; exits: number[];
  defense: number; announced: boolean; cancelled: boolean; scores: number[] | null;
};
type Check = Extract<Action, { type: "check" }> & { role: "don" | "sheriff"; night: number };
export type State = {
  rulesRevision: 1 | NonNullable<Draft["rulesRevision"]>;
  format: Format; step: Step; phase: "setup" | "night" | "day"; day: number; night: number;
  seats: Seat[]; first: number; speaker: number | null; spoken: number[]; speechSeconds: number;
  nominations: { actor: number; target: number }[]; vote: Vote; last: number[];
  skipNext: boolean; shot: number | "miss" | "unknown" | null;
  checks: Check[]; nightStart: number; nightExit: number | null; quietNights: number;
  best: number[] | null; terminal: Outcome | null; result: Result | null;
  gaps: string[]; timedBy: string;
};

const emptyVote = (): Vote => ({
  candidates: [], counts: [], stage: 1, exits: [], defense: 0, announced: false, cancelled: false, scores: null,
});
const black = (role: Role | null) => role === "mafia" || role === "don";
export const alive = (s: State) => s.seats.filter((seat) => seat.alive);
export const roleLimit = (format: Format, role: Role) => ({ civilian: seatCount(format) - 4, sheriff: 1, mafia: 2, don: 1 })[role];
export const shoots = (s: State) => s.night >= (s.format === "short9" ? 2 : 1);

function need(ok: unknown): asserts ok {
  if (!ok) throw new Error("invalid_procedure");
}

function begin(draft: Draft): State {
  return {
    rulesRevision: draft.rulesRevision ?? 1, format: draft.format, step: "roles", phase: "setup",
    day: 0, night: 0, seats: draft.players.map((_, index) => ({
      number: index + 1, role: null, alive: true, fouls: 0, warnings: 0, removed: false, debt: false,
    })),
    first: 0, speaker: null, spoken: [], speechSeconds: 60,
    nominations: [], vote: emptyVote(), skipNext: false, last: [],
    shot: null, checks: [], nightStart: 0, nightExit: null, quietNights: 0,
    best: null, terminal: null, result: null, gaps: [], timedBy: draft.id,
  };
}

function outcome(s: State): Outcome | null {
  if (s.seats.some((p) => !p.role)) return null;
  const remaining = alive(s);
  const count = remaining.filter((p) => black(p.role)).length;
  if (!remaining.length) return "draw";
  if (!count) return "red";
  return count >= remaining.length - count ? "black" : null;
}

function eliminate(s: State, seats: number[]) {
  if (seats.length) s.quietNights = 0;
  for (const n of seats) s.seats[n - 1].alive = false;
  s.terminal = outcome(s);
}

export function nextSpeaker(s: State) {
  for (let offset = 0; offset < s.seats.length; offset++) {
    const seat = (s.first - 1 + offset) % s.seats.length + 1;
    if (s.seats[seat - 1]?.alive && !s.spoken.includes(seat)) return seat;
  }
  return null;
}

function afterSpeech(s: State) {
  s.speaker = null;
  s.step = nextSpeaker(s) ? "speechReady" : s.vote.cancelled ? "dayAnnounce" : "voteReady";
}

function startNight(s: State) {
  s.phase = "night";
  s.night = s.day;
  s.nightStart = alive(s).length;
  s.shot = null;
  s.nightExit = null;
  s.step = s.night === 0 ? "agreement" : shoots(s) ? "shot" : "donCheck";
}

function startDay(s: State) {
  s.phase = "day";
  s.day++;
  s.spoken = [];
  s.nominations = [];
  s.vote = emptyVote();
  s.vote.cancelled = s.skipNext;
  s.skipNext = false;
  for (let i = 0; i < s.seats.length; i++) {
    s.first = s.first % s.seats.length + 1;
    if (s.seats[s.first - 1].alive) break;
  }
  afterSpeech(s);
}

function remove(s: State, p: Seat) {
  p.removed = true;
  eliminate(s, [p.number]);
  if (s.phase === "day" && !s.vote.announced) {
    s.vote.cancelled = true;
    s.vote.exits = [];
    if (s.step === "speech" && s.speaker === p.number) afterSpeech(s);
    if (!["speech", "speechReady"].includes(s.step)) s.step = "dayAnnounce";
  } else {
    s.skipNext = true;
  }
  if (s.terminal) s.skipNext = false;
  if (s.terminal && s.step !== "last" && !(s.step === "morning" && s.nightExit)) {
    s.speaker = null;
    s.step = "finish";
  }
}

export function checkingSeat(s: State) {
  if (s.step !== "donCheck" && s.step !== "sheriffCheck") return;
  const role = s.step === "donCheck" ? "don" : "sheriff";
  return s.seats.find((p) => p.role === role);
}

export function checkAnswer(s: State, target: number) {
  const actor = checkingSeat(s);
  const player = s.seats[target - 1];
  if (!actor?.alive || !player?.role || actor.number === target || (s.rulesRevision === 1 && !player.alive)) return null;
  return actor.role === "don" ? (player.role === "sheriff" ? "sheriff" : "not_sheriff") : black(player.role) ? "black" : "red";
}

export function timing(s: State): number | null {
  switch (s.step) {
    case "agreement": case "last": return 60;
    case "seating": case "defense": return 30;
    case "sheriffAck": case "donCheck": case "sheriffCheck": case "best": return 20;
    case "speech": return s.speechSeconds;
    default: return null;
  }
}

export function focusSeat(s: State) {
  switch (s.step) {
    case "speechReady": return nextSpeaker(s);
    case "speech": return s.speaker;
    case "defense": return s.vote.candidates[s.vote.defense];
    case "last": return s.last[0];
    case "count": return s.vote.candidates[s.vote.counts.length];
    case "best": return s.nightExit;
    case "roles": return s.seats.find((p) => !p.role)?.number;
    default: return null;
  }
}

function resolveNight(s: State) {
  // An unknown shot cannot be treated as a miss or resumed into the next day.
  if (s.shot === "unknown") {
    s.gaps.push("unknownShot");
    s.terminal = "cancelled";
    s.step = "finish";
    return;
  }
  if (typeof s.shot === "number" && s.seats[s.shot - 1].alive) {
    s.nightExit = s.shot;
    eliminate(s, [s.shot]);
  } else if (typeof s.shot === "number") {
    s.gaps.push("targetRemoved");
  }
  if (shoots(s) && !s.nightExit && s.nightStart === alive(s).length) {
    s.quietNights++;
    if (s.quietNights === 3) s.terminal = "draw";
  }
  if (s.format === "classic10" && s.night === 1 && s.nightExit && s.nightStart >= 9 && !s.terminal) {
    s.step = "best";
  } else {
    s.step = s.terminal && !s.nightExit ? "finish" : "morning";
  }
}

function advance(s: State) {
  switch (s.step) {
    case "ready": startNight(s); break;
    case "agreement": s.step = s.format === "classic10" ? "donAck" : "donCheck"; break;
    case "donAck": s.step = "sheriffAck"; break;
    case "sheriffAck": s.step = "seating"; break;
    case "seating": s.step = "morning"; break;
    case "morning":
      if (s.nightExit) { s.last = [s.nightExit]; s.step = "last"; }
      else startDay(s);
      break;
    case "speech": afterSpeech(s); break;
    case "voteReady":
      s.vote.candidates = s.nominations.map((p) => p.target);
      if (s.vote.candidates.length < 2) {
        s.vote.exits = s.day > 1 ? [...s.vote.candidates] : [];
        s.step = "dayAnnounce";
      } else s.step = "count";
      break;
    case "defense":
      s.vote.defense++;
      if (s.vote.defense === s.vote.candidates.length) {
        s.vote.stage++;
        s.vote.counts = [];
        s.step = "count";
      }
      break;
    case "dayAnnounce":
      s.vote.announced = true;
      eliminate(s, s.vote.exits);
      s.last = [...s.vote.exits];
      s.step = s.last.length ? "last" : s.terminal ? "finish" : "nightReady";
      break;
    case "last":
      s.last.shift();
      if (!s.last.length) {
        if (s.terminal) s.step = "finish";
        else if (s.phase === "night") startDay(s);
        else s.step = "nightReady";
      }
      break;
    case "nightReady": startNight(s); break;
    case "resolveNight": resolveNight(s); break;
    default: need(false);
  }
}

function apply(s: State, action: Exclude<Action, { type: "undo" | "redo" }>) {
  const current = s.step;
  const target = (n: number) => {
    const p = s.seats[n - 1];
    need(p);
    return p;
  };
  const durations = timing(s);
  if (s.result) need(action.type === "note" || action.type === "roleSwap");
  if (action.type === "advance" || action.type === "check" || action.type === "best") {
    // Actual observation can outlast a preset; the preset is never recorded as the observation.
    need(action.seconds === null || durations !== null);
  }
  switch (action.type) {
    case "role": {
      const p = target(action.seat);
      need(current === "roles" && focusSeat(s) === action.seat);
      need(s.seats.filter((x) => x.role === action.role).length < roleLimit(s.format, action.role));
      p.role = action.role;
      if (s.seats.every((x) => x.role)) s.step = "ready";
      break;
    }
    case "roleSwap": {
      const first = target(action.first), second = target(action.second);
      need(first.role && second.role && first.role !== second.role);
      [first.role, second.role] = [second.role, first.role];
      if (s.phase !== "setup") {
        s.gaps.push("lateRoles");
        if (s.result && !s.result.technical && ["red", "black"].includes(s.result.outcome)) {
          const corrected = outcome(s);
          need(corrected);
          s.terminal = corrected;
          s.result.outcome = corrected;
        } else if (s.step === "finish" && s.terminal !== "cancelled" && s.terminal !== "draw") {
          const corrected = outcome(s);
          need(corrected);
          s.terminal = corrected;
        } else if (!s.terminal) {
          s.terminal = outcome(s);
          if (s.terminal && !["last", "morning"].includes(s.step)) s.step = "finish";
        }
      }
      break;
    }
    case "advance": advance(s); break;
    case "speechStart": {
      const n = nextSpeaker(s);
      need(current === "speechReady" && n);
      const speaker = target(n);
      s.speaker = n;
      s.spoken.push(n);
      s.speechSeconds = !speaker.debt ? 60 : [3, 4].includes(alive(s).length) ? 30 : 10;
      speaker.debt = false;
      s.step = "speech";
      break;
    }
    case "nominate":
      need(current === "speech" && s.speaker && !s.vote.cancelled && target(action.target).alive);
      need(!s.nominations.some((nom) => nom.target === action.target || nom.actor === s.speaker));
      s.nominations.push({ actor: s.speaker, target: action.target });
      break;
    case "discipline": {
      const p = target(action.seat);
      need(s.phase !== "setup" && !s.terminal && p.alive);
      if (action.kind === "ordinary") {
        need(!action.reason);
        p.fouls++;
        if (p.fouls === 3) p.debt = true;
        if (p.fouls === 4) remove(s, p);
      } else {
        need(action.reason);
        if (action.kind === "technical") {
          need(s.rulesRevision === 1);
          p.warnings++;
        }
        if (action.kind === "remove" || p.warnings === 2) remove(s, p);
      }
      break;
    }
    case "count":
      need(current === "count" && action.value <= remainingVotes(s));
      s.vote.counts.push(action.value);
      if (s.vote.counts.length === s.vote.candidates.length) s.step = "confirmVote";
      break;
    case "confirmVote": {
      need(current === "confirmVote");
      const scores = [...s.vote.counts];
      scores[scores.length - 1] += remainingVotes(s);
      s.vote.scores = scores;
      const leaders = s.vote.candidates.filter((_, i) => scores[i] === Math.max(...scores));
      if (leaders.length === 1) {
        s.vote.exits = leaders; s.step = "dayAnnounce";
      } else if (s.vote.stage > 1 && leaders.length === scores.length) {
        s.step = "joint";
      } else {
        s.vote.candidates = leaders; s.vote.defense = 0; s.step = "defense";
      }
      break;
    }
    case "joint":
      need(current === "joint" && action.yes <= alive(s).length);
      s.vote.exits = action.yes > alive(s).length / 2 ? [...s.vote.candidates] : [];
      s.step = "dayAnnounce";
      break;
    case "shot":
      need(current === "shot" && target(action.target).alive);
      s.shot = action.target; s.step = "donCheck"; break;
    case "shotNone":
      need(current === "shot");
      s.shot = action.mode;
      s.step = action.mode === "unknown" ? "resolveNight" : "donCheck";
      break;
    case "check": {
      need(current === "donCheck" || current === "sheriffCheck");
      const role = current === "donCheck" ? "don" : "sheriff";
      const actor = checkingSeat(s);
      if (s.rulesRevision !== 1 && actor?.alive && action.seconds !== null) {
        need(durations !== null && action.seconds >= durations);
      }
      if (action.mode === "observed") {
        need(action.target && action.answer && checkAnswer(s, action.target) === action.answer);
      } else {
        need(action.answer === undefined);
        if (action.target) need(action.mode === "unknown" && checkAnswer(s, action.target));
        if (action.mode === "absent") need(!actor?.alive);
        if (action.mode === "noTarget") need(actor?.alive);
        if (action.mode === "unknown") s.gaps.push("unknownCheck");
      }
      s.checks.push({ ...action, role, night: s.night });
      s.step = current === "donCheck" ? "sheriffCheck" : s.night === 0 ? "seating" : "resolveNight";
      break;
    }
    case "best":
      need(current === "best");
      if (action.targets) {
        need(new Set(action.targets).size === 3 && !action.targets.includes(s.nightExit!));
        action.targets.forEach(target);
        s.best = action.targets;
      } else s.gaps.push("unknownBest");
      s.step = "morning";
      break;
    case "finish":
      need(current === "finish" && s.terminal);
      s.result = { outcome: s.terminal, technical: false, basis: s.terminal === "cancelled" ? "§10.4 / §15.4" : s.terminal === "draw" ? s.quietNights >= 3 ? "§16.1" : "§3.2 / §9.5" : "§3.2" };
      s.step = "review";
      break;
    case "exception":
      need(s.phase !== "setup" && !s.terminal && (action.outcome === "technical") === !!action.winner);
      s.result = { outcome: action.winner ?? "cancelled", technical: action.outcome === "technical", basis: action.reason };
      s.step = "review";
      break;
    case "note": break;
  }
}

function transition(state: State, event: Event) {
  const s = structuredClone(state);
  const { action } = event;
  need(action.type !== "undo" && action.type !== "redo");
  const before = s.step;
  const beforeSeat = focusSeat(s);
  apply(s, action);
  if (s.step !== before || focusSeat(s) !== beforeSeat) s.timedBy = event.id;
  return s;
}

export const remainingVotes = (s: State) => alive(s).length - s.vote.counts.reduce((sum, count) => sum + count, 0);

export function replay(draft: Draft) {
  let state = begin(draft);
  const active: { event: Event; before: State }[] = [];
  const undone: Event[] = [];
  const ids = new Set<string>();
  for (const event of draft.events) {
    need(!ids.has(event.id));
    ids.add(event.id);
    const action = event.action;
    if (action.type === "undo") {
      const prev = active.pop();
      need(prev?.event.id === action.target);
      state = prev.before;
      undone.push(prev.event);
      continue;
    }
    if (action.type === "redo") {
      const next = undone.pop();
      need(next?.id === action.target);
      active.push({ event: next, before: state });
      state = transition(state, next);
      continue;
    }
    active.push({ event, before: state });
    state = transition(state, event);
    undone.length = 0;
  }
  return { state, undo: active.at(-1)?.event.id, redo: undone.at(-1)?.id };
}

export function validate(value: unknown) {
  const draft = draftSchema.parse(value);
  const ids = draft.players.map((p) => p.id);
  const org = draft.organization;
  const present = new Map(org.attendance.map((p) => [p.id, p.status]));
  need(ids.length === seatCount(draft.format) && new Set(ids).size === ids.length);
  need(!draft.host.id || !ids.includes(draft.host.id));
  need(present.size === org.attendance.length);
  need(ids.every((id) => present.get(id) === "ready" || present.get(id) === "observe"));
  need(new Set(org.proposed).size === org.proposed.length && org.proposed.every((id) => present.get(id) === "ready" && id !== draft.host.id));
  need(org.override || (org.proposed.length === ids.length && ids.every((id) => org.proposed.includes(id))));
  const order = [...org.original];
  need(order.length === ids.length && new Set(order).size === ids.length && order.every((id) => ids.includes(id)));
  for (const change of org.swaps) {
    const { first, second } = change;
    need(first !== second && first <= order.length && second <= order.length);
    [order[first - 1], order[second - 1]] = [order[second - 1], order[first - 1]];
  }
  need(order.every((id, i) => id === ids[i]) && new Set(org.eligibleGames).size === org.eligibleGames.length);
  return { draft, ...replay(draft) };
}

export function append(draft: Draft, action: Action): Draft {
  need(draft.events.length < 900);
  const next = { ...draft, events: [...draft.events, { id: crypto.randomUUID(), at: new Date().toISOString(), action: actionSchema.parse(action) }] };
  replay(next);
  return next;
}

export function projection(draft: Draft, state: State) {
  const result = state.result;
  if (!result || result.outcome === "cancelled" || state.seats.some((p) => !p.role)) return null;
  return {
    winner: result.outcome, type: result.technical ? "technical" : "normal", reason: result.basis,
    seats: state.seats.map((p, index) => ({
      seat: p.number, player: draft.players[index].id, role: p.role!, fouls: p.fouls, removed: p.removed,
    })),
  };
}

export const roleOrder = roles;

export const bestHits = (state: State) => state.best?.filter((n) => black(state.seats[n - 1].role)).length;
