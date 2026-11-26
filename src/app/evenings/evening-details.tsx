import Link from "next/link";
import { Suspense } from "react";
import { InviteButton } from "@/app/invite-button";
import { ProtocolLink, WinnerMark } from "@/app/history/history-ui";
import { Avatar, ButtonLink, Card } from "@/components/ui";
import { showDemoBadge, type NextEvening } from "@/lib/data";
import { EVENING_STATUS_LABEL, FORMAT_LABEL, fullDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n/messages";
import { siteText } from "@/lib/i18n/site";
import { RsvpPanel } from "./rsvp-panel";

export function EveningReadiness({ evening, locale }: { evening: NextEvening; locale: Locale }) {
  const t = (label: string) => siteText(locale, label);
  const { ready, confirmed, missing, hasHost } = evening.readiness;
  return (
    <div className="space-y-1 text-sm text-muted">
      <p><span className="font-medium text-text">{t("Игроки с подтверждённой записью")} · {confirmed}</span>
        {" · "}{t("Для одного стола")} {evening.capacity}</p>
      <p className="wrap-anywhere">{t("Ведущий")}{": "}{evening.hostName ?? t("пока не назначен")}</p>
      {ready ? <p className="font-medium text-success">{t("Состав для одной партии собран")}</p> : (
        <p>{missing > 0 && <>{t("Не хватает игроков")} · {missing}</>}
          {missing > 0 && !hasHost && " · "}
          {!hasHost && t("Нужен ведущий")}</p>
      )}
    </div>
  );
}

export function EveningDetails({ evening, locale }: { evening: NextEvening; locale: Locale }) {
  const t = (label: string) => siteText(locale, label);
  const open = evening.registrationOpen;
  const format = evening.capacity === 9 ? "short9" : "classic10";
  return (
    <>
      <Card demo={showDemoBadge()} locale={locale}>
        <div className="flex items-start gap-4">
          <div aria-hidden className="flex size-16 shrink-0 flex-col items-center justify-center rounded-control border border-border bg-elevated sm:size-20">
            <span className="text-xs text-muted">{evening.weekday}</span>
            <span className="font-display text-3xl leading-none font-bold">{evening.day}</span>
            <span className="text-xs text-muted">{evening.month}</span>
          </div>
          <div className="min-w-0">
            <p className="font-display text-xl font-bold sm:text-2xl">
              {evening.startsAt
                ? <time dateTime={evening.startsAt}>{fullDateTime(evening.startsAt, locale)}</time>
                : <>{t("Начало в")} {evening.time}</>}
            </p>
            <p className="mt-1 wrap-anywhere text-muted">{evening.place} · {t("Время Граца")}</p>
            <p className="mt-2 text-sm">
              {t("Плановый формат")} · {t(FORMAT_LABEL[format])}
              {!open && <> · {t(evening.status === "planned" ? "Запись закрыта" : EVENING_STATUS_LABEL[evening.status])}</>}
            </p>
          </div>
        </div>
        {open && <div className="mt-4 border-t border-border pt-4"><EveningReadiness evening={evening} locale={locale} /></div>}
        {open && evening.id && <div className="mt-4"><InviteButton path={`/evenings/${evening.id}`} /></div>}
      </Card>

      {open && evening.id && (
        <Suspense fallback={<p className="text-muted">{t("Загрузка…")}</p>}>
          <RsvpPanel eveningId={evening.id} />
        </Suspense>
      )}

      {open && (
        <Card title={t("Записались за стол")} locale={locale}>
          <p className="mb-4 text-sm text-muted">{t("Здесь видны игроки со статусом «Приду» и «Опоздаю». Мест для записи больше, чем за одним столом.")}</p>
          {evening.participants.length > 0 ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {evening.participants.map(({ id, name }) => (
                <li key={id}>
                  <Link href={evening.id ? `/players/${id}` : "/players"} className="flex min-h-11 items-center gap-2 text-sm hover:text-accent-text">
                    <Avatar name={name} size={36} />
                    <span className="min-w-0 wrap-anywhere">{name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">{t("Подтверждённых записей игроков пока нет.")}</p>}
        </Card>
      )}

      {(!open || evening.games.length > 0) && evening.status !== "cancelled" && (
        <Card title={t("Результаты вечера")}>
          {evening.games.length ? (
            <ul className="divide-y divide-border">
              {evening.games.map((game) => (
                <li key={game.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>{t("Партия №")}{game.no} · {t(FORMAT_LABEL[game.format])}</span>
                  <WinnerMark locale={locale} winner={game.winner} />
                  <ProtocolLink locale={locale} id={game.id} />
                </li>
              ))}
            </ul>
          ) : <p className="text-muted">{t("Завершённых партий в этот вечер нет.")}</p>}
        </Card>
      )}

      {!open && (
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/evenings">{t("Следующий игровой вечер")}</ButtonLink>
          <ButtonLink href="/history" variant="outline">{t("История игр")}</ButtonLink>
        </div>
      )}
    </>
  );
}
