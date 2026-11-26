"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { checksum, validateDraft } from "@/lib/referee/engine";
import { prepareRefereeResult } from "@/lib/referee/bridge";
import { CLOUD_COLUMNS, type CloudError, type CloudProtocol, type CloudResult, type RefereeApproval } from "@/lib/referee/cloud";

const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const revisionSchema = z.number().int().safe().nonnegative();
const approvalSchema = z.object({
  game: z.guid(),
  gameRevision: revisionSchema.positive(),
  host: z.guid(),
  seats: z.record(z.string().regex(/^(?:[1-9]|10)$/), z.guid()),
  gapsReviewed: z.boolean(),
});

function cloudError(error: { code?: string }): { ok: false; error: CloudError } {
  switch (error.code) {
    case "PGRST202": case "PGRST205": case "42P01": case "42883":
      return { ok: false, error: "unavailable" };
    case "40001": case "40P01":
      return { ok: false, error: "conflict" };
    case "23505":
      return { ok: false, error: "duplicate" };
    case "42501":
      return { ok: false, error: "denied" };
    case "22023": case "23503": case "23514": case "P0001":
      return { ok: false, error: "invalid" };
    default:
      return { ok: false, error: "failed" };
  }
}

export async function loadCloudProtocol(id: string): Promise<CloudResult<{ meta: CloudProtocol; draft: ReturnType<typeof validateDraft> }>> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  const { data, error } = await supabase.from("referee_protocols")
    .select(`${CLOUD_COLUMNS}, payload`).eq("id", id).maybeSingle();
  if (error) return cloudError(error);
  if (!data) return { ok: false, error: "denied" };
  try {
    const { payload, ...meta } = data;
    const draft = validateDraft(payload);
    if (await checksum(draft) !== meta.checksum) return { ok: false, error: "invalid" };
    return { ok: true, value: { meta, draft } };
  } catch {
    return { ok: false, error: "invalid" };
  }
}

export async function saveCloudProtocol(payload: unknown, revision: number): Promise<CloudResult<CloudProtocol>> {
  const { supabase } = await requireAdmin();
  if (!revisionSchema.safeParse(revision).success) return { ok: false, error: "invalid" };
  let draft;
  try {
    if (Buffer.byteLength(JSON.stringify(payload)) > 2_000_000) return { ok: false, error: "invalid" };
    draft = validateDraft(payload);
  } catch {
    return { ok: false, error: "invalid" };
  }
  const { data: nextRevision, error } = await supabase.rpc("save_referee_protocol", {
    p_payload: draft, p_checksum: await checksum(draft), p_expected_revision: revision,
  });
  if (error) return cloudError(error);
  const { data, error: readError } = await supabase.from("referee_protocols")
    .select(CLOUD_COLUMNS).eq("id", draft.draftId).maybeSingle();
  if (readError) return cloudError(readError);
  if (!data || Number(data.revision) !== Number(nextRevision)) return { ok: false, error: "conflict" };
  return { ok: true, value: data };
}

export async function approveCloudProtocol(id: string, revision: number, selection: RefereeApproval): Promise<CloudResult<string>> {
  const { supabase } = await requireAdmin();
  const input = approvalSchema.safeParse(selection);
  if (!idSchema.safeParse(id).success || !revisionSchema.positive().safeParse(revision).success || !input.success) {
    return { ok: false, error: "invalid" };
  }
  const { data: row, error } = await supabase.from("referee_protocols")
    .select("revision,payload,checksum,approved_game_id").eq("id", id).maybeSingle();
  if (error) return cloudError(error);
  if (!row) return { ok: false, error: "denied" };
  if (Number(row.revision) !== revision) return { ok: false, error: "conflict" };
  if (row.approved_game_id && row.approved_game_id !== input.data.game) return { ok: false, error: "duplicate" };

  const { game, gameRevision, host, seats, gapsReviewed } = input.data;
  const [target, registry] = await Promise.all([
    supabase.from("games").select("id,format,status,revision").eq("id", game).maybeSingle(),
    supabase.from("players").select("id").in("id", [host, ...Object.values(seats)]),
  ]);
  if (target.error || registry.error) return { ok: false, error: "failed" };
  if (!target.data) return { ok: false, error: "invalid" };
  if (!row.approved_game_id && (target.data.status !== "in_progress" || Number(target.data.revision) !== gameRevision)) {
    return { ok: false, error: "conflict" };
  }
  let review;
  try {
    review = await prepareRefereeResult(JSON.stringify({ payload: row.payload, sha256: row.checksum }), {
      id: game, format: target.data.format, revision: gameRevision, status: "in_progress",
    }, seats, host, registry.data.map((p) => p.id));
  } catch {
    return { ok: false, error: "invalid" };
  }
  if (review.gaps.length && !gapsReviewed) return { ok: false, error: "invalid" };
  const { rpc } = review;
  const result = await supabase.rpc("approve_referee_protocol", {
    p_game: rpc.p_game, p_expected_revision: rpc.p_expected_revision, p_host: rpc.p_host,
    p_seats: rpc.p_seats, p_winner: rpc.p_winner, p_result_type: rpc.p_result_type, p_reason: rpc.p_reason,
    p_protocol: id, p_protocol_revision: revision, p_checksum: row.checksum,
  });
  if (result.error) return cloudError(result.error);
  updateTag("club");
  return { ok: true, value: game };
}
