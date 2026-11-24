import { getLocale } from "@/lib/i18n/server";
import { siteText } from "@/lib/i18n/site";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DeleteEveningButton,
  EveningForm,
  SignupAddForm,
  SignupRow,
} from "@/app/admin/evenings/evening-forms";
import { AddGameForm } from "@/app/admin/games/game-forms";
import { AttendanceForm } from "../attendance-form";
import { eveningReadiness } from "@/lib/evening-roster";
import { adminAttendance, adminEvening, adminGamesOfEvening, adminPlayers, adminSignups, adminSeasons } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";
import { FORMAT_LABEL, GAME_STATUS_LABEL, WINNER_LABEL, fullDateTime } from "@/lib/format";
import { isUuid } from "@/lib/validate";

export async function generateMetadata(): Promise<Metadata> {
  return { title: siteText(await getLocale(), "Вечер · Админка") };
}

export default async function AdminEveningPage(props: PageProps<"/admin/evenings/[id]">) {
  const locale = await getLocale();
  const t = (label: string) => siteText(locale, label);
  const { supabase } = await requireAdmin();
  const { id } = await props.params;
  if (!isUuid(id)) notFound();

  const [evening, players, signups, games, seasons, attendance] = await Promise.all([
    adminEvening(supabase, id),
    adminPlayers(supabase),
    adminSignups(supabase, id),
    adminGamesOfEvening(supabase, id),
    adminSeasons(supabase),
    adminAttendance(supabase, id),
  ]);
  if (!evening) notFound();

  const options = players.map((p) => ({ id: p.id, name: p.nickname?.trim() || p.display_name }));
  const signed = new Set(signups.map((s) => s.player_id));
  const candidates = options.filter((p) => !signed.has(p.id));
  const roster = eveningReadiness(evening.capacity, evening.host_player_id,
    signups.filter((s) => s.status === "going" || s.status === "late").map((s) => s.player_id));
  const mayLog = evening.status !== "cancelled" && Date.parse(evening.starts_at) <= new Date().getTime();

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin/evenings" className="inline-flex min-h-11 items-center text-sm text-accent-text hover:underline">{t("← Все вечера")}</Link>
        <h1 className="font-display text-3xl font-bold">{fullDateTime(evening.starts_at, locale)}</h1>
        <p className="mt-2 text-muted">{t("Игроки с подтверждённой записью")} · {roster.confirmed} · {t("Для одного стола")} {evening.capacity}
        </p>
      </div>

      <section className="rounded-card border border-border bg-surface p-5">
        <h2 className="mb-4 font-display text-xl font-bold">{t("О вечере")}</h2>
        <EveningForm key={evening.id} evening={evening} players={options} seasons={seasons} />
      </section>

      <section className="rounded-card border border-border bg-surface p-5">
        <h2 className="mb-1 font-display text-xl font-bold">{t("Запись на вечер")}</h2>
        <p className="mb-4 text-sm text-muted">{t("«Придут» на сайте считаются со статусами «Придёт» и «Опоздает». Остальное видите только вы.")}</p>
        <SignupAddForm eveningId={evening.id} candidates={candidates} />
        {signups.length > 0 && (
          <ul className="mt-5 space-y-2">
            {signups.map((s) => (
              <SignupRow key={`${evening.id}:${s.player_id}`} eveningId={evening.id} signup={s} />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-card border border-border bg-surface p-5">
        <h2 className="mb-1 font-display text-xl font-bold">{t("Фактическая посещаемость")}</h2>
        <p className="mb-4 text-sm text-muted">{t("Отметьте всех, кого видели на вечере, включая ведущего и гостей с профилем. Запись и сыгранные партии учитываются отдельно.")}</p>
        {attendance === undefined ? <p className="text-sm text-muted">{t("Журнал посещаемости пока недоступен.")}</p>
          : mayLog ? <AttendanceForm eveningId={id} locale={locale} log={attendance} players={options} />
          : <p className="text-sm text-muted">{t("Посещаемость доступна после начала неотменённого вечера.")}</p>}
      </section>

      <section className="rounded-card border border-border bg-surface p-5">
        <h2 className="mb-1 font-display text-xl font-bold">{t("Партии вечера")}</h2>
        <p className="mb-4 text-sm text-muted">{t("Здесь вносятся результаты: кто на каком месте сидел, роли и победитель.")}</p>
        {games.length > 0 && (
          <ul className="mb-5 space-y-2">
            {games.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/admin/games/${g.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border p-3 transition-colors hover:border-accent-text"
                >
                  <span className="font-medium">{t("Партия №")}{g.game_no} · {t(FORMAT_LABEL[g.format])}
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
        <AddGameForm eveningId={evening.id} />
      </section>

      {!attendance && <div className="flex justify-end">
        <DeleteEveningButton id={evening.id} revision={evening.revision} />
      </div>}
    </div>
  );
}
