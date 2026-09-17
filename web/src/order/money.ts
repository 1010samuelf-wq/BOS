/** Fills in the cents so nobody has to type them.
 *
 *   150    -> 150.00
 *   150.   -> 150.00
 *   150.5  -> 150.50
 *
 * Call it on blur, never while typing: reformatting mid-keystroke fights the
 * person entering the number.
 *
 * Anything that isn't a plain amount — a typo, a half-typed figure, three
 * decimal places — comes back exactly as typed. Silently rewriting a bad
 * number into a tidy one makes a mistake look deliberate, and these are
 * prices on a real order.
 */
export function withCents(value: string): string {
  const text = value.trim();
  if (!/^\d+\.?\d{0,2}$/.test(text)) return value;
  const amount = Number(text);
  if (!Number.isFinite(amount)) return value;
  return amount.toFixed(2);
}
