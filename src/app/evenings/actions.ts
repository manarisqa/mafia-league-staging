"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { createServerSupabase } from "@/lib/supabase/server";
import { expectedRevision, mutationError } from "@/lib/mutation";
import { isUuid } from "@/lib/validate";

const STATUSES = ["going", "late", "maybe", "not_going"] as const;
const MESSAGE = {
  going: "Вы записаны: придёте вовремя.",
  late: "Вы записаны: опоздаете.",
  maybe: "Отмечено: возможно, придёте.",
  not_going: "Отмечено: не придёте.",
} as const;

/** Игрок сам записывается на вечер, меняет статус или отменяет запись. */
export async function rsvp(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const eveningId = String(formData.get("evening_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!isUuid(eveningId)) return { message: "Неверный вечер." };
  const cancel = status === "cancel";
  if (!cancel && !(STATUSES as readonly string[]).includes(status)) return { message: "Выберите вариант." };

  // Записываем только того игрока, который привязан к этому аккаунту.
  const { data: player } = await supabase
    .from("players")
    .select("id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!player) return { message: "Не найден профиль игрока. Напишите организатору." };

  const revision = expectedRevision(formData);
  if (revision === null) return { message: "Обновите страницу записи." };
  const { data: savedRevision, error } = await supabase.rpc("set_rsvp", {
    p_evening: eveningId, p_player: player.id, p_status: status, p_expected_revision: revision,
  });

  if (error) return { ..._prev, ...mutationError(error) };

  updateTag("club");
  return { ok: true, revision: Number(savedRevision), message: cancel ? "Запись отменена." : MESSAGE[status as (typeof STATUSES)[number]] };
}
