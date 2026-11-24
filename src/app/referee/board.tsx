import { guidedSeatPosition } from "@/lib/referee/table-layout";
import type { Format } from "@/lib/referee/guided/protocol";
import type { State } from "@/lib/referee/guided/reducer";
import type { Translate } from "./words";

export type SeatStatus = Pick<State["seats"][number], "fouls" | "warnings" | "alive" | "removed" | "debt">;

export function Board({ players, format, selected = [], discipline, legacyWarnings, speaker, candidates = [], target, onSeat, enabled, t }: {
  players: { name: string }[];
  format: Format;
  selected?: number[];
  discipline?: SeatStatus[];
  legacyWarnings?: boolean;
  speaker?: number | null;
  candidates?: number[];
  target?: { seat: number; label: "currentCandidate" | "currentTarget" };
  onSeat?: (seat: number) => void;
  enabled?: number[];
  t: Translate;
}) {
  return (
    <div className="ref-board">
      <div className="ref-table">
        {discipline ? <div className="ref-table-legend">
          <p><strong>{discipline.filter((seat) => seat.alive).length}/{players.length}</strong> {t("atTable")}</p>
          <p><span>● {t("foulsLabel")}</span>{legacyWarnings && <span>Т {t("technicalLabel")}</span>}</p>
        </div> : <span className="ref-table-format">{t(format)}</span>}
      </div>
      {players.map((player, index) => {
        const n = index + 1;
        const status = discipline?.[index];
        const order = candidates.indexOf(n) + 1;
        const exit = status?.removed ? "removed" : status && !status.alive ? "eliminated" : null;
        const klass = ["ref-seat", selected.includes(n) && "selected", exit && "out",
          n === speaker && "speaking", n === target?.seat && "target"].filter(Boolean).join(" ");
        const style = guidedSeatPosition(n, format === "classic10" ? 10 : 9);
        const sanction = status?.fouls === 4 ? "redCard" : status?.fouls ? "yellowCard" : null;
        const label = [n + " · " + player.name, status && t("ordinaryCount") + " " + status.fouls + "/4",
          sanction && t(sanction), legacyWarnings && status && t("technicalCount") + " " + status.warnings + "/2", exit && t(exit),
          status?.debt && !exit && t("debt"), n === speaker && t("onSpeech"),
          order > 0 && t("nominated") + " " + order, n === target?.seat && t(target.label)].filter(Boolean).join(" · ");
        const inner = <>
          <span className="ref-seat-main">
            <b>{n}</b>
            <span className="ref-seat-name" title={player.name}>{player.name}</span>
            {order > 0 && <span className="ref-seat-order" aria-hidden="true">{order}</span>}
          </span>
          {status && <span className="ref-seat-discipline">
            <span className="ref-seat-foul" data-fouls={status.fouls} data-card={sanction ?? undefined} title={t(sanction ?? "ordinaryCount")}>● {status.fouls}/4</span>
            {legacyWarnings && <span className="ref-seat-tech" data-technical={status.warnings} title={t("technicalCount")}>Т {status.warnings}/2</span>}
            {exit && !legacyWarnings && <span className="ref-seat-exit" title={t(exit)}>{t(exit)}</span>}
          </span>}
          {exit && legacyWarnings && <span className="ref-seat-exit">{t(exit)}</span>}
          {status?.debt && !exit && <span className="ref-seat-debt" aria-hidden="true">!</span>}
        </>;
        return onSeat ? <button className={klass} style={style} key={n} data-seat={n} data-exit={exit ?? undefined} aria-label={label} type="button"
          disabled={!!enabled && !enabled.includes(n)} onClick={() => onSeat(n)}>{inner}</button>
          : <div className={klass} style={style} key={n} data-seat={n} data-exit={exit ?? undefined} role="group" aria-label={label}>{inner}</div>;
      })}
      <span className="ref-host">{t("host")}</span>
    </div>
  );
}
