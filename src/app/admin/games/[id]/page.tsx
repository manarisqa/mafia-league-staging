import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DeleteGameButton,
  GameEditor,
  ReopenGameButton,
} from "@/app/admin/games/game-forms";
import { adminGame, adminPlayers, adminSignups } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";
import { FORMAT_LABEL, GAME_STATUS_LABEL, ROLE_LABEL, WINNER_LABEL, fullDateTime } from "@/lib/format";
import { isUuid } from "@/lib/validate";

export const metadata: Metadata = { title: "Партия · Админка" };

export default async function AdminGamePage(props: PageProps<"/admin/games/[id]">) {
  const { supabase } = await requireAdmin();
  const { id } = await props.params;
  if (!isUuid(id)) notFound();

  const game = await adminGame(supabase, id);
  if (!game) notFound();

  const [players, signups, eveningRes] = await Promise.all([
    adminPlayers(supabase),
    adminSignups(supabase, game.evening_id),
    supabase.from("evenings").select("starts_at").eq("id", game.evening_id).maybeSingle(),
  ]);
  const options = players.map((p) => ({ id: p.id, name: p.display_name }));
  const names = new Map(options.map((p) => [p.id, p.name]));
  const signedIds = signups.filter((s) => s.status === "going" || s.status === "late").map((s) => s.player_id);
  const finished = game.status === "finished";

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/admin/evenings/${game.evening_id}`}
          className="inline-flex min-h-11 items-center text-sm text-accent-text hover:underline"
        >
          ← К вечеру
        </Link>
        <h1 className="font-display text-3xl font-bold">
          Партия №{game.game_no} · {FORMAT_LABEL[game.format]}
        </h1>
        <p className="mt-2 text-muted">
          {eveningRes.data ? fullDateTime(eveningRes.data.starts_at) : ""} ·{" "}
          <span className={finished ? "text-success" : "text-warning"}>{GAME_STATUS_LABEL[game.status]}</span>
        </p>
      </div>

      {finished ? (
        <section className="space-y-5 rounded-card border border-border bg-surface p-5">
          <p className="text-lg">
            Победа:{" "}
            <span className="font-medium">{game.winner ? WINNER_LABEL[game.winner] : "—"}</span>
          </p>
          <p className="text-sm text-muted">
            Ведущий: {game.host_player_id ? (names.get(game.host_player_id) ?? "—") : "не назначен"}
          </p>
          <ul className="divide-y divide-border">
            {game.seats.map((s) => (
              <li key={s.seat} className="flex items-center gap-4 py-2">
                <span className="w-8 text-center font-display text-lg text-accent-text">{s.seat}</span>
                <span className="flex-1 font-medium">{names.get(s.player_id) ?? "—"}</span>
                <span className="text-sm text-muted">{ROLE_LABEL[s.role]}</span>
              </li>
            ))}
          </ul>
          <ReopenGameButton gameId={game.id} revision={game.revision} />
        </section>
      ) : (
        <>
          <section className="rounded-card border border-border bg-surface p-5">
            <GameEditor key={game.id} game={game} players={options} signedIds={signedIds} />
          </section>
          <div className="flex justify-end">
            <DeleteGameButton gameId={game.id} revision={game.revision} />
          </div>
        </>
      )}
    </div>
  );
}
