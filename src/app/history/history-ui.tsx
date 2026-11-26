import { siteText } from "@/lib/i18n/site";
import type { Locale } from "@/lib/i18n/messages";
import Link from "next/link";
import type { HistoryTotals, SeasonSummary } from "@/lib/data";
import { WINNER_SHORT, monthYear, plural } from "@/lib/format";
import type { Winner } from "@/lib/rating";

/** Победившая сторона: цветная метка и подпись (цвет не единственный признак). */
export function WinnerMark({ locale, winner }: { locale: Locale; winner: Winner }) {
  const t = (label: string) => siteText(locale, label);
  const dot =
    winner === "red" ? "bg-side-red" : winner === "black" ? "bg-side-black" : "border border-muted";
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${dot}`} />
      {t(WINNER_SHORT[winner])}
    </span>
  );
}

function share(part: number, total: number) {
  return total > 0 ? ` (${Math.round((part / total) * 100)}%)` : "";
}

/** Сводка: вечера, партии, участники, победы красных и чёрных. */
export function TotalsStrip({ locale, totals, caption }: { locale: Locale; totals: HistoryTotals; caption: string }) {
  const t = (label: string) => siteText(locale, label);
  const decided = totals.redWins + totals.blackWins;
  const items = [
    { value: totals.evenings, label: plural(totals.evenings, ["игровой вечер", "игровых вечера", "игровых вечеров"].map(t) as [string, string, string]) },
    { value: totals.games, label: plural(totals.games, ["партия", "партии", "партий"].map(t) as [string, string, string]) },
    { value: totals.players, label: plural(totals.players, ["участник", "участника", "участников"].map(t) as [string, string, string]) },
    {
      value: totals.redWins,
      label: `${plural(totals.redWins, ["победа", "победы", "побед"].map(t) as [string, string, string])} ${t("красных")}${share(totals.redWins, decided)}`,
      dot: "bg-side-red",
    },
    {
      value: totals.blackWins,
      label: `${plural(totals.blackWins, ["победа", "победы", "побед"].map(t) as [string, string, string])} ${t("чёрных")}${share(totals.blackWins, decided)}`,
      dot: "bg-side-black",
    },
  ];
  return (
    <section aria-label={t("Сводка")} className="rounded-card border border-border bg-surface p-5">
      <p className="mb-4 text-sm text-muted">{caption}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((it) => (
          <div key={it.label} className="flex flex-col-reverse">
            <dt className="flex items-center gap-2 text-sm text-muted">
              {it.dot && <span aria-hidden className={`size-2.5 rounded-full ${it.dot}`} />}
              {it.label}
            </dt>
            <dd className="font-display text-3xl font-bold tabular-nums">{it.value}</dd>
          </div>
        ))}
      </dl>
      {totals.draws > 0 && (
        <p className="mt-4 text-sm text-muted">{t("Ничьих:")}{totals.draws}{t(". Проценты считаются только по партиям с победителем.")}</p>
      )}
    </section>
  );
}

export function seasonPeriod(s: SeasonSummary, locale: Locale) {
  const t = (label: string) => siteText(locale, label);
  return `${monthYear(s.startsOn, locale)} — ${s.endsOn ? monthYear(s.endsOn, locale) : t("сейчас")}`;
}

/** Карточка сезона. Сезон без даты окончания считается текущим. */
export function SeasonCard({ locale, season }: { locale: Locale; season: SeasonSummary }) {
  const t = (label: string) => siteText(locale, label);
  const current = !season.endsOn;
  return (
    <article
      className={`rounded-panel border p-4 ${current ? "border-accent bg-accent/10" : "border-border bg-surface"}`}
    >
      {current && (
        <span className="mb-2 inline-flex rounded-full border border-accent/50 px-2.5 py-0.5 text-xs text-accent-text">{t("Текущий сезон")}</span>
      )}
      <h3 className="font-display text-lg font-bold">{season.name}</h3>
      <p className="text-sm text-muted">{seasonPeriod(season, locale)}</p>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        {[
          [season.evenings, plural(season.evenings, ["вечер", "вечера", "вечеров"].map(t) as [string, string, string])],
          [season.games, plural(season.games, ["партия", "партии", "партий"].map(t) as [string, string, string])],
          [season.players, plural(season.players, ["игрок", "игрока", "игроков"].map(t) as [string, string, string])],
        ].map(([value, label]) => (
          <div key={label} className="flex flex-col-reverse">
            <dt className="text-muted">{label}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function ProtocolLink({ locale, id }: { locale: Locale; id: string }) {
  const t = (label: string) => siteText(locale, label);
  return (
    <Link
      href={`/history/games/${id}`}
      className="inline-flex min-h-11 items-center whitespace-nowrap text-accent-text hover:underline"
    >{t("Протокол →")}</Link>
  );
}
