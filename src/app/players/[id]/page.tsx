import { siteText } from "@/lib/i18n/site";
import type { Locale } from "@/lib/i18n/messages";
import { getLocale } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WinnerMark } from "@/app/history/history-ui";
import { SkillValue, SkillChart } from "@/components/skill";
import { Avatar, Card, DemoBadge } from "@/components/ui";
import { getPlayerProfile, showDemoBadge, type PlayerProfile, type SideStats } from "@/lib/data";
import {
  FORMAT_LABEL,
  RESULT_LABEL,
  ROLE_LABEL,
  STATUS_LABEL,
  longDate,
  plural,
  sinceMonth,
} from "@/lib/format";
import { sideOf } from "@/lib/rating";
import { isUuid } from "@/lib/validate";

export async function generateMetadata(): Promise<Metadata> {
  return { title: siteText(await getLocale(), "Профиль игрока") };
}

/** Меньше этого числа партий доли побед почти ничего не говорят. */
const FEW_GAMES = 10;

export default async function PlayerPage(props: PageProps<"/players/[id]">) {
  const locale = await getLocale();
  const t = (label: string) => siteText(locale, label);
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-10 sm:px-6">
      <Link href="/players" className="inline-flex min-h-11 items-center text-sm text-accent-text hover:underline">{t("← Все игроки")}</Link>
      <Suspense fallback={<p className="text-muted">{t("Загрузка профиля…")}</p>}>
        <Profile locale={locale} params={props.params} />
      </Suspense>
    </div>
  );
}

function percent(s: SideStats) {
  return s.games > 0 ? `${Math.round((s.wins / s.games) * 100)}%` : "—";
}

async function Profile({ locale, params }: { locale: Locale; params: Promise<{ id: string }> }) {
  const t = (label: string) => siteText(locale, label);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const p = await getPlayerProfile(id);
  if (!p) notFound();
  const demo = showDemoBadge();

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-5">
          <Avatar name={p.name} size={88} />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-bold sm:text-4xl">{p.name}</h1>
            <p className="mt-1 text-muted">{t(STATUS_LABEL[p.status])}</p>
            {p.joinedOn && <p className="mt-1 text-sm text-muted">{t("В клубе с")} {sinceMonth(p.joinedOn, locale)}</p>}
          </div>
          {demo && <DemoBadge locale={locale} />}
        </div>
      </Card>

      {p.games === 0 ? (
        <Card>
          <p className="text-muted">{t("Игрок ещё не сыграл ни одной завершённой партии.")}</p>
        </Card>
      ) : (
        <>
          <RatingCard locale={locale} p={p} />

          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: "Партии", value: p.games },
              { label: "Победы", value: p.wins },
              { label: "Процент побед", value: percent(p) },
              { label: "Игровые вечера", value: p.evenings },
            ].map((t) => (
              <div key={t.label} className="flex flex-col-reverse rounded-card border border-border bg-surface p-4">
                <dt className="text-sm text-muted">{t.label}</dt>
                <dd className="font-display text-3xl font-bold tabular-nums">{t.value}</dd>
              </div>
            ))}
          </dl>
          {p.games < FEW_GAMES && (
            <p className="text-sm text-muted">{t("Пока")}{p.games} {plural(p.games, ["партия", "партии", "партий"].map(t) as [string, string, string])}{t(": проценты на таком числе партий ещё мало что говорят об игре.")}</p>
          )}

          <Card title={t("По сторонам")}>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["red", "black"] as const).map((side) => (
                <div
                  key={side}
                  className={`rounded-panel border p-4 ${
                    side === "red" ? "border-accent/50 bg-accent/10" : "border-border bg-elevated"
                  }`}
                >
                  <p className="font-display text-lg font-bold">
                    <WinnerMark locale={locale} winner={side} />
                  </p>
                  <div className="mt-2 flex items-end justify-between gap-3">
                    <p className="text-sm text-muted">{t("Победы")}{" "}
                      <span className="text-base text-text tabular-nums">
                        {p.sides[side].wins} {t("из")} {p.sides[side].games}
                      </span>
                    </p>
                    <p className="font-display text-2xl font-bold tabular-nums">{percent(p.sides[side])}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title={t("По ролям")}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[24rem] text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-normal">{t("Роль")}</th>
                    <th scope="col" className="py-2 pr-4 text-right font-normal">{t("Партий")}</th>
                    <th scope="col" className="py-2 pr-4 text-right font-normal">{t("Побед")}</th>
                    <th scope="col" className="py-2 text-right font-normal">{t("% побед")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(["civilian", "sheriff", "don", "mafia"] as const).map((role) => (
                    <tr key={role}>
                      <td className="py-3 pr-4">{t(ROLE_LABEL[role])}</td>
                      <td className="py-3 pr-4 text-right tabular-nums">{p.roles[role].games}</td>
                      <td className="py-3 pr-4 text-right tabular-nums">{p.roles[role].wins}</td>
                      <td className="py-3 text-right tabular-nums">{percent(p.roles[role])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={t("История партий")}>
            <ul className="divide-y divide-border">
              {p.history.map((g) => (
                <li key={g.gameId}>
                  <Link
                    href={`/history/games/${g.gameId}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:text-accent-text"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{longDate(g.startsAt, locale)}</span>
                      <span className="block text-sm text-muted">{t("Партия №")}{g.no} · {t(FORMAT_LABEL[g.format])}{g.skillReason ? ` · ${t(g.skillReason)}` : ""}
                      </span>
                    </span>
                    <span className="text-sm">
                      {t(ROLE_LABEL[g.role])} · <WinnerMark locale={locale} winner={sideOf(g.role)} />
                    </span>
                    <span
                      className={`w-24 text-right text-sm font-medium ${
                        g.result === "win" ? "text-success" : "text-muted"
                      }`}
                    >
                      {t(RESULT_LABEL[g.result])}
                    </span>
                    <span aria-hidden className="text-muted">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

function RatingCard({ locale, p }: { locale: Locale; p: PlayerProfile }) {
  const t = (label: string) => siteText(locale, label);
  return <Card title="League Skill">
    <div className="grid items-center gap-6 sm:grid-cols-[auto_1fr]">
      <div><SkillValue locale={locale} stats={p} />
        <p className="mt-3 max-w-xs text-sm text-muted">{t("team-logit-v1. Short9 не меняет основной Skill. Предварительная оценка: меньше 20 подходящих партий или высокая неопределённость.")}</p>
      </div>
      <SkillChart locale={locale} points={p.ratingPoints} />
    </div>
  </Card>;
}
