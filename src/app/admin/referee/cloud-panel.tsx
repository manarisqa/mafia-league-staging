"use client";

import { useRef, useState, type FormEvent } from "react";
import { approveCloudProtocol, loadCloudProtocol, saveCloudProtocol } from "./actions";
import { refereeText } from "@/lib/i18n/referee";
import type { Locale } from "@/lib/i18n/messages";
import { fullDateTime } from "@/lib/format";
import type { CloudError, CloudProtocol, RefereeGame, RefereePlayer } from "@/lib/referee/cloud";
import type { Draft, Table } from "@/lib/referee/engine";

const button = "min-h-11 rounded-control border border-border bg-canvas px-3 py-2 text-sm hover:border-accent-text disabled:opacity-45";
const field = "min-h-11 w-full rounded-control border border-border bg-canvas px-2 text-sm";

const errors: Record<CloudError, string> = {
  unavailable: "Облако недоступно. Проверьте миграцию и повторите.",
  invalid: "Проверьте завершённый протокол, состав и выбранную партию.",
  conflict: "Версия изменилась. Экспортируйте свои правки перед восстановлением из облака.",
  duplicate: "Этот протокол или партия уже утверждены.",
  denied: "Протокол недоступен этой учётной записи.",
  failed: "Не удалось связаться с облаком. Локальная копия остаётся на устройстве.",
};

export function CloudPanel({
  locale, available, draft, table, players, games, items, synced, deviceConflict, onSaved, onRestored, onApproved,
}: {
  locale: Locale; available: boolean; draft: Draft | null; table: Table | null;
  players: RefereePlayer[]; games: RefereeGame[]; items: CloudProtocol[]; synced: boolean; deviceConflict: boolean;
  onSaved: (item: CloudProtocol) => void;
  onRestored: (item: CloudProtocol, restored: Draft) => boolean;
  onApproved: (id: string, game: string) => void;
}) {
  const t = (text: string) => refereeText(locale, text);
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const active = items.find((item) => item.id === draft?.draftId);
  const approved = active?.approved_game_id;
  const canApprove = !deviceConflict && !!draft && !!active && synced && !approved && table?.result?.confidence === "observed" && table.result.outcome !== "cancelled";
  const targets = games.filter((game) => game.format === draft?.format && !items.some((item) => item.approved_game_id === game.id));

  async function perform(task: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      await task();
    } catch {
      report(errors.failed, true);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  function report(text: string, error = false) {
    setMessage(t(text));
    setIsError(error);
  }

  function save() {
    if (!draft) return;
    const captured = draft;
    void perform(async () => {
      const result = await saveCloudProtocol(captured, active?.revision ?? 0);
      if (!result.ok) return report(errors[result.error], true);
      onSaved(result.value);
      report("Копия сохранена в облаке.");
    });
  }

  function restore(id: string) {
    void perform(async () => {
      const result = await loadCloudProtocol(id);
      if (!result.ok) return report(errors[result.error], true);
      if (onRestored(result.value.meta, result.value.draft)) report("Облачная копия восстановлена.");
    });
  }

  function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || !draft || !table || !canApprove) return;
    const data = new FormData(event.currentTarget);
    const game = targets.find((target) => target.id === data.get("game"));
    if (!game) return;
    const seats = Object.fromEntries(table.seats.map((seat) => [seat.number, String(data.get(`seat-${seat.number}`) ?? "")]));
    const host = String(data.get("host") ?? "");
    if (Object.values(seats).includes(host) || new Set(Object.values(seats)).size !== table.seats.length) {
      return report("Выберите отдельного ведущего и разных игроков для всех мест.", true);
    }
    if (!window.confirm(t("Утвердить результат? Он появится в истории и будет учтён по правилам League Skill."))) return;
    void perform(async () => {
      const result = await approveCloudProtocol(active.id, active.revision, {
        game: game.id, gameRevision: game.revision, host, seats, gapsReviewed: data.has("gaps"),
      });
      if (!result.ok) return report(errors[result.error], true);
      onApproved(active.id, result.value);
      report("Результат утверждён.");
    });
  }

  return (
    <section className="space-y-3 rounded-card border border-border bg-surface p-4" aria-label={t("Облачные протоколы")}>
      <h2 className="text-lg font-semibold">{t("Облачные протоколы")}</h2>
      <p className="text-sm text-muted">{t("Облачные копии доступны только создавшей их учётной записи администратора.")}</p>
      {message && <p role={isError ? "alert" : "status"} className={isError ? "text-sm text-error" : "text-sm text-success"}>{message}</p>}
      {!available && <p className="text-sm text-warning">{t(errors.unavailable)}</p>}
      {available && draft && !approved && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={button} onClick={save} disabled={busy || synced || deviceConflict}>{t("Сохранить в облако")}</button>
          <span className="text-sm text-muted">{t(synced ? "Синхронизировано" : "Есть локальные изменения")}</span>
        </div>
      )}
      {approved && <a className="inline-flex min-h-11 items-center text-accent-text underline" href={`/history/games/${approved}`}>{t("Утверждена · открыть историю партии")}</a>}
      {canApprove && !targets.length && <p className="text-sm text-muted">{t("Создайте черновик партии нужного формата в разделе «Партии» и обновите страницу.")}</p>}
      {canApprove && !!targets.length && (
        <details className="rounded-control border border-border px-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">{t("Проверить состав и утвердить")}</summary>
          <form key={`${draft.draftId}-${active.revision}`} onSubmit={approve} className="space-y-3 pb-3">
            <fieldset disabled={busy} className="grid gap-3">
              <label className="grid gap-1 text-sm">{t("Партия в лиге")}<select name="game" className={field} required defaultValue=""><option value="">{t("Выберите партию")}</option>{targets.map((game) => <option key={game.id} value={game.id}>{game.label}</option>)}</select></label>
              <PlayerField name="host" label={t("Ведущий")} pinned={draft.host?.optionalPublicPlayerId} players={players} locale={locale} />
              {table.seats.map((seat) => <PlayerField key={seat.number} name={`seat-${seat.number}`} label={`${seat.number} · ${seat.localNickname} · ${t(({ civilian: "Мирный", sheriff: "Шериф", mafia: "Мафия", don: "Дон" } as const)[seat.role!] ?? "Не указана")}`} pinned={seat.optionalPublicPlayerId} players={players} locale={locale} />)}
              {table.gaps.length > 0 && (
                <div className="space-y-2 text-sm">
                  <ul className="list-disc pl-5 text-warning">{table.gaps.map((gap, index) => <li key={index}>{t(gap)}</li>)}</ul>
                  <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="gaps" required />{t("Я проверил отмеченные пробелы протокола")}</label>
                </div>
              )}
              <button type="submit" className={button}>{t("Утвердить результат")}</button>
            </fieldset>
          </form>
        </details>
      )}
      {items.length > 0 && <details open={!draft || undefined}>
        <summary className="min-h-11 cursor-pointer py-3 text-sm">{t("Загрузить из облака")} · {items.length}</summary>
        <div className="grid gap-2 sm:grid-cols-2">
          {items.map((item) => <button key={item.id} type="button" className={`${button} text-left`} onClick={() => restore(item.id)} disabled={busy}>
            <span className="block break-words">{item.title}{item.approved_game_id ? ` · ${t("Утверждена")}` : ""}</span>
            <span className="text-xs text-muted">{fullDateTime(item.updated_at, locale)}</span>
          </button>)}
        </div>
      </details>}
    </section>
  );
}

function PlayerField({ name, label, pinned, players, locale }: {
  name: string; label: string; pinned?: string; players: RefereePlayer[]; locale: Locale;
}) {
  const isBound = !!pinned && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(pinned);
  const known = players.find((player) => player.id === pinned);
  return (
    <label className="grid gap-1 text-sm">
      {label}
      {isBound ? (
        <><input type="hidden" name={name} value={pinned} /><span className="text-muted">{known?.name ?? refereeText(locale, "Игрок с указанным ID не найден")}</span></>
      ) : (
        <select className={field} name={name} required defaultValue="">
          <option value="">{refereeText(locale, "Выберите игрока")}</option>
          {players.map((player) => <option key={player.id} value={player.id}>{player.name} · {player.id.slice(-8)}</option>)}
        </select>
      )}
    </label>
  );
}
