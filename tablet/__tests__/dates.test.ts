// "Needed for" is a wall-clock business value, not an instant. These lock in
// that it renders the same no matter which shape the backend sent it in —
// Postgres (prod) returns this column tz-aware ("...T00:00:00Z"), the SQLite
// dev DB returns it naive ("...T00:00:00"), and both must agree. Before the
// fix, a date-only order for Aug 14 came back as "13 Aug 2026, 8:00 PM" in
// production (New York) and sorted under the wrong day, while dev looked fine.
//
// Every assertion here is timezone-independent: the helpers build a local Date
// from the literal components, so these pass under any TZ the suite runs in.

import { asDate, formatNeeded, isDateOnly, neededDeadline } from "../src/order/dates";

// Mirrors the day-bucketing the order list uses to group rows by date.
function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("needed-for date parsing is wall-clock, not an instant", () => {
  it("renders a date-only order on the day that was picked", () => {
    expect(formatNeeded("2026-08-14")).toBe("14 Aug 2026");
  });

  it.each([
    ["date-only, prod (aware)", "2026-08-14T00:00:00Z"],
    ["date-only, prod (+00:00)", "2026-08-14T00:00:00+00:00"],
    ["date-only, dev (naive)", "2026-08-14T00:00:00"],
    ["date-only, bare date", "2026-08-14"],
  ])("%s → 14 Aug 2026, no phantom time", (_label, iso) => {
    expect(isDateOnly(iso)).toBe(true);
    expect(formatNeeded(iso)).toBe("14 Aug 2026");
    expect(localDay(asDate(iso))).toBe("2026-08-14");
  });

  it.each([
    ["prod (aware)", "2026-08-14T20:00:00Z"],
    ["prod (+00:00)", "2026-08-14T20:00:00+00:00"],
    ["dev (naive)", "2026-08-14T20:00:00"],
  ])("%s keeps 8:00 PM on 14 Aug", (_label, iso) => {
    expect(formatNeeded(iso)).toBe("14 Aug 2026, 8:00 PM");
    expect(localDay(asDate(iso))).toBe("2026-08-14");
  });

  it("keeps an early-morning time on its own day", () => {
    // 2 AM was the worst case: in a negative-offset timezone the old parse
    // pushed it back to the previous evening.
    expect(formatNeeded("2026-08-14T02:00:00Z")).toBe("14 Aug 2026, 2:00 AM");
    expect(localDay(asDate("2026-08-14T02:00:00Z"))).toBe("2026-08-14");
  });

  it("agrees between the prod and dev wire formats for the same order", () => {
    const prod = "2026-08-14T09:30:00Z";
    const dev = "2026-08-14T09:30:00";
    expect(formatNeeded(prod)).toBe(formatNeeded(dev));
    expect(localDay(asDate(prod))).toBe(localDay(asDate(dev)));
    expect(neededDeadline(prod)).toBe(neededDeadline(dev));
  });

  it("treats a date-only deadline as end of that day, not midnight", () => {
    const deadline = new Date(neededDeadline("2026-08-14T00:00:00Z"));
    expect(localDay(deadline)).toBe("2026-08-14");
    expect(deadline.getHours()).toBe(23);
    expect(deadline.getMinutes()).toBe(59);
  });

  it("sorts by the day that was picked", () => {
    const iso = ["2026-08-15T00:00:00Z", "2026-08-14T22:00:00Z", "2026-08-14T01:00:00Z"];
    const sorted = [...iso].sort((a, b) => asDate(a).getTime() - asDate(b).getTime());
    expect(sorted.map((s) => localDay(asDate(s)))).toEqual([
      "2026-08-14",
      "2026-08-14",
      "2026-08-15",
    ]);
  });
});
