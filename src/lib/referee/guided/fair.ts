import { seatCount, type Availability, type Format, type Player, type SeatHistory } from "./protocol";

export type AvailabilityRow = { id: string; status: Availability };
export type Round = { attendance: AvailabilityRow[]; host: string | null; players: string[] };
type Random = () => number;

export function secureRandom() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

export function queue(players: Player[], attendance: AvailabilityRow[], host: string | null, format: Format, rounds: Round[], random: Random = secureRandom) {
  const size = seatCount(format);
  const debt = new Map<string, number>();
  const runs = new Map<string, number>();
  const observed = new Set<string>();
  const played = new Set<string>();
  for (const round of rounds) {
    const eligible = round.attendance.filter((p) => p.status === "ready" && p.id !== round.host);
    const fraction = eligible.length ? Math.min(1, round.players.length / eligible.length) : 0;
    const field = new Set(eligible.map((p) => p.id));
    for (const p of round.attendance) {
      if (p.status === "observe" && p.id !== round.host && round.players.length && !round.players.includes(p.id)) observed.add(p.id);
      if (!field.has(p.id)) runs.delete(p.id);
    }
    for (const id of round.players) played.add(id);
    for (const { id } of eligible) {
      const selected = round.players.includes(id);
      debt.set(id, (debt.get(id) ?? 0) + fraction - Number(selected));
      const streak = runs.get(id) ?? 0;
      runs.set(id, selected ? Math.max(0, streak) + 1 : Math.min(0, streak) - 1);
    }
  }
  const registry = new Map(players.map((p) => [p.id, p]));
  return attendance
    .filter(({ id, status }) => id !== host && status === "ready" && registry.has(id))
    .map(({ id }) => ({
      id,
      weight: (debt.get(id) ?? 0) - 0.2 * (runs.get(id) ?? 0) +
        (registry.get(id)?.novice && observed.has(id) && !played.has(id) ? 1 : 0),
      tie: random(),
    }))
    .sort((a, b) => b.weight - a.weight || a.tie - b.tie)
    .slice(0, size).map((p) => p.id);
}

function shuffle<T>(values: readonly T[], random: Random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function fairSeats(roster: string[], format: Format, eligible: SeatHistory[], random: Random = secureRandom) {
  const size = seatCount(format);
  if (roster.length !== size || new Set(roster).size !== size) throw new Error("invalid_roster");
  const index = new Map(roster.map((id, i) => [id, i]));
  const counts = roster.map(() => Array<number>(size).fill(0));
  const last = new Map<number, number>();
  const pairTotal = roster.map(() => Array<number>(size).fill(0));
  const pairNear = roster.map(() => Array<number>(size).fill(0));
  const history = eligible.filter((game) => game.format === format)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

  for (const game of history) {
    const known = game.seats.flatMap((p) => {
      const who = index.get(p.player);
      return who === undefined || p.seat < 1 || p.seat > size || !Number.isInteger(p.seat) ? [] : [{ who, seat: p.seat - 1 }];
    });
    for (const { who, seat } of known) {
      counts[who][seat]++;
      last.set(who, seat);
      for (const other of known) {
        if (who === other.who) continue;
        pairTotal[who][other.who]++;
        if (Math.abs(seat - other.seat) === 1) pairNear[who][other.who]++;
      }
    }
  }
  const costs = counts.map((row, who) => {
    const total = row.reduce((sum, n) => sum + n, 0);
    return row.map((visits, seat) =>
      (1.8 * (visits - total / size)) / (total + size) + (last.get(who) === seat ? 0.36 : 0));
  });
  const prior = 2 / size;
  const pairCosts = pairTotal.map((row, who) => row.map((total, other) =>
    (0.7 * (pairNear[who][other] - total * prior)) / (total + size)));

  const order = roster.map((_, i) => i);
  const first = shuffle(order, random);
  // An explicit uniform component gives every valid global assignment positive probability.
  if (random() < 0.08 || !last.size) return first.map((i) => roster[i]);
  let winner = first;
  let mass = 0;
  for (let draw = 0; draw < 240; draw++) {
    const candidate = draw === 0 ? first : shuffle(order, random);
    const cost = candidate.reduce((sum, who, seat) => sum + costs[who][seat] +
      (seat ? pairCosts[candidate[seat - 1]][who] : 0), 0);
    const weight = Math.exp(-cost);
    mass += weight;
    if (random() * mass < weight) winner = candidate;
  }
  return winner.map((i) => roster[i]);
}

export function historyAt(history: SeatHistory[], format: Format, cut: string, roster: string[]) {
  const ids = new Set(roster);
  return history.filter((game) => game.format === format && game.at <= cut && game.seats.some((p) => ids.has(p.player)));
}
