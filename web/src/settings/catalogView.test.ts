import { describe, expect, it } from "vitest";

import type { Product } from "../api/types";
import { catalogView, matchesSearch } from "./catalogView";

const p = (id: number, name: string, category: string | null): Product =>
  ({ id, name, category, price: "1.00" }) as Product;

const catalog = [
  p(1, "rugelach", "Pastry"),
  p(2, "Chocolate Babka", "Bread"),
  p(3, "Challah", "Bread"),
  p(4, "Crème brûlée", null),
  p(5, "Birthday Cake", "Cakes"),
  p(6, "Apple Strudel", "Pastry"),
];

const names = (groups: ReturnType<typeof catalogView>) =>
  groups.map((g) => [g.category, g.products.map((x) => x.name)]);

describe("catalogView", () => {
  it("sorts A–Z ignoring case, as one list", () => {
    expect(names(catalogView(catalog, "", "name"))).toEqual([
      [null, ["Apple Strudel", "Birthday Cake", "Challah", "Chocolate Babka", "Crème brûlée", "rugelach"]],
    ]);
  });

  it("groups by category A–Z, uncategorised last, names A–Z inside", () => {
    expect(names(catalogView(catalog, "", "category"))).toEqual([
      ["Bread", ["Challah", "Chocolate Babka"]],
      ["Cakes", ["Birthday Cake"]],
      ["Pastry", ["Apple Strudel", "rugelach"]],
      [null, ["Crème brûlée"]],
    ]);
  });

  it("searches name and category, every word, any order, ignoring accents", () => {
    expect(matchesSearch(catalog[1], "babka choc")).toBe(true);
    expect(matchesSearch(catalog[3], "creme brulee")).toBe(true);
    expect(matchesSearch(catalog[0], "pastry")).toBe(true);
    expect(matchesSearch(catalog[0], "cake")).toBe(false);
    expect(names(catalogView(catalog, "  BREAD ", "category"))).toEqual([
      ["Bread", ["Challah", "Chocolate Babka"]],
    ]);
  });

  it("returns nothing when nothing matches, so the page can say so", () => {
    expect(catalogView(catalog, "pizza", "name")).toEqual([]);
    expect(catalogView(catalog, "pizza", "category")).toEqual([]);
  });
});
