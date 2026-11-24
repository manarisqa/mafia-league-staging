import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SkillChart, SkillValue } from "@/components/skill";
import { Avatar, Card, DemoBadge } from "@/components/ui";
import { getLeague, showDemoBadge } from "@/lib/data";
import { FORMAT_LABEL, ROLE_LABEL, STATUS_LABEL, WINNER_SHORT, longDate, monthYear, sinceMonth } from "@/lib/format";
import type { Locale } from "@/lib/i18n/messages";
import { insightText } from "@/lib/i18n/player-insights";
import { getLocale } from "@/lib/i18n/server";
import { clubDate, type LeagueProjection, type PlayerStats } from "@/lib/league/core";
import { ALL_CLUB_HISTORY, CLUB_QUARTERS, inClubPeriod, parseClubPeriod, type ClubPeriod } from "@/lib/league/period";
import {
  collectPlayerGames, filterPlayerGames, insightFormats, insightRoles, insightSides, playerActivity, summarizePlayer,
} from "@/lib/league/player-insights";
import { isUuid } from "@/lib/validate";
import { HistoryPanel, PairPanel, SampleGrid, TablePanel, type ProfileQuery } from "./detail-panels";

const tabs = [
  ["overview", "Обзор"], ["history", "Игровая история"], ["table", "Игра за столом"], ["pairs", "С кем играл"],
] as const;

const control = "min-h-11 w-full rounded-control border border-border bg-elevated px-2.5 py-2 text-text";

export async function generateMetadata(): Promise<Metadata> {
  return { title: insightText(await getLocale(), "Профиль игрока") };
}

export default async function PlayerPage(props: PageProps<"/players/[id]">) {
  const locale = await getLocale();
  const t = (label: string) => insightText(locale, label);
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6 sm:py-8">
      <Link href="/players" className="inline-flex min-h-11 items-center text-sm text-accent-text hover:underline">{t("← Все игроки")}</Link>
      <Suspense fallback={<p className="text-muted">{t("Загрузка профиля…")}</p>}>
        <Profile locale={locale} params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

function filtersFor(query: ProfileQuery) {
  return new URLSearchParams({ period: query.period.key, format: query.format, role: query.role, tab: query.tab });
}

async function Profile({
  locale, params, searchParams,
}: { locale: Locale; params: PageProps<"/players/[id]">["params"]; searchParams: PageProps<"/players/[id]">["searchParams"] }) {
  const t = (label: string) => insightText(locale, label);
  const [{ id }, raw] = await Promise.all([params, searchParams, connection()]);
  if (!isUuid(id)) notFound();
  const league = await getLeague();
  const player = league.snapshot.players.find((candidate) => candidate.id === id);
  const stats = league.stats.get(id);
  if (!player || !stats) notFound();

  const period = parseClubPeriod(raw.period) ?? ALL_CLUB_HISTORY;
  const format = insightFormats.find((value) => value === raw.format) ?? "all";
  const role = [...insightSides, ...insightRoles].find((value) => value === raw.role) ?? "all";
  const tab = tabs.find(([value]) => value === raw.tab)?.[0] ?? "overview";
  const query: ProfileQuery = { period, format, role, tab };
  const href = `/players/${id}`;
  const fullHistory = collectPlayerGames(league.games, id);
  const games = filterPlayerGames(fullHistory, period, format, role);
  const firstObserved = games.at(-1)?.game.played_at;
  const lastObserved = games[0]?.game.played_at;
  const years = [...new Set([
    Number(clubDate(new Date().toISOString()).slice(0, 4)),
    ...fullHistory.map((row) => Number(row.day.slice(0, 4))),
    ...(period.year ? [period.year] : []),
  ])].sort((a, b) => b - a);

  return (
    <>
      <header className="flex flex-wrap items-center gap-4 rounded-card border border-border bg-surface p-5 sm:p-6">
        <Avatar name={player.display_name} size={62} />
        <div className="min-w-0 flex-1">
          <h1 className="wrap-anywhere font-display text-3xl font-bold sm:text-4xl">{player.display_name}</h1>
          <p className="mt-1 text-sm text-muted">{t(STATUS_LABEL[player.status])}
            {player.joined_on && <span> · {t("В клубе с")} {sinceMonth(player.joined_on, locale)}</span>}
          </p>
        </div>
        {showDemoBadge() && <DemoBadge locale={locale} />}
      </header>

      <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t("Разделы профиля")}>
        {tabs.map(([value, label]) => {
          const target = filtersFor({ ...query, tab: value });
          return (
            <Link key={value} href={`${href}?${target}`} aria-current={tab === value ? "page" : undefined}
              className={`flex min-h-11 items-center justify-center rounded-control border px-2 py-2 text-center text-sm font-medium ${tab === value ? "border-accent/70 bg-accent/15 text-text" : "border-border bg-surface text-muted hover:border-accent-text"}`}>
              {t(label)}
            </Link>
          );
        })}
      </nav>

      <form action={href} key={String(filtersFor(query))} className="grid grid-cols-2 items-end gap-3 rounded-card border border-border bg-surface p-4 md:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
        <input type="hidden" name="tab" value={tab} />
        <label className="col-span-2 min-w-0 text-sm text-muted md:col-span-1">
          <span className="mb-1 block">{t("Период")}</span>
          <select name="period" defaultValue={period.key} className={control}>
            <option value="all">{t("Вся история")}</option>
            {years.map((year) => <optgroup key={year} label={String(year)}>
              <option value={year}>{year} · {t("Год целиком")}</option>
              {CLUB_QUARTERS.map((quarter) => <option key={quarter} value={`${year}-q${quarter}`}>{year} · {quarter} {t("квартал")}</option>)}
            </optgroup>)}
          </select>
        </label>
        <label className="min-w-0 text-sm text-muted">
          <span className="mb-1 block">{t("Формат игры")}</span>
          <select name="format" defaultValue={format} className={control}>
            <option value="all">{t("Все форматы")}</option>
            {insightFormats.map((value) => <option key={value} value={value}>{t(FORMAT_LABEL[value])}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-sm text-muted">
          <span className="mb-1 block">{t("Сторона или роль")}</span>
          <select name="role" defaultValue={role} className={control}>
            <option value="all">{t("Все стороны и роли")}</option>
            {insightSides.map((value) => <option key={value} value={value}>{t(WINNER_SHORT[value])}</option>)}
            {insightRoles.map((value) => <option key={value} value={value}>{t(ROLE_LABEL[value])}</option>)}
          </select>
        </label>
        <button className="col-span-2 min-h-11 rounded-control bg-accent px-4 font-medium hover:bg-accent-hover md:col-span-1">{t("Применить")}</button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-muted">
        <span>{period.startDay ? `${longDate(period.startDay, locale)} – ${longDate(period.endDay, locale)}` : t("Вся история")}
          {!period.startDay && firstObserved && lastObserved && <span> · {longDate(firstObserved, locale)} – {longDate(lastObserved, locale)}</span>}
        </span>
        <span>{t("Партии")} · <b className="text-text">{games.length}</b></span>
      </div>

      {tab === "overview" && <Overview locale={locale} games={games} anyGames={fullHistory.length > 0} period={period} stats={stats} league={league} />}
      {tab === "history" && <HistoryPanel locale={locale} playerId={id} query={query} raw={raw} games={games} evenings={league.snapshot.evenings}
        skillReasons={new Map(league.state.games.map((game) => [game.id, game.eligibilityReason]))} />}
      {tab === "table" && <TablePanel locale={locale} playerId={id} query={query} games={games} />}
      {tab === "pairs" && <PairPanel locale={locale} playerId={id} query={query} raw={raw} games={games} players={league.snapshot.players} />}
    </>
  );
}

function Overview({
  locale, games, anyGames, period, stats, league,
}: { locale: Locale; games: ReturnType<typeof collectPlayerGames>; anyGames: boolean; period: ClubPeriod; stats: PlayerStats; league: LeagueProjection }) {
  const t = (label: string) => insightText(locale, label);
  const dates = new Map(league.games.map((game) => [game.id, game.played_at]));
  const start = { gameId: null, startsAt: null, rating: 1000, sd: 100 };
  let baseline: { gameId: string | null; startsAt: string | null; rating: number; sd: number } = start;
  const points = [];
  for (const point of league.ratings.players[stats.playerId].history) {
    const startsAt = dates.get(point.gameId);
    if (!startsAt) continue;
    const day = clubDate(startsAt);
    if (period.startDay && day < period.startDay) baseline = { ...point, startsAt };
    if (inClubPeriod(day, period)) points.push({ ...point, startsAt });
  }
  const summary = summarizePlayer(games);
  const { months } = playerActivity(games);
  const activeMonths = [...months].slice(0, 12).reverse();
  const maxMonth = Math.max(1, ...activeMonths.map(([, values]) => values.classic10 + values.short9));

  return (
    <>
      <Card title="League Skill">
        <div className="grid min-w-0 items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div>
            <SkillValue locale={locale} stats={stats} />
            <p className="mt-3 text-sm text-muted">{t("Текущая оценка за всю историю. График учитывает период и правила League Skill.")}</p>
            <p className="mt-2 text-sm text-muted">{t("team-logit-v1. Short9 не меняет основной Skill. Предварительная оценка: меньше 20 подходящих партий или высокая неопределённость.")}</p>
          </div>
          <div className="min-w-0">
            {points.length > 0
              ? <SkillChart locale={locale} points={[baseline, ...points]} />
              : <p className="text-sm text-muted">{t("За выбранный период нет новых точек расчёта.")}</p>}
          </div>
        </div>
      </Card>

      {games.length === 0 ? <Card><p className="text-muted">{t(anyGames ? "За этот период нет партий по выбранным фильтрам." : "После опубликованных партий здесь появятся результаты и история.")}</p></Card> : (
        <>
          <Card title={t("Партии за период")}>
            <SampleGrid locale={locale} rows={[
              { label: t("Всего"), value: summary.total },
              ...insightFormats.map((value) => ({ label: t(FORMAT_LABEL[value]), value: summary.formats.get(value)! })),
            ]} />
            <p className="mt-3 text-xs text-muted">{t("Доля побед среди известных исходов, включая ничьи.")} {t("Для процента нужно не менее 10 исходов. Счёт побед, поражений и ничьих виден при любой выборке.")}</p>
          </Card>

          {insightFormats.filter((format) => summary.formats.get(format)!.games).map((format) => {
            const split = summarizePlayer(games.filter(({ game }) => game.format === format));
            return (
              <Card key={format} title={t(FORMAT_LABEL[format])}>
                <div className="grid gap-4 lg:grid-cols-2">
                  <section><h3 className="mb-2 font-medium">{t("По сторонам")}</h3>
                    <SampleGrid locale={locale} rows={[
                      ...insightSides.map((side) => ({ label: t(WINNER_SHORT[side]), value: split.sides.get(side)! })),
                      ...(split.sides.get(null)!.games ? [{ label: t("Неизвестно"), value: split.sides.get(null)! }] : []),
                    ]} />
                  </section>
                  <section><h3 className="mb-2 font-medium">{t("По ролям")}</h3>
                    <SampleGrid locale={locale} rows={[
                      ...insightRoles.map((role) => ({ label: t(ROLE_LABEL[role]), value: split.roles.get(role)! })),
                      ...(split.roles.get(null)!.games ? [{ label: t("Неизвестно"), value: split.roles.get(null)! }] : []),
                    ]} />
                  </section>
                </div>
              </Card>
            );
          })}

          <Card title={t("Активность по месяцам")}>
            <p className="mb-4 text-sm text-muted">{t("Последние 12 месяцев с партиями в выбранном периоде.")}</p>
            <ul className="space-y-3">
              {activeMonths.map(([month, values]) => <li key={month} className="grid gap-1.5 md:grid-cols-[8rem_minmax(0,1fr)_12rem] md:items-center">
                <span className="text-sm">{monthYear(`${month}-01`, locale)}</span>
                <span aria-hidden="true" className="flex h-3 overflow-hidden rounded-full bg-elevated">
                  <span className="bg-accent" style={{ width: `${100 * values.classic10 / maxMonth}%` }} />
                  <span className="bg-side-black" style={{ width: `${100 * values.short9 / maxMonth}%` }} />
                </span>
                <span className="text-xs text-muted">{t(FORMAT_LABEL.classic10)} {values.classic10} · {t(FORMAT_LABEL.short9)} {values.short9}</span>
              </li>)}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}
