import { getLocale } from "@/lib/i18n/server";
import { siteText } from "@/lib/i18n/site";
import type { Metadata } from "next";
import Link from "next/link";
import { EveningForm } from "@/app/admin/evenings/evening-forms";
import { adminEvenings, adminPlayers, adminSeasons } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";
import { EVENING_STATUS_LABEL, FORMAT_LABEL, fullDateTime } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  return { title: siteText(await getLocale(), "Вечера · Админка") };
}

export default async function AdminEveningsPage() {
  const locale = await getLocale();
  const t = (label: string) => siteText(locale, label);
  const { supabase } = await requireAdmin();
  const [evenings, players, seasons] = await Promise.all([adminEvenings(supabase), adminPlayers(supabase), adminSeasons(supabase)]);
  const options = players.map((p) => ({ id: p.id, name: p.nickname?.trim() || p.display_name }));

  const now = new Date().getTime();
  const upcoming = evenings.filter((e) => e.status === "planned" && Date.parse(e.starts_at) > now).reverse();
  const upcomingIds = new Set(upcoming.map((e) => e.id));
  const past = evenings.filter((e) => !upcomingIds.has(e.id));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold">{t("Игровые вечера")}</h1>
        <p className="mt-2 text-muted">{t("На сайте показывается ближайший вечер со статусом «Запланирован». Когда вечер прошёл, поменяйте статус на «Проведён».")}</p>
      </div>

      <section className="rounded-card border border-border bg-surface p-5">
        <h2 className="mb-4 font-display text-xl font-bold">{t("Новый вечер")}</h2>
        <EveningForm players={options} seasons={seasons} />
      </section>

      {[
        { title: "Ближайшие вечера", evenings: upcoming },
        { title: "Другие вечера", evenings: past },
      ].map((group) => (
        <section key={group.title}>
          <h2 className="mb-4 font-display text-xl font-bold">{t(group.title)}</h2>
          {group.evenings.length === 0 ? (
            <p className="text-muted">{t("Вечеров пока нет.")}</p>
          ) : (
            <ul className="space-y-3">
              {group.evenings.map((e) => (
                <li key={e.id}>
                  <Link href={`/admin/evenings/${e.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4 transition-colors hover:border-accent-text">
                    <span className="min-w-0 break-words">
                      <span className="block font-medium">{fullDateTime(e.starts_at, locale)}</span>
                      <span className="block text-sm text-muted">{e.place} · {t(FORMAT_LABEL[e.capacity === 9 ? "short9" : "classic10"])}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-3 text-sm text-muted">
                      {upcomingIds.has(e.id) && <span>{t("Игроки с подтверждённой записью")} · {e.signups}</span>}
                      <span className="rounded-full bg-elevated px-3 py-1">{t(EVENING_STATUS_LABEL[e.status])}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
