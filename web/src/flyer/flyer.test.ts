import { describe, expect, it } from "vitest";

import type { PublicProduct } from "../api/types";
import { UNCATEGORISED, brochurePages, flyerCategories, flyerPages, flyerPrice } from "./flyer";

const p = (id: number, name: string, category: string | null, price = "10.00"): PublicProduct => ({
  id, name, price, category, photo_url: null, photos: [],
});

describe("which flyers exist", () => {
  it("makes one per category that has something to show, A–Z, uncategorised last", () => {
    const cats = flyerCategories([
      p(1, "Babka", "Pastry"), p(2, "Rum truffles", null), p(3, "Challah", "Bread"), p(4, "Rugelach", "Pastry"),
    ]);
    expect(cats).toEqual([
      { category: "Bread", count: 1 },
      { category: "Pastry", count: 2 },
      { category: UNCATEGORISED, count: 1 },
    ]);
  });

  it("makes none when nothing is on the website", () => {
    expect(flyerCategories([])).toEqual([]);
  });

  it("treats a blank category like no category", () => {
    expect(flyerCategories([p(1, "A", "  ")])).toEqual([{ category: UNCATEGORISED, count: 1 }]);
  });
});

describe("a flyer's pages", () => {
  it("holds only that category, A–Z", () => {
    const pages = flyerPages([p(1, "Rugelach", "Pastry"), p(2, "Challah", "Bread"), p(3, "Babka", "Pastry")], "Pastry");
    expect(pages.map((pg) => pg.map((x) => x.name))).toEqual([["Babka", "Rugelach"]]);
  });

  it("starts a new page after nine", () => {
    const many = Array.from({ length: 10 }, (_, i) => p(i, `Item ${String(i).padStart(2, "0")}`, "Platters"));
    const pages = flyerPages(many, "Platters");
    expect(pages.map((pg) => pg.length)).toEqual([9, 1]);
  });
});

describe("prices on paper", () => {
  it("drops .00 but keeps cents", () => {
    expect(flyerPrice("48.00")).toBe("$48");
    expect(flyerPrice("5.50")).toBe("$5.50");
    expect(flyerPrice("5.5")).toBe("$5.50");
  });
});

describe("the brochure", () => {
  it("puts every category in, each starting its own page, twelve to a page", () => {
    const products = [
      ...Array.from({ length: 14 }, (_, i) => p(i + 1, `Cake ${String(i + 1).padStart(2, "0")}`, "Cakes")),
      p(100, "Challah", "Bread"),
      p(101, "Rum truffles", null),
    ];
    const pages = brochurePages(products);
    expect(pages.map((pg) => [pg.category, pg.items.length, pg.page, pg.pages])).toEqual([
      ["Bread", 1, 1, 1],
      ["Cakes", 12, 1, 2],
      ["Cakes", 2, 2, 2],
      [UNCATEGORISED, 1, 1, 1],
    ]);
    expect(pages[1].items[0].name).toBe("Cake 01");
  });

  it("is empty when nothing is on the website", () => {
    expect(brochurePages([])).toEqual([]);
  });
});
