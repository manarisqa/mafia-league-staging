"use client";

import { useActionState, useState, type FormEvent } from "react";
import { createGame, deleteGame, reopenGame, saveGame } from "@/app/admin/games/actions";
import type { AdminGame } from "@/lib/admin-data";
import { FORMAT_LABEL, ROLE_LABEL, WINNER_LABEL } from "@/lib/format";
import { blocker, expectedFor, summarize, type RoleKey } from "@/lib/game-composition";
import { RevisionField } from "@/components/form-revision";
import { keepFormSubmit } from "@/lib/keep-form";

const field =
  "h-11 w-full rounded-control border border-border bg-elevated px-3 text-text focus:border-accent-text focus:outline-none";
const button =
  "h-11 rounded-control bg-accent px-5 text-sm font-medium transition-colors hover:bg-accent-hover disabled:opacity-60";

type PlayerOption = { id: string; name: string };

function Message({ state }: { state: { ok?: boolean; message?: string; details?: string } }) {
  if (!state.message) return null;
  return (
    <div role={state.ok ? "status" : "alert"} className="mt-3 text-sm">
      <p className={state.ok ? "text-success" : "text-error"}>{state.message}</p>
      {state.details && <p className="mt-1 text-muted">Сервер получил роли по местам: {state.details}</p>}
    </div>
  );
}

export function AddGameForm({ eveningId }: { eveningId: string }) {
  const [state, action, pending] = useActionState(createGame, {});
  return (
    <form onSubmit={keepFormSubmit(action)}>
      <input type="hidden" name="evening_id" value={eveningId} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm text-muted">
          Формат новой партии
          <select name="format" defaultValue="classic10" className={`mt-1 ${field} w-56`}>
            <option value="classic10">{FORMAT_LABEL.classic10} (10 игроков)</option>
            <option value="short9">{FORMAT_LABEL.short9} (9 игроков)</option>
          </select>
        </label>
        <button type="submit" disabled={pending} className={button}>
          {pending ? "…" : "Добавить партию"}
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

export function GameEditor({
  game,
  players,
  signedIds,
}: {
  game: AdminGame;
  players: PlayerOption[];
  signedIds: string[];
}) {
  const [state, action, pending] = useActionState(saveGame, {});
  const total = game.format === "classic10" ? 10 : 9;
  const bySeat = new Map(game.seats.map((s) => [s.seat, s]));
  const signed = new Set(signedIds);
  const [comp, setComp] = useState(() =>
    summarize((name) => {
      const m = /^seat_(\d+)_(player|role)$/.exec(name);
      if (m) {
        const cur = bySeat.get(Number(m[1]));
        return m[2] === "player" ? (cur?.player_id ?? "") : (cur?.role ?? "civilian");
      }
      if (name === "host_player_id") return game.host_player_id ?? "";
      if (name === "winner") return game.winner ?? "";
      return "";
    }, total),
  );
  const want = expectedFor(total);
  const problem = blocker(comp, total);
  const onChange = (e: FormEvent<HTMLFormElement>) => {
    const fd = new FormData(e.currentTarget);
    setComp(summarize((name) => String(fd.get(name) ?? ""), total));
  };
  const signedPlayers = players.filter((p) => signed.has(p.id));
  const others = players.filter((p) => !signed.has(p.id));

  const playerOptions = (
    <>
      <option value="">— свободно —</option>
      {signedPlayers.length > 0 && (
        <optgroup label="Записались на вечер">
          {signedPlayers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label={signedPlayers.length > 0 ? "Остальные игроки" : "Игроки"}>
        {others.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </optgroup>
    </>
  );

  return (
    <form onSubmit={keepFormSubmit(action)} onChange={onChange} className="space-y-6">
      <input type="hidden" name="game_id" value={game.id} />
      <RevisionField initial={game.revision} state={state} />

      <label className="block text-sm text-muted">
        Ведущий (не играет за столом)
        <select name="host_player_id" defaultValue={game.host_player_id ?? ""} className={`mt-1 ${field} sm:max-w-sm`}>
          <option value="">Не назначен</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div>
        <h3 className="mb-2 font-medium">Места за столом</h3>
        <p className="mb-3 text-sm text-muted">
          {game.format === "classic10"
            ? "Классика 10: 6 мирных, 1 шериф, 1 дон, 2 мафии."
            : "Short9: 5 мирных, 1 шериф, 1 дон, 2 мафии."}{" "}
          Для черновика можно заполнить не все места.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: total }, (_, i) => i + 1).map((seat) => {
            const cur = bySeat.get(seat);
            return (
              <li key={seat} className="grid grid-cols-[2.5rem_1fr_8rem] items-center gap-2">
                <span className="text-center font-display text-lg text-accent-text">{seat}</span>
                <select
                  name={`seat_${seat}_player`}
                  defaultValue={cur?.player_id ?? ""}
                  aria-label={`Место ${seat}: игрок`}
                  className={field}
                >
                  {playerOptions}
                </select>
                <select
                  name={`seat_${seat}_role`}
                  defaultValue={cur?.role ?? "civilian"}
                  aria-label={`Место ${seat}: роль`}
                  className={field}
                >
                  {Object.entries(ROLE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <div className="col-span-3 flex flex-wrap items-center gap-4 pl-10 text-sm text-muted">
                  <label>Фолы <input type="number" name={`seat_${seat}_fouls`} min={0} max={20}
                    defaultValue={cur?.fouls ?? 0} className={`${field} ml-2 w-20`} /></label>
                  <label className="flex min-h-11 items-center gap-2"><input type="checkbox"
                    name={`seat_${seat}_removed`} defaultChecked={cur?.removed ?? false} />Удалён</label>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <label className="block text-sm text-muted">Тип результата
        <select name="result_type" defaultValue={game.result_type} className={`mt-1 ${field} sm:max-w-sm`}>
          <option value="normal">Обычный</option><option value="technical">Технический (без League Skill)</option>
        </select>
      </label>
      <label className="block text-sm text-muted">Причина технического результата или удаления
        <textarea name="result_reason" defaultValue={game.result_reason} maxLength={1000}
          className="mt-1 w-full rounded-control border border-border bg-elevated p-3 text-text" />
      </label>
      <label className="block text-sm text-muted">
        Победитель (нужен, чтобы завершить партию)
        <select name="winner" defaultValue={game.winner ?? ""} className={`mt-1 ${field} sm:max-w-sm`}>
          <option value="">Пока не выбран</option>
          {Object.entries(WINNER_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <div aria-live="polite" className="rounded-control border border-border bg-elevated p-3">
        <ul className="flex flex-wrap gap-2 text-sm">
          {(Object.keys(want) as RoleKey[]).map((role) => {
            const have = comp.counts[role];
            const tone =
              have === want[role]
                ? "border-success/60 text-success"
                : have > want[role]
                  ? "border-error/60 text-error"
                  : "border-border text-muted";
            return (
              <li key={role} className={`rounded-full border px-3 py-1 ${tone}`}>
                {ROLE_LABEL[role]}: {have} из {want[role]}
              </li>
            );
          })}
        </ul>
        <p className={`mt-2 text-sm ${problem ? "text-muted" : "text-success"}`}>
          {problem ? `Чтобы завершить: ${problem.toLowerCase()}.` : "Всё готово, можно завершать партию."}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          name="intent"
          value="save"
          disabled={pending}
          className="h-11 rounded-control border border-border px-5 text-sm font-medium hover:border-accent-text disabled:opacity-60"
        >
          Сохранить черновик
        </button>
        <button
          type="submit"
          name="intent"
          value="finish"
          disabled={pending || problem !== null}
          className={button}
        >
          Завершить партию
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

export function ReopenGameButton({ gameId, revision }: { gameId: string; revision: number }) {
  const [state, action, pending] = useActionState(reopenGame, {});
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Вернуть партию в черновик? Она пропадёт из рейтинга, пока вы её снова не завершите.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="game_id" value={gameId} />
      <input type="hidden" name="revision" value={revision} />
      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-control border border-border px-5 text-sm hover:border-accent-text disabled:opacity-60"
      >
        Исправить: вернуть в черновик
      </button>
      <Message state={state} />
    </form>
  );
}

export function DeleteGameButton({ gameId, revision }: { gameId: string; revision: number }) {
  const [state, action, pending] = useActionState(deleteGame, {});
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Удалить этот черновик партии?")) e.preventDefault();
      }}
    >
      <input type="hidden" name="game_id" value={gameId} />
      <input type="hidden" name="revision" value={revision} />
      <button type="submit" disabled={pending} className="min-h-11 text-sm text-error hover:underline disabled:opacity-60">
        Удалить партию
      </button>
      {state.message && !state.ok && (
        <p role="alert" className="text-sm text-error">
          {state.message}
        </p>
      )}
    </form>
  );
}
