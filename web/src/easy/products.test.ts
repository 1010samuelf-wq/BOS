import { describe, expect, it } from "vitest";

import type { Product } from "../api/types";
import { blankForm, changes, formOf, formProblem, toCreate } from "./products";

const product: Product = {
  id: 3, name: "Babka", price: "14.00", category: "Bread", active: true, show_on_menu: true, photos: [], photo_url: null,
};

describe("the product form", () => {
  it("starts a new product selling, but off the website", () => {
    expect(blankForm()).toMatchObject({ selling: true, onWebsite: false });
  });

  it("says what's missing", () => {
    expect(formProblem({ ...blankForm(), price: "5" })).toMatch(/name/);
    expect(formProblem({ ...blankForm(), name: "Challah", price: "abc" })).toMatch(/price/);
    expect(formProblem({ ...blankForm(), name: "Challah", price: "$7.5" })).toBeNull();
    expect(formProblem({ ...blankForm(), name: "Free sample", price: "0" })).toBeNull();
  });

  it("builds a new product with a clean name and price", () => {
    expect(toCreate({ name: "  Rainbow   Cookies ", price: "$18", category: "", onWebsite: false, selling: true })).toEqual({
      name: "Rainbow Cookies", price: "18.00", category: null, show_on_menu: false, active: true,
    });
  });

  it("sends only what changed", () => {
    expect(changes(product, formOf(product))).toEqual({});
    expect(changes(product, { ...formOf(product), price: "14" })).toEqual({});
    expect(changes(product, { ...formOf(product), price: "15.50", onWebsite: false })).toEqual({
      price: "15.50", show_on_menu: false,
    });
    expect(changes(product, { ...formOf(product), category: " ", selling: false })).toEqual({
      category: null, active: false,
    });
  });
});
