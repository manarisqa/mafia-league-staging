import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WinnerMark } from "@/app/history/history-ui";
import { DemoBadge } from "@/components/ui";
import { getGameProtocol, showDemoBadge } from "@/lib/data";
import { FORMAT_LABEL, ROLE_LABEL, WINNER_LABEL, fullDateTime } from "@/lib/format";
import { sideOf } from "@/lib/rating";
import { isUuid } from "@/lib/validate";

export const metadata: Metadata = { title: "История · Протокол партии" };

export default function GameProtocolPage(props: PageProps<"/history/games/[id]">) {
  return (
    <>
      <Link href="/history/games" className="inline-flex min-h-11 items-center text-sm text-accent-text hover:underline">
        ← Все партии
      </Link>
      <Suspense fallback={<p className="text-muted">Загрузка протокола…</p>}>
        <Protocol params={props.params} />
      </Suspense>
    </>
  );
}

async function Protocol({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const game = await getGameProtocol(id);
  if (!game) notFound();
  const demo = showDemoBadge();

  return (
    <article className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl font-bold">
            Партия №{game.no} · {FORMAT_LABEL[game.format]}
          </h2>
          <p className="mt-2 text-muted">{fullDateTime(game.eveningStartsAt)}</p>
        </div>
        {demo && <DemoBadge />}
      </header>

      <dl className="grid gap-4 rounded-card border border-border bg-surface p-5 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-muted">Победа</dt>
          <dd className="mt-1 text-lg font-medium">
            <WinnerMark winner={game.winner} />
          </dd>
          <dd className="text-sm text-muted">{WINNER_LABEL[game.winner]}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Ведущий</dt>
          <dd className="mt-1 text-lg font-medium">{game.hostName ?? "не указан"}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Игроков за столом</dt>
          <dd className="mt-1 text-lg font-medium tabular-nums">{game.seats.length}</dd>
        </div>
      </dl>

      <p className="rounded-control border border-border p-3 text-sm text-muted">
        {game.skillReason ? `Без основного League Skill: ${game.skillReason}.` : "Партия учтена в League Skill · team-logit-v1."}
      </p>
      <section aria-labelledby="seats-title">
        <h3 id="seats-title" className="mb-4 font-display text-xl font-bold">
          Рассадка и роли
        </h3>
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead className="bg-surface text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-normal">Место</th>
                <th scope="col" className="px-4 py-3 font-normal">Игрок</th>
                <th scope="col" className="px-4 py-3 font-normal">Роль</th>
                <th scope="col" className="px-4 py-3 font-normal">Сторона</th>
                <th scope="col" className="px-4 py-3 font-normal">Итог</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {game.seats.map((s) => {
                const side = sideOf(s.role);
                const result =
                  game.winner === "draw" ? "Ничья" : side === game.winner ? "Победа" : "Поражение";
                return (
                  <tr key={s.seat} className={result === "Победа" ? "bg-accent/10" : undefined}>
                    <td className="px-4 py-3 font-display text-lg tabular-nums text-accent-text">{s.seat}</td>
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/players/${s.playerId}`} className="hover:text-accent-text hover:underline">
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{ROLE_LABEL[s.role]}{s.removed ? " · удалён" : ""}{s.fouls > 0 ? ` · фолов: ${s.fouls}` : ""}</td>
                    <td className="px-4 py-3">
                      <WinnerMark winner={side} />
                    </td>
                    <td className="px-4 py-3 text-muted">{result}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-sm text-muted">
        Ход игры (голосования, фолы, ночные действия) появится, когда ведущий начнёт вести партии на пульте.
      </p>
    </article>
  );
}
