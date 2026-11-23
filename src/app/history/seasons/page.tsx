import { siteText } from "@/lib/i18n/site";
import { getLocale } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { TotalsStrip, seasonPeriod } from "@/app/history/history-ui";
import { DemoBadge } from "@/components/ui";
import { getHistory, showDemoBadge } from "@/lib/data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: siteText(await getLocale(), "История · Сезоны") };
}

export default async function HistorySeasonsPage() {
  const locale = await getLocale();
  const t = (label: string) => siteText(locale, label);
  const { seasons, evenings } = await getHistory();
  const demo = showDemoBadge();
  const withoutSeason = evenings.filter((e) => !e.seasonId).length;

  return (
    <>
      {demo && (
        <div className="flex justify-end">
          <DemoBadge locale={locale} />
        </div>
      )}
      {seasons.length === 0 ? (
        <p className="text-muted">{t("Сезоны пока не заведены.")}</p>
      ) : (
        seasons.map((s) => (
          <section key={s.id} aria-label={s.name} className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-display text-2xl font-bold">{s.name}</h2>
              <span className="text-muted">{seasonPeriod(s, locale)}</span>
              {!s.endsOn && (
                <span className="rounded-full border border-accent/50 px-2.5 py-0.5 text-xs text-accent-text">{t("Текущий сезон")}</span>
              )}
            </div>
            <TotalsStrip locale={locale} totals={s} caption={t("Сводка сезона")} />
          </section>
        ))
      )}
      {withoutSeason > 0 && (
        <p className="text-sm text-muted">{t("Вечеров без сезона:")}{withoutSeason}{t(". Они видны во вкладке «Вечера», но не входят в сводки сезонов.")}</p>
      )}
    </>
  );
}
