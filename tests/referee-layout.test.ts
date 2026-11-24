import assert from "node:assert/strict";
import { test } from "node:test";
import { guidedSeatPosition, seatPosition } from "../src/lib/referee/table-layout";

const n = (value: string) => Number.parseFloat(value);

test("Classic10 seating follows real table: 1 and 10 by host, 5 and 6 opposite", () => {
  const seats = Array.from({ length: 10 }, (_, index) => seatPosition(index + 1, 10));
  assert.ok(n(seats[0].left) < 50 && n(seats[0].top) > 50, "seat 1 bottom-left");
  assert.ok(n(seats[9].left) > 50 && n(seats[9].top) > 50, "seat 10 bottom-right");
  assert.ok(n(seats[4].left) < 50 && n(seats[4].top) < 20, "seat 5 upper-left");
  assert.ok(n(seats[5].left) > 50 && n(seats[5].top) < 20, "seat 6 upper-right");
  assert.ok(n(seats[2].left) < 20 && n(seats[7].left) > 80, "seats 3 and 8 across");
  assert.equal(new Set(seats.map((seat) => `${seat.left}/${seat.top}`)).size, 10);
});

test("Short9 has nine distinct, bounded seats without a phantom tenth", () => {
  const seats = Array.from({ length: 9 }, (_, index) => seatPosition(index + 1, 9));
  assert.equal(seats.length, 9);
  assert.equal(new Set(seats.map((seat) => `${seat.left}/${seat.top}`)).size, 9);
  for (const seat of seats) {
    assert.ok(n(seat.left) > 0 && n(seat.left) < 100);
    assert.ok(n(seat.top) > 0 && n(seat.top) < 100);
  }
  assert.throws(() => seatPosition(10, 9), /места/);
});

test("guided chairs stay clockwise and mirror each other around the host", () => {
  for (const count of [9, 10] as const) {
    const seats = Array.from({ length: count }, (_, index) => guidedSeatPosition(index + 1, count));
    const clockwise = seats.map(({ left, top }) => (Math.atan2(n(left) - 50, 50 - n(top)) * 180 / Math.PI + 540) % 360);
    assert(clockwise.every((angle, i) => i === 0 || angle > clockwise[i - 1]));
    assert(n(seats[0].left) < 50 && n(seats[0].top) > 80);
    for (const [i, seat] of seats.entries()) {
      const opposite = seats[count - 1 - i];
      assert(Math.abs(n(seat.left) + n(opposite.left) - 100) < 1e-10);
      assert(Math.abs(n(seat.top) - n(opposite.top)) < 1e-10);
    }
  }
  assert.throws(() => guidedSeatPosition(10, 9), /места/);
});
