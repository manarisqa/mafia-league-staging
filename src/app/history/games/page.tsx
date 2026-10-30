import type { Metadata } from "next";
import { ProtocolLink, TotalsStrip, WinnerMark } from "@/app/history/history-ui";
import { DemoBadge } from "@/components/ui";
import { getHistory, showDemoBadge } from "@/lib/data";
import { FORMAT_LABEL, shortDate } from "@/lib/format";

export const metadata: Metadata = { title: "История · Партии" };

export default async function HistoryGamesPage() {
  const { evenings, totals } = await getHistory();
  const demo = showDemoBadge();
  // Новые сверху: вечера уже идут от новых к старым, внутри вечера — последняя партия первой.
  const games = evenings.flatMap((e) => [...e.games].reverse().map((g) => ({ ...g, evening: e })));

  return (
    <>
      {demo && (
        <div className="flex justify-end">
          <DemoBadge />
        </div>
      )}
      <TotalsStrip totals={totals} caption="За всё время" />

      <section aria-labelledby="games-title">
        <h2 id="games-title" className="mb-4 font-display text-2xl font-bold">
          Все партии
        </h2>
        {games.length === 0 ? (
          <p className="text-muted">Сыгранных партий пока нет.</p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="bg-surface text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-normal">Дата</th>
                  <th scope="col" className="px-4 py-3 font-normal">Вечер</th>
                  <th scope="col" className="px-4 py-3 font-normal">Партия</th>
                  <th scope="col" className="px-4 py-3 font-normal">Формат</th>
                  <th scope="col" className="px-4 py-3 font-normal">Победила сторона</th>
                  <th scope="col" className="px-4 py-3 font-normal"><span className="sr-only">Протокол</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {games.map((g) => (
                  <tr key={g.id}>
                    <td className="px-4 py-1 whitespace-nowrap">{shortDate(g.playedAt)}</td>
                    <td className="px-4 py-1 text-muted">№{g.evening.number}</td>
                    <td className="px-4 py-1 tabular-nums">{g.no}</td>
                    <td className="px-4 py-1">{FORMAT_LABEL[g.format]}</td>
                    <td className="px-4 py-1"><WinnerMark winner={g.winner} /></td>
                    <td className="px-4 py-1 text-right"><ProtocolLink id={g.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
