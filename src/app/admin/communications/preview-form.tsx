"use client";

import { useActionState, useState } from "react";
import { notificationCategory } from "@/lib/club/communications";
import { communicationText, type CommunicationLabel } from "@/lib/i18n/communications";
import type { Locale } from "@/lib/i18n/messages";
import { previewNotification } from "./actions";

const inputClass = "min-h-11 min-w-0 rounded-control border border-border bg-elevated px-3 text-text";
const buttonClass = "min-h-11 rounded-control bg-accent px-4 py-2 font-medium hover:bg-accent-hover disabled:opacity-60";
const countLabels = {
  candidates: "countCandidates",
  duplicates: "countDuplicates",
  limited: "countLimited",
  recipients: "countRecipient",
} as const;

export function PreviewForm({ locale, evenings }: { locale: Locale; evenings: { id: string; label: string }[] }) {
  const t = (key: CommunicationLabel) => communicationText(locale, key);
  const [state, action, pending] = useActionState(previewNotification, {});
  const [evening, setEvening] = useState(evenings[0]?.id ?? "");
  const [category, setCategory] = useState<string>("announcement");
  const preview = state.preview?.evening === evening && state.preview?.category === category ? state.preview : null;

  if (evenings.length === 0) return <p className="text-muted">{t("noEvenings")}</p>;

  return <div className="space-y-4">
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <label className="grid min-w-0 gap-1.5 text-sm">
        {t("evening")}
        <select className={inputClass} name="evening" value={evening} onChange={(event) => setEvening(event.target.value)} disabled={pending}>
          {evenings.map((event) => <option key={event.id} value={event.id}>{event.label}</option>)}
        </select>
      </label>
      <label className="grid min-w-0 gap-1.5 text-sm">
        {t("category")}
        <select className={inputClass} name="category" value={category} onChange={(event) => setCategory(event.target.value)} disabled={pending}>
          {notificationCategory.options.map((value) => <option key={value} value={value}>{t(value)}</option>)}
        </select>
      </label>
      <div className="sm:col-span-2"><button type="submit" className={buttonClass} disabled={pending}>{t("preview")}</button></div>
    </form>
    {state.label && <p className="text-sm text-muted" role="status">{t(state.label)}</p>}
    {state.recorded !== undefined && <p className="text-sm text-success" role="status">{t("recorded")} · {state.recorded}</p>}
    {preview && <div className="space-y-4 rounded-panel border border-border bg-elevated p-4" aria-live="polite">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
        {(Object.keys(countLabels) as (keyof typeof countLabels)[]).map((key) => (
          <div key={key} className="flex flex-col justify-between gap-1"><dt className="text-muted">{t(countLabels[key])}</dt><dd className="font-display text-xl tabular-nums">{preview.counts[key]}</dd></div>
        ))}
      </dl>
      {preview.counts.recipients === 0 && <p className="text-sm text-muted">{t("noRecipients")}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {preview.messages.map((message) => (
          <section key={message.locale} lang={message.locale} className="min-w-0 rounded-panel border border-border bg-surface p-3">
            <h3 className="text-sm text-muted">
              {message.locale === "uk" ? "Українська" : "Русский"} · {message.audienceSize}
            </h3>
            <p className="mt-2 text-sm whitespace-pre-wrap break-words">{message.text}</p>
          </section>
        ))}
      </div>
      {preview.counts.recipients > 0 && <form action={action}>
        <input type="hidden" name="evening" value={preview.evening} />
        <input type="hidden" name="category" value={preview.category} />
        <input type="hidden" name="key" value={preview.key} />
        <button type="submit" className={buttonClass} disabled={pending}>{t("run")}</button>
      </form>}
    </div>}
  </div>;
}
