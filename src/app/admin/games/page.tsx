import { getLocale } from "@/lib/i18n/server";
import { siteText } from "@/lib/i18n/site";
import type { Metadata } from "next";
import Link from "next/link";
import { adminAllGames } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";
import { FORMAT_LABEL, GAME_STATUS_LABEL, WINNER_LABEL, shortDate } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  return { title: siteText(await getLocale(), "Партии · Админка") };
}

export default async function AdminGamesPage() {
  const locale = await getLocale();
  const t = (label: string) => siteText(locale, label);
  const { supabase } = await requireAdmin();
  const games = await adminAllGames(supabase);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold">{t("Партии")}</h1>
        <p className="mt-2 text-muted">{t("Новую партию добавляйте на странице вечера: Админка → Вечера → нужный вечер → «Партии».")}</p>
      </div>
      {games.length === 0 ? (
        <p className="text-muted">{t("Партий пока нет.")}</p>
      ) : (
        <ul className="space-y-3">
          {games.map((g) => (
            <li key={g.id}>
              <Link
                href={`/admin/games/${g.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4 transition-colors hover:border-accent-text"
              >
                <span>
                  <span className="block font-medium">
                    {g.starts_at ? shortDate(g.starts_at) : "—"} {t("· партия №")}{g.game_no}
                  </span>
                  <span className="block text-sm text-muted">{t(FORMAT_LABEL[g.format])}</span>
                </span>
                <span className="flex items-center gap-3 text-sm text-muted">
                  {g.winner && <span>{t(WINNER_LABEL[g.winner])}</span>}
                  <span className="rounded-full bg-elevated px-3 py-1">{t(GAME_STATUS_LABEL[g.status])}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
