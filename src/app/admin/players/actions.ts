"use server";
import { updateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import type { FormState } from "@/lib/form-state";
import { isUuid } from "@/lib/validate";
import { expectedRevision, mutationError } from "@/lib/mutation";

export async function savePlayer(prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const nickname = String(form.get("nickname") ?? "").trim();
  const status = String(form.get("status") ?? "");
  const revision = expectedRevision(form);
  if ((id && !isUuid(id)) || revision === null) return { message: "Обновите страницу профиля." };
  if (name.length < 1 || name.length > 60 || nickname.length > 40) return { message: "Имя: 1–60 символов, никнейм: до 40." };
  if (!["club_member", "newbie"].includes(status)) return { message: "Выберите статус." };
  const { data, error } = await supabase.rpc("save_player", { p_id: id || null, p_expected_revision: revision,
    p_name: name, p_nickname: nickname, p_status: status });
  if (error) return { ...prev, ...mutationError(error) };
  updateTag("club"); return { ok: true, revision: Number(data), message: id ? "Сохранено." : "Игрок добавлен." };
}
export async function deletePlayer(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const id = String(form.get("id") ?? "");
  const revision = expectedRevision(form);
  if (!isUuid(id) || revision === null) return { message: "Обновите страницу профиля." };
  const { error } = await supabase.rpc("delete_player", { p_player: id, p_expected_revision: revision });
  if (error) return mutationError(error);
  updateTag("club"); return { ok: true, message: "Игрок удалён." };
}
export async function linkAccount(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const historical = String(form.get("historical") ?? "");
  const [account, rawRevision] = String(form.get("account") ?? "").split(":");
  const accountRevision = Number(rawRevision);
  const historicalRevision = expectedRevision(form);
  if (!isUuid(historical) || !isUuid(account) || historicalRevision === null || !Number.isSafeInteger(accountRevision) || accountRevision < 1) return { message: "Выберите профиль и обновите страницу." };
  const { error } = await supabase.rpc("link_account", { historical, account,
    p_historical_revision: historicalRevision, p_account_revision: accountRevision });
  if (error) return mutationError(error);
  updateTag("club"); return { ok: true, message: "Аккаунт привязан. История сохранена." };
}
