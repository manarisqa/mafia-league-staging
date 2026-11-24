import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, DemoBadge } from "@/components/ui";
import { SeasonCard } from "@/app/history/history-ui";
import { getHistory, getLeague, showDemoBadge } from "@/lib/data";
import { FORMAT_LABEL } from "@/lib/format";
import type { Locale } from "@/lib/i18n/messages";
import { seasonLabel, seasonText } from "@/lib/i18n/seasons";
import { getLocale } from "@/lib/i18n/server";
import { siteText } from "@/lib/i18n/site";
import { clubDate } from "@/lib/league/core";
import { CLUB_QUARTERS, clubYearPeriod, parseClubPeriod, type ClubPeriod } from "@/lib/league/period";
import { clubSeasonSummary, clubSeasonYears, SEASON_FORMATS, type SeasonFormat, type SeasonPlayer } from "@/lib/league/seasons";

const PAGE_SIZE = 16;
const SEASON_PATH = "/history/seasons";
const control = "inline-flex min-h-11 items-center rounded-control border px-3 text-sm transition-colors";
const selected = "border-accent bg-accent text-text";
const unselected = "border-border text-muted hover:border-accent hover:text-text";

type Search = { [key: string]: string | string[] | undefined };

export async function SeasonReport({ params, searchParams }: { params?: Promise<{ period: string }>; searchParams: Promise<Search> }) {
  const [locale, route, query, league] = await Promise.all([getLocale(), params, searchParams, getLeague()]);
  const text = seasonText(locale);
  const now = new Date().toISOString();
  const currentYear = Number(clubDate(now).slice(0, 4));
  const period = route ? parseClubPeriod(route.period) : clubYearPeriod(currentYear);
  if (!period) notFound();

  const basePath = route ? `${SEASON_PATH}/${period.key}` : SEASON_PATH;
  const format = query.format === "short9" ? query.format : "classic10";
  const summary = clubSeasonSummary(league, period);
  const years = clubSeasonYears(league, now);
  const alternateYears = period.year && !years.includes(period.year) ? [period.year, ...years] : years;

  return (
    <>
      <section className="space-y-4" aria-labelledby="season-title">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 id="season-title" className="font-display text-2xl font-bold sm:text-3xl">{seasonLabel(period, locale)}</h2>
          {period.year === currentYear && !period.quarter && <span className="text-sm text-accent-text">{text.current}</span>}
          {showDemoBadge() && <DemoBadge locale={locale} />}
        </div>
        <p className="max-w-3xl text-sm text-muted">{text.intro}</p>
        <nav className="flex flex-wrap gap-2" aria-label={text.archive}>
          {[...alternateYears.map((year) => String(year)), "all"].map((key) => (
            <PeriodLink key={key} periodKey={key} active={period.year ? String(period.year) === key : key === "all"}>
              {key === "all" ? text.all : key}
            </PeriodLink>
          ))}
        </nav>
        {period.year !== null && <QuarterLinks period={period} locale={locale} />}
      </section>

      <Card title={text.activity}>
        <dl className="grid grid-cols-3 gap-2 sm:gap-6">
          {[
            [text.evenings, summary.evenings],
            [text.games, summary.games],
            [text.players, summary.players],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col-reverse justify-end">
              <dt className="text-xs text-muted sm:text-sm">{label}</dt>
              <dd className="font-display text-3xl font-bold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 max-w-3xl text-sm text-muted">{text.definitions} {text.playerDefinition}</p>
      </Card>

      <section aria-labelledby="season-formats" className="space-y-4">
        <h2 id="season-formats" className="font-display text-2xl font-bold">{text.formats}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {SEASON_FORMATS.map((key) => {
            const { games, outcomes } = summary.formats[key];
            return <Card key={key} title={siteText(locale, FORMAT_LABEL[key])} className={key === "classic10" ? "border-accent/40" : undefined}>
              {games ? <dl className="grid grid-cols-3 gap-2">
                {[
                  [text.red, outcomes.red, "bg-side-red"],
                  [text.black, outcomes.black, "bg-side-black"],
                  [text.draws, outcomes.draw, "border border-muted"],
                ].map(([label, count, dot]) => (
                  <div key={label} className="flex flex-col-reverse justify-end">
                    <dt className="text-xs text-muted sm:text-sm">{label}</dt>
                    <dd className="flex items-center gap-1.5 font-display text-lg font-bold tabular-nums">
                      <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot}`} />
                      {count}/{games}
                    </dd>
                  </div>
                ))}
              </dl> : <p className="text-sm text-muted">{text.outcomesEmpty}</p>}
            </Card>;
          })}
        </div>
      </section>

      <section id="season-player-results" className="scroll-mt-20" aria-label={text.results}>
        <Card title={text.results}>
          <nav className="flex flex-wrap gap-2" aria-label={text.format}>
            {SEASON_FORMATS.map((key) => (
              <Link key={key} href={resultsHref(basePath, key, 1)} aria-current={format === key ? "true" : undefined}
                className={`${control} ${format === key ? selected : unselected}`}>
                {siteText(locale, FORMAT_LABEL[key])}
              </Link>
            ))}
          </nav>
          <PlayerResults locale={locale} players={summary.formats[format].players} basePath={basePath} format={format} requestedPage={query.page} />
        </Card>
      </section>
      {!route && <LegacySeasons locale={locale} />}
    </>
  );
}

function PeriodLink({ periodKey, active, children }: { periodKey: string; active: boolean; children: string }) {
  return <Link href={`${SEASON_PATH}/${periodKey}`} aria-current={active ? "true" : undefined}
    className={`${control} ${active ? selected : unselected}`}>{children}</Link>;
}

function QuarterLinks({ period, locale }: { period: ClubPeriod & { year: number }; locale: Locale }) {
  const text = seasonText(locale);
  return (
    <nav className="flex flex-wrap gap-2" aria-label={text.quarters}>
      <PeriodLink periodKey={String(period.year)} active={!period.quarter}>{text.annual}</PeriodLink>
      {CLUB_QUARTERS.map((quarter) => (
        <PeriodLink key={quarter} periodKey={clubYearPeriod(period.year, quarter).key} active={period.quarter === quarter}>
          {`${quarter} ${text.quarter}`}
        </PeriodLink>
      ))}
    </nav>
  );
}

function resultsHref(basePath: string, format: SeasonFormat, page: number) {
  const params = new URLSearchParams({ format });
  if (page > 1) params.set("page", String(page));
  return `${basePath}?${params}#season-player-results`;
}

function PlayerResults({ locale, players, basePath, format, requestedPage }: {
  locale: Locale;
  players: SeasonPlayer[];
  basePath: string;
  format: SeasonFormat;
  requestedPage: Search[string];
}) {
  const text = seasonText(locale);
  if (!players.length) return <p className="mt-4 text-sm text-muted">{text.noResults}</p>;
  const pageCount = Math.ceil(players.length / PAGE_SIZE);
  const parsedPage = typeof requestedPage === "string" && /^\d+$/.test(requestedPage) ? Number(requestedPage) : 1;
  const page = Math.min(Math.max(1, parsedPage), pageCount);
  const pagePlayers = [...players].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name, locale) || a.id.localeCompare(b.id))
    .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return (
    <>
      <p className="mt-4 text-sm text-muted">{text.resultHelp}</p>
      <table className="mt-3 w-full table-fixed text-left text-sm">
        <thead className="text-xs text-muted sm:text-sm">
          <tr>
            <th scope="col" className="w-[31%] py-2 pr-1 font-normal sm:w-2/5">{text.player}</th>
            <th scope="col" className="break-words py-2 pr-1 text-right font-normal tracking-tight">{text.wins}</th>
            <th scope="col" className="break-words py-2 pr-1 text-right font-normal tracking-tight">{text.losses}</th>
            <th scope="col" className="break-words py-2 text-right font-normal tracking-tight">{text.draws}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {pagePlayers.map((player) => (
            <tr key={player.id}>
              <th scope="row" className="pr-1 font-medium">
                <Link href={`/players/${player.id}`} className="block min-h-11 py-3 [overflow-wrap:anywhere] hover:text-accent-text">{player.name}</Link>
              </th>
              <td className="pr-1 text-right tabular-nums">{player.wins}/{player.games}</td>
              <td className="pr-1 text-right tabular-nums">{player.losses}/{player.games}</td>
              <td className="text-right tabular-nums">{player.draws}/{player.games}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {pageCount > 1 && <nav className="mt-4 flex flex-wrap items-center gap-2" aria-label={text.pages}>
        {page > 1 && <Link href={resultsHref(basePath, format, page - 1)} className={`${control} ${unselected}`}>{text.prev}</Link>}
        <span className="px-2 text-sm tabular-nums text-muted">{page} / {pageCount}</span>
        {page < pageCount && <Link href={resultsHref(basePath, format, page + 1)} className={`${control} ${unselected}`}>{text.next}</Link>}
      </nav>}
    </>
  );
}

async function LegacySeasons({ locale }: { locale: Locale }) {
  const text = seasonText(locale);
  const { seasons } = await getHistory();
  if (!seasons.length) return null;
  return <details className="rounded-card border border-border bg-surface">
    <summary className="min-h-11 cursor-pointer p-4 font-medium">{text.legacy}</summary>
    <div className="space-y-3 p-4 pt-0">
      <p className="text-sm text-muted">{text.legacyHelp}</p>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {seasons.map((season) => <li key={season.id}><SeasonCard locale={locale} season={season} /></li>)}
      </ul>
    </div>
  </details>;
}
