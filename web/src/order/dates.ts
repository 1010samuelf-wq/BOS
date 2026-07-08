// A "needed for" value can be date-only (no specific time) or a full date+time.
// These helpers keep date-only orders from showing a fake 00:00 time, going red
// all day, or shifting a calendar day due to timezone parsing.

/**
 * Parse an API value to a local Date. A pure "YYYY-MM-DD" is parsed by the JS
 * Date ctor as UTC midnight, which shifts a day in negative-offset timezones —
 * so build it from parts as *local* midnight instead. Full datetimes without a
 * zone are already parsed as local.
 */
function asDate(iso: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(iso);
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

/** Human label: just the date when there's no time, otherwise date + time. */
export function formatNeeded(iso: string): string {
  const d = asDate(iso);
  return isDateOnly(iso) ? d.toLocaleDateString() : d.toLocaleString();
}
