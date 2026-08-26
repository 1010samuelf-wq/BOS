// A "needed for" value can be date-only (no specific time) or a full date+time.
// These helpers keep date-only orders from showing a fake 00:00 time, going red
// all day, or shifting a calendar day due to timezone parsing.

/**
 * Parse a "needed for" value as **wall clock** — the date/time someone typed
 * in the shop, not an instant on a global timeline.
 *
 * Every component is read verbatim and rebuilt as a local Date, deliberately
 * ignoring any trailing `Z`/offset. That is not a shortcut: the backend treats
 * this field as a business day too (it buckets Production/Deliveries/filters
 * by its UTC calendar day), so "needed Aug 14, 8 PM" has to stay Aug 14 8 PM
 * on every screen.
 *
 * Letting the JS Date ctor apply a timezone conversion here is what broke it
 * before: Postgres returns this column tz-aware (`...T00:00:00Z`) while the
 * SQLite dev DB returns it naive (`...T00:00:00`), so the same order rendered
 * a day earlier in production than in dev — a date-only order for Aug 14 came
 * back as "13 Aug, 8:00 PM" in New York, and sorted under the wrong day.
 */
export function asDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(iso);
  if (!m) return new Date(iso); // unrecognised shape — let the ctor try
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
}

/** True when the value carries no meaningful time (pure date or local midnight). */
export function isDateOnly(iso: string): boolean {
  if (!iso.includes("T")) return true; // pure "YYYY-MM-DD"
  const d = asDate(iso);
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
}

/** Deadline for the overdue check: end-of-day for date-only, else the time. */
export function neededDeadline(iso: string): number {
  const d = asDate(iso);
  if (isDateOnly(iso)) d.setHours(23, 59, 59, 999);
  return d.getTime();
}

// Fixed "day month year" + 12-hour clock, regardless of device/browser locale
// (the built-in toLocaleDateString/toLocaleString follow whatever locale the
// OS is set to, which on a shared shop device is not something to rely on —
// and React Native's JS engine often lacks full ICU data for them anyway).
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "6 Aug 2026" */
export function formatDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
/** "2:05 PM" */
export function formatTime(d: Date): string {
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, "0")} ${ampm}`;
}
/** "6 Aug 2026, 2:05 PM" */
export function formatDateTime(d: Date): string {
  return `${formatDate(d)}, ${formatTime(d)}`;
}
/** "Thu, 6 Aug" — for compact per-row date columns. */
export function formatWeekdayDate(d: Date): string {
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Human label: just the date when there's no time, otherwise date + time. */
export function formatNeeded(iso: string): string {
  const d = asDate(iso);
  return isDateOnly(iso) ? formatDate(d) : formatDateTime(d);
}
