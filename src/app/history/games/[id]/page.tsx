import { siteText } from "@/lib/i18n/site";
import type { Locale } from "@/lib/i18n/messages";
import { getLocale } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WinnerMark } from "@/app/history/history-ui";
import { DemoBadge } from "@/components/ui";
import { getGameProtocol, showDemoBadge } from "@/lib/data";
import { FORMAT_LABEL, ROLE_LABEL, WINNER_LABEL, fullDateTime } from "@/lib/format";
import { sideOf } from "@/lib/rating";
import { isUuid } from "@/lib/validate";

export async function generateMetadata(): Promise<Metadata> {
  return { title: siteText(await getLocale(), "История · Протокол партии") };
}

export default async function GameProtocolPage(props: PageProps<"/history/games/[id]">) {
  const locale = await getLocale();
  const t = (label: string) => siteText(locale, label);
  return (
    <>
      <Link href="/history/games" className="inline-flex min-h-11 items-center text-sm text-accent-text hover:underline">{t("← Все партии")}</Link>
      <Suspense fallback={<p className="text-muted">{t("Загрузка протокола…")}</p>}>
        <Protocol locale={locale} params={props.params} />
      </Suspense>
    </>
  );
}

async function Protocol({ locale, params }: { locale: Locale; params: Promise<{ id: string }> }) {
  const t = (label: string) => siteText(locale, label);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const game = await getGameProtocol(id);
  if (!game) notFound();
  const demo = showDemoBadge();

  return (
    <article className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl font-bold">{t("Партия №")}{game.no} · {t(FORMAT_LABEL[game.format])}
          </h2>
          <p className="mt-2 text-muted">{fullDateTime(game.eveningStartsAt, locale)}</p>
        </div>
        {demo && <DemoBadge locale={locale} />}
      </header>

      <dl className="grid gap-4 rounded-card border border-border bg-surface p-5 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-muted">{t("Победа")}</dt>
          <dd className="mt-1 text-lg font-medium">
            <WinnerMark locale={locale} winner={game.winner} />
          </dd>
          <dd className="text-sm text-muted">{t(WINNER_LABEL[game.winner])}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">{t("Ведущий")}</dt>
          <dd className="mt-1 text-lg font-medium">{game.hostName ?? t("не указан")}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">{t("Игроков за столом")}</dt>
          <dd className="mt-1 text-lg font-medium tabular-nums">{game.seats.length}</dd>
        </div>
      </dl>

      <p className="rounded-control border border-border p-3 text-sm text-muted">
        {game.skillReason ? `${t("Без основного League Skill")}: ${t(game.skillReason)}.` : t("Партия учтена в League Skill · team-logit-v1.")}
      </p>
      <section aria-labelledby="seats-title">
        <h3 id="seats-title" className="mb-4 font-display text-xl font-bold">{t("Рассадка и роли")}</h3>
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead className="bg-surface text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-normal">{t("Место")}</th>
                <th scope="col" className="px-4 py-3 font-normal">{t("Игрок")}</th>
                <th scope="col" className="px-4 py-3 font-normal">{t("Роль")}</th>
                <th scope="col" className="px-4 py-3 font-normal">{t("Сторона")}</th>
                <th scope="col" className="px-4 py-3 font-normal">{t("Итог")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {game.seats.map((s) => {
                const side = sideOf(s.role);
                const result =
                  game.winner === "draw" ? t("Ничья") : side === game.winner ? t("Победа") : t("Поражение");
                return (
                  <tr key={s.seat} className={result === t("Победа") ? "bg-accent/10" : undefined}>
                    <td className="px-4 py-3 font-display text-lg tabular-nums text-accent-text">{s.seat}</td>
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/players/${s.playerId}`} className="hover:text-accent-text hover:underline">
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{t(ROLE_LABEL[s.role])}{s.removed ? ` · ${t("удалён")}` : ""}{s.fouls > 0 ? ` · ${t("фолов")}: ${s.fouls}` : ""}</td>
                    <td className="px-4 py-3">
                      <WinnerMark locale={locale} winner={side} />
                    </td>
                    <td className="px-4 py-3 text-muted">{result}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-sm text-muted">
        {t("Публичный протокол включает результат, рассадку, роли и фолы. Подробный журнал действий доступен ведущему в его пульте.")}
      </p>
    </article>
  );
}
