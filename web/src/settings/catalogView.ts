// Search and sort for the Settings catalog. Plain functions so they can be
// tested without rendering the page.

import type { Product } from "../api/types";

export type CatalogSort = "name" | "category";

export interface CatalogGroup {
  /** null when sorted A–Z (one flat list), or for products with no category. */
  category: string | null;
  products: Product[];
}

/** Lower-cased, accents and extra spaces dropped: "Crème  brûlée" → "creme brulee". */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const byName = (a: Product, b: Product) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/** Every word typed has to appear in the name or the category, in any order,
 *  so "choc cake" finds "Chocolate Layer Cake". */
export function matchesSearch(p: Product, query: string): boolean {
  const words = fold(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold(`${p.name} ${p.category ?? ""}`);
  return words.every((w) => hay.includes(w));
}

/** The catalog as shown: filtered by the search, then either one A–Z list or
 *  one group per category (A–Z, uncategorised last), each A–Z inside. */
export function catalogView(products: Product[], query: string, sort: CatalogSort): CatalogGroup[] {
  const found = products.filter((p) => matchesSearch(p, query));
  if (sort === "name") return found.length ? [{ category: null, products: [...found].sort(byName) }] : [];

  const groups = new Map<string, Product[]>();
  const none: Product[] = [];
  for (const p of found) {
    const c = p.category?.trim();
    if (!c) none.push(p);
    else groups.set(c, [...(groups.get(c) ?? []), p]);
  }
  const named = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(([category, ps]) => ({ category, products: ps.sort(byName) }));
  return none.length ? [...named, { category: null, products: none.sort(byName) }] : named;
}
