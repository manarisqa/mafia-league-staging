import { siteText } from "@/lib/i18n/site";
import type { Locale } from "@/lib/i18n/messages";
import { getLocale } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/login/actions";
import { requireAdmin } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: { default: siteText(await getLocale(), "Админка"), template: "%s" }, robots: { index: false } };
}

const NAV = [
  { href: "/admin", label: "Сегодня" },
  { href: "/admin/evenings", label: "Вечера" },
  { href: "/admin/games", label: "Партии" },
  { href: "/admin/referee/inbox", label: "Проверка протоколов" },
  { href: "/admin/referee", label: "Архив пульта" },
  { href: "/admin/players", label: "Игроки" },
  { href: "/admin/analytics", label: "Аналитика клуба" },
  { href: "/admin/seasons", label: "Номинации" },
  { href: "/admin/communications", label: "Уведомления и отзывы" },
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const locale = await getLocale();
  const t = (label: string) => siteText(locale, label);
  return (
    <Suspense fallback={<p className="px-4 py-10 text-muted sm:px-6">{t("Загрузка…")}</p>}>
      <AdminShell locale={locale}>{children}</AdminShell>
    </Suspense>
  );
}

// Проверка прав происходит здесь (во время запроса), а не в самом layout,
// иначе вся страница ждала бы ответа от базы.
async function AdminShell({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const t = (label: string) => siteText(locale, label);
  const { user } = await requireAdmin();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <nav aria-label={t("Разделы админки")} className="flex flex-wrap gap-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="inline-flex min-h-11 items-center rounded-control px-2 text-sm text-muted hover:bg-surface sm:px-4 hover:text-text"
            >
              {t(n.label)}
            </Link>
          ))}
        </nav>
        <form action={signOut} className="flex items-center gap-3 text-sm text-muted">
          <span className="hidden sm:inline">{user.email}</span>
          <button type="submit" className="min-h-11 rounded-control border border-border px-4 hover:border-accent-text">{t("Выйти")}</button>
        </form>
      </div>
      {children}
    </div>
  );
}
