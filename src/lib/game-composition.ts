export type RoleKey = "civilian" | "sheriff" | "don" | "mafia";

export type Composition = {
  seated: number;
  counts: Record<RoleKey, number>;
  hostAtTable: boolean;
  hostAssigned: boolean;
  hasWinner: boolean;
};

/** Сколько мест и какие роли нужны, чтобы завершить партию. */
export function expectedFor(total: number): Record<RoleKey, number> {
  return { civilian: total - 4, sheriff: 1, don: 1, mafia: 2 };
}

const ROLES: RoleKey[] = ["civilian", "sheriff", "don", "mafia"];

/** Считает рассадку по данным формы. `get` отдаёт значение поля по имени. */
export function summarize(get: (name: string) => string, total: number): Composition {
  const counts: Record<RoleKey, number> = { civilian: 0, sheriff: 0, don: 0, mafia: 0 };
  const players = new Set<string>();
  for (let seat = 1; seat <= total; seat++) {
    const player = get(`seat_${seat}_player`);
    if (!player) continue; // свободное место не считается, даже если у него выбрана роль
    players.add(player);
    const role = get(`seat_${seat}_role`) as RoleKey;
    if (ROLES.includes(role)) counts[role] += 1;
  }
  const host = get("host_player_id");
  return {
    seated: players.size,
    counts,
    hostAssigned: !!host,
    hostAtTable: !!host && players.has(host),
    hasWinner: !!get("winner"),
  };
}

/** Первая причина, почему партию ещё нельзя завершить, или null, если можно. */
export function blocker(c: Composition, total: number): string | null {
  const want = expectedFor(total);
  if (c.seated < total) return `Заполнено мест: ${c.seated} из ${total}`;
  const wrong = ROLES.some((r) => c.counts[r] !== want[r]);
  if (wrong) return "Исправьте набор ролей (подсвечен красным)";
  if (!c.hostAssigned) return "Назначьте отдельного ведущего";
  if (c.hostAtTable) return "Ведущий не может сидеть за столом";
  if (!c.hasWinner) return "Выберите победителя";
  return null;
}
