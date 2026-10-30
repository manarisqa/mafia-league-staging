"use client";

import { useActionState } from "react";
import { RevisionField } from "@/components/form-revision";
import { rsvp } from "@/app/evenings/actions";

type Status = "going" | "late" | "maybe" | "not_going";

const OPTIONS: { value: Status; label: string }[] = [
  { value: "going", label: "Приду" },
  { value: "late", label: "Опоздаю" },
  { value: "maybe", label: "Возможно" },
  { value: "not_going", label: "Не приду" },
];

export function RsvpButtons({
  eveningId,
  current,
  revision,
  name,
}: {
  eveningId: string;
  current: Status | null;
  revision: number;
  name: string;
}) {
  const [state, action, pending] = useActionState(rsvp, {});

  return (
    <form action={action}>
      <input type="hidden" name="evening_id" value={eveningId} />
      <RevisionField initial={revision} state={state} />
      <p className="mb-3 text-sm text-muted">
        Вы вошли как <span className="text-text">{name}</span>. Выберите, придёте ли на вечер:
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {OPTIONS.map((o) => {
          const active = current === o.value;
          return (
            <button
              key={o.value}
              type="submit"
              name="status"
              value={o.value}
              disabled={pending}
              aria-pressed={active}
              className={`h-12 rounded-control border font-medium transition-colors disabled:opacity-60 ${
                active
                  ? "border-accent bg-accent text-text"
                  : "border-border hover:border-accent-text"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {current && (
        <button
          type="submit"
          name="status"
          value="cancel"
          disabled={pending}
          className="mt-3 min-h-11 text-sm text-muted hover:text-text hover:underline disabled:opacity-60"
        >
          Отменить запись
        </button>
      )}
      {state.message && (
        <p role="status" className={`mt-3 text-sm ${state.ok ? "text-success" : "text-error"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
