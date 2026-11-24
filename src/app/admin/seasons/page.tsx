import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Card } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getLeague } from "@/lib/data";
import { FORMAT_LABEL, plural } from "@/lib/format";
import { seasonLabel, seasonText } from "@/lib/i18n/seasons";
import { getLocale } from "@/lib/i18n/server";
import { siteText } from "@/lib/i18n/site";
import { clubDate } from "@/lib/league/core";
import { ALL_CLUB_HISTORY, CLUB_QUARTERS, clubYearPeriod, parseClubPeriod } from "@/lib/league/period";
import { clubSeasonSummary, clubSeasonYears, NOMINATION_METRICS, preliminaryCandidates, SEASON_FORMATS } from "@/lib/league/seasons";

const control = "mt-1 block min-h-11 w-full rounded-control border border-border bg-elevated px-3 text-text";

export async function generateMetadata(): Promise<Metadata> {
  return { title: seasonText(await getLocale()).nominationTitle };
}

export default function AdminSeasonsPage({ searchParams }: PageProps<"/admin/seasons">) {
  return <Suspense><NominationPreview searchParams={searchParams} /></Suspense>;
}

async function NominationPreview({ searchParams }: Pick<PageProps<"/admin/seasons">, "searchParams">) {
  await requireAdmin();
  const [locale, query, league] = await Promise.all([getLocale(), searchParams, getLeague(), connection()]);
  const text = seasonText(locale);
  const now = new Date().toISOString();
  const current = clubYearPeriod(Number(clubDate(now).slice(0, 4)));
  const period = parseClubPeriod(query.period) ?? current;
  const years = clubSeasonYears(league, now);
  if (period.year && !years.includes(period.year)) years.unshift(period.year);
  const format = query.format === "short9" ? query.format : "classic10";
  const metric = query.metric === "wins" ? query.metric : "evenings";
  const metrics = { evenings: text.nominationEvenings, wins: text.nominationWins };
  const descriptions = { evenings: text.nominationEveningsHelp, wins: text.nominationWinsHelp };
  const summary = clubSeasonSummary(league, period, { normalOnly: metric === "wins" }).formats[format];
  const candidates = preliminaryCandidates(summary.players, metric)
    .sort((a, b) => a.name.localeCompare(b.name, locale) || a.id.localeCompare(b.id));
  const title = `${text.draft} · ${metrics[metric]}`;
  const scope = `${seasonLabel(period, locale)} · ${siteText(locale, FORMAT_LABEL[format])}`;
  const t = (label: string) => siteText(locale, label);
  const games = (count: number) => `${count} ${plural(count, [t("партия"), t("партии"), t("партий")])}`;
  const evenings = (count: number) => `${count} ${plural(count, [t("вечер"), t("вечера"), t("вечеров")])}`;
  const playerCount = summary.players.length;
  const players = `${playerCount} ${plural(playerCount, [t("игрок"), t("игрока"), t("игроков")])}`;
  const sample = `${text.sample} · ${games(summary.games)} · ${players}`;
  const candidateLine = (player: (typeof candidates)[number]) => metric === "wins"
    ? `${player.wins}/${player.games}`
    : `${evenings(player.evenings)} · ${games(player.games)}`;
  const draft = [
    title, scope, sample, "", descriptions[metric], "",
    ...candidates.map((player) => `• ${player.name} · ${candidateLine(player)}`),
  ].join("\n");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">{text.nominationTitle}</h1>
        <p className="mt-2 max-w-2xl text-muted">{text.nominationHelp}</p>
      </div>

      <Card>
        <form method="get" className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.5fr_auto]">
          <label className="block min-w-0 text-sm text-muted">{text.period}
            <select className={control} name="period" defaultValue={period.key}>
              <option value={ALL_CLUB_HISTORY.key}>{text.all}</option>
              {years.map((year) => (
                <optgroup label={String(year)} key={year}>
                  <option value={String(year)}>{seasonLabel(clubYearPeriod(year), locale)}</option>
                  {CLUB_QUARTERS.map((quarter) => {
                    const option = clubYearPeriod(year, quarter);
                    return <option key={option.key} value={option.key}>{seasonLabel(option, locale)}</option>;
                  })}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="block min-w-0 text-sm text-muted">{text.format}
            <select name="format" defaultValue={format} className={control}>
              {SEASON_FORMATS.map((key) => <option key={key} value={key}>{siteText(locale, FORMAT_LABEL[key])}</option>)}
            </select>
          </label>
          <label className="block min-w-0 text-sm text-muted">{text.nominationMetric}
            <select name="metric" defaultValue={metric} className={control}>
              {NOMINATION_METRICS.map((key) => <option key={key} value={key}>{metrics[key]}</option>)}
            </select>
          </label>
          <button type="submit" className="min-h-11 rounded-control bg-accent px-4 font-medium hover:bg-accent-hover">{text.nominationBuild}</button>
        </form>
      </Card>

      <Card title={title} className="border-accent/50">
        <p className="font-medium">{scope}</p>
        <p className="mt-1 text-sm text-muted">{sample}</p>
        <p className="mt-3 max-w-2xl text-sm text-muted">{descriptions[metric]}</p>
        {candidates.length ? (
          <>
            <ul className="mt-4 divide-y divide-border">
              {candidates.map((player) => (
                <li key={player.id} className="flex flex-wrap items-center justify-between gap-x-4">
                  <Link href={`/players/${player.id}`} className="py-3 [overflow-wrap:anywhere] hover:text-accent-text">{player.name}</Link>
                  <span className="pb-3 font-medium tabular-nums sm:py-3">{candidateLine(player)}</span>
                </li>
              ))}
            </ul>
            <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(draft)}`} download={`mafia-league-${period.key}-${format}-draft.txt`}
              className="mt-4 inline-flex min-h-11 items-center rounded-control border border-border px-4 text-sm hover:border-accent-text">{text.nominationExport}</a>
          </>
        ) : <p className="mt-4 text-sm text-muted">{text.nominationEmpty}</p>}
      </Card>
    </div>
  );
}
