// Money helpers. API prices are decimal strings ("3.50"); all arithmetic is
// done in integer cents so float drift can never hit a total.

export function toCents(price: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(price.trim());
  if (!match) throw new Error(`Bad money value: ${price}`);
  const [, sign, whole, frac = ""] = match;
  const cents = parseInt(whole, 10) * 100 + parseInt(frac.padEnd(2, "0") || "0", 10);
  return sign === "-" ? -cents : cents;
}

export function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
