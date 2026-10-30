import type { ReactNode } from "react";
import { getLocale } from "@/lib/i18n/server";
import { LocaleProvider } from "./locale-provider";

/** Request cookies stay outside shared League caches and inside Suspense. */
export async function LocaleBoundary({ children }: { children: ReactNode }) {
  return <LocaleProvider locale={await getLocale()}>{children}</LocaleProvider>;
}
