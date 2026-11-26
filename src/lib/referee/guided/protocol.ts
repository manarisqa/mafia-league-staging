import { z } from "zod";
import { protocolTimestamp as date } from "../../protocol-timestamp";

export const PROCEDURE = "mafia-league-guided-2026-11-24-v1";
export const CURRENT_RULES_REVISION = 2;
export const FAIR_SEAT = "fair-seat-v1";
export const FAIR_QUEUE = "fair-queue-v1";
export const roles = ["civilian", "sheriff", "mafia", "don"] as const;
export type Role = (typeof roles)[number];
export const formats = ["classic10", "short9"] as const;
export type Format = (typeof formats)[number];
export const seatCount = (format: Format) => format === "classic10" ? 10 : 9;

const uuid = z.guid();
const text = (max: number, min = 1) => z.string().trim().min(min).max(max)
  .regex(/^[^<>\u0000-\u001f\u007f]*$/u);
const seat = z.number().int().min(1).max(10);
const number = z.number().int().min(0).max(10);
const duration = z.number().finite().nonnegative().max(600).nullable();
const reason = text(500, 3);
const role = z.enum(roles);
const side = z.enum(["red", "black"]);
const player = z.object({ id: uuid, name: text(64) }).strict();
export const availability = z.enum(["ready", "observe", "pause", "left"]);
export type Availability = z.infer<typeof availability>;
const attendance = z.object({ id: uuid, status: availability }).strict();
const swap = z.object({ first: seat, second: seat, reason, at: date }).strict();
const actions = [
  z.object({ type: z.literal("role"), seat, role }).strict(),
  z.object({ type: z.literal("roleSwap"), first: seat, second: seat, reason }).strict(),
  z.object({ type: z.literal("advance"), seconds: duration }).strict(),
  z.object({ type: z.literal("speechStart") }).strict(),
  z.object({ type: z.literal("nominate"), target: seat }).strict(),
  z.object({ type: z.literal("discipline"), seat, kind: z.enum(["ordinary", "technical", "remove"]), reason: reason.optional() }).strict(),
  z.object({ type: z.literal("count"), value: number }).strict(),
  z.object({ type: z.literal("confirmVote") }).strict(),
  z.object({ type: z.literal("joint"), yes: number }).strict(),
  z.object({ type: z.literal("shot"), target: seat }).strict(),
  z.object({ type: z.literal("shotNone"), mode: z.enum(["miss", "unknown"]) }).strict(),
  z.object({ type: z.literal("check"), mode: z.enum(["observed", "unknown", "absent", "noTarget"]), target: seat.optional(), answer: z.enum(["sheriff", "not_sheriff", "red", "black"]).optional(), seconds: duration }).strict(),
  z.object({ type: z.literal("best"), targets: z.array(seat).length(3).nullable(), seconds: duration }).strict(),
  z.object({ type: z.literal("finish") }).strict(),
  z.object({ type: z.literal("exception"), outcome: z.enum(["technical", "cancelled"]), winner: side.optional(), reason }).strict(),
  z.object({ type: z.literal("note"), reason }).strict(),
  z.object({ type: z.literal("undo"), target: uuid, reason }).strict(),
  z.object({ type: z.literal("redo"), target: uuid, reason }).strict(),
] as const;

export const actionSchema = z.discriminatedUnion("type", actions);
export type Action = z.infer<typeof actionSchema>;
export const eventSchema = z.object({ id: uuid, at: date, action: actionSchema }).strict();
export type Event = z.infer<typeof eventSchema>;
export const draftSchema = z.object({
  version: z.literal(PROCEDURE),
  // The envelope stays compatible with the guest RPC. Omission identifies the original rules.
  rulesRevision: z.literal(CURRENT_RULES_REVISION).optional(),
  id: uuid,
  evening: uuid,
  round: z.number().int().positive().max(32767),
  format: z.enum(formats),
  startedAt: date,
  host: z.object({ id: uuid.nullable(), name: text(64, 0) }).strict(),
  players: z.array(player).min(9).max(10),
  organization: z.object({
    attendance: z.array(attendance).max(250),
    queue: z.literal(FAIR_QUEUE),
    proposed: z.array(uuid).max(10),
    override: reason.nullable(),
    seats: z.literal(FAIR_SEAT),
    cut: date,
    eligibleGames: z.array(uuid).max(1000),
    original: z.array(uuid).min(9).max(10),
    swaps: z.array(swap).max(60),
    abandoned: z.array(z.object({
      roster: z.array(uuid).min(9).max(10),
      cut: date, eligibleGames: z.array(uuid).max(1000), swaps: z.array(swap).max(60), reason,
    }).strict()).max(15).optional(),
  }).strict(),
  events: z.array(eventSchema).max(900),
}).strict();
export type Draft = z.infer<typeof draftSchema>;

export type Player = z.infer<typeof player> & { novice: boolean };
export type Evening = { id: string; place: string; startsAt: string; round: number; host: string | null; confirmed: string[] };
export type SeatHistory = { id: string; at: string; format: Format; seats: { player: string; seat: number }[] };
export type Catalog = { players: Player[]; evenings: Evening[]; history: SeatHistory[] };
export const emptyCatalog: Catalog = { players: [], evenings: [], history: [] };
export const inEveningWindow = (startsAt: string, now: number) => Date.parse(startsAt) >= now - 18 * 60 * 60 * 1000;
