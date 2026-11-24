import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { projectLeague, SnapshotSchema } from "../src/lib/league/core";

const league = projectLeague(SnapshotSchema.parse(JSON.parse(readFileSync(0, "utf8"))));
const results = [...league.stats.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, stats]) => ({
  stats, history: league.ratings.players[id].history,
}));
const games = league.state.games.map(({ id, eligible, eligibilityReason }) => ({ id, eligible, eligibilityReason }));
console.log(createHash("sha256").update(JSON.stringify({ model: league.modelVersion, games, results })).digest("hex"));
