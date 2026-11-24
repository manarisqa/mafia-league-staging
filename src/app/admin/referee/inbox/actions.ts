"use server";

import { updateTag, revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { append, projection, validate } from "@/lib/referee/guided/reducer";
import { actionSchema } from "@/lib/referee/guided/protocol";

const reviewSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive().max(2147483647),
  action: z.enum(["approve", "clarify", "rejected", "archived", "correction"]),
  reason: z.string().trim().max(500),
  host: z.string().uuid().nullable(),
  checked: z.boolean(),
  correction: actionSchema.optional(),
}).strict();

export async function reviewDraft(raw: unknown): Promise<{ game?: string; error?: string; status?: string }> {
  const { supabase } = await requireAdmin();
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) return { error: "invalid" };
  const { id, revision, action, reason, host, checked, correction } = parsed.data;
  const { data, error } = await supabase.from("guided_referee_drafts").select("id,revision,status,payload,game_id")
    .eq("id", id).maybeSingle();
  if (error || !data) return { error: "unavailable" };
  if (action === "approve" && data.status === "approved" && [data.revision, data.revision - 1].includes(revision)) {
    return { game: data.game_id, status: data.status };
  }
  if (data.revision !== revision || !["submitted", "clarify"].includes(data.status)) return { error: "conflict" };

  let payload = null;
  let projected = null;
  try {
    if (["approve", "archived", "correction"].includes(action)) {
      const { draft, state } = validate(data.payload);
      if (action === "approve") {
        if (!checked || data.status !== "submitted") return { error: "invalid" };
        projected = projection(draft, state);
        if (!projected) return { error: "invalid" };
      } else if (action === "correction") {
        if (!correction || !["roleSwap", "note"].includes(correction.type)) return { error: "invalid" };
        payload = append(draft, correction);
      } else if (state.result?.outcome !== "cancelled") {
        return { error: "invalid" };
      }
    }
  } catch { return { error: "invalid" }; }

  const result = await supabase.rpc("guided_review", {
    p_id: id, p_revision: revision, p_action: action, p_reason: reason,
    p_host: host, p_projection: projected, p_payload: payload,
  });
  if (result.error) return { error: result.error.code === "40001" ? "conflict" : "invalid" };
  if (result.data?.error) return { error: result.data.error };
  if (action === "approve") updateTag("club");
  revalidatePath("/admin/referee/inbox");
  revalidatePath("/admin/referee/inbox/" + id);
  return { game: result.data?.game, status: result.data?.status };
}
