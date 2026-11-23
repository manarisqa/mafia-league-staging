import { siteText } from "@/lib/i18n/site";
import { getLocale } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";
import { getRating, showDemoBadge } from "@/lib/data";
import { STATUS_LABEL } from "@/lib/format";
import { Avatar, DemoBadge, PageHero } from "@/components/ui";

export async function generateMetadata(): Promise<Metadata> {
  return { title: siteText(await getLocale(), "Игроки") };
}

export default async function PlayersPage() {
  const locale = await getLocale();
  const t = (label: string) => siteText(locale, label);
  const players = await getRating();
  const demo = showDemoBadge();

  return (
    <>
      <PageHero
        title={t("Игроки клуба")}
        subtitle={t("Люди, с которыми мы играем, соревнуемся и развиваемся.")}
      />
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">{players.length} {t("игроков")}</p>
          {demo && <DemoBadge locale={locale} />}
        </div>

        {players.length === 0 ? (
          <p className="text-muted">{t("Игроков пока нет.")}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {players.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/players/${p.id}`}
                  className="block h-full rounded-card border border-border bg-surface p-5 transition-colors hover:border-accent-text"
                >
                  <div className="flex items-center gap-3">
                    <Avatar name={p.name} size={52} />
                    <div className="min-w-0">
                      <p className="truncate font-display text-lg font-bold">{p.name}</p>
                      <span
                        className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs ${
                          p.status === "club_member"
                            ? "bg-accent/20 text-accent-text"
                            : "bg-elevated text-muted"
                        }`}
                      >
                        {t(STATUS_LABEL[p.status])}
                      </span>
                    </div>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-muted">{t("Партий")}</dt>
                      <dd className="font-medium">{p.games}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">{t("Рейтинг")}</dt>
                      <dd className="font-medium tabular-nums">
                        {p.skillGames > 0 ? `${Math.round(p.rating)}${p.provisional ? ` · ${t("предвар.")}` : ""}` : t("нет оценки Classic10")}
                      </dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
