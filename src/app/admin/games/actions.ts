"use server";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import type { FormState } from "@/lib/form-state";
import { isUuid } from "@/lib/validate";
import { expectedRevision, mutationError } from "@/lib/mutation";
const ROLES = ["civilian", "sheriff", "don", "mafia"] as const;
const WINNERS = ["red", "black", "draw"] as const;

export async function createGame(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const evening = String(form.get("evening_id") ?? "");
  const format = String(form.get("format") ?? "");
  if (!isUuid(evening) || !["classic10", "short9"].includes(format)) return { message: "Выберите вечер и формат." };
  const { data, error } = await supabase.rpc("create_game", { p_evening: evening, p_format: format });
  if (error) return mutationError(error);
  updateTag("club");
  redirect(`/admin/games/${data}`);
}
export async function saveGame(prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const game = String(form.get("game_id") ?? "");
  const host = String(form.get("host_player_id") ?? "");
  const winner = String(form.get("winner") ?? "");
  const finish = form.get("intent") === "finish";
  const revision = expectedRevision(form);
  const type = String(form.get("result_type") ?? "normal");
  const reason = String(form.get("result_reason") ?? "").trim();
  if (!isUuid(game) || revision === null) return { message: "Неверная партия или версия. Обновите страницу." };
  if (host && !isUuid(host)) return { message: "Выберите ведущего." };
  if (finish && !host) return { message: "Для завершения назначьте отдельного ведущего." };
  if (winner && !WINNERS.includes(winner as typeof WINNERS[number])) return { message: "Выберите победителя." };
  if (!["normal", "technical"].includes(type) || reason.length > 1000) return { message: "Проверьте тип и причину результата." };
  const { data: current, error: readError } = await supabase.from("games").select("format").eq("id", game).maybeSingle();
  if (readError || !current) return { message: "Партия не найдена." };
  const seats = [];
  const used = new Set<string>();
  for (let seat = 1; seat <= (current.format === "classic10" ? 10 : 9); seat++) {
    const player = String(form.get(`seat_${seat}_player`) ?? "");
    if (!player) continue;
    const role = String(form.get(`seat_${seat}_role`) ?? "");
    const fouls = Number(form.get(`seat_${seat}_fouls`) ?? 0);
    const removed = form.get(`seat_${seat}_removed`) === "on";
    if (!isUuid(player) || !ROLES.includes(role as typeof ROLES[number]) || !Number.isInteger(fouls) || fouls < 0 || fouls > 20) return { message: `Место ${seat}: проверьте игрока, роль и фолы.` };
    if (used.has(player)) return { message: "Один игрок не может сидеть на двух местах." };
    used.add(player); seats.push({ seat, player, role, fouls, removed });
  }
  const { data, error } = await supabase.rpc("save_game", { p_game: game, p_host: host || null, p_seats: seats,
    p_winner: winner || null, p_finish: finish, p_expected_revision: revision, p_result_type: type, p_reason: reason });
  if (error) return { ...prev, ...mutationError(error) };
  updateTag("club");
  return { ok: true, revision: Number(data), message: finish
    ? "Партия завершена. История и League Skill обновлены по правилам допуска." : "Черновик сохранён." };
}
export async function reopenGame(prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const game = String(form.get("game_id") ?? "");
  const revision = expectedRevision(form);
  if (!isUuid(game) || revision === null) return { message: "Обновите страницу партии." };
  const { data, error } = await supabase.rpc("reopen_game", { p_game: game, p_expected_revision: revision });
  if (error) return mutationError(error);
  updateTag("club");
  return { ok: true, revision: Number(data), message: "Партия возвращена в черновик. Предыдущий результат сохранён в журнале." };
}
export async function deleteGame(prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const game = String(form.get("game_id") ?? "");
  const revision = expectedRevision(form);
  if (!isUuid(game) || revision === null) return { message: "Обновите страницу партии." };
  const { data, error } = await supabase.rpc("delete_game", { p_game: game, p_expected_revision: revision });
  if (error) return mutationError(error);
  updateTag("club");
  redirect(`/admin/evenings/${data}`);
}
