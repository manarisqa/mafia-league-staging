import type { Metadata } from "next";
import Link from "next/link";
import { EveningForm } from "@/app/admin/evenings/evening-forms";
import { adminEvenings, adminPlayers, adminSeasons } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";
import { EVENING_STATUS_LABEL, fullDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Вечера · Админка" };

export default async function AdminEveningsPage() {
  const { supabase } = await requireAdmin();
  const [evenings, players, seasons] = await Promise.all([adminEvenings(supabase), adminPlayers(supabase), adminSeasons(supabase)]);
  const options = players.map((p) => ({ id: p.id, name: p.display_name }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold">Игровые вечера</h1>
        <p className="mt-2 text-muted">
          На сайте показывается ближайший вечер со статусом «Запланирован». Когда вечер прошёл,
          поменяйте статус на «Проведён».
        </p>
      </div>

      <section className="rounded-card border border-border bg-surface p-5">
        <h2 className="mb-4 font-display text-xl font-bold">Новый вечер</h2>
        <EveningForm players={options} seasons={seasons} />
      </section>

      <section>
        <h2 className="mb-4 font-display text-xl font-bold">Все вечера ({evenings.length})</h2>
        {evenings.length === 0 ? (
          <p className="text-muted">Вечеров пока нет.</p>
        ) : (
          <ul className="space-y-3">
            {evenings.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/admin/evenings/${e.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4 transition-colors hover:border-accent-text"
                >
                  <span>
                    <span className="block font-medium">{fullDateTime(e.starts_at)}</span>
                    <span className="block text-sm text-muted">{e.place}</span>
                  </span>
                  <span className="flex items-center gap-4 text-sm text-muted">
                    <span>
                      Подтвердили: {e.signups} из {e.capacity}
                    </span>
                    <span className="rounded-full bg-elevated px-3 py-1">{EVENING_STATUS_LABEL[e.status]}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
