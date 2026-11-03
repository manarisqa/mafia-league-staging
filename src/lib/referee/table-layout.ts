/** Clockwise physical seating as seen by the host at the bottom of the table.
 * Seat 1 is bottom-left, seat 10 bottom-right; 5 and 6 are opposite the host. */
export function seatPosition(seat: number, count: 9 | 10) {
  if (!Number.isInteger(seat) || seat < 1 || seat > count) throw new Error("Недопустимый номер места");
  // Classic10: seat 1 at 200°, seat 10 at 160°; Short9 keeps the same
  // clockwise order and distributes nine seats evenly around the circle.
  const angle = 200 + (seat - 1) * (360 / count);
  const radians = (angle * Math.PI) / 180;
  return { left: `${50 + 40 * Math.sin(radians)}%`, top: `${50 - 40 * Math.cos(radians)}%` };
}
