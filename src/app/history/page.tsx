import { siteText } from "@/lib/i18n/site";
import type { Locale } from "@/lib/i18n/messages";
import { getLocale } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";
import { ProtocolLink, SeasonCard, TotalsStrip, WinnerMark } from "@/app/history/history-ui";
import { DemoBadge } from "@/components/ui";
import { getHistory, showDemoBadge, type HistoryEvening } from "@/lib/data";
import { FORMAT_LABEL, eveningParts, plural } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  return { title: siteText(await getLocale(), "История · Вечера") };
}

function EveningRow({ locale, e, open }: { locale: Locale; e: HistoryEvening; open: boolean }) {
  const t = (label: string) => siteText(locale, label);
  const { day, month } = eveningParts(e.startsAt, locale);
  const year = new Intl.DateTimeFormat(locale, { timeZone: "Europe/Vienna", year: "numeric" }).format(
    new Date(e.startsAt),
  );
  const red = e.games.filter((g) => g.winner === "red").length;
  const black = e.games.filter((g) => g.winner === "black").length;

  return (
    <li>
      <details open={open} className="group rounded-card border border-border bg-surface open:border-accent/60">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-6 gap-y-3 p-4 sm:p-5 [&::-webkit-details-marker]:hidden">
          <span className="flex w-14 shrink-0 flex-col items-center text-center leading-tight">
            <span className="font-display text-3xl font-bold text-accent-text">{day}</span>
            <span className="text-xs text-muted">{month}</span>
            <span className="text-xs text-muted">{year}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-xl font-bold">{t("Игровой вечер №")}{e.number}</span>
            <span className="mt-1 block text-sm text-muted">
              {e.place} · {t("Играли за столом")} · {e.participants} {plural(e.participants, ["участник", "участника", "участников"].map(t) as [string, string, string])}
            </span>
          </span>
          <span className="flex items-center gap-5 text-sm text-muted">
            <span>
              <span className="font-medium text-text">{e.games.length}</span>{" "}
              {plural(e.games.length, ["партия", "партии", "партий"].map(t) as [string, string, string])}
            </span>
            <span className="inline-flex items-center gap-1.5" title={t("Победы красных")}>
              <span aria-hidden className="size-2.5 rounded-full bg-side-red" />
              <span className="sr-only">{t("Победы красных:")}</span>
              <span className="font-medium text-text">{red}</span>
            </span>
            <span className="inline-flex items-center gap-1.5" title={t("Победы чёрных")}>
              <span aria-hidden className="size-2.5 rounded-full bg-side-black" />
              <span className="sr-only">{t("Победы чёрных:")}</span>
              <span className="font-medium text-text">{black}</span>
            </span>
            <svg
              aria-hidden
              width="16"
              height="16"
              viewBox="0 0 16 16"
              className="transition-transform group-open:rotate-180"
            >
              <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
        </summary>

        <div className="border-t border-border px-4 pb-2 sm:px-5">
          <Link href={`/evenings/${e.id}`} className="inline-flex min-h-11 items-center text-sm text-accent-text hover:underline">{t("О вечере")}</Link>
          {e.games.length === 0 ? (
            <p className="py-4 text-sm text-muted">{t("Завершённых партий в этот вечер нет.")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th scope="col" className="py-3 pr-4 font-normal">№</th>
                    <th scope="col" className="py-3 pr-4 font-normal">{t("Формат")}</th>
                    <th scope="col" className="py-3 pr-4 font-normal">{t("Победила сторона")}</th>
                    <th scope="col" className="py-3 pr-4 font-normal">{t("Игроков")}</th>
                    <th scope="col" className="py-3 font-normal"><span className="sr-only">{t("Протокол")}</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {e.games.map((g) => (
                    <tr key={g.id}>
                      <td className="py-1 pr-4 tabular-nums">{g.no}</td>
                      <td className="py-1 pr-4">{t(FORMAT_LABEL[g.format])}</td>
                      <td className="py-1 pr-4"><WinnerMark locale={locale} winner={g.winner} /></td>
                      <td className="py-1 pr-4 tabular-nums">{g.players}</td>
                      <td className="py-1 text-right"><ProtocolLink locale={locale} id={g.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

export default async function HistoryEveningsPage() {
  const locale = await getLocale();
  const t = (label: string) => siteText(locale, label);
  const { evenings, seasons, totals } = await getHistory();
  const demo = showDemoBadge();

  return (
    <>
      {demo && (
        <div className="flex justify-end">
          <DemoBadge locale={locale} />
        </div>
      )}
      <TotalsStrip locale={locale} totals={totals} caption={t("За всё время")} />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="evenings-title">
          <h2 id="evenings-title" className="mb-4 font-display text-2xl font-bold">{t("Игровые вечера")}</h2>
          {evenings.length === 0 ? (
            <p className="text-muted">{t("Проведённых вечеров пока нет.")}</p>
          ) : (
            <ul className="space-y-3">
              {evenings.map((e, i) => (
                <EveningRow locale={locale} key={e.id} e={e} open={i === 0} />
              ))}
            </ul>
          )}
        </section>

        <aside aria-labelledby="seasons-title">
          <h2 id="seasons-title" className="mb-4 font-display text-2xl font-bold">{t("Сезоны клуба")}</h2>
          {seasons.length === 0 ? (
            <p className="text-muted">{t("Сезоны пока не заведены.")}</p>
          ) : (
            <ul className="space-y-3">
              {seasons.map((s) => (
                <li key={s.id}>
                  <SeasonCard locale={locale} season={s} />
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </>
  );
}
