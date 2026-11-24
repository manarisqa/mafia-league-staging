"use client";

import { useActionState, useState } from "react";
import { RevisionField } from "@/components/form-revision";
import { fullDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n/messages";
import { siteText } from "@/lib/i18n/site";
import { keepFormSubmit } from "@/lib/keep-form";
import { saveAttendance } from "./actions";

export function AttendanceForm({ eveningId, locale, log, players }: {
  eveningId: string;
  locale: Locale;
  log: { revision: number; recordedAt: string; attendees: string[] } | null;
  players: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(saveAttendance, {});
  const [selected, setSelected] = useState(() => new Set(log?.attendees ?? []));
  const [confirmedEmpty, setConfirmedEmpty] = useState(false);
  const t = (label: string) => siteText(locale, label);

  return (
    <form action={action} onSubmit={keepFormSubmit(action)} className="space-y-4">
      <input type="hidden" name="evening_id" value={eveningId} />
      <RevisionField initial={log?.revision ?? 0} state={state} />
      <p className="text-sm text-muted">
        {log ? <>{t("В журнале")} · {log.attendees.length} · {fullDateTime(log.recordedAt, locale)}</> : t("Посещаемость пока не записана.")}
      </p>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t("Кто присутствовал")} · {selected.size}</legend>
        <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto rounded-control border border-border p-2 sm:grid-cols-2 lg:grid-cols-3">
          {players.map(({ id, name }) => (
            <label key={id} className="flex min-h-11 items-center gap-3 rounded-control px-2 text-sm hover:bg-elevated">
              <input type="checkbox" name="attendee" value={id} checked={selected.has(id)} disabled={pending}
                onChange={({ currentTarget }) => {
                  const next = new Set(selected);
                  if (currentTarget.checked) next.add(id);
                  else next.delete(id);
                  setSelected(next);
                  setConfirmedEmpty(false);
                }} />
              <span className="min-w-0 break-words">{name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {selected.size === 0 && (
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" name="empty" checked={confirmedEmpty} disabled={pending}
            onChange={({ currentTarget }) => setConfirmedEmpty(currentTarget.checked)} />
          {t("Подтверждаю, что никто не присутствовал")}
        </label>
      )}
      <button type="submit" disabled={pending || (selected.size === 0 && !confirmedEmpty)}
        className="min-h-11 rounded-control bg-accent px-5 font-medium hover:bg-accent-hover disabled:opacity-60">
        {t("Сохранить журнал")}
      </button>
      {state.message && <p role="status" className={state.ok ? "text-success" : "text-error"}>{t(state.message)}</p>}
    </form>
  );
}
