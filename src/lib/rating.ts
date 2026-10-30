// The model is copied verbatim from v33. No tournament, role or MVP points.
export { side as sideOf, MODEL, MODEL_CONFIG } from "./league/legacy/model";
export type { Role } from "./league/legacy/model";
export type Winner = "red" | "black" | "draw";
import type { Role } from "./league/legacy/model";
import { side } from "./league/legacy/model";
export function resultFor(role: Role, winner: Winner): "win" | "loss" | "draw" {
  return winner === "draw" ? "draw" : side(role) === winner ? "win" : "loss";
}
