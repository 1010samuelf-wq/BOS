// A "needed for" value can be date-only (no specific time) or a full date+time.
// These helpers keep date-only orders from showing a fake 00:00 time, going red
// all day, or shifting a calendar day due to timezone parsing. Mirrors
// web/src/order/dates.ts.

export function asDate(iso: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(iso);
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
