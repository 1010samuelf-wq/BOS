// Category flyers, built from what the public website shows.
//
// The products come from /public/products — the same feed as the website, so
// the server decides what's in (active AND switched on for the website) and a
// flyer can never advertise something the website doesn't.

import type { PublicProduct } from "../api/types";

/** Products with no category still deserve a flyer; this is its title. */
export const UNCATEGORISED = "More from Just Cake";

/** 3 × 3 on a Letter page leaves each photo big enough to see on paper. */
export const PER_PAGE = 9;

export interface FlyerCategory {
  category: string;
  count: number;
}

const categoryOf = (p: PublicProduct) => p.category?.trim() || UNCATEGORISED;

/** One entry per category that has at least one product to show, A–Z, with
 *  the uncategorised flyer last. Empty categories get no flyer at all. */
export function flyerCategories(products: PublicProduct[]): FlyerCategory[] {
  const counts = new Map<string, number>();
  for (const p of products) counts.set(categoryOf(p), (counts.get(categoryOf(p)) ?? 0) + 1);
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) =>
      a.category === UNCATEGORISED ? 1 : b.category === UNCATEGORISED ? -1 : a.category.localeCompare(b.category),
    );
}

/** The products on one category's flyer, A–Z, split into printed pages. */
export function flyerPages(products: PublicProduct[], category: string, perPage = PER_PAGE): PublicProduct[][] {
  const mine = products
    .filter((p) => categoryOf(p) === category)
    .sort((a, b) => a.name.localeCompare(b.name));
  const pages: PublicProduct[][] = [];
  for (let i = 0; i < mine.length; i += perPage) pages.push(mine.slice(i, i + perPage));
  return pages;
}

/** "$48" for whole dollars, "$5.50" otherwise — cleaner on a flyer. */
export function flyerPrice(price: string | number): string {
  const n = Number(price);
  if (!Number.isFinite(n)) return `$${price}`;
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}
