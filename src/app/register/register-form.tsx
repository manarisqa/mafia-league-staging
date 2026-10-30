"use client";

import { useActionState } from "react";
import { signUp } from "@/app/login/actions";
import { keepFormSubmit } from "@/lib/keep-form";
import { useTranslation } from "@/components/locale-provider";
import { isValidNickname } from "@/lib/nickname";

const input =
  "h-12 w-full rounded-control border border-border bg-elevated px-4 text-text placeholder:text-muted focus:border-accent-text focus:outline-none";

export function RegisterForm() {
  const [state, action, pending] = useActionState(signUp, {});
  const { t } = useTranslation();

  return (
    <form onSubmit={keepFormSubmit(action)} className="space-y-4">
      <div>
        <label htmlFor="nickname" className="mb-1.5 block text-sm text-muted">
          {t("nickname")}
        </label>
        <input id="nickname" name="nickname" autoComplete="nickname" required maxLength={40} className={input}
          aria-describedby="nickname-help"
          onChange={(event) => event.currentTarget.setCustomValidity(isValidNickname(event.currentTarget.value) ? "" : t("nicknameInvalid"))} />
        <p id="nickname-help" className="mt-2 text-xs text-muted">{t("nicknameHelp")}</p>
      </div>
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm text-muted">
          {t("email")}
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required className={input} />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm text-muted">
          {t("newPassword")}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={72}
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
        {t(pending ? "registering" : "signUp")}
      </button>
    </form>
  );
}
