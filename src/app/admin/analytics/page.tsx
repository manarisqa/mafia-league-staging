import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { analyticsRange, ClubAnalyticsSchema, type ClubAnalytics } from "@/lib/club-analytics";
import { FORMAT_LABEL, fullDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n/messages";
import { getLocale } from "@/lib/i18n/server";
import { siteText } from "@/lib/i18n/site";
import { analyticsText } from "./text";

export async function generateMetadata(): Promise<Metadata> {
  return { title: analyticsText[await getLocale()].title };
}

export default function AdminAnalyticsPage(props: PageProps<"/admin/analytics">) {
  return <Suspense><Analytics searchParams={props.searchParams} /></Suspense>;
}

async function Analytics({ searchParams }: Pick<PageProps<"/admin/analytics">, "searchParams">) {
  const [{ supabase }, locale, search] = await Promise.all([requireAdmin(), getLocale(), searchParams]);
  const t = analyticsText[locale];
  const { range, defaults, invalid } = analyticsRange(search.from, search.to);
  const { data, error } = await supabase.rpc("club_analytics", { p_from: range.from, p_to: range.to });
  const result = ClubAnalyticsSchema.safeParse(data);
  const stats = result.success ? result.data : null;
  const dateStyle = "min-h-11 min-w-0 max-w-full rounded-control border border-border bg-elevated px-3 text-text";

  return (
    <div className="space-y-6">
      <header className="rounded-card border border-border bg-[radial-gradient(ellipse_at_top_right,rgba(170,35,53,0.28),transparent_70%)] p-5 sm:p-8">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">{t.title}</h1>
        <p className="mt-2 text-muted">{t.intro}</p>
        <form action="/admin/analytics" className="mt-6 flex flex-wrap items-end gap-3" aria-describedby="analytics-date-help">
          <label className="grid max-w-full gap-1 text-sm text-muted">
            {t.start}
            <input type="date" name="from" defaultValue={range.from} required className={dateStyle} />
          </label>
          <label className="grid max-w-full gap-1 text-sm text-muted">
            {t.end}
            <input type="date" name="to" defaultValue={range.to} required className={dateStyle} />
          </label>
          <button className="min-h-11 rounded-control bg-accent px-5 font-medium hover:bg-accent-hover">{t.apply}</button>
          {(range.from !== defaults.from || range.to !== defaults.to) &&
            <Link href="/admin/analytics" className="inline-flex min-h-11 items-center px-2 text-sm text-accent-text hover:underline">{t.defaultPeriod}</Link>
          }
        </form>
        <p id="analytics-date-help" className="mt-2 text-sm text-muted">{t.dateHelp}</p>
        {invalid && <p role="status" className="mt-3 text-sm text-accent-text">{t.invalidPeriod}</p>}
      </header>

      {error || !stats
        ? <Card><p role="status" className="text-muted">{t.unavailable}</p></Card>
        : <AnalyticsResults locale={locale} stats={stats} />}
    </div>
  );
}

function AnalyticsResults({ locale, stats }: { locale: Locale; stats: ClubAnalytics }) {
  const t = analyticsText[locale];
  const { evenings, games, people, rsvp, months, recent } = stats;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const month = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", timeZone: "UTC" });
  const gameCount = games.classic10 + games.short9;
  const decimal = (value: number | null) => value === null ? "—" : number.format(value);
  const ratio = (top: number, bottom: number) =>
    bottom > 0 ? `${percent.format(top / bottom)} · ${number.format(top)} / ${number.format(bottom)}` : "—";

  return (
    <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric label={t.scheduled} value={number.format(evenings.scheduled)} prominent />
        <Metric label={t.upcoming} value={number.format(evenings.upcoming)} prominent />
        <Metric label={t.held} value={number.format(evenings.held)} prominent />
        <Metric label={t.games} value={number.format(gameCount)} prominent />
        <Metric label={t.gamePlayers} value={number.format(games.players)} prominent />
        <div className="rounded-card border border-border bg-surface px-4 py-2 sm:px-5">
          <dt className="sr-only">{t.otherStates}</dt>
          <dd>
            <dl className="divide-y divide-border">
              <Metric label={t.cancelled} value={number.format(evenings.cancelled)} />
              <Metric label={t.unresolved} value={number.format(evenings.unresolved)} />
            </dl>
          </dd>
        </div>
      </dl>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t.attendance}>
          <dl className="divide-y divide-border">
            <Metric label={t.coverage} value={ratio(evenings.recorded, evenings.held)} />
            <Metric label={t.average} value={decimal(evenings.visits === null ? null : evenings.visits / evenings.recorded)} />
            <Metric label={t.uniqueAttendees} value={decimal(evenings.recorded > 0 ? people.unique : null)} />
            <Metric label={t.rsvp} value={ratio(rsvp.matched, rsvp.confirmed)} />
          </dl>
          {evenings.recorded === 0
            ? <p className="mt-3 text-sm text-muted">{t.noCoverage}</p>
            : rsvp.confirmed === 0 && <p className="mt-3 text-sm text-muted">{t.noRsvp}</p>}
        </Card>
        <Card title={t.participation}>
          <dl className="divide-y divide-border">
            <Metric label={t.first} value={decimal(evenings.recorded > 0 ? people.first : null)} />
            <Metric label={t.returning} value={decimal(evenings.recorded > 0 ? people.returning : null)} />
            <Metric label={t.returnRate} value={ratio(people.returned, people.eligible)} />
            <Metric label={t.returnCoverage} value={ratio(people.eligible, people.first)} />
            <Metric label={t.gaps} value={decimal(people.medianDays)} />
            <Metric label={t.gapSamples} value={decimal(evenings.recorded > 0 ? people.gaps : null)} />
          </dl>
        </Card>
      </div>

      <Card title={t.formats}>
        {gameCount === 0 ? <p className="text-muted">{t.noGames}</p> : (
          <ul className="grid gap-5 sm:grid-cols-2">
            {(["classic10", "short9"] as const).map((format) => {
              const name = siteText(locale, FORMAT_LABEL[format]);
              return (
                <li key={format} className="space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{name}</span>
                    <span className="text-sm tabular-nums text-muted">{ratio(games[format], gameCount)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-elevated" aria-hidden="true">
                    <div className="h-full rounded-full bg-accent-text" style={{ width: `${100 * games[format] / gameCount}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title={t.monthly}>
        {months.length === 0 ? <p className="text-muted">{t.noEvenings}</p> : (
          <ul className="divide-y divide-border">
            {months.map((entry) => (
              <li key={entry.month} className="grid gap-2 py-3 sm:grid-cols-[minmax(7rem,1fr)_3fr] sm:items-center">
                <h3 className="font-medium">{month.format(new Date(entry.month + "-01T00:00:00Z"))}</h3>
                <dl className="grid grid-cols-2 gap-x-4 sm:grid-cols-4">
                  <MonthValue label={t.held} value={number.format(entry.held)} />
                  <MonthValue label={t.coverage} value={entry.held ? `${number.format(entry.recorded)} / ${number.format(entry.held)}` : "—"} />
                  <MonthValue label={t.visits} value={decimal(entry.visits)} />
                  <MonthValue label={t.gameCount} value={number.format(entry.games)} />
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t.recent}>
        {recent.length === 0 ? <p className="text-muted">{t.noHeld}</p> : (
          <>
            <p className="mb-2 text-sm text-muted">{t.recentCaption}</p>
            <ul className="divide-y divide-border">
              {recent.map((evening) => (
                <li key={evening.id}>
                  <Link href={`/admin/evenings/${evening.id}`}
                    className="grid min-h-11 gap-1 py-3 hover:text-accent-text sm:grid-cols-[2fr_1fr_1fr] sm:items-center">
                    <span className="min-w-0 break-words">
                      <span className="block font-medium">{fullDateTime(evening.starts_at, locale)}</span>
                      <span className="text-sm text-muted">{evening.place}</span>
                    </span>
                    <span className="text-sm text-muted">{t.gameCount} · {number.format(evening.games)}</span>
                    <span className="text-sm text-muted">
                      {evening.attendance === null ? t.noRoster : `${t.rosterCount} · ${number.format(evening.attendance)}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <details className="rounded-card border border-border bg-surface px-5">
        <summary className="min-h-12 cursor-pointer py-3 font-medium">{t.definitions}</summary>
        <ul className="space-y-3 border-t border-border py-4 text-sm text-muted">
          {[t.eveningDefinition, t.gameDefinition, t.rosterDefinition, t.rsvpDefinition, t.returnDefinition, t.gapDefinition]
            .map((item) => <li key={item}>{item}</li>)}
        </ul>
      </details>
    </>
  );
}

function Metric({ label, value, prominent }: { label: string; value: ReactNode; prominent?: boolean }) {
  return prominent
    ? <div className="flex flex-col-reverse gap-1 rounded-card border border-border bg-surface p-4 sm:p-5">
        <dt className="text-sm text-muted">{label}</dt>
        <dd className="font-display text-3xl font-bold tabular-nums sm:text-4xl">{value}</dd>
      </div>
    : <div className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
        <dt className="text-sm text-muted">{label}</dt>
        <dd className="text-sm font-medium tabular-nums">{value}</dd>
      </div>;
}

function MonthValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col-reverse gap-1">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
