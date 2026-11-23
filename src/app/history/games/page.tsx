import { siteText } from "@/lib/i18n/site";
import { getLocale } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { ProtocolLink, TotalsStrip, WinnerMark } from "@/app/history/history-ui";
import { DemoBadge } from "@/components/ui";
import { getHistory, showDemoBadge } from "@/lib/data";
import { FORMAT_LABEL, shortDate } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  return { title: siteText(await getLocale(), "История · Партии") };
}

export default async function HistoryGamesPage() {
  const locale = await getLocale();
  const t = (label: string) => siteText(locale, label);
  const { evenings, totals } = await getHistory();
  const demo = showDemoBadge();
  // Новые сверху: вечера уже идут от новых к старым, внутри вечера — последняя партия первой.
  const games = evenings.flatMap((e) => [...e.games].reverse().map((g) => ({ ...g, evening: e })));

  return (
    <>
      {demo && (
        <div className="flex justify-end">
          <DemoBadge locale={locale} />
        </div>
      )}
      <TotalsStrip locale={locale} totals={totals} caption={t("За всё время")} />

      <section aria-labelledby="games-title">
        <h2 id="games-title" className="mb-4 font-display text-2xl font-bold">{t("Все партии")}</h2>
        {games.length === 0 ? (
          <p className="text-muted">{t("Сыгранных партий пока нет.")}</p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="bg-surface text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-normal">{t("Дата")}</th>
                  <th scope="col" className="px-4 py-3 font-normal">{t("Вечер")}</th>
                  <th scope="col" className="px-4 py-3 font-normal">{t("Партия")}</th>
                  <th scope="col" className="px-4 py-3 font-normal">{t("Формат")}</th>
                  <th scope="col" className="px-4 py-3 font-normal">{t("Победила сторона")}</th>
                  <th scope="col" className="px-4 py-3 font-normal"><span className="sr-only">{t("Протокол")}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {games.map((g) => (
                  <tr key={g.id}>
                    <td className="px-4 py-1 whitespace-nowrap">{shortDate(g.playedAt, locale)}</td>
                    <td className="px-4 py-1 text-muted">№{g.evening.number}</td>
                    <td className="px-4 py-1 tabular-nums">{g.no}</td>
                    <td className="px-4 py-1">{t(FORMAT_LABEL[g.format])}</td>
                    <td className="px-4 py-1"><WinnerMark locale={locale} winner={g.winner} /></td>
                    <td className="px-4 py-1 text-right"><ProtocolLink locale={locale} id={g.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
