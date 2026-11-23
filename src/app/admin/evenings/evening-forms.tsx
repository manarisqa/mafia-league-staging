"use client";

import { useTranslation } from "@/components/locale-provider";
import { siteText } from "@/lib/i18n/site";

import { useActionState } from "react";
import {
  deleteEvening,
  removeSignup,
  saveEvening,
  setSignup,
} from "@/app/admin/evenings/actions";
import type { AdminEvening, AdminSignup } from "@/lib/admin-data";
import { EVENING_STATUS_LABEL, SIGNUP_STATUS_LABEL, isoToViennaLocal } from "@/lib/format";
import { RevisionField } from "@/components/form-revision";
import { keepFormSubmit } from "@/lib/keep-form";

const field =
  "h-11 w-full rounded-control border border-border bg-elevated px-3 text-text placeholder:text-muted focus:border-accent-text focus:outline-none";
const button =
  "h-11 rounded-control bg-accent px-5 text-sm font-medium transition-colors hover:bg-accent-hover disabled:opacity-60";

type PlayerOption = { id: string; name: string };

function Message({ state }: { state: { ok?: boolean; message?: string } }) {
  const { locale } = useTranslation();
  const t = (label: string) => siteText(locale, label);
  if (!state.message) return null;
  return (
    <p role="status" className={`mt-2 text-sm ${state.ok ? "text-success" : "text-error"}`}>
      {t(state.message)}
    </p>
  );
}

export function EveningForm({
  evening,
  players,
  seasons,
}: {
  evening?: AdminEvening;
  players: PlayerOption[];
  seasons: PlayerOption[];
}) {
  const { locale } = useTranslation();
  const t = (label: string) => siteText(locale, label);
  const [state, action, pending] = useActionState(saveEvening, {});

  return (
    <form onSubmit={keepFormSubmit(action)} className="space-y-4">
      {evening && <input type="hidden" name="id" value={evening.id} />}
      <RevisionField initial={evening?.revision ?? 0} state={state} />
      <label className="block text-sm text-muted">{t("Сезон (нужен для League Skill)")}<select name="season_id" defaultValue={evening ? evening.season_id ?? "" : seasons[0]?.id ?? ""} className={`mt-1 ${field}`}>
          <option value="">{t("Без сезона — только история")}</option>
          {seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm text-muted">{t("Дата и время (время Граца)")}<input
            type="datetime-local"
            name="starts_at"
            required
            defaultValue={evening ? isoToViennaLocal(evening.starts_at) : ""}
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="block text-sm text-muted">{t("Место")}<input
            name="place"
            required
            maxLength={100}
            defaultValue={evening?.place ?? t("Грац")}
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="block text-sm text-muted">{t("Мест за столом")}<select name="capacity" defaultValue={evening?.capacity ?? 10} className={`mt-1 ${field}`}>
            <option value={10}>{t("10 (Классика 10)")}</option>
            <option value={9}>9 (Short9)</option>
          </select>
        </label>
        <label className="block text-sm text-muted">{t("Статус")}<select name="status" defaultValue={evening?.status ?? "planned"} className={`mt-1 ${field}`}>
            {Object.entries(EVENING_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-muted sm:col-span-2">{t("Ведущий")}<select
            name="host_player_id"
            defaultValue={evening?.host_player_id ?? ""}
            className={`mt-1 ${field}`}
          >
            <option value="">{t("Пока не назначен")}</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-muted sm:col-span-2">{t("Заметка для себя (не показывается на сайте)")}<textarea
            name="note"
            maxLength={500}
            rows={2}
            defaultValue={evening?.note ?? ""}
            className="mt-1 w-full rounded-control border border-border bg-elevated px-3 py-2 text-text focus:border-accent-text focus:outline-none"
          />
        </label>
      </div>
      <button type="submit" disabled={pending} className={button}>
        {pending ? "…" : evening ? t("Сохранить") : t("Создать вечер")}
      </button>
      <Message state={state} />
    </form>
  );
}

export function DeleteEveningButton({ id, revision }: { id: string; revision: number }) {
  const { locale } = useTranslation();
  const t = (label: string) => siteText(locale, label);
  const [state, action, pending] = useActionState(deleteEvening, {});
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(t("Удалить вечер вместе со всеми записями на него?"))) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="revision" value={revision} />
      <button type="submit" disabled={pending} className="min-h-11 text-sm text-error hover:underline disabled:opacity-60">{t("Удалить вечер")}</button>
      {state.message && !state.ok && (
        <p role="alert" className="text-sm text-error">
          {t(state.message)}
        </p>
      )}
    </form>
  );
}

export function SignupAddForm({
  eveningId,
  candidates,
}: {
  eveningId: string;
  candidates: PlayerOption[];
}) {
  const { locale } = useTranslation();
  const t = (label: string) => siteText(locale, label);
  const [state, action, pending] = useActionState(setSignup, {});

  if (candidates.length === 0) {
    return <p className="text-sm text-muted">{t("Все игроки уже записаны.")}</p>;
  }
  return (
    <div>
      <form onSubmit={keepFormSubmit(action)} className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <input type="hidden" name="evening_id" value={eveningId} />
        <input type="hidden" name="revision" value={0} />
        <label className="block text-sm text-muted">{t("Игрок")}<select name="player_id" required defaultValue="" className={`mt-1 ${field}`}>
            <option value="" disabled>{t("Выберите…")}</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-muted">{t("Статус")}<select name="status" defaultValue="going" className={`mt-1 ${field}`}>
            {Object.entries(SIGNUP_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className={button}>{t("Записать")}</button>
      </form>
      <Message state={state} />
    </div>
  );
}

export function SignupRow({ eveningId, signup }: { eveningId: string; signup: AdminSignup }) {
  const { locale } = useTranslation();
  const t = (label: string) => siteText(locale, label);
  const [saveState, saveAction, saving] = useActionState(setSignup, {});
  const [removeState, removeAction, removing] = useActionState(removeSignup, {});

  return (
    <li className="rounded-control border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-medium">{signup.name}</span>
        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={keepFormSubmit(saveAction)} className="flex items-center gap-2">
            <input type="hidden" name="evening_id" value={eveningId} />
            <RevisionField initial={signup.revision} state={saveState} />
            <input type="hidden" name="player_id" value={signup.player_id} />
            <select
              name="status"
              defaultValue={signup.status}
              aria-label={`${t("Статус")}: ${signup.name}`}
              className={`${field} w-40`}
            >
              {Object.entries(SIGNUP_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </select>
            <button type="submit" disabled={saving} className="h-11 rounded-control border border-border px-4 text-sm hover:border-accent-text disabled:opacity-60">{t("Сохранить")}</button>
          </form>
          <form action={removeAction}>
            <input type="hidden" name="evening_id" value={eveningId} />
            <RevisionField initial={signup.revision} state={saveState} />
            <input type="hidden" name="player_id" value={signup.player_id} />
            <button type="submit" disabled={removing} className="min-h-11 px-2 text-sm text-error hover:underline disabled:opacity-60">{t("Убрать")}</button>
          </form>
        </div>
      </div>
      <Message state={saveState} />
      {removeState.message && !removeState.ok && (
        <p role="alert" className="mt-2 text-sm text-error">
          {t(removeState.message)}
        </p>
      )}
    </li>
  );
}
