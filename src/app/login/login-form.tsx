"use client";

import { useActionState } from "react";
import { signIn } from "@/app/login/actions";
import { keepFormSubmit } from "@/lib/keep-form";
import { useTranslation } from "@/components/locale-provider";

const input =
  "h-12 w-full rounded-control border border-border bg-elevated px-4 text-text placeholder:text-muted focus:border-accent-text focus:outline-none";

export function LoginForm({ forbidden }: { forbidden: boolean }) {
  const [state, action, pending] = useActionState(signIn, {});
  const { t } = useTranslation();

  return (
    <form onSubmit={keepFormSubmit(action)} className="space-y-4">
      {forbidden && (
        <p role="alert" className="rounded-control border border-error/50 bg-error/10 p-3 text-sm text-error">
          {t("forbidden")}
        </p>
      )}
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm text-muted">
          {t("email")}
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required className={input} />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm text-muted">
          {t("password")}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={input}
        />
      </div>
      {state.message && (
        <p role="alert" className="text-sm text-error">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-control bg-accent font-medium transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {t(pending ? "signingIn" : "signIn")}
      </button>
    </form>
  );
}
