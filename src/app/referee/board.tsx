import { seatPosition } from "@/lib/referee/table-layout";
import type { Format } from "@/lib/referee/guided/protocol";
import type { Translate } from "./words";

export function Board({ players, format, selected = [], dead = [], onSeat, enabled, t }: {
  players: { name: string }[];
  format: Format;
  selected?: number[];
  dead?: number[];
  onSeat?: (seat: number) => void;
  enabled?: number[];
  t: Translate;
}) {
  return (
    <div className="ref-board">
      <div className="ref-table" aria-hidden="true"><span>{t(format)}</span></div>
      {players.map((player, index) => {
        const n = index + 1;
        const label = n + " · " + player.name;
        const klass = "ref-seat" + (selected.includes(n) ? " selected" : "") + (dead.includes(n) ? " out" : "");
        const style = seatPosition(n, format === "classic10" ? 10 : 9);
        const inner = <><b>{n}</b><span title={player.name}>{player.name}</span></>;
        return onSeat ? <button className={klass} style={style} key={n} aria-label={label} type="button"
          disabled={!!enabled && !enabled.includes(n)} onClick={() => onSeat(n)}>{inner}</button>
          : <div className={klass} style={style} key={n} aria-label={label}>{inner}</div>;
      })}
      <span className="ref-host">{t("host")}</span>
    </div>
  );
}
