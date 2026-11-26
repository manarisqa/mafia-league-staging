import { siteText } from "@/lib/i18n/site";
import { getLocale } from "@/lib/i18n/server";
import Link from "next/link";
import { eveningAuthLink } from "@/lib/evening-return";
import { RsvpButtons } from "@/app/evenings/rsvp-buttons";
import { Card } from "@/components/ui";
import { createServerSupabase } from "@/lib/supabase/server";

/** Блок «Записаться на вечер». Зависит от того, кто смотрит, поэтому внутри Suspense. */
export async function RsvpPanel({ eveningId }: { eveningId: string }) {
  const locale = await getLocale();
  const t = (label: string) => siteText(locale, label);
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    const next = `/evenings/${eveningId}`;
    return (
      <Card title={t("Записаться на вечер")} className="border-accent/40">
        <p className="text-muted">{t("Чтобы записаться, войдите или зарегистрируйтесь. Это займёт минуту.")}</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Link
            href={eveningAuthLink("/register", next)}
            className="inline-flex h-12 items-center justify-center rounded-control bg-accent px-6 font-medium hover:bg-accent-hover"
          >{t("Зарегистрироваться")}</Link>
          <Link
            href={eveningAuthLink("/login", next)}
            className="inline-flex h-12 items-center justify-center rounded-control border border-border px-6 font-medium hover:border-accent-text"
          >{t("Войти")}</Link>
        </div>
      </Card>
    );
  }

  const { data: player } = await supabase
    .from("players")
    .select("id, display_name, nickname")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (!player) {
    return (
      <Card title={t("Записаться на вечер")}>
        <p className="text-muted">{t("К вашему аккаунту пока не привязан профиль игрока. Напишите организатору клуба.")}</p>
      </Card>
    );
  }

  const { data: signup } = await supabase
    .from("evening_signups")
    .select("status, revision")
    .eq("evening_id", eveningId)
    .eq("player_id", player.id)
    .maybeSingle();

  return (
    <Card title={t("Записаться на вечер")} className="border-accent/40">
      <p className="mb-3 text-sm text-muted">{t("«Приду» и «Опоздаю» подтверждают запись. «Возможно» отмечает интерес. Присутствие организатор отмечает отдельно.")}</p>
      <RsvpButtons locale={locale} key={`${eveningId}:${player.id}`}
        eveningId={eveningId}
        revision={Number(signup?.revision ?? 0)}
        current={(signup?.status as "going" | "late" | "maybe" | "not_going" | undefined) ?? null}
        name={player.nickname?.trim() || player.display_name}
      />
    </Card>
  );
}
