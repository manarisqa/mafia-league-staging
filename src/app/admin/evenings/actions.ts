"use server";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import type { FormState } from "@/lib/form-state";
import { viennaLocalToIso } from "@/lib/format";
import { isUuid } from "@/lib/validate";
import { expectedRevision, mutationError } from "@/lib/mutation";

export async function saveEvening(prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const id = String(form.get("id") ?? "");
  const revision = expectedRevision(form);
  const starts = viennaLocalToIso(String(form.get("starts_at") ?? ""));
  const place = String(form.get("place") ?? "").trim();
  const capacity = Number(form.get("capacity"));
  const status = String(form.get("status") ?? "");
  const host = String(form.get("host_player_id") ?? "");
  const season = String(form.get("season_id") ?? "");
  const note = String(form.get("note") ?? "").trim();
  if ((id && !isUuid(id)) || revision === null || !starts) return { message: "Проверьте дату и версию вечера." };
  if (place.length < 1 || place.length > 100 || note.length > 500) return { message: "Место: 1–100 символов, заметка: до 500." };
  if (![9, 10].includes(capacity) || !["planned", "finished", "cancelled"].includes(status)) return { message: "Проверьте число мест и статус." };
  if ((host && !isUuid(host)) || (season && !isUuid(season))) return { message: "Проверьте ведущего и сезон." };
  const { data, error } = await supabase.rpc("save_evening", { p_id: id || null, p_expected_revision: revision,
    p_starts_at: starts, p_place: place, p_capacity: capacity, p_status: status, p_host: host || null, p_note: note, p_season: season || null });
  if (error) return { ...prev, ...mutationError(error) };
  updateTag("club");
  if (!id) redirect(`/admin/evenings/${data.id}`);
  return { ok: true, revision: Number(data.revision), message: "Вечер и приватная заметка сохранены." };
}
export async function deleteEvening(prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const id = String(form.get("id") ?? "");
  const revision = expectedRevision(form);
  if (!isUuid(id) || revision === null) return { message: "Обновите страницу вечера." };
  const { error } = await supabase.rpc("delete_evening", { p_evening: id, p_expected_revision: revision });
  if (error) return mutationError(error);
  updateTag("club"); redirect("/admin/evenings");
}
export async function setSignup(prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const evening = String(form.get("evening_id") ?? "");
  const player = String(form.get("player_id") ?? "");
  const status = String(form.get("status") ?? "");
  const revision = expectedRevision(form);
  if (!isUuid(evening) || !isUuid(player) || revision === null || !["going", "late", "maybe", "not_going", "cancel"].includes(status)) return { message: "Проверьте запись и обновите страницу." };
  const { data, error } = await supabase.rpc("set_rsvp", { p_evening: evening, p_player: player, p_status: status, p_expected_revision: revision });
  if (error) return { ...prev, ...mutationError(error) };
  updateTag("club"); return { ok: true, revision: Number(data), message: status === "cancel" ? "Запись удалена." : "Запись сохранена." };
}
export async function removeSignup(prev: FormState, form: FormData): Promise<FormState> {
  form.set("status", "cancel");
  return setSignup(prev, form);
}
