import { z } from "zod";
import { isoToViennaLocal } from "./format";

const MAX_PERIOD_DAYS = 366;
const DAY_MS = 86_400_000;

export type AnalyticsRange = { from: string; to: string };

function validDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01") return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function analyticsRange(
  from: unknown,
  to: unknown,
  now = new Date(),
): { range: AnalyticsRange; invalid: boolean; defaults: AnalyticsRange } {
  const viennaToday = isoToViennaLocal(now.toISOString()).slice(0, 10);
  const calendarDay = Date.parse(viennaToday + "T00:00:00Z");
  const shifted = (days: number) => new Date(calendarDay + days * DAY_MS).toISOString().slice(0, 10);
  const defaults = { from: shifted(-89), to: shifted(14) };
  if (from === undefined && to === undefined) return { range: defaults, defaults, invalid: false };
  if (validDay(from) && validDay(to) && from <= to && Date.parse(to) - Date.parse(from) < MAX_PERIOD_DAYS * DAY_MS) {
    return { range: { from, to }, defaults, invalid: false };
  }
  return { range: defaults, defaults, invalid: true };
}

const count = z.number().int().nonnegative();
const nullableCount = count.nullable();

export const ClubAnalyticsSchema = z.object({
  evenings: z.object({
    scheduled: count,
    upcoming: count,
    held: count,
    cancelled: count,
    unresolved: count,
    recorded: count,
    visits: nullableCount,
  }),
  games: z.object({ classic10: count, short9: count, players: count }),
  rsvp: z.object({ confirmed: count, matched: count }),
  people: z.object({
    unique: count,
    first: count,
    returning: count,
    eligible: count,
    returned: count,
    gaps: count,
    medianDays: z.number().nonnegative().nullable(),
  }),
  months: z.array(z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    held: count,
    recorded: count,
    visits: nullableCount,
    games: count,
  })),
  recent: z.array(z.object({
    id: z.guid(),
    place: z.string(),
    starts_at: z.string(),
    attendance: nullableCount,
    games: count,
    confirmed: nullableCount,
    matched: nullableCount,
  })).max(12),
});

export type ClubAnalytics = z.infer<typeof ClubAnalyticsSchema>;
