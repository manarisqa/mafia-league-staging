import { siteText } from "@/lib/i18n/site";
import { getLocale } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { Suspense } from "react";
import { RsvpPanel } from "@/app/evenings/rsvp-panel";
import { DEMO_FORMATS } from "@/lib/demo";
import { getNextEvening, showDemoBadge } from "@/lib/data";
import { Avatar, ButtonLink, Card, DemoBadge, PageHero } from "@/components/ui";

export async function generateMetadata(): Promise<Metadata> {
  return { title: siteText(await getLocale(), "Вечера") };
}

export default async function EveningsPage() {
  const locale = await getLocale();
  const t = (label: string) => siteText(locale, label);
  const e = await getNextEvening(locale);
  const demo = showDemoBadge();

  return (
    <>
      <PageHero
        title={t("Ближайший игровой вечер")}
        subtitle={t("Дружеская атмосфера, живое общение и развитие через игру. Добро пожаловать!")}
      />

      <div className="mx-auto max-w-3xl space-y-4 px-4 py-10 sm:px-6">
        {!e ? (
          <Card>
            <p className="text-muted">{t("Ближайший вечер пока не назначен. Загляните позже — мы обязательно объявим дату.")}</p>
          </Card>
        ) : (
          <>
            <Card>
              {demo && (
                <div className="mb-4 flex justify-end">
                  <DemoBadge locale={locale} />
                </div>
              )}
              <div className="flex gap-5">
                <div className="flex size-24 shrink-0 flex-col items-center justify-center rounded-card border border-border bg-elevated">
                  <span className="text-xs text-muted">{e.weekday}</span>
                  <span className="font-display text-4xl leading-none font-bold">{e.day}</span>
                  <span className="text-xs text-muted">{e.month}</span>
                </div>
                <div className="min-w-0">
                  <p className="font-display text-3xl font-bold">{t("Начало в")} {e.time}</p>
                  <p className="mt-2 text-muted">{e.place}</p>
                  <p className="mt-1 text-sm text-muted">{t("Играем по правилам спортивной Мафии")}</p>
                </div>
              </div>
            </Card>

            {e.id ? (
              <Suspense fallback={<p className="text-muted">{t("Загрузка…")}</p>}>
                <RsvpPanel eveningId={e.id} />
              </Suspense>
            ) : (
              <p className="text-center text-sm text-muted">{t("Запись откроется, когда подключится база данных.")}</p>
            )}

            <Card title={t("Участники")} locale={locale} demo={demo}>
              <p className="mb-4 text-sm text-muted">
                <span className="font-medium text-text">
                  {e.signedUp} {t("из")} {e.capacity}
                </span>{" "}{t("уже записались")}</p>
              <ul className="flex flex-wrap gap-4">
                {e.participants.map(({ id, name }) => (
                  <li key={id} className="flex w-16 flex-col items-center gap-1 text-center">
                    <Avatar name={name} size={52} />
                    <span className="w-full truncate text-xs text-muted">{name}</span>
                  </li>
                ))}
                {e.capacity > e.signedUp && (
                  <li className="flex w-16 flex-col items-center gap-1 text-center">
                    <span
                      aria-hidden
                      className="flex size-[52px] items-center justify-center rounded-full border border-dashed border-border text-muted"
                    >
                      +
                    </span>
                    <span className="text-xs text-muted">{t("ещё")} {e.capacity - e.signedUp}</span>
                  </li>
                )}
              </ul>
            </Card>

            <Card title={t("Ведущий")} locale={locale} demo={demo}>
              {e.hostName ? (
                <p className="flex items-center gap-2">
                  <span aria-hidden className="size-2.5 rounded-full bg-success" />
                  {e.hostName}
                </p>
              ) : (
                <p className="text-muted">{t("Ведущий пока не назначен.")}</p>
              )}
              <p className="mt-2 text-sm text-muted">{t("Ведущий — отдельный человек, он не играет за столом.")}</p>
            </Card>
          </>
        )}

        <Card title={t("Формат игры")}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {DEMO_FORMATS.map((f, i) => (
              <li
                key={t(f.name)}
                className={`rounded-panel border p-4 ${
                  i === 0 ? "border-accent-text" : "border-border"
                }`}
              >
                <p className="font-medium">{t(f.name)}</p>
                <p className="mt-1 text-sm text-muted">{t(f.players)}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted">{t("Формат определяется организатором по составу участников. Один физический игровой стол.")}</p>
        </Card>

        <Card title={t("Впервые играете?")} className="border-accent/40">
          <p className="text-muted">{t("Встретим новичков, объясним правила, подскажем на первых играх и поможем комфортно влиться в компанию.")}</p>
          <div className="mt-4">
            <ButtonLink href="/learn" variant="outline">{t("Как начать")}</ButtonLink>
          </div>
        </Card>

      </div>
    </>
  );
}
