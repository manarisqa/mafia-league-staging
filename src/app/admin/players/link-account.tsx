"use client";

import { useActionState } from "react";
import { linkAccount } from "@/app/admin/players/actions";
import { keepFormSubmit } from "@/lib/keep-form";

export function LinkAccountForm({
  historicalId,
  historicalRevision,
  accounts,
}: {
  historicalId: string;
  historicalRevision: number;
  accounts: { id: string; name: string; revision: number }[];
}) {
  const [state, action, pending] = useActionState(linkAccount, {});
  if (accounts.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <form
        onSubmit={(e) => {
          if (!confirm("Привязать выбранный аккаунт к этому игроку? Профиль-дубль будет удалён.")) {
            e.preventDefault();
            return;
          }
          keepFormSubmit(action)(e);
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="historical" value={historicalId} />
        <input type="hidden" name="revision" value={historicalRevision} />
        <label className="text-sm text-muted" htmlFor={`acc-${historicalId}`}>
          Привязать аккаунт:
        </label>
        <select
          id={`acc-${historicalId}`}
          name="account"
          required
          defaultValue=""
          className="h-11 rounded-control border border-border bg-elevated px-3 text-sm text-text focus:border-accent-text focus:outline-none"
        >
          <option value="" disabled>
            Выберите зарегистрированного…
          </option>
          {accounts.map((a) => (
            <option key={a.id} value={`${a.id}:${a.revision}`}>
              {a.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded-control border border-border px-4 text-sm hover:border-accent-text disabled:opacity-60"
        >
          Привязать
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
