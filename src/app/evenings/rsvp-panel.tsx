import Link from "next/link";
import { RsvpButtons } from "@/app/evenings/rsvp-buttons";
import { Card } from "@/components/ui";
import { createServerSupabase } from "@/lib/supabase/server";

/** Блок «Записаться на вечер». Зависит от того, кто смотрит, поэтому внутри Suspense. */
export async function RsvpPanel({ eveningId }: { eveningId: string }) {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    return (
      <Card title="Записаться на вечер" className="border-accent/40">
        <p className="text-muted">Чтобы записаться, войдите или зарегистрируйтесь. Это займёт минуту.</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/register"
            className="inline-flex h-12 items-center justify-center rounded-control bg-accent px-6 font-medium hover:bg-accent-hover"
          >
            Зарегистрироваться
          </Link>
          <Link
            href="/login"
            className="inline-flex h-12 items-center justify-center rounded-control border border-border px-6 font-medium hover:border-accent-text"
          >
            Войти
          </Link>
        </div>
      </Card>
    );
  }

  const { data: player } = await supabase
    .from("players")
    .select("id, display_name")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (!player) {
    return (
      <Card title="Записаться на вечер">
        <p className="text-muted">
          К вашему аккаунту пока не привязан профиль игрока. Напишите организатору клуба.
        </p>
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
    <Card title="Записаться на вечер" className="border-accent/40">
      <RsvpButtons key={`${eveningId}:${player.id}`}
        eveningId={eveningId}
        revision={Number(signup?.revision ?? 0)}
        current={(signup?.status as "going" | "late" | "maybe" | "not_going" | undefined) ?? null}
        name={player.display_name}
      />
    </Card>
  );
}
