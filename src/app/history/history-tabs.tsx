"use client";

import { siteText } from "@/lib/i18n/site";
import type { Locale } from "@/lib/i18n/messages";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/evenings", label: "Вечера и запись" },
  { href: "/history", label: "Вечера" },
  { href: "/history/games", label: "Партии" },
  { href: "/history/seasons", label: "Сезоны" },
] as const;

function isTabActive(pathname: string, href: string) {
  return href === "/history" ? pathname === "/history" : pathname.startsWith(href);
}

export function HistoryTabs({ locale }: { locale: Locale }) {
  return <TabList locale={locale} pathname={usePathname()} />;
}

/** Без подсветки (pathname = null) — заглушка, пока адрес страницы ещё неизвестен. */
export function TabList({ locale, pathname }: { locale: Locale; pathname: string | null }) {
  const t = (label: string) => siteText(locale, label);
  return (
    <nav aria-label={t("Разделы истории")} className="mt-8">
      <ul className="inline-flex max-w-full flex-wrap rounded-control border border-border bg-surface p-1">
        {TABS.map(({ href, label }) => {
          const active = pathname !== null && isTabActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center rounded-[8px] px-5 text-sm transition-colors sm:px-8 ${
                  active ? "bg-accent text-text" : "text-muted hover:text-text"
                }`}
              >
                {t(label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
