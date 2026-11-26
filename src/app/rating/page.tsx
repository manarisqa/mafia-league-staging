import { siteText } from "@/lib/i18n/site";
import { getLocale } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";
import { getRating, showDemoBadge } from "@/lib/data";
import { SkillValue } from "@/components/skill";
import { Avatar, DemoBadge, PageHero } from "@/components/ui";

export async function generateMetadata(): Promise<Metadata> {
  return { title: siteText(await getLocale(), "Рейтинг") };
}

export default async function RatingPage() {
  const locale = await getLocale();
  const t = (label: string) => siteText(locale, label);
  const all = await getRating();
  const rated = all.filter((p) => p.skillGames > 0);
  const demo = showDemoBadge();

  return (
    <>
      <PageHero
        title={t("Рейтинг игроков")}
        subtitle={t("Оценка долгосрочного уровня игры.")}
      />
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-2xl text-sm text-muted">{t("League Skill · team-logit-v1. Учитываются подходящие партии Classic10. Short9, ничьи, технические результаты и партии с удалениями остаются в статистике, но не меняют Skill. Оценка предварительная до 20 игр или при высокой неопределённости. Интервал показывает неопределённость оценки, а не диапазон будущих результатов.")}</p>
          {demo && <DemoBadge locale={locale} />}
        </div>

        {rated.length === 0 ? (
          <p className="text-muted">{t("Рейтинг появится после первых сыгранных партий.")}</p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="bg-surface text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-normal">#</th>
                  <th scope="col" className="px-4 py-3 font-normal">{t("Игрок")}</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">{t("Рейтинг")}</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">{t("Партий")}</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">{t("Победы")}</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">{t("% побед")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rated.map((p, i) => (
                  <tr key={p.id} className={i < 3 ? "bg-accent/10" : undefined}>
                    <td className="px-4 py-3 font-display text-lg text-accent-text">{p.provisional ? "—" : 1 + rated.filter((q) => !q.provisional && q.rating > p.rating).length}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-3">
                        <Avatar name={p.name} size={36} />
                        <Link href={`/players/${p.id}`} className="font-medium hover:text-accent-text hover:underline">
                          {p.name}
                        </Link>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums"><SkillValue locale={locale} stats={p} compact /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">{p.games}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">{p.wins}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">
                      {p.winRate === null ? "—" : `${Math.round(p.winRate * 100)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
