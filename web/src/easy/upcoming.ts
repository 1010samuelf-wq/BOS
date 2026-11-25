// "Coming up": orders grouped under one heading per day, soonest first.
//
// The day is read straight off needed_for_date's first ten characters, never
// converted through a timezone — it's a wall-clock business value, and
// Postgres hands it back with a "Z" that would otherwise move a date-only
// order to the evening before (see CLAUDE.md, and order/dates.ts).

import type { Order } from "../api/types";

export interface DayGroup {
  day: string; // yyyy-mm-dd
  label: string; // "Today", "Tomorrow", "Friday 28 Nov"
  orders: Order[];
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dayLabel(day: string, now = new Date()): string {
  const today = ymd(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (day === today) return "Today";
  if (day === ymd(tomorrow)) return "Tomorrow";
  const [y, m, d] = day.split("-").map(Number);
  // Noon, so no timezone can tip it onto the neighbouring day.
  return new Date(y, m - 1, d, 12).toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "short",
  });
}

/** The time of day, when one was given ("2:30 PM"); empty for date-only orders. */
export function timeOf(neededFor: string | null): string {
  const m = neededFor?.match(/T(\d{2}):(\d{2})/);
  if (!m || (m[1] === "00" && m[2] === "00")) return "";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** Undated orders are left out: "coming up" means they have a day. */
export function groupByDay(orders: Order[], now = new Date()): DayGroup[] {
  const groups = new Map<string, Order[]>();
  for (const o of orders) {
    if (!o.needed_for_date) continue;
    const day = o.needed_for_date.slice(0, 10);
    groups.set(day, [...(groups.get(day) ?? []), o]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]) => ({
      day,
      label: dayLabel(day, now),
      orders: list.sort((a, b) => (a.needed_for_date ?? "").localeCompare(b.needed_for_date ?? "")),
    }));
}
