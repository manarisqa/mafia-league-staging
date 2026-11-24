import { notFound } from "next/navigation";
import { ButtonLink, PageHero } from "@/components/ui";
import { getPublicEvening } from "@/lib/data";
import { getLocale } from "@/lib/i18n/server";
import { siteText } from "@/lib/i18n/site";
import { isUuid } from "@/lib/validate";
import { EveningDetails } from "../evening-details";

export default async function EveningPage({ params }: PageProps<"/evenings/[id]">) {
  const [{ id }, locale] = await Promise.all([params, getLocale()]);
  if (!isUuid(id)) notFound();
  const evening = await getPublicEvening(id.toLowerCase(), locale);
  if (!evening) notFound();
  const t = (label: string) => siteText(locale, label);

  return (
    <>
      <PageHero title={t("Игровой вечер")} subtitle={t("Играем в Граце. Участие бесплатное, новичкам помогаем освоиться.")} />
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-8 sm:px-6">
        <EveningDetails evening={evening} locale={locale} />
        <ButtonLink href="/learn" variant="outline">{t("Как начать")}</ButtonLink>
      </div>
    </>
  );
}
