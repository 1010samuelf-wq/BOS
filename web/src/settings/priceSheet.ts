// What the price-sheet preview says before anyone presses Apply.

import type { PriceChange } from "../api/types";

export interface PriceSummary {
  update: number;
  add: number;
  unchanged: number;
  skip: number;
  /** Updates and additions — what Apply would actually write. */
  writes: number;
}

export function summarize(changes: PriceChange[]): PriceSummary {
  const s = { update: 0, add: 0, unchanged: 0, skip: 0, writes: 0 };
  for (const c of changes) s[c.action] += 1;
  s.writes = s.update + s.add;
  return s;
}

/** Order the preview so the rows worth reading come first: what changes an
 *  existing price, then what's skipped (needs a person), then additions. */
const ORDER: Record<PriceChange["action"], number> = { update: 0, skip: 1, add: 2, unchanged: 3 };

export function ordered(changes: PriceChange[]): PriceChange[] {
  return [...changes].sort((a, b) => ORDER[a.action] - ORDER[b.action] || a.name.localeCompare(b.name));
}

/** "Price sheet 2026-10" from "ingredient_prices_2026-10". */
export function sheetLabel(name: string): string {
  return "Price sheet " + name.replace(/^ingredient_prices_/, "");
}
