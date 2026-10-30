"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { translate, type Locale, type MessageKey } from "@/lib/i18n/messages";
import { setLocale } from "@/lib/i18n/actions";

const LocaleContext = createContext<Locale>("ru");
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}
export function useTranslation() {
  const locale = useContext(LocaleContext);
  return { locale, t: (key: MessageKey) => translate(locale, key) };
}
export function Text({ id }: { id: MessageKey }) { return useTranslation().t(id); }

export function LanguageSwitch() {
  const { locale, t } = useTranslation();
  return (
    <form action={setLocale} aria-label={t("language")} className="flex shrink-0 gap-1">
      {(["ru", "uk"] as const).map((value) => (
        <button key={value} type="submit" name="locale" value={value} lang={value}
          aria-label={value === "ru" ? "Русский" : "Українська"} aria-pressed={locale === value}
          className={`min-h-11 min-w-11 rounded-control px-2 text-xs ${locale === value ? "bg-elevated text-text" : "text-muted hover:text-text"}`}>
          {value === "ru" ? "РУС" : "УКР"}
        </button>
      ))}
    </form>
  );
}
