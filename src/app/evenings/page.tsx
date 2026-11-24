import type { Metadata } from "next";
import { getNextEvening } from "@/lib/data";
import { getLocale } from "@/lib/i18n/server";
import { siteText } from "@/lib/i18n/site";
import { ButtonLink, Card, PageHero } from "@/components/ui";
import { EveningDetails } from "./evening-details";

export async function generateMetadata(): Promise<Metadata> {
  return { title: siteText(await getLocale(), "Вечера") };
}

export default async function EveningsPage() {
  const locale = await getLocale();
  const t = (label: string) => siteText(locale, label);
  const evening = await getNextEvening(locale);

  return (
    <>
      <PageHero title={t("Ближайший игровой вечер")} subtitle={t("Играем в Граце. Участие бесплатное, новичкам помогаем освоиться.")} />
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-8 sm:px-6">
        {evening ? <EveningDetails evening={evening} locale={locale} /> : (
          <Card>
            <p className="text-muted">{t("Ближайший вечер пока не назначен. Загляните позже.")}</p>
          </Card>
        )}
        <Card title={t("Впервые играете?")} className="border-accent/40">
          <p className="text-muted">{t("Встретим новичков, объясним правила, подскажем на первых играх и поможем комфортно влиться в компанию.")}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <ButtonLink href="/learn" variant="outline">{t("Как начать")}</ButtonLink>
            <ButtonLink href="/history" variant="outline">{t("История игр")}</ButtonLink>
            <ButtonLink href="/referee" variant="outline">{t("Вести игру")}</ButtonLink>
          </div>
        </Card>
      </div>
    </>
  );
}
