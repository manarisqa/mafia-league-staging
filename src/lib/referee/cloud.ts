import type { Draft } from "./engine";

export type RefereePlayer = { id: string; name: string };
export type RefereeGame = { id: string; revision: number; label: string; format: Draft["format"] };
export type CloudProtocol = {
  id: string;
  revision: number;
  checksum: string;
  title: string;
  format: Draft["format"];
  updated_at: string;
  approved_game_id: string | null;
};
export type CloudError = "unavailable" | "invalid" | "conflict" | "duplicate" | "denied" | "failed";
export type CloudResult<T> = { ok: true; value: T } | { ok: false; error: CloudError };
export type RefereeApproval = { game: string; gameRevision: number; host: string; seats: Record<number, string>; gapsReviewed: boolean };

export const CLOUD_COLUMNS = "id, revision, checksum, title, format, updated_at, approved_game_id";
