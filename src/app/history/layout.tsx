import { siteText } from "@/lib/i18n/site";
import { getLocale } from "@/lib/i18n/server";
import { Suspense, type ReactNode } from "react";
import { HistoryTabs, TabList } from "@/app/history/history-tabs";
import { PageHero } from "@/components/ui";

export default async function HistoryLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const t = (label: string) => siteText(locale, label);
  return (
    <>
      <PageHero title={t("История клуба")} subtitle={t("Все игровые вечера, партии и сезоны в одном месте.")}>
        {/* Вкладки читают адрес страницы, на динамических адресах это нужно делать в Suspense. */}
        <Suspense fallback={<TabList locale={locale} pathname={null} />}>
          <HistoryTabs locale={locale} />
        </Suspense>
      </PageHero>
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-10 sm:px-6">{children}</div>
    </>
  );
}
