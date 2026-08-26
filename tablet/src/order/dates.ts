// A "needed for" value can be date-only (no specific time) or a full date+time.
// These helpers keep date-only orders from showing a fake 00:00 time, going red
// all day, or shifting a calendar day due to timezone parsing. Mirrors
// web/src/order/dates.ts.

/**
 * Parse a "needed for" value as **wall clock** — the date/time someone typed
 * in the shop, not an instant on a global timeline. Components are read
 * verbatim and rebuilt as a local Date, deliberately ignoring any trailing
 * `Z`/offset, because the backend treats this field as a business day too
 * (it buckets Production/Deliveries/filters by its UTC calendar day).
 *
 * Letting the Date ctor timezone-convert here is what broke it before:
 * Postgres returns this column tz-aware (`...T00:00:00Z`) while the SQLite
 * dev DB returns it naive, so a date-only order for Aug 14 rendered as
 * "13 Aug, 8:00 PM" in production and sorted under the wrong day.
 */
export function asDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(iso);
  if (!m) return new Date(iso); // unrecognised shape — let the ctor try
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
}

export function isDateOnly(iso: string): boolean {
  if (!iso.includes("T")) return true;
  const d = asDate(iso);
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
}

export function neededDeadline(iso: string): number {
  const d = asDate(iso);
  if (isDateOnly(iso)) d.setHours(23, 59, 59, 999);
  return d.getTime();
}

// Fixed "day month year" + 12-hour clock, built manually rather than via
// toLocaleDateString/toLocaleString — Hermes on Android often lacks full ICU
// data for those, and even where it works it'd follow the device's locale
// instead of a fixed, predictable format.
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

export function formatNeeded(iso: string): string {
  const d = asDate(iso);
  return isDateOnly(iso) ? formatDate(d) : formatDateTime(d);
}

/** "3 min ago" / "2h ago" / "5d ago" — for "as of" staleness labels on
 * offline-cached screens (spec: bakery-floor offline mode). */
export function formatRelative(epochMs: number): string {
  const diffMin = Math.round((Date.now() - epochMs) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const hours = Math.round(diffMin / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
