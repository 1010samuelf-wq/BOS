// A "needed for" value can be date-only (no specific time) or a full date+time.
// These helpers keep date-only orders from showing a fake 00:00 time, going red
// all day, or shifting a calendar day due to timezone parsing. Mirrors
// web/src/order/dates.ts.

function asDate(iso: string): Date {
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

export function formatNeeded(iso: string): string {
  const d = asDate(iso);
  return isDateOnly(iso) ? d.toLocaleDateString() : d.toLocaleString();
}
