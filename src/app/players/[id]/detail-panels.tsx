import Link from "next/link";
import { Card } from "@/components/ui";
import { WinnerMark } from "@/app/history/history-ui";
import { ATTENDANCE_PAGE_SIZE, getOwnAttendance } from "@/lib/attendance";
import { FORMAT_LABEL, RESULT_LABEL, ROLE_LABEL, longDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n/messages";
import { insightText } from "@/lib/i18n/player-insights";
import type { ClubSnapshot } from "@/lib/league/core";
import type { ClubPeriod } from "@/lib/league/period";
import {
  collectPlayerGames, insightFormats, insightPage, observedWinRate, parseInsightPage, playerActivity, summarizePairs, summarizeTable,
  type GameSample, type RoleFilter,
} from "@/lib/league/player-insights";
import { getPlayerProtocolFacts } from "@/lib/league/player-protocol";

export type ProfileQuery = {
  period: ClubPeriod;
  format: "all" | (typeof insightFormats)[number];
  role: "all" | RoleFilter;
  tab: "overview" | "history" | "table" | "pairs";
};

type Search = Record<string, string | string[] | undefined>;
type Games = ReturnType<typeof collectPlayerGames>;
type PanelProps = { locale: Locale; playerId: string; query: ProfileQuery; games: Games };

function ResultCounts({ sample }: { sample: GameSample }) {
  return <>{sample.known ? `${sample.wins} / ${sample.losses} / ${sample.draws}` : "—"}</>;
}

function WinRate({ sample, locale }: { sample: GameSample; locale: Locale }) {
  const rate = observedWinRate(sample);
  return <>{rate === null ? "—" : Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(rate)}</>;
}

export function SampleGrid({ locale, rows }: { locale: Locale; rows: { label: string; value: GameSample }[] }) {
  const t = (label: string) => insightText(locale, label);
  return (
    <table className="w-full table-fixed text-left text-xs sm:text-sm">
      <colgroup><col className="w-[26%]" /><col className="w-[19%]" /><col className="w-[36%]" /><col className="w-[19%]" /></colgroup>
      <thead className="text-muted">
        <tr>
          <th className="sr-only" scope="col">{t("Выборка")}</th>
          <th className="p-1.5 text-right font-normal" scope="col">{t("Партий")}</th>
          <th className="p-1.5 text-right font-normal" scope="col">{t("Победы / поражения / ничьи")}</th>
          <th className="p-1.5 text-right font-normal" scope="col">{t("% побед")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map(({ label, value }) => (
          <tr key={label}>
            <th className="wrap-anywhere py-2.5 pr-1 font-medium" scope="row">{label}</th>
            <td className="p-1.5 text-right tabular-nums">{value.games}</td>
            <td className="p-1.5 text-right tabular-nums">
              <ResultCounts sample={value} />
              {value.known < value.games && <span className="block text-xs text-muted">{t("Известно")} {value.known} / {value.games}</span>}
            </td>
            <td className="p-1.5 text-right tabular-nums"><WinRate sample={value} locale={locale} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PageNav({ locale, playerId, query, search, field, current, next, total }: {
  locale: Locale; playerId: string; query: ProfileQuery; search: Search;
  field: string; current: number; next: boolean; total?: number;
}) {
  const t = (label: string) => insightText(locale, label);
  if (current === 1 && !next) return null;
  const href = (page: number) => {
    const params = new URLSearchParams({ period: query.period.key, role: query.role, format: query.format, tab: query.tab });
    for (const position of ["gamesPage", "eveningsPage", "attendancePage", "classicPage", "shortPage"]) {
      const number = position === field ? page : parseInsightPage(search[position]);
      if (number > 1) params.set(position, String(number));
    }
    return `/players/${playerId}?${params}#${field}`;
  };
  return (
    <nav aria-label={t("Страницы")} className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      {current > 1 && <Link href={href(current - 1)} className="inline-flex min-h-11 items-center text-accent-text hover:underline">← {t("Назад")}</Link>}
      <span className="text-muted tabular-nums">{current}{total ? ` / ${total}` : ""}</span>
      {next && <Link href={href(current + 1)} className="inline-flex min-h-11 items-center text-accent-text hover:underline">{t("Дальше")} →</Link>}
    </nav>
  );
}

function dayAfter(day: string | null) {
  if (!day) return undefined;
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().split("T")[0].replace(/^\+0/, "");
}

export async function HistoryPanel({ locale, playerId, query, raw, games, evenings, skillReasons }: PanelProps & {
  raw: Search; evenings: ClubSnapshot["evenings"]; skillReasons: Map<string, string>;
}) {
  const t = (label: string) => insightText(locale, label);
  const recent = insightPage(games, parseInsightPage(raw.gamesPage));
  const { evenings: participated } = playerActivity(games);
  const playedEvenings = evenings.filter((evening) => participated.has(evening.id))
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at) || b.id.localeCompare(a.id));
  const played = insightPage(playedEvenings, parseInsightPage(raw.eveningsPage));
  const attendancePage = parseInsightPage(raw.attendancePage);
  const attendance = await getOwnAttendance(playerId, attendancePage, query.period.startDay ?? undefined, dayAfter(query.period.endDay));
  const attendanceRows = attendance?.state === "available" ? attendance.rows : null;

  return (
    <>
      <section id="gamesPage" className="scroll-mt-4">
        <Card title={t("История партий")}>
          {!recent.rows.length
            ? <p className="text-sm text-muted">{t("За этот период нет партий по выбранным фильтрам.")}</p>
            : <ul className="divide-y divide-border">
                {recent.rows.map(({ game, seat, side, result }) => (
                  <li key={game.id}>
                    <Link href={`/history/games/${game.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 hover:text-accent-text">
                      <span className="min-w-0">
                        <span className="block font-medium">{longDate(game.played_at, locale)}</span>
                        <span className="text-sm text-muted">{t("Партия №")}{game.game_no} · {t(FORMAT_LABEL[game.format])}</span>
                        {skillReasons.get(game.id) && <span className="block text-xs text-muted">{t(skillReasons.get(game.id)!)}</span>}
                      </span>
                      <span className="text-sm text-muted">
                        {seat.role ? t(ROLE_LABEL[seat.role]) : t("Неизвестно")}
                        {side && <> · <WinnerMark locale={locale} winner={side} /></>}
                      </span>
                      <span className={`text-sm font-medium ${result === "win" ? "text-success" : "text-muted"}`}>
                        {result ? t(RESULT_LABEL[result]) : t("Неизвестно")} →
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>}
          <PageNav {...{ locale, playerId, query, search: raw }} field="gamesPage" current={recent.page} total={recent.pages} next={recent.page < recent.pages} />
        </Card>
      </section>
      <section id="eveningsPage" className="scroll-mt-4">
        <Card title={`${t("Вечера с сыгранными партиями")} · ${playedEvenings.length}`}>
          <p className="mb-2 text-sm text-muted">{t("Клубные вечера с опубликованной партией по выбранным фильтрам.")}</p>
          {!played.rows.length
            ? <p className="text-sm text-muted">{t("За этот период нет партий по выбранным фильтрам.")}</p>
            : <ul className="divide-y divide-border">
                {played.rows.map((evening) => (
                  <li key={evening.id} className="flex flex-wrap items-center justify-between gap-x-3">
                    <Link href={`/evenings/${evening.id}`} className="inline-flex min-h-11 items-center gap-2 py-2 text-sm text-accent-text hover:underline">
                      {longDate(evening.starts_at, locale)} · <span className="wrap-anywhere">{evening.place}</span>
                    </Link>
                    <span className="text-sm text-muted tabular-nums">{t("Партий")} {participated.get(evening.id)}</span>
                  </li>
                ))}
              </ul>}
          <PageNav {...{ locale, playerId, query, search: raw }} field="eveningsPage" current={played.page} total={played.pages} next={played.page < played.pages} />
        </Card>
      </section>
      {attendance && <section id="attendancePage" className="scroll-mt-4">
        <Card title={t("Отмеченное присутствие")}>
          <p className="mb-2 text-sm text-muted">{t("Личные отметки организатора за выбранный период. Отметка появляется после фактического посещения.")}</p>
          {!attendanceRows?.length
            ? <p className="text-sm text-muted">{t(attendanceRows ? "За этот период отметок о присутствии пока нет." : "Отметки о присутствии временно недоступны.")}</p>
            : <ul className="divide-y divide-border">
                {attendanceRows.slice(0, ATTENDANCE_PAGE_SIZE).map((evening) => (
                  <li key={evening.id}>
                    <Link href={`/evenings/${evening.id}`} className="inline-flex min-h-11 items-center gap-2 py-2 text-sm text-accent-text hover:underline">
                      {longDate(evening.startsAt, locale)} · <span className="wrap-anywhere">{evening.place}</span>
                    </Link>
                  </li>
                ))}
              </ul>}
          {attendanceRows && <PageNav {...{ locale, playerId, query, search: raw }} field="attendancePage" current={attendancePage} next={attendanceRows.length > ATTENDANCE_PAGE_SIZE} />}
        </Card>
      </section>}
    </>
  );
}

export async function TablePanel({ locale, playerId, query, games }: PanelProps) {
  const t = (label: string) => insightText(locale, label);
  if (!games.length) return <Card><p className="text-muted">{t("За этот период нет партий по выбранным фильтрам.")}</p></Card>;
  const facts = await getPlayerProtocolFacts(playerId, query.period.startDay, query.period.endDay);
  return (
    <>
      {insightFormats.map((format) => {
        const sample = games.filter(({ game }) => game.format === format);
        if (!sample.length) return null;
        const { seats, fouls, foulGames, removals, removalGames, bestMoves } = summarizeTable(sample, facts ?? []);
        const moves = bestMoves.length;
        return (
          <Card key={format} title={t(FORMAT_LABEL[format])}>
            <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <h3 className="font-medium">{t("Места за столом")}</h3>
                <p className="mt-1 text-sm text-muted">{t("Число партий по местам.")}</p>
                <ul className="mt-3 space-y-2">
                  {Array.from({ length: format === "classic10" ? 10 : 9 }, (_, index) => {
                    const count = seats.get(index + 1) ?? 0;
                    return <li className="grid grid-cols-[2rem_minmax(0,1fr)_4rem] items-center gap-2 text-sm" key={index}>
                      <span><span className="sr-only">{t("Место")} </span>{index + 1}</span>
                      <span aria-hidden="true" className="block h-2 overflow-hidden rounded-full bg-elevated">
                        <span className="block h-2 rounded-full bg-accent-text" style={{ width: `${100 * count / sample.length}%` }} />
                      </span>
                      <span className="text-right text-muted tabular-nums">{count} / {sample.length}</span>
                    </li>;
                  })}
                </ul>
              </div>
              <div className="space-y-5">
                <section>
                  <h3 className="font-medium">{t("Дисциплинарные отметки")}</h3>
                  <dl className="mt-2 space-y-2 text-sm">
                    <div>
                      <dt>{t("Обычные фолы")}</dt>
                      <dd className="text-muted tabular-nums">
                        <b className="text-text">{foulGames ? fouls : "—"}</b> · {t("Покрытие")} {foulGames} / {sample.length}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Дисциплинарные удаления")}</dt>
                      <dd className="text-muted tabular-nums">
                        <b className="text-text">{removalGames ? removals : "—"}</b> · {t("Покрытие")} {removalGames} / {sample.length}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-xs text-muted">{t("Удаление относится к дисциплине. Выход по голосованию или ночному выстрелу учитывается в протоколе отдельно.")}</p>
                  <p className="mt-2 text-xs text-muted">{t("Покрытие показывает число партий с данными по показателю. В старых записях ноль без подтверждающего протокола считается пропуском.")}</p>
                </section>
                <section>
                  <h3 className="font-medium">{t("Лучший ход")}</h3>
                  {!moves ? (
                    <p className="mt-2 text-sm text-muted">{t(facts === null
                      ? "Данные утверждённых протоколов временно недоступны."
                      : "В утверждённых протоколах нет записи лучшего хода для этой выборки.")}</p>
                  ) : (
                    <>
                      <p className="mt-2 text-sm text-muted">{t("Записанные попытки")} <b className="text-text">{moves} / {sample.length}</b></p>
                      <p className="text-sm text-muted">{t("Попадания в чёрных")} <b className="text-text">{bestMoves.reduce((total, move) => total + move.hits, 0)} / {moves * 3}</b></p>
                      <ul className="mt-1">
                        {bestMoves.slice(0, 5).map((move) => (
                          <li key={move.gameId}><Link href={`/history/games/${move.gameId}`} className="inline-flex min-h-11 items-center text-sm text-accent-text hover:underline">
                            {longDate(move.date, locale)} · {move.hits} / 3 →
                          </Link></li>
                        ))}
                      </ul>
                      <p className="text-xs text-muted">{t("Учитываются зафиксированные тройки из утверждённых протоколов. Показаны последние пять из них.")}</p>
                    </>
                  )}
                </section>
              </div>
            </div>
          </Card>
        );
      })}
    </>
  );
}

export function PairPanel({ locale, playerId, query, raw, games, players }: PanelProps & { raw: Search; players: ClubSnapshot["players"] }) {
  const t = (label: string) => insightText(locale, label);
  if (!games.length) return <Card><p className="text-muted">{t("За этот период нет партий по выбранным фильтрам.")}</p></Card>;
  const names = new Map(players.map((player) => [player.id, player.display_name]));
  return (
    <>
      <p className="text-sm text-muted">{t("Исходы показаны для владельца профиля. Состав и результаты зависят от многих факторов.")} {t("Для процента нужно не менее 10 исходов. Счёт побед, поражений и ничьих виден при любой выборке.")}</p>
      {insightFormats.map((format) => {
        const field = format === "classic10" ? "classicPage" : "shortPage";
        const pairs = summarizePairs(games.filter(({ game }) => game.format === format));
        if (!pairs.length) return null;
        const page = insightPage(pairs, parseInsightPage(raw[field]));
        return (
          <section key={format} id={field} className="scroll-mt-4">
            <Card title={t(FORMAT_LABEL[format])}>
              <ul className="divide-y divide-border">
                {page.rows.map(({ playerId: otherId, together, against, total, unknown }) => (
                  <li key={otherId} className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
                    <div className="min-w-0">
                      {names.has(otherId)
                        ? <Link href={`/players/${otherId}`} className="inline-flex min-h-11 items-center break-all font-medium text-accent-text hover:underline">{names.get(otherId)}</Link>
                        : <p className="font-medium">{t("Неизвестно")}</p>}
                      <p className="text-xs text-muted">{t("Совместные партии")} · {total}</p>
                      {unknown > 0 && <p className="mt-1 text-xs text-muted">{t("Стороны неизвестны")} · {unknown} / {total}</p>}
                    </div>
                    <SampleGrid locale={locale} rows={[
                      { label: t("На одной стороне"), value: together }, { label: t("На разных сторонах"), value: against },
                    ]} />
                  </li>
                ))}
              </ul>
              <PageNav {...{ locale, playerId, query, search: raw }} field={field} current={page.page} total={page.pages} next={page.page < page.pages} />
            </Card>
          </section>
        );
      })}
    </>
  );
}
