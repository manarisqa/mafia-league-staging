import { siteText } from "@/lib/i18n/site";
import { getLocale } from "@/lib/i18n/server";
import Link from "next/link";
import { Suspense } from "react";
import { hasSupabaseConfig } from "@/lib/supabase";
import { createServerSupabase } from "@/lib/supabase/server";
import { RsvpPanel } from "./evenings/rsvp-panel";
import { InviteButton } from "./invite-button";
import { EveningReadiness } from "./evenings/evening-details";
import { isUuid } from "@/lib/validate";
import { FORMAT_LABEL } from "@/lib/format";
import { DEMO_FORMATS } from "@/lib/demo";
import {
  getLeagueStats,
  getNextEvening,
  getPlayerProfile,
  getRecentGames,
  getTopPlayers,
  showDemoBadge,
} from "@/lib/data";
import { Avatar, ButtonLink, Card } from "@/components/ui";
import { SkillValue } from "@/components/skill";

export default async function Home() {
  const locale = await getLocale();
  const t = (label: string) => siteText(locale, label);
  const [evening, recent, top, stats] = await Promise.all([
    getNextEvening(locale),
    getRecentGames(3, locale),
    getTopPlayers(),
    getLeagueStats(),
  ]);
  const demo = showDemoBadge();
  let profileId: string | null = null;
  if (hasSupabaseConfig()) {
    const db = await createServerSupabase();
    const { data } = await db.auth.getClaims();
    if (data?.claims) {
      const { data: player } = await db.from("players").select("id").eq("user_id", data.claims.sub).maybeSingle();
      profileId = player?.id ?? null;
    }
  }

  const ownProfile = profileId ? await getPlayerProfile(profileId) : null;

  return (
    <>
      <section className="relative overflow-hidden border-b border-border">
        {/* Вместо фото — тёмный фон с красным свечением. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_20%,rgba(170,35,53,0.35),transparent_60%),radial-gradient(ellipse_at_10%_100%,rgba(170,35,53,0.15),transparent_50%)]"
        />
        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
          <h1 className="max-w-3xl break-words font-display text-4xl leading-tight font-bold sm:text-6xl">{ownProfile ? `${t("Ваш клуб")}, ${ownProfile.name}` : t("Мафия объединяет в Граце")}</h1>
          <p className="mt-5 max-w-xl text-lg text-muted">{t("Участие бесплатное. Играем в спортивную мафию в Граце.")}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/evenings">{t("Записаться на вечер")}</ButtonLink>
            <ButtonLink href="/referee" variant="outline">{t("Вести игру")}</ButtonLink>
            {profileId
              ? <ButtonLink href={`/players/${profileId}`} variant="outline">{t("Мой профиль")}</ButtonLink>
              : <ButtonLink href="/learn" variant="outline">{t("Как начать")}</ButtonLink>}
          </div>
          {ownProfile ? <div className="mt-6 flex max-w-md flex-wrap items-center gap-5 rounded-panel border border-border bg-surface/70 p-4">
            <div><p className="text-sm text-muted">{t("Сыграно партий")}</p><b className="text-xl tabular-nums">{ownProfile.games}</b></div>
            <SkillValue stats={ownProfile} locale={locale} compact />
          </div> : (
          <ul className="mt-8 grid max-w-3xl gap-3 text-sm text-muted sm:grid-cols-3">
            <li>{t("Дружеская атмосфера")}</li>
            <li>{t("Играем по правилам спортивной Мафии")}</li>
            <li>{t("Новичкам всегда рады")}</li>
          </ul>
          )}

        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-10 sm:px-6 lg:grid-cols-3">
        <Card title={t("Ближайший игровой вечер")} locale={locale} demo={demo}>
          {evening ? (
            <>
              <div className="flex gap-4">
                <div className="flex size-20 shrink-0 flex-col items-center justify-center rounded-card border border-border bg-elevated">
                  <span className="text-xs text-muted">{evening.weekday}</span>
                  <span className="font-display text-3xl leading-none font-bold">{evening.day}</span>
                  <span className="text-xs text-muted">{evening.month}</span>
                </div>
                <div className="min-w-0">
                  <p className="font-display text-2xl font-bold">{t("Начало в")} {evening.time}</p>
                  <p className="mt-1 break-words text-sm text-muted">{evening.place}</p>
                </div>
              </div>
              <p className="mt-3 text-sm">{t("Плановый формат")} · {t(FORMAT_LABEL[evening.capacity === 9 ? "short9" : "classic10"])}</p>
              <div className="mt-2"><EveningReadiness evening={evening} locale={locale} /></div>
              <div className="mt-5 flex flex-wrap gap-3">
                <ButtonLink href={evening.id ? `/evenings/${evening.id}` : "/evenings"}>{t("О вечере")}</ButtonLink>
                {evening.id && <InviteButton path={`/evenings/${evening.id}`} />}
              </div>
            </>
          ) : (
            <p className="text-muted">{t("Ближайший вечер пока не назначен. Загляните позже.")}</p>
          )}
        </Card>

        {profileId && evening?.id ? <Suspense><RsvpPanel eveningId={evening.id} /></Suspense> : <Card title={t("О клубе")}>
          <p className="text-muted">{t("MAFIA LEAGUE — сообщество любителей спортивной Мафии в Граце. Мы регулярно проводим игровые вечера, встречаем новичков, помогаем учиться и развиваться и создаём атмосферу, в которой хочется возвращаться.")}</p>
          <Link
            href="/learn"
            className="mt-4 inline-flex min-h-11 items-center text-sm text-accent-text hover:underline"
          >{t("Узнать больше о клубе →")}</Link>
        </Card>}

        <Card title={t("Формат игры")}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {DEMO_FORMATS.map((f, i) => (
              <li
                key={t(f.name)}
                className={`rounded-panel border p-4 ${
                  i === 0 ? "border-accent-text" : "border-border"
                }`}
              >
                <p className="font-medium">{t(f.name)}</p>
                <p className="mt-1 text-sm text-muted">{t(f.players)}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted">{t("Классический формат с 10 игроками — оптимальный баланс игры, динамики и общения.")}</p>
        </Card>

        <Card title={t("Последние игры")} locale={locale} demo={demo}>
          {recent.length > 0 ? (
            <ul className="divide-y divide-border text-sm">
              {recent.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="text-muted">{g.date}</span>
                  {!isUuid(g.id) ? <span className="font-medium">{t(g.format)}</span> : (
                    <Link href={`/history/games/${g.id}`} className="inline-flex min-h-11 items-center font-medium hover:text-accent-text">{t(g.format)}</Link>
                  )}
                  <span className="text-muted">{t(g.status)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">{t("Сыгранных партий пока нет.")}</p>
          )}
        </Card>

        <Card title={t("Топ игроков")} locale={locale} demo={demo}>
          {top.length > 0 ? (
            <ul className="space-y-3">
              {top.map((p) => (
                <li key={p.place} className="flex items-center gap-3">
                  <span className="w-5 text-center font-display text-lg text-accent-text">
                    {p.place}
                  </span>
                  <Avatar name={p.name} />
                  <span className="flex-1 font-medium">{p.name}</span>
                  <span className="tabular-nums text-muted">{Math.round(p.rating)}{p.provisional && <span className="block text-xs">{t("предвар.")}</span>}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">{t("Рейтинг появится после первых игр.")}</p>
          )}
          <Link
            href="/rating"
            className="mt-3 inline-flex min-h-11 items-center text-sm text-accent-text hover:underline"
          >{t("Весь рейтинг →")}</Link>
        </Card>

        <Card title={t("Лига в цифрах")} locale={locale} demo={demo}>
          <ul className="grid grid-cols-3 gap-3">
            {stats.map((s) => (
              <li key={t(s.label)}>
                <p className="font-display text-3xl leading-none font-bold">{s.value}</p>
                <p className="mt-2 text-xs text-muted">{t(s.label)}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
