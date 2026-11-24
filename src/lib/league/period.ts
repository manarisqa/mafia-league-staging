export const CLUB_QUARTERS = [1, 2, 3, 4] as const;
export type ClubQuarter = (typeof CLUB_QUARTERS)[number];
export type ClubPeriod =
  | { key: "all"; year: null; quarter: null; startDay: null; endDay: null }
  | { key: string; year: number; quarter: ClubQuarter | null; startDay: string; endDay: string };

export const ALL_CLUB_HISTORY = { key: "all", year: null, quarter: null, startDay: null, endDay: null } as const;

export function clubYearPeriod(year: number, quarter: ClubQuarter | null = null): ClubPeriod {
  const starts = ["01-01", "04-01", "07-01", "10-01"];
  const ends = ["03-31", "06-30", "09-30", "12-31"];
  return {
    key: quarter ? `${year}-q${quarter}` : String(year),
    year,
    quarter,
    startDay: `${year}-${quarter ? starts[quarter - 1] : starts[0]}`,
    endDay: `${year}-${quarter ? ends[quarter - 1] : ends[3]}`,
  };
}

export function parseClubPeriod(value: unknown): ClubPeriod | null {
  if (value === ALL_CLUB_HISTORY.key) return ALL_CLUB_HISTORY;
  if (typeof value !== "string") return null;
  const match = /^([1-9][0-9]{3})(?:-q([1-4]))?$/.exec(value);
  if (!match) return null;
  return clubYearPeriod(Number(match[1]), match[2] ? Number(match[2]) as ClubQuarter : null);
}

/** The day comes from clubDate so the calendar follows Graz local time. */
export function inClubPeriod(day: string, period: ClubPeriod): boolean {
  return period.startDay === null || (period.startDay <= day && day <= period.endDay);
}
