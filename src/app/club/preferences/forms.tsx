"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui";
import { feedbackDay, feedbackReason, feedbackScore, notificationCategory, type Feedback, type NotificationPreferences } from "@/lib/club/communications";
import { communicationText, type CommunicationLabel } from "@/lib/i18n/communications";
import type { Locale } from "@/lib/i18n/messages";
import { keepFormSubmit } from "@/lib/keep-form";
import { saveFeedback, saveNotifications, type PreferenceState } from "./actions";

const inputClass = "min-h-11 rounded-control border border-border bg-elevated px-3 text-text focus-visible:border-accent-text";
const primaryClass = "min-h-11 rounded-control bg-accent px-4 py-2 font-medium hover:bg-accent-hover disabled:opacity-60";
const secondaryClass = "min-h-11 rounded-control border border-border px-4 py-2 font-medium hover:border-accent-text disabled:opacity-60";

function CheckboxList({ name, options, checked, t }: {
  name: string; options: readonly CommunicationLabel[]; checked: readonly string[]; t: (key: CommunicationLabel) => string;
}) {
  return <div className={name === "day" ? "grid grid-cols-3 gap-x-3 sm:grid-cols-7" : "grid gap-x-4 sm:grid-cols-2"}>
    {options.map((value) => (
      <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input type="checkbox" name={name} value={value} defaultChecked={checked.includes(value)} className="size-4 accent-accent" />
        {t(value)}
      </label>
    ))}
  </div>;
}

function Result({ locale, state }: { locale: Locale; state: PreferenceState }) {
  return state.label && <p role="status" className={state.ok ? "text-sm text-success" : "text-sm text-error"}>
    {communicationText(locale, state.label)}
  </p>;
}

export function NotificationPreferencesForm({ current, locale }: { current: NotificationPreferences | null; locale: Locale }) {
  const t = (key: CommunicationLabel) => communicationText(locale, key);
  const [state, action, pending] = useActionState(saveNotifications, {});
  return <Card title={t("notifications")}>
    <p className="text-sm text-muted">{t("notificationsHelp")}</p>
    <form key={current?.revision ?? 0} action={action} onSubmit={keepFormSubmit(action)} className="mt-4 space-y-4">
      <input type="hidden" name="revision" value={current?.revision ?? 0} />
      <fieldset disabled={pending}>
        <legend className="sr-only">{t("notifications")}</legend>
        <CheckboxList name="category" options={notificationCategory.options} checked={current?.categories ?? []} t={t} />
        <label className="mt-3 grid max-w-xs gap-1.5 text-sm">
          {t("language")}
          <select name="locale" className={inputClass} defaultValue={current?.locale ?? locale}>
            <option value="ru" lang="ru">Русский</option>
            <option value="uk" lang="uk">Українська</option>
          </select>
        </label>
      </fieldset>
      <button type="submit" className={primaryClass} disabled={pending}>{t(pending ? "saving" : "savePreferences")}</button>
    </form>
    <div aria-live="polite" className="mt-3 empty:hidden"><Result locale={locale} state={state} /></div>
  </Card>;
}

export function FeedbackForm({ current, locale }: { current: Feedback | null; locale: Locale }) {
  const t = (key: CommunicationLabel) => communicationText(locale, key);
  const [state, action, pending] = useActionState(saveFeedback, {});
  const hasFeedback = current && (current.suggestion || current.reasons.length || current.days.length
    || feedbackScore.options.some((name) => current[name] !== null));
  return <Card title={t("feedback")}>
    <p className="text-sm text-muted">{t("feedbackHelp")}</p>
    <form key={current?.revision ?? 0} action={action} onSubmit={keepFormSubmit(action)} className="mt-4 space-y-4">
      <input type="hidden" name="revision" value={current?.revision ?? 0} />
      <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-3">
        <legend className="sr-only">{t("feedback")}</legend>
        {feedbackScore.options.map((name) => (
          <div key={name} className="grid gap-1.5 text-sm">
            <label htmlFor={`feedback-${name}`}>{t(name)}</label>
            <select id={`feedback-${name}`} name={name} defaultValue={current?.[name] ?? ""} className={inputClass}>
              <option value="">{t("noScore")}</option>
              <option value="1">1 · {t("lowScore")}</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5 · {t("highScore")}</option>
            </select>
          </div>
        ))}
      </fieldset>
      <fieldset disabled={pending}>
        <legend className="font-medium">{t("reasons")}</legend>
        <CheckboxList name="reason" options={feedbackReason.options} checked={current?.reasons ?? []} t={t} />
      </fieldset>
      <fieldset disabled={pending}>
        <legend className="font-medium">{t("days")}</legend>
        <CheckboxList name="day" options={feedbackDay.options} checked={current?.days ?? []} t={t} />
      </fieldset>
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">{t("suggestion")}</span>
        <span className="text-muted" id="suggestion-help">{t("suggestionHelp")}</span>
        <textarea className={`${inputClass} w-full py-2`} name="suggestion" disabled={pending} rows={3}
          maxLength={600} aria-describedby="suggestion-help" defaultValue={current?.suggestion ?? ""} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primaryClass} disabled={pending}>{t(pending ? "saving" : "saveFeedback")}</button>
        {hasFeedback ? <button type="submit" name="mode" value="remove" className={secondaryClass} disabled={pending}>
          {t("removeFeedback")}
        </button> : null}
      </div>
    </form>
    <div aria-live="polite" className="mt-3 empty:hidden"><Result locale={locale} state={state} /></div>
  </Card>;
}
