import { z } from "zod";

export function normalizeProtocolTimestamp(value: string) {
  return value.replace(/([+-][0-9]{2})([0-9]{2})$/, "$1:$2")
    .replace(/(T[0-9]{2}:[0-9]{2})(Z|[+-][0-9]{2}:[0-9]{2})$/, "$1:00$2");
}

const isoTimestamp = z.iso.datetime({ offset: true });

// Validate the ISO spelling while preserving the original bytes for checksums.
export const protocolTimestamp = z.string().refine(
  (value) => isoTimestamp.safeParse(normalizeProtocolTimestamp(value)).success,
  "Invalid ISO timestamp",
);
