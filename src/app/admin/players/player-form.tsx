"use client";

import { useActionState, useEffect, useRef } from "react";
import { deletePlayer, savePlayer } from "@/app/admin/players/actions";
import type { AdminPlayer } from "@/lib/admin-data";
import { RevisionField } from "@/components/form-revision";
import { keepFormSubmit } from "@/lib/keep-form";

const field =
  "h-11 w-full rounded-control border border-border bg-elevated px-3 text-text placeholder:text-muted focus:border-accent-text focus:outline-none";

export function PlayerForm({ player }: { player?: AdminPlayer }) {
  const [state, action, pending] = useActionState(savePlayer, {});
  const formRef = useRef<HTMLFormElement>(null);

  // После добавления нового игрока очищаем форму.
  useEffect(() => {
    if (state.ok && !player) formRef.current?.reset();
  }, [state, player]);

  return (
    <div>
      <form ref={formRef} onSubmit={keepFormSubmit(action)} className="grid gap-3 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end">
        {player && <input type="hidden" name="id" value={player.id} />}
        {player ? <RevisionField initial={player.revision} state={state} /> : <input type="hidden" name="revision" value={0} />}
        <label className="block text-sm text-muted">
          Имя
          <input
            name="name"
            required
            maxLength={60}
            defaultValue={player?.display_name}
            placeholder="Например, Анна"
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="block text-sm text-muted">
          Никнейм
          <input
            name="nickname"
            maxLength={40}
            defaultValue={player?.nickname ?? ""}
            placeholder="необязательно"
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="block text-sm text-muted">
          Статус
          <select name="status" defaultValue={player?.status ?? "newbie"} className={`mt-1 ${field}`}>
            <option value="newbie">Новичок</option>
            <option value="club_member">Игрок клуба</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded-control bg-accent px-5 text-sm font-medium transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {pending ? "…" : player ? "Сохранить" : "Добавить"}
        </button>
      </form>
      {state.message && (
        <p role="status" className={`mt-2 text-sm ${state.ok ? "text-success" : "text-error"}`}>
          {state.message}
        </p>
      )}
    </div>
  );
}

export function DeletePlayerButton({ player }: { player: AdminPlayer }) {
  const [state, action, pending] = useActionState(deletePlayer, {});

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Удалить игрока «${player.display_name}»?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={player.id} />
      <input type="hidden" name="revision" value={player.revision} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 text-sm text-error hover:underline disabled:opacity-60"
      >
        Удалить
      </button>
      {state.message && !state.ok && (
        <p role="alert" className="text-sm text-error">
          {state.message}
        </p>
      )}
    </form>
  );
}
