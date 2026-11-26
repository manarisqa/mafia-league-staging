import { siteText } from "@/lib/i18n/site";
import { getLocale } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";
import { adminCounts, adminRelevantEvening } from "@/lib/admin-data";
import { ButtonLink } from "@/components/ui";
import { fullDateTime } from "@/lib/format";
import { requireAdmin } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: siteText(await getLocale(), "Обзор · Админка") };
}

export default async function AdminPage() {
  const locale = await getLocale();
  const t = (label: string) => siteText(locale, label);
  const { supabase } = await requireAdmin();
  const [c, next] = await Promise.all([adminCounts(supabase), adminRelevantEvening(supabase)]);

  const stats = [
    { label: "Игроков", value: c.players, href: "/admin/players" },
    { label: "Вечеров", value: c.evenings, href: "/admin/evenings" },
    { label: "Партий", value: c.games, href: "/admin/games" },
    { label: "Идут сейчас", value: c.playing },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold">{t("Сегодня")}</h1>
        {next && <p className="mt-2 text-muted">{next.place} · {fullDateTime(next.starts_at, locale)}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <ButtonLink href="/referee">{t("Вести игру")}</ButtonLink>
          {next?.id && <ButtonLink variant="outline" href={"/admin/evenings/" + next.id}>{t("Вечера и запись")}</ButtonLink>}
          <ButtonLink variant="outline" href="/admin/referee/inbox">{t("Проверка протоколов")}</ButtonLink>
        </div>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <li key={t(s.label)} className="rounded-card border border-border bg-surface p-5">
            <p className="font-display text-4xl leading-none font-bold">{s.value}</p>
            <p className="mt-2 text-sm text-muted">{t(s.label)}</p>
            {s.href && (
              <Link href={s.href} className="mt-3 inline-flex min-h-11 items-center text-sm text-accent-text hover:underline">{t("Открыть →")}</Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
