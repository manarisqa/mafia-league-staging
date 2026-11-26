import { getLocale } from "@/lib/i18n/server";
import { siteText } from "@/lib/i18n/site";
import type { Metadata } from "next";
import { LinkAccountForm } from "@/app/admin/players/link-account";
import { DeletePlayerButton, PlayerForm } from "@/app/admin/players/player-form";
import { adminPlayers } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: siteText(await getLocale(), "Игроки · Админка") };
}

export default async function AdminPlayersPage() {
  const locale = await getLocale();
  const t = (label: string) => siteText(locale, label);
  const { supabase } = await requireAdmin();
  const players = await adminPlayers(supabase);
  const accounts = players.filter((p) => p.user_id).map((p) => ({ id: p.id, name: p.display_name, revision: p.revision }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold">{t("Игроки")}</h1>
        <p className="mt-2 text-muted">{t("Всего:")} {players.length}{t(". Изменения сразу появляются на сайте. Игроки, которые зарегистрировались сами, помечены «Есть аккаунт» — их можно привязать к старому профилю с историей игр.")}</p>
      </div>

      <section className="rounded-card border border-border bg-surface p-5">
        <h2 className="mb-4 font-display text-xl font-bold">{t("Добавить игрока")}</h2>
        <PlayerForm />
      </section>

      <section>
        <h2 className="mb-4 font-display text-xl font-bold">{t("Все игроки")}</h2>
        <ul className="space-y-3">
          {players.map((p) => (
            <li key={p.id} className="rounded-card border border-border bg-surface p-4">
              <PlayerForm player={p} />
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted">
                <span>{p.user_id ? t("Есть аккаунт") : t("Без аккаунта")}</span>
                <DeletePlayerButton player={p} />
              </div>
              {!p.user_id && <LinkAccountForm historicalId={p.id} historicalRevision={p.revision} accounts={accounts} />}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
