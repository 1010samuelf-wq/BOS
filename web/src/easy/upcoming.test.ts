import { describe, expect, it } from "vitest";

import type { Order } from "../api/types";
import { dayLabel, groupByDay, timeOf } from "./upcoming";

const order = (id: number, needed: string | null): Order =>
  ({ id, client_name: `C${id}`, needed_for_date: needed }) as Order;

// Late evening on 25 Nov: the hour a timezone conversion would go wrong.
const now = new Date(2026, 10, 25, 23, 30);

describe("coming up", () => {
  it("groups by day, soonest first, with times in order inside a day", () => {
    const groups = groupByDay([
      order(1, "2026-11-28T00:00:00Z"),
      order(2, "2026-11-25T15:00:00Z"),
      order(3, "2026-11-25T09:30:00"),
      order(4, null),
      order(5, "2026-11-26T00:00:00+00:00"),
    ], now);
    expect(groups.map((g) => [g.day, g.orders.map((o) => o.id)])).toEqual([
      ["2026-11-25", [3, 2]],
      ["2026-11-26", [5]],
      ["2026-11-28", [1]],
    ]);
  });

  it("reads the day off the value, ignoring the Z", () => {
    // A conversion would put this on the 25th in Toronto.
    expect(groupByDay([order(1, "2026-11-26T00:00:00Z")], now)[0].day).toBe("2026-11-26");
  });

  it("names today and tomorrow, and spells out later days", () => {
    expect(dayLabel("2026-11-25", now)).toBe("Today");
    expect(dayLabel("2026-11-26", now)).toBe("Tomorrow");
    expect(dayLabel("2026-11-28", now)).toMatch(/28/);
    expect(dayLabel("2026-11-28", now)).not.toBe("Tomorrow");
  });

  it("shows a time only when one was given", () => {
    expect(timeOf("2026-11-25T14:30:00Z")).toBe("2:30 PM");
    expect(timeOf("2026-11-25T09:05:00")).toBe("9:05 AM");
    expect(timeOf("2026-11-25T00:00:00Z")).toBe("");
    expect(timeOf(null)).toBe("");
  });
});
