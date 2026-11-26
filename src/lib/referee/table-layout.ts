/** Clockwise physical seating as seen by the host at the bottom of the table.
 * Seat 1 is bottom-left, seat 10 bottom-right; 5 and 6 are opposite the host. */
export function seatPosition(seat: number, count: 9 | 10) {
  if (!Number.isInteger(seat) || seat < 1 || seat > count) throw new Error("Недопустимый номер места");
  // Classic10: seat 1 at 200°, seat 10 at 160°; Short9 keeps the same
  // clockwise order and distributes nine seats evenly around the circle.
  const angle = 200 + (seat - 1) * (360 / count);
  return positionOnRing(angle, 40, 40);
}

const guidedAngles = {
  10: [202, 242, 270, 298, 338, 382, 422, 450, 478, 518],
  9: [202, 245, 274, 314, 360, 406, 446, 475, 518],
} as const;

export function guidedSeatPosition(seat: number, count: 9 | 10) {
  const angle = guidedAngles[count][seat - 1];
  if (angle === undefined) throw new Error("Недопустимый номер места");
  // Wider gaps at twelve and six o'clock leave room for two cards on the same row
  // and keep the host centered between the first and the last seat.
  return positionOnRing(angle, 37, 40);
}

function positionOnRing(angle: number, horizontalRadius: number, verticalRadius: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    left: `${50 + horizontalRadius * Math.sin(radians)}%`,
    top: `${50 - verticalRadius * Math.cos(radians)}%`,
  };
}
